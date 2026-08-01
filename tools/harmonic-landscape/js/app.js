/**
 * Harmonic Landscape — sequence document + spatial compass
 * Bidirectional: enter sequence (named if canonical) OR pick a feel pack.
 */
(function () {
  'use strict';

  const M = () => window.HLMusic;
  const A = () => window.HLAudio;
  const C = () => window.HLCompose || window.HLMusic;
  const P = () => window.HLPacks;
  const S = () => window.IHSession;

  const state = {
    tonic: 11,
    mode: 'minor',
    bpm: 96,
    loop: true,
    pulse: true,
    chords: [],
    selected: 0,
    title: 'Untitled sequence', // cell display name (user-editable)
    recognition: null, // { pack, exact, match } — does NOT force cell name
    fromPackId: null,
    cellId: null,
    nameLocked: false, // true after user renames; recognition won't override
    addRoot: 11,
    addQuality: 'min',
    syncMsg: '',
    undoStack: [],
    redoStack: [],
  };

  let map = null;
  let dragSlotIndex = null;
  const $ = (s) => document.querySelector(s);
  const MAX_UNDO = 40;

  function snapshotChords() {
    return {
      chords: state.chords.map((c) => ({
        ...c,
        notes: (c.notes || []).slice(),
        intervals: (c.intervals || []).slice(),
      })),
      selected: state.selected,
      title: state.title,
      fromPackId: state.fromPackId,
      cellId: state.cellId,
    };
  }

  function restoreSnapshot(snap) {
    if (!snap) return;
    state.chords = (snap.chords || []).map((c) => {
      let ch = M().makeChord(c.root, c.quality, {
        duration: c.duration,
        roman: c.roman,
        region: c.region,
        tag: c.tag,
      });
      if (c.bassPc != null && C().withBass) {
        ch = C().withBass(ch, c.bassPc);
        ch.duration = c.duration;
        ch.roman = c.roman;
        ch.region = c.region;
        ch.tag = c.tag;
      }
      ch.localTonic = c.localTonic != null ? c.localTonic : state.tonic;
      ch.localMode = c.localMode || state.mode;
      return ch;
    });
    state.selected = snap.selected;
    state.title = snap.title;
    state.fromPackId = snap.fromPackId;
    state.cellId = snap.cellId;
  }

  function pushUndo() {
    state.undoStack.push(snapshotChords());
    if (state.undoStack.length > MAX_UNDO) state.undoStack.shift();
    state.redoStack = [];
  }

  function undo() {
    if (!state.undoStack.length) return;
    state.redoStack.push(snapshotChords());
    restoreSnapshot(state.undoStack.pop());
    recognize();
    refreshAll();
    if (S() && state.chords.length) pushToSharedSession('landscape');
  }

  function redo() {
    if (!state.redoStack.length) return;
    state.undoStack.push(snapshotChords());
    restoreSnapshot(state.redoStack.pop());
    recognize();
    refreshAll();
    if (S() && state.chords.length) pushToSharedSession('landscape');
  }

  function init() {
    map = new HLSpatial.SpatialMap($('#map'));
    map.setOrigin(state.tonic, state.mode);
    map.onSelectPath = (i, ch) => {
      state.selected = i;
      A().ensure();
      A().playChord({ chord: ch });
      refreshUI();
    };
    map.onSelectHorizon = (item) => commitHorizon(item);
    map.onHoverHorizon = (item) => {
      A().ensure();
      A().playChord({ chord: item.chord, soft: true, duration: 0.45 });
    };
    map.onRequestAlts = (pathIndex, chord) => {
      const alts = C().closeAlternates
        ? C().closeAlternates(chord, state.tonic, state.mode, 8)
        : [];
      return alts.map((a) => ({
        chord: { ...a.chord, duration: chord.duration || 4 },
        label: a.label,
      }));
    };
    map.onSwapChord = (pathIndex, newChord) => {
      if (pathIndex < 0 || pathIndex >= state.chords.length) return;
      pushUndo();
      const prev = state.chords[pathIndex];
      let ch = M().cloneChord(newChord);
      ch.duration = prev.duration || 4;
      ch.localTonic = state.tonic;
      ch.localMode = state.mode;
      if (C().bestInversion && pathIndex > 0) {
        ch = C().bestInversion(state.chords[pathIndex - 1], ch);
        ch.duration = prev.duration || 4;
      }
      state.chords[pathIndex] = ch;
      state.selected = pathIndex;
      state.fromPackId = null;
      // Force map layout refresh after drag
      map._mode = null;
      afterEdit();
      A().ensure();
      A().playChord({ chord: ch });
    };
    map.setCameraMode('home');
    map.start();

    fillControls();
    wire();
    // Prefer handoff / shared session; else seed a feel pack
    const loaded = ingestHandoffOrSession();
    if (!loaded) loadPack('home-grit', { silent: true });
    refreshAll();
    refreshAltPath();
    setSyncStatus(loaded ? 'Loaded shared session' : 'Local pack · not yet sent');

    document.body.addEventListener('pointerdown', () => A().ensure(), { once: true });
    requestAnimationFrame(() => {
      map.resize();
      refreshMap();
    });
  }

  function setSyncStatus(msg) {
    state.syncMsg = msg || '';
    const el = $('#sync-status');
    if (el) el.textContent = state.syncMsg;
  }

  /** Apply session chords (plain objects) into working Landscape chords */
  function applySessionChords(chords, meta) {
    meta = meta || {};
    state.chords = (chords || []).map((sc) => {
      let ch = M().makeChord(sc.root, sc.quality || 'maj', {
        duration: sc.duration != null ? sc.duration : 4,
        roman: sc.roman || '',
        region: sc.region || 'diatonic',
        tag: sc.tag || '',
      });
      if (sc.bass != null && sc.bass !== sc.root && C().withBass) {
        ch = C().withBass(ch, sc.bass);
        ch.duration = sc.duration != null ? sc.duration : 4;
        ch.roman = sc.roman || '';
      }
      ch.localTonic = state.tonic;
      ch.localMode = state.mode;
      return ch;
    });
    // Prefer explicit cell name from session — never overwrite with pack recognition
    if (meta.title) {
      state.title = meta.title;
      state.nameLocked = true;
    }
    if (meta.cellId) state.cellId = meta.cellId;
    if (meta.packId) state.fromPackId = meta.packId;
    if (meta.tonic != null) {
      state.tonic = meta.tonic;
      const tEl = $('#tonic');
      if (tEl) tEl.value = String(state.tonic);
    }
    if (meta.mode) {
      state.mode = meta.mode;
      const mEl = $('#mode');
      if (mEl) mEl.value = state.mode;
    }
    if (meta.bpm != null) {
      state.bpm = meta.bpm;
      const bEl = $('#bpm');
      if (bEl) bEl.value = state.bpm;
    }
    state.selected = Math.max(0, Math.min(state.chords.length - 1, meta.focusIndex || 0));
    map.setOrigin(state.tonic, state.mode);
    recognize({ preserveName: true });
  }

  function ingestHandoffOrSession() {
    if (!S()) return false;

    // 1) URL hash handoff (works on file://)
    const handoff = S().readHandoffFromLocation() || S().readHandoffStorage();
    if (handoff && handoff.to === 'landscape' && handoff.chords && handoff.chords.length) {
      const chords = S().expandHandoffChords(handoff);
      applySessionChords(chords, {
        title: handoff.cellName || handoff.title,
        cellId: handoff.cellId,
        tonic: handoff.key && handoff.key.tonic,
        mode: handoff.key && handoff.key.mode,
        bpm: handoff.bpm,
        focusIndex: handoff.focus || 0,
      });
      S().clearHandoffHash();
      pushToSharedSession('landscape');
      return true;
    }

    // 2) Focused cell in full song session
    const song = S().loadSong();
    if (song) {
      const cell = S().getFocusedCell(song);
      if (cell && cell.chords && cell.chords.length) {
        applySessionChords(cell.chords, {
          title: cell.name || song.title,
          cellId: cell.id,
          packId: cell.packId,
          tonic: song.key && song.key.tonic,
          mode: song.key && song.key.mode,
          bpm: song.bpm,
          focusIndex: song.focus && song.focus.chordIndex,
        });
        return true;
      }
    }
    return false;
  }

  function pushToSharedSession(by) {
    if (!S() || !state.chords.length) return null;
    let song = S().loadSong() || S().emptySong({
      title: 'Untitled',
      bpm: state.bpm,
      tonic: state.tonic,
      mode: state.mode,
      updatedBy: by || 'landscape',
    });
    // Song title is the piece name — do not overwrite with cell name
    if (!song.title || song.title === 'Untitled') {
      song.title = song.title || 'Untitled';
    }
    song.bpm = state.bpm;
    song.key = { tonic: state.tonic, mode: state.mode };
    const cellId = state.cellId || S().newCellId('cell');
    state.cellId = cellId;
    // Preserve existing cell name if set and current title is still a pack auto-name
    const existing = song.cells[cellId];
    let cellName = state.title || 'Cell';
    if (existing && existing.name && state.nameLocked) {
      cellName = state.title || existing.name;
    } else if (existing && existing.name && (!state.title || state.title === 'Untitled sequence')) {
      cellName = existing.name;
      state.title = existing.name;
    }
    const prevCell = song.cells[cellId];
    song.cells[cellId] = {
      id: cellId,
      name: cellName,
      packId: state.fromPackId || null,
      familyId: prevCell && prevCell.familyId ? prevCell.familyId : null,
      versionIndex: prevCell && prevCell.versionIndex ? prevCell.versionIndex : 1,
      chords: state.chords.map((c) => S().fromLandscapeChord(c)),
    };
    song.focus = {
      cellId,
      sectionId: song.focus && song.focus.sectionId ? song.focus.sectionId : null,
      chordIndex: Math.max(0, state.selected),
    };
    S().saveSong(song, by || 'landscape');
    setSyncStatus('Session saved · ' + cellName);
    return song;
  }

  function pullFromSharedSession() {
    if (!S()) {
      setSyncStatus('Session module missing (ih-session.js)');
      return;
    }
    const song = S().loadSong();
    const cell = song && S().getFocusedCell(song);
    if (!cell || !cell.chords.length) {
      setSyncStatus('No focused cell in session — send from Fretboard first');
      return;
    }
    applySessionChords(cell.chords, {
      title: cell.name || song.title,
      cellId: cell.id,
      packId: cell.packId,
      tonic: song.key && song.key.tonic,
      mode: song.key && song.key.mode,
      bpm: song.bpm,
      focusIndex: song.focus && song.focus.chordIndex,
    });
    refreshAll();
    setSyncStatus('Pulled “' + (cell.name || 'cell') + '” from session');
    playSeq({ once: true });
  }

  function sendToFretboard() {
    if (!state.chords.length) {
      alert('Add some chords first.');
      return;
    }
    if (!S()) {
      alert('ih-session.js not loaded. Keep it next to the harmonic-landscape folder on Desktop.');
      return;
    }
    pushToSharedSession('landscape');
    const chords = state.chords.map((c) => S().fromLandscapeChord(c));
    const payload = S().buildHandoffPayload({
      by: 'landscape',
      to: 'fretboard',
      title: state.title,
      bpm: state.bpm,
      key: { tonic: state.tonic, mode: state.mode },
      cellId: state.cellId,
      cellName: state.title,
      focus: state.selected,
      chords,
    });
    const ok = S().openWithHandoff(S().PATHS.fretboardFromLandscape, payload);
    setSyncStatus(ok ? 'Opened Fretboard with sequence' : 'Could not open Fretboard — check Desktop paths');
    $('#export-out').value = JSON.stringify(payload, null, 2);
  }

  function fillControls() {
    M().NOTE_NAMES.forEach((n, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = n;
      if (i === state.tonic) o.selected = true;
      $('#tonic').appendChild(o);
      const o2 = o.cloneNode(true);
      if (i === state.addRoot) o2.selected = true;
      $('#add-root').appendChild(o2);
    });
    Object.keys(M().MODES).forEach((k) => {
      const o = document.createElement('option');
      o.value = k;
      o.textContent = M().MODES[k].name;
      if (k === state.mode) o.selected = true;
      $('#mode').appendChild(o);
    });
    Object.keys(M().QUALITIES).forEach((k) => {
      const o = document.createElement('option');
      o.value = k;
      o.textContent = M().QUALITIES[k].symbol || M().QUALITIES[k].label || k;
      if (k === 'min') o.selected = true;
      $('#add-quality').appendChild(o);
    });
    const feel = $('#feel-filter');
    const fo = document.createElement('option');
    fo.value = 'all';
    fo.textContent = 'All feels';
    feel.appendChild(fo);
    P().FEELS.forEach((f) => {
      const o = document.createElement('option');
      o.value = f;
      o.textContent = f;
      feel.appendChild(o);
    });
  }

  // ─── Sequence ops ────────────────────────────────────────
  function keyLabel() {
    return M().noteName(state.tonic) + ' ' + (M().MODES[state.mode] || {}).name;
  }

  function uniqueCellName(base) {
    if (!S()) return base;
    const song = S().loadSong();
    if (!song || !song.cells) return base;
    const names = new Set(Object.keys(song.cells).map((id) => (song.cells[id].name || '').toLowerCase()));
    if (!names.has(base.toLowerCase())) return base;
    let n = 2;
    while (names.has((base + ' ' + n).toLowerCase())) n++;
    return base + ' ' + n;
  }

  function loadPack(id, opts) {
    const pack = P().getPack(id);
    if (!pack) return;
    state.chords = P().materialize(pack, state.tonic, state.mode);
    state.fromPackId = id;
    // New cell each pack load — unique name so they don't all read "Home grit"
    state.cellId = S() ? S().newCellId(id) : null;
    state.title = uniqueCellName(pack.name);
    state.nameLocked = false;
    state.recognition = { pack, exact: true, match: 'exact', confidence: 1 };
    state.selected = Math.max(0, state.chords.length - 1);
    refreshAll();
    if (S()) pushToSharedSession('landscape');
    if (!opts || !opts.silent) playSeq({ once: true });
  }

  function makeEnteredChord(root, q) {
    let ch = M().makeChord(root, q, {
      duration: 4,
      region: 'diatonic',
      tag: 'entered',
    });
    const prev =
      state.selected >= 0 && state.chords[state.selected]
        ? state.chords[state.selected]
        : state.chords[state.chords.length - 1];
    if (prev && C().bestInversion) {
      ch = C().bestInversion(prev, ch);
      ch.duration = 4;
      ch.tag = 'entered';
    }
    ch.localTonic = state.tonic;
    ch.localMode = state.mode;
    return ch;
  }

  function addChordFromPicker(insertMode) {
    pushUndo();
    const root = parseInt($('#add-root').value, 10);
    const q = $('#add-quality').value;
    const ch = makeEnteredChord(root, q);
    if (insertMode === 'before' && state.selected >= 0) {
      state.chords.splice(state.selected, 0, ch);
    } else if (insertMode === 'after' && state.selected >= 0) {
      state.chords.splice(state.selected + 1, 0, ch);
      state.selected += 1;
    } else {
      state.chords.push(ch);
      state.selected = state.chords.length - 1;
    }
    state.fromPackId = null;
    afterEdit();
    A().ensure();
    A().playChord({ chord: ch });
  }

  function duplicateSelected() {
    if (state.selected < 0 || !state.chords[state.selected]) return;
    pushUndo();
    const copy = M().cloneChord(state.chords[state.selected]);
    copy.duration = state.chords[state.selected].duration;
    state.chords.splice(state.selected + 1, 0, copy);
    state.selected += 1;
    state.fromPackId = null;
    afterEdit();
  }

  function moveSelected(delta) {
    const i = state.selected;
    const j = i + delta;
    if (i < 0 || j < 0 || j >= state.chords.length) return;
    pushUndo();
    const t = state.chords[i];
    state.chords[i] = state.chords[j];
    state.chords[j] = t;
    state.selected = j;
    state.fromPackId = null;
    afterEdit();
  }

  function reorderChord(from, to) {
    if (from === to || from < 0 || to < 0 || from >= state.chords.length || to >= state.chords.length) return;
    pushUndo();
    const [item] = state.chords.splice(from, 1);
    state.chords.splice(to, 0, item);
    state.selected = to;
    state.fromPackId = null;
    afterEdit();
  }

  function afterEdit() {
    recognize({ preserveName: state.nameLocked });
    refreshAll();
    if (S() && state.chords.length) {
      try {
        pushToSharedSession('landscape');
      } catch (_) {}
    }
    refreshAltPath();
  }

  /** Draw sibling variation (v2) in blue if this cell is in a family. */
  function refreshAltPath() {
    if (!map || !S()) {
      if (map) map.setAltPath([]);
      return;
    }
    const song = S().loadSong();
    if (!song || !state.cellId) {
      map.setAltPath([]);
      return;
    }
    const sibs = S().siblingsOfCell(song, state.cellId);
    const other = sibs.find((c) => c.id !== state.cellId);
    if (!other || !other.chords || !other.chords.length) {
      map.setAltPath([]);
      return;
    }
    // Convert session chords to landscape chord objects for layout
    const alt = other.chords.map((sc) => {
      let ch = M().makeChord(sc.root, sc.quality || 'maj', {
        duration: sc.duration || 4,
        region: sc.region || 'diatonic',
      });
      if (sc.bass != null && C().withBass) ch = C().withBass(ch, sc.bass);
      return ch;
    });
    map.setAltPath(alt);
  }

  /**
   * Fork current sequence as a linked variation (same family).
   * kind: reharm | parallel | darken
   */
  function createVariation(kind) {
    if (!state.chords.length) {
      alert('Add chords first.');
      return;
    }
    if (!S()) {
      alert('Session module missing.');
      return;
    }
    pushToSharedSession('landscape');
    let song = S().loadSong();
    if (!song || !state.cellId) return;

    // Mutate a copy of chords for the variation
    let newChords = state.chords.map((c) => S().fromLandscapeChord(c));
    if (kind === 'parallel') {
      // Flip maj/min quality on non-dominant chords
      newChords = newChords.map((c) => {
        let q = c.quality;
        if (q === 'min' || q === 'min7') q = q === 'min' ? 'maj' : 'maj7';
        else if (q === 'maj' || q === 'maj7') q = q === 'maj' ? 'min' : 'min7';
        return { ...c, quality: q, tag: 'parallel' };
      });
    } else if (kind === 'darken' || kind === 'reharm') {
      // Change middle chord(s) toward darker colours
      if (newChords.length >= 3) {
        const t = state.tonic;
        const i = Math.min(2, newChords.length - 1);
        newChords[i] = {
          root: (t + 8) % 12,
          quality: 'maj',
          duration: newChords[i].duration,
          bass: (t + 8) % 12,
          roman: 'bVI',
          region: 'interchange',
          tag: kind,
        };
      }
      if (kind === 'reharm' && newChords.length >= 4) {
        const t = state.tonic;
        const j = newChords.length - 2;
        newChords[j] = {
          root: (t + 1) % 12,
          quality: 'dom7',
          duration: newChords[j].duration,
          bass: (t + 1) % 12,
          roman: 'bII7',
          region: 'tritone',
          tag: 'reharm',
        };
      }
    }

    const newId = S().createVariation(song, state.cellId, { chords: newChords });
    if (!newId) return;
    S().saveSong(song, 'landscape');

    // Switch to the new version for editing
    const cell = song.cells[newId];
    applySessionChords(cell.chords, {
      title: cell.name,
      cellId: newId,
      packId: cell.packId,
      tonic: song.key && song.key.tonic,
      mode: song.key && song.key.mode,
      bpm: song.bpm,
    });
    state.nameLocked = true;
    refreshAll();
    refreshAltPath();
    setSyncStatus('Created ' + cell.name + ' · gold=this · blue=sibling');
    playSeq({ once: true });
  }

  /**
   * Match pack for badge only. Never renames the cell if nameLocked or user-set.
   */
  function recognize(opts) {
    opts = opts || {};
    const hit = P().recognize(state.chords, state.tonic);
    state.recognition = hit;
    if (hit && hit.exact) state.fromPackId = hit.pack.id;
    else if (!hit || hit.confidence < 0.85) {
      // keep fromPackId if still related; clear only on no match
      if (!hit) state.fromPackId = null;
    }
    // Auto-name only for brand-new untitled cells
    if (opts.preserveName || state.nameLocked) return;
    const auto =
      !state.title ||
      state.title === 'Untitled sequence' ||
      state.title === 'Custom sequence' ||
      state.title === 'Untitled';
    if (auto && hit && hit.confidence >= 0.85) {
      state.title = uniqueCellName(hit.pack.name + (hit.exact ? '' : ' (related)'));
    } else if (auto && !hit) {
      state.title = 'Custom sequence';
    }
  }

  function setCellName(name) {
    const n = String(name || '').trim();
    if (!n) return;
    state.title = n;
    state.nameLocked = true;
    if (S() && state.cellId) {
      const song = S().loadSong();
      if (song && song.cells[state.cellId]) {
        song.cells[state.cellId].name = n;
        S().saveSong(song, 'landscape');
      } else {
        pushToSharedSession('landscape');
      }
    }
    renderTitle();
    setSyncStatus('Renamed · ' + n);
  }

  function removeSelected() {
    if (state.selected < 0 || !state.chords.length) return;
    pushUndo();
    state.chords.splice(state.selected, 1);
    state.selected = Math.min(state.selected, state.chords.length - 1);
    state.fromPackId = null;
    afterEdit();
  }

  function setDuration(beats, skipUndo) {
    const i = state.selected;
    if (i < 0 || !state.chords[i]) return;
    if (!skipUndo) pushUndo();
    state.chords[i] = M().withDuration(state.chords[i], beats);
    if (S()) pushToSharedSession('landscape');
    refreshSequence();
    refreshMap();
  }

  function setBass(pc) {
    const i = state.selected;
    if (i < 0 || !state.chords[i] || !C().withBass) return;
    pushUndo();
    const dur = state.chords[i].duration;
    state.chords[i] = C().withBass(state.chords[i], pc);
    state.chords[i].duration = dur;
    state.fromPackId = null;
    afterEdit();
    A().ensure();
    A().playChord({ chord: state.chords[i] });
  }

  function setSelectedRootQuality(root, quality) {
    const i = state.selected;
    if (i < 0 || !state.chords[i]) return;
    pushUndo();
    const prev = state.chords[i];
    let ch = M().makeChord(root, quality, {
      duration: prev.duration,
      roman: prev.roman,
      region: prev.region,
      tag: 'edited',
    });
    if (C().withBass && prev.bassPc != null) {
      // keep bass if still a chord tone
      const tones = ch.notes.map((n) => ((n % 12) + 12) % 12);
      if (tones.includes(prev.bassPc)) ch = C().withBass(ch, prev.bassPc);
    }
    ch.duration = prev.duration;
    ch.localTonic = state.tonic;
    ch.localMode = state.mode;
    state.chords[i] = ch;
    state.fromPackId = null;
    afterEdit();
    A().ensure();
    A().playChord({ chord: ch });
  }

  function clearSeq() {
    if (state.chords.length) pushUndo();
    state.chords = [];
    state.selected = -1;
    state.title = 'Untitled sequence';
    state.recognition = null;
    state.fromPackId = null;
    refreshAll();
  }

  function commitHorizon(item) {
    pushUndo();
    const ch = M().cloneChord(item.chord);
    ch.duration = item.chord.duration || 4;
    ch.tag = item.kind;
    ch.region = item.chord.region || regionFromKind(item.kind);
    ch.localTonic = state.tonic;
    ch.localMode = state.mode;
    // If cadence route with multiple chords stored in meta
    if (item.route && item.route.length) {
      item.route.forEach((c) => {
        const x = M().cloneChord(c);
        x.duration = c.duration || 2;
        x.localTonic = state.tonic;
        x.localMode = state.mode;
        state.chords.push(x);
      });
    } else {
      state.chords.push(ch);
    }
    // Modulation: update home if marked
    if (item.modulateTo) {
      state.tonic = item.modulateTo.tonic;
      state.mode = item.modulateTo.mode;
      $('#tonic').value = String(state.tonic);
      $('#mode').value = state.mode;
      map.setOrigin(state.tonic, state.mode);
    }
    state.selected = state.chords.length - 1;
    state.fromPackId = null;
    afterEdit();
    A().ensure();
    A().playChord({ chord: state.chords[state.selected] });
  }

  function regionFromKind(kind) {
    if (kind === 'cadence') return 'diatonic';
    if (kind === 'modulate') return 'chromatic';
    if (kind === 'flavour') return 'interchange';
    return 'diatonic';
  }

  // ─── Horizon builders ────────────────────────────────────
  function buildHorizon() {
    const music = M();
    const compose = C();
    const t = state.tonic;
    const from =
      state.selected >= 0 && state.chords[state.selected]
        ? state.chords[state.selected]
        : state.chords[state.chords.length - 1] || null;

    const items = [];

    // Flavours — colour family moves
    const flavourSeeds = [
      { d: 8, q: 'maj', label: '♭VI colour', kind: 'flavour', job: 'dark lift' },
      { d: 10, q: 'maj', label: '♭VII modal', kind: 'flavour', job: 'epic' },
      { d: 5, q: 'min', label: 'iv soft', kind: 'flavour', job: 'pad' },
      { d: 1, q: 'maj', label: '♭II gate', kind: 'flavour', job: 'phrygian' },
      { d: 1, q: 'dom7', label: '♭II7 noir', kind: 'flavour', job: 'noir' },
      { d: 4, q: 'maj', label: 'Mediant', kind: 'flavour', job: 'cinematic' },
      { d: 3, q: 'maj', label: 'III', kind: 'flavour', job: 'relative' },
      { d: 7, q: 'dom7', label: 'V7 push', kind: 'flavour', job: 'tension' },
    ];
    flavourSeeds.forEach((s) => {
      let ch = music.makeChord((t + s.d) % 12, s.q, {
        region: s.d === 1 && s.q === 'dom7' ? 'tritone' : s.d === 4 ? 'chromatic' : 'interchange',
        tag: s.job,
        roman: s.label,
      });
      if (from && compose.bestInversion) ch = compose.bestInversion(from, ch);
      if (from && from.root === ch.root && from.quality === ch.quality) return;
      items.push({ chord: ch, kind: 'flavour', label: ch.name, job: s.job });
    });

    // Directions — ranked next moves
    if (compose.suggestNext) {
      const sug = compose.suggestNext({
        fromChord: from,
        tonic: t,
        modeKey: state.mode,
        goalId: 'balanced',
        count: 5,
        path: state.chords,
      });
      sug.forEach((s) => {
        items.push({
          chord: s.chord,
          kind: 'direction',
          label: s.chord.name,
          job: s.jobLabel,
        });
      });
    }

    // Cadence colours — routes home
    if (from) {
      const routes = music.waysBackHome(from, t, state.mode, 4);
      routes.forEach((r) => {
        const first = r.chords[0];
        items.push({
          chord: first,
          kind: 'cadence',
          label: r.name,
          job: r.character,
          route: r.chords,
        });
      });
    }

    // Modulation links
    if (compose.modulationTargets) {
      const targets = compose.modulationTargets(t, state.mode, 5);
      targets.slice(0, 4).forEach((tgt) => {
        const into = compose.waysIntoKey
          ? compose.waysIntoKey(from || music.makeChord(t, 'min'), tgt.tonic, tgt.mode, 1)
          : [];
        const route = into[0];
        const first = route
          ? route.chords[0]
          : music.makeChord(tgt.tonic, (music.MODES[tgt.mode] || {}).romanBase === 'minor' ? 'min' : 'maj');
        items.push({
          chord: first,
          kind: 'modulate',
          label: '→ ' + music.noteName(tgt.tonic),
          job: tgt.relation,
          route: route ? route.chords : [first],
          modulateTo: { tonic: tgt.tonic, mode: tgt.mode },
        });
      });
    }

    // Dedupe by root+quality+kind, limit density
    const seen = new Set();
    const out = [];
    for (const it of items) {
      const k = it.kind + ':' + it.chord.root + ':' + it.chord.quality + ':' + (it.label || '');
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(it);
      if (out.length >= 18) break;
    }
    return out;
  }

  // ─── Playback / export ───────────────────────────────────
  function playSeq(opts) {
    A().ensure();
    if (A().isPlaying()) {
      A().stopPlayback();
      map.setPlaying(-1);
      updatePlayBtn();
      return;
    }
    if (!state.chords.length) return;
    const once = opts && opts.once;
    A().playSequence(state.chords, state.bpm, {
      loop: once ? false : state.loop,
      pulse: state.pulse,
      onStep: (i) => {
        map.setPlaying(i);
        state.selected = i;
        renderSlots();
      },
      onEnd: () => {
        map.setPlaying(-1);
        updatePlayBtn();
      },
    });
    updatePlayBtn();
  }

  function updatePlayBtn() {
    const b = $('#btn-play');
    b.textContent = A().isPlaying() ? 'Stop' : state.loop ? 'Loop' : 'Play';
    b.classList.toggle('on', A().isPlaying());
  }

  function exportText() {
    const lines = [
      `# ${state.title}`,
      `Key: ${keyLabel()} · ${state.bpm} BPM`,
      state.recognition
        ? `Canonical: ${state.recognition.pack.name} (${state.recognition.match})`
        : 'Canonical: —',
      '',
      M().formatChordList(state.chords, state.bpm),
    ];
    if (state.recognition && state.recognition.pack.why) {
      lines.push('', 'Feel: ' + state.recognition.pack.why);
    }
    const text = lines.join('\n');
    $('#export-out').value = text;
    dl(new Blob([text], { type: 'text/plain' }), slug(state.title) + '.txt');
  }

  function exportMidi() {
    if (!state.chords.length) return;
    dl(new Blob([buildMidi(state.chords, state.bpm)], { type: 'audio/midi' }), slug(state.title) + '.mid');
  }

  function dl(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }

  function slug(s) {
    return String(s || 'seq')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function buildMidi(chords, bpm) {
    const tpq = 480;
    const micro = Math.round(60000000 / bpm);
    const events = [
      { tick: 0, data: [0xff, 0x51, 0x03, (micro >> 16) & 0xff, (micro >> 8) & 0xff, micro & 0xff] },
    ];
    let tick = 0;
    let prev = null;
    chords.forEach((ch) => {
      const midi = M().voiceLead(ch, prev, 3);
      prev = midi;
      const dur = Math.max(1, Math.round((ch.duration || 4) * tpq));
      midi.forEach((n, i) => events.push({ tick, data: [0x90, n, i === 0 ? 95 : 72] }));
      midi.forEach((n) => events.push({ tick: tick + dur, data: [0x80, n, 0] }));
      tick += dur;
    });
    events.push({ tick, data: [0xff, 0x2f, 0x00] });
    events.sort((a, b) => a.tick - b.tick);
    const track = [];
    let last = 0;
    events.forEach((ev) => {
      let v = ev.tick - last;
      last = ev.tick;
      let buf = v & 0x7f;
      while ((v >>= 7)) {
        buf <<= 8;
        buf |= (v & 0x7f) | 0x80;
      }
      for (;;) {
        track.push(buf & 0xff);
        if (buf & 0x80) buf >>= 8;
        else break;
      }
      ev.data.forEach((b) => track.push(b));
    });
    const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (tpq >> 8) & 0xff, tpq & 0xff];
    const th = [
      0x4d, 0x54, 0x72, 0x6b,
      (track.length >> 24) & 0xff, (track.length >> 16) & 0xff, (track.length >> 8) & 0xff, track.length & 0xff,
    ];
    return new Uint8Array([...header, ...th, ...track]);
  }

  // ─── Render ──────────────────────────────────────────────
  function refreshAll() {
    refreshSequence();
    renderPacks();
    renderHorizonLists();
    refreshMap();
    updatePlayBtn();
  }

  function refreshUI() {
    refreshSequence();
    renderHorizonLists();
    refreshMap();
  }

  function refreshMap() {
    map.setOrigin(state.tonic, state.mode);
    map.setPath(state.chords, state.selected);
    map.setHorizon(buildHorizon());
  }

  function refreshSequence() {
    renderTitle();
    renderSlots();
    renderInspector();
  }

  function renderTitle() {
    const titleEl = $('#seq-title');
    // Editable cell name
    if (titleEl && titleEl.tagName === 'INPUT') {
      if (document.activeElement !== titleEl) titleEl.value = state.title;
    } else if (titleEl) {
      titleEl.textContent = state.title;
    }
    $('#seq-key').textContent = keyLabel();
    const badge = $('#canonical-badge');
    if (state.recognition && state.recognition.confidence >= 0.75) {
      badge.hidden = false;
      badge.textContent = state.recognition.exact
        ? 'Matches pack · ' + state.recognition.pack.name
        : 'Related · ' + state.recognition.pack.name;
      badge.className = 'badge' + (state.recognition.exact ? ' exact' : '');
    } else {
      badge.hidden = true;
    }
    const why = $('#seq-why');
    if (state.recognition && state.recognition.pack) {
      why.textContent = state.recognition.pack.why;
    } else {
      why.textContent = 'Enter chords or pick a feel. Horizon shows flavours, directions, cadences, and modulation.';
    }
    $('#path-text').textContent = state.chords.map((c) => c.name).join(' → ') || 'Empty — add a chord or load a feel';
  }

  function renderSlots() {
    const host = $('#slots');
    host.innerHTML = '';
    state.chords.forEach((ch, i) => {
      const el = document.createElement('div');
      el.className = 'slot' + (i === state.selected ? ' selected' : '');
      el.draggable = true;
      el.dataset.index = String(i);
      el.innerHTML = `
        <span class="grip" title="Drag to reorder">⋮⋮</span>
        <span class="n">${i + 1}</span>
        <span class="nm">${ch.name}</span>
        <span class="rm">${ch.roman || ''}</span>
        <span class="du">${ch.duration}b</span>
        <button type="button" class="x" title="Remove">×</button>
      `;
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('x')) return;
        state.selected = i;
        A().ensure();
        A().playChord({ chord: ch });
        refreshUI();
      });
      el.querySelector('.x').addEventListener('click', (e) => {
        e.stopPropagation();
        state.selected = i;
        removeSelected();
      });
      el.addEventListener('dragstart', (e) => {
        dragSlotIndex = i;
        el.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(i));
      });
      el.addEventListener('dragend', () => {
        el.classList.remove('dragging');
        dragSlotIndex = null;
        host.querySelectorAll('.slot').forEach((s) => s.classList.remove('drag-over'));
      });
      el.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        el.classList.add('drag-over');
      });
      el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        el.classList.remove('drag-over');
        const from = dragSlotIndex != null ? dragSlotIndex : parseInt(e.dataTransfer.getData('text/plain'), 10);
        const to = i;
        if (!isNaN(from)) reorderChord(from, to);
      });
      host.appendChild(el);
    });
  }

  function renderInspector() {
    const host = $('#inspector');
    const ch = state.chords[state.selected];
    if (!ch) {
      host.innerHTML = '<p class="hint">Select a chord — edit root, quality, duration, bass. Drag slots to reorder.</p>';
      return;
    }
    const tones = [...new Set([ch.root, ...(ch.notes || [])])];
    const bass = ch.bassPc != null ? ch.bassPc : ch.root;
    const rootOpts = M().NOTE_NAMES.map(
      (n, i) => `<option value="${i}"${i === ch.root ? ' selected' : ''}>${n}</option>`
    ).join('');
    const qOpts = Object.keys(M().QUALITIES)
      .map(
        (k) =>
          `<option value="${k}"${k === ch.quality ? ' selected' : ''}>${M().QUALITIES[k].symbol || M().QUALITIES[k].label || k}</option>`
      )
      .join('');
    host.innerHTML = `
      <div class="insp-name">${ch.name}</div>
      <div class="insp-row">
        <label class="field">Root
          <select id="insp-root">${rootOpts}</select>
        </label>
        <label class="field">Quality
          <select id="insp-q">${qOpts}</select>
        </label>
      </div>
      <label class="field">Duration (beats)
        <input type="range" id="dur" min="0.5" max="16" step="0.5" value="${ch.duration}" />
        <span id="dur-v">${ch.duration}</span>
      </label>
      <div class="dur-presets row" style="margin:0.35rem 0">
        ${[1, 2, 3, 4, 6, 8].map((b) => `<button type="button" class="chip dur-p" data-b="${b}">${b}</button>`).join('')}
      </div>
      <div class="field" style="margin-top:0.35rem">Bass</div>
      <div class="bass-row" id="bass-row"></div>
      <div class="row" style="margin-top:0.5rem">
        <button type="button" class="btn ghost" id="insp-dup">Duplicate</button>
        <button type="button" class="btn ghost" id="insp-up">↑</button>
        <button type="button" class="btn ghost" id="insp-dn">↓</button>
      </div>
    `;
    const row = host.querySelector('#bass-row');
    tones.forEach((pc) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (pc === bass ? ' on' : '');
      b.textContent = M().noteName(pc) + (pc === ch.root ? ' root' : '');
      b.addEventListener('click', () => setBass(pc));
      row.appendChild(b);
    });
    host.querySelector('#insp-root').addEventListener('change', (e) => {
      setSelectedRootQuality(parseInt(e.target.value, 10), ch.quality);
    });
    host.querySelector('#insp-q').addEventListener('change', (e) => {
      setSelectedRootQuality(ch.root, e.target.value);
    });
    const slider = host.querySelector('#dur');
    let durUndoArmed = false;
    slider.addEventListener('pointerdown', () => {
      durUndoArmed = true;
      pushUndo();
    });
    slider.addEventListener('input', () => {
      host.querySelector('#dur-v').textContent = slider.value;
      setDuration(parseFloat(slider.value), true);
    });
    host.querySelectorAll('.dur-p').forEach((btn) => {
      btn.addEventListener('click', () => setDuration(parseFloat(btn.dataset.b)));
    });
    host.querySelector('#insp-dup').addEventListener('click', duplicateSelected);
    host.querySelector('#insp-up').addEventListener('click', () => moveSelected(-1));
    host.querySelector('#insp-dn').addEventListener('click', () => moveSelected(1));
  }

  function renderPacks() {
    const filter = $('#feel-filter').value || 'all';
    const host = $('#pack-list');
    host.innerHTML = '';
    P().byFeel(filter).forEach((pack) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pack' + (state.fromPackId === pack.id ? ' active' : '');
      b.innerHTML = `<strong>${pack.name}</strong><span>${pack.feel} · ${pack.colour}</span><em>${pack.why}</em>`;
      b.addEventListener('click', () => loadPack(pack.id));
      host.appendChild(b);
    });
  }

  function renderHorizonLists() {
    const items = buildHorizon();
    const groups = {
      flavour: $('#list-flavour'),
      direction: $('#list-direction'),
      cadence: $('#list-cadence'),
      modulate: $('#list-modulate'),
    };
    Object.values(groups).forEach((el) => {
      if (el) el.innerHTML = '';
    });
    items.forEach((it) => {
      const host = groups[it.kind];
      if (!host) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'hz kind-' + it.kind;
      b.innerHTML = `<strong>${it.label}</strong><span>${it.job || it.chord.name}</span>`;
      b.addEventListener('mouseenter', () => {
        A().ensure();
        A().playChord({ chord: it.chord, soft: true, duration: 0.4 });
      });
      b.addEventListener('click', () => commitHorizon(it));
      host.appendChild(b);
    });
  }

  function wire() {
    $('#tonic').addEventListener('change', (e) => {
      const prev = state.tonic;
      const next = parseInt(e.target.value, 10);
      const delta = (next - prev + 12) % 12;
      if (delta && state.chords.length) {
        state.chords = state.chords.map((ch) => {
          let n = M().makeChord((ch.root + delta) % 12, ch.quality, {
            duration: ch.duration,
            roman: ch.roman,
            tag: ch.tag,
            region: ch.region,
          });
          if (ch.bassPc != null && C().withBass) {
            n = C().withBass(n, (ch.bassPc + delta) % 12);
            n.duration = ch.duration;
          }
          n.localTonic = next;
          n.localMode = state.mode;
          return n;
        });
      }
      state.tonic = next;
      map.setOrigin(state.tonic, state.mode);
      afterEdit();
    });
    $('#mode').addEventListener('change', (e) => {
      state.mode = e.target.value;
      afterEdit();
    });
    $('#bpm').addEventListener('change', (e) => {
      state.bpm = Math.max(40, Math.min(200, parseInt(e.target.value, 10) || 96));
    });
    $('#loop').addEventListener('change', (e) => {
      state.loop = e.target.checked;
      updatePlayBtn();
    });
    $('#pulse').addEventListener('change', (e) => {
      state.pulse = e.target.checked;
    });
    $('#feel-filter').addEventListener('change', renderPacks);
    const titleInput = $('#seq-title');
    if (titleInput && titleInput.tagName === 'INPUT') {
      titleInput.addEventListener('change', () => setCellName(titleInput.value));
      titleInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          titleInput.blur();
        }
      });
    }
    $('#btn-play').addEventListener('click', () => playSeq());
    if ($('#btn-add')) $('#btn-add').addEventListener('click', () => addChordFromPicker('end'));
    if ($('#btn-insert')) $('#btn-insert').addEventListener('click', () => addChordFromPicker('after'));
    if ($('#btn-dup')) $('#btn-dup').addEventListener('click', duplicateSelected);
    if ($('#btn-undo-edit')) $('#btn-undo-edit').addEventListener('click', undo);
    if ($('#btn-redo-edit')) $('#btn-redo-edit').addEventListener('click', redo);
    if ($('#btn-undo')) $('#btn-undo').addEventListener('click', undo);
    if ($('#btn-clear')) {
      $('#btn-clear').addEventListener('click', () => {
        if (!state.chords.length || confirm('Clear sequence?')) clearSeq();
      });
    }
    $('#btn-export-txt').addEventListener('click', exportText);
    $('#btn-export-mid').addEventListener('click', exportMidi);
    if ($('#btn-fret')) $('#btn-fret').addEventListener('click', sendToFretboard);
    if ($('#btn-pull-fb')) $('#btn-pull-fb').addEventListener('click', pullFromSharedSession);
    if ($('#btn-arrange')) {
      $('#btn-arrange').addEventListener('click', () => {
        if (S() && state.chords.length) pushToSharedSession('landscape');
        const url = S() ? S().PATHS.arrangementFromLandscape : '../arrangement/index.html';
        if (S() && S().goTo) S().goTo(url);
        else window.location.href = url;
      });
    }
    $('#btn-home').addEventListener('click', () => {
      map.setCameraMode('home');
      map.focusHome();
      syncCamButtons();
    });
    if ($('#cam-home')) {
      $('#cam-home').addEventListener('click', () => {
        map.setCameraMode('home');
        syncCamButtons();
      });
    }
    if ($('#cam-fit')) {
      $('#cam-fit').addEventListener('click', () => {
        map.setCameraMode('fit');
        syncCamButtons();
      });
    }
    if ($('#cam-follow')) {
      $('#cam-follow').addEventListener('click', () => {
        map.setCameraMode('follow');
        syncCamButtons();
      });
    }
    if ($('#btn-var-reharm')) $('#btn-var-reharm').addEventListener('click', () => createVariation('reharm'));
    if ($('#btn-var-parallel')) $('#btn-var-parallel').addEventListener('click', () => createVariation('parallel'));
    if ($('#btn-var-darken')) $('#btn-var-darken').addEventListener('click', () => createVariation('darken'));

    function syncCamButtons() {
      const mode = map.cameraMode || 'home';
      ['home', 'fit', 'follow'].forEach((m) => {
        const el = $('#cam-' + m);
        if (el) el.classList.toggle('active', mode === m);
      });
    }
    syncCamButtons();

    document.addEventListener('keydown', (e) => {
      if (e.target.matches('input, textarea, select')) return;
      if (e.key === ' ' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        playSeq();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault();
        duplicateSelected();
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        removeSelected();
      } else if (e.key === 'ArrowUp' && e.altKey) {
        e.preventDefault();
        moveSelected(-1);
      } else if (e.key === 'ArrowDown' && e.altKey) {
        e.preventDefault();
        moveSelected(1);
      } else if (e.key === 'ArrowLeft' && state.chords.length) {
        e.preventDefault();
        state.selected = Math.max(0, state.selected - 1);
        refreshUI();
        A().ensure();
        A().playChord({ chord: state.chords[state.selected] });
      } else if (e.key === 'ArrowRight' && state.chords.length) {
        e.preventDefault();
        state.selected = Math.min(state.chords.length - 1, state.selected + 1);
        refreshUI();
        A().ensure();
        A().playChord({ chord: state.chords[state.selected] });
      } else if (e.key === 'Escape') {
        A().stopPlayback();
        map.setPlaying(-1);
        updatePlayBtn();
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
