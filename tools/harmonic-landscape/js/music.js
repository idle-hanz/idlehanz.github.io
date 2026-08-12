/**
 * Harmonic Landscape — music theory engine
 * Keys, chords, diatonic/exotic palettes, voice-leading, ways-back-home.
 */
(function (global) {
  'use strict';

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

  const QUALITIES = {
    maj:   { intervals: [0, 4, 7],     label: '',     symbol: '' },
    min:   { intervals: [0, 3, 7],     label: 'm',    symbol: 'm' },
    dim:   { intervals: [0, 3, 6],     label: 'dim',  symbol: '°' },
    aug:   { intervals: [0, 4, 8],     label: 'aug',  symbol: '+' },
    maj7:  { intervals: [0, 4, 7, 11], label: 'maj7', symbol: 'maj7' },
    min7:  { intervals: [0, 3, 7, 10], label: 'm7',   symbol: 'm7' },
    dom7:  { intervals: [0, 4, 7, 10], label: '7',    symbol: '7' },
    halfdim: { intervals: [0, 3, 6, 10], label: 'm7b5', symbol: 'ø' },
    dim7:  { intervals: [0, 3, 6, 9],  label: 'dim7', symbol: '°7' },
    sus2:  { intervals: [0, 2, 7],     label: 'sus2', symbol: 'sus2' },
    sus4:  { intervals: [0, 5, 7],     label: 'sus4', symbol: 'sus4' },
    minmaj7: { intervals: [0, 3, 7, 11], label: 'm(maj7)', symbol: 'm(maj7)' },
    maj9:  { intervals: [0, 4, 7, 11, 14], label: 'maj9', symbol: 'maj9' },
    min9:  { intervals: [0, 3, 7, 10, 14], label: 'm9', symbol: 'm9' },
    add9:  { intervals: [0, 4, 7, 14], label: 'add9', symbol: 'add9' },
    // Altered / extended dominants (intervals may wrap >11; notes use % 12)
    dom7b9:  { intervals: [0, 4, 7, 10, 13], label: '7b9',  symbol: '7♭9' },
    dom7s9:  { intervals: [0, 4, 7, 10, 15], label: '7#9',  symbol: '7♯9' },
    dom7s11: { intervals: [0, 4, 7, 10, 18], label: '7#11', symbol: '7♯11' },
    dom7b13: { intervals: [0, 4, 7, 10, 20], label: '7b13', symbol: '7♭13' },
    // 7alt: 3 + b7 + b9 + #9 + b13 (no perfect 5th)
    dom7alt: { intervals: [0, 4, 10, 13, 15, 20], label: '7alt', symbol: '7alt' },
  };

  /** Mode scale degrees relative to major (0-based pitch classes from tonic) */
  const MODES = {
    major:      { name: 'Major (Ionian)',     degrees: [0, 2, 4, 5, 7, 9, 11], romanBase: 'major' },
    minor:      { name: 'Natural Minor',      degrees: [0, 2, 3, 5, 7, 8, 10], romanBase: 'minor' },
    dorian:     { name: 'Dorian',             degrees: [0, 2, 3, 5, 7, 9, 10], romanBase: 'minor' },
    phrygian:   { name: 'Phrygian',           degrees: [0, 1, 3, 5, 7, 8, 10], romanBase: 'minor' },
    lydian:     { name: 'Lydian',             degrees: [0, 2, 4, 6, 7, 9, 11], romanBase: 'major' },
    mixolydian: { name: 'Mixolydian',         degrees: [0, 2, 4, 5, 7, 9, 10], romanBase: 'major' },
    locrian:    { name: 'Locrian',            degrees: [0, 1, 3, 5, 6, 8, 10], romanBase: 'minor' },
    harmonic:   { name: 'Harmonic Minor',     degrees: [0, 2, 3, 5, 7, 8, 11], romanBase: 'minor' },
    melodic:    { name: 'Melodic Minor',      degrees: [0, 2, 3, 5, 7, 9, 11], romanBase: 'minor' },
  };

  /** Triad quality per scale degree (0–6) for common modes */
  const DIATONIC_QUALITIES = {
    major:      ['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim'],
    minor:      ['min', 'dim', 'maj', 'min', 'min', 'maj', 'maj'],
    dorian:     ['min', 'min', 'maj', 'maj', 'min', 'dim', 'maj'],
    phrygian:   ['min', 'maj', 'maj', 'min', 'dim', 'maj', 'min'],
    lydian:     ['maj', 'maj', 'min', 'dim', 'maj', 'min', 'min'],
    mixolydian: ['maj', 'min', 'dim', 'maj', 'min', 'min', 'maj'],
    locrian:    ['dim', 'maj', 'min', 'min', 'maj', 'maj', 'min'],
    harmonic:   ['min', 'dim', 'aug', 'min', 'maj', 'maj', 'dim'],
    melodic:    ['min', 'min', 'aug', 'maj', 'maj', 'dim', 'dim'],
  };

  const DIATONIC_7TH = {
    major:      ['maj7', 'min7', 'min7', 'maj7', 'dom7', 'min7', 'halfdim'],
    minor:      ['min7', 'halfdim', 'maj7', 'min7', 'min7', 'maj7', 'dom7'],
    dorian:     ['min7', 'min7', 'maj7', 'dom7', 'min7', 'halfdim', 'maj7'],
    phrygian:   ['min7', 'maj7', 'dom7', 'min7', 'halfdim', 'maj7', 'min7'],
    lydian:     ['maj7', 'dom7', 'min7', 'halfdim', 'maj7', 'min7', 'min7'],
    mixolydian: ['dom7', 'min7', 'halfdim', 'maj7', 'min7', 'min7', 'maj7'],
    locrian:    ['halfdim', 'maj7', 'min7', 'min7', 'maj7', 'dom7', 'min7'],
    harmonic:   ['minmaj7', 'halfdim', 'maj7', 'min7', 'dom7', 'maj7', 'dim7'],
    melodic:    ['minmaj7', 'min7', 'maj7', 'dom7', 'dom7', 'halfdim', 'halfdim'],
  };

  const ROMAN = {
    major: ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'],
    minor: ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'],
  };

  function pc(note) {
    if (typeof note === 'number') return ((note % 12) + 12) % 12;
    const n = String(note).trim();
    const m = n.match(/^([A-Ga-g])([#b]?)/);
    if (!m) return 0;
    const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase()];
    const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
    return (base + acc + 12) % 12;
  }

  function noteName(p, preferFlat) {
    p = ((p % 12) + 12) % 12;
    return preferFlat ? FLAT_NAMES[p] : NOTE_NAMES[p];
  }

  function chordId(root, quality) {
    return `${root}:${quality}`;
  }

  function makeChord(root, quality, opts = {}) {
    // Free pitch-set chords (from fretboard custom mode)
    if (quality === 'custom' || opts.custom) {
      return makeCustomChord(root, opts.notes || [root], opts);
    }
    const q = QUALITIES[quality] || QUALITIES.maj;
    const r = pc(root);
    const notes = q.intervals.map((iv) => (r + iv) % 12);
    const preferFlat = opts.preferFlat ?? false;
    const bassPc = opts.bassPc != null ? pc(opts.bassPc) : r;
    let name = noteName(r, preferFlat) + (q.symbol || q.label);
    if (bassPc !== r) name += '/' + noteName(bassPc, preferFlat);
    return {
      id: chordId(r, quality) + (opts.uid ? `:${opts.uid}` : ''),
      root: r,
      rootName: noteName(r, preferFlat),
      quality,
      qualityLabel: q.label,
      name,
      notes: notes.slice(),
      intervals: q.intervals.slice(),
      duration: opts.duration != null ? opts.duration : 4, // beats (quarter notes)
      inversion: opts.inversion || 0,
      bassPc,
      region: opts.region || 'diatonic', // diatonic | secondary | interchange | chromatic | tritone | parallel | diminished | flavour
      roman: opts.roman || '',
      tag: opts.tag || '',
      custom: false,
    };
  }

  /**
   * Build a chord from an arbitrary pitch-class set (not forced into a named triad).
   * e.g. B C D F# stays custom, never collapses to Bm.
   */
  function makeCustomChord(root, notes, opts = {}) {
    const r = pc(root);
    const preferFlat = opts.preferFlat ?? false;
    let pcs = [...new Set((notes || []).map((n) => pc(n)))];
    if (!pcs.length) pcs = [r];
    if (!pcs.includes(r)) pcs.push(r);
    pcs.sort((a, b) => ((a - r + 12) % 12) - ((b - r + 12) % 12));
    const intervals = pcs.map((n) => (n - r + 12) % 12);
    const bassPc = opts.bassPc != null ? pc(opts.bassPc) : r;
    let name =
      opts.name ||
      pcs.map((n) => noteName(n, preferFlat)).join('·');
    if (bassPc !== r && name.indexOf('/') < 0) name += '/' + noteName(bassPc, preferFlat);
    return {
      id: chordId(r, 'custom') + ':' + pcs.join('.') + (opts.uid ? `:${opts.uid}` : ''),
      root: r,
      rootName: noteName(r, preferFlat),
      quality: 'custom',
      qualityLabel: 'custom',
      name,
      notes: pcs.slice(),
      intervals,
      duration: opts.duration != null ? opts.duration : 4,
      inversion: opts.inversion || 0,
      bassPc,
      region: opts.region || 'custom',
      roman: opts.roman || '',
      tag: opts.tag || 'custom',
      custom: true,
    };
  }

  function withDuration(chord, beats) {
    const next = {
      ...chord,
      duration: Math.max(0.25, beats),
      notes: chord.notes.slice(),
      intervals: (chord.intervals || []).slice(),
    };
    return next;
  }

  function diatonicChords(tonic, modeKey, sevenths = false) {
    const mode = MODES[modeKey] || MODES.minor;
    const t = pc(tonic);
    const quals = sevenths
      ? (DIATONIC_7TH[modeKey] || DIATONIC_7TH.minor)
      : (DIATONIC_QUALITIES[modeKey] || DIATONIC_QUALITIES.minor);
    const romanSet = ROMAN[mode.romanBase] || ROMAN.minor;
    return mode.degrees.map((deg, i) => {
      const root = (t + deg) % 12;
      return makeChord(root, quals[i], {
        region: 'diatonic',
        roman: romanSet[i] || '',
        tag: 'diatonic',
      });
    });
  }

  /**
   * Spell roots with flats in flat keys (and always for borrowed colour in major).
   * C major stays mostly sharp-neutral, but borrow uses flats (Eb not D#).
   */
  function keyPrefersFlat(tonic, modeKey) {
    const t = pc(tonic);
    const isMin = (MODES[modeKey] || MODES.minor).romanBase === 'minor';
    // Major flat keys: F Bb Eb Ab Db Gb
    const flatMaj = { 5: 1, 10: 1, 3: 1, 8: 1, 1: 1, 6: 1 };
    // Minor keys that usually use flats: D G C F Bb Eb minor
    const flatMin = { 2: 1, 7: 1, 0: 1, 5: 1, 10: 1, 3: 1 };
    return isMin ? !!flatMin[t] : !!flatMaj[t];
  }

  /** Secondary dominants: V/x for each non-tonic diatonic target */
  function secondaryDominants(tonic, modeKey, opts) {
    opts = opts || {};
    const preferFlat = opts.preferFlat != null ? opts.preferFlat : keyPrefersFlat(tonic, modeKey);
    const diat = diatonicChords(tonic, modeKey, false).map((c) =>
      makeChord(c.root, c.quality, { region: 'diatonic', roman: c.roman, preferFlat })
    );
    const out = [];
    diat.forEach((ch, i) => {
      if (i === 0) return; // V7→I handled as primary dominant
      const domRoot = (ch.root + 7) % 12;
      const v7 = makeChord(domRoot, 'dom7', {
        region: 'secondary',
        roman: `V7/${ch.roman || noteName(ch.root, preferFlat)}`,
        tag: 'secondary dominant',
        preferFlat,
      });
      v7.resolveTarget = {
        root: ch.root,
        quality: ch.quality,
        roman: ch.roman || '',
        name: ch.name,
      };
      // Secondaries resolve to their target only — not to each other
      v7.canOrbitPeers = false;
      out.push(v7);
    });
    return out;
  }

  /**
   * Primary V7 → I (belongs on the Function chart; not a "secondary").
   */
  function primaryDominant(tonic, modeKey, opts) {
    opts = opts || {};
    const preferFlat = opts.preferFlat != null ? opts.preferFlat : keyPrefersFlat(tonic, modeKey);
    const t = pc(tonic);
    const isMin = (MODES[modeKey] || MODES.minor).romanBase === 'minor';
    const homeQ = isMin ? 'min' : 'maj';
    const home = makeChord(t, homeQ, {
      region: 'diatonic',
      roman: isMin ? 'i' : 'I',
      preferFlat,
    });
    const v7 = makeChord((t + 7) % 12, 'dom7', {
      region: 'diatonic',
      roman: 'V7',
      tag: 'primary dominant',
      preferFlat,
    });
    v7.resolveTarget = {
      root: home.root,
      quality: home.quality,
      roman: home.roman,
      name: home.name,
    };
    v7.canOrbitPeers = false;
    v7.isPrimaryDominant = true;
    return v7;
  }

  /**
   * Classic modal interchange for Function charts.
   * Major → parallel natural minor colours (flats): i, ♭III, iv, v, ♭VI, ♭VII
   * Minor → parallel major colours: I, ii, IV, V, vi
   * Prefer flats so C major shows Eb/Ab/Bb/Fm not D#/G#/A#.
   */
  function modalInterchange(tonic, modeKey, opts) {
    opts = opts || {};
    const t = pc(tonic);
    const isMinor = (MODES[modeKey] || MODES.minor).romanBase === 'minor';
    // Borrowed colour almost always spelled with flats in major keys
    const preferFlat =
      opts.preferFlat != null ? opts.preferFlat : !isMinor || keyPrefersFlat(tonic, modeKey);

    if (!isMinor) {
      // Major: borrow from natural minor (user chord-file orbit)
      // sparse: paper chart core only (♭III, iv, ♭VI, ♭VII)
      const specs = opts.sparse
        ? [
            { d: 3, q: 'maj', roman: '♭III' },
            { d: 5, q: 'min', roman: 'iv' },
            { d: 8, q: 'maj', roman: '♭VI' },
            { d: 10, q: 'maj', roman: '♭VII' },
          ]
        : [
            { d: 0, q: 'min', roman: 'i' },
            { d: 3, q: 'maj', roman: '♭III' },
            { d: 5, q: 'min', roman: 'iv' },
            { d: 7, q: 'min', roman: 'v' },
            { d: 8, q: 'maj', roman: '♭VI' },
            { d: 10, q: 'maj', roman: '♭VII' },
          ];
      return specs.map((s) => {
        const ch = makeChord((t + s.d) % 12, s.q, {
          region: 'interchange',
          roman: s.roman,
          tag: 'modal interchange',
          preferFlat: true,
        });
        ch.canOrbitPeers = true; // borrow chords freely connect among themselves
        return ch;
      });
    }

    // Minor: borrow from parallel major
    const specs = [
      { d: 0, q: 'maj', roman: 'I' },
      { d: 2, q: 'min', roman: 'ii' },
      { d: 5, q: 'maj', roman: 'IV' },
      { d: 7, q: 'maj', roman: 'V' },
      { d: 9, q: 'min', roman: 'vi' },
    ];
    return specs.map((s) => {
      const ch = makeChord((t + s.d) % 12, s.q, {
        region: 'interchange',
        roman: s.roman,
        tag: 'modal interchange',
        preferFlat,
      });
      ch.canOrbitPeers = true;
      return ch;
    });
  }

  /**
   * Neighbourhood chart for one key (user's "chord file" view):
   * diatonic core, V7→I, secondaries → targets, interchange orbit, I/IV/V gates,
   * plus in-key colours (sus, II maj, light 7ths) for "In this key".
   */
  function functionNeighborhood(tonic, modeKey, opts) {
    opts = opts || {};
    const t = pc(tonic);
    const mode = modeKey || 'minor';
    const preferFlat = keyPrefersFlat(t, mode);
    const fo = opts.functionOpts || opts || {};
    const isMin = (MODES[mode] || MODES.minor).romanBase === 'minor';
    const diat = diatonicChords(t, mode, false).map((c) =>
      makeChord(c.root, c.quality, {
        region: 'diatonic',
        roman: c.roman,
        preferFlat,
      })
    );
    const primary = primaryDominant(t, mode, { preferFlat });
    const secondary = secondaryDominants(t, mode, { preferFlat });
    const interchange = modalInterchange(t, mode, {
      preferFlat: true,
      sparse: !!fo.sparseBorrow,
    });
    // Classic gates in/out of borrow: I, IV, V
    const gates = [diat[0], diat[3], diat[4]].filter(Boolean).map((c) => ({
      ...c,
      region: 'diatonic',
      tag: 'gate',
      notes: (c.notes || []).slice(),
      canOrbitPeers: false,
    }));

    // In-key colours: same scale degrees, different quality — not a new key.
    // (e.g. Em → Asus4, Em → F# maj → G without leaving E minor as home.)
    const colours = [];
    const pushColour = (root, quality, roman, tag, region) => {
      const ch = makeChord(root, quality, {
        region: region || 'flavour',
        roman: roman || '',
        tag: tag || 'colour',
        preferFlat,
      });
      ch.colourOf =
        diat.find((d) => d.root === root) ||
        { root: root, roman: roman };
      colours.push(ch);
    };
    // IV/iv sus — rock hang (Asus4 in Em)
    if (diat[3]) {
      pushColour(diat[3].root, 'sus4', isMin ? 'iv sus' : 'IV sus', 'subdom sus', 'flavour');
    }
    // V sus / V triad colour when primary is V7 (already separate)
    if (diat[4] && diat[4].quality !== 'sus4') {
      pushColour(diat[4].root, 'sus4', isMin ? 'v sus' : 'V sus', 'dom sus', 'flavour');
    }
    if (isMin) {
      // ii° stays diatonic; F#m = dorian colour; F# maj = bright II (chromatic in natural minor)
      if (diat[1]) {
        pushColour(diat[1].root, 'min', 'ii', 'dorian ii', 'flavour');
        pushColour(diat[1].root, 'maj', 'II', 'bright II', 'chromatic');
      }
      // i add colour: i7 for soul/r&b motion back home
      if (diat[0]) {
        pushColour(diat[0].root, 'min7', 'i7', 'tonic colour', 'flavour');
      }
    } else {
      // Major: ii7, IVsus already; IVmaj7; vi colour; II as secondary-ish colour without V7 chain
      if (diat[1]) pushColour(diat[1].root, 'min7', 'ii7', 'supertonic 7', 'flavour');
      if (diat[3]) pushColour(diat[3].root, 'maj7', 'IVmaj7', 'subdom colour', 'flavour');
      if (diat[5]) pushColour(diat[5].root, 'min7', 'vi7', 'submed colour', 'flavour');
      // Chromatic II maj (secondary dominant colour without full V/x package)
      if (diat[1]) pushColour((t + 2) % 12, 'maj', 'II', 'bright II', 'chromatic');
    }

    // Strand generators (Keithson pack) — available on neighborhood for UI chips
    const iiVs = secondaryIiVs(t, mode, { preferFlat: preferFlat });
    const tritones = tritoneSubs(t, mode, { preferFlat: preferFlat });
    const dimStrand = diminishedStrand(t, mode, { preferFlat: preferFlat });
    const vAlt = vAlternatives(t, mode, { preferFlat: preferFlat });

    return {
      tonic: t,
      mode: mode,
      preferFlat: preferFlat,
      diatonic: diat,
      primaryDominant: primary,
      secondary: secondary,
      secondaryIiVs: iiVs,
      interchange: interchange,
      colours: colours,
      gates: gates,
      tritone: tritones,
      diminished: dimStrand,
      vAlternatives: vAlt,
    };
  }

  /** Chromatic mediants: ± major/minor third, same quality or flipped */
  function chromaticMediants(tonic, modeKey) {
    const t = pc(tonic);
    const homeQ = (MODES[modeKey] || MODES.minor).romanBase === 'minor' ? 'min' : 'maj';
    const out = [];
    [3, 4, 8, 9].forEach((iv) => {
      const r = (t + iv) % 12;
      out.push(makeChord(r, homeQ, { region: 'chromatic', tag: 'chromatic mediant', roman: 'CM' }));
      const flip = homeQ === 'min' ? 'maj' : 'min';
      out.push(makeChord(r, flip, { region: 'chromatic', tag: 'chromatic mediant', roman: 'CM' }));
    });
    return dedupeChords(out);
  }

  /**
   * Tritone substitution of a dominant: root + 6, same dom7 colour.
   * Resolves to the same target the original dominant would (down a 5th from dom).
   */
  function tritoneSubOfDominant(domRoot, opts) {
    opts = opts || {};
    const d = pc(domRoot);
    const target = (d + 5) % 12;
    const subRoot = (d + 6) % 12;
    const preferFlat = opts.preferFlat != null ? opts.preferFlat : true;
    const ofRoman = opts.ofRoman || '';
    const ch = makeChord(subRoot, opts.quality || 'dom7', {
      region: 'tritone',
      tag: opts.tag || 'tritone sub',
      roman: ofRoman ? '♭II7/' + ofRoman : opts.roman || '♭II7',
      preferFlat: preferFlat,
    });
    ch.substitutesFor = { root: d, quality: 'dom7', roman: opts.domRoman || 'V7' };
    ch.resolveTarget = {
      root: target,
      quality: opts.targetQuality || 'maj',
      roman: opts.targetRoman || '',
      name: opts.targetName || '',
    };
    ch.canOrbitPeers = false;
    return ch;
  }

  /**
   * Tritone subs for primary V and every secondary dominant (not just V of I).
   */
  function tritoneSubs(tonic, modeKey, opts) {
    opts = opts || {};
    const preferFlat =
      opts.preferFlat != null ? opts.preferFlat : keyPrefersFlat(tonic, modeKey);
    const diat = diatonicChords(tonic, modeKey, false);
    const out = [];
    const v = diat[4];
    if (v) {
      out.push(
        tritoneSubOfDominant(v.root, {
          preferFlat: true,
          roman: '♭II7',
          tag: 'tritone sub of V',
          domRoman: 'V7',
          targetQuality: diat[0] ? diat[0].quality : 'maj',
          targetRoman: diat[0] ? diat[0].roman : '',
          targetName: diat[0] ? diat[0].name : '',
        })
      );
    }
    secondaryDominants(tonic, modeKey, { preferFlat: preferFlat }).forEach(function (v7) {
      const rt = v7.resolveTarget || {};
      out.push(
        tritoneSubOfDominant(v7.root, {
          preferFlat: true,
          ofRoman: rt.roman || '',
          tag: 'tritone sub of secondary',
          domRoman: v7.roman || 'V7/x',
          targetQuality: rt.quality || 'maj',
          targetRoman: rt.roman || '',
          targetName: rt.name || '',
        })
      );
    });
    return dedupeChords(out);
  }

  /**
   * Secondary ii–V of each non-tonic diatonic target:
   *   ii/X → V7/X → X
   * Major targets get m7 on ii; minor/dim targets get m7b5 (halfdim).
   * Returns [{ target, ii, v7, chords: [ii, v7, target] }, ...]
   */
  function secondaryIiVs(tonic, modeKey, opts) {
    opts = opts || {};
    const preferFlat =
      opts.preferFlat != null ? opts.preferFlat : keyPrefersFlat(tonic, modeKey);
    const diat = diatonicChords(tonic, modeKey, false);
    const out = [];
    diat.forEach(function (ch, i) {
      if (i === 0) return; // skip tonic; use primary ii–V via waysBackHome / vAlternatives
      const fam = qualityFamily(ch.quality);
      const targetIsMin =
        fam === 'min' || fam === 'dim' || fam === 'halfdim';
      const iiRoot = (ch.root + 2) % 12;
      const vRoot = (ch.root + 7) % 12;
      const iiQ = targetIsMin ? 'halfdim' : 'min7';
      const ii = makeChord(iiRoot, iiQ, {
        region: 'secondary',
        roman: 'ii/' + (ch.roman || noteName(ch.root, preferFlat)),
        tag: 'secondary ii',
        preferFlat: preferFlat,
      });
      const v7 = makeChord(vRoot, 'dom7', {
        region: 'secondary',
        roman: 'V7/' + (ch.roman || noteName(ch.root, preferFlat)),
        tag: 'secondary dominant',
        preferFlat: preferFlat,
      });
      const target = makeChord(ch.root, ch.quality, {
        region: 'diatonic',
        roman: ch.roman || '',
        tag: 'secondary target',
        preferFlat: preferFlat,
      });
      ii.resolveTarget = {
        root: vRoot,
        quality: 'dom7',
        roman: v7.roman,
        name: v7.name,
      };
      v7.resolveTarget = {
        root: ch.root,
        quality: ch.quality,
        roman: ch.roman || '',
        name: ch.name,
      };
      ii.canOrbitPeers = false;
      v7.canOrbitPeers = false;
      out.push({
        targetRoman: ch.roman || '',
        target: target,
        ii: ii,
        v7: v7,
        chords: [ii, v7, target],
      });
    });
    return out;
  }

  /** Flat list of secondary ii + V7 chords (no repeated targets). */
  function secondaryIiVChords(tonic, modeKey, opts) {
    const packs = secondaryIiVs(tonic, modeKey, opts);
    const list = [];
    packs.forEach(function (p) {
      list.push(p.ii, p.v7);
    });
    return dedupeChords(list);
  }

  /**
   * Diminished strand from a key centre:
   *  - leading-tone °7 of each diatonic target (vii°7/X)
   *  - common-tone °7 on the tonic
   *  - passing dim triads (½-step below each target)
   *  - °7 as rootless V7♭9 (iii°7 of V)
   *  - symmetrical °7 chain (minor-3rd roots, same pitch set)
   */
  function diminishedStrand(tonic, modeKey, opts) {
    opts = opts || {};
    const t = pc(tonic);
    const preferFlat =
      opts.preferFlat != null ? opts.preferFlat : keyPrefersFlat(tonic, modeKey);
    const isMin = (MODES[modeKey] || MODES.minor).romanBase === 'minor';
    const diat = diatonicChords(tonic, modeKey, false);
    const leading = [];
    const passing = [];
    diat.forEach(function (ch) {
      const lt = (ch.root + 11) % 12;
      const d7 = makeChord(lt, 'dim7', {
        region: 'diminished',
        roman: 'vii°7/' + (ch.roman || noteName(ch.root, preferFlat)),
        tag: 'leading dim7',
        preferFlat: preferFlat,
      });
      d7.resolveTarget = {
        root: ch.root,
        quality: ch.quality,
        roman: ch.roman || '',
        name: ch.name,
      };
      d7.canOrbitPeers = true;
      leading.push(d7);

      const passRoot = (ch.root + 11) % 12;
      const pd = makeChord(passRoot, 'dim', {
        region: 'diminished',
        roman: '°→' + (ch.roman || noteName(ch.root, preferFlat)),
        tag: 'passing dim',
        preferFlat: preferFlat,
      });
      pd.resolveTarget = {
        root: ch.root,
        quality: ch.quality,
        roman: ch.roman || '',
        name: ch.name,
      };
      passing.push(pd);
    });

    const commonTone = [
      makeChord(t, 'dim7', {
        region: 'diminished',
        roman: isMin ? 'i°7' : 'I°7',
        tag: 'common-tone dim7',
        preferFlat: preferFlat,
      }),
    ];

    // Rootless V7♭9: dim7 built on the 3rd of V (shares chord tones with V7♭9)
    const vRoot = (t + 7) % 12;
    const thirdOfV = (vRoot + 4) % 12;
    const asV7b9 = makeChord(thirdOfV, 'dim7', {
      region: 'diminished',
      roman: 'vii°7',
      tag: 'dim7 as V7b9',
      preferFlat: preferFlat,
    });
    asV7b9.resolveTarget = {
      root: t,
      quality: isMin ? 'min' : 'maj',
      roman: isMin ? 'i' : 'I',
    };
    asV7b9.equivalentDominant = { root: vRoot, quality: 'dom7b9' };

    const chains = [0, 3, 6, 9].map(function (d) {
      return makeChord((t + d) % 12, 'dim7', {
        region: 'diminished',
        roman: '°7',
        tag: 'symmetrical dim7',
        preferFlat: preferFlat,
      });
    });

    return {
      leading: leading,
      commonTone: commonTone,
      passing: passing,
      asV7b9: [asV7b9],
      chains: chains,
    };
  }

  function diminishedStrandChords(tonic, modeKey, opts) {
    const s = diminishedStrand(tonic, modeKey, opts);
    return dedupeChords(
      [].concat(s.leading, s.commonTone, s.passing, s.asV7b9, s.chains)
    );
  }

  /**
   * V-chord alternatives pack: triads/7ths/alts of V, tritone, backdoor, delayed ii–V of V.
   * Returns { chords, routes } where routes are labeled progressions into I/i.
   */
  function vAlternatives(tonic, modeKey, opts) {
    opts = opts || {};
    const t = pc(tonic);
    const preferFlat =
      opts.preferFlat != null ? opts.preferFlat : keyPrefersFlat(tonic, modeKey);
    const isMin = (MODES[modeKey] || MODES.minor).romanBase === 'minor';
    const homeQ = isMin ? 'min' : 'maj';
    const homeRoman = isMin ? 'i' : 'I';
    const vRoot = (t + 7) % 12;
    const I = makeChord(t, homeQ, {
      region: 'diatonic',
      roman: homeRoman,
      tag: 'home',
      preferFlat: preferFlat,
    });

    function vQ(quality, roman, tag, region) {
      return makeChord(vRoot, quality, {
        region: region || 'diatonic',
        roman: roman,
        tag: tag,
        preferFlat: preferFlat,
      });
    }

    const V = vQ('maj', 'V', 'V triad', 'diatonic');
    const V7 = vQ('dom7', 'V7', 'primary dominant', 'diatonic');
    V7.isPrimaryDominant = true;
    V7.resolveTarget = {
      root: t,
      quality: homeQ,
      roman: homeRoman,
      name: I.name,
    };
    const Vsus = vQ('sus4', 'Vsus', 'V sus', 'flavour');
    const V7b9 = vQ('dom7b9', 'V7♭9', 'altered dominant', 'flavour');
    const V7s9 = vQ('dom7s9', 'V7♯9', 'altered dominant', 'flavour');
    const V7s11 = vQ('dom7s11', 'V7♯11', 'lydian dominant colour', 'flavour');
    const V7b13 = vQ('dom7b13', 'V7♭13', 'altered dominant', 'flavour');
    const V7alt = vQ('dom7alt', 'V7alt', 'fully altered V', 'flavour');
    [V7b9, V7s9, V7s11, V7b13, V7alt].forEach(function (c) {
      c.resolveTarget = V7.resolveTarget;
    });

    const bII7 = tritoneSubOfDominant(vRoot, {
      preferFlat: true,
      roman: '♭II7',
      tag: 'tritone sub of V',
      domRoman: 'V7',
      targetQuality: homeQ,
      targetRoman: homeRoman,
      targetName: I.name,
    });

    // Backdoor: ♭VII7 (and iv prep) → I
    const bVII7 = makeChord((t + 10) % 12, 'dom7', {
      region: 'interchange',
      roman: '♭VII7',
      tag: 'backdoor dominant',
      preferFlat: true,
    });
    bVII7.resolveTarget = {
      root: t,
      quality: homeQ,
      roman: homeRoman,
      name: I.name,
    };
    const ivm = makeChord((t + 5) % 12, 'min', {
      region: 'interchange',
      roman: 'iv',
      tag: 'backdoor prep',
      preferFlat: true,
    });

    // Delayed cadence: ii/V → V7/V → V7 → I
    const ofV = vRoot;
    const iiOfV = makeChord((ofV + 2) % 12, 'min7', {
      region: 'secondary',
      roman: 'ii/V',
      tag: 'delayed cadence',
      preferFlat: preferFlat,
    });
    const vOfV = makeChord((ofV + 7) % 12, 'dom7', {
      region: 'secondary',
      roman: 'V7/V',
      tag: 'delayed cadence',
      preferFlat: preferFlat,
    });
    vOfV.resolveTarget = {
      root: ofV,
      quality: 'dom7',
      roman: 'V7',
      name: V7.name,
    };
    iiOfV.resolveTarget = {
      root: vOfV.root,
      quality: 'dom7',
      roman: 'V7/V',
      name: vOfV.name,
    };

    // Soft iii / ♭III as “V-ish” colour (not a real dominant)
    const iii = makeChord((t + (isMin ? 3 : 4)) % 12, isMin ? 'maj' : 'min', {
      region: isMin ? 'diatonic' : 'diatonic',
      roman: isMin ? '♭III' : 'iii',
      tag: 'soft V alternative',
      preferFlat: preferFlat,
    });
    const IV = makeChord((t + 5) % 12, isMin ? 'min' : 'maj', {
      region: 'diatonic',
      roman: isMin ? 'iv' : 'IV',
      tag: 'plagal',
      preferFlat: preferFlat,
    });

    const chords = dedupeChords([
      V,
      V7,
      Vsus,
      V7b9,
      V7s9,
      V7s11,
      V7b13,
      V7alt,
      bII7,
      bVII7,
      ivm,
      iiOfV,
      vOfV,
      iii,
      IV,
    ]);

    const routes = [
      { name: 'Authentic V–I', character: 'strong', chords: [V, I] },
      { name: 'Authentic V7–I', character: 'strong / classical', chords: [V7, I] },
      { name: 'Vsus–V7–I', character: 'rock hang', chords: [Vsus, V7, I] },
      { name: 'V7♭9–I', character: 'dark classical', chords: [V7b9, I] },
      { name: 'V7♯9–I', character: 'blues / soul', chords: [V7s9, I] },
      { name: 'V7alt–I', character: 'jazz altered', chords: [V7alt, I] },
      { name: 'Tritone ♭II7–I', character: 'dark / surprising', chords: [bII7, I] },
      { name: 'Backdoor ♭VII7–I', character: 'gospel / soul', chords: [bVII7, I] },
      {
        name: 'Backdoor iv–♭VII7–I',
        character: 'gospel full',
        chords: [ivm, bVII7, I],
      },
      {
        name: 'Delayed ii/V–V7/V–V7–I',
        character: 'jazz turnaround',
        chords: [iiOfV, vOfV, V7, I],
      },
      { name: 'Plagal IV–I', character: 'soft / amen', chords: [IV, I] },
      { name: 'Soft iii–I', character: 'gentle', chords: [iii, I] },
    ];

    return { chords: chords, routes: routes, home: I };
  }

  /** Parallel mode chords (shift to parallel major/minor tonic chord colour) */
  function parallelModeChords(tonic, modeKey) {
    const t = pc(tonic);
    const isMinor = (MODES[modeKey] || MODES.minor).romanBase === 'minor';
    const other = isMinor ? 'maj' : 'min';
    return [
      makeChord(t, other, { region: 'parallel', tag: 'parallel mode', roman: isMinor ? 'I' : 'i' }),
      makeChord((t + 5) % 12, other === 'maj' ? 'maj' : 'min', {
        region: 'parallel',
        tag: 'parallel IV/iv',
        roman: isMinor ? 'IV' : 'iv',
      }),
      makeChord((t + 7) % 12, 'maj', {
        region: 'parallel',
        tag: isMinor ? 'V (major)' : 'v colour',
        roman: isMinor ? 'V' : 'v',
      }),
    ];
  }

  function dedupeChords(list) {
    const seen = new Set();
    return list.filter((c) => {
      const k = c.root + ':' + c.quality + ':' + (c.region || '');
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  function fullPalette(tonic, modeKey, sevenths = true) {
    const iiVs = secondaryIiVs(tonic, modeKey);
    const dim = diminishedStrand(tonic, modeKey);
    const vAlt = vAlternatives(tonic, modeKey);
    return {
      diatonic: diatonicChords(tonic, modeKey, sevenths),
      secondary: secondaryDominants(tonic, modeKey),
      secondaryIiVs: iiVs,
      secondaryIiVChords: secondaryIiVChords(tonic, modeKey),
      interchange: modalInterchange(tonic, modeKey),
      chromatic: chromaticMediants(tonic, modeKey),
      tritone: tritoneSubs(tonic, modeKey),
      parallel: parallelModeChords(tonic, modeKey),
      diminished: diminishedStrandChords(tonic, modeKey),
      diminishedStrand: dim,
      vAlternatives: vAlt.chords,
      vAlternativeRoutes: vAlt.routes,
    };
  }

  function allPaletteChords(tonic, modeKey, sevenths = true) {
    const p = fullPalette(tonic, modeKey, sevenths);
    return dedupeChords([
      ...p.diatonic,
      ...p.secondary,
      ...p.secondaryIiVChords,
      ...p.interchange,
      ...p.chromatic,
      ...p.tritone,
      ...p.parallel,
      ...p.diminished,
      ...p.vAlternatives,
    ]);
  }

  /**
   * Keithson-style “strands from a key centre” pack (for UI / teaching).
   * Mirrors: diatonic · secondary · modal interchange · ii–Vs · tritone · dim · V alts.
   */
  function progressionStrands(tonic, modeKey, opts) {
    opts = opts || {};
    const t = pc(tonic);
    const mode = modeKey || 'minor';
    const p = fullPalette(t, mode, opts.sevenths !== false);
    const vAlt = vAlternatives(t, mode, opts);
    const home = vAlt.home;
    // Primary ii–V–I as a strand pack (not only secondary)
    const diat = p.diatonic;
    const ii = diat[1]
      ? makeChord(
          diat[1].root,
          qualityFamily(diat[1].quality) === 'dim' ||
            qualityFamily(diat[1].quality) === 'halfdim'
            ? 'halfdim'
            : 'min7',
          {
            region: 'diatonic',
            roman: diat[1].roman || 'ii',
            tag: 'primary ii',
          }
        )
      : null;
    const V7 = primaryDominant(t, mode);
    const primaryIiV = ii
      ? {
          name: 'ii–V–I',
          character: 'primary jazz cadence',
          chords: [ii, V7, home],
        }
      : null;
    return {
      tonic: t,
      mode: mode,
      diatonic: p.diatonic,
      secondaryDominants: p.secondary,
      secondaryIiVs: p.secondaryIiVs,
      modalInterchange: p.interchange,
      tritoneSubs: p.tritone,
      diminished: p.diminishedStrand,
      vAlternatives: vAlt,
      primaryIiV: primaryIiV,
      chromaticMediants: p.chromatic,
      parallel: p.parallel,
      allChords: allPaletteChords(t, mode, opts.sevenths !== false),
    };
  }

  /**
   * Harmonic distance from home tonic (0 = home centre).
   * Used for spatial layout: diatonic close, exotic further out.
   */
  function harmonicDistance(chord, tonic, modeKey) {
    const t = pc(tonic);
    const diat = diatonicChords(tonic, modeKey, true);
    const diatRoots = new Set(diat.map((c) => c.root));
    const rootDist = Math.min(
      Math.abs(chord.root - t),
      12 - Math.abs(chord.root - t)
    );

    let base = rootDist * 0.35;
    const regionWeight = {
      diatonic: 0.2,
      secondary: 1.4,
      interchange: 1.8,
      chromatic: 2.4,
      tritone: 2.6,
      parallel: 1.6,
      diminished: 2.2,
      flavour: 1.1,
    };
    base += regionWeight[chord.region] || 1.5;

    if (!diatRoots.has(chord.root)) base += 0.6;
    if (chord.quality === 'dim' || chord.quality === 'dim7' || chord.quality === 'halfdim') base += 0.4;
    if (chord.quality === 'aug') base += 0.5;

    // Tonic chord itself sits at centre
    if (chord.root === t && (chord.quality === 'min' || chord.quality === 'maj' ||
        chord.quality === 'min7' || chord.quality === 'maj7' || chord.quality === 'minmaj7')) {
      base = Math.min(base, 0.15);
    }

    return Math.min(base, 4.5);
  }

  /** Angle around home for spatial placement (legacy / fallback) */
  function harmonicAngle(chord, tonic) {
    const t = pc(tonic);
    const rootAngle = ((chord.root - t + 12) % 12) * ((Math.PI * 2) / 12);
    const qOff = {
      maj: 0, min: 0.08, dim: 0.15, aug: -0.1,
      maj7: -0.05, min7: 0.1, dom7: 0.12, halfdim: 0.18, dim7: 0.2,
    };
    return rootAngle + (qOff[chord.quality] || 0);
  }

  /**
   * Chase-inspired circular harmonic scale for one key.
   * Seats go clockwise as fifths-down (homeward gravity), tonic at top (-π/2).
   * Major: I–IV–vii°–iii–vi–ii–V
   * Minor: i–iv–♭VII–♭III–♭VI–ii°–V
   */
  function circularHarmonicScale(tonic, modeKey) {
    const t = pc(tonic);
    const isMin = (MODES[modeKey] || MODES.minor).romanBase === 'minor';
    const specs = isMin
      ? [
          { d: 0, qualities: ['min', 'min7', 'min9', 'minmaj7'], roman: 'i', role: 'tonic' },
          { d: 5, qualities: ['min', 'min7'], roman: 'iv', role: 'subdom' },
          { d: 10, qualities: ['maj', 'dom7', 'maj7'], roman: '♭VII', role: 'modal' },
          { d: 3, qualities: ['maj', 'maj7'], roman: '♭III', role: 'mediant' },
          { d: 8, qualities: ['maj', 'maj7'], roman: '♭VI', role: 'submed' },
          { d: 2, qualities: ['dim', 'halfdim', 'min7'], roman: 'ii°', role: 'supertonic' },
          { d: 7, qualities: ['dom7', 'maj', 'maj7'], roman: 'V', role: 'dom' },
        ]
      : [
          // Default quality first = what seats play on hover (triads so V ≠ vii°)
          { d: 0, qualities: ['maj', 'maj7', 'add9', 'maj9'], roman: 'I', role: 'tonic' },
          { d: 5, qualities: ['maj', 'maj7'], roman: 'IV', role: 'subdom' },
          { d: 11, qualities: ['dim', 'halfdim'], roman: 'vii°', role: 'leading' },
          { d: 4, qualities: ['min', 'min7'], roman: 'iii', role: 'mediant' },
          { d: 9, qualities: ['min', 'min7'], roman: 'vi', role: 'submed' },
          { d: 2, qualities: ['min', 'min7'], roman: 'ii', role: 'supertonic' },
          // maj triad first (G), then V7 — forcing dom7 made V share B–D–F with vii°
          { d: 7, qualities: ['maj', 'dom7', 'maj7'], roman: 'V', role: 'dom' },
        ];
    const n = specs.length;
    return specs.map((s, i) => ({
      d: s.d,
      qualities: s.qualities,
      roman: s.roman,
      role: s.role,
      root: (t + s.d) % 12,
      seatIndex: i,
      // Clockwise from top = fifths-down around the scale
      angle: -Math.PI / 2 + (i / n) * Math.PI * 2,
    }));
  }

  function qualityFamily(q) {
    q = String(q || '');
    if (q === 'custom') return 'custom';
    // All dom7* / 7alt / 7b9 etc. count as dominant family for seating
    if (
      q.indexOf('dom') === 0 ||
      q === '7' ||
      /^7(b9|#9|#11|b13|alt)/i.test(q)
    ) {
      return 'dom';
    }
    if (q.indexOf('halfdim') >= 0 || q === 'm7b5') return 'halfdim';
    if (q.indexOf('dim') >= 0) return 'dim';
    if (q.indexOf('min') === 0 || q === 'm') return 'min';
    if (q.indexOf('maj') === 0 || q === 'add9') return 'maj';
    if (q.indexOf('sus') === 0) return 'sus';
    return q;
  }

  /**
   * Map a chord onto the circular harmonic scale of a key.
   * onScale: sits on a scale seat; shell: chromatic / outside ring.
   */
  function seatForChord(chord, tonic, modeKey) {
    const seats = circularHarmonicScale(tonic, modeKey);
    const root = pc(chord.root);
    const fam = qualityFamily(chord.quality);
    // Exact seat + quality family
    for (let i = 0; i < seats.length; i++) {
      const s = seats[i];
      if (s.root !== root) continue;
      const hit = s.qualities.some((q) => qualityFamily(q) === fam || q === chord.quality);
      if (hit) return { seat: s, onScale: true, shell: false, seats };
    }
    // Same root, different colour (e.g. secondary on a seat)
    for (let i = 0; i < seats.length; i++) {
      if (seats[i].root === root) {
        return {
          seat: seats[i],
          onScale: true,
          shell: fam === 'dom' && seats[i].role !== 'dom' ? 'secondary' : 'variant',
          seats,
        };
      }
    }
    // Chromatic: angle from pitch class, outer shell
    const ang = -Math.PI / 2 + ((root - pc(tonic) + 12) % 12) * ((Math.PI * 2) / 12);
    return {
      seat: { angle: ang, root, roman: '?', role: 'chromatic', seatIndex: -1 },
      onScale: false,
      shell: true,
      seats,
    };
  }

  /**
   * World position for a chord on a Chase disk.
   * disk: { cx, cy, R }
   */
  function chaseChordPos(chord, tonic, modeKey, disk) {
    disk = disk || { cx: 0, cy: 0, R: 120 };
    const hit = seatForChord(chord, tonic, modeKey);
    const ang = hit.seat.angle;
    const fam = qualityFamily(chord && chord.quality);
    let radius = disk.R * 0.74;
    if (hit.seat.role === 'tonic' && hit.onScale && !hit.shell) radius = disk.R * 0.4;
    // V triad vs V7: same seat angle, different ring so F → F7 is visible on the map
    else if (hit.seat.role === 'dom' && fam === 'dom' && hit.onScale) radius = disk.R * 0.92;
    else if (hit.seat.role === 'dom' && fam === 'maj' && hit.onScale) radius = disk.R * 0.72;
    else if (hit.shell === 'secondary') radius = disk.R * 0.92;
    else if (hit.shell === 'variant') radius = disk.R * 0.82;
    else if (hit.shell === true) radius = disk.R * 1.18;
    const squash = 0.9;
    return {
      x: disk.cx + Math.cos(ang) * radius,
      y: disk.cy + Math.sin(ang) * radius * squash,
      ang,
      radius,
      onScale: hit.onScale,
      shell: hit.shell,
      seat: hit.seat,
      seats: hit.seats,
    };
  }

  /** Fifths-distance between two tonics (−6…+6) for placing a second disk */
  function fifthsDistance(fromTonic, toTonic) {
    const a = pc(fromTonic);
    const b = pc(toTonic);
    // steps of +7 semitones (fifths up)
    let best = 0;
    let bestAbs = 99;
    for (let k = -6; k <= 6; k++) {
      if ((a + ((k * 7) % 12) + 12) % 12 === b) {
        if (Math.abs(k) < bestAbs) {
          bestAbs = Math.abs(k);
          best = k;
        }
      }
    }
    return best;
  }

  /**
   * Default quality for a Chase scale seat (what you hear on hover).
   * Uses true diatonic triads so C major is I ii iii IV V vi vii° — not V7 for V.
   * (V7 and half-dim are still available as colour / inspector options.)
   */
  function seatDefaultQuality(seat, modeKey) {
    if (!seat) return 'maj';
    const mode = MODES[modeKey] || MODES.major;
    const isMin = mode.romanBase === 'minor';
    // Match seat interval → mode degree → DIATONIC_QUALITIES
    if (seat.d != null && mode.degrees) {
      const idx = mode.degrees.indexOf(((seat.d % 12) + 12) % 12);
      if (idx >= 0) {
        const table = DIATONIC_QUALITIES[modeKey] || DIATONIC_QUALITIES.major;
        if (table && table[idx]) {
          // Minor: keep dominant as major/dom7 so V doesn't sound like v
          if (isMin && idx === 4) return 'maj';
          return table[idx];
        }
      }
    }
    if (seat.role === 'leading') return (seat.qualities && seat.qualities[0]) || 'dim';
    if (seat.role === 'supertonic' && /°/.test(String(seat.roman || ''))) {
      return (seat.qualities && seat.qualities[0]) || 'dim';
    }
    if (seat.role === 'dom') return isMin ? 'maj' : 'maj';
    if (seat.role === 'tonic') return isMin ? 'min' : 'maj';
    return (seat.qualities && seat.qualities[0]) || (isMin ? 'min' : 'maj');
  }

  /**
   * Root-forward closed/open-enough voicing for map hover — chord identity first.
   * Jazz spread voicings made V7 and vii° (shared B–D–F) sound almost the same.
   */
  function identityVoicing(chord) {
    if (!chord) return [];
    const root = pc(chord.root);
    const bassPc = chord.bassPc != null ? pc(chord.bassPc) : root;
    const q = QUALITIES[chord.quality] || QUALITIES.maj;
    const ivs = (chord.intervals && chord.intervals.length
      ? chord.intervals
      : q.intervals
    ).slice();
    // Clear bass in low-mid (around E2–C3)
    let bass = 36 + bassPc;
    if (bass < 40) bass += 12;
    if (bass > 52) bass -= 12;
    // Chord tones in order, mid register (~C4 area) so 3rd/5th colour is obvious
    const pcs = ivs.map((iv) => (root + iv) % 12);
    const unique = [];
    pcs.forEach((p) => {
      if (unique.indexOf(p) < 0) unique.push(p);
    });
    const out = [bass];
    let last = bass + 8;
    unique.forEach((p, i) => {
      // Stack from ~G3 upward in close-ish position (ear-friendly)
      let m = Math.floor(55 / 12) * 12 + p;
      while (m <= last) m += 12;
      // First upper: not muddy with bass, not a huge gap
      if (i === 0) {
        while (m - bass < 7) m += 12;
        while (m - bass > 16 && m - 12 > bass + 6) m -= 12;
      } else {
        while (m - last < 2) m += 12;
        // Keep relatively close for triad clarity
        if (m - last > 8 && m - 12 > last) m -= 12;
      }
      out.push(m);
      last = m;
    });
    // Dim / half-dim: make sure b5 is present and not lost under bass
    if (chord.quality === 'dim' || chord.quality === 'halfdim' || chord.quality === 'dim7') {
      const b5 = (root + 6) % 12;
      if (!out.some((m) => m % 12 === b5)) {
        let m = Math.floor(last / 12) * 12 + b5;
        while (m <= last) m += 12;
        out.push(m);
      }
    }
    return normalizeVoicing(out);
  }

  /**
   * Open / spread voicing: bass low, gap to uppers, notes not piled in one octave.
   * Returns MIDI note numbers (low → high).
   */
  function voiceLead(chord, prevMidi, baseOctave = 3) {
    const pcs = (chord.notes || []).map((n) => ((n % 12) + 12) % 12);
    if (!pcs.length) return [];

    const bassPc =
      chord.bassPc != null ? ((chord.bassPc % 12) + 12) % 12 : chord.root;
    const uppers = pcs.filter((p) => p !== bassPc);
    const upperPcs = uppers.length ? uppers : pcs.slice();

    const candidates = [];

    for (let bassOct = 2; bassOct <= 3; bassOct++) {
      let bassMidi = bassOct * 12 + bassPc;
      while (bassMidi < 36) bassMidi += 12;
      while (bassMidi > 50) bassMidi -= 12;

      candidates.push(openStack(bassMidi, upperPcs, 'spread'));
      candidates.push(openStack(bassMidi, upperPcs, 'wide'));
      candidates.push(openStack(bassMidi, upperPcs, 'drop2'));
      candidates.push(openStack(bassMidi, upperPcs, 'lift-top'));
    }

    // Guitar-ish mid bass
    {
      let b = 40 + ((bassPc + 12 - 4) % 12);
      while (b < 38) b += 12;
      while (b > 48) b -= 12;
      candidates.push(openStack(b, upperPcs, 'wide'));
      candidates.push(openStack(b, upperPcs, 'spread'));
    }

    let pool = candidates.filter((c) => c && c.length >= 2);
    if (!pool.length) {
      return spreadForce([36 + bassPc, 48 + bassPc, 55 + (upperPcs[0] || bassPc), 64 + (upperPcs[1] || upperPcs[0] || bassPc)]);
    }

    // Always apply final open pass so nothing plays as a closed cluster
    pool = pool.map((c) => spreadForce(c));

    if (!prevMidi || !prevMidi.length) {
      let best = pool[0];
      let bestScore = -Infinity;
      for (const cand of pool) {
        const sorted = cand.slice().sort((a, b) => a - b);
        bestScore = Math.max(bestScore, scoreOpenVoicing(sorted));
        if (scoreOpenVoicing(sorted) >= bestScore) best = sorted;
      }
      // re-pick cleanly
      bestScore = -Infinity;
      for (const cand of pool) {
        const sorted = cand.slice().sort((a, b) => a - b);
        const sc = scoreOpenVoicing(sorted);
        if (sc > bestScore) {
          bestScore = sc;
          best = sorted;
        }
      }
      return best;
    }

    let best = pool[0];
    let bestCost = Infinity;
    for (const cand of pool) {
      const sorted = cand.slice().sort((a, b) => a - b);
      // Prefer smooth motion but still reward open spacing
      const cost = voicingCost(prevMidi, sorted) - scoreOpenVoicing(sorted) * 0.35;
      if (cost < bestCost) {
        bestCost = cost;
        best = sorted;
      }
    }
    return best;
  }

  function scoreOpenVoicing(sorted) {
    if (!sorted || sorted.length < 2) return 0;
    const bass = sorted[0];
    const top = sorted[sorted.length - 1];
    const span = top - bass;
    let score = 0;
    // Want ~1.5–2.5 octaves of spread
    if (span >= 16 && span <= 32) score += 5;
    else if (span >= 12) score += 2;
    else score -= 6;
    // Gap under first upper (not muddy with bass)
    if (sorted.length > 1) {
      const gap = sorted[1] - bass;
      if (gap >= 10 && gap <= 19) score += 4;
      else if (gap >= 7) score += 1;
      else score -= 5;
    }
    // Even-ish spacing between uppers
    for (let i = 2; i < sorted.length; i++) {
      const d = sorted[i] - sorted[i - 1];
      if (d >= 3 && d <= 9) score += 1.2;
      if (d < 3) score -= 2;
    }
    if (top >= 67 && top <= 81) score += 3;
    if (bass >= 36 && bass <= 50) score += 2;
    if (bass < 34) score -= 2;
    if (top > 86) score -= 3;
    return score;
  }

  /**
   * Force open layout: low bass, gap, spread uppers (no closed triads in one octave).
   */
  function spreadForce(midi) {
    let s = normalizeVoicing(midi);
    if (s.length < 2) return s;
    // Bass in comfortable low range
    while (s[0] < 36) s[0] += 12;
    while (s[0] > 50) s[0] -= 12;
    const bass = s[0];
    // Rebuild uppers above bass with air between them
    const pcs = s.slice(1).map((m) => ((m % 12) + 12) % 12);
    const unique = [];
    pcs.forEach((p) => {
      if (unique.indexOf(p) < 0) unique.push(p);
    });
    // Sort by interval above bass (circular)
    unique.sort((a, b) => {
      const da = (a - (bass % 12) + 12) % 12 || 12;
      const db = (b - (bass % 12) + 12) % 12 || 12;
      return da - db;
    });

    const out = [bass];
    let last = bass + 9; // start looking ~major 6th / minor 7th above bass
    unique.forEach((pc, i) => {
      let m = Math.floor(last / 12) * 12 + pc;
      while (m <= last) m += 12;
      // First upper: at least a 7th above bass when possible
      if (i === 0) {
        while (m - bass < 7) m += 12;
        // Prefer 10–16 above bass for openness
        if (m - bass < 10 && m + 12 < 84) m += 12;
      } else {
        // Keep thirds/fourths from collapsing — prefer ≥3, open to ≥5 if cramped
        while (m - last < 3) m += 12;
        if (m - last < 4 && m + 12 <= 84) m += 12;
      }
      out.push(m);
      last = m;
    });

    // If only 2–3 notes, push top up for air
    if (out.length >= 2 && out[out.length - 1] - out[0] < 16) {
      out[out.length - 1] += 12;
    }
    // 4-note: drop-2 colour — second from top down an octave if still open enough
    if (out.length >= 4) {
      const trial = out.slice();
      trial[trial.length - 2] -= 12;
      trial.sort((a, b) => a - b);
      if (trial[1] - trial[0] >= 7 && trial[trial.length - 1] - trial[0] >= 14) {
        return normalizeVoicing(trial);
      }
    }
    // Cap top
    while (Math.max.apply(null, out) > 86) {
      for (let i = 1; i < out.length; i++) {
        if (out[i] > 62) out[i] -= 12;
      }
      out.sort((a, b) => a - b);
    }
    for (let i = 1; i < out.length; i++) {
      while (out[i] <= out[0]) out[i] += 12;
    }
    return normalizeVoicing(out);
  }

  /** Build open upper structure above a fixed bass MIDI note. */
  function openStack(bassMidi, upperPcs, style) {
    if (!upperPcs.length) return [bassMidi];
    const ordered = upperPcs.slice().sort((a, b) => a - b);
    let notes = [bassMidi];
    let last = bassMidi;

    if (style === 'drop2' && ordered.length >= 3) {
      const high = [];
      let cur = 62;
      ordered.forEach((pc) => {
        let m = Math.floor(cur / 12) * 12 + pc;
        while (m < 57) m += 12;
        while (high.length && m <= high[high.length - 1]) m += 12;
        high.push(m);
        cur = m;
      });
      high.sort((a, b) => a - b);
      if (high.length >= 2) high[high.length - 2] -= 12;
      high.sort((a, b) => a - b);
      const fixed = high.map((m) => {
        let x = m;
        while (x <= bassMidi + 6) x += 12;
        return x;
      });
      return spreadForce([bassMidi].concat(fixed));
    }

    // wide: big gaps; spread: moderate open; lift-top: closed then lift
    const minGap =
      style === 'wide' ? 5 : style === 'spread' ? 4 : 3;
    const firstMin =
      style === 'wide' ? 12 : style === 'spread' ? 10 : 7;

    ordered.forEach((pc, i) => {
      let m = Math.floor(last / 12) * 12 + pc;
      while (m <= last) m += 12;
      if (i === 0) {
        while (m - bassMidi < firstMin) m += 12;
      } else {
        while (m - last < minGap) m += 12;
      }
      notes.push(m);
      last = m;
    });

    if (style === 'lift-top' || style === 'spread' || style === 'wide') {
      notes = liftUpperStructure(notes);
    }
    return spreadForce(notes);
  }

  /** Raise top voices so the chord isn't a low mud cluster. */
  function liftUpperStructure(midi) {
    const s = midi.slice().sort((a, b) => a - b);
    if (s.length < 2) return s;
    const bass = s[0];
    let top = s[s.length - 1];
    let guard = 0;
    while (top < 69 && guard < 4) {
      for (let i = 1; i < s.length; i++) s[i] += 12;
      top = s[s.length - 1];
      guard++;
    }
    while (top - bass < 16 && guard < 6) {
      s[s.length - 1] += 12;
      if (s.length > 3) s[s.length - 2] += 12;
      top = s[s.length - 1];
      guard++;
    }
    while (Math.max.apply(null, s) > 86) {
      for (let i = 1; i < s.length; i++) {
        if (s[i] > 62) s[i] -= 12;
      }
    }
    for (let i = 1; i < s.length; i++) {
      while (s[i] <= bass + 6) s[i] += 12;
    }
    return s.sort((a, b) => a - b);
  }

  function normalizeVoicing(midi) {
    const s = midi.slice().sort((a, b) => a - b);
    // unique
    const out = [];
    s.forEach((m) => {
      if (!out.length || out[out.length - 1] !== m) out.push(m);
    });
    return out;
  }

  function voicingCost(a, b) {
    const A = a.slice().sort((x, y) => x - y);
    const B = b.slice().sort((x, y) => x - y);
    const n = Math.max(A.length, B.length);
    let cost = 0;
    for (let i = 0; i < n; i++) {
      const va = A[Math.min(i, A.length - 1)];
      const vb = B[Math.min(i, B.length - 1)];
      cost += Math.abs(va - vb);
    }
    // Prefer open-ish span (not muddy clusters)
    const span = Math.max(...B) - Math.min(...B);
    if (span < 16) cost += (16 - span) * 1.1;
    if (span > 34) cost += (span - 34) * 0.12;
    // Prefer top voice not buried
    const top = Math.max(...B);
    if (top < 67) cost += (67 - top) * 0.4;
    // Prefer gap under first upper
    if (B.length > 1 && B[1] - B[0] < 8) cost += (8 - (B[1] - B[0])) * 0.9;
    return cost;
  }

  /** Voice-leading smoothness score (lower = smoother), 0–1 inverted to quality */
  function voiceLeadingQuality(fromChord, toChord) {
    const a = voiceLead(fromChord, null);
    const b = voiceLead(toChord, a);
    const cost = voicingCost(a, b);
    // ~0–24 typical; map to 0–1 quality
    return Math.max(0, Math.min(1, 1 - cost / 28));
  }

  /**
   * Ways back home: short paths (2–4 chords) from current chord to tonic,
   * with different characters.
   */
  function waysBackHome(fromChord, tonic, modeKey, count = 5) {
    const t = pc(tonic);
    const isMinor = (MODES[modeKey] || MODES.minor).romanBase === 'minor';
    const tonicChord = makeChord(t, isMinor ? 'min' : 'maj', {
      region: 'diatonic',
      roman: isMinor ? 'i' : 'I',
      tag: 'home',
    });
    const diat = diatonicChords(tonic, modeKey, true);
    const v7 = diat[4] ? { ...diat[4], quality: isMinor && modeKey === 'minor' ? 'dom7' : diat[4].quality } : makeChord((t + 7) % 12, 'dom7');
    // Prefer V7 in minor for strong cadence
    const dominant = makeChord((t + 7) % 12, 'dom7', { region: 'diatonic', roman: 'V7', tag: 'dominant' });
    const subdom = diat[3] || makeChord((t + 5) % 12, isMinor ? 'min' : 'maj');
    const bII7 = makeChord((t + 1) % 12, 'dom7', { region: 'tritone', roman: '♭II7', tag: 'tritone' });
    const bVI = makeChord((t + 8) % 12, 'maj', { region: 'interchange', roman: '♭VI', tag: 'interchange' });
    const bVII = makeChord((t + 10) % 12, 'maj', { region: 'diatonic', roman: '♭VII', tag: 'modal' });
    const ii = diat[1] || makeChord((t + 2) % 12, 'dim');
    const iv = diat[3];
    const VI = diat[5];

    const dimAsV = makeChord((t + 11) % 12, 'dim7', {
      region: 'diminished',
      roman: 'vii°7',
      tag: 'dim7 as V7b9',
    });
    const bVII7 = makeChord((t + 10) % 12, 'dom7', {
      region: 'interchange',
      roman: '♭VII7',
      tag: 'backdoor dominant',
    });
    const vOfV = makeChord((t + 2) % 12, 'dom7', {
      region: 'secondary',
      roman: 'V7/V',
      tag: 'secondary dominant',
    });
    const iiOfV = makeChord((t + 9) % 12, 'min7', {
      region: 'secondary',
      roman: 'ii/V',
      tag: 'secondary ii',
    });
    const V7alt = makeChord((t + 7) % 12, 'dom7alt', {
      region: 'flavour',
      roman: 'V7alt',
      tag: 'altered dominant',
    });

    const routes = [
      {
        name: 'Authentic cadence',
        character: 'strong / classical',
        chords: [dominant, tonicChord],
      },
      {
        name: 'Plagal colour',
        character: 'soft / amen',
        chords: [subdom, tonicChord],
      },
      {
        name: 'ii–V–i',
        character: 'jazzy / smooth',
        chords: [
          makeChord(ii.root, ii.quality === 'dim' ? 'halfdim' : 'min7', { region: ii.region, roman: 'ii', tag: 'ii' }),
          dominant,
          tonicChord,
        ],
      },
      {
        name: 'Tritone approach',
        character: 'dark / surprising',
        chords: [bII7, tonicChord],
      },
      {
        name: 'Modal descent',
        character: 'epic / rock',
        chords: [bVII, bVI, tonicChord].filter(Boolean),
      },
      {
        name: 'Deceptive then home',
        character: 'storytelling',
        chords: [
          dominant,
          VI || makeChord((t + 8) % 12, 'maj'),
          subdom,
          tonicChord,
        ],
      },
      {
        name: 'Chromatic mediant return',
        character: 'cinematic',
        chords: [
          makeChord((fromChord.root + 4) % 12, fromChord.quality.includes('min') ? 'min' : 'maj', {
            region: 'chromatic',
            tag: 'CM',
          }),
          dominant,
          tonicChord,
        ],
      },
      {
        name: 'Backdoor ♭VII7–I',
        character: 'gospel / soul',
        chords: [bVII7, tonicChord],
      },
      {
        name: 'Delayed ii/V–V7/V–V7–I',
        character: 'jazz turnaround',
        chords: [iiOfV, vOfV, dominant, tonicChord],
      },
      {
        name: 'Dim7 (as V7♭9) → I',
        character: 'classical dim approach',
        chords: [dimAsV, tonicChord],
      },
      {
        name: 'V7alt–I',
        character: 'jazz altered',
        chords: [V7alt, tonicChord],
      },
    ];

    // Score routes: prefer smooth VL from current, variety of length
    const scored = routes.map((r) => {
      const first = r.chords[0];
      const vl = voiceLeadingQuality(fromChord, first);
      const endsHome = r.chords[r.chords.length - 1].root === t;
      return { ...r, score: vl + (endsHome ? 0.3 : 0), vl };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, count).map((r, i) => ({
      id: `route-${i}`,
      name: r.name,
      character: r.character,
      chords: r.chords.map((c, j) => withDuration({ ...c, notes: c.notes.slice() }, j === r.chords.length - 1 ? 4 : 2)),
    }));
  }

  /** Simple rhythm suggestion patterns (beats per chord for n chords) */
  function rhythmSuggestions(n) {
    const patterns = {
      2: [
        { name: 'Even', beats: [4, 4] },
        { name: 'Long–short', beats: [6, 2] },
        { name: 'Short–long', beats: [2, 6] },
      ],
      3: [
        { name: 'Even', beats: [4, 4, 4] },
        { name: 'Push last', beats: [3, 3, 2] },
        { name: 'Hold home', beats: [2, 2, 4] },
      ],
      4: [
        { name: 'Even bars', beats: [4, 4, 4, 4] },
        { name: 'Half-time feel', beats: [8, 8, 8, 8] },
        { name: 'Syncopated', beats: [3, 3, 2, 4] },
        { name: 'Anticipation', beats: [4, 4, 3, 1] },
        { name: 'Double time end', beats: [4, 4, 2, 2] },
        { name: 'Pedal stretch', beats: [2, 2, 4, 8] },
      ],
      5: [
        { name: 'Even', beats: [4, 4, 4, 4, 4] },
        { name: 'Group 3+2', beats: [4, 4, 4, 4, 8] },
      ],
      6: [
        { name: 'Even', beats: [4, 4, 4, 4, 4, 4] },
        { name: 'Phrase 4+2', beats: [4, 4, 4, 4, 4, 4] },
      ],
    };
    if (patterns[n]) return patterns[n];
    // generic even
    return [{ name: 'Even', beats: Array(n).fill(4) }];
  }

  function applyRhythm(chords, beats) {
    return chords.map((c, i) => withDuration(c, beats[i] != null ? beats[i] : c.duration));
  }

  function formatChordList(chords, bpm = 120) {
    const lines = chords.map((c, i) => {
      const bars = (c.duration / 4).toFixed(c.duration % 4 === 0 ? 0 : 2);
      const beats = c.duration;
      const bass = c.bassPc != null ? c.bassPc : c.root;
      const bassStr = bass !== c.root ? ` bass ${noteName(bass)}` : '';
      return `${i + 1}. ${String(c.name).padEnd(12)}  ${beats} beats (${bars} bar${bars === '1' ? '' : 's'})  [${c.notes.map((n) => noteName(n)).join(' ')}]${bassStr}${c.roman ? '  ' + c.roman : ''}${c.tag ? '  · ' + c.tag : ''}`;
    });
    const totalBeats = chords.reduce((s, c) => s + c.duration, 0);
    const totalBars = totalBeats / 4;
    const secs = (totalBeats * 60) / bpm;
    return [
      `Harmonic Landscape export — ${bpm} BPM`,
      `Total: ${totalBeats} beats · ${totalBars} bars · ~${secs.toFixed(1)}s`,
      '',
      ...lines,
    ].join('\n');
  }

  function cloneChord(c) {
    return {
      ...c,
      notes: (c.notes || []).slice(),
      intervals: (c.intervals || []).slice(),
      bassPc: c.bassPc != null ? c.bassPc : c.root,
      localTonic: c.localTonic,
      localMode: c.localMode,
      custom: !!c.custom || c.quality === 'custom',
      name: c.name,
      id: (c.id || 'ch') + ':' + Math.random().toString(36).slice(2, 7),
    };
  }

  global.HLMusic = {
    NOTE_NAMES,
    FLAT_NAMES,
    QUALITIES,
    MODES,
    pc,
    noteName,
    makeChord,
    makeCustomChord,
    withDuration,
    diatonicChords,
    secondaryDominants,
    primaryDominant,
    modalInterchange,
    functionNeighborhood,
    keyPrefersFlat,
    chromaticMediants,
    tritoneSubOfDominant,
    tritoneSubs,
    secondaryIiVs,
    secondaryIiVChords,
    diminishedStrand,
    diminishedStrandChords,
    vAlternatives,
    parallelModeChords,
    fullPalette,
    allPaletteChords,
    progressionStrands,
    harmonicDistance,
    harmonicAngle,
    circularHarmonicScale,
    seatDefaultQuality,
    seatForChord,
    chaseChordPos,
    fifthsDistance,
    qualityFamily,
    identityVoicing,
    voiceLead,
    voiceLeadingQuality,
    waysBackHome,
    rhythmSuggestions,
    applyRhythm,
    formatChordList,
    cloneChord,
    dedupeChords,
  };
})(typeof window !== 'undefined' ? window : globalThis);
