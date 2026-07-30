/**
 * Dark Harmony workbench — preset-first progression tool
 * Load a pack → hear it → mutate → export. No empty map.
 */
(function () {
  'use strict';

  const M = () => window.HLMusic;
  const A = () => window.HLAudio;
  const C = () => window.HLCompose || window.HLMusic;
  const P = () => window.HLPacks;

  const state = {
    tonic: 11, // B
    mode: 'minor',
    bpm: 96,
    loop: true,
    pulse: true,
    packId: 'home-grit',
    colourFilter: 'all',
    chords: [],
    selected: 0,
    variations: [], // { id, name, chords }
    activeVar: null, // null = main working cell
    name: 'Home grit',
  };

  let uid = 1;
  const $ = (s) => document.querySelector(s);

  function nextId(prefix) {
    return `${prefix}-${uid++}`;
  }

  function keyLabel() {
    return M().noteName(state.tonic) + ' ' + (M().MODES[state.mode] || M().MODES.minor).name;
  }

  // ─── Init ────────────────────────────────────────────────
  function init() {
    wire();
    fillSelects();
    // Always start on a real pack — never blank
    loadPack('home-grit', { silent: true });
    renderAll();
    // Auto-preview once audio unlocks
    document.body.addEventListener(
      'pointerdown',
      () => {
        A().ensure();
      },
      { once: true }
    );
  }

  function fillSelects() {
    const tonicSel = $('#tonic');
    M().NOTE_NAMES.forEach((n, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = n;
      if (i === state.tonic) o.selected = true;
      tonicSel.appendChild(o);
    });
    const modeSel = $('#mode');
    Object.keys(M().MODES).forEach((k) => {
      const o = document.createElement('option');
      o.value = k;
      o.textContent = M().MODES[k].name;
      if (k === state.mode) o.selected = true;
      modeSel.appendChild(o);
    });
    const col = $('#colour-filter');
    P().COLOURS.forEach((c) => {
      const o = document.createElement('option');
      o.value = c;
      o.textContent = c === 'all' ? 'All colours' : c;
      col.appendChild(o);
    });
  }

  // ─── Packs ───────────────────────────────────────────────
  function loadPack(id, opts) {
    const pack = P().getPack(id);
    if (!pack) return;
    state.packId = id;
    state.name = pack.name;
    state.chords = P().materialize(pack, state.tonic, state.mode);
    state.selected = 0;
    state.activeVar = null;
    // Prefer mode hint from pack if still on generic minor
    if (pack.keyHint && (pack.keyHint === 'dorian' || pack.keyHint === 'phrygian' || pack.keyHint === 'harmonic')) {
      // don't force mode change on every load — only suggest via name
    }
    renderAll();
    if (!opts || !opts.silent) {
      playWorking({ once: true });
    }
  }

  function reloadPackInKey() {
    // Re-materialise current pack template in new key (explicit key change for seeds)
    if (state.packId && state.activeVar == null) {
      const pack = P().getPack(state.packId);
      if (pack) {
        state.chords = P().materialize(pack, state.tonic, state.mode);
        state.name = pack.name;
      }
    } else {
      // Transpose working chords by delta
      // handled by explicit transposeWorking
    }
    renderAll();
  }

  function transposeWorking(fromTonic, toTonic) {
    const delta = (toTonic - fromTonic + 12) % 12;
    if (!delta) return;
    state.chords = state.chords.map((ch) => {
      const root = (ch.root + delta) % 12;
      const bass = ch.bassPc != null ? (ch.bassPc + delta) % 12 : root;
      let n = M().makeChord(root, ch.quality, {
        duration: ch.duration,
        roman: ch.roman,
        tag: ch.tag,
        region: ch.region,
      });
      if (C().withBass) n = C().withBass(n, bass);
      n.duration = ch.duration;
      n.roman = ch.roman;
      n.tag = ch.tag;
      n.region = ch.region;
      n.localTonic = toTonic;
      n.localMode = state.mode;
      return n;
    });
  }

  // ─── Operators ───────────────────────────────────────────
  function workingChords() {
    return state.chords;
  }

  function setWorking(chords, nameSuffix) {
    state.chords = chords;
    if (nameSuffix) state.name = (state.name.split(' · ')[0] || state.name) + ' · ' + nameSuffix;
    state.selected = Math.min(state.selected, Math.max(0, chords.length - 1));
    renderAll();
    playWorking({ once: true });
  }

  function saveVariation(label, chords) {
    const src = chords || state.chords;
    const id = nextId('var');
    const entry = {
      id,
      name: label || 'Variation',
      chords: src.map((c) => M().cloneChord(c)),
      fromPack: state.packId,
    };
    state.variations.unshift(entry);
    state.activeVar = id;
    return entry;
  }

  function opDarken() {
    // Prefer darker substitutes for middle chords
    const music = M();
    const t = state.tonic;
    const copy = state.chords.map((c) => music.cloneChord(c));
    if (copy.length < 2) return;
    const i = Math.min(2, copy.length - 1);
    // Try bVI, bII, bII7, iv depending on what's there
    const options = [
      music.makeChord((t + 8) % 12, 'maj', { region: 'interchange', roman: 'bVI', tag: 'darken' }),
      music.makeChord((t + 1) % 12, 'maj', { region: 'interchange', roman: 'bII', tag: 'darken' }),
      music.makeChord((t + 1) % 12, 'dom7', { region: 'tritone', roman: 'bII7', tag: 'darken' }),
      music.makeChord((t + 5) % 12, 'min', { region: 'diatonic', roman: 'iv', tag: 'darken' }),
      music.makeChord((t + 3) % 12, 'maj', { region: 'diatonic', roman: 'III', tag: 'darken' }),
    ];
    const cur = copy[i];
    const pick =
      options.find((o) => !(o.root === cur.root && o.quality === cur.quality)) || options[0];
    pick.duration = cur.duration;
    if (C().bestInversion && i > 0) {
      const best = C().bestInversion(copy[i - 1], pick);
      best.duration = cur.duration;
      best.roman = pick.roman;
      best.tag = 'darken';
      best.region = pick.region;
      copy[i] = best;
    } else copy[i] = pick;
    saveVariation('darken', copy);
    setWorking(copy, 'darken');
  }

  function opReharm3() {
    if (state.chords.length < 3) {
      opDarken();
      return;
    }
    const music = M();
    const t = state.tonic;
    const copy = state.chords.map((c) => music.cloneChord(c));
    const i = 2;
    const pool = [
      music.makeChord((t + 8) % 12, 'maj7', { roman: 'bVI', tag: 'reharm' }),
      music.makeChord((t + 10) % 12, 'maj', { roman: 'bVII', tag: 'reharm' }),
      music.makeChord((t + 5) % 12, 'min7', { roman: 'iv', tag: 'reharm' }),
      music.makeChord((t + 7) % 12, 'dom7', { roman: 'V7', tag: 'reharm' }),
      music.makeChord((t + 1) % 12, 'dom7', { roman: 'bII7', tag: 'reharm' }),
      music.makeChord((t + 4) % 12, 'maj', { roman: 'CM', tag: 'reharm', region: 'chromatic' }),
    ];
    const cur = copy[i];
    const pick = pool.find((o) => o.root !== cur.root || o.quality !== cur.quality) || pool[0];
    pick.duration = cur.duration;
    if (C().bestInversion && i > 0) {
      const best = C().bestInversion(copy[i - 1], pick);
      best.duration = cur.duration;
      best.roman = pick.roman;
      best.tag = 'reharm';
      copy[i] = best;
    } else copy[i] = pick;
    saveVariation('reharm 3', copy);
    setWorking(copy, 'reharm 3');
  }

  function opRhythm() {
    if (state.chords.length < 2) return;
    const pats = M().rhythmSuggestions(state.chords.length);
    const pat = pats.find((p) => new Set(p.beats).size > 1) || pats[0];
    const copy = M().applyRhythm(
      state.chords.map((c) => M().cloneChord(c)),
      pat.beats
    );
    saveVariation(pat.name, copy);
    setWorking(copy, pat.name);
  }

  function opSmooth() {
    if (!C().smoothCellVoicings) return;
    const copy = C().smoothCellVoicings(state.chords.map((c) => M().cloneChord(c)));
    saveVariation('smooth bass', copy);
    setWorking(copy, 'smooth');
  }

  function opOneChange() {
    if (C().varyOneChord) {
      const copy = C().varyOneChord(state.chords, state.tonic, state.mode);
      saveVariation('one change', copy);
      setWorking(copy, '1-chg');
    } else opDarken();
  }

  function suggestNext() {
    const host = $('#next-list');
    host.innerHTML = '';
    const from = state.chords[state.chords.length - 1] || null;
    const list = C().suggestNext
      ? C().suggestNext({
          fromChord: from,
          tonic: state.tonic,
          modeKey: state.mode,
          goalId: 'get_darker',
          count: 6,
          path: state.chords,
        })
      : [];
    list.forEach((s) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'next-chip';
      btn.innerHTML = `<strong>${s.chord.name}</strong><span>${s.jobLabel}</span>`;
      btn.title = `VL ${Math.round(s.vl * 100)}% · ${s.bassLabel}`;
      btn.addEventListener('mouseenter', () => {
        A().ensure();
        A().playChord({ chord: s.chord, prevMidi: null, soft: true, duration: 0.45 });
      });
      btn.addEventListener('click', () => {
        const ch = M().cloneChord(s.chord);
        ch.duration = 4;
        state.chords.push(ch);
        state.selected = state.chords.length - 1;
        renderAll();
        A().ensure();
        A().playChord({ chord: ch });
      });
      host.appendChild(btn);
    });
  }

  function showWaysHome() {
    const host = $('#ways-list');
    host.innerHTML = '';
    const from = state.chords[state.chords.length - 1];
    if (!from) {
      host.innerHTML = '<p class="hint">Load a pack first.</p>';
      return;
    }
    const routes = M().waysBackHome(from, state.tonic, state.mode, 5);
    routes.forEach((r) => {
      const card = document.createElement('div');
      card.className = 'way';
      card.innerHTML = `
        <div class="way-top"><strong>${r.name}</strong><em>${r.character}</em></div>
        <div class="way-path">${r.chords.map((c) => c.name).join(' → ')}</div>
        <div class="way-btns">
          <button type="button" class="btn ghost prev">Hear</button>
          <button type="button" class="btn primary use">Use as ending</button>
        </div>
      `;
      card.querySelector('.prev').addEventListener('click', () => {
        A().ensure();
        A().playSequence(r.chords, state.bpm, { pulse: state.pulse });
      });
      card.querySelector('.use').addEventListener('click', () => {
        // Replace last chord stretch with route, or append
        const base = state.chords.slice(0, -1).map((c) => M().cloneChord(c));
        r.chords.forEach((c) => {
          const ch = M().cloneChord(c);
          ch.duration = c.duration || 2;
          base.push(ch);
        });
        saveVariation('ways home', base);
        setWorking(base, 'home');
      });
      host.appendChild(card);
    });
  }

  // ─── Playback ────────────────────────────────────────────
  function playWorking(opts) {
    A().ensure();
    if (A().isPlaying()) {
      A().stopPlayback();
      updatePlayBtn();
      highlightPlay(-1);
      return;
    }
    if (!state.chords.length) return;
    const once = opts && opts.once;
    A().playSequence(state.chords, state.bpm, {
      loop: once ? false : state.loop,
      pulse: state.pulse,
      onStep: (i) => {
        highlightPlay(i);
        state.selected = i;
        renderSlots();
      },
      onEnd: () => {
        highlightPlay(-1);
        updatePlayBtn();
      },
    });
    updatePlayBtn();
  }

  function updatePlayBtn() {
    const btn = $('#btn-play');
    if (!btn) return;
    btn.textContent = A().isPlaying() ? 'Stop' : state.loop ? 'Loop' : 'Play';
    btn.classList.toggle('playing', A().isPlaying());
  }

  function highlightPlay(i) {
    document.querySelectorAll('.slot').forEach((el, idx) => {
      el.classList.toggle('playing', idx === i);
    });
  }

  // ─── Export ──────────────────────────────────────────────
  function exportText() {
    const lines = [
      `Dark Harmony — ${state.name}`,
      `Key: ${keyLabel()} · ${state.bpm} BPM`,
      `Pack: ${state.packId || 'custom'}`,
      '',
      M().formatChordList(state.chords, state.bpm),
    ];
    const pack = P().getPack(state.packId);
    if (pack) {
      lines.push('', 'Why: ' + pack.why);
    }
    const text = lines.join('\n');
    download(new Blob([text], { type: 'text/plain' }), slug(state.name) + '.txt');
    $('#export-out').value = text;
  }

  function exportMidi() {
    if (!state.chords.length) return;
    const bytes = buildMidi(state.chords, state.bpm);
    download(new Blob([bytes], { type: 'audio/midi' }), slug(state.name) + '.mid');
  }

  function sendFretboard() {
    const payload = {
      source: 'dark-harmony',
      tonic: M().noteName(state.tonic),
      mode: state.mode,
      bpm: state.bpm,
      name: state.name,
      chords: state.chords.map((c) => ({
        name: c.name,
        root: M().noteName(c.root),
        quality: c.quality,
        bass: M().noteName(c.bassPc != null ? c.bassPc : c.root),
        notes: c.notes.map((n) => M().noteName(n)),
        duration: c.duration,
        roman: c.roman,
      })),
    };
    try {
      localStorage.setItem('hl_to_fretboard', JSON.stringify(payload));
    } catch (_) {}
    $('#export-out').value = JSON.stringify(payload, null, 2);
    window.open('../fretboard/index.html', '_blank');
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }

  function slug(s) {
    return String(s || 'cell')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function buildMidi(chords, bpm) {
    const ticksPerBeat = 480;
    const micro = Math.round(60000000 / bpm);
    const events = [
      { tick: 0, data: [0xff, 0x51, 0x03, (micro >> 16) & 0xff, (micro >> 8) & 0xff, micro & 0xff] },
    ];
    let tick = 0;
    let prev = null;
    chords.forEach((ch) => {
      const midi = M().voiceLead(ch, prev, 3);
      prev = midi;
      const dur = Math.max(1, Math.round((ch.duration || 4) * ticksPerBeat));
      midi.forEach((n, i) => events.push({ tick, data: [0x90, n, i === 0 ? 95 : 72] }));
      midi.forEach((n) => events.push({ tick: tick + dur, data: [0x80, n, 0] }));
      tick += dur;
    });
    events.push({ tick, data: [0xff, 0x2f, 0x00] });
    events.sort((a, b) => a.tick - b.tick);
    const track = [];
    let last = 0;
    events.forEach((ev) => {
      writeVar(track, ev.tick - last);
      last = ev.tick;
      ev.data.forEach((b) => track.push(b));
    });
    const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (ticksPerBeat >> 8) & 0xff, ticksPerBeat & 0xff];
    const th = [
      0x4d, 0x54, 0x72, 0x6b,
      (track.length >> 24) & 0xff, (track.length >> 16) & 0xff, (track.length >> 8) & 0xff, track.length & 0xff,
    ];
    return new Uint8Array([...header, ...th, ...track]);
  }

  function writeVar(arr, value) {
    let buffer = value & 0x7f;
    while ((value >>= 7)) {
      buffer <<= 8;
      buffer |= (value & 0x7f) | 0x80;
    }
    for (;;) {
      arr.push(buffer & 0xff);
      if (buffer & 0x80) buffer >>= 8;
      else break;
    }
  }

  // ─── Render ──────────────────────────────────────────────
  function renderAll() {
    renderPackList();
    renderSlots();
    renderMeta();
    renderVariations();
    suggestNext();
    showWaysHome();
    updatePlayBtn();
  }

  function renderPackList() {
    const host = $('#pack-list');
    host.innerHTML = '';
    const packs = P().packsByColour(state.colourFilter);
    packs.forEach((pack) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'pack' + (pack.id === state.packId && state.activeVar == null ? ' active' : '');
      card.innerHTML = `
        <span class="pack-name">${pack.name}</span>
        <span class="pack-colour">${pack.colour}</span>
        <span class="pack-why">${pack.why}</span>
      `;
      card.addEventListener('click', () => loadPack(pack.id));
      host.appendChild(card);
    });
  }

  function renderSlots() {
    const host = $('#slots');
    host.innerHTML = '';
    state.chords.forEach((ch, i) => {
      const slot = document.createElement('div');
      slot.className =
        'slot' + (i === state.selected ? ' selected' : '') + (i === state.selected ? '' : '');
      slot.innerHTML = `
        <div class="slot-idx">${i + 1}</div>
        <div class="slot-name">${ch.name}</div>
        <div class="slot-roman">${ch.roman || ''}</div>
        <div class="slot-dur">${ch.duration}b</div>
        <input type="range" class="slot-dur-slider" min="1" max="16" step="0.5" value="${ch.duration}" aria-label="Duration" />
        <button type="button" class="slot-x" title="Remove">×</button>
      `;
      slot.addEventListener('click', (e) => {
        if (e.target.classList.contains('slot-x') || e.target.classList.contains('slot-dur-slider')) return;
        state.selected = i;
        A().ensure();
        A().playChord({ chord: ch });
        renderSlots();
      });
      slot.querySelector('.slot-x').addEventListener('click', (e) => {
        e.stopPropagation();
        state.chords.splice(i, 1);
        state.selected = Math.min(i, state.chords.length - 1);
        renderAll();
      });
      slot.querySelector('.slot-dur-slider').addEventListener('input', (e) => {
        e.stopPropagation();
        state.chords[i] = M().withDuration(state.chords[i], parseFloat(e.target.value));
        slot.querySelector('.slot-dur').textContent = e.target.value + 'b';
      });
      host.appendChild(slot);
    });
    const line = state.chords.map((c) => c.name).join('  →  ');
    const pathEl = $('#path-line');
    if (pathEl) pathEl.textContent = line || '—';
  }

  function renderMeta() {
    const pack = P().getPack(state.packId);
    $('#working-title').textContent = state.name;
    $('#working-key').textContent = keyLabel();
    $('#working-why').textContent = pack && state.activeVar == null ? pack.why : 'Your variation — mutate further or export.';
    $('#bpm').value = state.bpm;
    $('#loop').checked = state.loop;
    $('#pulse').checked = state.pulse;
  }

  function renderVariations() {
    const host = $('#var-list');
    if (!host) return;
    host.innerHTML = '';
    if (!state.variations.length) {
      host.innerHTML = '<p class="hint">Mutations land here as forks. Click to restore.</p>';
      return;
    }
    state.variations.forEach((v) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'var-chip' + (state.activeVar === v.id ? ' active' : '');
      b.textContent = v.name;
      b.addEventListener('click', () => {
        state.chords = v.chords.map((c) => M().cloneChord(c));
        state.name = v.name;
        state.activeVar = v.id;
        state.selected = 0;
        renderAll();
        playWorking({ once: true });
      });
      host.appendChild(b);
    });
  }

  // ─── Wire ────────────────────────────────────────────────
  function wire() {
    $('#tonic').addEventListener('change', (e) => {
      const prev = state.tonic;
      const next = parseInt(e.target.value, 10);
      if (state.activeVar != null || state.chords.length) {
        // Transpose working progression when key changes (explicit musical intent)
        transposeWorking(prev, next);
      }
      state.tonic = next;
      // If still on a pure pack with no custom var, re-seed from pack
      if (state.activeVar == null && state.packId) {
        const pack = P().getPack(state.packId);
        if (pack) state.chords = P().materialize(pack, state.tonic, state.mode);
      }
      renderAll();
    });
    $('#mode').addEventListener('change', (e) => {
      state.mode = e.target.value;
      if (state.activeVar == null && state.packId) {
        const pack = P().getPack(state.packId);
        if (pack) state.chords = P().materialize(pack, state.tonic, state.mode);
      }
      renderAll();
    });
    $('#colour-filter').addEventListener('change', (e) => {
      state.colourFilter = e.target.value;
      renderPackList();
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

    $('#btn-play').addEventListener('click', () => playWorking());
    $('#btn-darken').addEventListener('click', opDarken);
    $('#btn-reharm').addEventListener('click', opReharm3);
    $('#btn-rhythm').addEventListener('click', opRhythm);
    $('#btn-smooth').addEventListener('click', opSmooth);
    $('#btn-one').addEventListener('click', opOneChange);
    $('#btn-export-txt').addEventListener('click', exportText);
    $('#btn-export-mid').addEventListener('click', exportMidi);
    $('#btn-fretboard').addEventListener('click', sendFretboard);
    $('#btn-duplicate').addEventListener('click', () => {
      saveVariation(state.name + ' copy');
      renderVariations();
    });

    document.addEventListener('keydown', (e) => {
      if (e.target.matches('input, textarea, select')) return;
      if (e.key === ' ') {
        e.preventDefault();
        playWorking();
      } else if (e.key === 'd') opDarken();
      else if (e.key === 'r') opReharm3();
      else if (e.key === 't') opRhythm();
      else if (e.key === 'Escape') {
        A().stopPlayback();
        updatePlayBtn();
        highlightPlay(-1);
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
