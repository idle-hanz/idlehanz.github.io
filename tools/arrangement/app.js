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

  const SECTION_NAMES = ['Intro', 'Verse', 'Chorus', 'Bridge', 'Outro', 'Break', 'Solo'];

  function init() {
    if (!S()) {
      alert('ih-session.js missing — keep it on the Desktop next to arrangement/');
      return;
    }
    load();
    wire();
    render();
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
    $('#song-title').value = song.title || 'Untitled';
    $('#bpm').value = song.bpm || 96;
    updateKeyLabel();
    if (song.arrangement.length) selectedSecId = song.arrangement[0].id;
  }

  function save(by) {
    song.title = $('#song-title').value || 'Untitled';
    song.bpm = Math.max(40, Math.min(220, parseInt($('#bpm').value, 10) || 96));
    S().saveSong(song, by || 'arrangement');
    setStatus('Saved · ' + (song.updatedAt || '').slice(11, 19));
  }

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
    const sec = {
      id: 'sec-' + Date.now().toString(36),
      name: nextSectionName(),
      cellId,
      chain: [cellId],
      reps: 1,
      seam: S().defaultSeam(),
    };
    song.arrangement.push(sec);
    selectedSecId = sec.id;
    save();
    render();
  }

  function newCell() {
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

  /** Remove a cell from the library; sections using it are removed (or reassigned). */
  function deleteCell(cellId) {
    const cell = song.cells[cellId];
    if (!cell) return;
    const used = (song.arrangement || []).filter(
      (s) => s.cellId === cellId || (s.chain && s.chain.indexOf(cellId) >= 0)
    );
    const label = cell.name || cellId;
    let msg = 'Delete cell “' + label + '”?';
    if (used.length) {
      msg +=
        '\n\nIt is used in ' +
        used.length +
        ' section(s): ' +
        used.map((s) => s.name).join(', ') +
        '.\nThose sections will be removed from the form.';
    }
    if (!confirm(msg)) return;

    delete song.cells[cellId];
    // Remove from family lists
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
    if (!n || n === cell.name) return;
    // Avoid duplicate names (allow if same id)
    const clash = Object.keys(song.cells).some(
      (id) => id !== cellId && (song.cells[id].name || '').toLowerCase() === n.toLowerCase()
    );
    cell.name = clash ? n + ' · ' + cellId.slice(-4) : n;
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
    const payload = S().buildHandoffPayload({
      by: 'arrangement',
      to: 'fretboard',
      title: song.title,
      bpm: song.bpm,
      key: song.key,
      cellId,
      cellName: cell.name,
      focus: 0,
      chords: cell.chords,
    });
    S().openWithHandoff(S().PATHS.fretboardFromArrangement, payload);
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
    song.arrangement = song.arrangement.filter((s) => s.id !== id);
    if (selectedSecId === id) selectedSecId = song.arrangement[0] ? song.arrangement[0].id : null;
    save();
    render();
  }

  function reorderSec(from, to) {
    if (from === to || from < 0 || to < 0) return;
    const arr = song.arrangement;
    if (from >= arr.length || to >= arr.length) return;
    const [item] = arr.splice(from, 1);
    arr.splice(to, 0, item);
    save();
    render();
  }

  // ─── Render ──────────────────────────────────────────────
  function render() {
    // reload song in case Landscape updated cells
    const fresh = S().loadSong();
    if (fresh) {
      // keep local arrangement edits if same updatedBy race — prefer storage
      song = fresh;
      if (!song.arrangement) song.arrangement = [];
      if (!song.cells) song.cells = {};
      $('#song-title').value = song.title || 'Untitled';
      $('#bpm').value = song.bpm || 96;
      updateKeyLabel();
    }
    renderCells();
    renderForm();
    renderTimeline();
    renderFocus();
  }

  function renderCells() {
    const host = $('#cell-list');
    host.innerHTML = '';
    const ids = Object.keys(song.cells || {});
    if (!ids.length) {
      host.innerHTML = '<p class="hint">No cells. Open Landscape or create a new cell.</p>';
      return;
    }
    const focusId = song.focus && song.focus.cellId;
    ids.forEach((id) => {
      const cell = song.cells[id];
      const wrap = document.createElement('div');
      wrap.className = 'cell-wrap' + (id === focusId ? ' active' : '');
      const bars = (cellBeats(cell) / 4).toFixed(cellBeats(cell) % 4 === 0 ? 0 : 1);
      wrap.innerHTML = `
        <div class="cell-head">
          <input type="text" class="cell-name-input" value="${escapeAttr(cell.name || id)}" maxlength="64" title="Rename cell" />
        </div>
        <button type="button" class="cell cell-main" title="Open in Landscape to edit chords">
          <span>${bars} bars · ${(cell.chords || []).length} chords</span>
          <em>${escapeAttr(cellLabel(cell))}</em>
        </button>
        <div class="cell-actions">
          <button type="button" class="btn ghost btn-edit-cell" title="Edit in Landscape">Edit in Landscape</button>
          <button type="button" class="btn ghost btn-del-cell" title="Delete cell">Delete</button>
        </div>
      `;
      const openEdit = () => openLandscapeForCell(id, song.cells[id].name);
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

      tr.innerHTML = `
        <td class="grip" title="Drag">⋮⋮</td>
        <td>${idx + 1}</td>
        <td><input type="text" class="sec-name" value="${escapeAttr(sec.name || '')}" /></td>
        <td>
          <select class="sec-cell">${cellOpts || '<option value="">—</option>'}</select>
          <div class="chain-line status">${escapeAttr(chainLabel)}</div>
          <div class="chain-box">${chainChecks}</div>
        </td>
        <td><input type="number" class="sec-reps" min="1" max="32" value="${sec.reps || 1}" style="width:3.5rem" /></td>
        <td>${bars % 1 === 0 ? bars : bars.toFixed(1)}</td>
        <td class="row-actions">
          <button type="button" class="btn ghost btn-land" title="Landscape">✎</button>
          <button type="button" class="btn ghost btn-fret" title="Fretboard">🎸</button>
          <button type="button" class="btn ghost btn-del" title="Remove">×</button>
        </td>
      `;

      tr.addEventListener('click', (e) => {
        if (e.target.closest('button, input, select, label')) return;
        selectSection(sec.id);
      });
      tr.querySelector('.sec-name').addEventListener('change', (e) => {
        sec.name = e.target.value;
        save();
        renderFocus();
        renderTimeline();
      });
      tr.querySelector('.sec-cell').addEventListener('change', (e) => {
        const id = e.target.value;
        sec.cellId = id;
        // Reset chain to this cell only (user can re-check versions)
        S().setSectionChain(sec, [id]);
        save();
        render();
      });
      tr.querySelectorAll('.chain-box input[type=checkbox]').forEach((cb) => {
        cb.addEventListener('change', () => {
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
        sec.reps = Math.max(1, parseInt(e.target.value, 10) || 1);
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
            </select>
            <span class="status seam-chords">${escapeAttr(seamCh)}</span>
          </td>
          <td colspan="2" class="status">flow between sections</td>
        `;
        seamTr.querySelector('.seam-type').addEventListener('change', (e) => {
          setSeamType(sec.id, e.target.value);
        });
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
      seg.textContent = sec.name || '';
      seg.title = `${sec.name}: ${b} bars`;
      bar.appendChild(seg);
    });
    const tb = S().totalBars(song);
    meta.textContent = `${tb % 1 === 0 ? tb : tb.toFixed(1)} bars · ${song.arrangement.length} sections · ${Object.keys(song.cells || {}).length} cells`;
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
    $('#focus-title').textContent = `${sec.name} · ${names} · ${bars % 1 === 0 ? bars : bars.toFixed(1)} bars (${sec.reps || 1}×)`;
    const labels = chain.map((id) => (song.cells[id] ? cellLabel(song.cells[id]) : '')).filter(Boolean);
    $('#focus-chords').textContent = labels.join('  |  ') || 'Empty';
  }

  function escapeAttr(s) {
    return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  // ─── Play / export ───────────────────────────────────────
  function playSong() {
    if (!A() || !M()) {
      alert('Audio/music engines not loaded.');
      return;
    }
    if (A().isPlaying && A().isPlaying()) {
      A().stopPlayback();
      playing = false;
      $('#btn-play').textContent = 'Play song';
      return;
    }
    const flat = S().flattenArrangement(song);
    if (!flat.length) {
      alert('Nothing to play — add sections with chords.');
      return;
    }
    const chords = flat.map((c) => {
      let ch = M().makeChord(c.root, c.quality || 'maj', { duration: c.duration || 4 });
      if (c.bass != null && c.bass !== c.root && window.HLCompose && HLCompose.withBass) {
        ch = HLCompose.withBass(ch, c.bass);
        ch.duration = c.duration || 4;
      }
      return ch;
    });
    A().ensure();
    playing = true;
    $('#btn-play').textContent = 'Stop';
    A().playSequence(chords, song.bpm || 96, {
      loop: false,
      pulse: true,
      onEnd: () => {
        playing = false;
        $('#btn-play').textContent = 'Play song';
      },
    });
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
    const chords = flat.map((c) => {
      let ch = M().makeChord(c.root, c.quality || 'maj', { duration: c.duration || 4 });
      if (c.bass != null && window.HLCompose && HLCompose.withBass) {
        ch = HLCompose.withBass(ch, c.bass);
        ch.duration = c.duration || 4;
      }
      return ch;
    });
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
    $('#song-title').addEventListener('change', () => save());
    $('#bpm').addEventListener('change', () => save());
    $('#btn-add-sec').addEventListener('click', addSection);
    $('#btn-new-cell').addEventListener('click', newCell);
    if ($('#btn-chain-family')) $('#btn-chain-family').addEventListener('click', chainFamilyIntoSection);
    $('#btn-refresh').addEventListener('click', () => {
      load();
      render();
      setStatus('Refreshed from session');
    });
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
    $('#btn-midi').addEventListener('click', exportMidi);
    $('#btn-text').addEventListener('click', exportText);

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
