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
    H.state.nameLocked = true;
    if (H.S() && H.state.cellId) {
      const song = H.S().loadSong();
      if (song && song.cells[H.state.cellId]) {
        const cell = song.cells[H.state.cellId];
        if (H.S().applyUserCellName) H.S().applyUserCellName(song, cell, n);
        else cell.name = H.S().stripGeneratedLineage
          ? H.S().stripGeneratedLineage(n) || cell.name
          : n;
        H.S().saveSong(song, 'landscape');
        H.state.title = cell.name;
      } else {
        H.state.title = n;
        H.pushToSharedSession('landscape');
      }
    } else {
      H.state.title = n;
    }
    H.renderTitle();
    if (H.renderVersionBar) H.renderVersionBar();
    H.setSyncStatus('Renamed · ' + (H.state.title || n));
  }

  H.removeSelected = function () {
    if (!H.state.chords.length) return;
    const n = H.state.chords.length;
    let idxs = H.getSelectedIndices
      ? H.getSelectedIndices().filter(function (i) {
          return i >= 0 && i < n;
        })
      : [];
    if (!idxs.length && H.state.selected >= 0 && H.state.selected < n) {
      idxs = [H.state.selected];
    }
    if (!idxs.length) return;
    idxs = idxs.slice().sort(function (a, b) {
      return b - a;
    }); // delete high→low
    H.pushUndo();
    const removed = idxs.length;
    idxs.forEach(function (i) {
      H.state.chords.splice(i, 1);
    });
    const keep = Math.min(
      idxs[idxs.length - 1] || 0,
      Math.max(0, H.state.chords.length - 1)
    );
    H.state.selected = H.state.chords.length ? keep : -1;
    H.state.selectedIndices = H.state.selected >= 0 ? [H.state.selected] : [];
    H.state.fromPackId = null;
    H.afterEdit();
    if (H.showToast) {
      H.showToast(
        removed === 1
          ? 'Deleted step'
          : 'Deleted ' + removed + ' steps'
      );
    } else if (H.setSyncStatus) {
      H.setSyncStatus(
        removed === 1 ? 'Deleted step' : 'Deleted ' + removed + ' steps'
      );
    }
  };

  /** Delete a single path index (strip × / map context). */
  H.removeChordAt = function (index) {
    if (index == null || index < 0 || index >= H.state.chords.length) return;
    H.state.selected = index;
    H.state.selectedIndices = [index];
    H.removeSelected();
  };

  H.setDuration = function (beats, skipUndo) {
    const indices = H.getSelectedIndices
      ? H.getSelectedIndices()
      : H.state.selected >= 0
        ? [H.state.selected]
        : [];
    if (!indices.length) return;
    H.setDurationForIndices(indices, beats, { skipUndo: skipUndo });
  };

  /** Indices currently multi-selected (timeline). Always includes primary `selected` when valid. */
  H.getSelectedIndices = function () {
    const n = (H.state.chords || []).length;
    let idxs = (H.state.selectedIndices || [])
      .map((i) => (i | 0))
      .filter((i) => i >= 0 && i < n);
    if (H.state.selected >= 0 && H.state.selected < n && idxs.indexOf(H.state.selected) < 0) {
      idxs = [H.state.selected];
    } else if (!idxs.length && H.state.selected >= 0 && H.state.selected < n) {
      idxs = [H.state.selected];
    }
    // de-dupe + sort
    const seen = {};
    const out = [];
    idxs.forEach((i) => {
      if (!seen[i]) {
        seen[i] = 1;
        out.push(i);
      }
    });
    out.sort((a, b) => a - b);
    return out;
  };

  H.setSelectedIndices = function (indices, primary) {
    const n = (H.state.chords || []).length;
    const clean = (indices || [])
      .map((i) => (i | 0))
      .filter((i) => i >= 0 && i < n);
    const seen = {};
    H.state.selectedIndices = [];
    clean.forEach((i) => {
      if (!seen[i]) {
        seen[i] = 1;
        H.state.selectedIndices.push(i);
      }
    });
    H.state.selectedIndices.sort((a, b) => a - b);
    if (primary != null && primary >= 0 && primary < n) {
      H.state.selected = primary;
    } else if (H.state.selectedIndices.length) {
      H.state.selected = H.state.selectedIndices[H.state.selectedIndices.length - 1];
    } else {
      H.state.selected = n ? Math.min(Math.max(0, H.state.selected), n - 1) : -1;
    }
    if (
      H.state.selected >= 0 &&
      H.state.selectedIndices.indexOf(H.state.selected) < 0
    ) {
      H.state.selectedIndices.push(H.state.selected);
      H.state.selectedIndices.sort((a, b) => a - b);
    }
  };

  /**
   * Set duration on many steps at once (timeline multi-select).
   */
  H.setDurationForIndices = function (indices, beats, opts) {
    opts = opts || {};
    const n = (H.state.chords || []).length;
    const idxs = (indices || []).filter((i) => i >= 0 && i < n);
    if (!idxs.length) return;
    if (!opts.skipUndo) H.pushUndo();
    const d = H.snapBeats(beats);
    idxs.forEach((i) => {
      H.state.chords[i] = H.M().withDuration(H.state.chords[i], d);
    });
    H.state.fromPackId = null;
    if (H.S()) H.pushToSharedSession('landscape');
    H.refreshSequence();
    H.refreshMap({ keepCamera: true });
    if (H.renderTimeStrip) H.renderTimeStrip({ force: true, scrollToSelected: false });
    if (H.syncDurationBar) H.syncDurationBar();
    if (H.resyncPlaybackPreservingPlace) {
      if (opts.skipUndo) {
        if (H._durResyncTimer) clearTimeout(H._durResyncTimer);
        H._durResyncTimer = setTimeout(() => {
          H._durResyncTimer = null;
          H.resyncPlaybackPreservingPlace();
        }, 140);
      } else {
        if (H._durResyncTimer) {
          clearTimeout(H._durResyncTimer);
          H._durResyncTimer = null;
        }
        H.resyncPlaybackPreservingPlace();
      }
    }
    if (!opts.silent) {
      H.setSyncStatus(
        idxs.length > 1
          ? 'Duration · ' + d + 'b · ' + idxs.length + ' steps'
          : 'Duration · step ' + (idxs[0] + 1) + ' · ' + d + 'b'
      );
    }
  };

  /** Snap duration to half-beat grid, clamp ≥ 0.5 (no upper cap for long holds). */
  H.snapBeats = function (b) {
    const n = Number(b);
    if (!isFinite(n) || n <= 0) return 0.5;
    return Math.max(0.5, Math.round(n * 2) / 2);
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
    const ownKey = H.keyOf(H.state.chords[i]);
    H.state.chords[i] = H.C().withBass(H.state.chords[i], pc);
    H.state.chords[i].duration = dur;
    H.stampKey(H.state.chords[i], ownKey);
    H.state.fromPackId = null;
    if (H.map && H.map.clearInteraction) H.map.clearInteraction();
    H.afterEdit();
    if (H.map && H.map.setPath) H.map.setPath(H.state.chords, H.state.selected);
    H.A().ensure();
    H.A().playChord({ chord: H.state.chords[i] });
  };

  /**
   * Best-effort roman for a chord in a key (after inspector edits).
   * Avoids stale labels like "V7" after the user changes quality to maj.
   */
  H.romanForChordInKey = function (ch, key) {
    if (!ch || !H.M()) return '';
    const music = H.M();
    const k = key || H.writeKey();
    if (music.seatForChord) {
      const hit = music.seatForChord(ch, k.tonic, k.mode || 'minor');
      if (hit && hit.seat && hit.seat.roman && hit.seat.roman !== '?') {
        const fam = music.qualityFamily ? music.qualityFamily(ch.quality) : '';
        // V seat + dominant family → V7
        if (hit.seat.role === 'dom' && fam === 'dom') return 'V7';
        if (hit.seat.role === 'tonic' && fam === 'dom') return hit.seat.roman;
        return hit.seat.roman;
      }
    }
    return '';
  };

  H.setSelectedRootQuality = function (root, quality) {
    const i = H.state.selected;
    if (i < 0 || !H.state.chords[i]) return;
    H.pushUndo();
    const prev = H.state.chords[i];
    const ownKey = H.keyOf(prev);
    // Fresh name/notes from makeChord — never keep a stale display name
    let ch = H.M().makeChord(root, quality, {
      duration: prev.duration != null ? prev.duration : 4,
      region: prev.region || 'diatonic',
      tag: 'edited',
      // roman recomputed below for the new quality
      roman: '',
    });
    ch.roman = H.romanForChordInKey(ch, ownKey) || '';
    if (H.C().withBass && prev.bassPc != null) {
      const tones = (ch.notes || []).map((n) => ((n % 12) + 12) % 12);
      if (tones.includes(prev.bassPc)) {
        ch = H.C().withBass(ch, prev.bassPc);
        ch.duration = prev.duration != null ? prev.duration : 4;
        ch.roman = H.romanForChordInKey(ch, ownKey) || ch.roman;
      }
    }
    ch.duration = prev.duration != null ? prev.duration : 4;
    H.stampKey(ch, ownKey);
    H.state.chords[i] = ch;
    H.state.fromPackId = null;
    // Ensure map is not stuck mid-aim (would defer setPath layout)
    if (H.map) {
      if (H.map.clearInteraction) H.map.clearInteraction();
      H.map._mode = null;
      H.map._pathDirty = false;
    }
    H.afterEdit();
    // Hard sync path nodes (quality-only edits can look like "nothing moved")
    if (H.map && H.map.setPath) {
      H.map.setPath(H.state.chords, H.state.selected);
    }
    if (H.previewNextFromStep && H.map && H.map.mapView !== 'function') {
      H.previewNextFromStep(i, { silent: true });
    }
    H.A().ensure();
    H.A().playChord({ chord: ch });
    H.setSyncStatus(
      'Edited step ' +
        (i + 1) +
        ' → ' +
        (ch.name || '?') +
        (ch.roman ? ' (' + ch.roman + ')' : '') +
        ' · map updated'
    );
  };

  /**
   * Clear the working path only (keeps write home, versions, undo of prior clears).
   */
  H.clearSeq = function () {
    if (H.state.chords.length) H.pushUndo();
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
    H.refreshAll();
    H.setSyncStatus('Path cleared · write home still ' + H.keyLabel() + ' · Reset all = zero slate');
  };

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
    H.state.lastCompareCellId = null;
    H.state.armedVersionId = null;
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
          song.families = {};
          song.arrangement = [];
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
