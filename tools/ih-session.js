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
   * Handoff clip for Landscape / Arrangement — not the Fretboard UI ceiling.
   * Teleprompter v1 lifts the page cap; send-to-Landscape still windows to this size.
   */
  const FRETBOARD_MAX_CHORDS = 8;
  const SONG_PACKAGE_FORMAT = 'idlehanz-song-package';
  const SONG_PACKAGE_VERSION = 1;

  const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const QUALITY_SHORT = {
    maj: '',
    min: 'm',
    dom7: '7',
    maj7: 'maj7',
    min7: 'm7',
    halfdim: 'm7b5',
    dim: 'dim',
    dim7: 'dim7',
    minmaj7: 'm(maj7)',
    aug: 'aug',
    sus2: 'sus2',
    sus4: 'sus4',
    add9: 'add9',
    maj9: 'maj9',
    min9: 'm9',
    '6th': '6',
    min6: 'm6',
    dom7b9: '7b9',
    dom7s9: '7#9',
    dom7s11: '7#11',
    dom7b13: '7b13',
    dom7alt: '7alt',
  };

  function emptyConductor() {
    return {
      ppq: 480,
      tempos: [{ tick: 0, usPerQuarter: 500000, bpm: 120 }],
      timeSigs: [{ tick: 0, num: 4, den: 4, clocks: 24, thirtySeconds: 8 }],
    };
  }

  function emptyTeleprompter() {
    return {
      sourceName: '',
      barOffset: 0,
      followPlayhead: true,
      clickEnabled: false,
      loop: null,
      chairs: [],
      instrument: '',
      midiPortName: '',
      chaseOffsetSec: 0,
    };
  }

  function normalizeConductor(raw) {
    const base = emptyConductor();
    if (!raw || typeof raw !== 'object') return base;
    const ppq = Math.max(1, +(raw.ppq || base.ppq) || 480);
    let tempos = Array.isArray(raw.tempos)
      ? raw.tempos
          .map((t) => {
            const tick = Math.max(0, +(t.tick || 0) || 0);
            let us = +(t.usPerQuarter || 0);
            if (!us && t.bpm) us = Math.round(60000000 / Math.max(1, +t.bpm));
            if (!us) us = 500000;
            return { tick, usPerQuarter: us, bpm: Math.round(60000000 / us) };
          })
          .sort((a, b) => a.tick - b.tick)
      : [];
    if (!tempos.length) tempos = base.tempos.slice();
    if (tempos[0].tick !== 0) {
      tempos.unshift({
        tick: 0,
        usPerQuarter: tempos[0].usPerQuarter,
        bpm: tempos[0].bpm,
      });
    }
    let timeSigs = Array.isArray(raw.timeSigs)
      ? raw.timeSigs
          .map((s) => ({
            tick: Math.max(0, +(s.tick || 0) || 0),
            num: Math.max(1, +(s.num || 4) || 4),
            den: Math.max(1, +(s.den || 4) || 4),
            clocks: +(s.clocks || 24) || 24,
            thirtySeconds: +(s.thirtySeconds || 8) || 8,
          }))
          .sort((a, b) => a.tick - b.tick)
      : [];
    if (!timeSigs.length) timeSigs = base.timeSigs.slice();
    if (timeSigs[0].tick !== 0) {
      timeSigs.unshift(Object.assign({}, timeSigs[0], { tick: 0 }));
    }
    return { ppq, tempos, timeSigs };
  }

  function normalizeTeleprompter(raw) {
    const base = emptyTeleprompter();
    if (!raw || typeof raw !== 'object') return base;
    let loop = null;
    if (raw.loop && raw.loop.a != null && raw.loop.b != null) {
      loop = { a: raw.loop.a | 0, b: raw.loop.b | 0 };
    }
    const offset = +raw.chaseOffsetSec;
    return {
      sourceName: raw.sourceName || '',
      barOffset: raw.barOffset | 0,
      followPlayhead: raw.followPlayhead !== false,
      clickEnabled: !!raw.clickEnabled,
      loop,
      chairs: Array.isArray(raw.chairs) ? raw.chairs : [],
      instrument: raw.instrument === 'bass' || raw.instrument === 'guitar' ? raw.instrument : '',
      midiPortName: raw.midiPortName ? String(raw.midiPortName) : '',
      chaseOffsetSec: isFinite(offset) ? offset : 0,
    };
  }

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
    maj9: 19,
    min9: 20,
    '6th': 13,
    min6: 14,
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
    13: '6th',
    14: 'min6',
    16: 'add9',
    19: 'maj9',
    20: 'min9',
  };

  /** Splice a fretboard window back into the full cell (never shrink the song). */
  function mergeClipIntoChords(existing, incoming, start, windowLen) {
    const prev = Array.isArray(existing) ? existing.slice() : [];
    const clip = Array.isArray(incoming) ? incoming : [];
    const at = Math.max(0, start | 0);
    if (!prev.length) return clip.slice();
    if (!clip.length) return prev;
    const win = windowLen != null && windowLen > 0 ? windowLen : clip.length;
    const before = prev.slice(0, at);
    const after = prev.slice(at + win);
    const mid = clip.map(function (c, i) {
      const prevCh = prev[at + i];
      if (!c) return prevCh;
      const out = Object.assign({}, c);
      if (out.localTonic == null && prevCh && prevCh.localTonic != null) {
        out.localTonic = prevCh.localTonic;
      }
      if (!out.localMode && prevCh && prevCh.localMode) out.localMode = prevCh.localMode;
      return out;
    });
    return before.concat(mid, after);
  }

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
      teleprompter: emptyTeleprompter(),
    };
  }

  function ensureSongShape(song) {
    if (!song) return song;
    try {
    if (!song.cells || typeof song.cells !== 'object') song.cells = {};
    if (!song.families || typeof song.families !== 'object') song.families = {};
    if (!Array.isArray(song.arrangement)) song.arrangement = [];
    if (!song.focus || typeof song.focus !== 'object') {
      song.focus = { cellId: null, sectionId: null, chordIndex: 0 };
    }
    // Migrate cells: familyId / versionIndex / locked lineage
    Object.keys(song.cells).forEach((id) => {
      const c = song.cells[id];
      if (!c || typeof c !== 'object') {
        delete song.cells[id];
        return;
      }
      if (!c.id) c.id = id;
      if (c.familyId == null) c.familyId = null;
      if (c.versionIndex == null) c.versionIndex = 1;
      if (!Array.isArray(c.chords)) c.chords = [];
      try {
        inferLineageOnCell(song, c);
      } catch (_) {
        /* keep the cell even if lineage parse fails */
      }
    });
    // Migrate sections: chain + seam + cycle exit (end / into)
    song.arrangement = song.arrangement.filter((sec) => sec && typeof sec === 'object');
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
    // Teleprompter lives on the song, not inside a Landscape cell.
    try {
      if (song.conductor) song.conductor = normalizeConductor(song.conductor);
      song.teleprompter = normalizeTeleprompter(song.teleprompter);
    } catch (_) {
      if (!song.teleprompter) song.teleprompter = emptyTeleprompter();
    }
    try {
      healFamilies(song);
    } catch (_) {
      /* chips can still scan cells by familyId */
    }
    } catch (_) {
      /* never let a bad song blob take down Landscape */
    }
    return song;
  }

  /**
   * Window a long teleprompter row when sending TO Landscape (not when opening Fretboard).
   * Landscape / Arrangement send the whole cell the other way.
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
      'Landscape cell window ' +
      from +
      '–' +
      to +
      ' of ' +
      clip.total +
      ' · full row stays on the Fretboard'
    );
  }

  function readSongFromDisk() {
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

  function loadSong() {
    if (_memSong) {
      try {
        return ensureSongShape(_memSong);
      } catch (_) {
        /* fall through to disk */
      }
    }
    const disk = readSongFromDisk();
    if (disk) _memSong = disk;
    return _memSong || disk || null;
  }

  function newFamilyId() {
    return 'fam-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  }

  const KIND_LABELS = {
    copy: 'Copy',
    parallel: 'Parallel',
    'parallel-major': 'Major',
    'parallel-minor': 'Minor',
    'key-major': 'In major',
    'key-minor': 'In minor',
    darken: 'Darken',
    brighter: 'Brighten',
    reharm: 'Reharm',
    voice: 'Voice lead',
    sevenths: '7ths',
    pedal: 'Pedal',
    rhythm: 'Rhythm',
  };
  const LABEL_TO_KIND = {
    copy: 'copy',
    parallel: 'parallel',
    major: 'parallel-major',
    minor: 'parallel-minor',
    'in major': 'key-major',
    'in minor': 'key-minor',
    darken: 'darken',
    brighten: 'brighter',
    brighter: 'brighter',
    reharm: 'reharm',
    'voice lead': 'voice',
    voice: 'voice',
    '7ths': 'sevenths',
    sevenths: 'sevenths',
    pedal: 'pedal',
    rhythm: 'rhythm',
  };

  function variationKindLabel(kind) {
    return KIND_LABELS[kind] || (kind ? String(kind) : '');
  }

  function kindFromLabel(label) {
    const s = String(label || '').trim().toLowerCase();
    return LABEL_TO_KIND[s] || null;
  }

  /** Drop generated lineage so it cannot be typed back into the name. */
  function stripGeneratedLineage(name) {
    let s = String(name || '').trim();
    s = s.replace(/\s*·\s*v\d+.*$/i, '');
    s = s.replace(/\s+v\d+\s+v\d+(\s+.*)?$/i, '');
    if (/^v\d+\s+v\d+(\s+.*)?$/i.test(s)) return '';
    return s.trim();
  }

  /** Theme only: drop "· v2 Darken", chip text, trailing "v4". */
  function stripLineageFromName(name) {
    return stripGeneratedLineage(name).replace(/\s+v\d+\s*$/i, '').trim();
  }

  /** Parent + kind from a stored or chip name. "v4 v2 Darken" / "Theme · v2 Darken" → { parent: 2, kind: "Darken" }. */
  function parseLineageFromName(name, ownVersionIndex) {
    const s = String(name || '');
    if (!s) return null;
    const pair = s.match(/v(\d+)\s+v(\d+)\s*(.*)$/i);
    if (pair) {
      const n = parseInt(pair[2], 10);
      if (!isNaN(n) && (ownVersionIndex == null || n !== ownVersionIndex)) {
        return { parent: n, kind: String(pair[3] || '').trim() };
      }
    }
    const afterDot = s.match(/·\s*v(\d+)\s*(.*)$/i);
    if (afterDot) {
      const n = parseInt(afterDot[1], 10);
      if (!isNaN(n) && (ownVersionIndex == null || n !== ownVersionIndex)) {
        return { parent: n, kind: String(afterDot[2] || '').trim() };
      }
    }
    return null;
  }

  function findSiblingByVersion(song, cell, n) {
    if (!song || !cell || n == null || isNaN(n)) return null;
    const ids =
      cell.familyId && song.families && song.families[cell.familyId]
        ? song.families[cell.familyId].versionIds || []
        : Object.keys(song.cells || {});
    for (let i = 0; i < ids.length; i++) {
      const c = song.cells[ids[i]];
      if (c && c.id !== cell.id && c.versionIndex === n) return c;
    }
    return null;
  }

  /** Locked chip text: "v4 v2 Darken". Not user-editable. */
  function lineageLockText(cell) {
    if (!cell) return '';
    const own = cell.versionIndex != null ? cell.versionIndex : null;
    const parent = cell.fromVersionIndex;
    const kind = variationKindLabel(cell.fromKind);
    if (own != null && parent != null && kind) return 'v' + own + ' v' + parent + ' ' + kind;
    if (own != null && parent != null) return 'v' + own + ' v' + parent;
    if (own != null && cell.familyId) return 'v' + own;
    return '';
  }

  /** Stored name: "Theme · v2 Darken". Lineage is generated, not typed. */
  function composeCellName(base, cell) {
    const b = stripLineageFromName(base) || 'Cell';
    if (!cell) return b;
    const parent = cell.fromVersionIndex;
    const kind = variationKindLabel(cell.fromKind);
    if (parent != null && kind) return b + ' · v' + parent + ' ' + kind;
    if (parent != null) return b + ' · v' + parent;
    return b;
  }

  /**
   * One-time: fill missing from* from an old stored name, then store theme only.
   * Never overwrites an existing parent from a later name edit.
   */
  function inferLineageOnCell(song, cell) {
    if (!cell) return cell;
    if (cell.fromVersionIndex == null) {
      const parsed = parseLineageFromName(cell.name, cell.versionIndex);
      if (parsed) {
        cell.fromVersionIndex = parsed.parent;
        if (!cell.fromKind && parsed.kind) {
          const k = kindFromLabel(parsed.kind);
          if (k) cell.fromKind = k;
        }
      }
    }
    if (!cell.fromCellId && song && cell.fromVersionIndex != null) {
      const sib = findSiblingByVersion(song, cell, cell.fromVersionIndex);
      if (sib) cell.fromCellId = sib.id;
    }
    const generated =
      /\s*·\s*v\d+/i.test(cell.name || '') || /v\d+\s+v\d+/i.test(cell.name || '');
    if (generated) {
      cell.name = stripLineageFromName(cell.name) || cell.name || 'Cell';
    }
    return cell;
  }

  /** Rename the theme only. Never reads parent from the typed string. */
  function applyUserCellName(song, cell, userName) {
    if (!cell) return '';
    let base = stripGeneratedLineage(userName);
    if (!base) base = stripLineageFromName(cell.name) || 'Cell';
    cell.name = base;
    if (
      song &&
      cell.familyId &&
      song.families &&
      song.families[cell.familyId] &&
      (cell.versionIndex == null || cell.versionIndex === 1)
    ) {
      song.families[cell.familyId].name = base;
    }
    return cell.name;
  }

  function copyCellLineage(prev, dest) {
    if (!prev || !dest) return dest;
    if (dest.familyId == null) dest.familyId = prev.familyId || null;
    if (dest.versionIndex == null) dest.versionIndex = prev.versionIndex != null ? prev.versionIndex : 1;
    if (dest.fromVersionIndex == null && prev.fromVersionIndex != null) {
      dest.fromVersionIndex = prev.fromVersionIndex;
    }
    if (!dest.fromKind && prev.fromKind) dest.fromKind = prev.fromKind;
    if (!dest.fromCellId && prev.fromCellId) dest.fromCellId = prev.fromCellId;
    if (!dest.packId && prev.packId) dest.packId = prev.packId;
    return dest;
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
      const famName = stripLineageFromName(src.name || 'Cell') || 'Cell';
      song.families[familyId] = {
        id: familyId,
        name: famName,
        versionIds: [sourceCellId],
      };
      src.name = famName;
    }

    healFamilies(song);
    let fam = song.families[familyId];
    if (!fam) {
      fam = {
        id: familyId,
        name: stripLineageFromName(src.name || 'Cell') || 'Cell',
        versionIds: [sourceCellId],
      };
      song.families[familyId] = fam;
      src.familyId = familyId;
    }
    let maxV = 0;
    (fam.versionIds || []).forEach(function (id) {
      const c = song.cells[id];
      const n = c && c.versionIndex != null ? c.versionIndex : 0;
      if (n > maxV) maxV = n;
    });
    const nextIdx = maxV + 1;
    const newId = newCellId('cell');
    // Family base without trailing "v2" / "· v1 Darken" clutter for storage
    const baseName = (fam.name || src.name || 'Cell')
      .replace(/\s*·\s*v\d+.*$/i, '')
      .replace(/\s*v\d+\s*$/i, '')
      .trim() || 'Cell';
    const chords = (opts.chords || src.chords || []).map((c) => ({ ...c }));
    // Theme only — parent lives on fromCellId / fromVersionIndex, not in the name
    const cellName = stripLineageFromName((opts.name && String(opts.name).trim()) || baseName) || baseName;
    const fromVersionIndex =
      opts.fromVersionIndex != null
        ? opts.fromVersionIndex
        : src.versionIndex != null
          ? src.versionIndex
          : 1;
    const fromKind = opts.fromKind || null;
    const fromCellId = opts.fromCellId || sourceCellId;
    song.cells[newId] = {
      id: newId,
      name: cellName,
      packId: src.packId || null,
      familyId,
      versionIndex: nextIdx,
      fromVersionIndex,
      fromKind,
      fromCellId,
      chords,
    };
    fam.versionIds = fam.versionIds || [];
    fam.versionIds.push(newId);
    fam.name = baseName;
    return newId;
  }

  /**
   * Rebuild family.versionIds from cells that still carry familyId.
   * A missing families[id] used to make the version chips vanish even
   * though the sibling cells were still in the song.
   */
  function healFamilies(song) {
    if (!song || !song.cells) return song;
    if (!song.families || typeof song.families !== 'object') song.families = {};
    // Re-stamp familyId onto cells still listed on a family. Editing a take
    // used to rewrite the cell without putting it back on versionIds / familyId.
    Object.keys(song.families).forEach(function (fid) {
      const fam = song.families[fid];
      if (!fam || !fam.versionIds) return;
      fam.versionIds.forEach(function (id) {
        const c = song.cells[id];
        if (!c) return;
        if (!c.id) c.id = id;
        if (!c.familyId) c.familyId = fid;
      });
    });
    const byFam = {};
    Object.keys(song.cells).forEach(function (id) {
      const c = song.cells[id];
      if (!c || !c.familyId) return;
      if (!c.id) c.id = id;
      if (!byFam[c.familyId]) byFam[c.familyId] = [];
      byFam[c.familyId].push(c);
    });
    Object.keys(byFam).forEach(function (fid) {
      const members = byFam[fid];
      let fam = song.families[fid];
      if (!fam || typeof fam !== 'object') {
        const named =
          members.find(function (c) {
            return c.versionIndex === 1;
          }) || members[0];
        fam = {
          id: fid,
          name: stripLineageFromName((named && named.name) || 'Cell') || 'Cell',
          versionIds: [],
        };
        song.families[fid] = fam;
      }
      const have = {};
      const nextIds = [];
      (fam.versionIds || []).forEach(function (id) {
        if (song.cells[id] && song.cells[id].familyId === fid && !have[id]) {
          have[id] = true;
          nextIds.push(id);
        }
      });
      members.forEach(function (c) {
        if (!have[c.id]) {
          have[c.id] = true;
          nextIds.push(c.id);
        }
      });
      fam.versionIds = nextIds;
      if (!fam.name) {
        fam.name = stripLineageFromName((members[0] && members[0].name) || 'Cell') || 'Cell';
      }
    });
    Object.keys(song.families).forEach(function (fid) {
      const fam = song.families[fid];
      if (!fam || !fam.versionIds || !fam.versionIds.length) {
        delete song.families[fid];
      }
    });
    return song;
  }

  /**
   * If this cell lost familyId but other takes still point at it (or it
   * still points at a parent), put it back on that family so chips return.
   */
  function adoptOrphanCell(song, cell) {
    if (!song || !cell || cell.familyId) return cell;
    const cells = song.cells || {};
    const kids = Object.keys(cells)
      .map(function (id) {
        return cells[id];
      })
      .filter(function (c) {
        return c && c.id !== cell.id && c.fromCellId === cell.id && c.familyId;
      });
    if (kids.length) {
      cell.familyId = kids[0].familyId;
      if (cell.versionIndex == null) cell.versionIndex = 1;
      healFamilies(song);
      return cell;
    }
    const parent =
      cell.fromCellId && cells[cell.fromCellId] ? cells[cell.fromCellId] : null;
    if (parent && parent.familyId) {
      cell.familyId = parent.familyId;
      healFamilies(song);
    }
    return cell;
  }

  function familyVersions(song, familyId) {
    if (!song || !familyId) return [];
    ensureSongShape(song);
    const seen = {};
    const list = [];
    const add = function (c, fallbackId) {
      if (!c) return;
      if (!c.id && fallbackId) c.id = fallbackId;
      if (!c.id || seen[c.id]) return;
      seen[c.id] = true;
      list.push(c);
    };
    const fam = song.families && song.families[familyId];
    if (fam && fam.versionIds) {
      fam.versionIds.forEach(function (id) {
        add(song.cells[id], id);
      });
    }
    Object.keys(song.cells || {}).forEach(function (id) {
      const c = song.cells[id];
      if (c && c.familyId === familyId) add(c, id);
    });
    list.sort(function (a, b) {
      return (a.versionIndex || 0) - (b.versionIndex || 0);
    });
    return list;
  }

  /** Cells linked by fromCellId when familyId was wiped. */
  function lineageSiblings(song, cell) {
    if (!song || !cell || !song.cells) return cell ? [cell] : [];
    const ids = Object.keys(song.cells);
    const list = [];
    ids.forEach(function (id) {
      const c = song.cells[id];
      if (!c) return;
      if (!c.id) c.id = id;
      const same =
        c.id === cell.id ||
        (cell.fromCellId && (c.id === cell.fromCellId || c.fromCellId === cell.fromCellId)) ||
        c.fromCellId === cell.id ||
        (c.fromCellId && cell.id && c.fromCellId === cell.id);
      if (same) list.push(c);
    });
    if (!list.length) list.push(cell);
    list.sort(function (a, b) {
      return (a.versionIndex || 0) - (b.versionIndex || 0);
    });
    return list;
  }

  function siblingsOfCell(song, cellId) {
    const cell = song && song.cells ? song.cells[cellId] : null;
    if (!cell) return [];
    if (!cell.id) cell.id = cellId;
    if (cell.familyId) {
      const fam = familyVersions(song, cell.familyId);
      if (fam.length > 1) return fam;
      if (fam.length === 1) {
        const lined = lineageSiblings(song, cell);
        if (lined.length > 1) return lined;
        return fam;
      }
    }
    // Orphan with children / parent still in a family — show the row
    adoptOrphanCell(song, cell);
    if (cell.familyId) {
      const fam2 = familyVersions(song, cell.familyId);
      if (fam2.length) return fam2;
    }
    const lined = lineageSiblings(song, cell);
    if (lined.length > 1) return lined;
    return [cell];
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
      (s) =>
        s.cellId === cellId ||
        (s.chain && s.chain.indexOf(cellId) >= 0) ||
        s.endCellId === cellId ||
        s.intoCellId === cellId
    );
    const sectionsTouched = used.length;

    delete song.cells[cellId];
    song._okToShrink = true;

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
      if (s.endCellId === cellId) s.endCellId = null;
      if (s.intoCellId === cellId) s.intoCellId = null;
      if (s.chain) s.chain = s.chain.filter((id) => id !== cellId);
      if (s.cellId === cellId) {
        s.cellId =
          (s.chain && s.chain[0]) || s.endCellId || s.intoCellId || null;
      }
      if (
        !s.cellId &&
        !(s.chain && s.chain.length) &&
        !s.endCellId &&
        !s.intoCellId
      ) {
        sectionsRemoved += 1;
        return false;
      }
      return true;
    });

    if (song.focus && song.focus.cellId === cellId) {
      song.focus.cellId = nextFocusId;
      song.focus.chordIndex = 0;
    }

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

  // In-page working copy. Re-parsing localStorage on every load can drop
  // siblings if a later write fails or ensureSongShape throws.
  let _memSong = null;

  function saveSong(song, by) {
    if (!song) return false;
    ensureSongShape(song);
    // Accidental wipe: a 0–1 cell write must not replace a family on disk
    // unless delete/reset set _okToShrink.
    if (!song._okToShrink) {
      try {
        const raw = localStorage.getItem(SESSION_KEY);
        if (raw) {
          const prev = JSON.parse(raw);
          const prevIds = prev && prev.cells ? Object.keys(prev.cells) : [];
          const nextIds = Object.keys(song.cells || {});
          if (prevIds.length > 1 && nextIds.length <= 1) {
            prevIds.forEach(function (id) {
              if (!song.cells[id]) song.cells[id] = prev.cells[id];
            });
            if (prev.families) {
              if (!song.families) song.families = {};
              Object.keys(prev.families).forEach(function (fid) {
                if (!song.families[fid]) song.families[fid] = prev.families[fid];
              });
            }
          }
        }
      } catch (_) {
        /* keep the in-memory song */
      }
    }
    delete song._okToShrink;
    song.updatedAt = now();
    song.updatedBy = by || song.updatedBy || 'unknown';
    _memSong = song;
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
      ['dom7alt', [0, 4, 10, 1, 3, 8]],
      ['dom7b9', [0, 4, 7, 10, 1]],
      ['dom7s9', [0, 4, 7, 10, 3]],
      ['dom7s11', [0, 4, 7, 10, 6]],
      ['dom7b13', [0, 4, 7, 10, 8]],
      ['min7', [0, 3, 7, 10]],
      ['dom7', [0, 4, 7, 10]],
      ['maj7', [0, 4, 7, 11]],
      ['minmaj7', [0, 3, 7, 11]],
      ['halfdim', [0, 3, 6, 10]],
      ['dim7', [0, 3, 6, 9]],
      ['maj9', [0, 2, 4, 7, 11]],
      ['min9', [0, 2, 3, 7, 10]],
      ['add9', [0, 2, 4, 7]],
      ['6th', [0, 4, 7, 9]],
      ['min6', [0, 3, 7, 9]],
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
    if (!c || typeof c !== 'object') return null;
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
    const named = c.quality && c.quality !== 'custom';
    const isCustom =
      !!c.custom ||
      c.quality === 'custom' ||
      (!named && notes.length > 0 && !exactQualityFromNotes(notes, root));
    const quality = isCustom
      ? 'custom'
      : named
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
        slot.customNotes = notes.length ? notes.slice() : ch._rest ? [] : [root];
        if (!ch._rest && slot.customNotes.indexOf(root) < 0) slot.customNotes.push(root);
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
          slot.bassMode = 'tone';
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
      attachTeleprompterFieldsToSlot(slot, ch);
      attachDiskStampsToSlot(slot, ch);
      return slot;
    });
  }

  function attachTeleprompterFieldsToSlot(slot, ch) {
    if (!slot || !ch) return slot;
    if (ch._tick != null) slot._tick = +ch._tick;
    if (ch._tickEnd != null) slot._tickEnd = +ch._tickEnd;
    if (ch.name) slot._label = String(ch.name);
    if (ch._rest) slot._rest = true;
    return slot;
  }

  function attachTeleprompterFieldsToChord(out, s) {
    if (!out || !s) return out;
    if (s._tick != null) out._tick = +s._tick;
    if (s._tickEnd != null) out._tickEnd = +s._tickEnd;
    if (s._rest) out._rest = true;
    if (s._label) out.name = String(s._label);
    return out;
  }

  /** Multi-disk ownership rides Fretboard slots so write-back does not flatten to write-home. */
  function attachDiskStampsToSlot(slot, ch) {
    if (!slot || !ch) return slot;
    if (ch.localTonic != null) slot._localTonic = ((ch.localTonic % 12) + 12) % 12;
    if (ch.localMode) slot._localMode = ch.localMode;
    return slot;
  }

  function attachDiskStampsToChord(out, s) {
    if (!out || !s) return out;
    const t = s._localTonic != null ? s._localTonic : s.localTonic;
    const m = s._localMode || s.localMode;
    if (t != null) out.localTonic = ((t % 12) + 12) % 12;
    if (m) out.localMode = m;
    return out;
  }

  /** Fretboard progression → session chords (keeps custom pitch sets intact) */
  function fretboardSlotsToChords(progression, chordTypes) {
    return (progression || []).map((s) => {
      let root = ((s.root % 12) + 12) % 12;
      let quality = typeIdxToQuality(s.typeIdx);
      let bass = root;
      if ((s.bassMode === 'chordTone' || s.bassMode === 'tone') && chordTypes && chordTypes[s.typeIdx]) {
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
          return attachDiskStampsToChord(attachTeleprompterFieldsToChord({
            root,
            quality: exact,
            duration: s._duration != null ? s._duration : 4,
            bass,
            roman: s._roman || '',
            region: '',
            tag: 'fretboard',
            notes,
          }, s), s);
        }
        // Free pitch set — never force B·C·D·F# → Bm
        return attachDiskStampsToChord(attachTeleprompterFieldsToChord({
          root,
          quality: 'custom',
          custom: true,
          notes,
          name: s._label || customChordLabel(root, notes),
          duration: s._duration != null ? s._duration : 4,
          bass,
          roman: s._roman || '',
          region: 'custom',
          tag: 'custom',
        }, s), s);
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
      return attachDiskStampsToChord(attachTeleprompterFieldsToChord(out, s), s);
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
      clipStart: opts.clipStart != null ? opts.clipStart | 0 : 0,
      clipMax: opts.clipMax != null ? opts.clipMax | 0 : null,
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
    const fromHash = decodeHandoffString(location.hash || '');
    if (fromHash) return fromHash;
    try {
      const q = location.search || '';
      const m = q.match(/[?&]ih=([^&]+)/);
      if (m && m[1]) return decodeHandoffString('ih=' + decodeURIComponent(m[1]));
    } catch (_) {}
    return null;
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
    const prev = song.cells[id];
    const dest = {
      id,
      name: cell.name || (prev && prev.name) || 'Cell',
      packId: cell.packId || (prev && prev.packId) || null,
      familyId: cell.familyId || null,
      versionIndex: cell.versionIndex != null ? cell.versionIndex : null,
      fromVersionIndex: cell.fromVersionIndex != null ? cell.fromVersionIndex : null,
      fromKind: cell.fromKind || null,
      fromCellId: cell.fromCellId || null,
      chords: (cell.chords || []).map(fromLandscapeChord).filter(Boolean),
    };
    copyCellLineage(prev, dest);
    inferLineageOnCell(song, dest);
    song.cells[id] = dest;
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
        let nextChords = expandHandoffChords(payload);
        // Same-id write-back: always merge so equal-length Fretboard slots
        // keep prev localTonic / localMode (not only when the clip is shorter).
        if (prev && prev.chords && prev.chords.length) {
          nextChords = mergeClipIntoChords(
            prev.chords,
            nextChords,
            payload.clipStart || 0,
            payload.clipMax || payload.windowLen || null
          );
          const rebuilt = buildHandoffPayload(
            Object.assign({}, payload, { chords: nextChords })
          );
          payload.chords = rebuilt.chords;
          writeHandoffStorage(payload);
        }
        song.cells[cellId] = {
          id: cellId,
          name: keepName ? prev.name : incoming || (prev && prev.name) || 'Cell',
          packId: prev && prev.packId ? prev.packId : null,
          familyId: prev && prev.familyId ? prev.familyId : null,
          versionIndex: prev && prev.versionIndex != null ? prev.versionIndex : 1,
          fromVersionIndex: prev && prev.fromVersionIndex != null ? prev.fromVersionIndex : null,
          fromKind: prev && prev.fromKind ? prev.fromKind : null,
          fromCellId: prev && prev.fromCellId ? prev.fromCellId : null,
          chords: nextChords,
        };
        inferLineageOnCell(song, song.cells[cellId]);
        song.focus = {
          cellId: cellId,
          sectionId: keepSection,
          chordIndex: payload.focus || 0,
        };
      }
      if (
        payload.title &&
        (!song.title || song.title === 'Untitled')
      ) {
        song.title = payload.title;
      }
      song.bpm = payload.bpm != null ? payload.bpm : song.bpm;
      const songEmpty =
        (!song.arrangement || !song.arrangement.length) &&
        Object.keys(song.cells || {}).length <= 1;
      if (payload.key && songEmpty) song.key = payload.key;
      saveSong(song, payload.by);
    } catch (_) {}

    const hash = encodeHandoff(payload);
    let url = relativeUrl;
    if (hash) {
      // Query + hash: some file:// navigations drop one or the other.
      const q = hash.indexOf('ih=') === 0 ? hash : 'ih=' + hash;
      url += (relativeUrl.indexOf('?') >= 0 ? '&' : '?') + q;
      url += '#' + hash;
    }
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
          _sectionId: meta.sectionId || '',
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
            sectionId: sec.id || '',
            rep: r,
            role: role,
          });
        });
      }
      // After all reps: optional one-shot bridge into next section
      if (sec.intoCellId) {
        pushCellChords(out, song, sec.intoCellId, {
          section: sec.name || '',
          sectionId: sec.id || '',
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
      conductor: song.conductor ? normalizeConductor(song.conductor) : undefined,
      teleprompter: song.teleprompter ? normalizeTeleprompter(song.teleprompter) : emptyTeleprompter(),
    };
    if (!out.conductor) delete out.conductor;
    return out;
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
        conductor: data.conductor || undefined,
        teleprompter: data.teleprompter || emptyTeleprompter(),
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

  function lastEventAtOrBefore(list, tick) {
    if (!list || !list.length) return null;
    let pick = list[0];
    for (let i = 0; i < list.length; i++) {
      if (list[i].tick <= tick) pick = list[i];
      else break;
    }
    return pick;
  }

  function tickToSeconds(conductor, tick) {
    const c = normalizeConductor(conductor);
    const ppq = c.ppq;
    const t = Math.max(0, +tick || 0);
    let sec = 0;
    let lastTick = 0;
    let us = c.tempos[0].usPerQuarter;
    for (let i = 0; i < c.tempos.length; i++) {
      const ev = c.tempos[i];
      if (ev.tick >= t) break;
      sec += ((ev.tick - lastTick) / ppq) * (us / 1e6);
      lastTick = ev.tick;
      us = ev.usPerQuarter;
    }
    sec += ((t - lastTick) / ppq) * (us / 1e6);
    return sec;
  }

  function ticksToMs(conductor, startTick, endTick) {
    const a = tickToSeconds(conductor, startTick);
    const b = tickToSeconds(conductor, endTick);
    return Math.max(20, (b - a) * 1000);
  }

  /** Inverse of tickToSeconds. Used by DAW chase (MTC seconds → conductor tick). */
  function secondsToTick(conductor, seconds) {
    const c = normalizeConductor(conductor);
    const ppq = c.ppq;
    const target = Math.max(0, +seconds || 0);
    let sec = 0;
    let lastTick = 0;
    let us = c.tempos[0].usPerQuarter;
    for (let i = 0; i < c.tempos.length; i++) {
      const nextTick = i + 1 < c.tempos.length ? c.tempos[i + 1].tick : Infinity;
      const secPerTick = (us / 1e6) / ppq;
      if (!isFinite(nextTick)) {
        if (target <= sec) return lastTick;
        return lastTick + (target - sec) / secPerTick;
      }
      const secToNext = (nextTick - lastTick) * secPerTick;
      if (sec + secToNext >= target) {
        return lastTick + (target - sec) / secPerTick;
      }
      sec += secToNext;
      lastTick = nextTick;
      us = c.tempos[i + 1].usPerQuarter;
    }
    return lastTick;
  }

  function barTicks(sig, ppq) {
    const den = Math.max(1, sig.den || 4);
    return (sig.num || 4) * ppq * (4 / den);
  }

  function beatTicks(sig, ppq) {
    const den = Math.max(1, sig.den || 4);
    return ppq * (4 / den);
  }

  function tickToBarBeat(conductor, tick, barOffset) {
    const c = normalizeConductor(conductor);
    const ppq = c.ppq;
    const t = Math.max(0, +tick || 0);
    let bar = 1 + (barOffset | 0);
    let cursor = 0;
    let guard = 0;
    while (guard++ < 200000) {
      const sig = lastEventAtOrBefore(c.timeSigs, cursor) || c.timeSigs[0];
      const bt = barTicks(sig, ppq);
      if (cursor + bt > t || bt <= 0) {
        const into = t - cursor;
        const beat = 1 + into / Math.max(1e-6, beatTicks(sig, ppq));
        return { bar, beat, num: sig.num, den: sig.den };
      }
      cursor += bt;
      bar += 1;
    }
    return { bar, beat: 1, num: 4, den: 4 };
  }

  function formatBarBeat(bb) {
    if (!bb) return '';
    const beat = Math.round(bb.beat * 100) / 100;
    const beatStr = beat === (beat | 0) ? String(beat | 0) : String(beat);
    return bb.bar + '.' + beatStr;
  }

  function clickTicksInRange(conductor, startTick, endTick) {
    const c = normalizeConductor(conductor);
    const ppq = c.ppq;
    const start = Math.max(0, +startTick || 0);
    const end = Math.max(start, +endTick || 0);
    const out = [];
    let cur = 0;
    let guard = 0;
    while (cur < end && guard++ < 200000) {
      const sig = lastEventAtOrBefore(c.timeSigs, cur) || c.timeSigs[0];
      const step = ((sig.clocks || 24) / 24) * ppq;
      if (step <= 0) break;
      if (cur >= start) {
        const bb = tickToBarBeat(c, cur, 0);
        const frac = bb.beat - 1;
        out.push({ tick: cur, accent: Math.abs(frac) < 0.02 || frac < 0.02 });
      }
      cur += step;
    }
    return out;
  }

  function formatConductorReadout(conductor) {
    if (!conductor || !conductor.tempos || !conductor.tempos.length) return 'No tempo map';
    const c = normalizeConductor(conductor);
    const bpms = [];
    c.tempos.forEach((t) => {
      const n = t.bpm;
      if (!bpms.length || bpms[bpms.length - 1] !== n) bpms.push(n);
    });
    const sigs = [];
    c.timeSigs.forEach((s) => {
      const lab = s.num + '/' + s.den;
      if (!sigs.length || sigs[sigs.length - 1] !== lab) sigs.push(lab);
    });
    let out = bpms.join(' → ') + ' BPM';
    if (sigs.length) out += ' · ' + sigs.join(' → ');
    return out;
  }

  function uniqueTempos(conductor) {
    const c = normalizeConductor(conductor);
    const out = [];
    c.tempos.forEach((t) => {
      if (!out.length || out[out.length - 1] !== t.bpm) out.push(t.bpm);
    });
    return out;
  }

  function readU16(b, i) {
    return (b[i] << 8) | b[i + 1];
  }

  function readU32(b, i) {
    return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  }

  function readVarLen(b, i) {
    let v = 0;
    for (let n = 0; n < 4 && i < b.length; n++) {
      const x = b[i++];
      v = (v << 7) | (x & 0x7f);
      if (!(x & 0x80)) break;
    }
    return { v, i };
  }

  function parseTrackEvents(b, start, end, track, tempos, timeSigs, notes) {
    let i = start;
    let tick = 0;
    let status = 0;
    const active = new Map();

    function release(ch, note, at) {
      const k = (ch << 8) | note;
      const on = active.get(k);
      if (!on) return;
      active.delete(k);
      notes.push({
        tick: on.tick,
        endTick: Math.max(on.tick + 1, at),
        note: note,
        vel: on.vel,
        channel: ch,
        track: track,
      });
    }

    while (i < end) {
      const vl = readVarLen(b, i);
      i = vl.i;
      tick += vl.v;
      if (i >= end) break;
      let st = b[i];
      if (st < 0x80) {
        if (!status) break;
        st = status;
      } else {
        i++;
        if (st < 0xf0) status = st;
      }

      if (st === 0xff) {
        if (i >= end) break;
        const type = b[i++];
        const ln = readVarLen(b, i);
        i = ln.i;
        const dataEnd = Math.min(end, i + ln.v);
        if (type === 0x51 && ln.v >= 3) {
          const us = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
          tempos.push({ tick, usPerQuarter: us, bpm: Math.round(60000000 / us) });
        } else if (type === 0x58 && ln.v >= 4) {
          timeSigs.push({
            tick,
            num: b[i],
            den: 1 << b[i + 1],
            clocks: b[i + 2],
            thirtySeconds: b[i + 3],
          });
        }
        i = dataEnd;
        continue;
      }
      if (st === 0xf0 || st === 0xf7) {
        const ln = readVarLen(b, i);
        i = ln.i + ln.v;
        continue;
      }
      const hi = st & 0xf0;
      const ch = st & 0x0f;
      if (hi === 0x80 || hi === 0x90) {
        if (i + 1 >= end) break;
        const note = b[i++];
        const vel = b[i++];
        if (hi === 0x80 || vel === 0) release(ch, note, tick);
        else {
          const k = (ch << 8) | note;
          if (active.has(k)) release(ch, note, tick);
          active.set(k, { tick, vel, ch });
        }
      } else if (hi === 0xc0 || hi === 0xd0) {
        i += 1;
      } else if (hi === 0xa0 || hi === 0xb0 || hi === 0xe0) {
        i += 2;
      } else {
        break;
      }
    }
    active.forEach((on, k) => {
      notes.push({
        tick: on.tick,
        endTick: Math.max(on.tick + 1, tick),
        note: k & 0xff,
        vel: on.vel,
        channel: on.ch,
        track: track,
      });
    });
  }

  function parseSmf(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (b.length < 14) throw new Error('Not a MIDI file (too short)');
    if (b[0] !== 0x4d || b[1] !== 0x54 || b[2] !== 0x68 || b[3] !== 0x64) {
      throw new Error('Not a MIDI file (missing MThd)');
    }
    const hdrLen = readU32(b, 4);
    if (hdrLen < 6 || 8 + hdrLen > b.length) throw new Error('MIDI header is truncated');
    const format = readU16(b, 8);
    const ntrks = readU16(b, 10);
    const division = readU16(b, 12);
    if (division & 0x8000) throw new Error('SMPTE-timed MIDI is not supported');
    const ppq = division || 480;
    let off = 8 + hdrLen;
    const tempos = [];
    const timeSigs = [];
    const notes = [];
    let tracksParsed = 0;
    let safety = 0;
    while (tracksParsed < ntrks && off + 8 <= b.length && safety++ < 1024) {
      if (b[off] !== 0x4d || b[off + 1] !== 0x54 || b[off + 2] !== 0x72 || b[off + 3] !== 0x6b) {
        off++;
        continue;
      }
      const tlen = readU32(b, off + 4);
      const start = off + 8;
      const end = Math.min(b.length, start + tlen);
      parseTrackEvents(b, start, end, tracksParsed, tempos, timeSigs, notes);
      off = start + tlen;
      tracksParsed++;
    }
    const conductor = normalizeConductor({ ppq, tempos, timeSigs });
    return { format, ntrks: tracksParsed, ppq: conductor.ppq, tempos: conductor.tempos, timeSigs: conductor.timeSigs, notes };
  }

  function extraExactQuality(notes, root) {
    const set = new Set(normalizePcs(notes).map((n) => ((n - root) % 12 + 12) % 12));
    const extra = [
      ['6th', [0, 4, 7, 9]],
      ['min6', [0, 3, 7, 9]],
    ];
    for (let i = 0; i < extra.length; i++) {
      const ivs = extra[i][1];
      if (ivs.length === set.size && ivs.every((iv) => set.has(iv))) return extra[i][0];
    }
    return exactQualityFromNotes(notes, root);
  }

  function inferNamedChord(pcs, bassPc) {
    let best = null;
    const roots = pcs.length ? pcs.slice() : [bassPc];
    roots.forEach((root) => {
      const q = extraExactQuality(pcs, root);
      if (!q) return;
      let score = 1;
      if (root === bassPc) score += 8;
      if (q === 'maj' || q === 'min') score += 2;
      if (q === 'maj7' || q === 'min7' || q === 'dom7' || q === '6th') score += 1;
      if (!best || score > best.score) best = { root, quality: q, score };
    });
    if (best) {
      return {
        root: best.root,
        quality: best.quality,
        custom: false,
        name: NOTE_NAMES_SHARP[best.root] + (QUALITY_SHORT[best.quality] != null ? QUALITY_SHORT[best.quality] : ''),
      };
    }
    return {
      root: bassPc,
      quality: 'custom',
      custom: true,
      name: customChordLabel(bassPc, pcs),
    };
  }

  function roundBeats(beats) {
    const q = Math.round(beats * 4) / 4;
    return q > 0 ? q : 0.25;
  }

  function restChair(start, end, ppq) {
    return {
      root: 0,
      quality: 'custom',
      custom: true,
      notes: [],
      name: '(rest)',
      duration: roundBeats((end - start) / ppq),
      bass: 0,
      roman: '',
      tag: 'rest',
      _tick: start,
      _tickEnd: end,
      _rest: true,
    };
  }

  function midiNotesToChairs(parsed) {
    const notes = (parsed.notes || []).slice().sort((a, b) => a.tick - b.tick || a.note - b.note);
    const ppq = parsed.ppq || 480;
    const slack = Math.max(1, Math.round(ppq / 48));
    const chairs = [];
    const warnings = [];
    if (!notes.length) {
      return { chairs, warnings: ['No notes in this MIDI file'] };
    }
    const clusters = [];
    notes.forEach((n) => {
      const last = clusters[clusters.length - 1];
      if (last && n.tick - last.start <= slack) {
        last.notes.push(n);
      } else {
        clusters.push({ start: n.tick, notes: [n] });
      }
    });
    if (clusters[0].start > slack) {
      chairs.push(restChair(0, clusters[0].start, ppq));
    }
    clusters.forEach((cl, i) => {
      const nextStart = clusters[i + 1] ? clusters[i + 1].start : null;
      let soundingEnd = cl.notes[0].endTick;
      cl.notes.forEach((n) => {
        if (n.endTick > soundingEnd) soundingEnd = n.endTick;
      });
      const end = nextStart != null ? nextStart : soundingEnd;
      const midis = cl.notes.map((n) => n.note);
      const bassMidi = Math.min.apply(null, midis);
      const bassPc = ((bassMidi % 12) + 12) % 12;
      const pcs = normalizePcs(midis);
      const inf = inferNamedChord(pcs, bassPc);
      const slash = bassPc !== inf.root;
      const name = inf.name + (slash ? '/' + NOTE_NAMES_SHARP[bassPc] : '');
      chairs.push({
        root: inf.root,
        quality: inf.custom ? 'custom' : inf.quality,
        custom: !!inf.custom,
        notes: pcs,
        name,
        duration: roundBeats((end - cl.start) / ppq),
        bass: bassPc,
        roman: '',
        region: '',
        tag: 'midi',
        _tick: cl.start,
        _tickEnd: end,
        _rest: false,
      });
    });
    if (chairs.some((c) => c.custom && !c._rest)) {
      warnings.push('Some names are guesses — rename any chair that looks wrong.');
    }
    return { chairs, warnings };
  }

  function importMidiBytes(bytes) {
    const parsed = parseSmf(bytes);
    const built = midiNotesToChairs(parsed);
    return {
      format: parsed.format,
      trackCount: parsed.ntrks,
      conductor: {
        ppq: parsed.ppq,
        tempos: parsed.tempos,
        timeSigs: parsed.timeSigs,
      },
      chairs: built.chairs,
      warnings: built.warnings,
    };
  }

  function compactChairName(ch, noteNameFn) {
    if (!ch) return '?';
    if (ch._rest) return '—';
    if (ch.name) return ch.name;
    const nameOf = noteNameFn || function (pc) { return NOTE_NAMES_SHARP[((pc % 12) + 12) % 12]; };
    const root = nameOf(ch.root);
    const suf = QUALITY_SHORT[ch.quality];
    let s = root + (suf != null ? suf : ch.quality === 'custom' ? '·' : '');
    if (ch.bass != null && ((ch.bass % 12) + 12) % 12 !== ((ch.root % 12) + 12) % 12) {
      s += '/' + nameOf(ch.bass);
    }
    return s;
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
    readSongFromDisk,
    saveSong,
    ensureCell,
    newCellId,
    newFamilyId,
    createVariation,
    variationKindLabel,
    kindFromLabel,
    stripGeneratedLineage,
    stripLineageFromName,
    parseLineageFromName,
    lineageLockText,
    composeCellName,
    inferLineageOnCell,
    applyUserCellName,
    findSiblingByVersion,
    familyVersions,
    siblingsOfCell,
    healFamilies,
    adoptOrphanCell,
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
    mergeClipIntoChords,
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
    emptyConductor,
    emptyTeleprompter,
    normalizeConductor,
    normalizeTeleprompter,
    tickToSeconds,
    ticksToMs,
    secondsToTick,
    tickToBarBeat,
    formatBarBeat,
    clickTicksInRange,
    formatConductorReadout,
    uniqueTempos,
    parseSmf,
    importMidiBytes,
    inferNamedChord,
    compactChairName,
    QUALITY_SHORT,
    NOTE_NAMES_SHARP,
  };
})(typeof window !== 'undefined' ? window : globalThis);
