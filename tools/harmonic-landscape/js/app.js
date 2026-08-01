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
    pulse: false,
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
    /** Cell id drawn as blue comparison path (defaults to v1 sibling) */
    compareCellId: null,
    /** Default length for newly appended chords (From here / Add / Home start) */
    defaultDuration: 4,
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
    state.chords = (snap.chords || []).map((c) => sessionChordToLandscape(c));
    state.selected = snap.selected;
    state.title = snap.title;
    state.fromPackId = snap.fromPackId;
    state.cellId = snap.cellId;
  }

  /**
   * Session / snapshot chord → Landscape chord object.
   * Preserves free pitch sets (custom) instead of forcing a named triad.
   */
  function sessionChordToLandscape(sc) {
    const notes = Array.isArray(sc.notes) ? sc.notes.map((n) => ((n % 12) + 12) % 12) : [];
    const bassPc = sc.bass != null ? sc.bass : sc.bassPc;
    let isCustom = !!sc.custom || sc.quality === 'custom';
    // Notes present but not an exact named quality → keep as free pitch set
    if (!isCustom && notes.length && S() && S().exactQualityFromNotes) {
      if (!S().exactQualityFromNotes(notes, sc.root)) isCustom = true;
    }
    let ch;
    if (isCustom) {
      ch = M().makeCustomChord
        ? M().makeCustomChord(sc.root, notes.length ? notes : [sc.root], {
            duration: sc.duration != null ? sc.duration : 4,
            roman: sc.roman || '',
            region: sc.region || 'custom',
            tag: sc.tag || 'custom',
            name: sc.name,
            bassPc,
          })
        : M().makeChord(sc.root, 'custom', {
            notes: notes.length ? notes : [sc.root],
            duration: sc.duration,
            name: sc.name,
            bassPc,
          });
    } else {
      ch = M().makeChord(sc.root, sc.quality || 'maj', {
        duration: sc.duration != null ? sc.duration : 4,
        roman: sc.roman || '',
        region: sc.region || 'diatonic',
        tag: sc.tag || '',
        bassPc,
      });
      if (notes.length) ch.notes = notes.slice();
      if (bassPc != null && bassPc !== sc.root && C().withBass) {
        ch = C().withBass(ch, bassPc);
        ch.duration = sc.duration != null ? sc.duration : 4;
        ch.roman = sc.roman || '';
      }
    }
    ch.localTonic = sc.localTonic != null ? sc.localTonic : state.tonic;
    ch.localMode = sc.localMode || state.mode;
    return ch;
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
    // Click the gold home disc to start (or land) on the tonic
    map.onSelectHome = () => startAtHome();
    map.onHoverHome = () => {
      A().ensure();
      A().playChord({ chord: makeHomeChord(), soft: true, duration: 0.4 });
    };
    map.onRequestAlts = (pathIndex, chord) => buildAimTargets(pathIndex, chord);
    map.onSwapChord = (pathIndex, newChord) => {
      applyChordAtIndex(pathIndex, newChord, { pullNeighbors: false });
    };
    // Only called when user released on a locked aim target
    map.onPullChord = (pathIndex, chord, meta) => {
      applyChordAtIndex(pathIndex, chord, {
        pullNeighbors: !!(meta && meta.pullNeighbors),
        pullStrength: 0.5,
      });
      setSyncStatus('Set to ' + (chord.name || '') + (meta && meta.role ? ' · ' + meta.role : ''));
    };
    let aimTimer = null;
    map.onAimChange = (pathIndex, target, meta) => {
      if (aimTimer) {
        clearTimeout(aimTimer);
        aimTimer = null;
      }
      // Stop any previous context audition so targets don't stack
      if (A().stopPlayback) A().stopPlayback();
      if (!target) {
        setSyncStatus('Aim cancelled — nothing changed');
        return;
      }
      A().ensure();
      // Immediate soft hit of the aimed chord
      A().playChord({ chord: target.chord, soft: true, duration: 0.5 });
      const roleBit = target.role ? ' · ' + target.role : '';
      setSyncStatus('Aiming ' + target.label + roleBit + ' — hold to hear context, release to set');
      // After a short hold, audition prev → target → next (where you're going)
      aimTimer = setTimeout(() => {
        if (!map.snapAlt || map.snapAlt !== target) return;
        const seq = [];
        if (meta && meta.prevChord) seq.push(meta.prevChord);
        seq.push(target.chord);
        if (meta && meta.nextChord) seq.push(meta.nextChord);
        if (seq.length >= 2) {
          A().playSequence(
            seq.map((c) => {
              const x = M().cloneChord(c);
              x.duration = 1.4;
              return x;
            }),
            Math.max(state.bpm, 110),
            { pulse: false, loop: false }
          );
          setSyncStatus(
            'Audition: ' +
              seq.map((c) => c.name).join(' → ') +
              ' · release to set ' +
              target.label
          );
        }
      }, 280);
    };
    map.onInsertBetween = (afterIndex) => {
      insertBetweenWithTiming(afterIndex);
    };
    map.onTrajectory = (info) => {
      const el = $('#traj-caption');
      if (el && info) el.textContent = info.caption || '';
      renderTimeStrip();
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
    state.chords = (chords || []).map((sc) => sessionChordToLandscape(sc));
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

  /**
   * Writing home = compass centre + From here gravity.
   * By default does NOT move absolute chord roots (modulation-friendly).
   */
  function setWritingHome(tonic, mode, opts) {
    opts = opts || {};
    const prevT = state.tonic;
    const prevM = state.mode;
    const nextT = ((tonic % 12) + 12) % 12;
    const nextM = mode || state.mode;
    const delta = (nextT - prevT + 12) % 12;

    if (opts.transpose && delta && state.chords.length) {
      pushUndo();
      state.chords = state.chords.map((ch) => transposeChord(ch, delta, nextT, nextM));
    }

    state.tonic = nextT;
    state.mode = nextM;
    if ($('#tonic')) $('#tonic').value = String(state.tonic);
    if ($('#mode')) $('#mode').value = state.mode;
    if (map) map.setOrigin(state.tonic, state.mode);

    // Tag local key on chords when only the compass moves (modulation)
    if (!opts.transpose && state.chords.length) {
      state.chords.forEach((ch) => {
        ch.localTonic = nextT;
        ch.localMode = nextM;
      });
    }

    if (opts.skipEdit) {
      if (map) {
        map.setOrigin(state.tonic, state.mode);
        map.setHorizon(buildHorizon());
      }
      renderTitle();
      renderHorizonLists();
      updateMapStatus();
    } else {
      afterEdit();
    }
    return { prevT, prevM, delta, transposed: !!opts.transpose };
  }

  function transposeChord(ch, delta, newTonic, newMode) {
    // Preserve custom pitch sets by rotating notes
    if (ch.custom || ch.quality === 'custom') {
      const notes = (ch.notes || []).map((n) => (n + delta) % 12);
      const root = (ch.root + delta) % 12;
      const bass = ch.bassPc != null ? (ch.bassPc + delta) % 12 : root;
      return M().makeCustomChord
        ? M().makeCustomChord(root, notes, {
            duration: ch.duration,
            roman: ch.roman,
            region: ch.region,
            tag: ch.tag,
            name: null,
            bassPc: bass,
          })
        : (() => {
            const n = M().cloneChord(ch);
            n.root = root;
            n.notes = notes;
            n.bassPc = bass;
            n.localTonic = newTonic;
            n.localMode = newMode;
            return n;
          })();
    }
    let n = M().makeChord((ch.root + delta) % 12, ch.quality, {
      duration: ch.duration,
      roman: ch.roman,
      tag: ch.tag,
      region: ch.region,
    });
    if (ch.bassPc != null && C().withBass) {
      n = C().withBass(n, (ch.bassPc + delta) % 12);
      n.duration = ch.duration;
      n.roman = ch.roman;
      n.tag = ch.tag;
      n.region = ch.region;
    }
    n.localTonic = newTonic != null ? newTonic : state.tonic;
    n.localMode = newMode || state.mode;
    return n;
  }

  /** Transpose whole sequence by delta semitones (keeps writing home fixed unless opts.moveHome). */
  function transposeSequence(delta, opts) {
    opts = opts || {};
    delta = ((delta % 12) + 12) % 12;
    if (!delta || !state.chords.length) return;
    pushUndo();
    state.chords = state.chords.map((ch) =>
      transposeChord(ch, delta, opts.moveHome ? (state.tonic + delta) % 12 : state.tonic, state.mode)
    );
    if (opts.moveHome) {
      state.tonic = (state.tonic + delta) % 12;
      if ($('#tonic')) $('#tonic').value = String(state.tonic);
      if (map) map.setOrigin(state.tonic, state.mode);
    }
    afterEdit();
    setSyncStatus(
      'Transposed ' +
        (delta > 6 ? delta - 12 : delta) +
        ' semitones' +
        (opts.moveHome ? ' · write home moved' : ' · write home still ' + keyLabel())
    );
  }

  /**
   * Modulation: set writing home from the selected chord (chords stay absolute).
   * Map / From here now treat that chord as the new centre of gravity.
   */
  function landSelectionAsHome() {
    const ch =
      state.selected >= 0 && state.chords[state.selected]
        ? state.chords[state.selected]
        : state.chords[state.chords.length - 1];
    if (!ch) {
      setSyncStatus('Select a chord first, then Land here');
      return;
    }
    let mode = state.mode;
    const q = ch.quality || '';
    if (q.indexOf('min') === 0 || q === 'halfdim' || q === 'dim') mode = 'minor';
    else if (q.indexOf('maj') === 0 || q === 'dom7' || q === 'sus4' || q === 'add9') {
      // dom7 often dominant of a major/minor — keep major-ish as major home
      mode = q === 'dom7' ? state.mode : 'major';
      if (q.indexOf('maj') === 0 || q === 'add9') mode = 'major';
    }
    setWritingHome(ch.root, mode, { transpose: false });
    setSyncStatus(
      'Modulate · write home now ' +
        keyLabel() +
        ' (from ' +
        ch.name +
        ') · chords unchanged · map + From here re-centred'
    );
  }

  /** Old behaviour: move every chord so they follow the Write home dropdown. */
  function transposeAllToWriteHome(fromTonic) {
    const prev = fromTonic != null ? fromTonic : state._prevTonicForTranspose;
    if (prev == null || prev === state.tonic) {
      setSyncStatus('Pick a new Write home first, then Transpose all — or use Land here to modulate without moving chords');
      return;
    }
    const delta = (state.tonic - prev + 12) % 12;
    if (!delta) return;
    // Temporarily set tonic back to compute... actually chords still at old pitch,
    // write home already at new. Transpose chords by delta from prev to current home.
    pushUndo();
    state.chords = state.chords.map((ch) => transposeChord(ch, delta, state.tonic, state.mode));
    afterEdit();
    setSyncStatus('Transposed sequence into ' + keyLabel() + ' · all chords moved');
    state._prevTonicForTranspose = state.tonic;
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

  /**
   * Build labelled aim targets for drag (where to aim + what it means).
   */
  function buildAimTargets(pathIndex, chord) {
    const t = state.tonic;
    const list = [];
    const seen = new Set();
    const add = (ch, label, role) => {
      if (!ch) return;
      const k = ch.root + ':' + ch.quality;
      if (seen.has(k)) return;
      if (ch.root === chord.root && ch.quality === chord.quality) return;
      seen.add(k);
      ch = { ...ch, duration: chord.duration || 4 };
      list.push({ chord: ch, label: label || ch.name, role: role || '' });
    };

    // Close alternates (inversions / family)
    if (C().closeAlternates) {
      C().closeAlternates(chord, state.tonic, state.mode, 6).forEach((a) => {
        add(a.chord, a.label, a.role || 'near');
      });
    }

    // Diatonic set
    if (M().diatonicChords) {
      M().diatonicChords(t, state.mode, true).forEach((c) => add(c, c.name, 'diatonic'));
    }

    // Dark colours
    [
      { d: 8, q: 'maj', role: '♭VI' },
      { d: 10, q: 'maj', role: '♭VII' },
      { d: 1, q: 'dom7', role: 'noir ♭II7' },
      { d: 7, q: 'dom7', role: 'V7' },
      { d: 5, q: 'min', role: 'iv' },
      { d: 3, q: 'maj', role: 'III' },
    ].forEach((s) => {
      add(M().makeChord((t + s.d) % 12, s.q, { region: 'interchange' }), null, s.role);
    });

    // Cap so the map stays readable
    return list.slice(0, 12);
  }

  /**
   * Insert between two chords without lengthening the cell:
   * steal duration from neighbors (prefer previous).
   */
  function insertBetweenWithTiming(afterIndex) {
    pushUndo();
    const a = state.chords[afterIndex];
    const b = state.chords[afterIndex + 1];
    if (!a || !b) return;

    const da = a.duration || 4;
    const db = b.duration || 4;
    // Target insert length 1–2 beats, taken from neighbors so total stays constant
    let takeA = 0;
    let takeB = 0;
    let insertDur = 2;
    if (da >= 3 && db >= 3) {
      takeA = 1;
      takeB = 1;
      insertDur = 2;
    } else if (da >= 2) {
      takeA = Math.min(2, da - 1);
      insertDur = takeA;
    } else if (db >= 2) {
      takeB = Math.min(2, db - 1);
      insertDur = takeB;
    } else {
      // Both already short — take 0.5 each if possible
      takeA = da > 1 ? 0.5 : 0;
      takeB = db > 1 ? 0.5 : 0;
      insertDur = Math.max(0.5, takeA + takeB) || 1;
      if (takeA + takeB === 0) {
        // last resort: keep total by shortening a slightly
        takeA = 0.5;
        insertDur = 0.5;
      }
    }

    const midRoot = Math.round((a.root + b.root) / 2) % 12;
    let ch = M().makeChord(midRoot, state.mode === 'major' ? 'maj' : 'min', {
      duration: insertDur,
      region: 'diatonic',
      tag: 'insert',
      roman: '→',
    });
    if (C().bestInversion) {
      ch = C().bestInversion(a, ch);
      ch.duration = insertDur;
      ch.tag = 'insert';
    }
    ch.localTonic = state.tonic;
    ch.localMode = state.mode;

    state.chords[afterIndex] = M().withDuration(a, Math.max(0.5, da - takeA));
    state.chords[afterIndex + 1] = M().withDuration(b, Math.max(0.5, db - takeB));
    state.chords.splice(afterIndex + 1, 0, ch);
    state.selected = afterIndex + 1;
    state.fromPackId = null;
    afterEdit();
    A().ensure();
    A().playChord({ chord: ch });
    const total = state.chords.reduce((s, c) => s + (c.duration || 0), 0);
    setSyncStatus(
      'Inserted (timing kept) · ' + insertDur + 'b from neighbors · total ' + total + ' beats'
    );
  }

  /**
   * Split a time-strip step into two equal(ish) halves.
   * Total cell length is unchanged — only this step is bisected.
   */
  function splitChordAt(index) {
    if (index < 0 || index >= state.chords.length) return;
    const src = state.chords[index];
    const d = src.duration || 4;
    if (d < 1) {
      setSyncStatus('Too short to split (need ≥ 1 beat)');
      return;
    }
    pushUndo();
    // Prefer half-beat grid: e.g. 4 → 2+2, 3 → 1.5+1.5, 1 → 0.5+0.5
    const d1 = Math.max(0.5, Math.round(d) / 2);
    // Remainder on second half so total length is unchanged
    const d2 = Math.max(0.5, d - d1);
    state.chords[index] = M().withDuration(src, d1);
    let ch = M().cloneChord(src);
    ch.duration = d2;
    ch.tag = 'split';
    state.chords.splice(index + 1, 0, ch);
    state.selected = index + 1;
    state.fromPackId = null;
    afterEdit();
    A().ensure();
    A().playChord({ chord: ch, soft: true, duration: 0.4 });
    const total = state.chords.reduce((s, c) => s + (c.duration || 0), 0);
    setSyncStatus('Split step ' + (index + 1) + ' · ' + d1 + 'b + ' + d2 + 'b · total still ' + total + 'b');
  }

  function circularBlendRoot(a, b, t) {
    // shortest arc blend on pitch-class circle
    let d = ((b - a + 12) % 12);
    if (d > 6) d -= 12;
    return ((a + Math.round(d * t)) % 12 + 12) % 12;
  }

  function applyChordAtIndex(pathIndex, newChord, opts) {
    opts = opts || {};
    if (pathIndex < 0 || pathIndex >= state.chords.length) return;
    pushUndo();
    const prev = state.chords[pathIndex];
    let ch = M().cloneChord(newChord);
    ch.duration = prev.duration || 4;
    ch.localTonic = state.tonic;
    ch.localMode = state.mode;
    ch.tag = ch.tag || 'pulled';
    if (C().bestInversion && pathIndex > 0) {
      ch = C().bestInversion(state.chords[pathIndex - 1], ch);
      ch.duration = prev.duration || 4;
    }
    state.chords[pathIndex] = ch;

    if (opts.pullNeighbors && opts.pullStrength > 0) {
      const t = Math.min(1, opts.pullStrength) * 0.55; // how far neighbors move
      // Previous: blend root toward new chord
      if (pathIndex > 0) {
        const p = state.chords[pathIndex - 1];
        const newRoot = circularBlendRoot(p.root, ch.root, t);
        let pq = p.quality;
        // keep quality family mostly
        let pn = M().makeChord(newRoot, pq, {
          duration: p.duration,
          region: p.region || 'diatonic',
          roman: p.roman,
          tag: 'tugged',
        });
        if (C().bestInversion && pathIndex > 1) {
          pn = C().bestInversion(state.chords[pathIndex - 2], pn);
          pn.duration = p.duration;
        } else if (C().withBass && p.bassPc != null) {
          // try keep relative bass if possible
        }
        pn.localTonic = state.tonic;
        pn.localMode = state.mode;
        pn.tag = 'tugged';
        state.chords[pathIndex - 1] = pn;
      }
      // Next: blend toward new chord from its side
      if (pathIndex < state.chords.length - 1) {
        const n = state.chords[pathIndex + 1];
        const newRoot = circularBlendRoot(n.root, ch.root, t * 0.85);
        let nn = M().makeChord(newRoot, n.quality, {
          duration: n.duration,
          region: n.region || 'diatonic',
          roman: n.roman,
          tag: 'tugged',
        });
        if (C().bestInversion) {
          nn = C().bestInversion(ch, nn);
          nn.duration = n.duration;
        }
        nn.localTonic = state.tonic;
        nn.localMode = state.mode;
        nn.tag = 'tugged';
        state.chords[pathIndex + 1] = nn;
      }
    }

    state.selected = pathIndex;
    state.fromPackId = null;
    map._mode = null;
    afterEdit();
    A().ensure();
    A().playChord({ chord: state.chords[pathIndex] });
  }

  function setDefaultDuration(beats, opts) {
    opts = opts || {};
    state.defaultDuration = Math.max(0.5, snapBeats(beats));
    const host = $('#step-dur');
    if (host) {
      host.querySelectorAll('[data-step-dur]').forEach((b) => {
        b.classList.toggle('active', parseFloat(b.dataset.stepDur) === state.defaultDuration);
      });
    }
    if (!opts.silent) setSyncStatus('New steps · ' + state.defaultDuration + ' beats each');
  }

  function makeEnteredChord(root, q) {
    const dur = stepDuration();
    let ch = M().makeChord(root, q, {
      duration: dur,
      region: 'diatonic',
      tag: 'entered',
    });
    const prev =
      state.selected >= 0 && state.chords[state.selected]
        ? state.chords[state.selected]
        : state.chords[state.chords.length - 1];
    if (prev && C().bestInversion) {
      ch = C().bestInversion(prev, ch);
      ch.duration = dur;
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

  /** Resolve which cell is the blue comparison path. */
  function resolveCompareCell(song) {
    if (!song || !state.cellId) return null;
    if (state.compareCellId && song.cells[state.compareCellId] && state.compareCellId !== state.cellId) {
      return song.cells[state.compareCellId];
    }
    const sibs = S().siblingsOfCell(song, state.cellId);
    return (
      sibs.find((c) => c.id !== state.cellId && (c.versionIndex === 1 || /v1\b/i.test(c.name || ''))) ||
      sibs.find((c) => c.id !== state.cellId) ||
      null
    );
  }

  /** Draw comparison version in blue. */
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
    const other = resolveCompareCell(song);
    if (!other || !other.chords || !other.chords.length) {
      map.setAltPath([]);
      return;
    }
    if (!state.compareCellId) state.compareCellId = other.id;
    const alt = other.chords.map((sc) => sessionChordToLandscape(sc));
    map.setAltPath(alt);
  }

  /** Indices where current path differs from compare cell (for slot highlight). */
  function diffIndicesVsCompare() {
    if (!S() || !state.cellId) return new Set();
    const song = S().loadSong();
    const other = resolveCompareCell(song);
    if (!other || !other.chords) return new Set();
    const set = new Set();
    const n = Math.max(state.chords.length, other.chords.length);
    for (let i = 0; i < n; i++) {
      const a = state.chords[i];
      const b = other.chords[i];
      if (!a || !b) {
        set.add(i);
        continue;
      }
      if (a.root !== b.root || a.quality !== b.quality) set.add(i);
      else if ((a.duration || 4) !== (b.duration || 4)) set.add(i);
      else if (a.custom || b.custom) {
        const an = (a.notes || []).slice().sort().join(',');
        const bn = (b.notes || []).slice().sort().join(',');
        if (an !== bn) set.add(i);
      }
    }
    return set;
  }

  /**
   * Switch Landscape editor to another session cell (saves current first).
   */
  function switchToCell(cellId, opts) {
    opts = opts || {};
    if (!S() || !cellId) return false;
    // Persist what you're leaving so variants don't lose edits
    // skipPush: after delete, current cellId may already be gone
    if (!opts.skipPush && state.chords.length && state.cellId) {
      pushToSharedSession('landscape');
    }
    const song = S().loadSong();
    if (!song || !song.cells[cellId]) {
      setSyncStatus('Cell not found');
      return false;
    }
    const cell = song.cells[cellId];
    song.focus = {
      cellId,
      sectionId: song.focus && song.focus.sectionId ? song.focus.sectionId : null,
      chordIndex: 0,
    };
    S().saveSong(song, 'landscape');
    applySessionChords(cell.chords || [], {
      title: cell.name || 'Cell',
      cellId: cell.id,
      packId: cell.packId,
      tonic: song.key && song.key.tonic,
      mode: song.key && song.key.mode,
      bpm: song.bpm,
      focusIndex: 0,
    });
    state.nameLocked = true;
    refreshAll();
    if (!opts.silent) {
      const v = cell.versionIndex != null ? ' v' + cell.versionIndex : '';
      setSyncStatus('Editing “' + (cell.name || cellId) + '”' + (cell.familyId ? v : ''));
      if (cell.chords && cell.chords.length) {
        A().ensure();
        const first = state.chords[0];
        if (first) A().playChord({ chord: first, soft: true, duration: 0.45 });
      }
    }
    return true;
  }

  /** Short chord path for version chip preview */
  function cellPreviewLabel(cell) {
    if (!cell || !cell.chords || !cell.chords.length) return 'empty';
    const names = cell.chords.slice(0, 4).map((c) => {
      if (c.name) return c.name;
      if (c.custom && c.notes && S() && S().customChordLabel) {
        return S().customChordLabel(c.root, c.notes);
      }
      const N = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
      const q =
        c.quality === 'min' || c.quality === 'min7'
          ? 'm'
          : c.quality === 'dom7'
            ? '7'
            : c.quality === 'custom'
              ? '…'
              : '';
      return (N[c.root] || '?') + q;
    });
    const more = cell.chords.length > 4 ? '…' : '';
    return names.join('–') + more;
  }

  /**
   * Version chips (same family) + all-cells picker so you can leave a variant
   * and return to v1 / other cells without hunting in Arrangement.
   */
  function renderVersionBar() {
    const host = $('#version-bar');
    if (!host) return;
    if (!S()) {
      host.hidden = true;
      host.innerHTML = '';
      return;
    }
    const song = S().loadSong();
    if (!song || !song.cells) {
      host.hidden = true;
      host.innerHTML = '';
      return;
    }

    const cellIds = Object.keys(song.cells);
    const cur = state.cellId && song.cells[state.cellId] ? song.cells[state.cellId] : null;
    const family = cur && cur.familyId ? S().siblingsOfCell(song, state.cellId) : cur ? [cur] : [];
    const hasFamily = family.length > 1;
    const hasManyCells = cellIds.length > 1;

    // Always show when editing a cell or a sequence (so Duplicate / Vary are reachable)
    if (!cur && !state.chords.length && !hasManyCells) {
      host.hidden = true;
      host.innerHTML = '';
      return;
    }

    host.hidden = false;
    let html = '';

    // Always show version actions
    html +=
      '<div class="version-bar-label">Versions · click = edit · Alt-click = blue compare · × = delete</div>';
    if (hasFamily || cur) {
      const famName =
        cur && cur.familyId && song.families[cur.familyId]
          ? song.families[cur.familyId].name
          : (cur && cur.name ? cur.name.replace(/\s*v\d+\s*$/i, '') : '') || 'Theme';
      const chips = hasFamily ? family : cur ? [cur] : [];
      html +=
        '<div class="version-chips" id="version-chips" data-fam="' +
        escapeAttr(famName) +
        '">';
      chips.forEach((c) => {
        const active = c.id === state.cellId;
        const isCompare =
          state.compareCellId === c.id ||
          (!state.compareCellId && !active && c.versionIndex === 1);
        const vi = c.versionIndex != null ? c.versionIndex : '?';
        const label = c.name || 'v' + vi;
        html +=
          '<button type="button" class="ver-chip' +
          (active ? ' active' : '') +
          (isCompare && !active ? ' compare' : '') +
          '" data-cell="' +
          escapeAttr(c.id) +
          '" title="' +
          escapeAttr(
            label +
              ' · ' +
              cellPreviewLabel(c) +
              (active ? ' (editing)' : ' — click edit · Alt-click blue · × delete')
          ) +
          '">' +
          '<span class="ver-n">v' +
          vi +
          '</span>' +
          escapeHtml(
            // Prefer short chip title: "v1 Darken" from "Theme · v1 Darken"
            (() => {
              const m = String(label).match(/·\s*(v\d+\s+.+)$/i);
              if (m) return m[1].trim();
              return label.replace(/\s*v\d+\s*$/i, '') || label;
            })()
          ) +
          '<span class="ver-preview">' +
          escapeHtml(cellPreviewLabel(c)) +
          (isCompare && !active ? ' · blue' : '') +
          '</span>' +
          '<span class="ver-x" data-del="' +
          escapeAttr(c.id) +
          '" title="Delete this version" role="button" aria-label="Delete">×</span>' +
          '</button>';
      });
      html += '</div>';
    } else {
      html +=
        '<p class="version-bar-empty">No versions yet — add chords or load a feel.</p>';
    }
    html +=
      '<div class="ver-actions">' +
      '<button type="button" class="btn ghost" id="btn-var-copy" title="Exact copy as next version">+ Duplicate</button>' +
      '<button type="button" class="btn ghost" id="btn-var-reharm" title="Fork with reharm colour">+ Reharm</button>' +
      '<button type="button" class="btn ghost" id="btn-var-parallel" title="Fork parallel maj/min">+ Parallel</button>' +
      '<button type="button" class="btn ghost" id="btn-var-darken" title="Fork darker">+ Darken</button>' +
      '<button type="button" class="btn ghost" id="btn-ab-ver" title="Play this then blue compare">A/B listen</button>' +
      (cur
        ? '<button type="button" class="btn ghost btn-danger" id="btn-var-del" title="Delete the version you are editing">Delete current</button>'
        : '') +
      '</div>';

    if (hasManyCells) {
      html += '<div class="cell-switch-row">';
      html += '<label for="cell-switch">All cells</label>';
      html += '<select id="cell-switch" title="Jump to any cell in the song session">';
      // Group family versions together
      const seen = new Set();
      const groups = [];
      cellIds.forEach((id) => {
        if (seen.has(id)) return;
        const c = song.cells[id];
        if (c.familyId) {
          const vers = S().familyVersions(song, c.familyId);
          vers.forEach((v) => seen.add(v.id));
          groups.push({
            label: (song.families[c.familyId] && song.families[c.familyId].name) || c.name,
            cells: vers,
          });
        } else {
          seen.add(id);
          groups.push({ label: null, cells: [c] });
        }
      });
      groups.forEach((g) => {
        if (g.label && g.cells.length > 1) {
          html += '<optgroup label="' + escapeAttr(g.label) + '">';
          g.cells.forEach((c) => {
            html +=
              '<option value="' +
              escapeAttr(c.id) +
              '"' +
              (c.id === state.cellId ? ' selected' : '') +
              '>v' +
              (c.versionIndex || 1) +
              ' · ' +
              escapeHtml(c.name || c.id) +
              '</option>';
          });
          html += '</optgroup>';
        } else {
          g.cells.forEach((c) => {
            html +=
              '<option value="' +
              escapeAttr(c.id) +
              '"' +
              (c.id === state.cellId ? ' selected' : '') +
              '>' +
              escapeHtml(c.name || c.id) +
              '</option>';
          });
        }
      });
      html += '</select></div>';
    }

    host.innerHTML = html;

    host.querySelectorAll('.ver-chip').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        if (e.target && e.target.classList && e.target.classList.contains('ver-x')) {
          e.preventDefault();
          e.stopPropagation();
          const delId = e.target.getAttribute('data-del');
          if (delId) deleteVersion(delId);
          return;
        }
        const id = btn.getAttribute('data-cell');
        if (!id) return;
        if (e.altKey || e.metaKey) {
          if (id === state.cellId) {
            setSyncStatus('Compare target must be another version');
            return;
          }
          state.compareCellId = id;
          refreshAltPath();
          renderVersionBar();
          renderSlots();
          setSyncStatus('Blue compare → ' + (song.cells[id] && song.cells[id].name));
          return;
        }
        if (id !== state.cellId) switchToCell(id);
      });
    });
    host.querySelectorAll('.ver-x').forEach((x) => {
      x.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const delId = x.getAttribute('data-del');
        if (delId) deleteVersion(delId);
      });
    });
    const sel = host.querySelector('#cell-switch');
    if (sel) {
      sel.addEventListener('change', () => {
        if (sel.value && sel.value !== state.cellId) switchToCell(sel.value);
      });
    }
    const bind = (id, fn) => {
      const el = host.querySelector(id);
      if (el) el.addEventListener('click', fn);
    };
    bind('#btn-var-copy', () => createVariation('copy'));
    bind('#btn-var-reharm', () => createVariation('reharm'));
    bind('#btn-var-parallel', () => createVariation('parallel'));
    bind('#btn-var-darken', () => createVariation('darken'));
    bind('#btn-ab-ver', () => playAB());
    bind('#btn-var-del', () => {
      if (state.cellId) deleteVersion(state.cellId);
    });
  }

  /**
   * Delete a version/cell from the shared song session.
   * If it is the one you're editing, switch to a sibling (or clear).
   */
  function deleteVersion(cellId) {
    if (!S() || !cellId) return;
    // Save current work first if deleting something else
    if (state.chords.length && state.cellId && state.cellId !== cellId) {
      pushToSharedSession('landscape');
    } else if (state.chords.length && state.cellId === cellId) {
      pushToSharedSession('landscape');
    }

    let song = S().loadSong();
    if (!song || !song.cells[cellId]) {
      setSyncStatus('Version not found');
      return;
    }
    const cell = song.cells[cellId];
    const label = cell.name || cellId;
    const used = (song.arrangement || []).filter(
      (s) => s.cellId === cellId || (s.chain && s.chain.indexOf(cellId) >= 0)
    );
    let msg = 'Delete version “' + label + '”?';
    if (used.length) {
      msg +=
        '\n\nUsed in ' +
        used.length +
        ' arrangement section(s): ' +
        used.map((s) => s.name || 'section').join(', ') +
        '.\nThose sections will drop this version (empty sections are removed).';
    }
    msg += '\n\nThis cannot be undone from here.';
    if (!confirm(msg)) return;

    if (!S().deleteCell) {
      alert('Session update required — refresh the page.');
      return;
    }
    const result = S().deleteCell(song, cellId, { dissolveSoloFamily: false });
    if (!result || !result.ok) {
      setSyncStatus('Could not delete');
      return;
    }
    S().saveSong(song, 'landscape');

    if (state.compareCellId === cellId) state.compareCellId = null;

    if (state.cellId === cellId) {
      // Don't re-save the deleted id
      state.cellId = null;
      if (result.nextFocusId && song.cells[result.nextFocusId]) {
        const nextName = song.cells[result.nextFocusId].name || '';
        switchToCell(result.nextFocusId, { silent: true, skipPush: true });
        setSyncStatus('Deleted “' + label + '” · now editing “' + nextName + '”');
      } else {
        state.chords = [];
        state.selected = -1;
        state.title = 'Untitled sequence';
        state.compareCellId = null;
        state.nameLocked = false;
        refreshAll();
        setSyncStatus('Deleted “' + label + '” · no versions left');
      }
    } else {
      refreshAll();
      setSyncStatus('Deleted “' + label + '”');
    }
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, '&#39;');
  }

  /**
   * Map a quality to its parallel (maj↔min family). Returns null if no flip.
   * Does not touch dom7 / sus / fully chromatic colours.
   */
  function parallelQualityOf(q) {
    const map = {
      min: 'maj',
      min7: 'maj7',
      min9: 'maj9',
      minmaj7: 'maj7',
      maj: 'min',
      maj7: 'min7',
      maj9: 'min9',
      add9: 'min',
      // dim/halfdim stay dark; aug stays bright
    };
    return map[q] || null;
  }

  /**
   * Infer maj/min-ish family from pitch set (for custom frets).
   * Returns flipped quality or null.
   */
  function parallelFromNotes(root, notes, quality) {
    const flipped = parallelQualityOf(quality);
    if (flipped) return flipped;
    if (!notes || !notes.length) return null;
    const r = ((root % 12) + 12) % 12;
    const set = new Set(notes.map((n) => ((n - r) % 12 + 12) % 12));
    const has3 = set.has(3);
    const has4 = set.has(4);
    const has7 = set.has(7);
    const has10 = set.has(10);
    const has11 = set.has(11);
    if (has3 && !has4) {
      // minor family → major family
      if (has7 && has10) return 'maj7'; // rough: min7-ish → maj7
      if (has7 && has11) return 'maj7';
      if (has7) return 'maj';
      return 'maj';
    }
    if (has4 && !has3) {
      if (has7 && has11) return 'min7';
      if (has7 && has10) return 'min7';
      if (has7) return 'min';
      return 'min';
    }
    return null;
  }

  /**
   * Session chord rebuilt for a named quality — strip notes/custom so Landscape
   * cannot rehydrate the old pitch set (that made Parallel look like a copy).
   */
  function sessionChordWithQuality(c, quality, extra) {
    extra = extra || {};
    return {
      root: c.root,
      quality,
      duration: c.duration != null ? c.duration : 4,
      bass: c.root, // reset bass; inversions of the old triad no longer apply
      roman: extra.roman != null ? extra.roman : c.roman || '',
      region: extra.region != null ? extra.region : c.region || 'parallel',
      tag: extra.tag || 'parallel',
      // intentionally omit notes / custom / name
    };
  }

  /** Human label for a vary kind */
  function variationKindLabel(kind) {
    const map = {
      copy: 'Copy',
      parallel: 'Parallel',
      darken: 'Darken',
      reharm: 'Reharm',
    };
    return map[kind] || String(kind || 'Var');
  }

  /**
   * Name a new version from its source + transform, e.g. "Home grit · v1 Darken".
   */
  function nameForVariation(song, sourceCellId, kind) {
    const src = song.cells[sourceCellId];
    if (!src) return null;
    const fam =
      src.familyId && song.families[src.familyId] ? song.families[src.familyId] : null;
    let base = (fam && fam.name) || src.name || state.title || 'Cell';
    base = String(base)
      .replace(/\s*·\s*v\d+.*$/i, '')
      .replace(/\s*v\d+\s*$/i, '')
      .trim() || 'Cell';
    const srcV = src.versionIndex != null ? src.versionIndex : 1;
    const kindLabel = variationKindLabel(kind);
    // "Theme · v1 Darken" — clear lineage from which version was transformed
    if (kind === 'copy') {
      return base + ' · v' + srcV + ' Copy';
    }
    return base + ' · v' + srcV + ' ' + kindLabel;
  }

  /**
   * Fork current sequence as a linked variation (same family).
   * kind: copy | reharm | parallel | darken
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

    // Start from clean session chords
    let newChords = state.chords.map((c) => S().fromLandscapeChord(c));
    let changed = 0;

    if (kind === 'copy') {
      // Exact fork — keep notes/custom as-is
    } else if (kind === 'parallel') {
      newChords = newChords.map((c) => {
        const q2 = parallelFromNotes(c.root, c.notes, c.quality);
        if (!q2 || q2 === c.quality) {
          // Still strip notes if quality was already "maj" with stale custom notes
          if (c.custom || (c.notes && c.notes.length)) {
            // try hard flip from notes only
            const forced = parallelFromNotes(c.root, c.notes, c.quality === 'custom' ? '' : c.quality);
            if (forced) {
              changed += 1;
              return sessionChordWithQuality(c, forced, { tag: 'parallel', region: 'parallel' });
            }
          }
          return sessionChordWithQuality(c, c.quality || 'maj', {
            tag: c.tag || 'parallel',
            region: c.region || 'diatonic',
          });
        }
        changed += 1;
        return sessionChordWithQuality(c, q2, { tag: 'parallel', region: 'parallel' });
      });
      if (!changed) {
        setSyncStatus('Parallel: nothing to flip (need maj/min family chords)');
        // Still create the version so the button does something visible
      }
    } else if (kind === 'darken' || kind === 'reharm') {
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
        changed += 1;
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
        changed += 1;
      }
      // Strip notes on untouched chords so names stay honest
      newChords = newChords.map((c) => {
        if (c.tag === kind) return c;
        if (c.custom || c.quality === 'custom') return c;
        return sessionChordWithQuality(c, c.quality || 'maj', {
          tag: c.tag || '',
          region: c.region || 'diatonic',
          roman: c.roman,
        });
      });
    }

    const varName = nameForVariation(song, state.cellId, kind);
    const newId = S().createVariation(song, state.cellId, {
      chords: newChords,
      name: varName,
    });
    if (!newId) return;
    // Keep previous as blue compare when forking
    state.compareCellId = state.cellId;
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
    const detail =
      kind === 'copy'
        ? ' (exact copy — tweak freely)'
        : kind === 'parallel'
          ? ' · parallel maj↔min (' + changed + ' flipped)'
          : ' · ' + variationKindLabel(kind);
    setSyncStatus('Created “' + cell.name + '”' + detail + ' · gold=this · blue=compare');
    playSeq({ once: true, force: true });
  }

  function smoothVoicings() {
    if (!state.chords.length || !C().smoothCellVoicings) return;
    pushUndo();
    state.chords = C().smoothCellVoicings(state.chords);
    state.chords.forEach((c) => {
      c.localTonic = state.tonic;
      c.localMode = state.mode;
    });
    state.fromPackId = null;
    afterEdit();
    A().ensure();
    playSeq({ once: true, force: true, label: 'Smoothed voicings · playing once' });
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

  /** Snap duration to half-beat grid, clamp ≥ 0.5 */
  function snapBeats(b) {
    return Math.max(0.5, Math.round(b * 2) / 2);
  }

  /**
   * Resize from the right edge of step `index`.
   * Internal border: steal/give beats with the next step (total length kept).
   * Last step: change its duration alone (cell can grow/shrink).
   */
  function resizeStripEdge(index, deltaBeats, opts) {
    opts = opts || {};
    if (index < 0 || index >= state.chords.length) return false;
    const live = !!opts.live;
    const a = state.chords[index];
    const da0 = a.duration || 4;
    const hasNext = index < state.chords.length - 1;

    if (hasNext) {
      const b = state.chords[index + 1];
      const db0 = b.duration || 4;
      // Redistribute; neither side below 0.5
      let da = snapBeats(da0 + deltaBeats);
      let db = snapBeats(da0 + db0 - da);
      if (db < 0.5) {
        db = 0.5;
        da = snapBeats(da0 + db0 - db);
      }
      if (da < 0.5) {
        da = 0.5;
        db = snapBeats(da0 + db0 - da);
      }
      // Keep exact total if possible
      const total = da0 + db0;
      if (Math.abs(da + db - total) > 0.01) {
        db = Math.max(0.5, snapBeats(total - da));
        da = Math.max(0.5, total - db);
      }
      if (da === da0 && db === db0) return false;
      state.chords[index] = M().withDuration(a, da);
      state.chords[index + 1] = M().withDuration(b, db);
    } else {
      const da = snapBeats(da0 + deltaBeats);
      if (da === da0) return false;
      state.chords[index] = M().withDuration(a, da);
    }
    if (!live) {
      state.fromPackId = null;
      if (S()) pushToSharedSession('landscape');
    }
    return true;
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

  function beatSum(chords) {
    return (chords || []).reduce((s, c) => s + (c.duration || 4), 0);
  }

  /** Split budget beats across n steps on a half-beat grid (exact total). */
  function splitBudget(budget, n) {
    n = Math.max(1, n | 0);
    budget = Math.max(0.5 * n, budget);
    const raw = budget / n;
    const durs = [];
    let used = 0;
    for (let i = 0; i < n; i++) {
      if (i === n - 1) {
        durs.push(Math.max(0.5, snapBeats(budget - used)));
      } else {
        const d = Math.max(0.5, snapBeats(raw));
        durs.push(d);
        used += d;
      }
    }
    // Fix drift so sum === budget
    let sum = durs.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - budget) > 0.001) {
      durs[n - 1] = Math.max(0.5, snapBeats(durs[n - 1] + (budget - sum)));
      sum = durs.reduce((a, b) => a + b, 0);
      // If still off due to snap, put remainder on last without re-snap below 0.5
      if (Math.abs(sum - budget) > 0.001) {
        durs[n - 1] = Math.max(0.5, durs[n - 1] + (budget - sum));
      }
    }
    return durs;
  }

  function stepDuration() {
    const d = state.defaultDuration != null ? state.defaultDuration : 4;
    return Math.max(0.5, snapBeats(d));
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
  function fitHorizonIntoSequence(sel, rawPieces, mode) {
    const pieces = rawPieces.map((p) => M().cloneChord(p));
    const totalBefore = beatSum(state.chords);
    const n = pieces.length;
    if (!n) return null;
    const step = stepDuration();

    let writeAt = Math.max(0, sel + 1);

    if (mode === 'insert') {
      // Steal budget from prev (sel) and next (sel+1), like map-edge insert
      const needHint = Math.min(step * n, Math.max(step, n * 1.5));
      let takePrev = 0;
      let takeNext = 0;
      const prev = state.chords[sel];
      const next = state.chords[sel + 1];
      const dp = prev ? prev.duration || step : 0;
      const dn = next ? next.duration || step : 0;
      if (prev && next && dp >= 2 && dn >= 2) {
        takePrev = Math.min(needHint / 2, dp - 0.5);
        takeNext = Math.min(needHint - takePrev, dn - 0.5);
      } else if (prev && dp > 1) {
        takePrev = Math.min(needHint, dp - 0.5);
      } else if (next && dn > 1) {
        takeNext = Math.min(needHint, dn - 0.5);
      } else if (prev) {
        takePrev = Math.min(0.5, Math.max(0, dp - 0.5));
      }
      let budget = snapBeats(takePrev + takeNext);
      if (budget < 0.5 * n) {
        const rich = dp >= dn ? 'prev' : 'next';
        if (rich === 'prev' && prev && dp - takePrev > 0.5) {
          takePrev = Math.min(dp - 0.5, takePrev + (0.5 * n - budget));
        } else if (next && dn - takeNext > 0.5) {
          takeNext = Math.min(dn - 0.5, takeNext + (0.5 * n - budget));
        }
        budget = Math.max(0.5 * n, snapBeats(takePrev + takeNext));
      }
      if (prev && takePrev > 0) {
        state.chords[sel] = M().withDuration(prev, Math.max(0.5, snapBeats(dp - takePrev)));
      }
      if (next && takeNext > 0) {
        state.chords[sel + 1] = M().withDuration(next, Math.max(0.5, snapBeats(dn - takeNext)));
      }
      const durs = splitBudget(Math.max(0.5 * n, takePrev + takeNext), n);
      const fitted = pieces.map((p, i) => M().withDuration(p, durs[i]));
      writeAt = sel + 1;
      state.chords.splice(writeAt, 0, ...fitted);
      return {
        writeAt,
        pieces: fitted,
        mode: 'insert',
        totalBefore,
        totalAfter: beatSum(state.chords),
      };
    }

    // At end or empty: compose forward with full default lengths (do NOT steal)
    if (writeAt >= state.chords.length || !state.chords.length) {
      const fitted = pieces.map((p) => M().withDuration(p, step));
      if (!state.chords.length) {
        state.chords = fitted;
        return {
          writeAt: 0,
          pieces: fitted,
          mode: 'seed',
          totalBefore,
          totalAfter: beatSum(state.chords),
        };
      }
      writeAt = state.chords.length;
      state.chords.push(...fitted);
      return {
        writeAt,
        pieces: fitted,
        mode: 'append',
        totalBefore,
        totalAfter: beatSum(state.chords),
      };
    }

    // Mid-path: rewrite continuation — preserve total length of the span we replace
    const remaining = state.chords.length - writeAt;
    const spanCount = Math.min(Math.max(n, 1), remaining);
    let budget = 0;
    for (let i = 0; i < spanCount; i++) {
      budget += state.chords[writeAt + i].duration || step;
    }
    budget = Math.max(0.5 * n, budget);
    const durs = splitBudget(budget, n);
    const fitted = pieces.map((p, i) => M().withDuration(p, durs[i]));
    state.chords.splice(writeAt, spanCount, ...fitted);
    return {
      writeAt,
      pieces: fitted,
      mode: 'replace',
      totalBefore,
      totalAfter: beatSum(state.chords),
      spanCount,
    };
  }

  /**
   * Horizon pick = "where do I go from the selected chord?"
   * Always keeps total cell length (beats) stable by fitting into existing budget.
   * Shift-click = insert between (still steals from neighbors).
   */
  function commitHorizon(item, opts) {
    opts = opts || {};
    pushUndo();

    const rawPieces = horizonPieces(item);
    if (!rawPieces.length) return;

    const sel =
      state.selected >= 0 && state.selected < state.chords.length
        ? state.selected
        : state.chords.length - 1;
    const hasNext = sel >= 0 && sel < state.chords.length - 1;

    let mode = opts.mode;
    if (!mode || mode === 'auto') {
      mode = opts.insert ? 'insert' : 'replace';
    }

    const beforeChord =
      sel >= 0 && state.chords[sel] ? M().cloneChord(state.chords[sel]) : null;

    // Snapshot chord after the rewrite zone for join audition (best-effort)
    let afterChordPre = null;
    if (mode === 'insert' && state.chords[sel + 1]) {
      afterChordPre = M().cloneChord(state.chords[sel + 1]);
    } else if (mode !== 'insert' && hasNext) {
      const peek = sel + 1 + rawPieces.length;
      if (state.chords[peek]) afterChordPre = M().cloneChord(state.chords[peek]);
      else if (state.chords[sel + 1 + 1]) afterChordPre = M().cloneChord(state.chords[sel + 2]);
    }

    const fit = fitHorizonIntoSequence(sel, rawPieces, mode);
    if (!fit) return;

    if (item.modulateTo) {
      const dest =
        M().noteName(item.modulateTo.tonic) +
        ' ' +
        (item.modulateTo.mode || 'minor');
      const ok = confirm(
        'Modulate writing home to ' +
          dest +
          '?\n\nOK = change home key · Cancel = write chords only, keep current home'
      );
      if (ok) {
        state.tonic = item.modulateTo.tonic;
        state.mode = item.modulateTo.mode;
        if ($('#tonic')) $('#tonic').value = String(state.tonic);
        if ($('#mode')) $('#mode').value = state.mode;
        if (map) map.setOrigin(state.tonic, state.mode);
      }
    }

    state.selected = Math.min(
      fit.writeAt + fit.pieces.length - 1,
      state.chords.length - 1
    );
    state.fromPackId = null;

    // Ensure time strip rebuilds (clear any stuck resize lock)
    const strip = $('#time-strip');
    if (strip) {
      strip.dataset.resizing = '';
      strip.classList.remove('resizing-strip');
    }

    afterEdit();
    // Force strip + map again after session push
    renderTimeStrip();
    if (map) {
      map.setPath(state.chords, state.selected);
    }
    updateMapStatus();

    const afterIdx = fit.writeAt + fit.pieces.length;
    const afterChord =
      afterChordPre ||
      (afterIdx < state.chords.length ? state.chords[afterIdx] : null);
    A().ensure();
    auditionJoin(beforeChord, fit.pieces, afterChord);

    const labels = fit.pieces.map((p) => p.name).join(' → ');
    const durs = fit.pieces.map((p) => (p.duration || 0) + 'b').join('+');
    const lenNote =
      Math.abs((fit.totalAfter || 0) - (fit.totalBefore || 0)) < 0.05
        ? 'length kept ' + (fit.totalAfter || 0) + 'b'
        : 'length ' + (fit.totalBefore || 0) + 'b → ' + (fit.totalAfter || 0) + 'b';
    setSyncStatus(
      'From here · ' +
        labels +
        ' (' +
        durs +
        ') · ' +
        lenNote +
        (fit.mode === 'append' || fit.mode === 'seed'
          ? ' · step ' + stepDuration() + 'b'
          : '') +
        (item.job ? ' · ' + item.job : '')
    );
  }

  /** Build the chord(s) a horizon item would write (durations assigned later by fit). */
  function horizonPieces(item) {
    const region = item.chord && (item.chord.region || regionFromKind(item.kind));
    if (item.route && item.route.length) {
      return item.route.map((c) => {
        const x = M().cloneChord(c);
        // duration placeholder — fitHorizonIntoSequence overwrites
        x.duration = c.duration || 2;
        x.tag = item.kind || x.tag || 'horizon';
        x.region = x.region || region;
        x.localTonic = state.tonic;
        x.localMode = state.mode;
        return x;
      });
    }
    const ch = M().cloneChord(item.chord);
    ch.duration = item.chord.duration || 2;
    ch.tag = item.kind || 'horizon';
    ch.region = region;
    ch.localTonic = state.tonic;
    ch.localMode = state.mode;
    return [ch];
  }

  function regionFromKind(kind) {
    if (kind === 'home') return 'diatonic';
    if (kind === 'cadence') return 'diatonic';
    if (kind === 'modulate') return 'chromatic';
    if (kind === 'flavour') return 'interchange';
    return 'diatonic';
  }

  /** Tonic / home chord for current writing key */
  function makeHomeChord(opts) {
    opts = opts || {};
    const music = M();
    const t = state.tonic;
    const isMin = state.mode === 'minor' || (music.MODES[state.mode] || {}).romanBase === 'minor';
    const q = isMin ? 'min' : 'maj';
    let ch = music.makeChord(t, q, {
      duration: opts.duration != null ? opts.duration : stepDuration(),
      region: 'diatonic',
      roman: isMin ? 'i' : 'I',
      tag: 'home',
    });
    ch.localTonic = state.tonic;
    ch.localMode = state.mode;
    return ch;
  }

  /** Place or jump to home as the first / next step (explicit start-at-home). */
  function startAtHome() {
    const home = makeHomeChord({ duration: 4 });
    // Same fitting rules as From here
    commitHorizon(
      {
        chord: home,
        kind: 'home',
        label: home.name + ' home',
        job: 'start at tonic',
      },
      {}
    );
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

    // Always offer home / tonic first (start empty path or return to centre)
    {
      const home = makeHomeChord({ duration: 4 });
      const alreadyOnHome =
        from &&
        from.root === home.root &&
        (from.quality === home.quality ||
          (from.quality || '').indexOf(home.quality === 'min' ? 'min' : 'maj') === 0);
      // Still show when empty, or when not already resting on tonic
      if (!from || !alreadyOnHome || !state.chords.length) {
        items.push({
          chord: home,
          kind: 'home',
          label: home.name,
          job: state.chords.length ? 'land home' : 'start here',
        });
      }
    }

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

    // Directions — 1 or 2 chord packages that still join the rest of the path
    if (compose.suggestDirectionPaths || compose.suggestNext) {
      const sel =
        state.selected >= 0 && state.selected < state.chords.length
          ? state.selected
          : state.chords.length - 1;
      const tail = sel >= 0 ? state.chords.slice(sel + 1) : [];
      const sug = compose.suggestDirectionPaths
        ? compose.suggestDirectionPaths({
            fromChord: from,
            tail,
            tonic: t,
            modeKey: state.mode,
            goalId: 'balanced',
            count: 7,
            path: state.chords.slice(0, Math.max(0, sel + 1)),
          })
        : compose.suggestNext({
            fromChord: from,
            tonic: t,
            modeKey: state.mode,
            goalId: 'balanced',
            count: 5,
            path: state.chords,
          }).map((s) => ({
            chord: s.chord,
            chords: [s.chord],
            label: s.chord.name,
            jobLabel: s.jobLabel,
            steps: 1,
          }));
      sug.forEach((s) => {
        const route = s.chords && s.chords.length ? s.chords : [s.chord];
        items.push({
          chord: route[0],
          kind: 'direction',
          label: s.label || route.map((c) => c.name).join(' → '),
          job: s.jobLabel || s.job || (route.length > 1 ? route.length + ' steps' : ''),
          // Multi-chord packages replace/insert the whole path so the join still works
          route: route.length >= 2 ? route : undefined,
          steps: route.length,
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
  function stopPlaybackUI() {
    if (A().stopPlayback) A().stopPlayback();
    if (map) map.setPlaying(-1);
    updatePlayBtn();
    renderSlots();
    renderTimeStrip();
  }

  /**
   * Play sequence. opts: { once, fromIndex, chords, label, onEnd }
   * fromIndex — start at selected (or given) step of state.chords
   */
  function playSeq(opts) {
    opts = opts || {};
    A().ensure();
    if (A().isPlaying()) {
      if (!opts.force) {
        stopPlaybackUI();
        return;
      }
      A().stopPlayback();
      if (map) map.setPlaying(-1);
    }
    const from = Math.max(0, opts.fromIndex != null ? opts.fromIndex : 0);
    const source = opts.chords || state.chords;
    if (!source.length) return;
    const slice = source.slice(from).map((c) => M().cloneChord(c));
    if (!slice.length) return;
    const once = opts.once != null ? opts.once : !state.loop;
    const loop = opts.loop != null ? opts.loop : once ? false : state.loop;
    A().playSequence(slice, state.bpm, {
      loop,
      pulse: state.pulse,
      onStep: (i) => {
        const idx = from + i;
        if (map) map.setPlaying(opts.chords ? -1 : idx);
        if (!opts.chords) {
          state.selected = Math.min(idx, state.chords.length - 1);
          renderSlots();
          renderTimeStrip();
          updateMapStatus();
        }
      },
      onEnd: () => {
        if (map) map.setPlaying(-1);
        renderTimeStrip();
        renderSlots();
        updatePlayBtn();
        if (opts.onEnd) opts.onEnd();
      },
    });
    updatePlayBtn();
    if (opts.label) setSyncStatus(opts.label);
    else if (from > 0) setSyncStatus('Playing from step ' + (from + 1));
  }

  function playFromSelection() {
    if (!state.chords.length) return;
    const from = Math.max(0, state.selected >= 0 ? state.selected : 0);
    playSeq({ fromIndex: from, once: !state.loop, force: true, label: 'From step ' + (from + 1) });
  }

  /** A then B: current cell, then comparison version. */
  function playAB() {
    if (!state.chords.length) return;
    A().ensure();
    if (A().isPlaying()) stopPlaybackUI();
    const song = S() && S().loadSong();
    const other = song ? resolveCompareCell(song) : null;
    const nameA = state.title || 'A';
    const nameB = other ? other.name || 'B' : null;
    setSyncStatus('A/B · A: ' + nameA);
    playSeq({
      once: true,
      loop: false,
      force: true,
      label: 'A · ' + nameA,
      onEnd: () => {
        if (!other || !other.chords || !other.chords.length) {
          setSyncStatus('A/B · no comparison version (Alt-click a version chip)');
          return;
        }
        const bChords = other.chords.map((sc) => sessionChordToLandscape(sc));
        setTimeout(() => {
          playSeq({
            chords: bChords,
            once: true,
            loop: false,
            force: true,
            label: 'B · ' + nameB + ' (blue path)',
          });
        }, 280);
      },
    });
  }

  function updatePlayBtn() {
    const playing = A().isPlaying();
    const b = $('#btn-play');
    if (b) {
      b.textContent = playing ? 'Stop' : state.loop ? 'Play ↻' : 'Play';
      b.classList.toggle('on', playing);
    }
    const bf = $('#btn-play-from');
    if (bf) bf.classList.toggle('on', false);
  }

  /** Audition join: chord before write → new package → what follows. */
  function auditionJoin(beforeChord, pieces, afterChord) {
    const seq = [];
    if (beforeChord) seq.push(M().cloneChord(beforeChord));
    (pieces || []).forEach((p) => {
      const x = M().cloneChord(p);
      x.duration = Math.min(2, x.duration || 2);
      seq.push(x);
    });
    if (afterChord) seq.push(M().cloneChord(afterChord));
    if (seq.length < 2) {
      if (seq[0]) A().playChord({ chord: seq[0] });
      return;
    }
    seq.forEach((c) => {
      c.duration = Math.min(1.6, c.duration || 1.6);
    });
    A().ensure();
    if (A().stopPlayback) A().stopPlayback();
    A().playSequence(seq, Math.max(state.bpm, 100), { pulse: false, loop: false });
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
    renderVersionBar();
    renderPacks();
    renderHorizonLists();
    refreshMap();
    updatePlayBtn();
  }

  function refreshUI() {
    refreshSequence();
    renderVersionBar();
    renderHorizonLists();
    refreshMap();
  }

  function refreshMap() {
    map.setOrigin(state.tonic, state.mode);
    map.setPath(state.chords, state.selected);
    map.setHorizon(buildHorizon());
    renderTimeStrip();
    refreshAltPath();
  }

  function renderTimeStrip() {
    const host = $('#time-strip');
    if (!host) return;
    // Don't rebuild DOM mid-drag — live updates tweak flex/labels instead
    if (host.dataset.resizing === '1') return;
    host.dataset.resizing = '';
    host.innerHTML = '';
    if (!state.chords.length) {
      host.innerHTML = '<span class="ts-empty">Time strip — path steps appear here</span>';
      return;
    }
    state.chords.forEach((ch, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.i = String(i);
      btn.className =
        'ts-step' +
        (i === state.selected ? ' selected' : '') +
        (map && map.playing === i ? ' playing' : '');
      btn.style.flex = (ch.duration || 4) + ' 1 0';
      const beats = ch.duration || 4;
      btn.title =
        i + 1 + '. ' + ch.name + ' · ' + beats + ' beats — drag right edge to resize';
      btn.innerHTML =
        `<span class="ts-n">${i + 1}</span>` +
        `<span class="ts-name">${ch.name}</span>` +
        `<span class="ts-dur">${beats}b</span>`;

      // Resize handle on right edge
      const handle = document.createElement('span');
      handle.className = 'ts-handle';
      handle.title =
        i < state.chords.length - 1
          ? 'Drag to redistribute beats with next chord'
          : 'Drag to change length';
      handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        beginStripResize(i, e, host);
      });
      btn.appendChild(handle);

      btn.addEventListener('click', (e) => {
        if (host.dataset.didResize === '1') {
          host.dataset.didResize = '';
          return;
        }
        state.selected = i;
        A().ensure();
        A().playChord({ chord: ch });
        refreshUI();
      });
      // Double-click: split this step (timing stays same total)
      btn.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        splitChordAt(i);
      });
      host.appendChild(btn);
    });
  }

  /**
   * Drag the right border of a time-strip step to change durations.
   */
  function beginStripResize(index, e, host) {
    if (index < 0 || !state.chords[index]) return;
    pushUndo();
    host.dataset.resizing = '1';
    host.classList.add('resizing-strip');
    const startX = e.clientX;
    const startDur = state.chords[index].duration || 4;
    const startNext =
      index < state.chords.length - 1 ? state.chords[index + 1].duration || 4 : null;
    // Beats per pixel from current strip width / total beats
    const totalBeats = state.chords.reduce((s, c) => s + (c.duration || 4), 0) || 1;
    const stripW = Math.max(40, host.getBoundingClientRect().width);
    const beatsPerPx = totalBeats / stripW;
    let lastApplied = 0;
    let moved = false;

    const stepEl = host.querySelector('.ts-step[data-i="' + index + '"]');
    const nextEl = host.querySelector('.ts-step[data-i="' + (index + 1) + '"]');
    if (stepEl) stepEl.classList.add('resizing');
    const handle = stepEl && stepEl.querySelector('.ts-handle');
    if (handle) handle.classList.add('active');

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      if (Math.abs(dx) > 2) moved = true;
      const delta = dx * beatsPerPx;
      // Restore base then apply so snap doesn't accumulate error
      state.chords[index] = M().withDuration(state.chords[index], startDur);
      if (startNext != null && state.chords[index + 1]) {
        state.chords[index + 1] = M().withDuration(state.chords[index + 1], startNext);
      }
      resizeStripEdge(index, delta, { live: true });
      lastApplied = delta;
      // Live flex update
      const a = state.chords[index];
      const da = a.duration || 4;
      if (stepEl) {
        stepEl.style.flex = da + ' 1 0';
        const durEl = stepEl.querySelector('.ts-dur');
        if (durEl) durEl.textContent = da + 'b';
        stepEl.title = index + 1 + '. ' + a.name + ' · ' + da + ' beats';
      }
      if (nextEl && state.chords[index + 1]) {
        const b = state.chords[index + 1];
        const db = b.duration || 4;
        nextEl.style.flex = db + ' 1 0';
        const durEl = nextEl.querySelector('.ts-dur');
        if (durEl) durEl.textContent = db + 'b';
        nextEl.title = index + 2 + '. ' + b.name + ' · ' + db + ' beats';
      }
      const pair =
        startNext != null && state.chords[index + 1]
          ? da + 'b + ' + (state.chords[index + 1].duration || 4) + 'b'
          : da + 'b';
      setSyncStatus('Resize: ' + a.name + ' · ' + pair);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      host.dataset.resizing = '';
      host.classList.remove('resizing-strip');
      if (stepEl) stepEl.classList.remove('resizing');
      if (handle) handle.classList.remove('active');
      if (moved) {
        host.dataset.didResize = '1';
        state.selected = index;
        state.fromPackId = null;
        afterEdit();
        const a = state.chords[index];
        const msg =
          startNext != null && state.chords[index + 1]
            ? 'Lengths: ' +
              a.name +
              ' ' +
              (a.duration || 4) +
              'b · ' +
              state.chords[index + 1].name +
              ' ' +
              (state.chords[index + 1].duration || 4) +
              'b'
            : a.name + ' · ' + (a.duration || 4) + ' beats';
        setSyncStatus(msg);
      }
      // Full refresh so inspector + map duration tails match
      refreshUI();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    try {
      handle && handle.setPointerCapture && handle.setPointerCapture(e.pointerId);
    } catch (_) { /* ignore */ }
  }

  /** Prefer next chords that continue L–R swing or arch home */
  function suggestSwingNext() {
    if (!state.chords.length || !map) return;
    const last = state.chords[state.chords.length - 1];
    const nodes = map.nodes || [];
    const lastNode = nodes[nodes.length - 1];
    const side = lastNode ? (lastNode.x >= 0 ? 1 : -1) : 1;
    // Want opposite side of home
    const wantSide = -side;
    const t = state.tonic;
    const candidates = [];
    for (let d = 0; d < 12; d++) {
      ['min', 'maj', 'dom7', 'min7', 'maj7'].forEach((q) => {
        const root = (t + d) % 12;
        let ch = M().makeChord(root, q, { duration: 4, region: d === 0 ? 'diatonic' : 'interchange' });
        const pos = map._chordPos(ch, 0, 0);
        const s = pos.x >= 0 ? 1 : -1;
        if (s !== wantSide) return;
        const dist = Math.abs(pos.x) + Math.abs(pos.y) * 0.5;
        candidates.push({ ch, score: dist + (M().voiceLeadingQuality ? M().voiceLeadingQuality(last, ch) * 20 : 0) });
      });
    }
    candidates.sort((a, b) => b.score - a.score);
    const pick = candidates[0];
    if (!pick) return;
    pushUndo();
    let ch = pick.ch;
    if (C().bestInversion) ch = C().bestInversion(last, ch);
    ch.duration = 4;
    ch.tag = 'swing';
    ch.localTonic = state.tonic;
    ch.localMode = state.mode;
    state.chords.push(ch);
    state.selected = state.chords.length - 1;
    state.fromPackId = null;
    afterEdit();
    A().ensure();
    A().playChord({ chord: ch });
    setSyncStatus('Added swing step · ' + ch.name);
  }

  function suggestArchHome() {
    if (!state.chords.length) return;
    const last = state.chords[state.chords.length - 1];
    const t = state.tonic;
    // V7 then will want home — just add V7
    pushUndo();
    let ch = M().makeChord((t + 7) % 12, 'dom7', {
      duration: 2,
      region: 'diatonic',
      roman: 'V7',
      tag: 'arch-home',
    });
    if (C().bestInversion) ch = C().bestInversion(last, ch);
    ch.duration = 2;
    ch.localTonic = state.tonic;
    ch.localMode = state.mode;
    state.chords.push(ch);
    // Then tonic
    let home = M().makeChord(t, state.mode === 'major' ? 'maj' : 'min', {
      duration: 4,
      region: 'diatonic',
      roman: 'i',
      tag: 'home',
    });
    if (C().bestInversion) home = C().bestInversion(ch, home);
    home.duration = 4;
    home.localTonic = state.tonic;
    home.localMode = state.mode;
    state.chords.push(home);
    state.selected = state.chords.length - 1;
    state.fromPackId = null;
    afterEdit();
    A().ensure();
    A().playSequence([ch, home], state.bpm, { pulse: false });
    setSyncStatus('Arch home · V7 → tonic');
  }

  function refreshSequence() {
    renderTitle();
    renderSlots();
    renderInspector();
    renderVlReadout();
    renderCritique();
    updateMapStatus();
  }

  function updateMapStatus() {
    const el = $('#map-status');
    if (!el) return;
    if (!state.chords.length) {
      el.textContent =
        'Empty path — click a coloured dot around home (or use From here / Add) to place the first chord';
      return;
    }
    const i = Math.max(0, Math.min(state.selected, state.chords.length - 1));
    const ch = state.chords[i];
    if (!ch) {
      el.textContent = 'Select a step in the list or on the path';
      return;
    }
    let side = '';
    if (map && map.nodes && map.nodes[i]) {
      const x = map.nodes[i].x;
      side = x < -12 ? ' · left of home' : x > 12 ? ' · right of home' : ' · near home';
    }
    const play = map && map.playing === i ? ' · playing' : '';
    const coach =
      state.chords.length < 2
        ? ' · tip: click another outer dot for the next step, or drag this chord to aim a swap'
        : '';
    el.textContent =
      'Step ' +
      (i + 1) +
      ' of ' +
      state.chords.length +
      ' · ' +
      ch.name +
      ' · ' +
      (ch.duration || 4) +
      'b' +
      side +
      play +
      coach;
  }

  function renderVlReadout() {
    const el = $('#vl-readout');
    if (!el) return;
    const i = state.selected;
    if (i < 1 || !state.chords[i] || !C().voiceLeadingDetail) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    const d = C().voiceLeadingDetail(state.chords[i - 1], state.chords[i]);
    if (!d) {
      el.hidden = true;
      return;
    }
    const q =
      d.quality >= 0.7 ? 'smooth' : d.quality >= 0.45 ? 'ok' : 'jumpy';
    el.hidden = false;
    el.textContent =
      'Into ' +
      state.chords[i].name +
      ': bass ' +
      d.bassFrom +
      '→' +
      d.bassTo +
      ' (' +
      d.bassMotion +
      ') · common ' +
      (d.common.length ? d.common.join(' ') : '—') +
      ' · moving ' +
      (d.moving.length ? d.moving.join(' ') : '—') +
      ' · ' +
      q;
  }

  function renderCritique() {
    const el = $('#critique');
    if (!el) return;
    if (!state.chords.length || !C().analyzeCell) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    const a = C().analyzeCell(state.chords, state.tonic, state.mode);
    const g = a.grades || {};
    const pct = (x) => Math.round((x || 0) * 100);
    el.hidden = false;
    el.innerHTML =
      '<div><strong>Cell read</strong> · score ' +
      pct(a.score) +
      '%</div>' +
      '<div class="grades">' +
      ['hook', 'motion', 'return', 'rhythm', 'voice']
        .map((k) => '<span class="g">' + k + ' ' + pct(g[k]) + '</span>')
        .join('') +
      '</div>' +
      (a.strengths && a.strengths[0]
        ? '<div>✓ ' + escapeHtml(a.strengths[0]) + '</div>'
        : '') +
      (a.weaknesses && a.weaknesses[0]
        ? '<div>△ ' + escapeHtml(a.weaknesses[0]) + '</div>'
        : '') +
      (a.tips && a.tips[0] ? '<div>→ ' + escapeHtml(a.tips[0]) + '</div>' : '');
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
      why.textContent =
        'Edit the path · From here suggests next moves · versions live under the name';
    }
    $('#path-text').textContent = state.chords.map((c) => c.name).join(' → ') || 'Empty — add a chord or load a feel';
  }

  function renderSlots() {
    const host = $('#slots');
    host.innerHTML = '';
    const diffs = diffIndicesVsCompare();
    const playing = map ? map.playing : -1;
    state.chords.forEach((ch, i) => {
      const el = document.createElement('div');
      el.className =
        'slot' +
        (i === state.selected ? ' selected' : '') +
        (diffs.has(i) ? ' diff' : '') +
        (playing === i ? ' playing-step' : '');
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
        ${[0.5, 1, 1.5, 2, 3, 4, 6, 8].map((b) => `<button type="button" class="chip dur-p" data-b="${b}">${b}</button>`).join('')}
      </div>
      <div class="field" style="margin-top:0.35rem">Bass</div>
      <div class="bass-row" id="bass-row"></div>
      <div class="row" style="margin-top:0.5rem">
        <button type="button" class="btn ghost" id="insp-dup">Duplicate</button>
        <button type="button" class="btn ghost" id="insp-split" title="Split duration in half">Split</button>
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
    if (host.querySelector('#insp-split')) {
      host.querySelector('#insp-split').addEventListener('click', () => splitChordAt(state.selected));
    }
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
    const host = $('#list-from-here') || $('#list-direction');
    if (!host) return;
    host.innerHTML = '';
    // Clear legacy hosts
    ['list-flavour', 'list-direction', 'list-cadence', 'list-modulate'].forEach((id) => {
      const el = document.getElementById(id);
      if (el && el !== host) el.innerHTML = '';
    });

    const items = buildHorizon();
    // Prefer directions first, then flavours, cadences, modulate
    const order = { home: -1, direction: 0, flavour: 1, cadence: 2, modulate: 3 };
    items.sort((a, b) => (order[a.kind] != null ? order[a.kind] : 9) - (order[b.kind] != null ? order[b.kind] : 9));

    const hasNext =
      state.selected >= 0 && state.selected < state.chords.length - 1;
    const tipDefault = hasNext
      ? 'Click = replace next · Shift+click = insert · hover = audition'
      : 'Click = append · Shift+click = insert · hover = audition';
    const kindLabel = {
      home: 'Home',
      direction: 'Dir',
      flavour: 'Colour',
      cadence: 'Cadence',
      modulate: 'Mod',
    };

    items.forEach((it) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'hz kind-' + it.kind;
      b.title = tipDefault + (it.kind === 'modulate' ? ' · may change home key' : '');
      b.innerHTML =
        '<span class="hz-tag">' +
        (kindLabel[it.kind] || it.kind) +
        '</span><strong>' +
        escapeHtml(it.label) +
        '</strong><span>' +
        escapeHtml(it.job || (it.chord && it.chord.name) || '') +
        '</span>';
      b.addEventListener('mouseenter', () => {
        A().ensure();
        const pieces =
          it.route && it.route.length ? it.route : it.chord ? [it.chord] : [];
        // Context audition: selected → package → following chord if any
        const seq = [];
        const sel =
          state.selected >= 0 && state.chords[state.selected]
            ? state.chords[state.selected]
            : null;
        if (sel) seq.push(sel);
        pieces.forEach((c) => seq.push(c));
        const afterIdx = (state.selected >= 0 ? state.selected : -1) + 1 + pieces.length;
        // On hover we don't mutate — approximate after as current next when single step replace
        if (pieces.length === 1 && state.chords[state.selected + 2]) {
          seq.push(state.chords[state.selected + 2]);
        } else if (pieces.length >= 2 && state.chords[state.selected + 1 + pieces.length]) {
          seq.push(state.chords[state.selected + 1 + pieces.length]);
        } else if (hasNext && pieces.length === 1 && state.chords[state.selected + 1]) {
          // will replace next — show join into what was after next
          if (state.chords[state.selected + 2]) seq.push(state.chords[state.selected + 2]);
        }
        if (seq.length >= 2) {
          if (A().stopPlayback) A().stopPlayback();
          A().playSequence(
            seq.map((c) => {
              const x = M().cloneChord(c);
              x.duration = 1.35;
              return x;
            }),
            Math.max(state.bpm, 110),
            { pulse: false, loop: false }
          );
        } else if (pieces[0]) {
          A().playChord({ chord: pieces[0], soft: true, duration: 0.45 });
        }
      });
      b.addEventListener('click', (e) => {
        commitHorizon(it, { insert: !!(e && e.shiftKey) });
      });
      host.appendChild(b);
    });
  }

  function wire() {
    // Track last write-home for optional "Transpose all" after a home change
    state._prevTonicForTranspose = state.tonic;

    $('#tonic').addEventListener('change', (e) => {
      const prev = state.tonic;
      const next = parseInt(e.target.value, 10);
      state._prevTonicForTranspose = prev;
      // Default: move compass only (modulation / re-centre) — do NOT transpose
      setWritingHome(next, state.mode, { transpose: false });
      setSyncStatus(
        'Write home → ' +
          keyLabel() +
          (state.chords.length
            ? ' · chords stay put · Land here = from selection · Transpose all = move pitches'
            : ' · empty path · Home centre is this tonic')
      );
    });
    $('#mode').addEventListener('change', (e) => {
      const next = e.target.value;
      setWritingHome(state.tonic, next, { transpose: false });
      setSyncStatus(
        'Write mode → ' +
          keyLabel() +
          ' · From here + map colours update · chords unchanged (use Parallel vary to flip qualities)'
      );
    });
    if ($('#btn-land-home')) {
      $('#btn-land-home').addEventListener('click', landSelectionAsHome);
    }
    if ($('#btn-transpose-all')) {
      $('#btn-transpose-all').addEventListener('click', () => {
        if (!state.chords.length) {
          setSyncStatus('Nothing to transpose');
          return;
        }
        // If user just changed write home, transpose from previous; else ask delta via confirm
        const prev = state._prevTonicForTranspose;
        if (prev != null && prev !== state.tonic) {
          transposeAllToWriteHome(prev);
          return;
        }
        // No pending home change: transpose so first chord / selected becomes write home pitch?
        const ch =
          state.selected >= 0 && state.chords[state.selected]
            ? state.chords[state.selected]
            : state.chords[0];
        if (!ch) return;
        const delta = (state.tonic - ch.root + 12) % 12;
        if (!delta) {
          setSyncStatus('Already aligned with write home root');
          return;
        }
        pushUndo();
        state.chords = state.chords.map((c) => transposeChord(c, delta, state.tonic, state.mode));
        afterEdit();
        setSyncStatus('Transposed so selection/path aligns with write home ' + keyLabel());
      });
    }
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
    if ($('#btn-play'))
      $('#btn-play').addEventListener('click', () => {
        if (A().isPlaying()) stopPlaybackUI();
        else playSeq({ fromIndex: 0, force: true });
      });
    if ($('#btn-play-from'))
      $('#btn-play-from').addEventListener('click', () => playFromSelection());
    if ($('#btn-ab')) $('#btn-ab').addEventListener('click', () => playAB());
    if ($('#btn-stop')) $('#btn-stop').addEventListener('click', () => stopPlaybackUI());
    if ($('#btn-add')) $('#btn-add').addEventListener('click', () => addChordFromPicker('end'));
    if ($('#btn-insert')) $('#btn-insert').addEventListener('click', () => addChordFromPicker('after'));
    if ($('#btn-dup')) $('#btn-dup').addEventListener('click', duplicateSelected);
    if ($('#btn-smooth')) $('#btn-smooth').addEventListener('click', smoothVoicings);
    if ($('#btn-undo-edit')) $('#btn-undo-edit').addEventListener('click', undo);
    if ($('#btn-redo-edit')) $('#btn-redo-edit').addEventListener('click', redo);
    if ($('#btn-undo')) $('#btn-undo').addEventListener('click', undo);
    if ($('#btn-clear')) {
      $('#btn-clear').addEventListener('click', () => {
        if (!state.chords.length || confirm('Clear sequence?')) clearSeq();
      });
    }
    if ($('#btn-export-txt')) $('#btn-export-txt').addEventListener('click', exportText);
    if ($('#btn-export-mid')) $('#btn-export-mid').addEventListener('click', exportMidi);
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
    if ($('#btn-start-home')) $('#btn-start-home').addEventListener('click', startAtHome);
    if ($('#step-dur')) {
      $('#step-dur').querySelectorAll('[data-step-dur]').forEach((btn) => {
        btn.addEventListener('click', () => setDefaultDuration(parseFloat(btn.dataset.stepDur)));
      });
      setDefaultDuration(state.defaultDuration, { silent: true });
    }
    if ($('#btn-swing')) $('#btn-swing').addEventListener('click', suggestSwingNext);
    if ($('#btn-arch')) $('#btn-arch').addEventListener('click', suggestArchHome);
    if ($('#tog-horizon')) {
      $('#tog-horizon').addEventListener('change', (e) => {
        map.setShowHorizon(e.target.checked);
      });
      map.setShowHorizon($('#tog-horizon').checked);
    }
    if ($('#tog-alt')) {
      $('#tog-alt').addEventListener('change', (e) => {
        map.setShowAlt(e.target.checked);
      });
    }

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
        if (e.shiftKey) playFromSelection();
        else if (A().isPlaying()) stopPlaybackUI();
        else playSeq({ fromIndex: 0, force: true });
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
        stopPlaybackUI();
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
