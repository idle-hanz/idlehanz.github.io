/**
 * hl-undo.js - undo, snapshot, ownership (attaches to HLApp)
 */
(function (global) {
  "use strict";
  var H = global.HLApp;
  if (!H) throw new Error("HLApp missing - load hl-core.js first");

  /**
   * Full editor snapshot: path + write home + staged land + tempo.
   * Without tonic/mode, Land / establish / disk-home undos leave gravity wrong.
   */
  H.snapshotChords = function () {
    return {
      chords: H.state.chords.map((c) => ({
        ...c,
        notes: (c.notes || []).slice(),
        intervals: (c.intervals || []).slice(),
      })),
      selected: H.state.selected,
      title: H.state.title,
      fromPackId: H.state.fromPackId,
      cellId: H.state.cellId,
      nameLocked: !!H.state.nameLocked,
      tonic: H.state.tonic,
      mode: H.state.mode,
      pendingTonic: H.state.pendingTonic,
      pendingMode: H.state.pendingMode,
      bpm: H.state.bpm,
      loop: !!H.state.loop,
      pulse: !!H.state.pulse,
    };
  };

  H.restoreSnapshot = function (snap) {
    if (!snap) return;

    // Write home FIRST so chord rebuild can fall back to the correct gravity
    if (snap.tonic != null) H.state.tonic = H.pcNorm(snap.tonic);
    if (snap.mode) H.state.mode = snap.mode;
    H.state.pendingTonic = snap.pendingTonic != null ? snap.pendingTonic : null;
    H.state.pendingMode = snap.pendingMode != null ? snap.pendingMode : null;
    if (snap.bpm != null) H.state.bpm = snap.bpm;
    if (snap.loop != null) H.state.loop = !!snap.loop;
    if (snap.pulse != null) H.state.pulse = !!snap.pulse;
    if (snap.nameLocked != null) H.state.nameLocked = !!snap.nameLocked;
    H.state.title = snap.title;
    H.state.fromPackId = snap.fromPackId;
    H.state.cellId = snap.cellId;

    H.state.chords = (snap.chords || []).map((c) => H.sessionChordToLandscape(c));
    H.state.selected =
      snap.selected != null
        ? Math.max(-1, Math.min(H.state.chords.length - 1, snap.selected))
        : H.state.chords.length
          ? 0
          : -1;

    // Sync controls
    if (H.$('#tonic')) H.$('#tonic').value = String(H.state.tonic);
    if (H.$('#mode')) H.$('#mode').value = H.state.mode;
    if (H.$('#bpm')) H.$('#bpm').value = String(H.state.bpm);
    if (H.$('#loop')) H.$('#loop').checked = !!H.state.loop;
    if (H.$('#pulse')) H.$('#pulse').checked = !!H.state.pulse;
    if (H.updateLandButton) H.updateLandButton();

    if (H.map) {
      if (H.map.rememberKey) H.map.rememberKey(H.state.tonic, H.state.mode);
      if (H.map.setOrigin) H.map.setOrigin(H.state.tonic, H.state.mode, { layoutPath: false });
    }
  };

  // ─── Multi-disk ownership (localTonic / localMode) ─────────
  // Each path step owns a Chase disk. Write home (H.state.tonic/mode) is gravity
  // for NEW steps only. Edits must keep a step on its disk; Land / establish
  // switch gravity and plant new chords — they do not retag the old journey.

  H.pcNorm = function (n) {
    return ((Number(n) % 12) + 12) % 12;
  };

  /** Shortest distance between two pitch classes (0–6). */
  H.pcDist = function (a, b) {
    const d = Math.abs(H.pcNorm(a) - H.pcNorm(b));
    return d > 6 ? 12 - d : d;
  };

  H.writeKey = function () {
    return { tonic: H.state.tonic, mode: H.state.mode };
  };

  H.keyOf = function (ch) {
    if (!ch) return H.writeKey();
    return {
      tonic: ch.localTonic != null ? ch.localTonic : H.state.tonic,
      mode: ch.localMode || H.state.mode,
    };
  };

  /** Stamp a chord onto a disk (default = current write home). */
  H.stampKey = function (ch, key) {
    if (!ch) return ch;
    const k = key || H.writeKey();
    ch.localTonic = H.pcNorm(k.tonic);
    ch.localMode = k.mode || H.state.mode;
    if (H.map && H.map.rememberKey) H.map.rememberKey(ch.localTonic, ch.localMode);
    return ch;
  };

  H.ensurePathOwned = function () {
    H.state.chords.forEach((ch) => {
      if (ch && ch.localTonic == null) H.stampKey(ch, H.writeKey());
    });
  };

  H.keyLabelFor = function (key) {
    const k = key || H.writeKey();
    const modeMeta = H.M().MODES && H.M().MODES[k.mode];
    const modeName = (modeMeta && modeMeta.name) || k.mode || 'minor';
    return (H.M().noteName(k.tonic) || '?') + ' ' + modeName;
  };

  /**
   * Session / snapshot chord → Landscape chord object.
   * Preserves free pitch sets (custom) instead of forcing a named triad.
   */
  H.sessionChordToLandscape = function (sc) {
    const notes = Array.isArray(sc.notes) ? sc.notes.map((n) => ((n % 12) + 12) % 12) : [];
    const bassPc = sc.bass != null ? sc.bass : sc.bassPc;
    let isCustom = !!sc.custom || sc.quality === 'custom';
    // Only infer custom from notes when there is no named quality.
    // Named colours (dom7b9, 7alt, …) must survive save/load.
    if (!isCustom && !sc.quality && notes.length && H.S() && H.S().exactQualityFromNotes) {
      if (!H.S().exactQualityFromNotes(notes, sc.root)) isCustom = true;
    }
    let ch;
    if (isCustom) {
      ch = H.M().makeCustomChord
        ? H.M().makeCustomChord(sc.root, notes.length ? notes : [sc.root], {
            duration: sc.duration != null ? sc.duration : 4,
            roman: sc.roman || '',
            region: sc.region || 'custom',
            tag: sc.tag || 'custom',
            name: sc.name,
            bassPc,
          })
        : H.M().makeChord(sc.root, 'custom', {
            notes: notes.length ? notes : [sc.root],
            duration: sc.duration,
            name: sc.name,
            bassPc,
          });
    } else {
      ch = H.M().makeChord(sc.root, sc.quality || 'maj', {
        duration: sc.duration != null ? sc.duration : 4,
        roman: sc.roman || '',
        region: sc.region || 'diatonic',
        tag: sc.tag || '',
        bassPc,
      });
      if (notes.length) ch.notes = notes.slice();
      if (bassPc != null && bassPc !== sc.root && H.C().withBass) {
        ch = H.C().withBass(ch, bassPc);
        ch.duration = sc.duration != null ? sc.duration : 4;
        ch.roman = sc.roman || '';
      }
    }
    if (sc.localTonic != null) {
      ch.localTonic = sc.localTonic;
      ch.localMode = sc.localMode || H.state.mode;
      if (H.map && H.map.rememberKey) H.map.rememberKey(ch.localTonic, ch.localMode);
    } else if (sc.localMode) {
      ch.localMode = sc.localMode;
    }
    return ch;
  };

  H.pushUndo = function () {
    H.state.undoStack.push(H.snapshotChords());
    if (H.state.undoStack.length > H.MAX_UNDO) H.state.undoStack.shift();
    H.state.redoStack = [];
    if (H.updateUndoButtons) H.updateUndoButtons();
  };

  /** After undo/redo: refresh UI and keep audio aligned (or stop). */
  H._afterHistoryRestore = function () {
    H.recognize({ preserveName: H.state.nameLocked });
    H.refreshAll();
    if (H.S() && H.state.chords.length) H.pushToSharedSession('landscape');
    // Path/key may have changed under a frozen schedule
    if (H.A() && H.A().isPlaying && H.A().isPlaying()) {
      if (!H.state.chords.length) {
        if (H.stopPlaybackUI) H.stopPlaybackUI();
      } else if (H.resyncPlaybackPreservingPlace) {
        H.resyncPlaybackPreservingPlace();
      } else if (H.stopPlaybackUI) {
        H.stopPlaybackUI();
      }
    }
    if (H.updatePlayBtn) H.updatePlayBtn();
  };

  H.updateUndoButtons = function () {
    const u = H.$('#btn-undo');
    const r = H.$('#btn-redo-edit');
    const nU = H.state.undoStack.length;
    const nR = H.state.redoStack.length;
    if (u) {
      u.disabled = !nU;
      u.title = nU
        ? 'Undo (' + nU + ' available) · Ctrl+Z'
        : 'Nothing to undo · Ctrl+Z';
    }
    if (r) {
      r.disabled = !nR;
      r.title = nR
        ? 'Redo (' + nR + ' available) · Ctrl+Y'
        : 'Nothing to redo · Ctrl+Y';
    }
  };

  H.undo = function () {
    if (!H.state.undoStack.length) {
      H.setSyncStatus('Nothing to undo');
      return;
    }
    H.state.redoStack.push(H.snapshotChords());
    H.restoreSnapshot(H.state.undoStack.pop());
    H._afterHistoryRestore();
    H.updateUndoButtons();
    H.setSyncStatus(
      'Undo · ' +
        H.keyLabel() +
        (H.state.chords.length ? ' · ' + H.state.chords.length + ' steps' : ' · empty path')
    );
  };

  H.redo = function () {
    if (!H.state.redoStack.length) {
      H.setSyncStatus('Nothing to redo');
      return;
    }
    H.state.undoStack.push(H.snapshotChords());
    H.restoreSnapshot(H.state.redoStack.pop());
    H._afterHistoryRestore();
    H.updateUndoButtons();
    H.setSyncStatus(
      'Redo · ' +
        H.keyLabel() +
        (H.state.chords.length ? ' · ' + H.state.chords.length + ' steps' : ' · empty path')
    );
  };

})(typeof window !== "undefined" ? window : globalThis);
