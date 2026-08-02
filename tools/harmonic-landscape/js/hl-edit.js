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

  /**
   * Clear the working path only (keeps write home, versions, undo of prior clears).
   */
  H.clearSeq = function () {
    if (H.state.chords.length) H.pushUndo();
    H.state.chords = [];
    H.state.selected = -1;
    H.state.title = 'Untitled sequence';
    H.state.recognition = null;
    H.state.fromPackId = null;
    H.state.nameLocked = false;
    H.refreshAll();
    H.setSyncStatus('Path cleared · write home still ' + H.keyLabel() + ' · Reset all = zero slate');
  }

  /**
   * Full zero slate: empty path, no pack, no blue compare, fresh cell id,
   * undo stacks empty, map key ledger wiped. Write home stays on the dropdowns
   * (so you still have a tonic for seats) unless opts.resetHome.
   */
  H.resetToEmpty = function (opts) {
    opts = opts || {};
    if (H.A() && H.A().isPlaying && H.A().isPlaying()) {
      if (H.stopPlaybackUI) H.stopPlaybackUI();
      else if (H.A().stopPlayback) H.A().stopPlayback();
    }

    H.state.chords = [];
    H.state.selected = -1;
    H.state.title = 'Untitled sequence';
    H.state.recognition = null;
    H.state.fromPackId = null;
    H.state.nameLocked = false;
    H.state.cellId = H.S() && H.S().newCellId ? H.S().newCellId('cell') : null;
    H.state.compareCellId = null;
    H.state.undoStack = [];
    H.state.redoStack = [];
    H.state.pendingTonic = null;
    H.state.pendingMode = null;
    H.state.defaultDuration = 4;
    H.state.syncMsg = '';

    if (opts.resetHome) {
      H.state.tonic = 0; // C
      H.state.mode = 'major';
      if (H.$('#tonic')) H.$('#tonic').value = '0';
      if (H.$('#mode')) H.$('#mode').value = 'major';
    }

    // Wipe multi-disk memory so only the current write home remains
    if (H.map) {
      if (H.map.keyLedger) H.map.keyLedger = [];
      if (H.map.setFunctionChart) H.map.setFunctionChart(null);
      if (H.map.setAltPath) H.map.setAltPath([]);
      if (H.map.setHorizon) H.map.setHorizon([]);
      if (H.map.setPath) H.map.setPath([], -1);
      if (H.map.setOrigin) H.map.setOrigin(H.state.tonic, H.state.mode);
      if (H.map.setMapView) H.map.setMapView('chase');
      if (H.map.focusHome) H.map.focusHome();
    }
    if (H.$('#view-chase')) H.$('#view-chase').classList.add('active');
    if (H.$('#view-function')) H.$('#view-function').classList.remove('active');
    if (H.$('#tog-alt')) {
      H.$('#tog-alt').checked = false;
      if (H.map && H.map.setShowAlt) H.map.setShowAlt(false);
    }

    // Optional: drop IHSession song so Arrangement doesn't rehydrate old cells
    if (opts.clearSession && H.S() && H.S().saveSong) {
      try {
        const song = H.S().loadSong && H.S().loadSong();
        if (song) {
          song.cells = {};
          song.families = song.families || {};
          song.focus = { cellId: null, sectionId: null, chordIndex: 0 };
          song.key = { tonic: H.state.tonic, mode: H.state.mode };
          H.S().saveSong(song, 'landscape');
        }
      } catch (_) {
        /* ignore */
      }
    }

    H.refreshAll();
    H.updateLandButton && H.updateLandButton();
    H.setSyncStatus(
      'Reset · empty path · no pack' +
        (opts.resetHome ? ' · home C major' : ' · write home ' + H.keyLabel()) +
        (opts.clearSession ? ' · session cells cleared' : '') +
        ' · load a feel or click seats to start'
    );
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
