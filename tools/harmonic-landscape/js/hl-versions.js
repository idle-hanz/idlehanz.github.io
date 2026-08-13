/**
 * hl-versions.js - versions, blue compare, fork (attaches to HLApp)
 */
(function (global) {
  "use strict";
  var H = global.HLApp;
  if (!H) throw new Error("HLApp missing - load hl-core.js first");
H.resolveCompareCell = function (song) {
    if (!song || !H.state.cellId || !H.state.compareCellId) return null;
    if (H.state.compareCellId === H.state.cellId) return null;
    const cell = song.cells[H.state.compareCellId];
    if (!cell) {
      H.state.compareCellId = null;
      return null;
    }
    return cell;
  }

  H.clearBlueCompare = function (opts) {
    opts = opts || {};
    H.state.compareCellId = null;
    if (H.map) H.map.setAltPath([]);
    if (!opts.silent) {
      H.renderVersionBar();
      H.renderSlots();
      H.setSyncStatus('Blue compare off · Alt-click a version chip to compare again');
    }
  }

  /** Draw comparison version in blue (only if user chose a compare target). */
  H.refreshAltPath = function () {
    if (!H.map || !H.S()) {
      if (H.map) H.map.setAltPath([]);
      return;
    }
    const song = H.S().loadSong();
    if (!song || !H.state.cellId) {
      H.map.setAltPath([]);
      return;
    }
    // Stale pointer: comparing the cell you're already editing
    if (H.state.compareCellId && H.state.compareCellId === H.state.cellId) {
      H.state.compareCellId = null;
    }
    const other = H.resolveCompareCell(song);
    if (!other || !other.chords || !other.chords.length) {
      H.map.setAltPath([]);
      return;
    }
    // Honour "Blue path" checkbox
    const tog = H.$('#tog-alt');
    if (tog && !tog.checked) {
      H.map.setAltPath([]);
      return;
    }
    const alt = other.chords.map((sc) => H.sessionChordToLandscape(sc));
    H.map.setAltPath(alt);
  }

  /** Indices where current path differs from compare cell (for slot highlight). */
  H.diffIndicesVsCompare = function () {
    if (!H.S() || !H.state.cellId) return new Set();
    const song = H.S().loadSong();
    const other = H.resolveCompareCell(song);
    if (!other || !other.chords) return new Set();
    const set = new Set();
    const n = Math.max(H.state.chords.length, other.chords.length);
    for (let i = 0; i < n; i++) {
      const a = H.state.chords[i];
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
  H.switchToCell = function (cellId, opts) {
    opts = opts || {};
    if (!H.S() || !cellId) return false;
    // Persist what you're leaving so variants don't lose edits
    // skipPush: after delete, current cellId may already be gone
    if (!opts.skipPush && H.state.chords.length && H.state.cellId) {
      H.pushToSharedSession('landscape');
    }
    const song = H.S().loadSong();
    if (!song || !song.cells[cellId]) {
      H.setSyncStatus('Cell not found');
      return false;
    }
    const cell = song.cells[cellId];
    song.focus = {
      cellId,
      sectionId: song.focus && song.focus.sectionId ? song.focus.sectionId : null,
      chordIndex: 0,
    };
    H.S().saveSong(song, 'landscape');
    H.applySessionChords(cell.chords || [], {
      title: cell.name || 'Cell',
      cellId: cell.id,
      packId: cell.packId,
      tonic: song.key && song.key.tonic,
      mode: song.key && song.key.mode,
      bpm: song.bpm,
      focusIndex: 0,
    });
    H.state.nameLocked = true;
    H.refreshAll();
    if (!opts.silent) {
      const v = cell.versionIndex != null ? ' v' + cell.versionIndex : '';
      H.setSyncStatus('Editing “' + (cell.name || cellId) + '”' + (cell.familyId ? v : ''));
      if (cell.chords && cell.chords.length) {
        H.A().ensure();
        const first = H.state.chords[0];
        if (first) H.A().playChord({ chord: first, soft: true, duration: 0.45 });
      }
    }
    return true;
  }

  /** Short chord path for version chip preview */
  H.cellPreviewLabel = function (cell) {
    if (!cell || !cell.chords || !cell.chords.length) return 'empty';
    const names = cell.chords.slice(0, 4).map((c) => {
      if (c.name) return c.name;
      if (c.custom && c.notes && H.S() && H.S().customChordLabel) {
        return H.S().customChordLabel(c.root, c.notes);
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
  H.renderVersionBar = function () {
    const host = H.$('#version-bar');
    if (!host) return;
    if (!H.S()) {
      host.hidden = true;
      host.innerHTML = '';
      return;
    }
    const song = H.S().loadSong();
    if (!song || !song.cells) {
      host.hidden = true;
      host.innerHTML = '';
      return;
    }

    const cellIds = Object.keys(song.cells);
    const cur = H.state.cellId && song.cells[H.state.cellId] ? song.cells[H.state.cellId] : null;
    const family = cur && cur.familyId ? H.S().siblingsOfCell(song, H.state.cellId) : cur ? [cur] : [];
    const hasFamily = family.length > 1;
    const hasManyCells = cellIds.length > 1;

    // Always show when editing a cell or a sequence (so Duplicate / Vary are reachable)
    if (!cur && !H.state.chords.length && !hasManyCells) {
      host.hidden = true;
      host.innerHTML = '';
      return;
    }

    host.hidden = false;
    let html = '';

    // Always show version actions
    const compareName =
      H.state.compareCellId && song.cells[H.state.compareCellId]
        ? song.cells[H.state.compareCellId].name || 'compare'
        : null;
    html +=
      '<div class="version-bar-label">Versions · each fork is a full take · click = edit · Alt-click = blue compare' +
      (compareName
        ? ' · <span style="color:#7eb8da">blue = ' + H.escapeHtml(compareName) + '</span>'
        : ' · no blue overlay') +
      '</div>';
    if (hasFamily || cur) {
      const famName =
        cur && cur.familyId && song.families[cur.familyId]
          ? song.families[cur.familyId].name
          : (cur && cur.name ? cur.name.replace(/\s*v\d+\s*$/i, '') : '') || 'Theme';
      const chips = hasFamily ? family : cur ? [cur] : [];
      html +=
        '<div class="version-chips" id="version-chips" data-fam="' +
        H.escapeAttr(famName) +
        '">';
      chips.forEach((c) => {
        const active = c.id === H.state.cellId;
        // Only mark blue when user explicitly set compare (never auto-v1)
        const isCompare = !active && H.state.compareCellId === c.id;
        const vi = c.versionIndex != null ? c.versionIndex : '?';
        const label = c.name || 'v' + vi;
        html +=
          '<button type="button" class="ver-chip' +
          (active ? ' active' : '') +
          (isCompare ? ' compare' : '') +
          '" data-cell="' +
          H.escapeAttr(c.id) +
          '" title="' +
          H.escapeAttr(
            label +
              ' · ' +
              H.cellPreviewLabel(c) +
              (active
                ? ' (editing)'
                : isCompare
                  ? ' — blue compare (Alt-click again to clear)'
                  : ' — click edit · Alt-click = blue compare · × delete')
          ) +
          '">' +
          '<span class="ver-n">v' +
          vi +
          '</span>' +
          H.escapeHtml(
            // Prefer short chip title: "v1 Darken" from "Theme · v1 Darken"
            (() => {
              const m = String(label).match(/·\s*(v\d+\s+.+)$/i);
              if (m) return m[1].trim();
              return label.replace(/\s*v\d+\s*$/i, '') || label;
            })()
          ) +
          '<span class="ver-preview">' +
          H.escapeHtml(H.cellPreviewLabel(c)) +
          (isCompare ? ' · blue' : '') +
          '</span>' +
          '<span class="ver-x" data-del="' +
          H.escapeAttr(c.id) +
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
      '<button type="button" class="btn ghost" id="btn-var-voice" title="Fork with smooth inversions through the whole cell">+ Voice lead</button>' +
      '<button type="button" class="btn ghost" id="btn-var-sevenths" title="Fork with 7ths on every step — same roots, richer colour">+ 7ths</button>' +
      '<button type="button" class="btn ghost" id="btn-var-pedal" title="Fork with a held common-tone bass. Uses each step’s own key after a modulation. Never adds a bass that is not in the chord.">+ Pedal</button>' +
      '<button type="button" class="btn ghost" id="btn-var-rhythm" title="Fork with a new rhythm shape, same chords">+ Rhythm</button>' +
      '<button type="button" class="btn ghost" id="btn-var-reharm" title="Fork with two reharm joins">+ Reharm</button>' +
      '<button type="button" class="btn ghost" id="btn-var-major" title="Fork: minors become majors. Majors stay. Same roots.">+ Major</button>' +
      '<button type="button" class="btn ghost" id="btn-var-minor" title="Fork: majors become minors. Minors stay. Same roots.">+ Minor</button>' +
      '<button type="button" class="btn ghost" id="btn-var-in-major" title="Rewrite in the parallel major: same degrees, roots can move (D → D♯m in B). If already major, lifts remaining minors.">+ In major</button>' +
      '<button type="button" class="btn ghost" id="btn-var-in-minor" title="Rewrite in the parallel minor: same degrees, roots can move (C–G–Am–F → Cm–Gm–A♭–Fm). If already minor, darkens the major islands.">+ In minor</button>' +
      '<button type="button" class="btn ghost" id="btn-var-darken" title="Fork with one darker join">+ Darken</button>' +
      '<button type="button" class="btn ghost" id="btn-var-brighter" title="Fork with one brighter join">+ Brighten</button>' +
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
          const vers = H.S().familyVersions(song, c.familyId);
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
          html += '<optgroup label="' + H.escapeAttr(g.label) + '">';
          g.cells.forEach((c) => {
            html +=
              '<option value="' +
              H.escapeAttr(c.id) +
              '"' +
              (c.id === H.state.cellId ? ' selected' : '') +
              '>v' +
              (c.versionIndex || 1) +
              ' · ' +
              H.escapeHtml(c.name || c.id) +
              '</option>';
          });
          html += '</optgroup>';
        } else {
          g.cells.forEach((c) => {
            html +=
              '<option value="' +
              H.escapeAttr(c.id) +
              '"' +
              (c.id === H.state.cellId ? ' selected' : '') +
              '>' +
              H.escapeHtml(c.name || c.id) +
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
          if (delId) H.deleteVersion(delId);
          return;
        }
        const id = btn.getAttribute('data-cell');
        if (!id) return;
        if (e.altKey || e.metaKey) {
          if (id === H.state.cellId) {
            H.setSyncStatus('Blue compare must be a different version (not the one you are editing)');
            return;
          }
          // Alt-click same chip again → clear
          if (H.state.compareCellId === id) {
            H.clearBlueCompare();
            return;
          }
          H.state.compareCellId = id;
          // Ensure blue path toggle is on so the overlay appears
          const tog = H.$('#tog-alt');
          if (tog && !tog.checked) {
            tog.checked = true;
            if (H.map) H.map.setShowAlt(true);
          }
          H.refreshAltPath();
          H.renderVersionBar();
          H.renderSlots();
          H.setSyncStatus(
            'Blue compare → ' +
              (song.cells[id] && song.cells[id].name) +
              ' · gold = what you edit · Alt-click that chip again to turn off'
          );
          return;
        }
        if (id !== H.state.cellId) H.switchToCell(id);
      });
    });
    host.querySelectorAll('.ver-x').forEach((x) => {
      x.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const delId = x.getAttribute('data-del');
        if (delId) H.deleteVersion(delId);
      });
    });
    const sel = host.querySelector('#cell-switch');
    if (sel) {
      sel.addEventListener('change', () => {
        if (sel.value && sel.value !== H.state.cellId) H.switchToCell(sel.value);
      });
    }
    const bind = (id, fn) => {
      const el = host.querySelector(id);
      if (el) el.addEventListener('click', fn);
    };
    bind('#btn-var-copy', () => H.createVariation('copy'));
    bind('#btn-var-voice', () => H.createVariation('voice'));
    bind('#btn-var-sevenths', () => H.createVariation('sevenths'));
    bind('#btn-var-pedal', () => H.createVariation('pedal'));
    bind('#btn-var-rhythm', () => H.createVariation('rhythm'));
    bind('#btn-var-reharm', () => H.createVariation('reharm'));
    bind('#btn-var-major', () => H.createVariation('parallel-major'));
    bind('#btn-var-minor', () => H.createVariation('parallel-minor'));
    bind('#btn-var-in-major', () => H.createVariation('key-major'));
    bind('#btn-var-in-minor', () => H.createVariation('key-minor'));
    bind('#btn-var-darken', () => H.createVariation('darken'));
    bind('#btn-var-brighter', () => H.createVariation('brighter'));
    bind('#btn-ab-ver', () => H.playAB());
    bind('#btn-var-del', () => {
      if (H.state.cellId) H.deleteVersion(H.state.cellId);
    });
  }

  /**
   * Delete a version/cell from the shared song session.
   * If it is the one you're editing, switch to a sibling (or clear).
   */
  H.deleteVersion = function (cellId) {
    if (!H.S() || !cellId) return;
    // Save current work first if deleting something else
    if (H.state.chords.length && H.state.cellId && H.state.cellId !== cellId) {
      H.pushToSharedSession('landscape');
    } else if (H.state.chords.length && H.state.cellId === cellId) {
      H.pushToSharedSession('landscape');
    }

    let song = H.S().loadSong();
    if (!song || !song.cells[cellId]) {
      H.setSyncStatus('Version not found');
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

    if (!H.S().deleteCell) {
      alert('Session update required — refresh the page.');
      return;
    }
    const result = H.S().deleteCell(song, cellId, { dissolveSoloFamily: false });
    if (!result || !result.ok) {
      H.setSyncStatus('Could not delete');
      return;
    }
    H.S().saveSong(song, 'landscape');

    if (H.state.compareCellId === cellId) H.state.compareCellId = null;

    if (H.state.cellId === cellId) {
      // Don't re-save the deleted id
      H.state.cellId = null;
      if (result.nextFocusId && song.cells[result.nextFocusId]) {
        const nextName = song.cells[result.nextFocusId].name || '';
        H.switchToCell(result.nextFocusId, { silent: true, skipPush: true });
        H.setSyncStatus('Deleted “' + label + '” · now editing “' + nextName + '”');
      } else {
        H.state.chords = [];
        H.state.selected = -1;
        H.state.title = 'Untitled sequence';
        H.state.compareCellId = null;
        H.state.nameLocked = false;
        H.refreshAll();
        H.setSyncStatus('Deleted “' + label + '” · no versions left');
      }
    } else {
      H.refreshAll();
      H.setSyncStatus('Deleted “' + label + '”');
    }
  }

  H.escapeHtml = function (s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  H.escapeAttr = function (s) {
    return H.escapeHtml(s).replace(/'/g, '&#39;');
  }

  /**
   * Map a quality to its parallel (maj↔min family). Returns null if no flip.
   * Does not touch dom7 / sus / fully chromatic colours.
   */
  H.parallelQualityOf = function (q) {
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
  H.parallelFromNotes = function (root, notes, quality) {
    const flipped = H.parallelQualityOf(quality);
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
  H.sessionChordWithQuality = function (c, quality, extra) {
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
  H.variationKindLabel = function (kind) {
    const map = {
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
    return map[kind] || String(kind || 'Var');
  }

  /**
   * Name a new version from its source + transform, e.g. "Home grit · v1 Darken".
   */
  H.nameForVariation = function (song, sourceCellId, kind) {
    const src = song.cells[sourceCellId];
    if (!src) return null;
    const fam =
      src.familyId && song.families[src.familyId] ? song.families[src.familyId] : null;
    let base = (fam && fam.name) || src.name || H.state.title || 'Cell';
    base = String(base)
      .replace(/\s*·\s*v\d+.*$/i, '')
      .replace(/\s*v\d+\s*$/i, '')
      .trim() || 'Cell';
    const srcV = src.versionIndex != null ? src.versionIndex : 1;
    const kindLabel = H.variationKindLabel(kind);
    // "Theme · v1 Darken" — clear lineage from which version was transformed
    if (kind === 'copy') {
      return base + ' · v' + srcV + ' Copy';
    }
    return base + ' · v' + srcV + ' ' + kindLabel;
  }

  /**
   * Fork current sequence as a linked variation (same family).
   * kind: copy | voice | sevenths | pedal | rhythm | reharm | parallel | darken | brighter
   */
  H.createVariation = function (kind) {
    if (!H.state.chords.length) {
      alert('Add chords first.');
      return;
    }
    if (!H.S()) {
      alert('Session module missing.');
      return;
    }
    H.pushToSharedSession('landscape');
    let song = H.S().loadSong();
    if (!song || !H.state.cellId) return;

    // Start from clean session chords
    let newChords = H.state.chords.map((c) => H.S().fromLandscapeChord(c));
    let changed = 0;
    const C = H.C();
    const toLand = function (arr) {
      return arr.map(function (sc) {
        return H.sessionChordToLandscape ? H.sessionChordToLandscape(sc) : sc;
      });
    };
    const fromLand = function (land, tag) {
      return (land || []).map(function (ch) {
        const out = H.S().fromLandscapeChord(ch);
        out.tag = ch.tag || tag || out.tag;
        return out;
      });
    };
    const pathSig = function (arr) {
      return (arr || [])
        .map(function (c) {
          const bass = c.bass != null ? c.bass : c.bassPc != null ? c.bassPc : c.root;
          return (
            (c.root != null ? c.root : '?') +
            ':' +
            (c.quality || '') +
            ':' +
            bass +
            ':' +
            (c.duration || 4)
          );
        })
        .join('|');
    };
    const srcSig = pathSig(newChords);
    const applyLand = function (fn, tag) {
      if (!fn) return false;
      const next = fn(toLand(newChords));
      if (!next || !next.length) return false;
      newChords = fromLand(next, tag);
      return pathSig(newChords) !== srcSig;
    };

    if (kind === 'copy') {
      // Exact fork — keep notes/custom as-is
    } else if (kind === 'parallel-major' && C && C.parallelProgression) {
      changed = applyLand(function (land) {
        return C.parallelProgression(land, 'maj');
      }, 'parallel')
        ? 1
        : 0;
    } else if (kind === 'parallel-minor' && C && C.parallelProgression) {
      changed = applyLand(function (land) {
        return C.parallelProgression(land, 'min');
      }, 'parallel')
        ? 1
        : 0;
    } else if (kind === 'key-major' && C && C.parallelKeyProgression) {
      changed = applyLand(function (land) {
        return C.parallelKeyProgression(land, H.state.tonic, H.state.mode, 'maj');
      }, 'parallel-key')
        ? 1
        : 0;
    } else if (kind === 'key-minor' && C && C.parallelKeyProgression) {
      changed = applyLand(function (land) {
        return C.parallelKeyProgression(land, H.state.tonic, H.state.mode, 'min');
      }, 'parallel-key')
        ? 1
        : 0;
    } else if (kind === 'voice') {
      changed = applyLand(C && C.smoothCellVoicings, 'voice') ? 1 : 0;
    } else if (kind === 'sevenths' && C && C.seventhizeProgression) {
      changed = applyLand(function (land) {
        return C.seventhizeProgression(land, H.state.tonic, H.state.mode);
      }, 'sevenths')
        ? 1
        : 0;
    } else if (kind === 'pedal' && C && C.pedalProgression) {
      changed = applyLand(function (land) {
        return C.pedalProgression(land, H.state.tonic);
      }, 'pedal')
        ? 1
        : 0;
    } else if (kind === 'rhythm') {
      changed = applyLand(C && C.varyRhythmOnly, 'rhythm') ? 1 : 0;
    } else if (kind === 'brighter' && C && C.brightenProgression) {
      changed = applyLand(function (land) {
        return C.brightenProgression(land, H.state.tonic, H.state.mode);
      }, 'brighter')
        ? 1
        : 0;
    } else if (kind === 'darken' && C && C.darkenProgression) {
      changed = applyLand(function (land) {
        return C.darkenProgression(land, H.state.tonic, H.state.mode);
      }, 'darken')
        ? 1
        : 0;
    } else if (kind === 'reharm') {
      if (C && C.reharmProgression) {
        changed = applyLand(function (land) {
          return C.reharmProgression(land, H.state.tonic, H.state.mode);
        }, 'reharm')
          ? 1
          : 0;
      } else if (newChords.length >= 4) {
        const t = H.state.tonic;
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
    }

    if (kind !== 'copy' && !changed) {
      H.setSyncStatus(
        H.variationKindLabel(kind) + ' · already that take · try another fork or edit a step'
      );
      return;
    }

    const varName = H.nameForVariation(song, H.state.cellId, kind);
    const newId = H.S().createVariation(song, H.state.cellId, {
      chords: newChords,
      name: varName,
    });
    if (!newId) return;
    // Parent stays as explicit blue compare so you see what you forked from
    const parentId = H.state.cellId;
    H.state.compareCellId = parentId;
    H.S().saveSong(song, 'landscape');

    // Switch to the new version for editing
    const cell = song.cells[newId];
    H.applySessionChords(cell.chords, {
      title: cell.name,
      cellId: newId,
      packId: cell.packId,
      tonic: song.key && song.key.tonic,
      mode: song.key && song.key.mode,
      bpm: song.bpm,
    });
    H.state.nameLocked = true;
    // Ensure blue overlay visible after fork
    const tog = H.$('#tog-alt');
    if (tog) {
      tog.checked = true;
      if (H.map) H.map.setShowAlt(true);
    }
    H.refreshAll();
    const details = {
      copy: ' (exact copy — tweak freely)',
      'parallel-major': ' · minors → majors (majors kept)',
      'parallel-minor': ' · majors → minors (minors kept)',
      'key-major': ' · same degrees in the parallel major (roots can move)',
      'key-minor': ' · same degrees in the parallel minor (roots can move)',
      voice: ' · inversions smoothed through the cell',
      sevenths: ' · 7ths on every step',
      pedal: ' · common-tone bass · local home, only if it belongs',
      rhythm: ' · new rhythm shape',
      darker: ' · one darker join',
      darken: ' · one darker join',
      brighter: ' · one brighter join',
      reharm: ' · two reharm joins',
    };
    const detail = details[kind] || ' · ' + H.variationKindLabel(kind);
    H.setSyncStatus(
      'Created “' +
        cell.name +
        '”' +
        detail +
        ' · gold=new · blue=parent · Alt-click blue chip to clear compare'
    );
    H.playSeq({ once: true, force: true });
  }

})(typeof window !== "undefined" ? window : globalThis);
