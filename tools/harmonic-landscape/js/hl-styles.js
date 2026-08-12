/**
 * hl-styles.js — Style lens (rock / goth / shoegaze / jazz…) + demos
 * Filters In-this-key colours, right-click menus, and next-move ranking.
 */
(function (global) {
  'use strict';
  var H = global.HLApp;
  if (!H) throw new Error('HLApp missing - load hl-core.js first');

  /**
   * Each style: map defaults, colour priorities (tags), degree move boosts,
   * right-click quality order, demo hooks.
   */
  H.STYLES = {
    neutral: {
      id: 'neutral',
      label: 'Neutral',
      blurb: 'Balanced diatonic + open palette',
      map: { dominants: true, borrow: true, coloursOnMap: false },
      // Higher = earlier in colour menus / map accents
      colourTags: {
        'subdom sus': 0.7,
        'dom sus': 0.55,
        'bright II': 0.6,
        'dorian ii': 0.55,
        'tonic colour': 0.5,
        'supertonic 7': 0.5,
        'subdom colour': 0.55,
        'submed colour': 0.5,
        'maj7 colour': 0.55,
        'add9 colour': 0.5,
        'sus2 colour': 0.65,
        'bII': 0.45,
        'power': 0.3,
      },
      nextBoost: {}, // roman → boost
      qualities: ['maj', 'min', 'dom7', 'maj7', 'min7', 'sus4', 'sus2', 'dim', 'halfdim', 'add9'],
    },
    classical: {
      id: 'classical',
      label: 'Classical',
      blurb: 'I–IV–V, cadences, dim, restrained colour',
      map: { dominants: true, borrow: false, coloursOnMap: false },
      colourTags: {
        'bright II': 0.25,
        'subdom sus': 0.2,
        'dom sus': 0.2,
        'tonic colour': 0.35,
        'supertonic 7': 0.4,
        'bII': 0.1,
      },
      nextBoost: { I: 0.12, i: 0.12, V: 0.15, 'V7': 0.18, IV: 0.1, iv: 0.08, ii: 0.1, 'ii°': 0.08, vi: 0.06 },
      qualities: ['maj', 'min', 'dom7', 'dim', 'dim7', 'halfdim', 'maj7', 'min7'],
    },
    jazz: {
      id: 'jazz',
      label: 'Jazz',
      blurb: '7ths/9ths, ii–V, tritone colour',
      map: { dominants: true, borrow: true, coloursOnMap: false },
      colourTags: {
        'supertonic 7': 0.95,
        'tonic colour': 0.9,
        'submed colour': 0.85,
        'subdom colour': 0.85,
        'maj7 colour': 0.9,
        'bright II': 0.5,
        'subdom sus': 0.4,
      },
      nextBoost: { ii: 0.14, 'ii°': 0.1, V: 0.16, 'V7': 0.2, I: 0.1, i: 0.1, vi: 0.08 },
      qualities: ['maj7', 'min7', 'dom7', 'halfdim', 'dim7', 'min9', 'maj9', 'minmaj7', 'maj', 'min'],
    },
    blues: {
      id: 'blues',
      label: 'Blues',
      blurb: 'I7–IV7–V7, dominant home colour',
      map: { dominants: true, borrow: false, coloursOnMap: false },
      colourTags: {
        'dom sus': 0.85,
        'subdom sus': 0.7,
        'tonic colour': 0.6,
        'bright II': 0.35,
      },
      nextBoost: { I: 0.1, i: 0.1, IV: 0.14, iv: 0.12, V: 0.16, 'V7': 0.2 },
      qualities: ['dom7', 'maj', 'min', 'sus4', 'dom7', 'min7'],
    },
    rock: {
      id: 'rock',
      label: 'Rock',
      blurb: 'sus, ♭VII, bright II, stepwise bass',
      map: { dominants: false, borrow: true, coloursOnMap: false },
      colourTags: {
        'subdom sus': 0.95,
        'sus2 colour': 0.95,
        'dom sus': 0.8,
        'bright II': 0.88,
        'bII': 0.55,
        'add9 colour': 0.6,
        'power': 0.7,
      },
      nextBoost: { '♭VII': 0.12, VII: 0.1, IV: 0.1, iv: 0.1, I: 0.08, i: 0.1, 'III': 0.08, V: 0.06 },
      qualities: ['maj', 'min', 'sus2', 'sus4', 'dom7', 'add9', 'min7'],
    },
    goth: {
      id: 'goth',
      label: 'Goth',
      blurb: 'i–VI–III, Asus2, F#–F walk-down (Speed of Pain…)',
      map: { dominants: false, borrow: true, coloursOnMap: false },
      colourTags: {
        'sus2 colour': 0.98,
        'subdom sus': 0.85,
        'bright II': 0.95,
        'bII': 0.98,
        'maj7 colour': 0.9,
        'subdom colour': 0.75,
        'tonic colour': 0.55,
      },
      nextBoost: {
        VI: 0.14,
        '♭VI': 0.12,
        'III': 0.12,
        '♭III': 0.1,
        i: 0.1,
        iv: 0.1,
        VII: 0.08,
        '♭VII': 0.08,
      },
      qualities: ['min', 'maj', 'sus2', 'maj7', 'min7', 'sus4', 'dom7'],
      packs: ['speed-of-pain'],
    },
    metal: {
      id: 'metal',
      label: 'Metal',
      blurb: 'i–♭II–♭VI–♭VII, power, chromatic mediants',
      map: { dominants: false, borrow: true, coloursOnMap: false },
      colourTags: {
        'bII': 0.98,
        'power': 0.95,
        'bright II': 0.7,
        'subdom sus': 0.4,
      },
      nextBoost: {
        i: 0.1,
        '♭II': 0.16,
        '♭VI': 0.14,
        '♭VII': 0.14,
        'VI': 0.1,
        'III': 0.08,
      },
      qualities: ['min', 'maj', 'dim', 'dom7', 'sus4'],
    },
    shoegaze: {
      id: 'shoegaze',
      label: 'Shoegaze',
      blurb: 'add9, maj7 haze, sus drones, I–IV–♭VII float',
      map: { dominants: false, borrow: true, coloursOnMap: false },
      colourTags: {
        'add9 colour': 0.98,
        'maj7 colour': 0.98,
        'sus2 colour': 0.95,
        'subdom sus': 0.9,
        'dom sus': 0.75,
        'tonic colour': 0.7,
        'submed colour': 0.65,
        'bright II': 0.35,
        'bII': 0.25,
      },
      nextBoost: {
        I: 0.12,
        i: 0.1,
        IV: 0.14,
        iv: 0.12,
        '♭VII': 0.14,
        VII: 0.1,
        vi: 0.1,
        VI: 0.1,
        V: 0.04,
      },
      qualities: ['add9', 'maj7', 'sus2', 'sus4', 'maj', 'min', 'min7', 'maj9'],
    },
  };

  /** Demo sequences (write-home + chords as {root, quality, duration?, roman?}) */
  H.STYLE_DEMOS = {
    'speed-of-pain': {
      id: 'speed-of-pain',
      label: 'Speed of Pain (Manson)',
      style: 'goth',
      tonic: 4, // E
      mode: 'minor',
      bpm: 72,
      blurb: 'Em–C loop · Asus2 · G–F#–F→Em descent — goth colours in Em',
      // Em C Em C Em Asus2 Em G F# F Em
      chords: [
        { root: 4, quality: 'min', duration: 2, roman: 'i' },
        { root: 0, quality: 'maj', duration: 2, roman: 'VI' },
        { root: 4, quality: 'min', duration: 2, roman: 'i' },
        { root: 0, quality: 'maj', duration: 2, roman: 'VI' },
        { root: 4, quality: 'min', duration: 2, roman: 'i' },
        { root: 9, quality: 'sus2', duration: 2, roman: 'iv sus2' },
        { root: 4, quality: 'min', duration: 2, roman: 'i' },
        { root: 7, quality: 'maj', duration: 1, roman: 'III' },
        { root: 6, quality: 'maj', duration: 1, roman: 'II' },
        { root: 5, quality: 'maj', duration: 1, roman: '♭II' },
        { root: 4, quality: 'min', duration: 2, roman: 'i' },
      ],
    },
  };

  H.getStyleId = function () {
    const id = (H.state && H.state.style) || 'neutral';
    return H.STYLES[id] ? id : 'neutral';
  };

  H.getStyle = function () {
    return H.STYLES[H.getStyleId()] || H.STYLES.neutral;
  };

  H.setStyle = function (id, opts) {
    opts = opts || {};
    if (!H.STYLES[id]) id = 'neutral';
    H.state.style = id;
    try {
      localStorage.setItem('hl-style', id);
    } catch (_) {
      /* ignore */
    }
    const st = H.getStyle();
    // Apply map layer defaults from style (user can still toggle after)
    if (!opts.skipMapDefaults && st.map) {
      if (!H.state.functionOpts) H.state.functionOpts = {};
      if (st.map.dominants != null) H.state.functionOpts.dominants = !!st.map.dominants;
      if (st.map.borrow != null) H.state.functionOpts.borrow = !!st.map.borrow;
      // Colours on map: style default (usually off — right-click owns colours)
      if (st.map.coloursOnMap != null) {
        H.state.functionOpts.colours = !!st.map.coloursOnMap;
      }
    }
    if (H.syncFunctionOptsUI) H.syncFunctionOptsUI();
    if (H.syncStyleUI) H.syncStyleUI();
    if (H.map && H.map.mapView === 'function' && H.refreshMap) H.refreshMap();
    else if (H.refreshUI) H.refreshUI();
    if (!opts.silent) {
      H.setSyncStatus(
        'Style · ' + st.label + (st.blurb ? ' — ' + st.blurb : '')
      );
    }
  };

  H.initStyleFromStorage = function () {
    let id = 'neutral';
    try {
      id = localStorage.getItem('hl-style') || id;
    } catch (_) {
      /* ignore */
    }
    if (!H.STYLES[id]) id = 'neutral';
    H.state.style = id;
  };

  /** Score a colour tag for current style (0–1) */
  H.styleColourWeight = function (tag) {
    const st = H.getStyle();
    const t = String(tag || '');
    if (st.colourTags && st.colourTags[t] != null) return st.colourTags[t];
    // fuzzy
    for (const k of Object.keys(st.colourTags || {})) {
      if (t.indexOf(k) >= 0 || k.indexOf(t) >= 0) return st.colourTags[k];
    }
    return 0.35;
  };

  /** Boost for next-move / aim by roman label */
  H.styleNextBoost = function (roman) {
    const st = H.getStyle();
    const r = String(roman || '');
    if (st.nextBoost && st.nextBoost[r] != null) return st.nextBoost[r];
    return 0;
  };

  /**
   * Extra in-key colour chords for a style (beyond base palette).
   * Returns makeChord-ready specs relative to tonic/mode.
   */
  H.styleExtraColours = function (tonic, modeKey) {
    const music = H.M();
    const t = music.pc ? music.pc(tonic) : ((tonic % 12) + 12) % 12;
    const mode = modeKey || H.state.mode || 'minor';
    const isMin =
      music.MODES && music.MODES[mode]
        ? music.MODES[mode].romanBase === 'minor'
        : mode === 'minor';
    const preferFlat = music.keyPrefersFlat ? music.keyPrefersFlat(t, mode) : isMin;
    const id = H.getStyleId();
    const out = [];
    const add = (deg, q, roman, tag, region) => {
      out.push(
        music.makeChord((t + deg) % 12, q, {
          region: region || 'flavour',
          roman: roman,
          tag: tag,
          preferFlat,
        })
      );
    };

    // Shared rock/goth/metal/shoegaze paints
    if (id === 'rock' || id === 'goth' || id === 'metal' || id === 'shoegaze') {
      add(5, 'sus2', isMin ? 'iv sus2' : 'IV sus2', 'sus2 colour', 'flavour');
    }
    if (id === 'goth' || id === 'metal' || id === 'rock') {
      // ♭II major (F in Em) — Speed of Pain walk
      add(1, 'maj', '♭II', 'bII', 'chromatic');
    }
    if (id === 'goth' || id === 'shoegaze') {
      // VI maj7 haze (Cmaj7 in Em = tonic+8)
      if (isMin) add(8, 'maj7', 'VI maj7', 'maj7 colour', 'flavour');
      else add(9, 'min7', 'vi7', 'submed colour', 'flavour');
    }
    if (id === 'shoegaze') {
      add(0, 'add9', isMin ? 'i add9' : 'I add9', 'add9 colour', 'flavour');
      add(0, 'maj7', isMin ? 'I colour' : 'I maj7', 'maj7 colour', 'flavour');
      add(5, 'add9', isMin ? 'iv add9' : 'IV add9', 'add9 colour', 'flavour');
      add(10, 'maj', isMin ? '♭VII' : '♭VII', 'modal', 'interchange');
    }
    if (id === 'metal') {
      add(1, 'min', '♭ii', 'bII', 'chromatic');
      add(0, 'min', 'i', 'power', 'flavour');
    }
    if (id === 'blues') {
      add(0, 'dom7', isMin ? 'i7' : 'I7', 'tonic colour', 'flavour');
      add(5, 'dom7', isMin ? 'iv7' : 'IV7', 'subdom colour', 'flavour');
      add(7, 'dom7', 'V7', 'dom colour', 'diatonic');
    }
    if (id === 'jazz') {
      add(0, 'maj9', isMin ? 'i colour' : 'Imaj9', 'tonic colour', 'flavour');
      add(2, 'min7', 'ii7', 'supertonic 7', 'flavour');
      add(2, 'halfdim', 'iiø', 'supertonic 7', 'flavour');
    }
    // Deduplicate by root:quality
    const seen = new Set();
    return out.filter((c) => {
      const k = c.root + ':' + c.quality;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };

  /**
   * Colours for right-click on a degree (root pc), style-sorted.
   */
  H.coloursForRoot = function (rootPc, opts) {
    opts = opts || {};
    const music = H.M();
    const key = opts.key || (H.writeKey ? H.writeKey() : { tonic: H.state.tonic, mode: H.state.mode });
    const t = key.tonic;
    const mode = key.mode;
    const preferFlat = music.keyPrefersFlat ? music.keyPrefersFlat(t, mode) : false;
    const root = music.pc ? music.pc(rootPc) : ((rootPc % 12) + 12) % 12;
    const st = H.getStyle();
    const list = [];

    const push = (q, roman, tag, region) => {
      const ch = music.makeChord(root, q, {
        region: region || 'flavour',
        roman: roman || '',
        tag: tag || 'colour',
        preferFlat,
        duration: H.stepDuration ? H.stepDuration() : 4,
      });
      if (H.stampKey) H.stampKey(ch, key);
      const w = H.styleColourWeight(tag || q);
      list.push({
        chord: ch,
        label: ch.name,
        roman: roman || '',
        tag: tag || '',
        weight: w,
      });
    };

    // Always offer triad family for this root
    const isMinHome =
      music.MODES && music.MODES[mode]
        ? music.MODES[mode].romanBase === 'minor'
        : mode === 'minor';
    // Diatonic default for this root if on scale
    let diatQ = null;
    let diatRoman = '';
    if (music.diatonicChords) {
      const diat = music.diatonicChords(t, mode, false);
      const hit = diat.find((c) => c.root === root);
      if (hit) {
        diatQ = hit.quality;
        diatRoman = hit.roman || '';
      }
    }
    if (diatQ) push(diatQ, diatRoman, 'diatonic', 'diatonic');

    // Style qualities on this root
    const qs = (st.qualities || []).slice();
    // Common colour extras by style
    const styleId = st.id;
    if (styleId === 'rock' || styleId === 'goth' || styleId === 'shoegaze') {
      qs.push('sus2', 'sus4', 'add9', 'maj7');
    }
    if (styleId === 'goth' || styleId === 'metal') qs.push('maj'); // allow F# maj, F maj
    if (styleId === 'jazz') qs.push('maj7', 'min7', 'dom7', 'halfdim', 'maj9', 'min9');
    if (styleId === 'blues') qs.push('dom7', 'sus4');
    if (styleId === 'shoegaze') qs.push('add9', 'maj7', 'maj9', 'sus2');

    const seen = new Set(list.map((x) => x.chord.quality));
    qs.forEach((q) => {
      if (!music.QUALITIES[q] || seen.has(q)) return;
      seen.add(q);
      let tag = 'colour';
      if (q === 'sus2') tag = 'sus2 colour';
      else if (q === 'sus4') tag = 'subdom sus';
      else if (q === 'add9' || q === 'maj9') tag = 'add9 colour';
      else if (q === 'maj7') tag = 'maj7 colour';
      else if (q === 'dom7') tag = 'dom colour';
      else if (q === 'min7') tag = 'tonic colour';
      push(q, diatRoman || '', tag, 'flavour');
    });

    // Degree-specific: if root is 2nd degree, offer bright II maj
    const deg = ((root - (music.pc ? music.pc(t) : t) + 12) % 12);
    if (deg === 2) {
      if (!seen.has('maj')) {
        seen.add('maj');
        push('maj', 'II', 'bright II', 'chromatic');
      }
      if (!seen.has('dim')) {
        seen.add('dim');
        push('dim', 'ii°', 'diatonic', 'diatonic');
      }
    }
    if (deg === 1) {
      if (!seen.has('maj')) {
        seen.add('maj');
        push('maj', '♭II', 'bII', 'chromatic');
      }
    }
    if (deg === 5) {
      if (!seen.has('sus2')) {
        seen.add('sus2');
        push('sus2', isMinHome ? 'iv sus2' : 'IV sus2', 'sus2 colour', 'flavour');
      }
      if (!seen.has('sus4')) {
        seen.add('sus4');
        push('sus4', isMinHome ? 'iv sus' : 'IV sus', 'subdom sus', 'flavour');
      }
    }

    list.sort((a, b) => (b.weight || 0) - (a.weight || 0));
    // Cap menu length
    return list.slice(0, opts.limit || 10);
  };

  /**
   * Strong next moves for right-click (style-ranked diatonic + top colours).
   */
  H.styleNextMoves = function (fromChord, opts) {
    opts = opts || {};
    const music = H.M();
    const key = opts.key || (H.writeKey ? H.writeKey() : { tonic: H.state.tonic, mode: H.state.mode });
    const diat = music.diatonicChords
      ? music.diatonicChords(key.tonic, key.mode, false)
      : [];
    const moves = [];
    diat.forEach((ch) => {
      if (fromChord && ch.root === fromChord.root && ch.quality === fromChord.quality) return;
      let w = 0.45;
      if (H.scoreDegreeProgression) {
        w = H.scoreDegreeProgression(fromChord, ch, key.tonic, key.mode);
      }
      w += H.styleNextBoost(ch.roman) || 0;
      const c = music.cloneChord ? music.cloneChord(ch) : { ...ch };
      c.duration = H.stepDuration ? H.stepDuration() : 4;
      if (H.stampKey) H.stampKey(c, key);
      moves.push({
        chord: c,
        label: (ch.roman ? ch.roman + ' · ' : '') + ch.name,
        roman: ch.roman || '',
        weight: w,
        kind: 'diatonic',
      });
    });
    // Style extras as next options (e.g. Asus2, F)
    H.styleExtraColours(key.tonic, key.mode).forEach((ch) => {
      if (fromChord && ch.root === fromChord.root && ch.quality === fromChord.quality) return;
      let w = 0.4 + H.styleColourWeight(ch.tag) * 0.45;
      if (H.scoreDegreeProgression) {
        w = Math.max(w, H.scoreDegreeProgression(fromChord, ch, key.tonic, key.mode) * 0.85);
      }
      const c = music.cloneChord ? music.cloneChord(ch) : { ...ch };
      c.duration = H.stepDuration ? H.stepDuration() : 4;
      if (H.stampKey) H.stampKey(c, key);
      moves.push({
        chord: c,
        label: (ch.roman ? ch.roman + ' · ' : '') + ch.name,
        roman: ch.roman || '',
        weight: w,
        kind: 'colour',
        tag: ch.tag,
      });
    });
    moves.sort((a, b) => (b.weight || 0) - (a.weight || 0));
    return moves.slice(0, opts.limit || 8);
  };

  /** Goth pack: G–F#–F–Em descent */
  H.stylePacksForChord = function (fromChord) {
    const music = H.M();
    const key = H.writeKey ? H.writeKey() : { tonic: H.state.tonic, mode: H.state.mode };
    const t = key.tonic;
    const mode = key.mode;
    const isMin =
      music.MODES && music.MODES[mode]
        ? music.MODES[mode].romanBase === 'minor'
        : mode === 'minor';
    const packs = [];
    const styleId = H.getStyleId();

    if (styleId === 'goth' || styleId === 'rock' || styleId === 'metal') {
      // Walk-down ♭III/III – II – ♭II – i (in Em: G F# F Em)
      const III = (t + (isMin ? 3 : 4)) % 12; // minor: bIII=3, wait Em III is G = t+3
      // Em: G=7, F#=6, F=5, E=4 — from tonic: +3, +2, +1, 0 for minor III is major 3rd = 3? 
      // E=4, G=7 → +3 which is minor third = bIII in major but III in minor (G major)
      const degIII = isMin ? 3 : 4; // actually G from E is 3 semitones
      // Use absolute for Em descent relative to tonic
      const roots = [(t + 3) % 12, (t + 2) % 12, (t + 1) % 12, t];
      const quals = ['maj', 'maj', 'maj', isMin ? 'min' : 'maj'];
      const romans = [isMin ? 'III' : 'bIII', 'II', '♭II', isMin ? 'i' : 'I'];
      const route = roots.map((r, i) => {
        const ch = music.makeChord(r, quals[i], {
          region: i === 3 ? 'diatonic' : 'chromatic',
          roman: romans[i],
          tag: 'descent',
          duration: i === 3 ? 2 : 1,
        });
        if (H.stampKey) H.stampKey(ch, key);
        return ch;
      });
      packs.push({
        id: 'descent-bII',
        label: 'Descent · ' + route.map((c) => c.name).join(' → '),
        job: 'chromatic walk into home',
        route: route,
      });
    }
    if (styleId === 'goth' || styleId === 'rock') {
      // i – VI – i – iv sus2
      const i = music.makeChord(t, isMin ? 'min' : 'maj', { roman: isMin ? 'i' : 'I', region: 'diatonic' });
      const VI = music.makeChord((t + 8) % 12, 'maj', { roman: isMin ? 'VI' : 'bVI', region: 'diatonic' });
      const sus = music.makeChord((t + 5) % 12, 'sus2', { roman: isMin ? 'iv sus2' : 'IV sus2', region: 'flavour', tag: 'sus2 colour' });
      [i, VI, sus].forEach((c) => {
        c.duration = 2;
        if (H.stampKey) H.stampKey(c, key);
      });
      packs.push({
        id: 'vi-sus-loop',
        label: i.name + ' · ' + VI.name + ' · ' + sus.name,
        job: 'VI + sus hang',
        route: [i, VI, i, sus],
      });
    }
    if (styleId === 'shoegaze') {
      const I = music.makeChord(t, isMin ? 'min' : 'add9', {
        roman: isMin ? 'i' : 'I add9',
        region: 'flavour',
        tag: 'add9 colour',
      });
      const IV = music.makeChord((t + 5) % 12, 'add9', {
        roman: isMin ? 'iv add9' : 'IV add9',
        region: 'flavour',
        tag: 'add9 colour',
      });
      const bVII = music.makeChord((t + 10) % 12, 'maj', {
        roman: '♭VII',
        region: 'interchange',
      });
      [I, IV, bVII].forEach((c) => {
        c.duration = 4;
        if (H.stampKey) H.stampKey(c, key);
      });
      packs.push({
        id: 'haze-loop',
        label: I.name + ' – ' + IV.name + ' – ' + bVII.name,
        job: 'shoegaze float',
        route: [I, IV, bVII, I],
      });
    }
    if (styleId === 'jazz') {
      const ii = music.makeChord((t + 2) % 12, isMin ? 'halfdim' : 'min7', {
        roman: isMin ? 'iiø' : 'ii7',
        region: 'diatonic',
      });
      const V7 = music.makeChord((t + 7) % 12, 'dom7', { roman: 'V7', region: 'diatonic' });
      const I = music.makeChord(t, isMin ? 'min7' : 'maj7', {
        roman: isMin ? 'i7' : 'Imaj7',
        region: 'diatonic',
      });
      [ii, V7, I].forEach((c) => {
        c.duration = 2;
        if (H.stampKey) H.stampKey(c, key);
      });
      packs.push({
        id: 'ii-v-i',
        label: ii.name + ' → ' + V7.name + ' → ' + I.name,
        job: 'ii–V–I',
        route: [ii, V7, I],
      });
    }
    return packs;
  };

  H.loadStyleDemo = function (demoId) {
    const demo = H.STYLE_DEMOS[demoId];
    if (!demo) {
      H.setSyncStatus('Demo not found');
      return;
    }
    if (H.pushUndo) H.pushUndo();
    if (demo.style) H.setStyle(demo.style, { silent: true, skipMapDefaults: false });
    if (H.setWritingHome) {
      H.setWritingHome(demo.tonic, demo.mode, { transpose: false, skipEdit: true });
    } else {
      H.state.tonic = demo.tonic;
      H.state.mode = demo.mode;
    }
    if (demo.bpm) H.state.bpm = demo.bpm;
    const music = H.M();
    H.state.chords = demo.chords.map((spec) => {
      let ch = music.makeChord(spec.root, spec.quality, {
        duration: spec.duration != null ? spec.duration : 2,
        region: spec.region || 'diatonic',
        roman: spec.roman || '',
        tag: 'demo',
      });
      if (H.stampKey) H.stampKey(ch, { tonic: demo.tonic, mode: demo.mode });
      return ch;
    });
    H.state.selected = 0;
    H.state.title = demo.label;
    H.state.nameLocked = true;
    H.state.fromPackId = null;
    if (H.afterEdit) H.afterEdit();
    if (H.setMapView) H.setMapView('function');
    H.setSyncStatus(
      'Demo · ' + demo.label + (demo.blurb ? ' — ' + demo.blurb : '') + ' · style ' + (H.getStyle().label || '')
    );
    if (H.A()) {
      H.A().ensure();
      if (H.state.chords[0]) H.A().playChord({ chord: H.state.chords[0], soft: true, duration: 0.5 });
    }
  };

  // ---
})(typeof window !== 'undefined' ? window : globalThis);
