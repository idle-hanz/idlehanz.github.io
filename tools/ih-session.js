/**
 * Idle Hanz — shared song session (Desktop Landscape ↔ Fretboard)
 * localStorage key + URL hash handoff (hash works under file://)
 */
(function (global) {
  'use strict';

  const SESSION_KEY = 'idlehanz_song_v1';
  const HANDOFF_KEY = 'idlehanz_handoff_v1';
  const HASH_PREFIX = 'ih=';

  /**
   * Fretboard progression hard cap (guitar_fretboard_app addSlot).
   * Landscape / Arrangement must clip before handoff.
   */
  const FRETBOARD_MAX_CHORDS = 8;
  const SONG_PACKAGE_FORMAT = 'idlehanz-song-package';
  const SONG_PACKAGE_VERSION = 1;

  /** Landscape quality → fretboard chordTypes index */
  const QUALITY_TO_TYPE = {
    maj: 0,
    min: 1,
    dom7: 2,
    // Altered/extended dominants → nearest frettable type (plain 7)
    dom7b9: 2,
    dom7s9: 2,
    dom7s11: 2,
    dom7b13: 2,
    dom7alt: 2,
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
      /** familyId -> { id, name, versionIds: [cellId, ...] } */
      families: {},
      arrangement: [],
      focus: { cellId: null, sectionId: null, chordIndex: 0 },
    };
  }

  function ensureSongShape(song) {
    if (!song) return song;
    if (!song.cells) song.cells = {};
    if (!song.families) song.families = {};
    if (!song.arrangement) song.arrangement = [];
    if (!song.focus) song.focus = { cellId: null, sectionId: null, chordIndex: 0 };
    // Migrate cells: familyId / versionIndex
    Object.keys(song.cells).forEach((id) => {
      const c = song.cells[id];
      if (c.familyId == null) c.familyId = null;
      if (c.versionIndex == null) c.versionIndex = 1;
    });
    // Migrate sections: chain + seam + cycle exit (end / into)
    song.arrangement.forEach((sec) => {
      if (!sec.chain || !sec.chain.length) {
        sec.chain = sec.cellId ? [sec.cellId] : [];
      }
      if (!sec.cellId && sec.chain[0]) sec.cellId = sec.chain[0];
      if (!sec.seam) {
        sec.seam = { type: 'none', chords: [] };
      }
      if (sec.reps == null) sec.reps = 1;
      // last rep only: play end cell instead of body chain (cycle exit)
      if (sec.endCellId === undefined) sec.endCellId = null;
      // after all reps, once: bridge cell before seam / next section
      if (sec.intoCellId === undefined) sec.intoCellId = null;
    });
    return song;
  }

  /**
   * Clip a chord list for Fretboard (max 8).
   * opts.start: optional window start index (default 0).
   * returns { chords, truncated, total, start, max }
   */
  function clipForFretboard(chords, opts) {
    opts = opts || {};
    const max = FRETBOARD_MAX_CHORDS;
    const list = Array.isArray(chords) ? chords : [];
    const total = list.length;
    let start = opts.start != null ? Math.max(0, opts.start | 0) : 0;
    // If focus is near the end, slide window so focus is included when possible
    if (opts.focus != null && opts.focus >= 0 && total > max) {
      const f = opts.focus | 0;
      start = Math.max(0, Math.min(total - max, f - Math.floor(max / 2)));
    }
    if (start > total) start = 0;
    const sliced = list.slice(start, start + max);
    return {
      chords: sliced,
      truncated: total > max,
      total: total,
      start: start,
      max: max,
      dropped: Math.max(0, total - sliced.length),
    };
  }

  function fretboardClipMessage(clip) {
    if (!clip || !clip.truncated) return '';
    const from = (clip.start || 0) + 1;
    const to = (clip.start || 0) + clip.chords.length;
    return (
      'Fretboard max ' +
      clip.max +
      ' chords · sent ' +
      from +
      '–' +
      to +
      ' of ' +
      clip.total +
      ' (full song stays in Landscape / Arrangement)'
    );
  }

  function loadSong() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || o.version !== 1) return null;
      return ensureSongShape(o);
    } catch (_) {
      return null;
    }
  }

  function newFamilyId() {
    return 'fam-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  }

  /**
   * Create a variation cell linked to the same family as sourceCellId.
   * Copies chords (caller may mutate), returns new cell id.
   */
  function createVariation(song, sourceCellId, opts) {
    opts = opts || {};
    ensureSongShape(song);
    const src = song.cells[sourceCellId];
    if (!src) return null;

    let familyId = src.familyId;
    if (!familyId) {
      familyId = newFamilyId();
      src.familyId = familyId;
      src.versionIndex = 1;
      const famName = (src.name || 'Cell').replace(/\s*v\d+\s*$/i, '').trim() || 'Cell';
      song.families[familyId] = {
        id: familyId,
        name: famName,
        versionIds: [sourceCellId],
      };
      // Rename v1 for clarity if still generic pack name only
      if (!/v\d+/i.test(src.name || '')) {
        src.name = famName + ' v1';
      }
    }

    const fam = song.families[familyId];
    const nextIdx = (fam.versionIds || []).length + 1;
    const newId = newCellId('cell');
    // Family base without trailing "v2" / "· v1 Darken" clutter for storage
    const baseName = (fam.name || src.name || 'Cell')
      .replace(/\s*·\s*v\d+.*$/i, '')
      .replace(/\s*v\d+\s*$/i, '')
      .trim() || 'Cell';
    const chords = (opts.chords || src.chords || []).map((c) => ({ ...c }));
    // Prefer caller name (e.g. "Home grit · v1 Darken"); else plain vN
    let cellName = (opts.name && String(opts.name).trim()) || baseName + ' v' + nextIdx;
    // Avoid duplicate display names in the song
    const taken = new Set(
      Object.keys(song.cells).map((id) => (song.cells[id].name || '').toLowerCase())
    );
    if (taken.has(cellName.toLowerCase())) {
      let n = 2;
      while (taken.has((cellName + ' ' + n).toLowerCase())) n += 1;
      cellName = cellName + ' ' + n;
    }
    song.cells[newId] = {
      id: newId,
      name: cellName,
      packId: src.packId || null,
      familyId,
      versionIndex: nextIdx,
      chords,
    };
    fam.versionIds = fam.versionIds || [];
    fam.versionIds.push(newId);
    fam.name = baseName;
    return newId;
  }

  function familyVersions(song, familyId) {
    ensureSongShape(song);
    const fam = song.families[familyId];
    if (!fam) return [];
    return (fam.versionIds || [])
      .map((id) => song.cells[id])
      .filter(Boolean)
      .sort((a, b) => (a.versionIndex || 0) - (b.versionIndex || 0));
  }

  function siblingsOfCell(song, cellId) {
    const cell = song.cells[cellId];
    if (!cell || !cell.familyId) return cell ? [cell] : [];
    return familyVersions(song, cell.familyId);
  }

  /**
   * Delete a cell (version) from the song session.
   * Cleans family lists, arrangement chains/sections, and focus.
   * Mutates song. Does not save — caller should saveSong.
   *
   * returns {
   *   ok: boolean,
   *   reason?: string,
   *   label?: string,
   *   nextFocusId?: string|null,
   *   sectionsTouched?: number,
   *   sectionsRemoved?: number,
   * }
   */
  function deleteCell(song, cellId, opts) {
    opts = opts || {};
    ensureSongShape(song);
    if (!cellId || !song.cells[cellId]) {
      return { ok: false, reason: 'missing' };
    }
    const cell = song.cells[cellId];
    const label = cell.name || cellId;
    const familyId = cell.familyId || null;

    // Prefer switching to another family sibling, else any remaining cell
    let nextFocusId = null;
    if (familyId) {
      const sibs = familyVersions(song, familyId).filter((c) => c.id !== cellId);
      if (sibs.length) {
        nextFocusId = sibs[0].id;
      }
    }
    if (!nextFocusId) {
      const others = Object.keys(song.cells).filter((id) => id !== cellId);
      nextFocusId = others[0] || null;
    }

    const used = (song.arrangement || []).filter(
      (s) => s.cellId === cellId || (s.chain && s.chain.indexOf(cellId) >= 0)
    );
    const sectionsTouched = used.length;

    delete song.cells[cellId];

    // Family bookkeeping
    Object.keys(song.families || {}).forEach((fid) => {
      const fam = song.families[fid];
      if (!fam) return;
      if (fam.versionIds) {
        fam.versionIds = fam.versionIds.filter((id) => id !== cellId);
      }
      // Drop empty families
      if (fam.versionIds && !fam.versionIds.length) {
        delete song.families[fid];
      } else if (fam.versionIds && fam.versionIds.length === 1) {
        // Solo survivor: clear family link optional — keep family for history
        const only = song.cells[fam.versionIds[0]];
        if (only && opts.dissolveSoloFamily) {
          only.familyId = null;
          only.versionIndex = 1;
          delete song.families[fid];
        }
      }
    });

    let sectionsRemoved = 0;
    song.arrangement = (song.arrangement || []).filter((s) => {
      if (s.chain) s.chain = s.chain.filter((id) => id !== cellId);
      if (s.cellId === cellId) {
        s.cellId = s.chain && s.chain[0] ? s.chain[0] : null;
      }
      // Drop section if nothing left to play
      if (!s.cellId && !(s.chain && s.chain.length)) {
        sectionsRemoved += 1;
        return false;
      }
      return true;
    });

    if (song.focus && song.focus.cellId === cellId) {
      song.focus.cellId = nextFocusId;
      song.focus.chordIndex = 0;
    }

    (song.arrangement || []).forEach(function (s) {
      if (s.endCellId === cellId) s.endCellId = null;
      if (s.intoCellId === cellId) s.intoCellId = null;
    });

    return {
      ok: true,
      label,
      nextFocusId,
      sectionsTouched,
      sectionsRemoved,
    };
  }

  /** Cell ids played for a section (chain or single cellId). */
  function sectionChain(sec) {
    if (sec.chain && sec.chain.length) return sec.chain.slice();
    return sec.cellId ? [sec.cellId] : [];
  }

  function defaultSeam() {
    return { type: 'none', chords: [] };
  }

  /**
   * Build a short turnaround from last chord of A toward first of B (session chord objects).
   */
  function suggestSeamChords(fromChord, toChord, key) {
    if (!fromChord || !toChord) return [];
    const t = key && key.tonic != null ? key.tonic : 11;
    const mode = (key && key.mode) || 'minor';
    const isMinor = mode !== 'major' && mode !== 'lydian' && mode !== 'mixolydian';
    // V7 of next chord's root, or V7 of home into next
    const targetRoot = toChord.root;
    const domRoot = (targetRoot + 7) % 12;
    return [
      {
        root: domRoot,
        quality: 'dom7',
        duration: 2,
        bass: domRoot,
        roman: 'V7→',
        region: 'secondary',
        tag: 'seam',
      },
    ];
  }

  /** Smooth: copy last chord with bass toward next root if possible — returns empty (voicing-only at play time). */
  function applySeam(out, seam, fromChord, toChord, key, secName) {
    if (!seam || !seam.type || seam.type === 'none') return;
    if (seam.type === 'turnaround' || seam.type === 'custom') {
      const list =
        seam.chords && seam.chords.length
          ? seam.chords
          : suggestSeamChords(fromChord, toChord, key);
      list.forEach((ch) => {
        out.push({
          ...ch,
          _section: secName || '',
          _cell: 'seam',
          _seam: true,
        });
      });
    }
    // type === 'smooth' → no extra chords; play engine can VL across boundary
  }

  function saveSong(song, by) {
    if (!song) return false;
    ensureSongShape(song);
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
    ensureSongShape(song);
    if (!song.cells[cellId]) {
      song.cells[cellId] = {
        id: cellId,
        name: name || 'Cell',
        packId: null,
        familyId: null,
        versionIndex: 1,
        chords: [],
      };
    }
    return song.cells[cellId];
  }

  function newCellId(prefix) {
    return (prefix || 'cell') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  }

  /** Normalize pitch-class list (unique, 0–11) */
  function normalizePcs(notes) {
    const out = [];
    const seen = new Set();
    (notes || []).forEach((n) => {
      const p = ((Number(n) % 12) + 12) % 12;
      if (seen.has(p)) return;
      seen.add(p);
      out.push(p);
    });
    return out;
  }

  /**
   * Exact quality match only — extras (e.g. C in a B–D–F♯ set) must NOT
   * collapse to "min". Returns quality id or null.
   */
  function exactQualityFromNotes(notes, root) {
    const r = ((root % 12) + 12) % 12;
    const set = new Set(normalizePcs(notes).map((n) => ((n - r) % 12 + 12) % 12));
    // Known interval sets (must match exactly)
    const catalog = [
      ['min7', [0, 3, 7, 10]],
      ['dom7', [0, 4, 7, 10]],
      ['maj7', [0, 4, 7, 11]],
      ['minmaj7', [0, 3, 7, 11]],
      ['halfdim', [0, 3, 6, 10]],
      ['dim7', [0, 3, 6, 9]],
      ['maj9', [0, 2, 4, 7, 11]],
      ['min9', [0, 2, 3, 7, 10]],
      ['add9', [0, 2, 4, 7]],
      ['dim', [0, 3, 6]],
      ['aug', [0, 4, 8]],
      ['min', [0, 3, 7]],
      ['maj', [0, 4, 7]],
      ['sus2', [0, 2, 7]],
      ['sus4', [0, 5, 7]],
    ];
    for (let i = 0; i < catalog.length; i++) {
      const q = catalog[i][0];
      const ivs = catalog[i][1];
      if (ivs.length !== set.size) continue;
      if (ivs.every((iv) => set.has(iv))) return q;
    }
    return null;
  }

  /** Display name for an arbitrary pitch set */
  function customChordLabel(root, notes) {
    const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const r = ((root % 12) + 12) % 12;
    const pcs = normalizePcs(notes);
    if (!pcs.length) return 'Custom ' + NAMES[r];
    // Order from root around the circle of pitch classes
    pcs.sort((a, b) => ((a - r + 12) % 12) - ((b - r + 12) % 12));
    return pcs.map((p) => NAMES[p]).join('·');
  }

  /** Normalize Landscape chord → session chord (preserves custom pitch sets) */
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
    const notes = normalizePcs(c.notes);
    const isCustom =
      !!c.custom ||
      c.quality === 'custom' ||
      (notes.length > 0 && !exactQualityFromNotes(notes, root));
    const quality = isCustom
      ? 'custom'
      : c.quality && c.quality !== 'custom'
        ? c.quality
        : exactQualityFromNotes(notes, root) || 'maj';
    const out = {
      root,
      quality,
      duration: c.duration != null ? c.duration : 4,
      bass,
      roman: c.roman || '',
      region: c.region || '',
      tag: c.tag || '',
    };
    if (notes.length) out.notes = notes;
    // Multi-disk / modulation: which Chase key owns this step
    if (c.localTonic != null) out.localTonic = ((c.localTonic % 12) + 12) % 12;
    if (c.localMode) out.localMode = c.localMode;
    if (isCustom) {
      out.custom = true;
      out.name = c.name || customChordLabel(root, notes.length ? notes : [root]);
    } else if (c.name) {
      out.name = c.name;
    }
    return out;
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
    if (q === 'custom') return 1; // UI fallback only; tones come from notes
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
   * Custom / free pitch sets restore as mode: 'custom' with exact notes.
   */
  function chordsToFretboardSlots(chords, newSlotFn, chordTypes) {
    return (chords || []).map((ch) => {
      const notes = normalizePcs(ch.notes);
      const root = ((ch.root % 12) + 12) % 12;
      const isCustom =
        !!ch.custom ||
        ch.quality === 'custom' ||
        (notes.length > 0 && !exactQualityFromNotes(notes, root));
      // Fallback named type for UI chrome; custom mode uses customNotes for tones
      const guessed =
        (!isCustom && ch.quality && ch.quality !== 'custom'
          ? ch.quality
          : exactQualityFromNotes(notes, root)) ||
        guessQualityFromIntervals(notes.length ? notes : [root], root);
      const typeIdx = qualityToTypeIdx(isCustom ? guessed : ch.quality || guessed);
      const slot = newSlotFn
        ? newSlotFn(root, typeIdx)
        : {
            root,
            typeIdx,
            mode: 'named',
            customNotes: [0, 4, 7],
            customRoot: root,
            bassMode: 'root',
            bassToneIdx: 0,
            bassNote: root,
            visible: true,
          };
      slot.root = root;
      slot.typeIdx = typeIdx;

      if (isCustom) {
        slot.mode = 'custom';
        slot.customRoot = root;
        slot.customNotes = notes.length ? notes.slice() : [root];
        if (slot.customNotes.indexOf(root) < 0) slot.customNotes.push(root);
      } else {
        slot.mode = 'named';
      }

      const bass = ch.bass != null ? ((ch.bass % 12) + 12) % 12 : root;
      if (bass === root) {
        slot.bassMode = 'root';
        slot.bassToneIdx = 0;
        slot.bassNote = root;
      } else if (isCustom && slot.customNotes.indexOf(bass) >= 0) {
        slot.bassMode = 'note';
        slot.bassNote = bass;
        slot.bassToneIdx = 0;
      } else {
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

  /** Fretboard progression → session chords (keeps custom pitch sets intact) */
  function fretboardSlotsToChords(progression, chordTypes) {
    return (progression || []).map((s) => {
      let root = ((s.root % 12) + 12) % 12;
      let quality = typeIdxToQuality(s.typeIdx);
      let bass = root;
      if (s.bassMode === 'chordTone' && chordTypes && chordTypes[s.typeIdx]) {
        const iv = chordTypes[s.typeIdx].intervals[s.bassToneIdx || 0] || 0;
        bass = (root + iv) % 12;
      } else if (s.bassMode === 'note') {
        bass = ((s.bassNote % 12) + 12) % 12;
      }

      if (s.mode === 'custom' && Array.isArray(s.customNotes)) {
        root = s.customRoot != null ? ((s.customRoot % 12) + 12) % 12 : root;
        const notes = normalizePcs(s.customNotes);
        if (notes.indexOf(root) < 0) notes.push(root);
        const exact = exactQualityFromNotes(notes, root);
        if (exact) {
          // True named chord (notes match a quality exactly)
          return {
            root,
            quality: exact,
            duration: s._duration != null ? s._duration : 4,
            bass,
            roman: s._roman || '',
            region: '',
            tag: 'fretboard',
            notes,
          };
        }
        // Free pitch set — never force B·C·D·F# → Bm
        return {
          root,
          quality: 'custom',
          custom: true,
          notes,
          name: customChordLabel(root, notes),
          duration: s._duration != null ? s._duration : 4,
          bass,
          roman: s._roman || '',
          region: 'custom',
          tag: 'custom',
        };
      }

      // Named chord — still attach derived notes when chordTypes known
      let notes = null;
      if (chordTypes && chordTypes[s.typeIdx]) {
        notes = normalizePcs(
          chordTypes[s.typeIdx].intervals.map((iv) => (root + iv) % 12)
        );
      }
      const out = {
        root,
        quality,
        duration: s._duration != null ? s._duration : 4,
        bass,
        roman: s._roman || '',
        region: '',
        tag: 'fretboard',
      };
      if (notes && notes.length) out.notes = notes;
      return out;
    });
  }

  /** Loose guess only for UI typeIdx fallback — not for round-trip identity */
  function guessQualityFromIntervals(notes, root) {
    const set = new Set(
      normalizePcs(notes).map((n) => ((n - root) % 12 + 12) % 12)
    );
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

  /** Compact handoff for URL hash (includes pitch sets for custom chords) */
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
      sectionId: opts.sectionId || null,
      ephemeral: !!opts.ephemeral,
      chords: (opts.chords || []).map((c) => {
        const row = {
          r: c.root,
          q: c.quality,
          d: c.duration != null ? c.duration : 4,
          b: c.bass != null ? c.bass : c.root,
          n: c.roman || '',
        };
        const notes = normalizePcs(c.notes);
        if (notes.length) row.p = notes;
        if (c.custom || c.quality === 'custom') {
          row.c = 1;
          row.nm = c.name || customChordLabel(c.root, notes.length ? notes : [c.root]);
        } else if (c.name) {
          row.nm = c.name;
        }
        // Multi-disk stamps (Landscape); Fretboard may ignore but must not drop on re-open Landscape
        if (c.localTonic != null) row.lt = ((c.localTonic % 12) + 12) % 12;
        if (c.localMode) row.lm = c.localMode;
        return row;
      }),
    };
  }

  function expandHandoffChords(compact) {
    return (compact.chords || []).map((c) => {
      const notes = normalizePcs(c.p);
      const isCustom = !!c.c || c.q === 'custom';
      const out = {
        root: c.r,
        quality: isCustom ? 'custom' : c.q,
        duration: c.d != null ? c.d : 4,
        bass: c.b != null ? c.b : c.r,
        roman: c.n || '',
        region: isCustom ? 'custom' : '',
        tag: isCustom ? 'custom' : 'handoff',
      };
      if (notes.length) out.notes = notes;
      if (isCustom) {
        out.custom = true;
        out.name = c.nm || customChordLabel(c.r, notes.length ? notes : [c.r]);
      } else if (c.nm) {
        out.name = c.nm;
      }
      if (c.lt != null) out.localTonic = ((c.lt % 12) + 12) % 12;
      if (c.lm) out.localMode = c.lm;
      return out;
    });
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
      const incoming = (payload.cellName || '').trim();
      const keepName =
        prev && prev.name && (!incoming || incoming === 'Cell' || incoming === 'Untitled sequence');
      const ephemeral = !!(payload.ephemeral || payload.to === 'fretboard');
      const keepSection =
        (payload.sectionId || (song.focus && song.focus.sectionId)) || null;
      if (ephemeral && prev) {
        song.focus = {
          cellId: cellId,
          sectionId: keepSection,
          chordIndex: payload.focus || 0,
        };
      } else {
        song.cells[cellId] = {
          id: cellId,
          name: keepName ? prev.name : incoming || (prev && prev.name) || 'Cell',
          packId: prev && prev.packId ? prev.packId : null,
          familyId: prev && prev.familyId ? prev.familyId : null,
          versionIndex: prev && prev.versionIndex ? prev.versionIndex : 1,
          chords: expandHandoffChords(payload),
        };
        song.focus = {
          cellId: cellId,
          sectionId: keepSection,
          chordIndex: payload.focus || 0,
        };
      }
      song.title = payload.title || song.title;
      song.bpm = payload.bpm != null ? payload.bpm : song.bpm;
      const songEmpty =
        !song.arrangement ||
        !song.arrangement.length ||
        Object.keys(song.cells || {}).length <= 1;
      if (payload.key && songEmpty) song.key = payload.key;
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
    // Desktop kit: Desktop/fretboard/ + Desktop/harmonic-landscape/ + Desktop/arrangement/
    return {
      fretboardFromLandscape: '../fretboard/index.html',
      landscapeFromFretboard: '../harmonic-landscape/index.html',
      arrangementFromLandscape: '../arrangement/index.html',
      arrangementFromFretboard: '../arrangement/index.html',
      landscapeFromArrangement: '../harmonic-landscape/index.html',
      fretboardFromArrangement: '../fretboard/index.html',
      mode: 'desktop',
    };
  }

  function getPaths() {
    return resolvePaths();
  }

  /** Push one cell's chords into flatten out with meta tags. */
  function pushCellChords(out, song, cellId, meta) {
    const cell = song.cells[cellId];
    if (!cell || !cell.chords) return;
    cell.chords.forEach((ch) => {
      out.push(
        Object.assign({}, ch, {
          _section: meta.section || '',
          _cell: cell.name || '',
          _rep: meta.rep != null ? meta.rep : 0,
          _version: cell.versionIndex || 1,
          _role: meta.role || 'body',
          _seam: !!meta.seam,
        })
      );
    });
  }

  /**
   * Cell ids played for one rep of a section.
   * Last rep uses endCellId (if set) instead of the body chain.
   */
  function sectionRepChain(sec, repIndex, reps) {
    const isLast = repIndex === reps - 1;
    if (isLast && sec.endCellId && sec.endCellId !== '') {
      return [sec.endCellId];
    }
    return sectionChain(sec);
  }

  /** Flatten arrangement to ordered chords with durations (beats). Includes end/into + seams. */
  function flattenArrangement(song) {
    if (!song) return [];
    ensureSongShape(song);
    const out = [];
    const secs = song.arrangement || [];
    secs.forEach((sec, secIdx) => {
      const reps = Math.max(1, +(sec.reps || 1));
      for (let r = 0; r < reps; r++) {
        const chain = sectionRepChain(sec, r, reps);
        const role = r === reps - 1 && sec.endCellId ? 'end' : 'body';
        chain.forEach((cid) => {
          pushCellChords(out, song, cid, {
            section: sec.name || '',
            rep: r,
            role: role,
          });
        });
      }
      // After all reps: optional one-shot bridge into next section
      if (sec.intoCellId) {
        pushCellChords(out, song, sec.intoCellId, {
          section: sec.name || '',
          rep: reps,
          role: 'into',
        });
      }
      // Seam into next section (once, after end/into)
      const next = secs[secIdx + 1];
      if (next) {
        const fromCellId =
          sec.intoCellId ||
          (sec.endCellId && reps >= 1 ? sec.endCellId : null) ||
          (sectionChain(sec).slice(-1)[0] || null);
        const toChain = sectionRepChain(next, 0, Math.max(1, +(next.reps || 1)));
        const cellA = fromCellId ? song.cells[fromCellId] : null;
        const cellB = toChain[0] ? song.cells[toChain[0]] : null;
        const fromCh = cellA && cellA.chords && cellA.chords[cellA.chords.length - 1];
        const toCh = cellB && cellB.chords && cellB.chords[0];
        applySeam(
          out,
          sec.seam || defaultSeam(),
          fromCh,
          toCh,
          song.key,
          (sec.name || '') + '→' + (next.name || '')
        );
      }
    });
    return out;
  }

  function chainBeats(song, chain) {
    let beats = 0;
    (chain || []).forEach((cid) => {
      const cell = song.cells[cid];
      if (!cell || !cell.chords) return;
      beats += cell.chords.reduce((s, c) => s + (c.duration || 4), 0);
    });
    return beats;
  }

  function sectionBars(song, sec) {
    ensureSongShape(song);
    const chain = sectionChain(sec);
    const bodyBeats = chainBeats(song, chain);
    const reps = Math.max(1, +(sec.reps || 1));
    let beats = 0;
    // body reps except last
    if (reps > 1) beats += bodyBeats * (reps - 1);
    // last rep: end cell or body
    if (sec.endCellId) {
      beats += chainBeats(song, [sec.endCellId]);
    } else {
      beats += bodyBeats;
    }
    // into once
    if (sec.intoCellId) {
      beats += chainBeats(song, [sec.intoCellId]);
    }
    // seam beats not counted in section bars display (they're between)
    return beats / 4;
  }

  /**
   * Portable full song document for Save / Load (not browser session alone).
   */
  function exportSongPackage(song) {
    ensureSongShape(song);
    return {
      format: SONG_PACKAGE_FORMAT,
      version: SONG_PACKAGE_VERSION,
      savedAt: now(),
      title: song.title || 'Untitled',
      bpm: song.bpm != null ? song.bpm : 96,
      key: song.key
        ? { tonic: song.key.tonic, mode: song.key.mode }
        : { tonic: 11, mode: 'minor' },
      notes: song.notes || '',
      style: song.style || '',
      cells: song.cells || {},
      families: song.families || {},
      arrangement: (song.arrangement || []).map((sec) => ({
        id: sec.id,
        name: sec.name,
        cellId: sec.cellId,
        chain: sectionChain(sec),
        reps: Math.max(1, +(sec.reps || 1)),
        endCellId: sec.endCellId || null,
        intoCellId: sec.intoCellId || null,
        seam: sec.seam
          ? {
              type: sec.seam.type || 'none',
              chords: (sec.seam.chords || []).map((c) => ({ ...c })),
            }
          : defaultSeam(),
      })),
      focus: song.focus
        ? {
            cellId: song.focus.cellId || null,
            sectionId: song.focus.sectionId || null,
            chordIndex: song.focus.chordIndex || 0,
          }
        : { cellId: null, sectionId: null, chordIndex: 0 },
    };
  }

  function isSongPackage(data) {
    return !!(
      data &&
      typeof data === 'object' &&
      (data.format === SONG_PACKAGE_FORMAT ||
        (data.cells && data.arrangement && data.version === 1 && !data.chords))
    );
  }

  /**
   * Hydrate a song object from package (or already-session-shaped song).
   * Does not save — caller should saveSong if desired.
   */
  function importSongPackage(data, opts) {
    opts = opts || {};
    if (!data || typeof data !== 'object') return null;
    let song;
    if (data.format === SONG_PACKAGE_FORMAT || (data.cells && data.arrangement)) {
      song = {
        version: 1,
        title: data.title || 'Untitled',
        bpm: data.bpm != null ? data.bpm : 96,
        key: data.key
          ? { tonic: data.key.tonic, mode: data.key.mode || 'minor' }
          : { tonic: 11, mode: 'minor' },
        notes: data.notes || '',
        style: data.style || '',
        updatedAt: now(),
        updatedBy: opts.by || 'import',
        cells: data.cells || {},
        families: data.families || {},
        arrangement: data.arrangement || [],
        focus: data.focus || { cellId: null, sectionId: null, chordIndex: 0 },
      };
    } else {
      return null;
    }
    return ensureSongShape(song);
  }

  function totalBars(song) {
    ensureSongShape(song);
    let bars = (song.arrangement || []).reduce((s, sec) => s + sectionBars(song, sec), 0);
    // add seam durations
    const flat = flattenArrangement(song);
    const seamBeats = flat.filter((c) => c._seam).reduce((s, c) => s + (c.duration || 0), 0);
    return bars + seamBeats / 4;
  }

  /** Set section to play multiple versions in order (e.g. v1 then v2). */
  function setSectionChain(sec, cellIds) {
    sec.chain = (cellIds || []).filter(Boolean);
    sec.cellId = sec.chain[0] || null;
  }

  function appendVersionToSectionChain(sec, cellId) {
    if (!sec.chain) sec.chain = sec.cellId ? [sec.cellId] : [];
    if (cellId && sec.chain.indexOf(cellId) < 0) sec.chain.push(cellId);
    sec.cellId = sec.chain[0] || cellId;
  }

  global.IHSession = {
    SESSION_KEY,
    HANDOFF_KEY,
    FRETBOARD_MAX_CHORDS,
    SONG_PACKAGE_FORMAT,
    SONG_PACKAGE_VERSION,
    QUALITY_TO_TYPE,
    TYPE_TO_QUALITY,
    emptySong,
    ensureSongShape,
    loadSong,
    saveSong,
    ensureCell,
    newCellId,
    newFamilyId,
    createVariation,
    familyVersions,
    siblingsOfCell,
    deleteCell,
    sectionChain,
    sectionRepChain,
    defaultSeam,
    suggestSeamChords,
    setSectionChain,
    appendVersionToSectionChain,
    chainBeats,
    fromLandscapeChord,
    pcFromName,
    qualityToTypeIdx,
    typeIdxToQuality,
    exactQualityFromNotes,
    customChordLabel,
    normalizePcs,
    chordsToFretboardSlots,
    fretboardSlotsToChords,
    clipForFretboard,
    fretboardClipMessage,
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
    exportSongPackage,
    importSongPackage,
    isSongPackage,
  };
})(typeof window !== 'undefined' ? window : globalThis);
