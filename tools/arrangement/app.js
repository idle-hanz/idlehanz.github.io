/**
 * Arrangement — form editor over shared IHSession song
 */
(function () {
  'use strict';

  const S = () => window.IHSession;
  const M = () => window.HLMusic;
  const A = () => window.HLAudio;
  const $ = (s) => document.querySelector(s);

  let song = null;
  let selectedSecId = null;
  let dragFrom = null;
  let playing = false;
  /** Flattened playback cursor */
  let playList = []; // { chord objects for audio + meta }
  let playIndex = -1;
  let playStartOffset = 0; // index into flat list when "from section"
  let playAccumBeats = 0;
  let playTotalBeats = 0;
  let formUndoStack = [];
  const FORM_UNDO_MAX = 40;

  const SECTION_NAMES = ['Intro', 'Verse', 'Chorus', 'Bridge', 'Outro', 'Break', 'Solo'];

  function snapshotSong() {
    try {
      return JSON.parse(JSON.stringify(song));
    } catch (_) {
      return null;
    }
  }

  function pushFormUndo() {
    const snap = snapshotSong();
    if (!snap) return;
    formUndoStack.push({ song: snap, selectedSecId: selectedSecId });
    if (formUndoStack.length > FORM_UNDO_MAX) formUndoStack.shift();
  }

  function undoForm() {
    if (!formUndoStack.length) {
      setStatus('Nothing to undo');
      return;
    }
    const prev = formUndoStack.pop();
    song = prev.song;
    selectedSecId = prev.selectedSecId;
    try {
      S().saveSong(song, 'arrangement-undo');
    } catch (_) {}
    if ($('#song-title')) $('#song-title').value = song.title || 'Untitled';
    if ($('#bpm')) $('#bpm').value = song.bpm || 96;
    render({ keepLocal: true });
    setStatus('Undid last form change');
  }

  function init() {
    if (!S()) {
      alert('ih-session.js missing — keep it on the Desktop next to arrangement/');
      return;
    }
    load();
    wire();
    render();
    // file:// diagnostics: confirm embedded packages are present
    if (location.protocol === 'file:') {
      const sop = !!window.__IDLEHANZ_SOP_PACKAGE__;
      const mk = !!window.__IDLEHANZ_MULTIKEY_PACKAGE__;
      if (!sop) {
        console.warn(
          'SoP embedded package missing — expected the-speed-of-pain.song.js next to index.html'
        );
      } else {
        console.info(
          'SoP package ready (file://):',
          window.__IDLEHANZ_SOP_PACKAGE__.title,
          (window.__IDLEHANZ_SOP_PACKAGE__.arrangement || []).length,
          'sections'
        );
      }
      if (!mk) {
        console.warn('Multi-key embedded package missing');
      }
      // If session is empty / untitled and SoP is available, offer a clear status hint
      if (
        sop &&
        song &&
        (!song.arrangement || !song.arrangement.length) &&
        Object.keys(song.cells || {}).length === 0
      ) {
        setStatus('Empty session · click “Load SoP full” (works offline / file://)');
      }
    }
  }

  function load() {
    song = S().loadSong();
    if (!song) {
      song = S().emptySong({ title: 'Untitled', bpm: 96, tonic: 11, mode: 'minor', updatedBy: 'arrangement' });
      // seed empty arrangement if landscape already has a cell
      S().saveSong(song, 'arrangement');
    }
    if (!song.arrangement) song.arrangement = [];
    if (!song.cells) song.cells = {};
    if (song.notes == null) song.notes = '';
    if (song.style == null) song.style = '';
    $('#song-title').value = song.title || 'Untitled';
    $('#bpm').value = song.bpm || 96;
    syncKeyUI();
    const notesEl = $('#song-notes');
    if (notesEl) notesEl.value = song.notes || '';
    updateKeyLabel();
    if (song.arrangement.length) selectedSecId = song.arrangement[0].id;
  }

  function save(by) {
    song.title = $('#song-title').value || 'Untitled';
    song.bpm = Math.max(40, Math.min(220, parseInt($('#bpm').value, 10) || 96));
    const notesEl = $('#song-notes');
    if (notesEl) song.notes = notesEl.value || '';
    const tEl = $('#song-tonic');
    const mEl = $('#song-mode');
    if (tEl && mEl) {
      song.key = song.key || {};
      song.key.tonic = parseInt(tEl.value, 10);
      if (isNaN(song.key.tonic)) song.key.tonic = 11;
      song.key.mode = mEl.value || 'minor';
    }
    S().ensureSongShape(song);
    S().saveSong(song, by || 'arrangement');
    setStatus('Saved · ' + (song.updatedAt || '').slice(11, 19));
  }

  function fillKeySelects() {
    const tEl = $('#song-tonic');
    if (!tEl || tEl.options.length) return;
    const names = M() ? M().NOTE_NAMES : ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    names.forEach((n, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = n;
      tEl.appendChild(o);
    });
  }

  function syncKeyUI() {
    fillKeySelects();
    const t = song.key && song.key.tonic != null ? song.key.tonic : 11;
    const mode = (song.key && song.key.mode) || 'minor';
    const tEl = $('#song-tonic');
    const mEl = $('#song-mode');
    if (tEl) tEl.value = String(t);
    if (mEl) mEl.value = mode;
  }

  function fretMax() {
    return (S() && S().FRETBOARD_MAX_CHORDS) || 8;
  }

  function cellFrettable(cell) {
    const n = (cell && cell.chords && cell.chords.length) || 0;
    return n > 0 && n <= fretMax();
  }

  function chordDisplayName(c) {
    if (!c) return '?';
    if (c.name) return c.name;
    const n = M() ? M().noteName(c.root) : String(c.root);
    const q = c.quality === 'maj' ? '' : c.quality === 'min' ? 'm' : c.quality || '';
    return n + q;
  }

  // --- Multi-key disk colours (home-relative hues) --- ───────────
  /** Pitch class → steps on circle of fifths from C (0=C, 1=G, …) */
  function fifthsIndex(pc) {
    const p = ((Number(pc) % 12) + 12) % 12;
    return (p * 7) % 12;
  }

  function homeTonic() {
    return song && song.key && song.key.tonic != null
      ? ((song.key.tonic % 12) + 12) % 12
      : 11;
  }

  /** Owning key disk for a session/flat chord */
  function chordKeyTonic(c) {
    if (c && c.localTonic != null) return ((c.localTonic % 12) + 12) % 12;
    return homeTonic();
  }

  function chordKeyMode(c) {
    if (c && c.localMode) return c.localMode;
    return (song && song.key && song.key.mode) || 'minor';
  }

  function keyLabel(tonic, mode) {
    const n = M() ? M().noteName(tonic) : String(tonic);
    const m = mode || 'minor';
    const short =
      m === 'major' || m === 'ionian'
        ? ''
        : m === 'minor' || m === 'harmonic' || m === 'melodic'
          ? 'm'
          : m.slice(0, 3);
    return n + short;
  }

  /**
   * Key-disk colours — distinct multi-cylinder read.
   * Home = warm gold; each fifths-step from home is a clear hue.
   */
  function keyHue(tonic) {
    const home = homeTonic();
    const rel = (fifthsIndex(tonic) - fifthsIndex(home) + 12) % 12;
    // gold, teal, violet, green, coral, magenta, cyan, amber, blue, lime, red, azure
    const hues = [42, 195, 285, 145, 18, 320, 170, 55, 240, 100, 0, 210];
    return hues[rel];
  }

  function keyColor(tonic, alpha) {
    const a = alpha != null ? alpha : 0.92;
    const h = keyHue(tonic);
    const home = homeTonic();
    const rel = (fifthsIndex(tonic) - fifthsIndex(home) + 12) % 12;
    const dist = Math.min(rel, 12 - rel);
    const sat = rel === 0 ? 60 : 54 - dist * 1.2;
    const lit = rel === 0 ? 58 : 54 + dist * 1.5;
    return 'hsla(' + h + ', ' + sat + '%, ' + lit + '%, ' + a + ')';
  }

  function keyColorSolid(tonic) {
    return keyColor(tonic, 1);
  }

  /** Hit targets for spiral canvas clicks */
  let spiralHits = [];
  let spiralRaf = 0;
  let spiralPlayRaf = 0;
  /** Cached geometry for smooth playhead / wheel without full rebuild thrash */
  let spiralCache = null;
  /** User zoom / pan for pipe view */
  let spiralZoom = 1;
  let spiralPanX = 0;
  let spiralPanY = 0;
  const SPIRAL_ZOOM_MIN = 0.45;
  const SPIRAL_ZOOM_MAX = 4.0;
  /** Drag state for pan */
  let spiralDrag = null; // { x0, y0, pan0x, pan0y, moved }

  function setStatus(msg) {
    const el = $('#sync-status');
    if (el) el.textContent = msg || '';
  }

  function updateKeyLabel() {
    const t = song.key && song.key.tonic != null ? song.key.tonic : 11;
    const mode = (song.key && song.key.mode) || 'minor';
    const name = M() ? M().noteName(t) : String(t);
    $('#key-label').textContent = name + ' ' + mode;
  }

  function cellBeats(cell) {
    if (!cell || !cell.chords) return 0;
    return cell.chords.reduce((s, c) => s + (c.duration || 4), 0);
  }

  function cellLabel(cell) {
    if (!cell || !cell.chords) return '—';
    return cell.chords
      .map((c) => {
        const n = M() ? M().noteName(c.root) : c.root;
        const q = c.quality === 'maj' ? '' : c.quality === 'min' ? 'm' : c.quality;
        return n + q;
      })
      .join('–');
  }

  function nextSectionName() {
    const used = song.arrangement.length;
    return SECTION_NAMES[used % SECTION_NAMES.length] + (used >= SECTION_NAMES.length ? ' ' + (used + 1) : '');
  }

  function addSection() {
    S().ensureSongShape(song);
    const cellIds = Object.keys(song.cells);
    const cellId = (song.focus && song.focus.cellId && song.cells[song.focus.cellId])
      ? song.focus.cellId
      : cellIds[0] || null;
    if (!cellId) {
      alert('No cells yet. Create one in Landscape first (or + New cell).');
      return;
    }
    pushFormUndo();
    const sec = {
      id: 'sec-' + Date.now().toString(36),
      name: nextSectionName(),
      cellId,
      chain: [cellId],
      reps: 1,
      endCellId: null,
      intoCellId: null,
      seam: S().defaultSeam(),
    };
    song.arrangement.push(sec);
    selectedSecId = sec.id;
    save();
    render();
  }

  function duplicateSection() {
    const sec = song.arrangement.find((s) => s.id === selectedSecId);
    if (!sec) {
      alert('Select a section first.');
      return;
    }
    pushFormUndo();
    const copy = {
      id: 'sec-' + Date.now().toString(36),
      name: (sec.name || 'Section') + ' copy',
      cellId: sec.cellId,
      chain: (sec.chain || [sec.cellId]).slice(),
      reps: sec.reps || 1,
      endCellId: sec.endCellId || null,
      intoCellId: sec.intoCellId || null,
      seam: sec.seam
        ? {
            type: sec.seam.type || 'none',
            chords: (sec.seam.chords || []).map((c) => Object.assign({}, c)),
          }
        : S().defaultSeam(),
    };
    const idx = song.arrangement.indexOf(sec);
    song.arrangement.splice(idx + 1, 0, copy);
    selectedSecId = copy.id;
    save();
    render();
    setStatus('Duplicated section · ' + copy.name);
  }

  function duplicateCell(cellId) {
    const src = song.cells[cellId];
    if (!src) return;
    const id = S().newCellId('cell');
    song.cells[id] = {
      id,
      name: (src.name || 'Cell') + ' copy',
      packId: src.packId || null,
      familyId: null,
      versionIndex: 1,
      chords: (src.chords || []).map((c) => Object.assign({}, c, { notes: (c.notes || []).slice() })),
    };
    song.focus = { cellId: id, sectionId: selectedSecId, chordIndex: 0 };
    save();
    render();
    setStatus('Duplicated cell · ' + song.cells[id].name);
  }

  function varyCell(cellId) {
    if (!S().createVariation) {
      alert('ih-session.js missing createVariation.');
      return;
    }
    const newId = S().createVariation(song, cellId, {});
    if (!newId) {
      alert('Could not create variation.');
      return;
    }
    song.focus = { cellId: newId, sectionId: selectedSecId, chordIndex: 0 };
    save();
    render();
    setStatus('Variation · ' + (song.cells[newId].name || newId));
  }

  function importHlAsCell(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const data = JSON.parse(String(reader.result || ''));
        let chords = data.chords;
        if (!chords && data.cell && data.cell.chords) chords = data.cell.chords;
        if (!Array.isArray(chords) || !chords.length) {
          alert('No chords in file.');
          return;
        }
        const id = S().newCellId('cell');
        const name = (data.title || data.cellName || file.name.replace(/\.json$/i, '') || 'Imported').slice(0, 48);
        song.cells[id] = {
          id,
          name,
          packId: data.fromPackId || data.packId || null,
          familyId: null,
          versionIndex: 1,
          chords: chords.map((c) => {
            if (S().fromLandscapeChord) return S().fromLandscapeChord(c);
            return Object.assign({}, c);
          }),
        };
        if (data.tonic != null || (data.key && data.key.tonic != null)) {
          song.key = song.key || {};
          song.key.tonic = data.tonic != null ? data.tonic : data.key.tonic;
          song.key.mode = data.mode || (data.key && data.key.mode) || song.key.mode || 'minor';
        }
        if (data.bpm != null) song.bpm = data.bpm;
        song.focus = { cellId: id, sectionId: null, chordIndex: 0 };
        $('#song-title').value = song.title || 'Untitled';
        $('#bpm').value = song.bpm || 96;
        syncKeyUI();
        updateKeyLabel();
        save();
        render();
        const n = chords.length;
        setStatus(
          'Imported “' +
            name +
            '” · ' +
            n +
            ' chords' +
            (n > fretMax() ? ' · Fretboard will clip to ' + fretMax() : '')
        );
      } catch (err) {
        console.error(err);
        alert('Import failed: ' + (err && err.message ? err.message : 'bad JSON'));
      }
    };
    reader.readAsText(file);
  }

  function newCell() {
    pushFormUndo();
    const id = S().newCellId('cell');
    const name = 'Cell ' + (Object.keys(song.cells).length + 1);
    song.cells[id] = { id, name, packId: null, familyId: null, versionIndex: 1, chords: [] };
    song.focus = { cellId: id, sectionId: null, chordIndex: 0 };
    save();
    openLandscapeForCell(id, name);
    render();
  }

  /** Chain all family versions into selected section (v1→v2→…). */
  function chainFamilyIntoSection() {
    const sec = song.arrangement.find((s) => s.id === selectedSecId);
    if (!sec) {
      alert('Select a section first.');
      return;
    }
    const primary = sec.chain && sec.chain[0] ? sec.chain[0] : sec.cellId;
    const cell = song.cells[primary];
    if (!cell) return;
    if (!cell.familyId) {
      alert('This cell has no linked versions yet. In Landscape use “+ Vary …” to create v2.');
      return;
    }
    pushFormUndo();
    const vers = S().familyVersions(song, cell.familyId);
    S().setSectionChain(
      sec,
      vers.map((v) => v.id)
    );
    save();
    render();
    setStatus('Section plays ' + vers.map((v) => v.name).join(' → '));
  }

  function setSeamType(secId, type) {
    const sec = song.arrangement.find((s) => s.id === secId);
    if (!sec) return;
    pushFormUndo();
    if (!sec.seam) sec.seam = S().defaultSeam();
    sec.seam.type = type;
    if (type === 'turnaround') {
      const chain = S().sectionChain(sec);
      const next = song.arrangement[song.arrangement.indexOf(sec) + 1];
      const cellA = song.cells[chain[chain.length - 1]];
      const chainB = next ? S().sectionChain(next) : [];
      const cellB = chainB[0] ? song.cells[chainB[0]] : null;
      const fromCh = cellA && cellA.chords[cellA.chords.length - 1];
      const toCh = cellB && cellB.chords[0];
      sec.seam.chords = S().suggestSeamChords(fromCh, toCh, song.key);
    } else {
      sec.seam.chords = [];
    }
    save();
    render();
  }

  function lastChordOfSection(sec) {
    if (!sec) return null;
    const reps = Math.max(1, +(sec.reps || 1));
    const lastId =
      sec.endCellId ||
      (S().sectionRepChain
        ? S().sectionRepChain(sec, reps - 1, reps)[0]
        : null) ||
      (S().sectionChain(sec).slice(-1)[0]);
    const cell = lastId && song.cells[lastId];
    if (!cell || !cell.chords || !cell.chords.length) return null;
    return cell.chords[cell.chords.length - 1];
  }

  function firstChordOfSection(sec) {
    if (!sec) return null;
    const id = (S().sectionChain(sec) || [])[0] || sec.cellId;
    const cell = id && song.cells[id];
    if (!cell || !cell.chords || !cell.chords.length) return null;
    return cell.chords[0];
  }

  function hearSeam(sec, next) {
    if (!A() || !M()) return;
    const from = lastChordOfSection(sec);
    const to = firstChordOfSection(next);
    const seam = sec.seam || {};
    const mid =
      seam.type === 'none' || seam.type === 'smooth'
        ? []
        : seam.chords && seam.chords.length
          ? seam.chords
          : S().suggestSeamChords
            ? S().suggestSeamChords(from, to, song.key)
            : [];
    const seq = [];
    if (from) seq.push(sessionChordToPlayable(from));
    mid.forEach(function (c) {
      seq.push(sessionChordToPlayable(c));
    });
    if (to) seq.push(sessionChordToPlayable(to));
    if (!seq.length) return;
    seq.forEach(function (c) {
      c.duration = Math.min(2, c.duration || 2);
    });
    A().ensure();
    if (A().stopPlayback) A().stopPlayback();
    A().playSequence(seq, Math.max(song.bpm || 96, 90), { pulse: false, loop: false });
    setStatus(
      'Hear seam · ' +
        seq.map(function (c) {
          return c.name;
        }).join(' → ')
    );
  }

  /** Remove a cell from the library; sections using it are cleaned up. */
  function deleteCell(cellId) {
    const cell = song.cells[cellId];
    if (!cell) return;
    const used = (song.arrangement || []).filter(
      (s) =>
        s.cellId === cellId ||
        (s.chain && s.chain.indexOf(cellId) >= 0) ||
        s.endCellId === cellId ||
        s.intoCellId === cellId
    );
    const label = cell.name || cellId;
    let msg = 'Delete cell “' + label + '”?';
    if (used.length) {
      msg +=
        '\n\nIt is used in ' +
        used.length +
        ' section(s): ' +
        used.map((s) => s.name).join(', ') +
        '.\nEmpty sections will be removed from the form.';
    }
    if (!confirm(msg)) return;
    pushFormUndo();

    if (S().deleteCell) {
      const result = S().deleteCell(song, cellId, {});
      if (!result || !result.ok) return;
      if (selectedSecId && !song.arrangement.find((s) => s.id === selectedSecId)) {
        selectedSecId = song.arrangement[0] ? song.arrangement[0].id : null;
      }
      save();
      render();
      setStatus('Deleted “' + (result.label || label) + '”');
      return;
    }

    // Fallback if older ih-session without deleteCell
    delete song.cells[cellId];
    Object.keys(song.families || {}).forEach((fid) => {
      const fam = song.families[fid];
      if (fam.versionIds) fam.versionIds = fam.versionIds.filter((id) => id !== cellId);
    });
    song.arrangement = (song.arrangement || []).filter((s) => {
      if (s.chain) s.chain = s.chain.filter((id) => id !== cellId);
      if (s.cellId === cellId) s.cellId = s.chain && s.chain[0] ? s.chain[0] : null;
      return s.cellId || (s.chain && s.chain.length);
    });
    if (selectedSecId && !song.arrangement.find((s) => s.id === selectedSecId)) {
      selectedSecId = song.arrangement[0] ? song.arrangement[0].id : null;
    }
    if (song.focus && song.focus.cellId === cellId) {
      const remaining = Object.keys(song.cells);
      song.focus.cellId = remaining[0] || null;
      song.focus.chordIndex = 0;
    }
    save();
    render();
    setStatus('Deleted “' + label + '”');
  }

  function renameCell(cellId, newName) {
    const cell = song.cells[cellId];
    if (!cell) return;
    const n = String(newName || '').trim();
    if (!n) return;
    if (S() && S().applyUserCellName) {
      const before = cell.name;
      S().applyUserCellName(song, cell, n);
      if (cell.name === before && S().stripLineageFromName(before) === S().stripLineageFromName(n)) {
        return;
      }
    } else {
      if (n === cell.name) return;
      const clash = Object.keys(song.cells).some(
        (id) => id !== cellId && (song.cells[id].name || '').toLowerCase() === n.toLowerCase()
      );
      cell.name = clash ? n + ' · ' + cellId.slice(-4) : n;
    }
    save();
    render();
    setStatus('Renamed · ' + cell.name);
  }

  function openLandscapeForCell(cellId, cellName) {
    song.focus = { cellId, sectionId: selectedSecId, chordIndex: 0 };
    save();
    const cell = song.cells[cellId];
    const payload = S().buildHandoffPayload({
      by: 'arrangement',
      to: 'landscape',
      title: song.title,
      bpm: song.bpm,
      key: song.key,
      cellId,
      cellName: cellName || (cell && cell.name) || 'Cell',
      focus: 0,
      sectionId: selectedSecId,
      chords: (cell && cell.chords) || [],
    });
    S().openWithHandoff(S().PATHS.landscapeFromArrangement, payload);
  }

  function openFretboardForCell(cellId) {
    const cell = song.cells[cellId];
    if (!cell || !cell.chords || !cell.chords.length) {
      alert('This cell has no chords yet. Edit it in Landscape first.');
      return;
    }
    song.focus = { cellId, sectionId: selectedSecId, chordIndex: 0 };
    save();
    const focusAt =
      song.focus && song.focus.cellId === cellId ? song.focus.chordIndex || 0 : 0;
    const clip = S().clipForFretboard
      ? S().clipForFretboard(cell.chords, { focus: focusAt })
      : {
          chords: cell.chords.slice(0, 8),
          truncated: cell.chords.length > 8,
          total: cell.chords.length,
          max: 8,
          start: 0,
        };
    if (clip.truncated) {
      const msg = S().fretboardClipMessage
        ? S().fretboardClipMessage(clip)
        : 'Fretboard max 8 · sending first 8 of ' + clip.total;
      setStatus(msg);
    }
    const payload = S().buildHandoffPayload({
      by: 'arrangement',
      to: 'fretboard',
      title: song.title,
      bpm: song.bpm,
      key: song.key,
      cellId,
      cellName: cell.name,
      focus: Math.max(0, focusAt - (clip.start || 0)),
      sectionId: selectedSecId,
      ephemeral: true,
      clipStart: clip.start || 0,
      chords: clip.chords,
    });
    S().openWithHandoff(S().PATHS.fretboardFromArrangement, payload);
  }

  function saveSongPackage() {
    if (!S().exportSongPackage) {
      alert('Update ih-session.js for song package export.');
      return;
    }
    save();
    const pkg = S().exportSongPackage(song);
    const text = JSON.stringify(pkg, null, 2);
    const name = (song.title || 'song').replace(/[^\w\-]+/g, '-').toLowerCase() + '.song.json';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    if ($('#export-out')) $('#export-out').value = text;
    setStatus('Song package saved · ' + name);
  }

  /**
   * Hydrate a .song.json package even if IHSession.importSongPackage is old/missing.
   */
  function hydrateSongPackage(data, by) {
    if (!data || typeof data !== 'object') return null;
    if (S().importSongPackage) {
      const imported = S().importSongPackage(data, { by: by || 'import' });
      if (imported) return imported;
    }
    // Local fallback — same shape as session importer
    const isPkg =
      data.format === 'idlehanz-song-package' ||
      (data.cells && data.arrangement && !data.chords);
    if (!isPkg) return null;
    const next = {
      version: 1,
      title: data.title || 'Untitled',
      bpm: data.bpm != null ? data.bpm : 96,
      key: data.key
        ? { tonic: data.key.tonic, mode: data.key.mode || 'minor' }
        : { tonic: 11, mode: 'minor' },
      notes: data.notes || '',
      style: data.style || '',
      updatedAt: new Date().toISOString(),
      updatedBy: by || 'import',
      cells: data.cells || {},
      families: data.families || {},
      arrangement: data.arrangement || [],
      focus: data.focus || { cellId: null, sectionId: null, chordIndex: 0 },
    };
    return S().ensureSongShape ? S().ensureSongShape(next) : next;
  }

  function loadSongPackageFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const raw = String(reader.result || '');
        // Strip BOM if present (some editors add it)
        const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
        const data = JSON.parse(text);
        if (!applySongPackage(data, 'arrangement-file', 'Loaded ' + (file.name || 'song'))) {
          // applySongPackage already alerted
        }
      } catch (err) {
        console.error(err);
        alert('Load failed: ' + (err && err.message ? err.message : 'bad JSON'));
      }
    };
    reader.onerror = function () {
      alert('Could not read file: ' + (file.name || 'unknown'));
    };
    reader.readAsText(file);
  }

  /** Apply any song package object into the arranger session + UI */
  function applySongPackage(data, by, statusLabel) {
    try {
      const hasWork =
        song &&
        ((song.arrangement && song.arrangement.length) ||
          Object.keys(song.cells || {}).length);
      if (hasWork) {
        if (
          !confirm(
            'Replace the current song with “' +
              ((data && data.title) || 'this package') +
              '”?\n\nThis overwrites the session. Save a .song.json first if you need it.'
          )
        ) {
          return false;
        }
      }
      if (playing) {
        try {
          stopPlay();
        } catch (eStop) {
          playing = false;
        }
      }
      const imported = hydrateSongPackage(data, by || 'import');
      if (!imported) {
        alert(
          'Not a song package.\nNeed format “idlehanz-song-package” (or cells + arrangement).\n\nUse Load song / Load SoP full — not Import .hl.json.'
        );
        return false;
      }
      // Stamp a fresh updatedAt so render() won't clobber with older storage
      imported.updatedAt = new Date().toISOString();
      imported.updatedBy = by || 'import';
      if (data && data.notes) imported.notes = data.notes;
      if (data && data.style) imported.style = data.style;

      song = imported;
      selectedSecId = song.arrangement[0] ? song.arrangement[0].id : null;
      if (song.focus && song.focus.sectionId) {
        const focusSec = song.arrangement.find((s) => s.id === song.focus.sectionId);
        if (focusSec) selectedSecId = focusSec.id;
      }

      let saved = false;
      try {
        saved = !!S().saveSong(song, by || 'import');
      } catch (eSave) {
        console.warn('saveSong threw', eSave);
        saved = false;
      }

      // UI fields
      if ($('#song-title')) $('#song-title').value = song.title || 'Untitled';
      if ($('#bpm')) $('#bpm').value = song.bpm || 96;
      const notesEl = $('#song-notes');
      if (notesEl) notesEl.value = song.notes || '';
      try {
        syncKeyUI();
        updateKeyLabel();
      } catch (eKey) {
        console.warn(eKey);
      }

      // Force pipe redraw from new flatten (don't re-pull stale storage over us)
      spiralCache = null;
      spiralZoom = 1;
      spiralPanX = 0;
      spiralPanY = 0;
      if ($('#spiral-zoom-label')) $('#spiral-zoom-label').textContent = '100%';
      render({ keepLocal: true });
      // Second paint after layout settles (canvas size can be 0 on first pass)
      requestAnimationFrame(function () {
        try {
          render({ keepLocal: true });
        } catch (e2) {
          console.error(e2);
        }
      });

      const nSec = (song.arrangement || []).length;
      const nCell = Object.keys(song.cells || {}).length;
      let nFlat = 0;
      try {
        nFlat = S().flattenArrangement(song).length;
      } catch (eFlat) {
        console.warn(eFlat);
      }
      const label =
        (statusLabel || 'Loaded') +
        ' · ' +
        (song.title || 'Untitled') +
        ' · ' +
        nSec +
        ' sections · ' +
        nCell +
        ' cells · ' +
        nFlat +
        ' flat chords' +
        (saved ? '' : ' · (session not saved)');
      setStatus(label);
      // Also flash title so it's obvious load worked under file://
      try {
        document.title = (song.title || 'Arrangement') + ' • Idle Hanz';
      } catch (_) {}
      if (nFlat === 0) {
        alert(
          'Song loaded but flatten is empty.\nCheck that section cellIds match cells in the package.'
        );
      }
      return true;
    } catch (err) {
      console.error(err);
      alert(
        'Apply song failed: ' +
          (err && err.message ? err.message : String(err)) +
          '\n\nOpen DevTools (F12) Console for details.'
      );
      return false;
    }
  }

  function fetchSongPackage(urls, onFail, statusLabel, by) {
    let i = 0;
    function next() {
      if (i >= urls.length) {
        if (onFail) onFail();
        return;
      }
      const url = urls[i++];
      fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error('no');
          return r.json();
        })
        .then((data) => applySongPackage(data, by, statusLabel))
        .catch(() => next());
    }
    try {
      next();
    } catch (_) {
      if (onFail) onFail();
    }
  }

  /** Load reference SoP package — works under file:// via embedded script (no fetch). */
  function loadSpeedOfPainDemo() {
    // 1) Embedded JS (the-speed-of-pain.song.js) — reliable on Desktop file://
    if (window.__IDLEHANZ_SOP_PACKAGE__) {
      const ok = applySongPackage(
        window.__IDLEHANZ_SOP_PACKAGE__,
        'sop-demo',
        'Loaded SoP full'
      );
      if (ok) return;
    }
    // 2) Try fetch (http(s) only — Chromium blocks fetch of local JSON under file://)
    const tryUrls = [
      './the-speed-of-pain.song.json',
      '../the-speed-of-pain.song.json',
      '../Downloads/the-speed-of-pain.song.json',
    ];
    function applyPkg(data, via) {
      applySongPackage(
        data,
        'sop-demo',
        via === 'embed' ? 'Loaded SoP (compact fallback)' : 'Loaded SoP full'
      );
    }
    function failBuild() {
      console.warn(
        'SoP embedded package missing and fetch failed. Using compact buildSpeedOfPainPackage().'
      );
      applyPkg(buildSpeedOfPainPackage(), 'embed');
    }
    if (typeof fetch !== 'function' || location.protocol === 'file:') {
      // Don't even try fetch on file:// — it always fails in Chrome/Edge
      failBuild();
      return;
    }
    let i = 0;
    function next() {
      if (i >= tryUrls.length) {
        failBuild();
        return;
      }
      const url = tryUrls[i++];
      fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error('no');
          return r.json();
        })
        .then(function (data) {
          applyPkg(data, 'fetch');
        })
        .catch(() => next());
    }
    try {
      next();
    } catch (_) {
      failBuild();
    }
  }

  function sc(root, quality, duration, extra) {
    const o = {
      root: root,
      quality: quality,
      duration: duration != null ? duration : 2,
      bass: root,
      roman: '',
      region: 'diatonic',
      tag: 'sop',
      localTonic: 4,
      localMode: 'minor',
    };
    if (extra) {
      Object.assign(o, extra);
      // extras may set localTonic / localMode / notes
    }
    return o;
  }

  /**
   * Compact fallback if the-speed-of-pain.song.json cannot be fetched (file://).
   * Prefer the full Desktop package (9 sections, 12 cells).
   */
  
  /** Multi-key cylinders demo: Em → G → C → Em with clear localTonic stamps */
  function loadMultiKeyDemo() {
    if (window.__IDLEHANZ_MULTIKEY_PACKAGE__) {
      if (
        applySongPackage(
          window.__IDLEHANZ_MULTIKEY_PACKAGE__,
          'multikey-demo',
          'Loaded multi-key cylinders'
        )
      ) {
        return;
      }
    }
    if (location.protocol === 'file:') {
      alert(
        'Multi-key package not embedded.\nReload after ensuring multi-key-cylinders.song.js sits next to index.html.'
      );
      return;
    }
    const tryUrls = [
      './multi-key-cylinders.song.json',
      '../multi-key-cylinders.song.json',
      '../Desktop/multi-key-cylinders.song.json',
    ];
    fetchSongPackage(
      tryUrls,
      function () {
        alert(
          'Could not load multi-key-cylinders.song.json.\nKeep it next to arrangement/ or on the Desktop.'
        );
      },
      'Loaded multi-key cylinders',
      'multikey-demo'
    );
  }
  function buildSpeedOfPainPackage() {
    // Minimal embedded long-form core (still uses end/into/seam patterns)
    return {
      format: 'idlehanz-song-package',
      version: 1,
      title: 'the speed of pain',
      bpm: 96,
      key: { tonic: 4, mode: 'minor' },
      notes: 'Multi-key disks: Em home · C major colour · G major bridge. Spiral = localTonic colours.',
      style: 'goth',
      cells: {
        'cell-sop-loop': {
          id: 'cell-sop-loop',
          name: 'SoP Loop',
          familyId: 'fam-sop-verse',
          versionIndex: 1,
          chords: [
            sc(4, 'min', 2, { roman: 'i', name: 'Em', notes: [4, 7, 11], localTonic: 4, localMode: 'minor' }),
            sc(9, 'sus4', 2, { roman: 'iv', region: 'flavour', name: 'Asus4', notes: [9, 2, 4], localTonic: 4, localMode: 'minor' }),
            sc(4, 'min', 2, { roman: 'i', name: 'Em', notes: [4, 7, 11], localTonic: 4, localMode: 'minor' }),
            sc(9, 'sus4', 2, { roman: 'iv', region: 'flavour', name: 'Asus4', notes: [9, 2, 4], localTonic: 4, localMode: 'minor' }),
          ],
        },
        'cell-sop-end': {
          id: 'cell-sop-end',
          name: 'SoP End',
          familyId: 'fam-sop-verse',
          versionIndex: 2,
          chords: [
            sc(4, 'min', 2, { roman: 'i', name: 'Em', notes: [4, 7, 11], localTonic: 4, localMode: 'minor' }),
            sc(7, 'maj', 2, { roman: 'bIII', name: 'G', notes: [7, 11, 2], localTonic: 4, localMode: 'minor' }),
            sc(6, 'maj', 2, { roman: 'II', region: 'flavour', name: 'F#', notes: [6, 10, 1], localTonic: 4, localMode: 'minor' }),
            sc(4, 'min', 2, { roman: 'i', name: 'Em', notes: [4, 7, 11], localTonic: 4, localMode: 'minor' }),
          ],
        },
        'cell-sop-into-colour': {
          id: 'cell-sop-into-colour',
          name: 'SoP Into Colour',
          familyId: 'fam-sop-verse',
          versionIndex: 3,
          chords: [
            sc(9, 'sus4', 2, { name: 'Asus4', notes: [9, 2, 4], localTonic: 0, localMode: 'major' }),
            sc(4, 'min', 2, { name: 'Em', notes: [4, 7, 11], localTonic: 0, localMode: 'major' }),
            sc(9, 'sus4', 2, { name: 'Asus4', notes: [9, 2, 4], localTonic: 0, localMode: 'major' }),
            sc(0, 'add9', 2, { name: 'Cadd9', notes: [0, 4, 7, 2], localTonic: 0, localMode: 'major' }),
          ],
        },
        'cell-sop-colour': {
          id: 'cell-sop-colour',
          name: 'SoP Colour',
          familyId: 'fam-sop-colour',
          versionIndex: 1,
          chords: [
            sc(0, 'add9', 2, { name: 'Cadd9', notes: [0, 4, 7, 2], localTonic: 0, localMode: 'major' }),
            sc(9, 'sus4', 2, { name: 'Asus4', notes: [9, 2, 4], localTonic: 0, localMode: 'major' }),
            sc(0, 'add9', 2, { name: 'Cadd9', notes: [0, 4, 7, 2], localTonic: 0, localMode: 'major' }),
            sc(9, 'sus4', 2, { name: 'Asus4', notes: [9, 2, 4], localTonic: 0, localMode: 'major' }),
          ],
        },
        'cell-sop-colour-end': {
          id: 'cell-sop-colour-end',
          name: 'SoP Colour End',
          familyId: 'fam-sop-colour',
          versionIndex: 2,
          chords: [
            sc(0, 'add9', 2, { name: 'Cadd9', notes: [0, 4, 7, 2], localTonic: 0, localMode: 'major' }),
            sc(9, 'sus4', 2, { name: 'Asus4', notes: [9, 2, 4], localTonic: 0, localMode: 'major' }),
            sc(4, 'min', 2, { name: 'Em', notes: [4, 7, 11], localTonic: 0, localMode: 'major' }),
            sc(0, 'maj', 2, { name: 'C', notes: [0, 4, 7], localTonic: 0, localMode: 'major' }),
          ],
        },
        'cell-sop-bridge': {
          id: 'cell-sop-bridge',
          name: 'SoP Bridge',
          familyId: null,
          versionIndex: 1,
          chords: [
            sc(7, 'maj', 2, { name: 'G', notes: [7, 11, 2], localTonic: 7, localMode: 'major' }),
            sc(6, 'maj', 2, { name: 'F#', notes: [6, 10, 1], localTonic: 7, localMode: 'major' }),
            sc(4, 'min', 2, { name: 'Em', notes: [4, 7, 11], localTonic: 7, localMode: 'major' }),
            sc(9, 'sus4', 2, { name: 'Asus4', notes: [9, 2, 4], localTonic: 7, localMode: 'major' }),
            sc(4, 'min', 2, { name: 'Em', notes: [4, 7, 11], localTonic: 7, localMode: 'major' }),
            sc(7, 'maj', 2, { name: 'G', notes: [7, 11, 2], localTonic: 7, localMode: 'major' }),
            sc(6, 'maj', 2, { name: 'F#', notes: [6, 10, 1], localTonic: 7, localMode: 'major' }),
            sc(4, 'min', 2, { name: 'Em', notes: [4, 7, 11], localTonic: 7, localMode: 'major' }),
          ],
        },
        'cell-sop-refrain': {
          id: 'cell-sop-refrain',
          name: 'SoP Refrain',
          familyId: 'fam-sop-outro',
          versionIndex: 1,
          chords: [
            sc(4, 'min', 2, { name: 'Em', notes: [4, 7, 11] }),
            sc(0, 'maj', 2, { name: 'C', notes: [0, 4, 7] }),
            sc(4, 'min', 2, { name: 'Em', notes: [4, 7, 11] }),
            sc(0, 'maj', 2, { name: 'C', notes: [0, 4, 7] }),
          ],
        },
        'cell-sop-into-outro': {
          id: 'cell-sop-into-outro',
          name: 'SoP Into Outro',
          familyId: 'fam-sop-outro',
          versionIndex: 2,
          chords: [
            sc(0, 'add9', 2, { name: 'Cadd9', notes: [0, 4, 7, 2] }),
            sc(9, 'sus4', 2, { name: 'Asus4', notes: [9, 2, 4] }),
            sc(4, 'min', 4, { name: 'Em', notes: [4, 7, 11] }),
          ],
        },
        'cell-sop-outro': {
          id: 'cell-sop-outro',
          name: 'SoP Outro',
          familyId: 'fam-sop-outro',
          versionIndex: 3,
          chords: [
            sc(4, 'min', 2, { name: 'Em', notes: [4, 7, 11] }),
            sc(0, 'maj', 2, { name: 'C', notes: [0, 4, 7] }),
            sc(4, 'min', 2, { name: 'Em', notes: [4, 7, 11] }),
            sc(0, 'maj', 2, { name: 'C', notes: [0, 4, 7] }),
          ],
        },
        'cell-sop-outro-hold': {
          id: 'cell-sop-outro-hold',
          name: 'SoP Outro Hold',
          familyId: 'fam-sop-outro',
          versionIndex: 4,
          chords: [
            sc(4, 'min', 4, { name: 'Em', notes: [4, 7, 11] }),
            sc(4, 'min', 4, { name: 'Em', notes: [4, 7, 11] }),
            sc(4, 'min', 8, { name: 'Em', notes: [4, 7, 11] }),
          ],
        },
        'cell-sop-intro': {
          id: 'cell-sop-intro',
          name: 'SoP Intro',
          familyId: null,
          versionIndex: 1,
          chords: [
            sc(4, 'min', 2, { name: 'Em', notes: [4, 7, 11] }),
            sc(9, 'sus4', 2, { name: 'Asus4', notes: [9, 2, 4] }),
            sc(4, 'min', 2, { name: 'Em', notes: [4, 7, 11] }),
            sc(9, 'sus4', 2, { name: 'Asus4', notes: [9, 2, 4] }),
          ],
        },
      },
      families: {
        'fam-sop-verse': {
          id: 'fam-sop-verse',
          name: 'SoP Verse',
          versionIds: ['cell-sop-loop', 'cell-sop-end', 'cell-sop-into-colour'],
        },
        'fam-sop-colour': {
          id: 'fam-sop-colour',
          name: 'SoP Colour',
          versionIds: ['cell-sop-colour', 'cell-sop-colour-end'],
        },
        'fam-sop-outro': {
          id: 'fam-sop-outro',
          name: 'SoP Outro',
          versionIds: ['cell-sop-refrain', 'cell-sop-into-outro', 'cell-sop-outro', 'cell-sop-outro-hold'],
        },
      },
      arrangement: [
        { id: 'sec-intro', name: 'Intro', cellId: 'cell-sop-intro', chain: ['cell-sop-intro'], reps: 2, endCellId: null, intoCellId: null, seam: { type: 'smooth', chords: [] } },
        { id: 'sec-verse-1', name: 'Verse 1', cellId: 'cell-sop-loop', chain: ['cell-sop-loop'], reps: 3, endCellId: 'cell-sop-end', intoCellId: 'cell-sop-into-colour', seam: { type: 'none', chords: [] } },
        { id: 'sec-colour-1', name: 'Colour 1', cellId: 'cell-sop-colour', chain: ['cell-sop-colour'], reps: 2, endCellId: 'cell-sop-colour-end', intoCellId: null, seam: { type: 'smooth', chords: [] } },
        { id: 'sec-verse-2', name: 'Verse 2', cellId: 'cell-sop-loop', chain: ['cell-sop-loop'], reps: 2, endCellId: 'cell-sop-end', intoCellId: null, seam: { type: 'turnaround', chords: [{ root: 7, quality: 'dom7', duration: 2, bass: 7, roman: 'V7→', region: 'secondary', tag: 'seam' }] } },
        { id: 'sec-bridge', name: 'Bridge', cellId: 'cell-sop-bridge', chain: ['cell-sop-bridge'], reps: 1, endCellId: null, intoCellId: 'cell-sop-into-colour', seam: { type: 'none', chords: [] } },
        { id: 'sec-colour-2', name: 'Colour 2', cellId: 'cell-sop-colour', chain: ['cell-sop-colour'], reps: 1, endCellId: 'cell-sop-colour-end', intoCellId: null, seam: { type: 'smooth', chords: [] } },
        { id: 'sec-refrain', name: 'Refrain', cellId: 'cell-sop-refrain', chain: ['cell-sop-refrain'], reps: 2, endCellId: null, intoCellId: null, seam: { type: 'none', chords: [] } },
        { id: 'sec-verse-3', name: 'Verse 3', cellId: 'cell-sop-loop', chain: ['cell-sop-loop'], reps: 2, endCellId: 'cell-sop-end', intoCellId: 'cell-sop-into-outro', seam: { type: 'smooth', chords: [] } },
        { id: 'sec-outro', name: 'Outro', cellId: 'cell-sop-outro', chain: ['cell-sop-outro'], reps: 2, endCellId: 'cell-sop-outro-hold', intoCellId: null, seam: { type: 'none', chords: [] } },
      ],
      focus: { cellId: 'cell-sop-loop', sectionId: 'sec-verse-1', chordIndex: 0 },
    };
  }

  function selectSection(id) {
    selectedSecId = id;
    const sec = song.arrangement.find((s) => s.id === id);
    if (sec) {
      song.focus = song.focus || {};
      song.focus.cellId = sec.cellId;
      song.focus.sectionId = id;
      save('arrangement');
    }
    render();
  }

  function deleteSection(id) {
    const sec = song.arrangement.find((s) => s.id === id);
    const name = sec && sec.name ? sec.name : 'this section';
    if (!confirm('Delete section “' + name + '” from the form? Cells stay in the library.')) {
      return;
    }
    pushFormUndo();
    song.arrangement = song.arrangement.filter((s) => s.id !== id);
    if (selectedSecId === id) selectedSecId = song.arrangement[0] ? song.arrangement[0].id : null;
    save();
    render();
  }

  function reorderSec(from, to) {
    if (from === to || from < 0 || to < 0) return;
    const arr = song.arrangement;
    if (from >= arr.length || to >= arr.length) return;
    pushFormUndo();
    const [item] = arr.splice(from, 1);
    arr.splice(to, 0, item);
    save();
    render();
  }

  // ─── Render ──────────────────────────────────────────────
  /**
   * opts.keepLocal — do not replace in-memory song from localStorage
   *   (use after Load song / demos so a failed/stale storage write can't wipe the import)
   */
  function render(opts) {
    opts = opts || {};
    if (!opts.keepLocal) {
      // Prefer storage only when it is strictly newer (Landscape / other tab).
      // Never clobber a just-loaded package that is equal or newer in memory.
      const fresh = S().loadSong();
      if (fresh) {
        const localTs =
          song && song.updatedAt ? Date.parse(song.updatedAt) || 0 : 0;
        const freshTs = fresh.updatedAt ? Date.parse(fresh.updatedAt) || 0 : 0;
        if (!song || freshTs > localTs) {
          song = fresh;
        }
      }
    }
    if (song) {
      if (!song.arrangement) song.arrangement = [];
      if (!song.cells) song.cells = {};
      if (song.notes == null) song.notes = '';
      if ($('#song-title') && document.activeElement !== $('#song-title')) {
        $('#song-title').value = song.title || 'Untitled';
      }
      if ($('#bpm') && document.activeElement !== $('#bpm')) {
        $('#bpm').value = song.bpm || 96;
      }
      const notesEl = $('#song-notes');
      if (notesEl && document.activeElement !== notesEl) notesEl.value = song.notes || '';
      syncKeyUI();
      updateKeyLabel();
    }
    renderCells();
    renderForm();
    renderTimeline();
    renderFormStrip();
    renderPipes();
    renderKeySpiral();
    renderFocus();
  }

  function renderCells() {
    const host = $('#cell-list');
    host.innerHTML = '';
    const ids = Object.keys(song.cells || {});
    if (!ids.length) {
      host.innerHTML = '<p class="hint">No cells. Open Landscape, Import .hl.json, or Load SoP full.</p>';
      return;
    }
    const focusId = song.focus && song.focus.cellId;
    const maxFb = fretMax();
    ids.forEach((id) => {
      const cell = song.cells[id];
      const wrap = document.createElement('div');
      wrap.className = 'cell-wrap' + (id === focusId ? ' active' : '');
      const nCh = (cell.chords || []).length;
      const bars = (cellBeats(cell) / 4).toFixed(cellBeats(cell) % 4 === 0 ? 0 : 1);
      const frettable = cellFrettable(cell);
      const badge = frettable
        ? '<span class="badge ok" title="Fits Fretboard">≤' + maxFb + '</span>'
        : nCh
          ? '<span class="badge warn" title="Fretboard clips to ' + maxFb + '">long ' + nCh + '</span>'
          : '<span class="badge">empty</span>';
      const fam =
        cell.familyId && song.families && song.families[cell.familyId]
          ? ' · ' + (song.families[cell.familyId].name || 'family') + ' v' + (cell.versionIndex || 1)
          : '';
      const theme =
        S() && S().stripLineageFromName
          ? S().stripLineageFromName(cell.name || id)
          : cell.name || id;
      const lineage =
        S() && S().lineageLockText ? S().lineageLockText(cell) : '';
      wrap.innerHTML = `
        <div class="cell-head">
          <div class="cell-name-row">
            <input type="text" class="cell-name-input" value="${escapeAttr(theme)}" maxlength="64" title="Theme name only. Version lineage is locked." />
            ${
              lineage
                ? '<span class="lineage-lock" title="Version lineage — not editable">' +
                  escapeAttr(lineage) +
                  '</span>'
                : ''
            }
          </div>
        </div>
        <button type="button" class="cell cell-main" title="Open in Landscape to edit chords">
          <span>${bars} bars · ${nCh} chords ${badge}${escapeAttr(fam)}</span>
          <em>${escapeAttr(cellLabel(cell))}</em>
        </button>
        <div class="cell-actions">
          <button type="button" class="btn ghost btn-edit-cell" title="Edit in Landscape">Edit</button>
          <button type="button" class="btn ghost btn-fret-cell" title="Fretboard (max ${maxFb})">🎸</button>
          <button type="button" class="btn ghost btn-vary-cell" title="Create family variation">Vary</button>
          <button type="button" class="btn ghost btn-dup-cell" title="Duplicate cell">Dup</button>
          <button type="button" class="btn ghost btn-del-cell" title="Delete cell">×</button>
        </div>
      `;
      const openEdit = () => openLandscapeForCell(id, song.cells[id].name);
      wrap.querySelector('.cell-name-input').addEventListener('input', (e) => {
        if (!S() || !S().stripGeneratedLineage) return;
        const raw = e.target.value;
        if (!/·\s*v\d|v\d+\s+v\d/i.test(raw)) return;
        const next = S().stripGeneratedLineage(raw);
        if (next !== raw) e.target.value = next;
      });
      wrap.querySelector('.cell-name-input').addEventListener('change', (e) => {
        renameCell(id, e.target.value);
      });
      wrap.querySelector('.cell-name-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.target.blur();
        }
        e.stopPropagation();
      });
      wrap.querySelector('.cell-name-input').addEventListener('click', (e) => e.stopPropagation());
      wrap.querySelector('.cell-main').addEventListener('click', openEdit);
      wrap.querySelector('.btn-edit-cell').addEventListener('click', (e) => {
        e.stopPropagation();
        openEdit();
      });
      wrap.querySelector('.btn-fret-cell').addEventListener('click', (e) => {
        e.stopPropagation();
        openFretboardForCell(id);
      });
      wrap.querySelector('.btn-vary-cell').addEventListener('click', (e) => {
        e.stopPropagation();
        varyCell(id);
      });
      wrap.querySelector('.btn-dup-cell').addEventListener('click', (e) => {
        e.stopPropagation();
        duplicateCell(id);
      });
      wrap.querySelector('.btn-del-cell').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteCell(id);
      });
      host.appendChild(wrap);
    });
  }

  function renderForm() {
    const body = $('#form-body');
    body.innerHTML = '';
    const cellIds = Object.keys(song.cells || {});
    S().ensureSongShape(song);

    song.arrangement.forEach((sec, idx) => {
      const chain = S().sectionChain(sec);
      const cell = song.cells[sec.cellId] || song.cells[chain[0]];
      const bars = S().sectionBars(song, sec);
      const tr = document.createElement('tr');
      if (sec.id === selectedSecId) tr.className = 'selected';
      tr.draggable = true;
      tr.dataset.id = sec.id;

      const chainLabel = chain
        .map((id) => (song.cells[id] ? song.cells[id].name : '?'))
        .join(' → ');

      const cellOpts = cellIds
        .map((id) => `<option value="${id}"${id === (sec.cellId || chain[0]) ? ' selected' : ''}>${song.cells[id].name || id}</option>`)
        .join('');

      // Multi-select chain checkboxes for family versions
      let chainChecks = '';
      if (cell && cell.familyId) {
        const vers = S().familyVersions(song, cell.familyId);
        chainChecks = vers
          .map((v) => {
            const on = chain.indexOf(v.id) >= 0;
            return `<label class="chain-check"><input type="checkbox" data-vid="${v.id}" ${on ? 'checked' : ''}/> ${escapeAttr(v.name)}</label>`;
          })
          .join('');
      }

      const endOpts =
        '<option value="">— body</option>' +
        cellIds
          .map(
            (id) =>
              `<option value="${id}"${id === sec.endCellId ? ' selected' : ''}>${escapeAttr(
                song.cells[id].name || id
              )}</option>`
          )
          .join('');
      const intoOpts =
        '<option value="">— none</option>' +
        cellIds
          .map(
            (id) =>
              `<option value="${id}"${id === sec.intoCellId ? ' selected' : ''}>${escapeAttr(
                song.cells[id].name || id
              )}</option>`
          )
          .join('');

      tr.innerHTML = `
        <td class="grip" title="Drag">⋮⋮</td>
        <td>${idx + 1}</td>
        <td><input type="text" class="sec-name" value="${escapeAttr(sec.name || '')}" /></td>
        <td>
          <select class="sec-cell">${cellOpts || '<option value="">—</option>'}</select>
          <div class="chain-line status">${escapeAttr(chainLabel)}</div>
          <div class="chain-box">${chainChecks}</div>
          <div class="cycle-row">
            <label class="cycle-lab" title="Last rep only: play this cell instead of the body (loop exit)">End
              <select class="sec-end">${endOpts}</select>
            </label>
            <label class="cycle-lab" title="After all reps, once: bridge before next section">Into
              <select class="sec-into">${intoOpts}</select>
            </label>
          </div>
        </td>
        <td><input type="number" class="sec-reps" min="1" max="32" value="${sec.reps || 1}" style="width:3.5rem" /></td>
        <td>${bars % 1 === 0 ? bars : bars.toFixed(1)}</td>
        <td class="row-actions">
          <button type="button" class="btn ghost btn-land" title="Landscape">✎</button>
          <button type="button" class="btn ghost btn-fret" title="Fretboard (max 8 chords)">🎸</button>
          <button type="button" class="btn ghost btn-del" title="Remove">×</button>
        </td>
      `;

      tr.addEventListener('click', (e) => {
        if (e.target.closest('button, input, select, label')) return;
        selectSection(sec.id);
      });
      tr.querySelector('.sec-name').addEventListener('change', (e) => {
        pushFormUndo();
        sec.name = e.target.value;
        save();
        renderFocus();
        renderTimeline();
      });
      tr.querySelector('.sec-cell').addEventListener('change', (e) => {
        pushFormUndo();
        const id = e.target.value;
        sec.cellId = id;
        // Reset chain to this cell only (user can re-check versions)
        S().setSectionChain(sec, [id]);
        save();
        render();
      });
      tr.querySelectorAll('.chain-box input[type=checkbox]').forEach((cb) => {
        cb.addEventListener('change', () => {
          pushFormUndo();
          const ids = [];
          tr.querySelectorAll('.chain-box input[type=checkbox]').forEach((c) => {
            if (c.checked) ids.push(c.dataset.vid);
          });
          if (!ids.length && sec.cellId) ids.push(sec.cellId);
          S().setSectionChain(sec, ids);
          save();
          render();
        });
      });
      tr.querySelector('.sec-reps').addEventListener('change', (e) => {
        pushFormUndo();
        sec.reps = Math.max(1, parseInt(e.target.value, 10) || 1);
        save();
        render();
      });
      tr.querySelector('.sec-end').addEventListener('change', (e) => {
        pushFormUndo();
        sec.endCellId = e.target.value || null;
        save();
        render();
      });
      tr.querySelector('.sec-into').addEventListener('change', (e) => {
        pushFormUndo();
        sec.intoCellId = e.target.value || null;
        save();
        render();
      });
      tr.querySelector('.btn-del').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteSection(sec.id);
      });
      tr.querySelector('.btn-land').addEventListener('click', (e) => {
        e.stopPropagation();
        openLandscapeForCell(sec.cellId || chain[0], cell && cell.name);
      });
      tr.querySelector('.btn-fret').addEventListener('click', (e) => {
        e.stopPropagation();
        openFretboardForCell(sec.cellId || chain[0]);
      });

      tr.addEventListener('dragstart', (e) => {
        dragFrom = idx;
        tr.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      tr.addEventListener('dragend', () => {
        tr.classList.remove('dragging');
        dragFrom = null;
      });
      tr.addEventListener('dragover', (e) => e.preventDefault());
      tr.addEventListener('drop', (e) => {
        e.preventDefault();
        if (dragFrom != null) reorderSec(dragFrom, idx);
      });

      body.appendChild(tr);

      // Seam row into next section
      if (idx < song.arrangement.length - 1) {
        const next = song.arrangement[idx + 1];
        const seam = sec.seam || S().defaultSeam();
        const seamTr = document.createElement('tr');
        seamTr.className = 'seam-row';
        const seamCh =
          seam.chords && seam.chords.length
            ? seam.chords.map((c) => (M() ? M().noteName(c.root) : c.root) + (c.quality === 'dom7' ? '7' : c.quality || '')).join(' ')
            : '—';
        seamTr.innerHTML = `
          <td colspan="3" class="seam-label">↘ seam into <strong>${escapeAttr(next.name || '')}</strong></td>
          <td colspan="2">
            <select class="seam-type">
              <option value="none"${seam.type === 'none' ? ' selected' : ''}>None</option>
              <option value="smooth"${seam.type === 'smooth' ? ' selected' : ''}>Smooth VL only</option>
              <option value="turnaround"${seam.type === 'turnaround' ? ' selected' : ''}>Turnaround (V7→)</option>
              <option value="custom"${seam.type === 'custom' ? ' selected' : ''}>Custom join</option>
            </select>
            <span class="status seam-chords">${escapeAttr(seamCh)}</span>
            <button type="button" class="btn ghost seam-hear" title="Hear last + seam + next">Hear</button>
            <div class="seam-joins"></div>
          </td>
          <td colspan="2" class="status">join last of this into first of next</td>
        `;
        seamTr.querySelector('.seam-type').addEventListener('change', (e) => {
          setSeamType(sec.id, e.target.value);
        });
        const fromCh = lastChordOfSection(sec);
        const toCh = firstChordOfSection(next);
        const joinHost = seamTr.querySelector('.seam-joins');
        if (joinHost && window.HLCompose && HLCompose.suggestLoopJoins && fromCh && toCh) {
          const joins = HLCompose.suggestLoopJoins({
            fromChord: sessionChordToPlayable(fromCh),
            toChord: sessionChordToPlayable(toCh),
            tonic: (toCh.localTonic != null ? toCh.localTonic : song.key && song.key.tonic) || 11,
            modeKey: toCh.localMode || (song.key && song.key.mode) || 'minor',
            duration: 2,
            count: 5,
          });
          (joins || []).forEach(function (j) {
            if (j.mode === 'insert') return;
            const jb = document.createElement('button');
            jb.type = 'button';
            jb.className = 'btn ghost';
            jb.style.margin = '0.15rem 0.15rem 0 0';
            jb.textContent = j.label;
            jb.title = j.job || 'Set as custom seam';
            jb.addEventListener('click', function (ev) {
              ev.stopPropagation();
              pushFormUndo();
              if (!sec.seam) sec.seam = S().defaultSeam();
              sec.seam.type = 'custom';
              sec.seam.chords = (j.chords || []).map(function (c) {
                return {
                  root: c.root,
                  quality: c.quality,
                  duration: c.duration || 2,
                  bass: c.bass != null ? c.bass : c.root,
                  roman: c.roman || '',
                  region: c.region || 'diatonic',
                  tag: 'seam',
                  name: c.name,
                };
              });
              save();
              render();
              setStatus('Seam · ' + (j.label || 'custom') + ' into ' + (next.name || ''));
            });
            joinHost.appendChild(jb);
          });
        }
        const hearBtn = seamTr.querySelector('.seam-hear');
        if (hearBtn) {
          hearBtn.addEventListener('click', function (ev) {
            ev.stopPropagation();
            hearSeam(sec, next);
          });
        }
        body.appendChild(seamTr);
      }
    });
  }

  function renderTimeline() {
    const bar = $('#tl-bar');
    const meta = $('#tl-meta');
    bar.innerHTML = '';
    const total = S().totalBars(song) || 1;
    const colors = ['#c4a574', '#7eb8da', '#9b7bb8', '#d4786a', '#6bb38a', '#e8c98a', '#a78bfa'];
    song.arrangement.forEach((sec, i) => {
      const b = S().sectionBars(song, sec);
      const pct = Math.max(4, (b / total) * 100);
      const seg = document.createElement('div');
      seg.className = 'tl-seg';
      seg.style.width = pct + '%';
      seg.style.background = colors[i % colors.length];
      let label = sec.name || '';
      if (sec.endCellId) label += '·end';
      if (sec.intoCellId) label += '·into';
      seg.textContent = label;
      const endName =
        sec.endCellId && song.cells[sec.endCellId]
          ? song.cells[sec.endCellId].name
          : '';
      const intoName =
        sec.intoCellId && song.cells[sec.intoCellId]
          ? song.cells[sec.intoCellId].name
          : '';
      seg.title =
        `${sec.name}: ${b} bars` +
        (sec.reps > 1 ? ` · ${sec.reps}×` : '') +
        (endName ? ` · end: ${endName}` : '') +
        (intoName ? ` · into: ${intoName}` : '');
      if (sec.id === selectedSecId) seg.classList.add('selected');
      seg.addEventListener('click', () => selectSection(sec.id));
      bar.appendChild(seg);
      // Lightweight "pipe" marker between sections (seam type)
      if (i < song.arrangement.length - 1) {
        const seam = sec.seam || { type: 'none' };
        const pipe = document.createElement('div');
        pipe.className =
          'tl-pipe' +
          (seam.type && seam.type !== 'none' ? ' on' : '') +
          (seam.type === 'turnaround' ? ' turn' : '');
        pipe.title =
          'Seam → ' +
          (song.arrangement[i + 1].name || '') +
          ': ' +
          (seam.type || 'none');
        pipe.textContent = seam.type === 'turnaround' ? '↻' : seam.type === 'smooth' ? '∼' : '·';
        bar.appendChild(pipe);
      }
    });
    const tb = S().totalBars(song);
    const maxFb = fretMax();
    const flatN = S().flattenArrangement(song).length;
    meta.textContent =
      `${tb % 1 === 0 ? tb : tb.toFixed(1)} bars · ${flatN} chords flat · ${song.arrangement.length} sections · ${Object.keys(song.cells || {}).length} cells` +
      ` · Fretboard max ${maxFb}`;
  }

  function renderFormStrip() {
    const host = $('#form-strip');
    const meta = $('#strip-meta');
    if (!host) return;
    host.innerHTML = '';
    const flat = S().flattenArrangement(song);
    if (!flat.length) {
      if (meta) meta.textContent = 'Empty form — add sections with chords';
      return;
    }
    const colors = {
      body: '',
      end: 'role-end',
      into: 'role-into',
      seam: 'role-seam',
    };
    const keysUsed = new Set();
    flat.forEach((c, i) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      const role = c._seam ? 'seam' : c._role || 'body';
      chip.className = 'strip-chip key-tinted ' + (colors[role] || '');
      if (playing && i === playIndex) chip.classList.add('playing');
      const kt = chordKeyTonic(c);
      keysUsed.add(kt);
      chip.style.borderLeftColor = keyColorSolid(kt);
      chip.style.boxShadow = 'inset 0 0 0 1px ' + keyColor(kt, 0.15);
      chip.innerHTML =
        '<span class="sc-sec">' +
        escapeAttr(c._seam ? 'seam' : c._section || '') +
        ' · ' +
        escapeAttr(keyLabel(kt, chordKeyMode(c))) +
        '</span>' +
        escapeAttr(chordDisplayName(c));
      chip.title =
        (c._section || '') +
        (c._cell ? ' · ' + c._cell : '') +
        ' · key ' +
        keyLabel(kt, chordKeyMode(c)) +
        (role !== 'body' ? ' · ' + role : '') +
        ' · ' +
        (c.duration || 4) +
        ' beats · click to play from here';
      chip.addEventListener('click', () => playFromFlatIndex(i));
      host.appendChild(chip);
    });
    if (meta) {
      meta.textContent =
        flat.length +
        ' steps · ' +
        keysUsed.size +
        ' key disk(s) · ' +
        (S().totalBars(song) % 1 === 0
          ? S().totalBars(song)
          : S().totalBars(song).toFixed(1)) +
        ' bars · left edge = key colour';
    }
  }

  function getSpiralMode() {
    const end = $('#spiral-mode-end');
    if (end && end.checked) return 'end';
    return 'side';
  }

  function getSpiralSectionOnly() {
    const el = $('#spiral-section-only');
    return !!(el && el.checked);
  }

  /**
   * Journey / In-this-key seat wheel for a key (same as Landscape Chase disk).
   * Returns seats from HLMusic.circularHarmonicScale, or a 7-slot fallback.
   */
  function journeySeats(tonic, mode) {
    const t = ((tonic % 12) + 12) % 12;
    const m = mode || 'minor';
    if (M() && M().circularHarmonicScale) {
      return M().circularHarmonicScale(t, m);
    }
    // Fallback: 7 seats clockwise from top (tonic first)
    const degs =
      m === 'major' || m === 'ionian' || m === 'lydian' || m === 'mixolydian'
        ? [0, 5, 11, 4, 9, 2, 7]
        : [0, 5, 10, 3, 8, 2, 7];
    return degs.map((d, i) => ({
      d: d,
      root: (t + d) % 12,
      roman: String(i + 1),
      role: i === 0 ? 'tonic' : 'scale',
      seatIndex: i,
      angle: -Math.PI / 2 + (i / degs.length) * Math.PI * 2,
    }));
  }

  /**
   * Angle of a chord on the Journey / In-this-key wheel for its owning disk.
   * Uses seatForChord (same placement as Landscape map seats).
   */
  function chordSeatHit(c) {
    const tonic = chordKeyTonic(c);
    const mode = chordKeyMode(c);
    if (M() && M().seatForChord) {
      return M().seatForChord(
        { root: c.root, quality: c.quality || 'maj', name: c.name },
        tonic,
        mode
      );
    }
    const seats = journeySeats(tonic, mode);
    const root = ((c.root % 12) + 12) % 12;
    const seat = seats.find((s) => s.root === root) || seats[0];
    return { seat: seat, onScale: !!seats.find((s) => s.root === root), shell: false, seats: seats };
  }

  function chordWheelAngle(c) {
    const hit = chordSeatHit(c);
    if (hit && hit.seat && hit.seat.angle != null) return hit.seat.angle;
    return -Math.PI / 2;
  }

  /** Shortest signed angular delta a0 → a1 on the wheel */
  function shortestArcDelta(a0, a1) {
    let d = a1 - a0;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  /**
   * Spring wind: always rotate FORWARD on the Journey wheel to the next seat.
   * Shortest-arc back-and-forth (Em↔iv) made a heartbeat zigzag; forcing
   * non-negative unwrap turns each return into another coil of the spring.
   * fromPhase may be unwrapped (>> 2π); targetTheta is principal seat angle.
   */
  /**
   * Forward-biased spring wind between seat angles.
   * Uses the shorter forward hop when possible so Em↔Asus4 doesn't rack up
   * nearly-full turns every bar (that made long SoP forms look like spaghetti).
   */
  function springWindDelta(fromPhase, targetTheta) {
    const twoPi = Math.PI * 2;
    const cur = ((fromPhase % twoPi) + twoPi) % twoPi;
    const tgt = ((targetTheta % twoPi) + twoPi) % twoPi;
    let d = tgt - cur;
    // Prefer shortest arc; only force forward when hop is meaningful
    if (d > Math.PI) d -= twoPi;
    if (d < -Math.PI) d += twoPi;
    // Same seat (or numerical wrap): stay on rail
    if (Math.abs(d) < 0.02 || Math.abs(Math.abs(d) - twoPi) < 0.02) return 0;
    // Mild forward bias: if going backward a tiny bit, flip only when
    // the reverse is almost as long (ambiguous) — otherwise allow short reverse
    // so the coil breathes instead of always racking +2π.
    if (d < -1e-6 && Math.abs(d) > Math.PI * 0.85) {
      d += twoPi; // long reverse → take the shorter forward way
    }
    return d;
  }

  /**
   * Flat list for pipe (+ absolute indices for playback).
   * Section-only mode filters to selected section.
   */
  function spiralFlatList() {
    const flat = S().flattenArrangement(song);
    if (!getSpiralSectionOnly() || !selectedSecId) {
      return flat.map((c, i) => ({ c, absIndex: i }));
    }
    const sec = song.arrangement.find((s) => s.id === selectedSecId);
    if (!sec) return flat.map((c, i) => ({ c, absIndex: i }));
    const name = sec.name || '';
    const out = [];
    flat.forEach((c, i) => {
      const secTag = c._section || '';
      if (secTag === name || (c._seam && secTag.indexOf(name) === 0)) {
        out.push({ c, absIndex: i });
      }
    });
    return out.length ? out : flat.map((c, i) => ({ c, absIndex: i }));
  }

  /**
   * Project a point on the Journey-wheel pipe cylinder to screen.
   * Geometry (matches Landscape Chase / Function seats):
   *   θ  = seat angle on Journey / In-this-key wheel → rim of pipe
   *   u  = time through song [0..1]                   → along pipe axis
   * Side view: X = time, cross-section = seat wheel.
   * End view:  looking down the pipe — seats on the rim, time = depth radius.
   */  /**
   * True 3D projection of Journey-wheel cylinder.
   * World: tube axis = time (Z), circle XY = seat angles (θ).
   * Camera: yaw + pitch + perspective so the path reads as a spiral coil.
   * ringFrac: optional seat ring (tonic closer in).
   */
  /**
   * 3D Journey-wheel cylinder.
   * u=0 START is FAR (small, receding); u=1 END is NEAR (large, toward camera).
   * ringFrac = orbital radius on In-this-key wheel (tonic tight, shell wide).
   * Outer orbits widen the coil and slightly compress axial run (shorter spring).
   */
  /**
   * Long 3D spring (not a compressed cone).
   * Time runs LEFT→RIGHT with mild depth: START left/far, END right/near.
   * Journey seat angle = rotation around tube; ringFrac = orbit radius
   * (tonic tight, shell wide). Multi-key disks offset so cylinders separate.
   * diskOffset: {x,y} world shift for a key disk (optional).
   */
  function projectPipePoint(u, theta, layout, ringFrac, diskOffset) {
    const rf = ringFrac != null ? Math.max(0.28, Math.min(1.25, ringFrac)) : 0.74;
    const orbit = layout.R * (rf / 0.74);
    const off = diskOffset || { x: 0, y: 0, z: 0 };
    const oz = off.z || 0;

    // Cylinder surface normal in world (outward on YZ circle; X along pipe)
    // Used so the back of each coil (facing away) is darker/thinner than the front
    let nx = 0;
    let ny = Math.cos(theta);
    let nz = Math.sin(theta);

    if (layout.mode === 'end') {
      const r = layout.rMin + u * (layout.rMax - layout.rMin);
      const rr = r * (rf / 0.74);
      const x = Math.cos(theta) * rr + (off.x || 0);
      const y = Math.sin(theta) * rr + (off.y || 0);
      const z = layout.zFar + u * (layout.zNear - layout.zFar) + oz;
      nx = Math.cos(theta);
      ny = Math.sin(theta);
      nz = 0;
      return applyCamera(x, y, z, layout, nx, ny, nz, u);
    }

    const x = layout.x0 + u * layout.length + (off.x || 0);
    const y = Math.cos(theta) * orbit + (off.y || 0);
    const z =
      layout.zFar +
      u * (layout.zNear - layout.zFar) +
      Math.sin(theta) * orbit +
      oz;
    return applyCamera(x, y, z, layout, nx, ny, nz, u);
  }

  function applyCamera(x, y, z, layout, nx, ny, nz, u) {
    const yaw = layout.yaw;
    const pitch = layout.pitch;
    const xc = x - layout.worldCx;
    const yc = y;
    const zc = z - layout.worldCz;

    const x1 = xc * Math.cos(yaw) + zc * Math.sin(yaw);
    const z1 = -xc * Math.sin(yaw) + zc * Math.cos(yaw);
    const y1 = yc * Math.cos(pitch) - z1 * Math.sin(pitch);
    const z2 = yc * Math.sin(pitch) + z1 * Math.cos(pitch);

    // Transform surface normal the same way (no translation)
    let nnx = (nx || 0) * Math.cos(yaw) + (nz || 0) * Math.sin(yaw);
    let nnz = -(nx || 0) * Math.sin(yaw) + (nz || 0) * Math.cos(yaw);
    let nny = (ny || 0) * Math.cos(pitch) - nnz * Math.sin(pitch);
    nnz = (ny || 0) * Math.sin(pitch) + nnz * Math.cos(pitch);
    // Facing camera ≈ normal pointing toward viewer (−view Z in our setup)
    // After transform, larger -nnz means more face-on
    const facing = Math.max(0, Math.min(1, 0.5 - nnz * 0.5));

    const fov = layout.fov;
    const zClamped = Math.max(layout.zPerspMin, Math.min(layout.zPerspMax, z2));
    const persp = fov / (fov + zClamped);
    const sc = persp * layout.zoom;

    // Axial nearness along the pipe (0=start/far, 1=end/near)
    const axial =
      u != null
        ? Math.max(0, Math.min(1, u))
        : layout.nearnessFromScale
          ? layout.nearnessFromScale(sc)
          : Math.max(0, Math.min(1, (sc - 0.55) / 0.55));

    // Combined: journey depth + which side of the coil faces us
    // Back of coil (low facing) stays dark even near the mouth of the pipe
    const nearness = Math.max(
      0,
      Math.min(1, axial * 0.55 + facing * 0.45)
    );

    return {
      x: layout.cx + x1 * sc + (layout.panX || 0),
      y: layout.cy - y1 * sc + (layout.panY || 0),
      depth: z2,
      scale: sc,
      nearness: nearness,
      facing: facing,
      axial: axial,
      behind: facing < 0.42,
    };
  }

  /**
   * Render cue for a 3D-ish pipe object:
   * - rear of coil (away from camera) → dark + thin
   * - front of coil + near end of pipe → bright + thick
   */
  function depthCue(p, layout, baseAlpha, baseWidth) {
    const facing = p.facing != null ? p.facing : 0.5;
    const axial = p.axial != null ? p.axial : p.nearness != null ? p.nearness : 0.5;
    // Distance fog: start of song (low axial) is darker and deeper in the pipe
    const distFog = 0.08 + 0.92 * Math.pow(axial, 1.35);
    // Shape lighting: back of coil dimmer than front of coil
    const faceLit = 0.22 + 0.78 * Math.pow(facing, 1.2);
    const lit = distFog * (0.35 + 0.65 * faceLit);
    const alpha = Math.max(
      0.05,
      Math.min(1, (baseAlpha != null ? baseAlpha : 0.95) * lit)
    );
    // Width: far start thinner; rear of coil thinner; near/front thicker
    const widthMul =
      (0.22 + 0.48 * Math.pow(facing, 1.05)) * (0.4 + 0.6 * Math.pow(axial, 1.2));
    const w =
      (baseWidth != null ? baseWidth : 3.2) *
      widthMul *
      (0.7 + 0.45 * (p.scale || 1));
    return {
      alpha: alpha,
      width: Math.max(0.5, w),
      nearness: p.nearness != null ? p.nearness : lit,
      facing: facing,
      axial: axial,
    };
  }

  /**
   * Parallel cylinder lanes for each key disk (Journey multi-key).
   * Modest separation — sibling tubes, not orbits that tear the spring apart.
   */
  function diskWorldOffset(tonic, layout, keyOrder) {
    const home = homeTonic();
    const t = tonic != null ? ((tonic % 12) + 12) % 12 : home;
    const order =
      keyOrder && keyOrder.length
        ? keyOrder
        : [home];
    let idx = order.indexOf(t);
    if (idx < 0) idx = order.length; // unknown → new lane
    // Lane map: 0, +1, -1, +2, -2...
    let lane = 0;
    if (idx > 0) {
      const k = idx;
      lane = k % 2 === 1 ? Math.ceil(k / 2) : -Math.ceil(k / 2);
    }
    // Keep multi-key readable without huge Y jumps (SoP Em/C/G was flying apart)
    const nKeys = Math.max(1, order.length);
    const sepScale = nKeys <= 2 ? 1.05 : nKeys === 3 ? 0.85 : 0.65;
    const sepY = layout.R * 1.15 * sepScale;
    const sepZ = layout.R * 0.22 * sepScale;
    return {
      x: 0,
      y: lane * sepY,
      z: lane * sepZ,
      lane: lane,
    };
  }

  /** Unique key tonics in flatten order (for cylinder lanes) */
  function collectKeyOrder(flatList) {
    const home = homeTonic();
    const order = [];
    // Prefer song home first if present
    const seen = new Set();
    function add(t) {
      const k = ((t % 12) + 12) % 12;
      if (seen.has(k)) return;
      seen.add(k);
      order.push(k);
    }
    // Scan list; if home appears, keep it at front
    const found = [];
    (flatList || []).forEach((row) => {
      const c = row.c || row;
      found.push(chordKeyTonic(c));
    });
    if (found.indexOf(home) >= 0) add(home);
    found.forEach(add);
    if (!order.length) add(home);
    return order;
  }
  function seatRingFrac(hit, chord, tonic, mode) {
    if (M() && M().chaseChordPos && chord) {
      const pos = M().chaseChordPos(
        { root: chord.root, quality: chord.quality || 'maj' },
        tonic != null ? tonic : homeTonic(),
        mode || 'minor',
        { cx: 0, cy: 0, R: 100 }
      );
      if (pos && pos.radius != null) return pos.radius / 100;
    }
    if (!hit || !hit.seat) return 0.74;
    if (hit.seat.role === 'tonic' && hit.onScale && !hit.shell) return 0.4;
    if (hit.shell === true) return 1.18;
    if (hit.shell === 'secondary') return 0.92;
    if (hit.shell === 'variant') return 0.82;
    if (hit.seat.role === 'dom') return 0.92;
    return 0.74;
  }

  function buildPipeLayout(W, H, mode) {
    const cx = W * 0.5;
    const cy = H * 0.5;
    const m = Math.min(W, H);
    // Long pipe: start deeper/farther so the beginning sits in the distance
    const length = W * 0.8;
    const x0 = W * 0.05;
    const R = m * 0.19;
    const zFar = m * 1.05; // start further away
    const zNear = m * 0.08;
    const worldCx = x0 + length * 0.52;
    const worldCz = (zFar + zNear) / 2;

    // Probe scales at start/end for nearness mapping
    const probeLayout = {
      yaw: 0.55,
      pitch: 0.34,
      fov: 580,
      zoom: 1,
      worldCx: worldCx,
      worldCz: worldCz,
      cx: cx,
      cy: cy,
      zPerspMin: m * -0.12,
      zPerspMax: m * 1.25,
      midDepth: 0,
    };
    // Approximate far/near scale via world points
    function probeScale(u) {
      const x = x0 + u * length;
      const z = zFar + u * (zNear - zFar);
      const p = applyCamera(x, 0, z, probeLayout, 0, 0, 1, u);
      return p.scale;
    }
    const scaleFar = probeScale(0);
    const scaleNear = probeScale(1);
    const nearnessFromScale = function (sc) {
      const den = scaleNear - scaleFar;
      if (Math.abs(den) < 1e-6) return 0.5;
      return Math.max(0, Math.min(1, (sc - scaleFar) / den));
    };

    if (mode === 'end') {
      return {
        mode: 'end',
        cx: cx,
        cy: cy + 4,
        rMin: m * 0.07,
        rMax: m * 0.42,
        R: m * 0.34,
        x0: 0,
        length: length,
        worldCx: 0,
        worldCz: (zFar + zNear) / 2,
        zFar: zFar,
        zNear: zNear,
        yaw: 0.12,
        pitch: 0.48,
        fov: 560,
        zoom: spiralZoom != null ? spiralZoom : 1,
        panX: spiralPanX || 0,
        panY: spiralPanY || 0,
        midDepth: 0,
        zPerspMin: m * -0.1,
        zPerspMax: m * 1.0,
        nearnessFromScale: nearnessFromScale,
        scaleFar: scaleFar,
        scaleNear: scaleNear,
      };
    }
    return {
      mode: 'side',
      cx: cx,
      cy: cy + H * 0.02,
      R: R,
      x0: x0,
      length: length,
      worldCx: worldCx,
      worldCz: worldCz,
      zFar: zFar,
      zNear: zNear,
      // Stronger into-pipe feel: start recedes, end approaches
      yaw: 0.55,
      pitch: 0.34,
      fov: 580,
      zoom: spiralZoom != null ? spiralZoom : 1,
      panX: spiralPanX || 0,
      panY: spiralPanY || 0,
      midDepth: 0,
      zPerspMin: m * -0.12,
      zPerspMax: m * 1.25,
      nearnessFromScale: nearnessFromScale,
      scaleFar: scaleFar,
      scaleNear: scaleNear,
    };
  }

  function scheduleSpiralRedraw() {
    if (spiralRaf) cancelAnimationFrame(spiralRaf);
    spiralRaf = requestAnimationFrame(function () {
      spiralRaf = 0;
      renderKeySpiral();
    });
  }

  function setSpiralZoom(z, opts) {
    opts = opts || {};
    const prev = spiralZoom;
    spiralZoom = Math.max(SPIRAL_ZOOM_MIN, Math.min(SPIRAL_ZOOM_MAX, z));
    // Zoom toward canvas centre: keep pan sensible when zooming
    if (opts.anchorX != null && opts.anchorY != null && prev > 0.01) {
      const ratio = spiralZoom / prev;
      spiralPanX = opts.anchorX - (opts.anchorX - spiralPanX) * ratio;
      spiralPanY = opts.anchorY - (opts.anchorY - spiralPanY) * ratio;
    }
    syncSpiralZoomLabel();
    scheduleSpiralRedraw();
  }

  function setSpiralPan(x, y) {
    spiralPanX = x;
    spiralPanY = y;
    scheduleSpiralRedraw();
  }

  function resetSpiralView() {
    spiralZoom = 1;
    spiralPanX = 0;
    spiralPanY = 0;
    syncSpiralZoomLabel();
    scheduleSpiralRedraw();
  }

  function syncSpiralZoomLabel() {
    const lab = $('#spiral-zoom-label');
    if (lab) lab.textContent = Math.round(spiralZoom * 100) + '%';
  }

  function isSpiralFullscreen() {
    const panel = $('#spiral-panel');
    return !!(panel && panel.classList.contains('spiral-fs'));
  }

  function setSpiralFullscreen(on) {
    const panel = $('#spiral-panel');
    const btn = $('#spiral-fs-btn');
    if (!panel) return;
    const want = !!on;
    panel.classList.toggle('spiral-fs', want);
    document.body.classList.toggle('spiral-fs', want);
    if (btn) {
      btn.textContent = want ? '✕ Exit' : '⛶ Full';
      btn.title = want ? 'Exit full screen (Esc)' : 'Full screen pipe view (Esc to exit)';
    }
    // Let layout settle then redraw at new size
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        scheduleSpiralRedraw();
      });
    });
  }

  function toggleSpiralFullscreen() {
    setSpiralFullscreen(!isSpiralFullscreen());
  }

  /** 0..1 detail factor from zoom — more labels/rings/nodes as you zoom in */
  function spiralDetail() {
    // 1.0 zoom → ~0.35; 2x → ~0.7; 3x+ → 1
    return Math.max(0, Math.min(1, (spiralZoom - 0.7) / 2.2));
  }

  /**
   * True tube axis centre at axial position u (not pulled toward a seat).
   */
  function projectPipeCenter(u, layout, off) {
    off = off || { x: 0, y: 0, z: 0 };
    if (layout.mode === 'end') {
      const x = off.x || 0;
      const y = off.y || 0;
      const z = layout.zFar + u * (layout.zNear - layout.zFar) + (off.z || 0);
      return applyCamera(x, y, z, layout, 0, 0, 1, u);
    }
    const x = layout.x0 + u * layout.length + (off.x || 0);
    const y = off.y || 0;
    const z = layout.zFar + u * (layout.zNear - layout.zFar) + (off.z || 0);
    return applyCamera(x, y, z, layout, 0, 0, 1, u);
  }

  /**
   * Soft solid cylinder body — longitudinal hull, NOT stacked ring slices.
   * (Ring slices read as nested ellipses / tunnel doodles on long songs.)
   * Wall rf ~0.68 so scale seats sit on the wall.
   */
  function drawSoftCylinder(ctx, layout, off, tonic, isHome) {
    const wallRf = 0.68;
    const segs = 28;
    // Few axial stations for a smooth hull (not a ring stack)
    const uStations = [0, 0.2, 0.4, 0.6, 0.8, 1];
    const rings = uStations.map(function (u) {
      const pts = [];
      for (let i = 0; i <= segs; i++) {
        const th = -Math.PI / 2 + (i / segs) * Math.PI * 2;
        pts.push(projectPipePoint(u, th, layout, wallRf, off));
      }
      return pts;
    });

    // Longitudinal strips (theta quads) — body volume without concentric rings
    for (let i = 0; i < segs; i++) {
      // Paint rear half first (theta with low facing)
      for (let pass = 0; pass < 2; pass++) {
        for (let s = 0; s < uStations.length - 1; s++) {
          const a0 = rings[s][i];
          const a1 = rings[s][i + 1];
          const b0 = rings[s + 1][i];
          const b1 = rings[s + 1][i + 1];
          const face =
            ((a0.facing || 0) +
              (a1.facing || 0) +
              (b0.facing || 0) +
              (b1.facing || 0)) /
            4;
          const rear = face < 0.48;
          if (pass === 0 && !rear) continue;
          if (pass === 1 && rear) continue;
          const axial =
            ((a0.axial || 0) +
              (a1.axial || 0) +
              (b0.axial || 0) +
              (b1.axial || 0)) /
            4;
          const a =
            (isHome ? 0.018 : 0.022) *
            (0.25 + 0.55 * face) *
            (0.35 + 0.65 * axial);
          ctx.beginPath();
          ctx.moveTo(a0.x, a0.y);
          ctx.lineTo(a1.x, a1.y);
          ctx.lineTo(b1.x, b1.y);
          ctx.lineTo(b0.x, b0.y);
          ctx.closePath();
          ctx.fillStyle = keyColor(tonic, a);
          ctx.fill();
        }
      }
    }

    // Quiet far mouth + clearer near mouth only (no mid rings)
    function strokeMouth(u, alphaMul, lw) {
      const pts = rings[uStations.indexOf(u)] || rings[rings.length - 1];
      if (!pts) return;
      let sumN = 0;
      pts.forEach(function (p) {
        sumN += p.nearness != null ? p.nearness : 0.5;
      });
      const n = sumN / pts.length;
      ctx.beginPath();
      pts.forEach(function (p, i) {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.strokeStyle = keyColor(tonic, (0.06 + 0.14 * n) * alphaMul);
      ctx.lineWidth = lw;
      ctx.stroke();
    }
    strokeMouth(0, 0.55, 0.7);
    strokeMouth(1, 1.1, isHome ? 1.35 : 1.1);

    // Soft axis guide (reads as pipe centreline without spine clutter)
    ctx.beginPath();
    for (let s = 0; s < uStations.length; s++) {
      const c = projectPipeCenter(uStations[s], layout, off);
      if (s === 0) ctx.moveTo(c.x, c.y);
      else ctx.lineTo(c.x, c.y);
    }
    ctx.strokeStyle = keyColor(tonic, isHome ? 0.06 : 0.045);
    ctx.lineWidth = 0.8;
    ctx.setLineDash([3, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /** Seat radius on the moving wheel: tonic in, scale on wall, outer beyond cylinder */
  function wheelSeatRadius(seat, activeRf) {
    if (seat.role === 'tonic') return 0.34;
    if (seat.role === 'dom') return 0.92;
    if (seat.role === 'chromatic') return 1.15;
    // scale seats sit on / just outside the soft cylinder wall (0.68)
    return 0.74;
  }

  /**
   * Live playhead along the spring from audio clock (smooth within chords).
   * Returns { u, coilPhase, rf, t, mode, off, absIndex, progress } or null.
   */
  function getSpiralPlayhead(samples, keyOrder, layout) {
    if (!samples || !samples.length) return null;
    let absIndex = -1;
    let progress = 0;
    let ph = null;
    if (playing && A() && A().getPlayhead) {
      ph = A().getPlayhead();
    }
    if (ph && playStartOffset >= 0) {
      absIndex = playStartOffset + (ph.stepIndex | 0);
      progress = ph.stepProgress != null ? ph.stepProgress : 0;
    } else if (playing && playIndex >= 0) {
      absIndex = playIndex;
      progress = 0;
    } else {
      return null;
    }
    // Find sample by absIndex
    let si = -1;
    for (let i = 0; i < samples.length; i++) {
      if (samples[i].absIndex === absIndex) {
        si = i;
        break;
      }
    }
    if (si < 0) {
      si = Math.max(0, Math.min(samples.length - 1, absIndex));
    }
    const s = samples[si];
    const u0 = s.uStart != null ? s.uStart : s.u;
    const u1 = s.uEnd != null ? s.uEnd : s.u;
    const u = u0 + (u1 - u0) * Math.max(0, Math.min(1, progress));
    // Phase stays on this chord's seat (path coils between chords only)
    const coilPhase = s.coilPhase;
    const t = s.t;
    const mode = s.mode;
    const rf = s.rf;
    const off = diskWorldOffset(t, layout, keyOrder);
    return {
      u: u,
      coilPhase: coilPhase,
      rf: rf,
      t: t,
      mode: mode,
      off: off,
      absIndex: absIndex,
      progress: progress,
      sample: s,
    };
  }

  /**
   * Journey wheel at playhead: true axis hub + concentric rings (not a dreamcatcher).
   * Tonic sits inward; scale on cylinder wall; outer/shell beyond the tube.
   */
  function drawMovingJourneyWheel(ctx, layout, head, keyOrder, homeSeatsFallback) {
    if (!head) return;
    const seats = journeySeats(head.t, head.mode || 'minor');
    const off = head.off || { x: 0, y: 0, z: 0 };
    const u = head.u;
    const activeTh = head.coilPhase;
    // True tube centre — never pulled toward active seat
    const hub = projectPipeCenter(u, layout, off);
    const sc = hub.scale || 1;

    function ringPath(rf) {
      const pts = [];
      for (let i = 0; i <= 48; i++) {
        const th = -Math.PI / 2 + (i / 48) * Math.PI * 2;
        pts.push(projectPipePoint(u, th, layout, rf, off));
      }
      return pts;
    }

    // Concentric rings: tonic · wall · shell (outside)
    const rings = [
      { rf: 0.34, a: 0.18, w: 1.0 }, // tonic orbit (inward)
      { rf: 0.68, a: 0.28, w: 1.5 }, // cylinder wall
      { rf: 1.12, a: 0.1, w: 0.85 }, // outer shell beyond tube
    ];
    rings.forEach(function (ring) {
      const pts = ringPath(ring.rf);
      ctx.beginPath();
      pts.forEach(function (p, i) {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.strokeStyle = keyColor(head.t, ring.a);
      ctx.lineWidth = ring.w;
      ctx.stroke();
    });

    // Very light wall fill
    const wall = ringPath(0.68);
    ctx.beginPath();
    wall.forEach(function (p, i) {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.fillStyle = keyColor(head.t, 0.025);
    ctx.fill();

    // Axis hub (fixed centre of the cylinder)
    ctx.beginPath();
    ctx.arc(hub.x, hub.y, 3.2 * sc, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,244,214,0.85)';
    ctx.fill();
    ctx.strokeStyle = keyColor(head.t, 0.7);
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Seats on their rings — short radial ticks from wall, not full spokes
    seats.forEach(function (seat) {
      const rf = wheelSeatRadius(seat, head.rf);
      const p = projectPipePoint(u, seat.angle, layout, rf, off);
      const dAng = Math.abs(shortestArcDelta(activeTh, seat.angle));
      const isActive = dAng < 0.38;
      // tick from slightly inside seat toward outside (not hub → rim dreamcatcher)
      const pIn = projectPipePoint(u, seat.angle, layout, Math.max(0.2, rf - 0.1), off);
      const pOut = projectPipePoint(u, seat.angle, layout, rf + 0.08, off);
      ctx.beginPath();
      ctx.moveTo(pIn.x, pIn.y);
      ctx.lineTo(pOut.x, pOut.y);
      ctx.strokeStyle = isActive
        ? keyColor(head.t, 0.75)
        : 'rgba(180,170,155,0.22)';
      ctx.lineWidth = isActive ? 1.8 : 0.9;
      ctx.stroke();

      const r = (isActive ? 5.2 : 2.8) * (p.scale || 1);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      if (isActive) {
        ctx.fillStyle = keyColor(head.t, 0.88);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,244,214,0.9)';
        ctx.lineWidth = 1.6;
      } else {
        ctx.fillStyle = 'rgba(20,18,16,0.55)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(160,150,135,0.35)';
        ctx.lineWidth = 0.7;
      }
      ctx.stroke();

      // Labels outside the seat dots — dark pad + halo so they stay readable on pipe
      const lab = seat.roman || '?';
      const fontPx = (isActive ? 12 : 10) * Math.max(0.85, Math.min(1.35, sc));
      ctx.font =
        (isActive ? '700 ' : '600 ') +
        fontPx +
        'px DM Sans, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const m = ctx.measureText(lab);
      const tw = m.width;
      const th = fontPx;
      // Place label slightly outward from seat so it isn't buried in the dot
      const lx = p.x + (p.x - hub.x) * 0.14;
      const ly = p.y + (p.y - hub.y) * 0.14;
      const padX = 4.5;
      const padY = 2.5;
      const bw = tw + padX * 2;
      const bh = th + padY * 2;
      const br = 4;
      // Dark rounded pad
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(lx - bw / 2, ly - bh / 2, bw, bh, br);
      } else {
        ctx.rect(lx - bw / 2, ly - bh / 2, bw, bh);
      }
      ctx.fillStyle = isActive
        ? 'rgba(12,10,8,0.88)'
        : 'rgba(10,9,8,0.78)';
      ctx.fill();
      if (isActive) {
        ctx.strokeStyle = keyColor(head.t, 0.55);
        ctx.lineWidth = 1.1;
        ctx.stroke();
      }
      // Halo stroke then bright fill
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(8,7,6,0.95)';
      ctx.lineJoin = 'round';
      ctx.strokeText(lab, lx, ly);
      ctx.fillStyle = isActive
        ? 'rgba(255,252,245,1)'
        : 'rgba(230,222,208,0.92)';
      ctx.fillText(lab, lx, ly);
    });

    // Optional thin line: hub → active seat only (tonic pull toward centre)
    const activeSeat = seats.find(function (s) {
      return Math.abs(shortestArcDelta(activeTh, s.angle)) < 0.38;
    });
    if (activeSeat) {
      const arf = wheelSeatRadius(activeSeat, head.rf);
      // If tonic, pull even more inward visually
      const pullRf =
        activeSeat.role === 'tonic'
          ? 0.32
          : Math.min(arf, head.rf != null ? head.rf : arf);
      const aPad = projectPipePoint(u, activeSeat.angle, layout, pullRf, off);
      ctx.beginPath();
      ctx.moveTo(hub.x, hub.y);
      ctx.lineTo(aPad.x, aPad.y);
      ctx.strokeStyle = keyColor(head.t, 0.45);
      ctx.lineWidth = 1.2;
      ctx.setLineDash([2, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Playhead bead on the spring (actual path orbit — may be outside wall)
    const pathRf = head.rf != null ? Math.max(0.32, head.rf) : 0.74;
    const bead = projectPipePoint(u, activeTh, layout, pathRf, off);
    ctx.beginPath();
    ctx.arc(bead.x, bead.y, 6.5 * (bead.scale || 1), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,244,214,0.95)';
    ctx.fill();
    ctx.strokeStyle = keyColor(head.t, 1);
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(bead.x, bead.y, 12 * (bead.scale || 1), 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,244,214,0.22)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Current chord badge — name + roman under the wheel hub
    const sample = head.sample;
    if (sample && sample.c) {
      const roman =
        sample.roman ||
        (activeSeat && activeSeat.roman) ||
        '';
      const name = chordDisplayName(sample.c);
      const line1 = name;
      const line2 = roman ? roman : '';
      const fs1 = 14 * Math.max(0.9, Math.min(1.4, sc));
      const fs2 = 11 * Math.max(0.9, Math.min(1.4, sc));
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '700 ' + fs1 + 'px DM Sans, system-ui, sans-serif';
      const w1 = ctx.measureText(line1).width;
      let w2 = 0;
      if (line2) {
        ctx.font = '600 ' + fs2 + 'px DM Sans, system-ui, sans-serif';
        w2 = ctx.measureText(line2).width;
      }
      const bw = Math.max(w1, w2) + 16;
      const bh = (line2 ? fs1 + fs2 + 10 : fs1 + 8) + 6;
      // Prefer below hub; nudge if bead is also below so they don't stack badly
      const beadBelow = bead.y > hub.y + 8;
      const cx = hub.x;
      const cy = beadBelow
        ? hub.y - 22 * sc - bh * 0.35
        : hub.y + 22 * sc + bh * 0.35;
      const br = 6;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(cx - bw / 2, cy - bh / 2, bw, bh, br);
      } else {
        ctx.rect(cx - bw / 2, cy - bh / 2, bw, bh);
      }
      ctx.fillStyle = 'rgba(10,9,8,0.9)';
      ctx.fill();
      ctx.strokeStyle = keyColor(head.t, 0.7);
      ctx.lineWidth = 1.4;
      ctx.stroke();

      const y1 = line2 ? cy - fs2 * 0.45 : cy;
      ctx.font = '700 ' + fs1 + 'px DM Sans, system-ui, sans-serif';
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(6,5,4,0.95)';
      ctx.lineJoin = 'round';
      ctx.strokeText(line1, cx, y1);
      ctx.fillStyle = 'rgba(255,252,245,1)';
      ctx.fillText(line1, cx, y1);
      if (line2) {
        const y2 = cy + fs1 * 0.45;
        ctx.font = '600 ' + fs2 + 'px DM Sans, system-ui, sans-serif';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(6,5,4,0.95)';
        ctx.strokeText(line2, cx, y2);
        ctx.fillStyle = keyColor(head.t, 0.95);
        ctx.fillText(line2, cx, y2);
      }
    }
  }

  function startSpiralPlayLoop() {
    if (spiralPlayRaf) return;
    function tick() {
      if (!playing) {
        spiralPlayRaf = 0;
        // final quiet redraw without playhead
        scheduleSpiralRedraw();
        return;
      }
      spiralPlayRaf = requestAnimationFrame(tick);
      // Full redraw keeps lighting/path correct with live wheel
      renderKeySpiral();
    }
    spiralPlayRaf = requestAnimationFrame(tick);
  }

  function stopSpiralPlayLoop() {
    if (spiralPlayRaf) {
      cancelAnimationFrame(spiralPlayRaf);
      spiralPlayRaf = 0;
    }
  }

  function depthAlpha(depth, layout, base) {
    // Fallback if only depth available
    const span = Math.max(80, (layout.zFar - layout.zNear) * 1.2 || 200);
    const t = Math.max(0, Math.min(1, 0.55 - depth / span));
    return Math.max(0.12, Math.min(1, base * (0.28 + 0.72 * t)));
  }
  function renderKeySpiral() {
    const canvas = $('#key-spiral');
    const legend = $('#spiral-legend');
    const meta = $('#spiral-meta');
    if (!canvas) return;

    const list = spiralFlatList();
    spiralHits = [];

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = canvas.clientWidth || 1200;
    const cssH = canvas.clientHeight || 640;
    const w = Math.max(200, Math.floor(cssW * dpr));
    const h = Math.max(160, Math.floor(cssH * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = cssW;
    const H = cssH;
    ctx.clearRect(0, 0, W, H);

    const home = homeTonic();
    const homeMode = (song.key && song.key.mode) || 'minor';
    const viewMode = getSpiralMode();
    const layout = buildPipeLayout(W, H, viewMode);
    const homeSeats = journeySeats(home, homeMode);

    // Soft tunnel vignette — journey down a pipe
    const vig = ctx.createRadialGradient(
      layout.cx,
      layout.cy,
      Math.min(W, H) * 0.12,
      layout.cx,
      layout.cy,
      Math.max(W, H) * 0.75
    );
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(0.5, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.58)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);

    const detail = spiralDetail();
    if (!list.length) {
      if (legend) legend.innerHTML = '';
      if (meta) meta.textContent = 'Empty form — load SoP full or multi-key demo.';
      spiralCache = null;
      return;
    }

    const n = list.length;
    // Key order → separate cylinder lanes (multi-key)
    const keyOrder = collectKeyOrder(list);

    // Soft solid cylinders per key (no ring stacks / mid-spine)
    keyOrder.forEach(function (tonic) {
      drawSoftCylinder(
        ctx,
        layout,
        diskWorldOffset(tonic, layout, keyOrder),
        tonic,
        tonic === home
      );
    });
    // Beat-weighted positions so the spring's length shape = harmonic rhythm
    let totalBeats = 0;
    const beatAt = list.map((row) => {
      const d = row.c && row.c.duration != null ? Number(row.c.duration) : 4;
      const b = Math.max(0.25, d);
      totalBeats += b;
      return totalBeats;
    });
    if (totalBeats < 1e-6) totalBeats = 1;

    // Build samples with continuous spring phase (always winds forward)
    let coilPhase = 0;
    const samples = list.map((row, i) => {
      const c = row.c;
      const t = chordKeyTonic(c);
      const mode = chordKeyMode(c);
      const hit = chordSeatHit(c);
      const theta =
        hit.seat && hit.seat.angle != null ? hit.seat.angle : chordWheelAngle(c);
      const rf = seatRingFrac(hit, c, t, mode);
      const dur = c.duration != null ? c.duration : 4;
      // Centre of this chord's timespan along the pipe
      const endB = beatAt[i];
      const startB = endB - Math.max(0.25, Number(dur) || 4);
      const uStart = n === 1 ? 0 : startB / totalBeats;
      const uEnd = n === 1 ? 1 : endB / totalBeats;
      const u = n === 1 ? 0.5 : (uStart + uEnd) / 2;
      if (i === 0) {
        coilPhase = theta;
      } else {
        coilPhase += springWindDelta(coilPhase, theta);
      }
      const off = diskWorldOffset(t, layout, keyOrder);
      const p = projectPipePoint(u, coilPhase, layout, rf, off);
      return {
        x: p.x,
        y: p.y,
        depth: p.depth,
        scale: p.scale,
        nearness: p.nearness,
        facing: p.facing,
        axial: p.axial,
        u: u,
        uStart: uStart,
        uEnd: uEnd,
        theta: theta,
        coilPhase: coilPhase,
        rf: rf,
        t: t,
        off: off,
        mode: mode,
        roman: (hit.seat && hit.seat.roman) || c.roman || '',
        c: c,
        absIndex: row.absIndex,
        i: i,
        dur: dur,
        r: (3.2 + Math.min(5, dur * 0.35) + (rf - 0.4) * 1.5) * p.scale,
        role: c._seam ? 'seam' : c._role || 'body',
      };
    });

    // Helix segments: interpolate continuous coilPhase
    const pathSegs = [];
    // Long songs: fewer interp steps so the path stays a clean spring, not scribble
    const longForm = samples.length > 48;
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1];
      const b = samples[i];
      const dPhase = b.coilPhase - a.coilPhase;
      const seatMove = Math.abs(dPhase) > 0.04;
      const keyMove = a.t !== b.t;
      const orbitMove = Math.abs(a.rf - b.rf) > 0.06;
      // Denser when zoomed; sparser for long flatten lists
      const stepBase = longForm
        ? 0.12 - detail * 0.04
        : 0.06 - detail * 0.035;
      const minSteps = longForm ? 6 + Math.round(detail * 8) : 12 + Math.round(detail * 20);
      const steps = Math.max(
        minSteps,
        Math.ceil(Math.abs(dPhase) / Math.max(0.03, stepBase)) +
          (keyMove ? (longForm ? 6 : 14) : 0) +
          (orbitMove ? 3 : 0)
      );
      const pts = [];
      for (let s = 0; s <= steps; s++) {
        const f = s / steps;
        const u = a.u + (b.u - a.u) * f;
        const th = a.coilPhase + dPhase * f;
        const rf = a.rf + (b.rf - a.rf) * f;
        // Hard-ish cylinder switch: ease through middle 30% of segment only
        let of;
        if (!keyMove) {
          of = a.off;
        } else {
          const tJump = f < 0.35 ? 0 : f > 0.65 ? 1 : (f - 0.35) / 0.3;
          const e = tJump * tJump * (3 - 2 * tJump); // smoothstep
          of = {
            x: (a.off.x || 0) + ((b.off.x || 0) - (a.off.x || 0)) * e,
            y: (a.off.y || 0) + ((b.off.y || 0) - (a.off.y || 0)) * e,
            z: (a.off.z || 0) + ((b.off.z || 0) - (a.off.z || 0)) * e,
          };
        }
        pts.push(projectPipePoint(u, th, layout, rf, of));
      }
      const avgD = pts.reduce((s, p) => s + p.depth, 0) / pts.length;
      pathSegs.push({
        pts: pts,
        depth: avgD,
        aT: a.t,
        bT: b.t,
        seatMove: seatMove,
        keyMove: keyMove,
        orbitMove: orbitMove,
        dPhase: dPhase,
      });
    }
    // Paint order: darkest rear first → lit front last (rendered object)
    pathSegs.sort((a, b) => {
      const fa = a.pts[0] ? (a.pts[0].facing || 0) * 0.5 + (a.pts[0].axial || 0) * 0.5 : 0;
      const fb = b.pts[0] ? (b.pts[0].facing || 0) * 0.5 + (b.pts[0].axial || 0) * 0.5 : 0;
      return fa - fb;
    });
    pathSegs.forEach((seg) => {
      const pts = seg.pts;
      if (pts.length < 2) return;
      const baseW = seg.keyMove
        ? 5.2
        : Math.abs(seg.dPhase) > 1
          ? 4.8
          : seg.seatMove || seg.orbitMove
            ? 4.2
            : 3.4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const mid = {
          scale: (a.scale + b.scale) / 2,
          nearness: ((a.nearness || 0) + (b.nearness || 0)) / 2,
          facing: ((a.facing || 0) + (b.facing || 0)) / 2,
          axial: ((a.axial || 0) + (b.axial || 0)) / 2,
          depth: (a.depth + b.depth) / 2,
        };
        const f = i / pts.length;
        const useTon = seg.keyMove && f > 0.5 ? seg.bT : seg.aT;
        const cue = depthCue(mid, layout, 1, baseW);

        // Dark under-stroke (body of the tube filament)
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = 'rgba(0,0,0,' + (0.35 * cue.alpha) + ')';
        ctx.lineWidth = cue.width * 1.55;
        ctx.shadowBlur = 0;
        ctx.stroke();

        // Lit colour stroke
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = keyColor(useTon, cue.alpha);
        ctx.lineWidth = cue.width;
        if (cue.facing > 0.55 && cue.axial > 0.35) {
          ctx.shadowColor = keyColor(useTon, 0.4 * cue.facing);
          ctx.shadowBlur = 3 + 10 * cue.facing * cue.axial;
        } else {
          ctx.shadowBlur = 0;
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Specular ridge on front-facing near coils
        if (cue.facing > 0.62 && cue.axial > 0.4) {
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle =
            'rgba(255,244,220,' + (0.08 + 0.22 * cue.facing * cue.axial) + ')';
          ctx.lineWidth = Math.max(0.6, cue.width * 0.28);
          ctx.stroke();
        }
      }
    });

    // Nodes + chord names (dim in the distance, clear up close)
    const keySet = new Map();
    const nodes = samples
      .slice()
      .sort((a, b) => (a.facing || 0) + (a.axial || 0) - ((b.facing || 0) + (b.axial || 0)));
    nodes.forEach((p) => {
      const isPlay = playing && p.absIndex === playIndex;
      const cue = depthCue(p, layout, isPlay ? 1 : 0.9, p.r * 0.85);
      const al = cue.alpha;
      const axial = p.axial != null ? p.axial : 0.5;
      // Very far start: keep hit target, skip almost-invisible beads
      if (al < 0.08 && !isPlay) {
        spiralHits.push({ x: p.x, y: p.y, r: 6, absIndex: p.absIndex });
        return;
      }
      const nodeR = Math.max(1.4, cue.width * 0.42 + (isPlay ? 2.2 : 0));

      ctx.beginPath();
      ctx.ellipse(
        p.x,
        p.y + nodeR * 0.45,
        nodeR * 0.9,
        nodeR * 0.35,
        0,
        0,
        Math.PI * 2
      );
      ctx.fillStyle = 'rgba(0,0,0,' + 0.35 * al + ')';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(p.x, p.y, nodeR, 0, Math.PI * 2);
      ctx.fillStyle = keyColor(p.t, al);
      ctx.fill();
      if (cue.facing > 0.5) {
        ctx.beginPath();
        ctx.arc(
          p.x - nodeR * 0.25,
          p.y - nodeR * 0.28,
          nodeR * 0.35,
          0,
          Math.PI * 2
        );
        ctx.fillStyle = 'rgba(255,250,240,' + (0.12 + 0.32 * cue.facing) + ')';
        ctx.fill();
      }
      if (isPlay) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(255,244,214,0.9)';
        ctx.stroke();
      }

      // Chord names: sparse on long forms; denser only when zoomed
      const nSamp = samples.length;
      const everyN =
        nSamp > 80
          ? detail > 0.7
            ? 4
            : 10
          : nSamp > 40
            ? detail > 0.7
              ? 2
              : 6
            : detail > 0.75
              ? 1
              : detail > 0.45
                ? 2
                : detail > 0.2
                  ? 3
                  : 5;
      const minAl = nSamp > 40 ? 0.18 - detail * 0.05 : 0.1 - detail * 0.04;
      const keyOrSeatChange =
        p.i > 0 &&
        (samples[p.i - 1].t !== p.t ||
          Math.abs(samples[p.i - 1].theta - p.theta) > 0.2);
      const showLab =
        isPlay ||
        p.i === 0 ||
        p.i === samples.length - 1 ||
        keyOrSeatChange ||
        (p.i % everyN === 0 && axial > 0.22);
      if (showLab && al > minAl) {
        const labA = Math.min(
          1,
          al * (0.35 + 0.7 * axial) * (0.55 + 0.45 * detail)
        );
        const showRoman = detail > 0.55 && p.roman && nSamp < 60;
        ctx.fillStyle = 'rgba(235,228,216,' + labA + ')';
        ctx.font =
          (isPlay
            ? '600 11px'
            : axial < 0.35
              ? '500 8px'
              : detail > 0.5
                ? '500 10px'
                : '500 9px') + ' DM Sans, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const lab =
          chordDisplayName(p.c) + (showRoman ? ' ' + p.roman : '');
        // Halo so labels don't dissolve into the path
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(8,7,6,' + Math.min(0.9, labA + 0.2) + ')';
        ctx.lineJoin = 'round';
        ctx.strokeText(lab, p.x, p.y - nodeR - 3);
        ctx.fillText(lab, p.x, p.y - nodeR - 3);
        if (detail > 0.75 && p.dur != null && al > 0.3 && nSamp < 50) {
          ctx.font = '500 8px DM Sans, system-ui, sans-serif';
          ctx.fillStyle = 'rgba(180,170,155,' + labA * 0.75 + ')';
          ctx.fillText(p.dur + 'b', p.x, p.y - nodeR - 14);
        }
      }

      spiralHits.push({
        x: p.x,
        y: p.y,
        r: nodeR + 10,
        absIndex: p.absIndex,
      });
      const id = p.t + ':' + (p.mode || '');
      if (!keySet.has(id)) keySet.set(id, { tonic: p.t, mode: p.mode });
    });

    // Journey wheel rides the playhead while playing only.
    // Idle: a quiet near-mouth hub (full wheel at START stacked ring clutter on SoP).
    const head = getSpiralPlayhead(samples, keyOrder, layout);
    if (head) {
      drawMovingJourneyWheel(ctx, layout, head, keyOrder, homeSeats);
    } else {
      const idleOff = diskWorldOffset(home, layout, keyOrder);
      const mouth = projectPipeCenter(0.92, layout, idleOff);
      const sc = mouth.scale || 1;
      ctx.beginPath();
      ctx.arc(mouth.x, mouth.y, 4.5 * sc, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,244,214,0.55)';
      ctx.fill();
      ctx.strokeStyle = keyColor(home, 0.45);
      ctx.lineWidth = 1.2;
      ctx.stroke();
      // Faint mouth ring only (one ellipse, not a journey seat fan)
      const mouthPts = [];
      for (let i = 0; i <= 36; i++) {
        const th = -Math.PI / 2 + (i / 36) * Math.PI * 2;
        mouthPts.push(projectPipePoint(0.92, th, layout, 0.68, idleOff));
      }
      ctx.beginPath();
      mouthPts.forEach(function (p, i) {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.strokeStyle = keyColor(home, 0.14);
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // START / END captions
    ctx.fillStyle = 'rgba(149,137,122,0.8)';
    ctx.font = '600 11px DM Sans, system-ui, sans-serif';
    ctx.textAlign = 'center';
    const capFar = projectPipePoint(0, Math.PI / 2, layout, 0.74);
    const capNear = projectPipePoint(1, Math.PI / 2, layout, 0.74);
    ctx.fillText('START', capFar.x, Math.min(H - 22, capFar.y + 20));
    ctx.fillText('END', capNear.x, Math.min(H - 22, capNear.y + 20));

    spiralCache = {
      samples: samples,
      keyOrder: keyOrder,
      totalBeats: totalBeats,
    };

    if (legend) {
      legend.innerHTML = '';
      keySet.forEach((k) => {
        const el = document.createElement('span');
        el.className = 'leg';
        el.innerHTML =
          '<span class="swatch" style="background:' +
          keyColorSolid(k.tonic) +
          '"></span>' +
          escapeAttr(keyLabel(k.tonic, k.mode)) +
          ' cylinder';
        legend.appendChild(el);
      });
      const wleg = document.createElement('span');
      wleg.className = 'leg';
      wleg.innerHTML =
        '<span class="swatch" style="background:#fff4d6;border-color:#c4a574"></span>now wheel';
      legend.appendChild(wleg);
    }

    if (meta) {
      const keyMods = samples.filter((p, i) => i > 0 && samples[i - 1].t !== p.t).length;
      const coils = pathSegs.reduce(
        (s, seg) => s + Math.abs(seg.dPhase) / (Math.PI * 2),
        0
      );
      let nowTxt = '';
      if (head && head.sample) {
        nowTxt =
          ' · now ' +
          chordDisplayName(head.sample.c) +
          ' @ ' +
          Math.round(head.u * 100) +
          '%';
      }
      meta.textContent =
        n +
        ' nodes · ~' +
        coils.toFixed(1) +
        ' coils · ' +
        keyOrder.length +
        ' cylinder(s) [' +
        keyOrder
          .map((t) => keyLabel(t, t === home ? homeMode : 'major'))
          .join(' · ') +
        '] · ' +
        keyMods +
        ' key jump(s)' +
        nowTxt;
    }
  }

  function drawTubeShell(ctx, layout, seats, which) {
    const us = [0, 0.25, 0.5, 0.75, 1];
    us.forEach(function (u) {
      const pts = [];
      for (let i = 0; i <= 48; i++) {
        const th = -Math.PI / 2 + (i / 48) * Math.PI * 2;
        pts.push(projectPipePoint(u, th, layout, 0.74));
      }
      if (which === 'back') {
        ctx.beginPath();
        pts.forEach(function (p, i) {
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.closePath();
        ctx.fillStyle = 'rgba(40,32,24,' + (0.03 + 0.04 * (1 - u)) + ')';
        ctx.fill();
      }
    });
    if (which === 'front') {
      [-Math.PI / 2, Math.PI / 2].forEach(function (th) {
        ctx.beginPath();
        for (let s = 0; s <= 32; s++) {
          const p = projectPipePoint(s / 32, th, layout, 0.74);
          if (s === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.strokeStyle = 'rgba(232,201,138,0.18)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      });
    }
  }
function spiralCanvasClick(ev) {
    const canvas = $('#key-spiral');
    if (!canvas || !spiralHits.length) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * (canvas.clientWidth || rect.width);
    const y = ((ev.clientY - rect.top) / rect.height) * (canvas.clientHeight || rect.height);
    let best = null;
    let bestD = 1e9;
    spiralHits.forEach((h) => {
      const d = Math.hypot(h.x - x, h.y - y);
      if (d <= h.r && d < bestD) {
        bestD = d;
        best = h;
      }
    });
    if (best) playFromFlatIndex(best.absIndex);
  }

  function renderPipes() {
    const flow = $('#pipe-flow');
    const meta = $('#pipe-meta');
    if (!flow) return;
    flow.innerHTML = '';
    const sec = song.arrangement.find((s) => s.id === selectedSecId);
    if (!sec) {
      if (meta) meta.textContent = 'Select a section to see body → end → into → seam → next';
      return;
    }
    const chain = S().sectionChain(sec);
    const bodyNames = chain.map((id) => (song.cells[id] ? song.cells[id].name : '?')).join(' → ');
    const next = song.arrangement[song.arrangement.indexOf(sec) + 1];
    const seam = sec.seam || { type: 'none' };

    function node(text, cls) {
      const el = document.createElement('span');
      el.className = 'pipe-node' + (cls ? ' ' + cls : '');
      el.textContent = text;
      return el;
    }
    function arrow() {
      const el = document.createElement('span');
      el.className = 'pipe-arrow';
      el.textContent = '→';
      return el;
    }

    flow.appendChild(node((sec.reps || 1) + '× body: ' + (bodyNames || '—'), ''));
    if (sec.endCellId && song.cells[sec.endCellId]) {
      flow.appendChild(arrow());
      flow.appendChild(node('end: ' + song.cells[sec.endCellId].name, 'end'));
    } else {
      flow.appendChild(arrow());
      flow.appendChild(node('end: (same body)', 'muted'));
    }
    if (sec.intoCellId && song.cells[sec.intoCellId]) {
      flow.appendChild(arrow());
      flow.appendChild(node('into: ' + song.cells[sec.intoCellId].name, 'into'));
    }
    flow.appendChild(arrow());
    const seamLabel =
      'seam: ' +
      (seam.type || 'none') +
      (seam.chords && seam.chords.length
        ? ' [' + seam.chords.map((c) => chordDisplayName(c)).join(' ') + ']'
        : '');
    flow.appendChild(node(seamLabel, 'seam'));
    if (next) {
      flow.appendChild(arrow());
      flow.appendChild(node('next: ' + (next.name || ''), ''));
    } else {
      flow.appendChild(arrow());
      flow.appendChild(node('end of form', 'muted'));
    }

    const bars = S().sectionBars(song, sec);
    if (meta) {
      meta.textContent =
        sec.name +
        ' · ' +
        (bars % 1 === 0 ? bars : bars.toFixed(1)) +
        ' bars · last rep uses End · Into plays once after all reps · Seam only between sections';
    }
  }

  function renderFocus() {
    const sec = song.arrangement.find((s) => s.id === selectedSecId);
    if (!sec) {
      $('#focus-title').textContent = 'No section selected';
      $('#focus-chords').textContent = '—';
      return;
    }
    const chain = S().sectionChain(sec);
    const bars = S().sectionBars(song, sec);
    const names = chain.map((id) => (song.cells[id] ? song.cells[id].name : '?')).join(' → ');
    const endBit =
      sec.endCellId && song.cells[sec.endCellId]
        ? ' · end ' + song.cells[sec.endCellId].name
        : '';
    const intoBit =
      sec.intoCellId && song.cells[sec.intoCellId]
        ? ' · into ' + song.cells[sec.intoCellId].name
        : '';
    $('#focus-title').textContent = `${sec.name} · ${names}${endBit}${intoBit} · ${bars % 1 === 0 ? bars : bars.toFixed(1)} bars (${sec.reps || 1}×)`;
    const labels = chain.map((id) => (song.cells[id] ? cellLabel(song.cells[id]) : '')).filter(Boolean);
    if (sec.endCellId && song.cells[sec.endCellId]) {
      labels.push('END: ' + cellLabel(song.cells[sec.endCellId]));
    }
    if (sec.intoCellId && song.cells[sec.intoCellId]) {
      labels.push('INTO: ' + cellLabel(song.cells[sec.intoCellId]));
    }
    $('#focus-chords').textContent = labels.join('  |  ') || 'Empty';
  }

  function escapeAttr(s) {
    return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  // ─── Play / export ───────────────────────────────────────
  function sessionChordToPlayable(c) {
    const opts = { duration: c.duration || 4 };
    if (c.notes && c.notes.length) opts.notes = c.notes;
    if (c.custom || c.quality === 'custom') opts.custom = true;
    if (c.name) opts.name = c.name;
    let ch = M().makeChord(c.root, c.quality || 'maj', opts);
    if (c.bass != null && c.bass !== c.root && window.HLCompose && HLCompose.withBass) {
      ch = HLCompose.withBass(ch, c.bass);
      ch.duration = c.duration || 4;
    }
    ch._section = c._section || '';
    ch._cell = c._cell || '';
    ch._seam = !!c._seam;
    ch._rep = c._rep;
    ch._version = c._version;
    return ch;
  }

  function buildPlayList(fromSectionId, opts) {
    opts = opts || {};
    let flat = S().flattenArrangement(song);
    if (!flat.length) return { list: [], start: 0, totalBeats: 0 };

    let start = 0;
    if (fromSectionId) {
      const sec = song.arrangement.find((s) => s.id === fromSectionId);
      const sid = sec && sec.id;
      const name = sec ? sec.name : null;
      const matchSec = function (c) {
        if (sid && c._sectionId) return c._sectionId === sid;
        return name && c._section === name;
      };
      if (sid || name) {
        if (opts.sectionOnly) {
          flat = flat.filter(function (c) {
            return matchSec(c) && !c._seam;
          });
          start = 0;
        } else {
          const idx = flat.findIndex(function (c) {
            return matchSec(c) && !c._seam;
          });
          if (idx >= 0) start = idx;
        }
      }
    }

    let totalBeats = 0;
    const list = flat.map((c) => {
      totalBeats += c.duration || 4;
      return sessionChordToPlayable(c);
    });
    // beats before start
    let pre = 0;
    for (let i = 0; i < start; i++) pre += list[i].duration || 4;

    return { list, start, totalBeats, preBeats: pre };
  }

  function formatTime(beats, bpm) {
    const sec = (beats * 60) / (bpm || 96);
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ':' + String(s).padStart(2, '0');
  }

  function updatePositionUI(index, ch) {
    const bpm = song.bpm || 96;
    const loop = $('#play-loop') && $('#play-loop').checked;

    if (index < 0 || !ch) {
      $('#pos-main').textContent = playing ? 'Playing…' : 'Stopped';
      $('#pos-sub').textContent = '—';
      $('#pos-bar-fill').style.width = '0%';
      $('#pos-bar-head').style.left = '0%';
      $('#pos-time').textContent = '0:00 / ' + formatTime(playTotalBeats, bpm);
      const ph = $('#tl-playhead');
      if (ph) {
        ph.classList.remove('on');
        ph.style.left = '0%';
      }
      document.querySelectorAll('tr.playing-sec').forEach((tr) => tr.classList.remove('playing-sec'));
      return;
    }

    // Accumulated beats at start of this chord
    let acc = playAccumBeats;
    const pct = playTotalBeats > 0 ? Math.min(100, (acc / playTotalBeats) * 100) : 0;
    const endPct =
      playTotalBeats > 0
        ? Math.min(100, ((acc + (ch.duration || 4)) / playTotalBeats) * 100)
        : 0;

    const secLabel = ch._seam ? 'Seam' : ch._section || '—';
    const cellLabelTxt = ch._cell || '';
    const chordName = ch.name || '';
    const n = index + 1;
    const total = playList.length;

    $('#pos-main').textContent = `${secLabel}${cellLabelTxt && !ch._seam ? ' · ' + cellLabelTxt : ''} · ${chordName}`;
    $('#pos-sub').textContent = `Chord ${n} of ${total}${ch._seam ? ' · transition' : ''}${loop ? ' · LOOP' : ''}`;
    $('#pos-bar-fill').style.width = endPct + '%';
    $('#pos-bar-head').style.left = pct + '%';
    $('#pos-time').textContent =
      formatTime(acc, bpm) + ' / ' + formatTime(playTotalBeats, bpm);

    const ph = $('#tl-playhead');
    if (ph) {
      ph.classList.add('on');
      ph.style.left = pct + '%';
    }

    // Highlight section row
    document.querySelectorAll('tr.playing-sec').forEach((tr) => tr.classList.remove('playing-sec'));
    if (ch._section && !ch._seam) {
      document.querySelectorAll('#form-body tr[data-id]').forEach((tr) => {
        const sec = song.arrangement.find((s) => s.id === tr.dataset.id);
        if (sec && sec.name === ch._section) tr.classList.add('playing-sec');
      });
    }

    // Select section in UI for context
    if (ch._section && !ch._seam) {
      const sec = song.arrangement.find((s) => s.name === ch._section);
      if (sec && sec.id !== selectedSecId) {
        selectedSecId = sec.id;
        // light update of focus strip without full re-render (avoids killing play)
        const chain = S().sectionChain(sec);
        const names = chain.map((id) => (song.cells[id] ? song.cells[id].name : '?')).join(' → ');
        $('#focus-title').textContent = `▶ ${sec.name} · ${names}`;
      }
    }
  }

  function stopPlay() {
    if (A() && A().stopPlayback) A().stopPlayback();
    playing = false;
    playIndex = -1;
    playList = [];
    playAccumBeats = 0;
    stopSpiralPlayLoop();
    updateTransportButtons();
    updatePositionUI(-1, null);
    scheduleSpiralRedraw();
  }

  function updateTransportButtons() {
    const playBtn = $('#btn-play');
    if (playBtn) playBtn.textContent = playing ? '▶ Playing…' : '▶ Play';
    const stopBtn = $('#btn-stop');
    if (stopBtn) stopBtn.disabled = !playing;
  }

  function startPlay(fromSection, opts) {
    opts = opts || {};
    if (!A() || !M()) {
      alert('Audio/music engines not loaded.');
      return;
    }
    if (playing) {
      stopPlay();
    }

    const fromId = fromSection ? selectedSecId : null;
    const built = buildPlayList(fromId, opts);
    if (!built.list.length) {
      alert('Nothing to play — add sections with chords.');
      return;
    }

    playList = built.list;
    playStartOffset = built.start || 0;
    playTotalBeats = built.totalBeats;
    playAccumBeats = built.preBeats || 0;

    // Slice from start for playback
    const slice = playList.slice(playStartOffset);
    // Recompute total for progress within full song still uses playTotalBeats
    // But position index needs offset
    const bpm = song.bpm || 96;
    const loop = $('#play-loop') && $('#play-loop').checked;
    const pulse = !$('#play-pulse') || $('#play-pulse').checked;

    A().ensure();
    playing = true;
    updateTransportButtons();
    startSpiralPlayLoop();

    let localI = 0;
    A().playSequence(slice, bpm, {
      loop: !!loop,
      pulse: !!pulse,
      onStep: (i, ch) => {
        playIndex = playStartOffset + i;
        // beats at start of this chord = pre + sum of slice[0..i)
        let acc = built.preBeats || 0;
        for (let k = 0; k < i; k++) acc += slice[k].duration || 4;
        playAccumBeats = acc;
        updatePositionUI(playIndex, ch);
        renderFormStripPlayingOnly();
        localI = i;
      },
      onLoop: () => {
        playAccumBeats = built.preBeats || 0;
      },
      onEnd: () => {
        playing = false;
        playIndex = -1;
        stopSpiralPlayLoop();
        updateTransportButtons();
        updatePositionUI(-1, null);
        renderFormStrip();
        scheduleSpiralRedraw();
        $('#pos-main').textContent = 'Finished';
      },
    });
  }

  function playSong() {
    if (playing) {
      stopPlay();
      return;
    }
    startPlay(false);
  }

  function playFromSection() {
    if (!selectedSecId) {
      alert('Select a section in the form first.');
      return;
    }
    if (playing) stopPlay();
    startPlay(true);
  }

  function playThisSection() {
    if (!selectedSecId) {
      alert('Select a section in the form first.');
      return;
    }
    if (playing) stopPlay();
    startPlay(true, { sectionOnly: true });
    setStatus('Playing this section only');
  }

  /** Play full song starting at flattened chord index */
  function playFromFlatIndex(flatIndex) {
    if (!A() || !M()) {
      alert('Audio/music engines not loaded.');
      return;
    }
    if (playing) stopPlay();
    const built = buildPlayList(null);
    if (!built.list.length) {
      alert('Nothing to play.');
      return;
    }
    const start = Math.max(0, Math.min(built.list.length - 1, flatIndex | 0));
    playList = built.list;
    playStartOffset = start;
    playTotalBeats = built.totalBeats;
    let pre = 0;
    for (let i = 0; i < start; i++) pre += playList[i].duration || 4;
    playAccumBeats = pre;

    const slice = playList.slice(start);
    const bpm = song.bpm || 96;
    const loop = $('#play-loop') && $('#play-loop').checked;
    const pulse = !$('#play-pulse') || $('#play-pulse').checked;

    A().ensure();
    playing = true;
    updateTransportButtons();
    startSpiralPlayLoop();
    A().playSequence(slice, bpm, {
      loop: !!loop,
      pulse: !!pulse,
      onStep: (i, ch) => {
        playIndex = start + i;
        let acc = pre;
        for (let k = 0; k < i; k++) acc += slice[k].duration || 4;
        playAccumBeats = acc;
        updatePositionUI(playIndex, ch);
        renderFormStripPlayingOnly();
      },
      onLoop: () => {
        playAccumBeats = pre;
      },
      onEnd: () => {
        playing = false;
        playIndex = -1;
        stopSpiralPlayLoop();
        updateTransportButtons();
        updatePositionUI(-1, null);
        renderFormStrip();
        scheduleSpiralRedraw();
        $('#pos-main').textContent = 'Finished';
      },
    });
  }

  function renderFormStripPlayingOnly() {
    const host = $('#form-strip');
    if (!host) return;
    host.querySelectorAll('.strip-chip').forEach((el, i) => {
      if (i === playIndex) el.classList.add('playing');
      else el.classList.remove('playing');
    });
    // Light spiral refresh for playhead (throttled via rAF)
    if (spiralRaf) cancelAnimationFrame(spiralRaf);
    spiralRaf = requestAnimationFrame(() => {
      spiralRaf = 0;
      renderKeySpiral();
    });
  }

  function exportFlatJson() {
    const flat = S().flattenArrangement(song);
    if (!flat.length) {
      alert('Nothing to export.');
      return;
    }
    const payload = {
      format: 'idlehanz-flat-chords',
      version: 1,
      title: song.title || 'Untitled',
      bpm: song.bpm || 96,
      key: song.key || { tonic: 11, mode: 'minor' },
      totalBars: S().totalBars(song),
      chords: flat.map((c) => ({
        root: c.root,
        quality: c.quality,
        duration: c.duration != null ? c.duration : 4,
        bass: c.bass != null ? c.bass : c.root,
        name: c.name || chordDisplayName(c),
        roman: c.roman || '',
        localTonic: c.localTonic,
        localMode: c.localMode,
        notes: c.notes || null,
        section: c._section || '',
        cell: c._cell || '',
        role: c._seam ? 'seam' : c._role || 'body',
        rep: c._rep,
      })),
    };
    const text = JSON.stringify(payload, null, 2);
    if ($('#export-out')) $('#export-out').value = text;
    const name = (song.title || 'song').replace(/[^\w\-]+/g, '-').toLowerCase() + '-flat.json';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    setStatus('Exported flat · ' + payload.chords.length + ' chords · ' + name);
  }

  function exportMidi() {
    const flat = S().flattenArrangement(song);
    if (!flat.length) {
      alert('Nothing to export.');
      return;
    }
    if (!M()) {
      alert('music.js not loaded.');
      return;
    }
    const chords = flat.map((c) => sessionChordToPlayable(c));
    const bytes = buildMidi(chords, song.bpm || 96);
    const name = (song.title || 'song').replace(/[^\w\-]+/g, '-') + '-chords.mid';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: 'audio/midi' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    setStatus('Exported ' + name);
  }

  function exportText() {
    const lines = [
      `# ${song.title || 'Untitled'}`,
      `BPM: ${song.bpm} · Key: ${$('#key-label').textContent}`,
      `Total bars: ${S().totalBars(song)}`,
      '',
    ];
    song.arrangement.forEach((sec, i) => {
      const chain = S().sectionChain(sec);
      const bars = S().sectionBars(song, sec);
      const names = chain.map((id) => (song.cells[id] ? song.cells[id].name : '?')).join(' → ');
      lines.push(`## ${i + 1}. ${sec.name} — ${names} ×${sec.reps || 1} (${bars} bars)`);
      chain.forEach((cid) => {
        const cell = song.cells[cid];
        if (cell && cell.chords) {
          lines.push('### ' + (cell.name || cid));
          lines.push(cellLabel(cell));
        }
      });
      if (sec.endCellId && song.cells[sec.endCellId]) {
        lines.push('End (last rep): ' + song.cells[sec.endCellId].name + ' · ' + cellLabel(song.cells[sec.endCellId]));
      }
      if (sec.intoCellId && song.cells[sec.intoCellId]) {
        lines.push('Into: ' + song.cells[sec.intoCellId].name + ' · ' + cellLabel(song.cells[sec.intoCellId]));
      }
      if (sec.seam && sec.seam.type && sec.seam.type !== 'none') {
        lines.push('Seam: ' + sec.seam.type + (sec.seam.chords && sec.seam.chords.length ? ' · ' + sec.seam.chords.map((c) => c.quality).join(' ') : ''));
      }
      lines.push('');
    });
    const text = lines.join('\n');
    $('#export-out').value = text;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = (song.title || 'song').replace(/[^\w\-]+/g, '-') + '-form.txt';
    a.click();
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

  function wire() {
    fillKeySelects();
    $('#song-title').addEventListener('change', () => save());
    $('#bpm').addEventListener('change', () => save());
    if ($('#song-tonic')) {
      $('#song-tonic').addEventListener('change', () => {
        save();
        updateKeyLabel();
      });
    }
    if ($('#song-mode')) {
      $('#song-mode').addEventListener('change', () => {
        save();
        updateKeyLabel();
      });
    }
    if ($('#song-notes')) {
      $('#song-notes').addEventListener('change', () => save());
    }
    $('#btn-add-sec').addEventListener('click', addSection);
    if ($('#btn-dup-sec')) $('#btn-dup-sec').addEventListener('click', duplicateSection);
    $('#btn-new-cell').addEventListener('click', newCell);
    if ($('#btn-chain-family')) $('#btn-chain-family').addEventListener('click', chainFamilyIntoSection);
    $('#btn-refresh').addEventListener('click', () => {
      load();
      render();
      setStatus('Refreshed from session');
    });
    if ($('#btn-import-hl')) {
      $('#btn-import-hl').addEventListener('click', () => {
        const inp = $('#hl-file-input');
        if (inp) inp.click();
      });
    }
    if ($('#hl-file-input')) {
      $('#hl-file-input').addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        if (f) importHlAsCell(f);
        e.target.value = '';
      });
    }
    $('#btn-landscape').addEventListener('click', () => {
      const id = song.focus && song.focus.cellId;
      if (id) openLandscapeForCell(id);
      else if (S().goTo) S().goTo(S().PATHS.landscapeFromArrangement);
      else window.location.href = S().PATHS.landscapeFromArrangement;
    });
    $('#btn-fretboard').addEventListener('click', () => {
      const id = song.focus && song.focus.cellId;
      if (id) openFretboardForCell(id);
      else if (S().goTo) S().goTo(S().PATHS.fretboardFromArrangement);
      else window.location.href = S().PATHS.fretboardFromArrangement;
    });
    $('#btn-focus-land').addEventListener('click', () => {
      const sec = song.arrangement.find((s) => s.id === selectedSecId);
      if (sec) openLandscapeForCell(sec.cellId);
      else if (song.focus && song.focus.cellId) openLandscapeForCell(song.focus.cellId);
    });
    $('#btn-focus-fret').addEventListener('click', () => {
      const sec = song.arrangement.find((s) => s.id === selectedSecId);
      if (sec) openFretboardForCell(sec.cellId);
      else if (song.focus && song.focus.cellId) openFretboardForCell(song.focus.cellId);
    });
    $('#btn-play').addEventListener('click', playSong);
    if ($('#btn-play-from')) $('#btn-play-from').addEventListener('click', playFromSection);
    if ($('#btn-play-section')) $('#btn-play-section').addEventListener('click', playThisSection);
    if ($('#btn-form-undo')) $('#btn-form-undo').addEventListener('click', undoForm);
    if ($('#btn-stop')) $('#btn-stop').addEventListener('click', stopPlay);
    document.addEventListener('keydown', function (e) {
      if (e.target && e.target.matches && e.target.matches('input, textarea, select')) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoForm();
      }
    });
    $('#btn-midi').addEventListener('click', exportMidi);
    $('#btn-text').addEventListener('click', exportText);
    if ($('#btn-export-flat')) $('#btn-export-flat').addEventListener('click', exportFlatJson);
    if ($('#btn-save-song')) $('#btn-save-song').addEventListener('click', saveSongPackage);
    if ($('#btn-load-song')) {
      $('#btn-load-song').addEventListener('click', () => {
        const inp = $('#song-file-input');
        if (inp) inp.click();
      });
    }
    if ($('#song-file-input')) {
      $('#song-file-input').addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        if (f) loadSongPackageFile(f);
        e.target.value = '';
      });
    }
    // Drop a .song.json anywhere on the page to load it
    document.addEventListener('dragover', function (e) {
      if (!e.dataTransfer) return;
      const types = e.dataTransfer.types;
      if (types && (types.indexOf('Files') >= 0 || types.contains && types.contains('Files'))) {
        e.preventDefault();
      }
    });
    document.addEventListener('drop', function (e) {
      const files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;
      const f = files[0];
      const name = (f.name || '').toLowerCase();
      if (!name.endsWith('.json') && f.type !== 'application/json') return;
      e.preventDefault();
      // Prefer song packages over landscape projects when dropped
      if (name.indexOf('.hl.') >= 0 || name.endsWith('.hl.json')) {
        importHlAsCell(f);
      } else {
        loadSongPackageFile(f);
      }
    });
    if ($('#btn-sop-demo')) $('#btn-sop-demo').addEventListener('click', loadSpeedOfPainDemo);
    if ($('#btn-multikey-demo')) {
      $('#btn-multikey-demo').addEventListener('click', loadMultiKeyDemo);
    }
    // Key pipe controls
    ['spiral-mode-side', 'spiral-mode-end', 'spiral-section-only'].forEach((id) => {
      const el = $('#' + id);
      if (el) el.addEventListener('change', () => renderKeySpiral());
    });
    if ($('#spiral-zoom-in')) {
      $('#spiral-zoom-in').addEventListener('click', () => setSpiralZoom(spiralZoom * 1.18));
    }
    if ($('#spiral-zoom-out')) {
      $('#spiral-zoom-out').addEventListener('click', () => setSpiralZoom(spiralZoom / 1.18));
    }
    if ($('#spiral-zoom-reset')) {
      $('#spiral-zoom-reset').addEventListener('click', () => resetSpiralView());
    }
    if ($('#spiral-fs-btn')) {
      $('#spiral-fs-btn').addEventListener('click', () => toggleSpiralFullscreen());
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isSpiralFullscreen()) {
        e.preventDefault();
        setSpiralFullscreen(false);
      } else if (
        (e.key === 'f' || e.key === 'F') &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !(e.target && e.target.matches && e.target.matches('input, textarea, select'))
      ) {
        // F toggles pipe full screen when not typing
        if ($('#spiral-panel')) {
          e.preventDefault();
          toggleSpiralFullscreen();
        }
      }
    });
    syncSpiralZoomLabel();
    const spiralCanvas = $('#key-spiral');
    if (spiralCanvas) {
      // Click plays chord only if we didn't pan
      spiralCanvas.addEventListener('click', function (e) {
        if (spiralDrag && spiralDrag.moved) return;
        spiralCanvasClick(e);
      });
      spiralCanvas.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        spiralDrag = {
          x0: e.clientX,
          y0: e.clientY,
          pan0x: spiralPanX,
          pan0y: spiralPanY,
          moved: false,
          id: e.pointerId,
        };
        try {
          spiralCanvas.setPointerCapture(e.pointerId);
        } catch (_) {
          /* ignore */
        }
      });
      spiralCanvas.addEventListener('pointermove', function (e) {
        if (!spiralDrag || spiralDrag.id !== e.pointerId) return;
        const dx = e.clientX - spiralDrag.x0;
        const dy = e.clientY - spiralDrag.y0;
        if (Math.hypot(dx, dy) > 4) spiralDrag.moved = true;
        if (spiralDrag.moved) {
          spiralPanX = spiralDrag.pan0x + dx;
          spiralPanY = spiralDrag.pan0y + dy;
          scheduleSpiralRedraw();
        }
      });
      function endPan(e) {
        if (!spiralDrag || (e && spiralDrag.id !== e.pointerId)) return;
        const wasMoved = spiralDrag.moved;
        spiralDrag = null;
        // swallow click after drag via moved flag checked on click
        if (wasMoved) {
          e && e.preventDefault && e.preventDefault();
        }
      }
      spiralCanvas.addEventListener('pointerup', endPan);
      spiralCanvas.addEventListener('pointercancel', endPan);
      // Wheel zooms toward cursor (no modifier required over canvas)
      spiralCanvas.addEventListener(
        'wheel',
        function (e) {
          e.preventDefault();
          const rect = spiralCanvas.getBoundingClientRect();
          const ax = e.clientX - rect.left - rect.width / 2;
          const ay = e.clientY - rect.top - rect.height / 2;
          const factor = e.deltaY > 0 ? 1 / 1.1 : 1.1;
          setSpiralZoom(spiralZoom * factor, { anchorX: ax, anchorY: ay });
        },
        { passive: false }
      );
      spiralCanvas.addEventListener('dblclick', function () {
        resetSpiralView();
      });
      window.addEventListener('resize', () => {
        scheduleSpiralRedraw();
      });
    }
    updateTransportButtons();
    updatePositionUI(-1, null);

    document.addEventListener('keydown', (e) => {
      if (e.target.matches('input, textarea, select')) return;
      if (e.key === ' ') {
        e.preventDefault();
        if (playing) stopPlay();
        else playSong();
      } else if (e.key === 'Escape') {
        stopPlay();
      }
    });

    // Refresh when returning focus to window (after Landscape edit)
    window.addEventListener('focus', () => {
      const t = S().loadSong();
      if (t && t.updatedAt !== song.updatedAt) {
        song = t;
        render();
        setStatus('Updated from session');
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
