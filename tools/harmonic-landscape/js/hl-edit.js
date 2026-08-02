/**
 * hl-edit.js - edit, duration, recognize (attaches to HLApp)
 */
(function (global) {
  "use strict";
  var H = global.HLApp;
  if (!H) throw new Error("HLApp missing - load hl-core.js first");
H.smoothVoicings = function () {
    if (!H.state.chords.length || !H.C().smoothCellVoicings) return;
    H.pushUndo();
    // Capture ownership before smooth (compose may drop localTonic)
    const keys = H.state.chords.map((c) => H.keyOf(c));
    H.state.chords = H.C().smoothCellVoicings(H.state.chords);
    H.state.chords.forEach((c, i) => H.stampKey(c, keys[i] || H.writeKey()));
    H.state.fromPackId = null;
    H.afterEdit();
    H.A().ensure();
    H.playSeq({ once: true, force: true, label: 'Smoothed voicings · multi-disk ownership kept' });
  }

  /**
   * Match pack for badge only. Never renames the cell if nameLocked or user-set.
   */
  H.recognize = function (opts) {
    opts = opts || {};
    const hit = H.P().recognize(H.state.chords, H.state.tonic);
    H.state.recognition = hit;
    if (hit && hit.exact) H.state.fromPackId = hit.pack.id;
    else if (!hit || hit.confidence < 0.85) {
      // keep fromPackId if still related; clear only on no match
      if (!hit) H.state.fromPackId = null;
    }
    // Auto-name only for brand-new untitled cells
    if (opts.preserveName || H.state.nameLocked) return;
    const auto =
      !H.state.title ||
      H.state.title === 'Untitled sequence' ||
      H.state.title === 'Custom sequence' ||
      H.state.title === 'Untitled';
    if (auto && hit && hit.confidence >= 0.85) {
      H.state.title = H.uniqueCellName(hit.pack.name + (hit.exact ? '' : ' (related)'));
    } else if (auto && !hit) {
      H.state.title = 'Custom sequence';
    }
  }

  H.setCellName = function (name) {
    const n = String(name || '').trim();
    if (!n) return;
    H.state.title = n;
    H.state.nameLocked = true;
    if (H.S() && H.state.cellId) {
      const song = H.S().loadSong();
      if (song && song.cells[H.state.cellId]) {
        song.cells[H.state.cellId].name = n;
        H.S().saveSong(song, 'landscape');
      } else {
        H.pushToSharedSession('landscape');
      }
    }
    H.renderTitle();
    H.setSyncStatus('Renamed · ' + n);
  }

  H.removeSelected = function () {
    if (H.state.selected < 0 || !H.state.chords.length) return;
    H.pushUndo();
    H.state.chords.splice(H.state.selected, 1);
    H.state.selected = Math.min(H.state.selected, H.state.chords.length - 1);
    H.state.fromPackId = null;
    H.afterEdit();
  }

  H.setDuration = function (beats, skipUndo) {
    const i = H.state.selected;
    if (i < 0 || !H.state.chords[i]) return;
    if (!skipUndo) H.pushUndo();
    H.state.chords[i] = H.M().withDuration(H.state.chords[i], beats);
    if (H.S()) H.pushToSharedSession('landscape');
    H.refreshSequence();
    H.refreshMap();
  }

  /** Snap duration to half-beat grid, clamp ≥ 0.5 */
  H.snapBeats = function (b) {
    return Math.max(0.5, Math.round(b * 2) / 2);
  }

  /**
   * Resize from the right edge of step `index`.
   * Internal border: steal/give beats with the next step (total length kept).
   * Last step: change its duration alone (cell can grow/shrink).
   */
  H.resizeStripEdge = function (index, deltaBeats, opts) {
    opts = opts || {};
    if (index < 0 || index >= H.state.chords.length) return false;
    const live = !!opts.live;
    const a = H.state.chords[index];
    const da0 = a.duration || 4;
    const hasNext = index < H.state.chords.length - 1;

    if (hasNext) {
      const b = H.state.chords[index + 1];
      const db0 = b.duration || 4;
      // Redistribute; neither side below 0.5
      let da = H.snapBeats(da0 + deltaBeats);
      let db = H.snapBeats(da0 + db0 - da);
      if (db < 0.5) {
        db = 0.5;
        da = H.snapBeats(da0 + db0 - db);
      }
      if (da < 0.5) {
        da = 0.5;
        db = H.snapBeats(da0 + db0 - da);
      }
      // Keep exact total if possible
      const total = da0 + db0;
      if (Math.abs(da + db - total) > 0.01) {
        db = Math.max(0.5, H.snapBeats(total - da));
        da = Math.max(0.5, total - db);
      }
      if (da === da0 && db === db0) return false;
      H.state.chords[index] = H.M().withDuration(a, da);
      H.state.chords[index + 1] = H.M().withDuration(b, db);
    } else {
      const da = H.snapBeats(da0 + deltaBeats);
      if (da === da0) return false;
      H.state.chords[index] = H.M().withDuration(a, da);
    }
    if (!live) {
      H.state.fromPackId = null;
      if (H.S()) H.pushToSharedSession('landscape');
    }
    return true;
  }

  H.setBass = function (pc) {
    const i = H.state.selected;
    if (i < 0 || !H.state.chords[i] || !H.C().withBass) return;
    H.pushUndo();
    const dur = H.state.chords[i].duration;
    H.state.chords[i] = H.C().withBass(H.state.chords[i], pc);
    H.state.chords[i].duration = dur;
    H.state.fromPackId = null;
    H.afterEdit();
    H.A().ensure();
    H.A().playChord({ chord: H.state.chords[i] });
  }

  H.setSelectedRootQuality = function (root, quality) {
    const i = H.state.selected;
    if (i < 0 || !H.state.chords[i]) return;
    H.pushUndo();
    const prev = H.state.chords[i];
    const ownKey = H.keyOf(prev);
    let ch = H.M().makeChord(root, quality, {
      duration: prev.duration,
      roman: prev.roman,
      region: prev.region,
      tag: 'edited',
    });
    if (H.C().withBass && prev.bassPc != null) {
      // keep bass if still a chord tone
      const tones = ch.notes.map((n) => ((n % 12) + 12) % 12);
      if (tones.includes(prev.bassPc)) ch = H.C().withBass(ch, prev.bassPc);
    }
    ch.duration = prev.duration;
    H.stampKey(ch, ownKey);
    H.state.chords[i] = ch;
    H.state.fromPackId = null;
    H.afterEdit();
    H.A().ensure();
    H.A().playChord({ chord: ch });
  }

  H.clearSeq = function () {
    if (H.state.chords.length) H.pushUndo();
    H.state.chords = [];
    H.state.selected = -1;
    H.state.title = 'Untitled sequence';
    H.state.recognition = null;
    H.state.fromPackId = null;
    H.refreshAll();
  }

  H.beatSum = function (chords) {
    return (chords || []).reduce((s, c) => s + (c.duration || 4), 0);
  }

  /** Split budget beats across n steps on a half-beat grid (exact total). */
  H.splitBudget = function (budget, n) {
    n = Math.max(1, n | 0);
    budget = Math.max(0.5 * n, budget);
    const raw = budget / n;
    const durs = [];
    let used = 0;
    for (let i = 0; i < n; i++) {
      if (i === n - 1) {
        durs.push(Math.max(0.5, H.snapBeats(budget - used)));
      } else {
        const d = Math.max(0.5, H.snapBeats(raw));
        durs.push(d);
        used += d;
      }
    }
    // Fix drift so sum === budget
    let sum = durs.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - budget) > 0.001) {
      durs[n - 1] = Math.max(0.5, H.snapBeats(durs[n - 1] + (budget - sum)));
      sum = durs.reduce((a, b) => a + b, 0);
      // If still off due to snap, put remainder on last without re-snap below 0.5
      if (Math.abs(sum - budget) > 0.001) {
        durs[n - 1] = Math.max(0.5, durs[n - 1] + (budget - sum));
      }
    }
    return durs;
  }

  H.stepDuration = function () {
    const d = H.state.defaultDuration != null ? H.state.defaultDuration : 4;
    return Math.max(0.5, H.snapBeats(d));
  }

  /**
   * Fit a horizon package into the sequence.
   *
   * Composing forward (empty / at end): APPEND with default step length — cell may grow.
   * (Old "steal from last" cascaded 4→2→1→0.5 and wrecked new paths.)
   *
   * Mid-path replace: keep total length by fitting into next step(s)' budget.
   * Shift+insert: steal from neighbors.
   */
})(typeof window !== "undefined" ? window : globalThis);
