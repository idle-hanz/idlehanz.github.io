/**
 * hl-undo.js - undo, snapshot, ownership (attaches to HLApp)
 */
(function (global) {
  "use strict";
  var H = global.HLApp;
  if (!H) throw new Error("HLApp missing - load hl-core.js first");
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
    };
  }

  H.restoreSnapshot = function (snap) {
    if (!snap) return;
    H.state.chords = (snap.chords || []).map((c) => H.sessionChordToLandscape(c));
    H.state.selected = snap.selected;
    H.state.title = snap.title;
    H.state.fromPackId = snap.fromPackId;
    H.state.cellId = snap.cellId;
  }

  // ─── Multi-disk ownership (localTonic / localMode) ─────────
  // Each path step owns a Chase disk. Write home (H.state.tonic/mode) is gravity
  // for NEW steps only. Edits must keep a step on its disk; Land here / modulate
  // switch gravity and retag from the pivot.

  H.pcNorm = function (n) {
    return ((Number(n) % 12) + 12) % 12;
  }

  /** Shortest distance between two pitch classes (0–6). */
  H.pcDist = function (a, b) {
    const d = Math.abs(H.pcNorm(a) - H.pcNorm(b));
    return d > 6 ? 12 - d : d;
  }

  H.writeKey = function () {
    return { tonic: H.state.tonic, mode: H.state.mode };
  }

  H.keyOf = function (ch) {
    if (!ch) return H.writeKey();
    return {
      tonic: ch.localTonic != null ? ch.localTonic : H.state.tonic,
      mode: ch.localMode || H.state.mode,
    };
  }

  /** Stamp a chord onto a disk (default = current write home). */
  H.stampKey = function (ch, key) {
    if (!ch) return ch;
    const k = key || H.writeKey();
    ch.localTonic = H.pcNorm(k.tonic);
    ch.localMode = k.mode || H.state.mode;
    if (H.map && H.map.rememberKey) H.map.rememberKey(ch.localTonic, ch.localMode);
    return ch;
  }

  /** Keep disk ownership when replacing/editing an existing step. */
  H.keepKey = function (ch, from) {
    return H.stampKey(ch, H.keyOf(from));
  }

  H.ensurePathOwned = function () {
    H.state.chords.forEach((ch) => {
      if (ch && ch.localTonic == null) H.stampKey(ch, H.writeKey());
    });
  }

  H.keyLabelFor = function (key) {
    const k = key || H.writeKey();
    const modeMeta = H.M().MODES && H.M().MODES[k.mode];
    const modeName = (modeMeta && modeMeta.name) || k.mode || 'minor';
    return (H.M().noteName(k.tonic) || '?') + ' ' + modeName;
  }

  /**
   * Session / snapshot chord → Landscape chord object.
   * Preserves free pitch sets (custom) instead of forcing a named triad.
   */
  H.sessionChordToLandscape = function (sc) {
    const notes = Array.isArray(sc.notes) ? sc.notes.map((n) => ((n % 12) + 12) % 12) : [];
    const bassPc = sc.bass != null ? sc.bass : sc.bassPc;
    let isCustom = !!sc.custom || sc.quality === 'custom';
    // Notes present but not an exact named quality → keep as free pitch set
    if (!isCustom && notes.length && H.S() && H.S().exactQualityFromNotes) {
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
    ch.localTonic = sc.localTonic != null ? sc.localTonic : H.state.tonic;
    ch.localMode = sc.localMode || H.state.mode;
    if (H.map && H.map.rememberKey) H.map.rememberKey(ch.localTonic, ch.localMode);
    return ch;
  }

  H.pushUndo = function () {
    H.state.undoStack.push(H.snapshotChords());
    if (H.state.undoStack.length > H.MAX_UNDO) H.state.undoStack.shift();
    H.state.redoStack = [];
  }

  H.undo = function () {
    if (!H.state.undoStack.length) return;
    H.state.redoStack.push(H.snapshotChords());
    H.restoreSnapshot(H.state.undoStack.pop());
    H.recognize();
    H.refreshAll();
    if (H.S() && H.state.chords.length) H.pushToSharedSession('landscape');
  }

  H.redo = function () {
    if (!H.state.redoStack.length) return;
    H.state.undoStack.push(H.snapshotChords());
    H.restoreSnapshot(H.state.redoStack.pop());
    H.recognize();
    H.refreshAll();
    if (H.S() && H.state.chords.length) H.pushToSharedSession('landscape');
  }

})(typeof window !== "undefined" ? window : globalThis);
