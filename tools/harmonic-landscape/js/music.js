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
      region: opts.region || 'diatonic', // diatonic | secondary | interchange | chromatic | tritone | parallel
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

  /** Secondary dominants: V/x for each non-tonic diatonic target */
  function secondaryDominants(tonic, modeKey) {
    const diat = diatonicChords(tonic, modeKey, false);
    const out = [];
    diat.forEach((ch, i) => {
      if (i === 0) return;
      const domRoot = (ch.root + 7) % 12;
      out.push(makeChord(domRoot, 'dom7', {
        region: 'secondary',
        roman: `V7/${ch.roman || noteName(ch.root)}`,
        tag: 'secondary dominant',
      }));
    });
    return out;
  }

  /** Modal interchange from parallel major/minor */
  function modalInterchange(tonic, modeKey) {
    const t = pc(tonic);
    const isMinor = (MODES[modeKey] || MODES.minor).romanBase === 'minor';
    const parallel = isMinor ? 'major' : 'minor';
    const fromParallel = diatonicChords(t, parallel, false);
    const homeSet = new Set(diatonicChords(t, modeKey, false).map((c) => c.root + ':' + c.quality));
    return fromParallel
      .filter((c) => !homeSet.has(c.root + ':' + c.quality))
      .map((c) => ({
        ...c,
        region: 'interchange',
        tag: 'modal interchange',
        roman: c.roman ? `${c.roman}♭` : '',
        id: c.id + ':int',
      }));
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

  /** Tritone substitution of V7 */
  function tritoneSubs(tonic, modeKey) {
    const diat = diatonicChords(tonic, modeKey, false);
    const v = diat[4];
    if (!v) return [];
    const subRoot = (v.root + 6) % 12;
    return [
      makeChord(subRoot, 'dom7', {
        region: 'tritone',
        tag: 'tritone sub',
        roman: '♭II7',
      }),
    ];
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
    return {
      diatonic: diatonicChords(tonic, modeKey, sevenths),
      secondary: secondaryDominants(tonic, modeKey),
      interchange: modalInterchange(tonic, modeKey),
      chromatic: chromaticMediants(tonic, modeKey),
      tritone: tritoneSubs(tonic, modeKey),
      parallel: parallelModeChords(tonic, modeKey),
    };
  }

  function allPaletteChords(tonic, modeKey, sevenths = true) {
    const p = fullPalette(tonic, modeKey, sevenths);
    return dedupeChords([
      ...p.diatonic,
      ...p.secondary,
      ...p.interchange,
      ...p.chromatic,
      ...p.tritone,
      ...p.parallel,
    ]);
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
          { d: 0, qualities: ['maj', 'maj7', 'add9', 'maj9'], roman: 'I', role: 'tonic' },
          { d: 5, qualities: ['maj', 'maj7'], roman: 'IV', role: 'subdom' },
          { d: 11, qualities: ['dim', 'halfdim'], roman: 'vii°', role: 'leading' },
          { d: 4, qualities: ['min', 'min7'], roman: 'iii', role: 'mediant' },
          { d: 9, qualities: ['min', 'min7'], roman: 'vi', role: 'submed' },
          { d: 2, qualities: ['min', 'min7'], roman: 'ii', role: 'supertonic' },
          { d: 7, qualities: ['dom7', 'maj', 'maj7'], roman: 'V', role: 'dom' },
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
    if (q.indexOf('dom') === 0 || q === '7') return 'dom';
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
    let radius = disk.R * 0.72;
    if (hit.seat.role === 'tonic' && hit.onScale && !hit.shell) radius = disk.R * 0.42;
    else if (hit.shell === 'secondary') radius = disk.R * 0.9;
    else if (hit.shell === 'variant') radius = disk.R * 0.8;
    else if (hit.shell === true) radius = disk.R * 1.12;
    const squash = 0.88;
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
   * Open voicing with bass in low-mid register and upper structure lifted.
   * Avoids muddy closed clusters; top voices sit in a clearer register.
   * Returns MIDI note numbers (low → high).
   */
  function voiceLead(chord, prevMidi, baseOctave = 3) {
    const pcs = (chord.notes || []).map((n) => ((n % 12) + 12) % 12);
    if (!pcs.length) return [];

    const bassPc =
      chord.bassPc != null ? ((chord.bassPc % 12) + 12) % 12 : chord.root;
    const uppers = pcs.filter((p) => p !== bassPc);
    // If bass is not a chord tone, still keep full upper set
    const upperPcs = uppers.length ? uppers : pcs.slice();

    const candidates = [];

    // Several open layouts: closed-then-lift, drop-2 style, wide spread
    for (let bassOct = 2; bassOct <= 3; bassOct++) {
      let bassMidi = bassOct * 12 + bassPc;
      while (bassMidi < 38) bassMidi += 12;
      while (bassMidi > 52) bassMidi -= 12;

      candidates.push(openStack(bassMidi, upperPcs, 'lift-top'));
      candidates.push(openStack(bassMidi, upperPcs, 'spread'));
      candidates.push(openStack(bassMidi, upperPcs, 'drop2'));
      // One octave higher upper structure
      const high = openStack(bassMidi, upperPcs, 'lift-top').map((m, i) =>
        i === 0 ? m : m + 12
      );
      candidates.push(normalizeVoicing(high));
    }

    // Extra mid-bass open candidate
    {
      let b = 45 + bassPc;
      while (b > 52) b -= 12;
      while (b < 40) b += 12;
      candidates.push(openStack(b, upperPcs, 'spread'));
    }

    let pool = candidates.filter((c) => c && c.length);
    if (!pool.length) {
      return [48 + bassPc, 60 + upperPcs[0], 67 + (upperPcs[1] || upperPcs[0])];
    }

    if (!prevMidi || !prevMidi.length) {
      // Prefer open, top around C5–A5, bass not muddy
      let best = pool[0];
      let bestScore = -Infinity;
      for (const cand of pool) {
        const sorted = cand.slice().sort((a, b) => a - b);
        const top = sorted[sorted.length - 1];
        const bass = sorted[0];
        const span = top - bass;
        let score = 0;
        if (span >= 14 && span <= 28) score += 3;
        if (top >= 64 && top <= 79) score += 3;
        if (bass >= 40 && bass <= 52) score += 2;
        if (span < 10) score -= 4;
        score -= Math.abs(top - 72) * 0.05;
        if (score > bestScore) {
          bestScore = score;
          best = sorted;
        }
      }
      return best;
    }

    let best = pool[0];
    let bestCost = Infinity;
    for (const cand of pool) {
      const sorted = cand.slice().sort((a, b) => a - b);
      const cost = voicingCost(prevMidi, sorted);
      if (cost < bestCost) {
        bestCost = cost;
        best = sorted;
      }
    }
    return best;
  }

  /** Build open upper structure above a fixed bass MIDI note. */
  function openStack(bassMidi, upperPcs, style) {
    if (!upperPcs.length) return [bassMidi];
    // Order uppers as ascending pitch-classes from above bass
    const ordered = upperPcs.slice().sort((a, b) => a - b);
    // Rotate so first upper sits a bit above bass
    let notes = [bassMidi];
    let last = bassMidi;

    if (style === 'drop2' && ordered.length >= 3) {
      // Build closed high then drop second from top by octave
      const high = [];
      let cur = 60;
      ordered.forEach((pc) => {
        let m = Math.floor(cur / 12) * 12 + pc;
        while (m < 55) m += 12;
        while (high.length && m <= high[high.length - 1]) m += 12;
        high.push(m);
        cur = m;
      });
      // sort high, drop 2nd from top
      high.sort((a, b) => a - b);
      if (high.length >= 2) high[high.length - 2] -= 12;
      high.sort((a, b) => a - b);
      // ensure all above bass
      const fixed = high.map((m) => {
        let x = m;
        while (x <= bassMidi) x += 12;
        return x;
      });
      return normalizeVoicing([bassMidi].concat(fixed));
    }

    ordered.forEach((pc, i) => {
      let m = Math.floor(last / 12) * 12 + pc;
      while (m <= last) m += 12;
      // Prefer not stacking every third tight — leave room
      if (style === 'spread' && i > 0 && m - last < 4) m += 12;
      notes.push(m);
      last = m;
    });

    if (style === 'lift-top' || style === 'spread') {
      notes = liftUpperStructure(notes);
    }
    return normalizeVoicing(notes);
  }

  /** Raise top voices so the chord isn't a low mud cluster. */
  function liftUpperStructure(midi) {
    const s = midi.slice().sort((a, b) => a - b);
    if (s.length < 2) return s;
    const bass = s[0];
    // Lift everything except bass until top clears a clear register
    let top = s[s.length - 1];
    let guard = 0;
    while (top < 67 && guard < 4) {
      for (let i = 1; i < s.length; i++) s[i] += 12;
      top = s[s.length - 1];
      guard++;
    }
    // Ensure minimum span ~ octave+ for colour
    while (top - bass < 14 && guard < 6) {
      s[s.length - 1] += 12;
      if (s.length > 3) s[s.length - 2] += 12;
      top = s[s.length - 1];
      guard++;
    }
    // Cap screamingly high tops
    while (Math.max(...s) > 84) {
      for (let i = 1; i < s.length; i++) {
        if (s[i] > 60) s[i] -= 12;
      }
    }
    // Keep bass under uppers
    for (let i = 1; i < s.length; i++) {
      while (s[i] <= bass) s[i] += 12;
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
    if (span < 12) cost += (12 - span) * 0.8;
    if (span > 30) cost += (span - 30) * 0.15;
    // Prefer top voice not buried
    const top = Math.max(...B);
    if (top < 64) cost += (64 - top) * 0.35;
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
    modalInterchange,
    chromaticMediants,
    tritoneSubs,
    parallelModeChords,
    fullPalette,
    allPaletteChords,
    harmonicDistance,
    harmonicAngle,
    circularHarmonicScale,
    seatForChord,
    chaseChordPos,
    fifthsDistance,
    qualityFamily,
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
