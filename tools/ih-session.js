/**
 * Idle Hanz — shared song session (Desktop Landscape ↔ Fretboard)
 * localStorage key + URL hash handoff (hash works under file://)
 */
(function (global) {
  'use strict';

  const SESSION_KEY = 'idlehanz_song_v1';
  const HANDOFF_KEY = 'idlehanz_handoff_v1';
  const HASH_PREFIX = 'ih=';

  /** Landscape quality → fretboard chordTypes index */
  const QUALITY_TO_TYPE = {
    maj: 0,
    min: 1,
    dom7: 2,
    maj7: 3,
    min7: 4,
    halfdim: 5,
    dim: 6,
    dim7: 7,
    minmaj7: 8,
    aug: 9,
    sus2: 10,
    sus4: 11,
    add9: 16,
    maj9: 20,
    min9: 21,
  };

  const TYPE_TO_QUALITY = {
    0: 'maj',
    1: 'min',
    2: 'dom7',
    3: 'maj7',
    4: 'min7',
    5: 'halfdim',
    6: 'dim',
    7: 'dim7',
    8: 'minmaj7',
    9: 'aug',
    10: 'sus2',
    11: 'sus4',
    16: 'add9',
    20: 'maj9',
    21: 'min9',
  };

  function now() {
    return new Date().toISOString();
  }

  function emptySong(opts) {
    opts = opts || {};
    return {
      version: 1,
      title: opts.title || 'Untitled',
      bpm: opts.bpm != null ? opts.bpm : 96,
      key: {
        tonic: opts.tonic != null ? opts.tonic : 11,
        mode: opts.mode || 'minor',
      },
      updatedAt: now(),
      updatedBy: opts.updatedBy || 'system',
      cells: {},
      arrangement: [],
      focus: { cellId: null, sectionId: null, chordIndex: 0 },
    };
  }

  function loadSong() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || o.version !== 1) return null;
      return o;
    } catch (_) {
      return null;
    }
  }

  function saveSong(song, by) {
    if (!song) return false;
    song.updatedAt = now();
    song.updatedBy = by || song.updatedBy || 'unknown';
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(song));
      return true;
    } catch (_) {
      return false;
    }
  }

  function ensureCell(song, cellId, name) {
    if (!song.cells[cellId]) {
      song.cells[cellId] = {
        id: cellId,
        name: name || 'Cell',
        packId: null,
        chords: [],
      };
    }
    return song.cells[cellId];
  }

  function newCellId(prefix) {
    return (prefix || 'cell') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  }

  /** Normalize Landscape chord → session chord */
  function fromLandscapeChord(c) {
    const root = typeof c.root === 'number' ? ((c.root % 12) + 12) % 12 : pcFromName(c.root);
    const bass =
      c.bassPc != null
        ? ((c.bassPc % 12) + 12) % 12
        : c.bass != null
          ? typeof c.bass === 'number'
            ? ((c.bass % 12) + 12) % 12
            : pcFromName(c.bass)
          : root;
    return {
      root,
      quality: c.quality || 'maj',
      duration: c.duration != null ? c.duration : 4,
      bass,
      roman: c.roman || '',
      region: c.region || '',
      tag: c.tag || '',
    };
  }

  function pcFromName(name) {
    if (typeof name === 'number') return ((name % 12) + 12) % 12;
    const n = String(name || 'C').trim();
    const m = n.match(/^([A-Ga-g])([#b]?)/);
    if (!m) return 0;
    const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase()];
    const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
    return (base + acc + 12) % 12;
  }

  function qualityToTypeIdx(q) {
    if (QUALITY_TO_TYPE[q] != null) return QUALITY_TO_TYPE[q];
    if (q && q.indexOf('min') === 0) return 1;
    if (q && q.indexOf('maj') === 0) return 0;
    if (q === 'dom7' || q === '7') return 2;
    return 0;
  }

  function typeIdxToQuality(idx) {
    return TYPE_TO_QUALITY[idx] != null ? TYPE_TO_QUALITY[idx] : 'maj';
  }

  /**
   * Session chords → fretboard progression slots
   * Requires fretboard newSlot / chordTypes available if enriching bass tone idx.
   */
  function chordsToFretboardSlots(chords, newSlotFn, chordTypes) {
    return (chords || []).map((ch) => {
      const root = ((ch.root % 12) + 12) % 12;
      const typeIdx = qualityToTypeIdx(ch.quality);
      const slot = newSlotFn ? newSlotFn(root, typeIdx) : { root, typeIdx, mode: 'named', customNotes: [0, 4, 7], customRoot: root, bassMode: 'root', bassToneIdx: 0, bassNote: root, visible: true };
      slot.mode = 'named';
      slot.root = root;
      slot.typeIdx = typeIdx;
      const bass = ch.bass != null ? ((ch.bass % 12) + 12) % 12 : root;
      if (bass === root) {
        slot.bassMode = 'root';
        slot.bassToneIdx = 0;
        slot.bassNote = root;
      } else {
        // Prefer chord-tone inversion if possible
        let intervals = [0, 4, 7];
        if (chordTypes && chordTypes[typeIdx]) intervals = chordTypes[typeIdx].intervals;
        const toneIdx = intervals.findIndex((iv) => (root + iv) % 12 === bass);
        if (toneIdx >= 0) {
          slot.bassMode = 'chordTone';
          slot.bassToneIdx = toneIdx;
          slot.bassNote = bass;
        } else {
          slot.bassMode = 'note';
          slot.bassNote = bass;
          slot.bassToneIdx = 0;
        }
      }
      slot.visible = true;
      slot._duration = ch.duration != null ? ch.duration : 4;
      slot._roman = ch.roman || '';
      return slot;
    });
  }

  /** Fretboard progression → session chords */
  function fretboardSlotsToChords(progression, chordTypes) {
    return (progression || []).map((s) => {
      const root = ((s.root % 12) + 12) % 12;
      let quality = typeIdxToQuality(s.typeIdx);
      let bass = root;
      if (s.bassMode === 'chordTone' && chordTypes && chordTypes[s.typeIdx]) {
        const iv = chordTypes[s.typeIdx].intervals[s.bassToneIdx || 0] || 0;
        bass = (root + iv) % 12;
      } else if (s.bassMode === 'note') {
        bass = ((s.bassNote % 12) + 12) % 12;
      }
      if (s.mode === 'custom' && Array.isArray(s.customNotes)) {
        // Keep as min/maj-ish from intervals if possible
        quality = guessQualityFromIntervals(s.customNotes, s.customRoot != null ? s.customRoot : root);
      }
      return {
        root,
        quality,
        duration: s._duration != null ? s._duration : 4,
        bass,
        roman: s._roman || '',
        region: '',
        tag: 'fretboard',
      };
    });
  }

  function guessQualityFromIntervals(notes, root) {
    const set = new Set(notes.map((n) => ((n - root) % 12 + 12) % 12));
    const has = (x) => set.has(x);
    if (has(3) && has(7) && has(10)) return 'min7';
    if (has(4) && has(7) && has(10)) return 'dom7';
    if (has(4) && has(7) && has(11)) return 'maj7';
    if (has(3) && has(7) && has(11)) return 'minmaj7';
    if (has(3) && has(6) && has(10)) return 'halfdim';
    if (has(3) && has(6)) return 'dim';
    if (has(3) && has(7)) return 'min';
    if (has(4) && has(7)) return 'maj';
    if (has(2) && has(7)) return 'sus2';
    if (has(5) && has(7)) return 'sus4';
    return 'maj';
  }

  /** Compact handoff for URL hash */
  function buildHandoffPayload(opts) {
    return {
      v: 1,
      t: now(),
      by: opts.by || 'unknown',
      to: opts.to || 'fretboard',
      title: opts.title || 'Untitled',
      bpm: opts.bpm != null ? opts.bpm : 96,
      key: opts.key || { tonic: 11, mode: 'minor' },
      cellId: opts.cellId || null,
      cellName: opts.cellName || 'Cell',
      focus: opts.focus != null ? opts.focus : 0,
      chords: (opts.chords || []).map((c) => ({
        r: c.root,
        q: c.quality,
        d: c.duration != null ? c.duration : 4,
        b: c.bass != null ? c.bass : c.root,
        n: c.roman || '',
      })),
    };
  }

  function expandHandoffChords(compact) {
    return (compact.chords || []).map((c) => ({
      root: c.r,
      quality: c.q,
      duration: c.d != null ? c.d : 4,
      bass: c.b != null ? c.b : c.r,
      roman: c.n || '',
      region: '',
      tag: 'handoff',
    }));
  }

  function encodeHandoff(payload) {
    try {
      const json = JSON.stringify(payload);
      // base64url
      const b64 = btoa(unescape(encodeURIComponent(json)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
      return HASH_PREFIX + b64;
    } catch (_) {
      return null;
    }
  }

  function decodeHandoffString(str) {
    try {
      let s = str;
      if (s.charAt(0) === '#') s = s.slice(1);
      // support #ih=... or full hash with other bits
      const idx = s.indexOf(HASH_PREFIX);
      if (idx >= 0) s = s.slice(idx + HASH_PREFIX.length);
      else return null;
      // strip trailing & if any
      s = s.split('&')[0];
      let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const json = decodeURIComponent(escape(atob(b64)));
      return JSON.parse(json);
    } catch (_) {
      return null;
    }
  }

  function readHandoffFromLocation() {
    if (typeof location === 'undefined') return null;
    return decodeHandoffString(location.hash || '');
  }

  function clearHandoffHash() {
    if (typeof history !== 'undefined' && typeof location !== 'undefined' && location.hash.indexOf(HASH_PREFIX) >= 0) {
      try {
        history.replaceState(null, '', location.pathname + location.search);
      } catch (_) {
        location.hash = '';
      }
    }
  }

  function writeHandoffStorage(payload) {
    try {
      localStorage.setItem(HANDOFF_KEY, JSON.stringify(payload));
    } catch (_) {}
  }

  function readHandoffStorage() {
    try {
      const raw = localStorage.getItem(HANDOFF_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Merge a cell into song and set focus.
   */
  function upsertFocusedCell(song, cell) {
    const id = cell.id || newCellId('cell');
    song.cells[id] = {
      id,
      name: cell.name || 'Cell',
      packId: cell.packId || null,
      chords: (cell.chords || []).map(fromLandscapeChord),
    };
    song.focus = song.focus || {};
    song.focus.cellId = id;
    song.focus.chordIndex = cell.focusIndex != null ? cell.focusIndex : 0;
    if (!song.arrangement) song.arrangement = [];
    return id;
  }

  function getFocusedCell(song) {
    if (!song || !song.focus || !song.focus.cellId) return null;
    return song.cells[song.focus.cellId] || null;
  }

  /**
   * Navigate to a sibling app with hash handoff.
   * Same window by default (avoids many tabs/sessions). Pass opts.newTab = true only if needed.
   */
  function openWithHandoff(relativeUrl, payload, opts) {
    opts = opts || {};
    writeHandoffStorage(payload);
    // Also merge into full song session when possible
    try {
      let song = loadSong() || emptySong({ title: payload.title, bpm: payload.bpm, tonic: payload.key && payload.key.tonic, mode: payload.key && payload.key.mode, updatedBy: payload.by });
      const cellId = payload.cellId || newCellId('cell');
      const prev = song.cells[cellId];
      // Keep user-chosen cell name if handoff name is empty or generic
      const incoming = (payload.cellName || '').trim();
      const keepName =
        prev && prev.name && (!incoming || incoming === 'Cell' || incoming === 'Untitled sequence');
      song.cells[cellId] = {
        id: cellId,
        name: keepName ? prev.name : incoming || (prev && prev.name) || 'Cell',
        packId: prev && prev.packId ? prev.packId : null,
        chords: expandHandoffChords(payload),
      };
      song.focus = { cellId, sectionId: null, chordIndex: payload.focus || 0 };
      song.title = payload.title || song.title;
      song.bpm = payload.bpm != null ? payload.bpm : song.bpm;
      if (payload.key) song.key = payload.key;
      saveSong(song, payload.by);
    } catch (_) {}

    const hash = encodeHandoff(payload);
    let url = relativeUrl;
    if (hash) url += '#' + hash;
    try {
      if (opts.newTab) {
        window.open(url, '_blank');
      } else {
        // Same window: one session, back/forward still works within browser history
        window.location.assign(url);
      }
      return true;
    } catch (_) {
      try {
        window.location.href = url;
        return true;
      } catch (e2) {
        return false;
      }
    }
  }

  /** Same-window navigation without handoff payload */
  function goTo(relativeUrl) {
    try {
      window.location.assign(relativeUrl);
      return true;
    } catch (_) {
      try {
        window.location.href = relativeUrl;
        return true;
      } catch (e2) {
        return false;
      }
    }
  }

  /**
   * Resolve sibling app paths for Desktop kit vs site (/tools/...).
   */
  function resolvePaths() {
    let path = '';
    try {
      path = (typeof location !== 'undefined' && location.pathname) || '';
    } catch (_) {}
    const onSite =
      path.indexOf('/tools/') >= 0 ||
      path.indexOf('idlehanz') >= 0 ||
      path.indexOf('github.io') >= 0;

    if (onSite) {
      // Under tools/harmonic-landscape/ or tools/arrangement/ or tools/fretboard/
      return {
        fretboardFromLandscape: '../fretboard/index.html',
        landscapeFromFretboard: '../harmonic-landscape/index.html',
        arrangementFromLandscape: '../arrangement/index.html',
        arrangementFromFretboard: '../arrangement/index.html',
        landscapeFromArrangement: '../harmonic-landscape/index.html',
        fretboardFromArrangement: '../fretboard/index.html',
        mode: 'site',
      };
    }
    // Desktop kit: Desktop/guitar_fretboard_app.html + Desktop/harmonic-landscape/ + Desktop/arrangement/
    return {
      fretboardFromLandscape: '../guitar_fretboard_app.html',
      landscapeFromFretboard: './harmonic-landscape/index.html',
      arrangementFromLandscape: '../arrangement/index.html',
      arrangementFromFretboard: './arrangement/index.html',
      landscapeFromArrangement: '../harmonic-landscape/index.html',
      fretboardFromArrangement: '../guitar_fretboard_app.html',
      mode: 'desktop',
    };
  }

  function getPaths() {
    return resolvePaths();
  }

  /** Flatten arrangement to ordered chords with durations (beats). */
  function flattenArrangement(song) {
    if (!song) return [];
    const out = [];
    (song.arrangement || []).forEach((sec) => {
      const cell = song.cells && song.cells[sec.cellId];
      if (!cell || !cell.chords) return;
      const reps = Math.max(1, +(sec.reps || 1));
      for (let r = 0; r < reps; r++) {
        cell.chords.forEach((ch) => {
          out.push({
            ...ch,
            _section: sec.name || '',
            _cell: cell.name || '',
            _rep: r,
          });
        });
      }
    });
    return out;
  }

  function sectionBars(song, sec) {
    const cell = song.cells && song.cells[sec.cellId];
    if (!cell || !cell.chords) return 0;
    const beats = cell.chords.reduce((s, c) => s + (c.duration || 4), 0);
    const reps = Math.max(1, +(sec.reps || 1));
    return (beats * reps) / 4;
  }

  function totalBars(song) {
    return (song.arrangement || []).reduce((s, sec) => s + sectionBars(song, sec), 0);
  }

  global.IHSession = {
    SESSION_KEY,
    HANDOFF_KEY,
    QUALITY_TO_TYPE,
    TYPE_TO_QUALITY,
    emptySong,
    loadSong,
    saveSong,
    ensureCell,
    newCellId,
    fromLandscapeChord,
    pcFromName,
    qualityToTypeIdx,
    typeIdxToQuality,
    chordsToFretboardSlots,
    fretboardSlotsToChords,
    buildHandoffPayload,
    expandHandoffChords,
    encodeHandoff,
    decodeHandoffString,
    readHandoffFromLocation,
    clearHandoffHash,
    writeHandoffStorage,
    readHandoffStorage,
    upsertFocusedCell,
    getFocusedCell,
    openWithHandoff,
    goTo,
    get PATHS() {
      return resolvePaths();
    },
    resolvePaths,
    getPaths,
    flattenArrangement,
    sectionBars,
    totalBars,
  };
})(typeof window !== 'undefined' ? window : globalThis);
