/* Chord Finder — standalone phone-first PWA */
(function () {
  'use strict';

  var STORE_KEY = 'ih_chordfinder_v1';
  var NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  var NOTE_NAMES_FLAT  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  // Prefer flats for these display pcs when naming chords commonly
  var PREFER_FLAT = { 1: 1, 3: 1, 6: 1, 8: 1, 10: 1 };

  // String index 0 = low E (bass), 5 = high E — display top-to-bottom high→low like a neck facing you
  // Internal state uses bass→treble (0=low E). UI row 0 = high E = string 5.
  var STRING_COUNT = 6;
  var FRET_WINDOW = 5; // frets shown besides nut when start=0 → 0..5
  var MAX_FRET = 12;

  var PRESETS = [
    { id: 'standard', name: 'Standard', pcs: [4, 9, 2, 7, 11, 4], label: 'E A D G B E' },
    { id: 'dropd', name: 'Drop D', pcs: [2, 9, 2, 7, 11, 4], label: 'D A D G B E' },
    { id: 'dadgad', name: 'DADGAD', pcs: [2, 9, 2, 7, 9, 2], label: 'D A D G A D' },
    { id: 'openg', name: 'Open G', pcs: [2, 7, 2, 7, 11, 2], label: 'D G D G B D' },
    { id: 'halfdown', name: '½-step down', pcs: [3, 8, 1, 6, 10, 3], label: 'Eb Ab Db Gb Bb Eb' }
  ];

  var QUALITIES = [
    { id: 'maj', label: 'maj', intervals: [0, 4, 7], name: '' },
    { id: 'min', label: 'min', intervals: [0, 3, 7], name: 'm' },
    { id: '7', label: '7', intervals: [0, 4, 7, 10], name: '7' },
    { id: 'maj7', label: 'maj7', intervals: [0, 4, 7, 11], name: 'maj7' },
    { id: 'm7', label: 'm7', intervals: [0, 3, 7, 10], name: 'm7' },
    { id: 'dim', label: 'dim', intervals: [0, 3, 6], name: 'dim' },
    { id: 'sus2', label: 'sus2', intervals: [0, 2, 7], name: 'sus2' },
    { id: 'sus4', label: 'sus4', intervals: [0, 5, 7], name: 'sus4' }
  ];

  // Extra formulas for better neck detection (not in quick-pick)
  var DETECT_EXTRA = [
    { intervals: [0, 4, 8], name: 'aug', rank: 3 },
    { intervals: [0, 3, 6, 9], name: 'dim7', rank: 3 },
    { intervals: [0, 3, 6, 10], name: 'm7b5', rank: 3 },
    { intervals: [0, 4, 7, 9], name: '6', rank: 4 },
    { intervals: [0, 3, 7, 9], name: 'm6', rank: 4 },
    { intervals: [0, 4, 7, 10, 14 % 12], name: '9', rank: 5 },
    { intervals: [0, 2, 4, 7], name: 'add9', rank: 5 },
    { intervals: [0, 3, 7, 10, 2], name: 'm9', rank: 5 },
    { intervals: [0, 4, 7, 11, 2], name: 'maj9', rank: 5 },
    { intervals: [0, 5, 7, 10], name: '7sus4', rank: 4 },
    { intervals: [0, 4, 10], name: '7', rank: 6 }, // no 5th
    { intervals: [0, 3, 10], name: 'm7', rank: 6 },
    { intervals: [0, 4], name: '', rank: 8 },
    { intervals: [0, 3], name: 'm', rank: 8 }
  ];

  var SCALES = [
    // common: ionian/aeolian >> dorian/mixo >> others; rare modes stay low
    { id: 'major', name: 'major', short: 'major', mode: 'major', intervals: [0, 2, 4, 5, 7, 9, 11], common: 120 },
    { id: 'minor', name: 'natural minor', short: 'minor', mode: 'minor', intervals: [0, 2, 3, 5, 7, 8, 10], common: 115 },
    { id: 'dorian', name: 'dorian', short: 'dorian', mode: 'minor', intervals: [0, 2, 3, 5, 7, 9, 10], common: 70 },
    { id: 'mixolydian', name: 'mixolydian', short: 'mixolydian', mode: 'major', intervals: [0, 2, 4, 5, 7, 9, 10], common: 70 },
    { id: 'harmonic', name: 'harmonic minor', short: 'harm. minor', mode: 'minor', intervals: [0, 2, 3, 5, 7, 8, 11], common: 55 },
    { id: 'melodic', name: 'melodic minor', short: 'mel. minor', mode: 'minor', intervals: [0, 2, 3, 5, 7, 9, 11], common: 48 },
    { id: 'majpent', name: 'major pentatonic', short: 'maj pent', mode: 'major', intervals: [0, 2, 4, 7, 9], common: 42 },
    { id: 'minpent', name: 'minor pentatonic', short: 'min pent', mode: 'minor', intervals: [0, 3, 5, 7, 10], common: 42 },
    { id: 'blues', name: 'blues', short: 'blues', mode: 'minor', intervals: [0, 3, 5, 6, 7, 10], common: 35 },
    { id: 'lydian', name: 'lydian', short: 'lydian', mode: 'major', intervals: [0, 2, 4, 6, 7, 9, 11], common: 18 },
    { id: 'phrygian', name: 'phrygian', short: 'phrygian', mode: 'minor', intervals: [0, 1, 3, 5, 7, 8, 10], common: 14 },
    { id: 'locrian', name: 'locrian', short: 'locrian', mode: 'minor', intervals: [0, 1, 3, 5, 6, 8, 10], common: 8 }
  ];

  var state = {
    presetId: 'standard',
    offsets: [0, 0, 0, 0, 0, 0], // per-string semitone adjust
    // per string: null = muted, 0 = open, 1..12 = fret
    frets: [null, null, null, null, null, null],
    startFret: 0,
    selectedNameIndex: 0,
    names: [],
    chords: [], // { id, name, root, quality, pcs: number[], clash: bool, source }
    topKey: null, // { root, scaleId, name }
    clashMsg: '',
    clashTimer: null,
    selectedTile: null,
    quickRoot: 0,
    quickQuality: 'maj',
    selectedScale: null, // { root, scaleId } for notes view / neck highlight
    _fits: [],
    _near: [],
    noExactFit: false,
    closestMsg: ''
  };

  function $(id) { return document.getElementById(id); }

  function noteName(pc, preferFlat) {
    pc = ((pc % 12) + 12) % 12;
    if (preferFlat == null) preferFlat = !!PREFER_FLAT[pc];
    return (preferFlat ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP)[pc];
  }

  function noteNameDual(pc) {
    pc = ((pc % 12) + 12) % 12;
    var sh = NOTE_NAMES_SHARP[pc];
    var fl = NOTE_NAMES_FLAT[pc];
    if (sh === fl) return sh;
    return sh + '/' + fl;
  }

  // Spell chord tones from root using interval letters (aug 5th = #5, etc.)
  var LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  var LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  function rootLetterPrefer(pc, preferFlat) {
    var n = noteName(pc, preferFlat);
    return n.charAt(0);
  }

  function spellPcFromRoot(pc, root, qualityName) {
    pc = ((pc % 12) + 12) % 12;
    root = ((root % 12) + 12) % 12;
    // Prefer sharp spelling for aug/# qualities; flat for dim/b/min-ish
    var preferFlat = true;
    var q = qualityName || '';
    if (/aug|maj|#|sus2/.test(q) && !/dim|m7b5|b5/.test(q)) preferFlat = false;
    if (q === '' || q === 'maj7' || q === '6' || q === '7' || q === '9' || q === 'add9') preferFlat = !!PREFER_FLAT[root] ? false : false;
    // Natural roots usually sharp-side for maj; flats for F Bb Eb Ab
    if (!q || q === '' || q.indexOf('m') !== 0) {
      preferFlat = (root === 5 || root === 10 || root === 3 || root === 8); // F Bb Eb Ab
    }
    if (/^m/.test(q) || q === 'dim' || q === 'm7' || q === 'm6' || q === 'm9' || q === 'm7b5') {
      preferFlat = true;
    }
    if (q === 'aug') preferFlat = false;

    var rootName = noteName(root, preferFlat);
    var rootL = rootName.charAt(0);
    var rootIdx = LETTERS.indexOf(rootL);
    var iv = (pc - root + 12) % 12;
    // Map interval class to scale degree letter offset
    // Semitone → diatonic letter steps from tonic
    var degMap = {
      0: 0, 1: 1, 2: 1, 3: 2, 4: 2, 5: 3,
      6: 4, 7: 4, 8: 5, 9: 5, 10: 6, 11: 6
    };
    // For aug: #5 should be letter of 5th raised
    if (q === 'aug' && iv === 8) degMap = { 0: 0, 4: 2, 8: 4 };
    if (q === 'dim' && iv === 6) { /* b5 */ }

    var deg = degMap[iv];
    if (deg == null) deg = 0;
    var letter = LETTERS[(rootIdx + deg) % 7];
    var natural = LETTER_PC[letter];
    // Accidental relative to natural letter near root octave
    // Find which accidental makes natural+acc = pc, allowing wrap
    var best = null;
    for (var acc = -2; acc <= 2; acc++) {
      if (((natural + acc) % 12 + 12) % 12 === pc) {
        best = acc;
        break;
      }
    }
    if (best == null) return noteName(pc, preferFlat);
    if (best === 0) return letter;
    if (best === 1) return letter + '#';
    if (best === 2) return letter + '##';
    if (best === -1) return letter + 'b';
    if (best === -2) return letter + 'bb';
    return noteName(pc, preferFlat);
  }

  function spellChordDisplay(root, qualityName, bass) {
    var q = qualityName || '';
    var rootSp = spellPcFromRoot(root, root, q);
    var disp;
    if (!q) disp = rootSp;
    else if (q === 'm' || q.indexOf('m') === 0 || q.indexOf('dim') === 0 || q.indexOf('aug') === 0 || q.indexOf('sus') === 0)
      disp = rootSp + q;
    else disp = rootSp + q;
    if (bass != null && bass !== root) {
      disp += '/' + spellPcFromRoot(bass, root, q);
    }
    return disp;
  }

  function accidentalCount(name) {
    var n = 0;
    for (var i = 0; i < name.length; i++) {
      var c = name.charAt(i);
      if (c === '#' || c === 'b') n++;
    }
    return n;
  }

  function stringPitch(s) {
    var tun = tuningPcs();
    var f = state.frets[s];
    if (f === null || f === undefined) return null;
    return (tun[s] + (f | 0)) % 12;
  }

  function tuningPcs() {
    var base = PRESETS.find(function (p) { return p.id === state.presetId; }) || PRESETS[0];
    return base.pcs.map(function (pc, i) {
      return (((pc + (state.offsets[i] || 0)) % 12) + 12) % 12;
    });
  }

  function soundingPcs() {
    var tun = tuningPcs();
    var out = [];
    var bass = null;
    for (var s = 0; s < STRING_COUNT; s++) {
      var f = state.frets[s];
      if (f === null || f === undefined) continue;
      var pc = (tun[s] + (f | 0)) % 12;
      out.push(pc);
      if (bass === null) bass = pc; // lowest string index first = bass
    }
    return { pcs: uniq(out), all: out, bass: bass };
  }

  function uniq(arr) {
    var seen = {};
    var o = [];
    for (var i = 0; i < arr.length; i++) {
      if (!seen[arr[i]]) { seen[arr[i]] = 1; o.push(arr[i]); }
    }
    return o;
  }

  function setEq(a, b) {
    if (a.length !== b.length) return false;
    var sa = a.slice().sort(function (x, y) { return x - y; });
    var sb = b.slice().sort(function (x, y) { return x - y; });
    for (var i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false;
    return true;
  }

  function subset(needles, hay) {
    var set = {};
    for (var i = 0; i < hay.length; i++) set[hay[i]] = 1;
    for (var j = 0; j < needles.length; j++) if (!set[needles[j]]) return false;
    return true;
  }

  // Sounded pcs must match the formula exactly. The perfect 5th (interval 7)
  // may be omitted; no other formula tones may be missing, and sounded notes
  // may not include anything outside the formula (no "added" 7ths etc.).
  function formulaFitsSounded(pcs, root, intervals) {
    var expected = intervals.map(function (iv) { return (root + iv) % 12; });
    if (!subset(pcs, expected)) return false;
    for (var i = 0; i < intervals.length; i++) {
      var iv = intervals[i];
      if (iv === 7) continue; // optional 5th only
      if (pcs.indexOf((root + iv) % 12) < 0) return false;
    }
    return true;
  }

  function formulas() {
    var list = [];
    QUALITIES.forEach(function (q, i) {
      list.push({ intervals: q.intervals.slice(), name: q.name, rank: i === 0 ? 0 : i, qid: q.id });
    });
    DETECT_EXTRA.forEach(function (e) {
      list.push({ intervals: e.intervals.slice(), name: e.name, rank: e.rank + 10, qid: null });
    });
    return list;
  }

  function analyzePitchSet(pcs, bass) {
    if (!pcs || pcs.length < 2) return [];
    var forms = formulas();
    var hits = [];
    for (var root = 0; root < 12; root++) {
      for (var fi = 0; fi < forms.length; fi++) {
        var f = forms[fi];
        if (!formulaFitsSounded(pcs, root, f.intervals)) continue;
        var expected = f.intervals.map(function (iv) { return (root + iv) % 12; });
        var hasRoot = pcs.indexOf(root) >= 0;
        if (!hasRoot && pcs.length < 3) continue;
        var missing = expected.filter(function (p) { return pcs.indexOf(p) < 0; }).length;
        var exact = setEq(pcs, uniq(expected));
        var score = 100 - f.rank * 3 - missing * 8 - (hasRoot ? 0 : 15) + (exact ? 20 : 0);
        if (exact && f.intervals.length === 3) score += 10;
        // Prefer bass as root (no slash) — then fewest accidentals
        if (bass != null && bass === root) score += 28;
        else if (bass != null && bass !== root) score -= 4;

        var disp = spellChordDisplay(root, f.name, null);
        var full = spellChordDisplay(root, f.name, bass);
        score -= accidentalCount(full) * 6;
        // Prefer spellings without double accidentals on sounded notes
        var spellPenalty = 0;
        var smap = {};
        expected.forEach(function (p) {
          var sp = spellPcFromRoot(p, root, f.name);
          smap[p] = sp;
          if (sp.indexOf('##') >= 0 || sp.indexOf('bb') >= 0) spellPenalty += 40;
          else spellPenalty += accidentalCount(sp) * 2;
        });
        score -= spellPenalty;

        hits.push({
          root: root,
          name: f.name,
          display: full,
          baseDisplay: disp,
          score: score,
          qid: f.qid,
          pcs: uniq(expected),
          bass: bass,
          spellMap: (function () {
            if (bass != null) smap[bass] = spellPcFromRoot(bass, root, f.name);
            return smap;
          })()
        });
      }
    }
    hits.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return accidentalCount(a.display) - accidentalCount(b.display);
    });
    var seen = {};
    var out = [];
    for (var i = 0; i < hits.length; i++) {
      if (seen[hits[i].display]) continue;
      seen[hits[i].display] = 1;
      out.push(hits[i]);
      if (out.length >= 6) break;
    }
    return out;
  }

  function chordTonesFromName(root, qualityId) {
    var q = QUALITIES.find(function (x) { return x.id === qualityId; }) || QUALITIES[0];
    return q.intervals.map(function (iv) { return (root + iv) % 12; });
  }

  function formatChord(root, qualityId, slashBass) {
    var q = QUALITIES.find(function (x) { return x.id === qualityId; }) || QUALITIES[0];
    var disp;
    if (!q.name) disp = noteName(root);
    else if (q.name === 'm' || q.name.indexOf('m') === 0 || q.name.indexOf('dim') === 0 || q.name.indexOf('sus') === 0)
      disp = noteName(root) + q.name;
    else disp = noteName(root) + q.name;
    if (slashBass != null && slashBass !== root) disp += '/' + noteName(slashBass);
    return disp;
  }

  /* ---------- Key / scale guess ---------- */
  function scaleTones(root, scale) {
    return scale.intervals.map(function (iv) { return (root + iv) % 12; });
  }

  function preferFlatForScale(root, scale) {
    if (scale.mode === 'minor') return true;
    // Flat-key majors: F, Bb, Eb, Ab, Db, Gb
    return [5, 10, 3, 8, 1, 6].indexOf(root) >= 0;
  }

  function spellScaleNotes(root, scale) {
    // Always list ascending from the scale's own tonic.
    var letters = LETTERS;
    var letterPc = LETTER_PC;
    var preferFlat = preferFlatForScale(root, scale);
    var rootName = noteName(root, preferFlat);
    var rootLetter = rootName.charAt(0);
    var rootIdx = letters.indexOf(rootLetter);
    if (rootIdx < 0) rootIdx = 0;

    // For heptatonic scales, intervals line up with degrees 1..7.
    // For pent/blues, map each interval to the nearest diatonic degree letter.
    var heptatonic = scale.intervals.length >= 7;
    return scale.intervals.map(function (iv, i) {
      var pc = (root + iv) % 12;
      var deg;
      if (heptatonic) {
        deg = i;
      } else {
        // pentatonic / blues degree guesses
        var degMap = { 0: 0, 1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 3, 7: 4, 8: 5, 9: 5, 10: 6, 11: 6 };
        if (iv === 6 && (scale.id === 'lydian' || scale.id === 'blues')) {
          deg = scale.id === 'lydian' ? 3 : 3; // #4 / b5 between 4 and 5
        } else {
          deg = degMap[iv];
        }
        if (deg == null) deg = i;
      }
      var letter = letters[(rootIdx + deg) % 7];
      var natural = letterPc[letter];
      var best = 0;
      for (var acc = -2; acc <= 2; acc++) {
        if ((((natural + acc) % 12) + 12) % 12 === pc) { best = acc; break; }
      }
      if (best === 0) return letter;
      if (best === 1) return letter + '#';
      if (best === 2) return letter + '##';
      if (best === -1) return letter + 'b';
      if (best === -2) return letter + 'bb';
      return noteName(pc, preferFlat);
    });
  }

  function spellChordPcs(root, qualityName, pcs) {
    var q = qualityName || '';
    // Map quality id-ish names
    if (q === 'maj' || q === '') q = '';
    else if (q === 'min') q = 'm';
    return (pcs || []).map(function (pc) { return spellPcFromRoot(pc, root, q); });
  }

  function chordFitsKey(chord, root, scale) {
    var tones = scaleTones(root, scale);
    var pcs = chord.pcs || [];
    for (var j = 0; j < pcs.length; j++) {
      if (tones.indexOf(pcs[j]) < 0) return false;
    }
    return true;
  }

  function chordsFitKey(chordList, root, scale) {
    var n = 0;
    for (var i = 0; i < chordList.length; i++) {
      if (chordFitsKey(chordList[i], root, scale)) n++;
    }
    return n;
  }

  function isMajorishQuality(q) {
    q = q || 'maj';
    return q === 'maj' || q === '7' || q === 'maj7' || q === 'sus2' || q === 'sus4';
  }

  function isMinorishQuality(q) {
    q = q || '';
    return q === 'min' || q === 'm7' || q === 'dim';
  }

  function qualityMatchesMode(quality, scale) {
    if (scale.mode === 'major') return isMajorishQuality(quality);
    return isMinorishQuality(quality);
  }

  function tonicEvidence(root, scale, chordList) {
    if (!chordList.length) return 0;
    var score = 0;
    var first = chordList[0];
    var last = chordList[chordList.length - 1];
    var rare = (scale.id === 'lydian' || scale.id === 'phrygian' || scale.id === 'locrian');

    // Strong weight: first chord root as tonic (I–V–vi–IV → I)
    if (first && first.root === root) {
      score += 100;
      if (qualityMatchesMode(first.quality, scale)) score += 50;
    }
    // Strong weight: last chord root as tonic
    if (last && last.root === root) {
      score += 70;
      if (qualityMatchesMode(last.quality, scale)) score += 30;
    }
    // Other chords on this tonic (weaker)
    for (var i = 0; i < chordList.length; i++) {
      var c = chordList[i];
      if (c.root !== root) continue;
      if (i === 0 || i === chordList.length - 1) continue;
      if (qualityMatchesMode(c.quality, scale)) score += 12;
      else score -= 4;
    }

    // Rare modes need end-tonic evidence to compete for the top slot
    if (rare) {
      var endTonic = (first && first.root === root) || (last && last.root === root);
      if (!endTonic) score -= 80;
    }
    return score;
  }

  function scoreKey(root, scale, chordList) {
    var fitCount = chordsFitKey(chordList, root, scale);
    var outside = chordList.length - fitCount;
    var evidence = tonicEvidence(root, scale, chordList);
    // Exact fits dominate; then tonic evidence; then mode commonness
    var score = fitCount * 1000 + evidence + (scale.common || 0);
    if (outside === 0) score += 100;
    else if (outside === 1) score -= 20;
    else score -= outside * 80;
    return {
      root: root,
      scale: scale,
      score: score,
      fitCount: fitCount,
      outside: outside,
      tones: scaleTones(root, scale),
      evidence: evidence
    };
  }

  function allCandidates(chordList) {
    var ranked = [];
    for (var r = 0; r < 12; r++) {
      for (var si = 0; si < SCALES.length; si++) {
        ranked.push(scoreKey(r, SCALES[si], chordList));
      }
    }
    ranked.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      if (b.evidence !== a.evidence) return b.evidence - a.evidence;
      if ((b.scale.common || 0) !== (a.scale.common || 0)) return (b.scale.common || 0) - (a.scale.common || 0);
      return a.root - b.root;
    });
    return ranked;
  }

  function keyLabel(c) {
    var short = c.scale.short || c.scale.name;
    return noteName(c.root, preferFlatForScale(c.root, c.scale)) + ' ' + short;
  }

  function keyLabelLong(c) {
    return noteName(c.root, preferFlatForScale(c.root, c.scale)) + ' ' + c.scale.name;
  }

  function candRef(c) {
    return {
      root: c.root,
      scaleId: c.scale.id,
      label: keyLabel(c),
      notes: spellScaleNotes(c.root, c.scale),
      outside: c.outside,
      fitCount: c.fitCount
    };
  }

  function ensureSelectedScale(fits) {
    if (state.selectedScale) {
      var ok = fits.some(function (f) {
        return f.root === state.selectedScale.root && f.scaleId === state.selectedScale.scaleId;
      });
      if (ok) return;
    }
    if (fits.length) {
      state.selectedScale = { root: fits[0].root, scaleId: fits[0].scaleId };
    } else if (state.topKey) {
      state.selectedScale = { root: state.topKey.root, scaleId: state.topKey.scaleId };
    } else {
      state.selectedScale = null;
    }
  }

  function recomputeKeys(opts) {
    opts = opts || {};
    var list = state.chords;
    if (!list.length) {
      state.topKey = null;
      state._fits = [];
      state._near = [];
      state.selectedScale = null;
      state.noExactFit = false;
      state.closestMsg = '';
      clearClashLine();
      renderKey();
      renderStrip();
      renderNeck();
      return;
    }

    var ranked = allCandidates(list);
    var perfect = ranked.filter(function (c) { return c.outside === 0; });
    var near = ranked.filter(function (c) { return c.outside === 1; });

    // Same ranking as allCandidates: score already blends fit, tonic evidence, commonness
    perfect.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      if (b.evidence !== a.evidence) return b.evidence - a.evidence;
      if ((b.scale.common || 0) !== (a.scale.common || 0)) return (b.scale.common || 0) - (a.scale.common || 0);
      return a.root - b.root;
    });

    var prev = state.topKey;
    var newTop = perfect.length ? perfect[0] : (near[0] || ranked[0]);

    if (prev && opts.addedChord) {
      var oldScale = SCALES.find(function (s) { return s.id === prev.scaleId; });
      if (oldScale) {
        var oldFit = chordsFitKey(list, prev.root, oldScale);
        var newFit = chordsFitKey(list, newTop.root, newTop.scale);
        var addedFitsOld = chordFitsKey(opts.addedChord, prev.root, oldScale);
        if (!addedFitsOld && newFit <= oldFit) {
          newTop = {
            root: prev.root,
            scale: oldScale,
            score: 0,
            tones: scaleTones(prev.root, oldScale),
            outside: list.length - oldFit,
            fitCount: oldFit,
            evidence: 0
          };
          opts.addedChord.clash = true;
          showClash(opts.addedChord, newTop);
        } else if (!addedFitsOld && newFit > oldFit) {
          clearClashLine();
        }
      }
    }

    state.noExactFit = perfect.length === 0;
    state.topKey = {
      root: newTop.root,
      scaleId: newTop.scale.id,
      name: keyLabelLong(newTop),
      short: keyLabel(newTop),
      notes: spellScaleNotes(newTop.root, newTop.scale),
      isNear: state.noExactFit
    };

    var topScale = SCALES.find(function (s) { return s.id === state.topKey.scaleId; });
    state.chords.forEach(function (c) {
      c.clash = !chordFitsKey(c, state.topKey.root, topScale);
    });

    state._fits = perfect.map(candRef);
    state._near = near.slice(0, 24).map(candRef);
    state._perfect = state._fits;

    if (state.noExactFit) {
      var borrowBit = describeClosestBorrow(newTop, list);
      state.closestMsg = 'No scale fits all; closest: ' + state.topKey.short +
        (borrowBit ? ' (' + borrowBit + ')' : '');
      // Persist clash callout on the outside chord(s)
      var clashChord = null;
      for (var ci = state.chords.length - 1; ci >= 0; ci--) {
        if (state.chords[ci].clash) { clashChord = state.chords[ci]; break; }
      }
      if (clashChord) showClash(clashChord, newTop, { persist: true });
    } else {
      state.closestMsg = '';
      // Don't leave a stale persistent clash line when we have exact fits
      if (!opts.addedChord) clearClashLine();
    }

    ensureSelectedScale(state._fits.length ? state._fits : state._near);

    renderKey();
    renderStrip();
    renderNeck();
  }

  function findBorrowSource(chord, fromKey) {
    // Prefer same-root alternate mode that contains this chord (e.g. A harm. minor for E in Am).
    var ranked = allCandidates([chord]);
    var sameRoot = [];
    var other = [];
    for (var i = 0; i < ranked.length; i++) {
      var c = ranked[i];
      if (!chordFitsKey(chord, c.root, c.scale)) continue;
      if (fromKey && c.root === fromKey.root && c.scale.id !== fromKey.scaleId) sameRoot.push(c);
      else other.push(c);
    }
    // Prefer harmonic/melodic when borrowing a major V into minor
    sameRoot.sort(function (a, b) {
      var order = { harmonic: 0, melodic: 1, major: 2, minor: 3 };
      var ao = order[a.scale.id] != null ? order[a.scale.id] : 9;
      var bo = order[b.scale.id] != null ? order[b.scale.id] : 9;
      if (ao !== bo) return ao - bo;
      return (b.scale.common || 0) - (a.scale.common || 0);
    });
    if (sameRoot.length) return sameRoot[0];
    if (other.length) return other[0];
    return null;
  }

  function borrowLabel(borrowCand, fromKey) {
    if (!borrowCand) return null;
    // Same tonic → readable mode name; otherwise full "C major"
    if (fromKey && borrowCand.root === fromKey.root) {
      if (borrowCand.scale.id === 'harmonic') return 'harmonic minor';
      if (borrowCand.scale.id === 'melodic') return 'melodic minor';
      if (borrowCand.scale.id === 'minor') return 'natural minor';
      return borrowCand.scale.name;
    }
    return keyLabel(borrowCand);
  }

  function describeClosestBorrow(topCand, chordList) {
    var clash = [];
    for (var i = 0; i < chordList.length; i++) {
      if (!chordFitsKey(chordList[i], topCand.root, topCand.scale)) clash.push(chordList[i]);
    }
    if (!clash.length) return '';
    // Prefer the last clashing chord (often the borrowed V)
    var ch = clash[clash.length - 1];
    var borrow = findBorrowSource(ch, { root: topCand.root, scaleId: topCand.scale.id });
    var chordName = ch.display || ch.name || noteName(ch.root);
    var bl = borrowLabel(borrow, { root: topCand.root });
    if (bl) return chordName + ' borrowed from ' + bl;
    return chordName + ' outside';
  }

  function showClash(chord, topKeyLike, opts) {
    opts = opts || {};
    var chordName = (chord && (chord.display || chord.name)) || noteName(chord.root);
    var keyName = topKeyLike.scale
      ? keyLabel(topKeyLike)
      : (state.topKey && state.topKey.short) || 'current key';
    var borrow = findBorrowSource(chord, {
      root: topKeyLike.root,
      scaleId: topKeyLike.scale ? topKeyLike.scale.id : (state.topKey && state.topKey.scaleId)
    });
    var msg = chordName + ' is outside ' + keyName;
    var bl = borrowLabel(borrow, { root: topKeyLike.root });
    if (bl) msg += ' — borrowed from ' + bl;
    state.clashMsg = msg;
    var el = $('clash-line');
    if (el) {
      el.hidden = false;
      el.textContent = msg;
    }
    if (state.clashTimer) clearTimeout(state.clashTimer);
    if (!opts.persist) {
      state.clashTimer = setTimeout(function () {
        clearClashLine(true);
      }, 4000);
    } else {
      state.clashTimer = null;
    }
  }

  function clearClashLine(keepMsg) {
    var el = $('clash-line');
    if (el) el.hidden = true;
    if (!keepMsg) state.clashMsg = '';
  }

  function reshowClash() {
    if (!state.clashMsg) {
      // rebuild from last clash tile
      var c = state.chords.filter(function (x) { return x.clash; }).pop();
      if (c && state.topKey) {
        var scale = SCALES.find(function (s) { return s.id === state.topKey.scaleId; });
        showClash(c, { root: state.topKey.root, scale: scale });
        return;
      }
    }
    var el = $('clash-line');
    if (el && state.clashMsg) {
      el.hidden = false;
      el.textContent = state.clashMsg;
      if (state.clashTimer) clearTimeout(state.clashTimer);
      state.clashTimer = setTimeout(function () { clearClashLine(true); }, 4000);
    }
  }

  /* ---------- Persistence ---------- */
  function save() {
    try {
      var data = {
        v: 1,
        presetId: state.presetId,
        offsets: state.offsets.slice(),
        chords: state.chords.map(function (c) {
          return {
            id: c.id,
            name: c.name,
            root: c.root,
            quality: c.quality,
            pcs: c.pcs.slice(),
            clash: !!c.clash,
            source: c.source || '',
            noteNames: c.noteNames || null
          };
        })
      };
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch (_) {}
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (!data || data.v !== 1) return;
      if (data.presetId) state.presetId = data.presetId;
      if (Array.isArray(data.offsets) && data.offsets.length === 6) state.offsets = data.offsets.slice();
      if (Array.isArray(data.chords)) {
        state.chords = data.chords.map(function (c) {
          return {
            id: c.id || uid(),
            name: c.name,
            root: c.root | 0,
            quality: c.quality || 'maj',
            pcs: (c.pcs || []).slice(),
            clash: !!c.clash,
            source: c.source || '',
            noteNames: c.noteNames || null,
            display: c.name
          };
        });
      }
    } catch (_) {}
  }

  function uid() {
    return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* ---------- Neck UI ---------- */
  function clearNeck() {
    state.frets = [null, null, null, null, null, null];
    state.names = [];
    state.selectedNameIndex = 0;
    renderNeck();
    renderGuess();
    updateAddEnabled();
  }

  function windowEnd() {
    // when start=0 show 0..5 (5 fretted + nut); else start..start+4
    if (state.startFret === 0) return FRET_WINDOW;
    return Math.min(MAX_FRET, state.startFret + FRET_WINDOW - 1);
  }

  function fretsInWindow() {
    var a = state.startFret | 0;
    var b = windowEnd();
    var list = [];
    if (a === 0) {
      // nut handled separately; frets 1..b
      for (var f = 1; f <= b; f++) list.push(f);
    } else {
      for (var f2 = a; f2 <= b; f2++) list.push(f2);
    }
    return list;
  }

  // Display order: row 0 = high e (string 5) at TOP; row 5 = low E (string 0) at BOTTOM.
  // Internal index 0 = low E (bass), 5 = high e. Pitch math always uses that index.

  function cycleString(s) {
    var f = state.frets[s];
    if (f === null) {
      state.frets[s] = 0; // muted → open
    } else if (f === 0) {
      state.frets[s] = null; // open → muted
    } else {
      state.frets[s] = null; // fretted → muted
    }
    afterNeckChange();
  }

  function selectedSpellMap() {
    var hit = state.names[state.selectedNameIndex] || state.names[0];
    return hit && hit.spellMap ? hit.spellMap : null;
  }

  function labelForString(s) {
    var tun = tuningPcs();
    var tunName = noteName(tun[s], false); // open-string letter (E A D G B E style)
    // Prefer natural open names without flats for standard opens
    if (tun[s] === 4) tunName = 'E';
    else if (tun[s] === 9) tunName = 'A';
    else if (tun[s] === 2) tunName = 'D';
    else if (tun[s] === 7) tunName = 'G';
    else if (tun[s] === 11) tunName = 'B';
    else tunName = noteName(tun[s]);

    var f = state.frets[s];
    if (f === null || f === undefined) {
      return { sound: '×', tun: tunName, cls: 'muted', pc: null };
    }
    var pc = (tun[s] + (f | 0)) % 12;
    var map = selectedSpellMap();
    var sound;
    if (map && map[pc] && map[pc].indexOf('##') < 0 && map[pc].indexOf('bb') < 0) sound = map[pc];
    else if (pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10) sound = noteNameDual(pc);
    else sound = noteName(pc, false);
    return {
      sound: sound,
      tun: tunName,
      cls: f === 0 ? 'open' : 'fretted',
      pc: pc
    };
  }

  function renderNeck() {
    var wrap = document.querySelector('.neck-wrap');
    if (!wrap) return;
    var frets = fretsInWindow();
    var n = frets.length;

    // Rebuild outer structure: labels | wood fretboard
    var board = wrap.querySelector('.neck-board');
    if (!board) {
      board = document.createElement('div');
      board.className = 'neck-board';
      var oldNeck = $('neck');
      if (oldNeck && oldNeck.parentElement === wrap) wrap.insertBefore(board, oldNeck);
      else wrap.insertBefore(board, wrap.firstChild);
    }
    board.innerHTML = '';
    board.style.setProperty('--nfrets', String(n));

    var labels = document.createElement('div');
    labels.className = 'neck-labels';

    var wood = document.createElement('div');
    wood.className = 'fretboard';

    var neck = document.createElement('div');
    neck.className = 'neck neck-grid';
    neck.id = 'neck';
    neck.style.setProperty('--nfrets', String(n));

    var inlays = document.createElement('div');
    inlays.className = 'neck-inlays';
    inlays.style.setProperty('--nfrets', String(n));
    inlays.setAttribute('aria-hidden', 'true');
    // nut spacer + one slot per fret space
    inlays.appendChild(document.createElement('div')); // nut col
    for (var fi = 0; fi < frets.length; fi++) {
      var slot = document.createElement('div');
      slot.className = 'slot';
      var fretNum = frets[fi];
      if (fretNum === 3 || fretNum === 5 || fretNum === 7 || fretNum === 9) {
        var d = document.createElement('span');
        d.className = 'inlay';
        slot.appendChild(d);
      } else if (fretNum === 12) {
        var a = document.createElement('span');
        a.className = 'inlay double-a';
        var b = document.createElement('span');
        b.className = 'inlay double-b';
        slot.appendChild(a);
        slot.appendChild(b);
      }
      inlays.appendChild(slot);
    }

    // Top → bottom: high e (5) … low E (0)
    for (var row = 0; row < STRING_COUNT; row++) {
      var s = STRING_COUNT - 1 - row;
      var thick = 1.4 + (STRING_COUNT - 1 - s) * 0.65; // thin high e → thick low E
      var labInfo = labelForString(s);

      var labBtn = document.createElement('button');
      labBtn.type = 'button';
      labBtn.className = 'str-label ' + labInfo.cls;
      labBtn.setAttribute('data-str', String(s));
      labBtn.setAttribute('aria-label', 'String ' + (s + 1) + ' ' + labInfo.sound + ', tuning ' + labInfo.tun + '. Tap to mute or open.');
      labBtn.innerHTML = '<span class="sound">' + labInfo.sound + '</span><span class="tun">' + labInfo.tun + '</span>';
      labBtn.addEventListener('pointerup', function (e) {
        e.preventDefault();
        e.stopPropagation();
        cycleString(+e.currentTarget.getAttribute('data-str'));
      });
      labels.appendChild(labBtn);

      var nutBtn = document.createElement('button');
      nutBtn.type = 'button';
      nutBtn.className = 'cell nut-cell';
      nutBtn.style.setProperty('--sw', thick + 'px');
      nutBtn.setAttribute('data-str', String(s));
      nutBtn.setAttribute('data-fret', '0');
      nutBtn.setAttribute('aria-label', 'Open string ' + (s + 1));
      (function () {
        var info = selectedScaleInfo();
        if (!info) return;
        var tun = tuningPcs();
        if (info.tones.indexOf(tun[s]) >= 0) nutBtn.classList.add('scale-tone');
      })();
      if (state.frets[s] === null) {
        nutBtn.classList.add('muted-mark');
        nutBtn.textContent = '×';
      } else if (state.frets[s] === 0) {
        nutBtn.classList.add('nut-hit');
        var d0 = document.createElement('span');
        d0.className = 'dot';
        nutBtn.appendChild(d0);
      }
      neck.appendChild(nutBtn);

      for (var i = 0; i < frets.length; i++) {
        var fret = frets[i];
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cell fret-space';
        btn.style.setProperty('--sw', thick + 'px');
        btn.setAttribute('data-str', String(s));
        btn.setAttribute('data-fret', String(fret));
        btn.setAttribute('aria-label', 'String ' + (s + 1) + ' fret ' + fret);
        (function () {
          var info = selectedScaleInfo();
          if (!info) return;
          var tun = tuningPcs();
          var pc = (tun[s] + fret) % 12;
          if (info.tones.indexOf(pc) >= 0) btn.classList.add('scale-tone');
        })();
        if (state.frets[s] === fret) {
          var dd = document.createElement('span');
          dd.className = 'dot';
          btn.appendChild(dd);
        }
        neck.appendChild(btn);
      }
    }

    wood.appendChild(inlays);
    wood.appendChild(neck);
    board.appendChild(labels);
    board.appendChild(wood);

    // Remove leftover direct #neck from first paint
    var leftover = wrap.querySelector(':scope > #neck');
    if (leftover) leftover.remove();

    var scrubLab = $('fret-lab');
    var a = state.startFret | 0;
    var b = windowEnd();
    if (scrubLab) scrubLab.textContent = 'Frets ' + a + '–' + b;

    var existing = wrap.querySelector('.neck-nums');
    if (existing) existing.remove();
    var nums = document.createElement('div');
    nums.className = 'neck-nums';
    nums.style.setProperty('--nfrets', String(n));
    // label spacer | nut spacer | numbers centred in each fret SPACE
    var html = '<span></span><span></span>';
    for (var j = 0; j < frets.length; j++) {
      html += '<span class="num">' + frets[j] + '</span>';
    }
    nums.innerHTML = html;
    wrap.appendChild(nums);

    neck.querySelectorAll('.cell').forEach(function (cell) {
      cell.addEventListener('pointerup', onCellPointer, { passive: false });
    });
  }

  function getStringLabelsTopToBottom() {
    var out = [];
    for (var row = 0; row < STRING_COUNT; row++) {
      var s = STRING_COUNT - 1 - row;
      out.push(labelForString(s));
    }
    return out;
  }

  function onCellPointer(e) {
    e.preventDefault();
    e.stopPropagation();
    var cell = e.currentTarget;
    var s = +cell.getAttribute('data-str');
    var fret = +cell.getAttribute('data-fret');
    tapFret(s, fret);
  }

  function tapFret(s, fret) {
    // One fret per string: tap same clears; tap other moves
    if (state.frets[s] === fret) {
      state.frets[s] = null; // clear (treat as muted-ish empty — use null; user can open via toggle)
    } else {
      state.frets[s] = fret;
    }
    afterNeckChange();
  }

  function afterNeckChange() {
    var sounded = soundingPcs();
    state.names = analyzePitchSet(sounded.pcs, sounded.bass);
    state.selectedNameIndex = 0;
    renderNeck();
    renderGuess();
    updateAddEnabled();
  }

  function renderGuess() {
    var el = $('chord-name');
    var alts = $('alt-chips');
    var sounded = soundingPcs();
    var notesEl = $('chord-notes');
    if (sounded.pcs.length < 2) {
      if (el) el.textContent = sounded.pcs.length ? 'Need more notes…' : 'Tap frets';
      if (notesEl) notesEl.textContent = '';
      if (alts) alts.innerHTML = '';
      return;
    }
    if (!state.names.length) {
      if (el) el.textContent = 'No match';
      if (notesEl) notesEl.textContent = '';
      if (alts) alts.innerHTML = '';
      return;
    }
    var top = state.names[state.selectedNameIndex] || state.names[0];
    if (el) el.textContent = top.display;
    if (notesEl) {
      var sp = spellChordPcs(top.root, top.name, sounded.pcs);
      notesEl.textContent = sp.join(' ');
    }
    if (alts) {
      alts.innerHTML = '';
      state.names.slice(0, 3).forEach(function (n, i) {
        if (i === state.selectedNameIndex && state.names.length === 1) return;
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip' + (i === state.selectedNameIndex ? ' active' : '');
        b.textContent = n.display;
        b.addEventListener('click', function () {
          state.selectedNameIndex = i;
          renderGuess();
          updateAddEnabled();
        });
        alts.appendChild(b);
      });
      // Always show up to 3 alternatives as chips (including selecting among them)
      if (state.names.length > 1) {
        alts.innerHTML = '';
        state.names.slice(0, 3).forEach(function (n, i) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'chip' + (i === state.selectedNameIndex ? ' active' : '');
          b.textContent = n.display;
          b.addEventListener('click', function () {
            state.selectedNameIndex = i;
            renderGuess();
            renderNeck();
          });
          alts.appendChild(b);
        });
      }
    }
  }

  function updateAddEnabled() {
    var btn = $('btn-add');
    if (!btn) return;
    var ok = soundingPcs().pcs.length >= 2 && state.names.length > 0;
    // Also allow quick-pick path: if no neck notes, still can add from quick pick via separate handler
    btn.disabled = !ok;
  }

  function addCurrentChord() {
    var hit = state.names[state.selectedNameIndex] || state.names[0];
    if (!hit) return;
    var chord = {
      id: uid(),
      name: hit.baseDisplay || hit.display.replace(/\/.*$/, ''),
      root: hit.root,
      quality: hit.qid || guessQualityId(hit),
      pcs: soundingPcs().pcs.slice(),
      clash: false,
      source: 'neck',
      display: hit.display
    };
    chord.noteNames = spellChordPcs(chord.root, hit.name || '', chord.pcs);
    if (!chord.name) chord.name = hit.display;
    state.chords.push(chord);
    recomputeKeys({ addedChord: chord });
    save();
    clearNeck();
    renderStrip();
  }

  function guessQualityId(hit) {
    if (hit.qid) return hit.qid;
    var n = hit.name || '';
    if (n === 'm' || n === 'min') return 'min';
    if (n === '7') return '7';
    if (n === 'maj7') return 'maj7';
    if (n === 'm7') return 'm7';
    if (n === 'dim') return 'dim';
    if (n === 'sus2') return 'sus2';
    if (n === 'sus4') return 'sus4';
    return 'maj';
  }

  function addQuickChord() {
    var root = state.quickRoot | 0;
    var qid = state.quickQuality || 'maj';
    var pcs = chordTonesFromName(root, qid);
    var name = formatChord(root, qid, null);
    var chord = {
      id: uid(),
      name: name,
      root: root,
      quality: qid,
      pcs: pcs.slice(),
      clash: false,
      source: 'quick',
      display: name,
      noteNames: spellChordPcs(root, qid === 'min' ? 'm' : (qid === 'maj' ? '' : qid), pcs)
    };
    state.chords.push(chord);
    recomputeKeys({ addedChord: chord });
    save();
    renderStrip();
  }

  function removeChord(id) {
    state.chords = state.chords.filter(function (c) { return c.id !== id; });
    state.selectedTile = null;
    recomputeKeys({});
    save();
    renderStrip();
  }

  function renderStrip() {
    var host = $('strip');
    if (!host) return;
    host.innerHTML = '';
    state.chords.forEach(function (c) {
      var tile = document.createElement('div');
      tile.className = 'tile' + (c.clash ? ' clash' : '') + (state.selectedTile === c.id ? ' selected' : '');
      tile.setAttribute('data-id', c.id);
      var name = document.createElement('div');
      name.className = 't-name';
      name.textContent = c.display || c.name;
      tile.appendChild(name);
      var notes = document.createElement('div');
      notes.className = 't-notes';
      var nn = c.noteNames;
      if (!nn || !nn.length) {
        nn = spellChordPcs(c.root, c.quality === 'min' ? 'm' : '', c.pcs || []);
      }
      notes.textContent = nn.join(' ');
      tile.appendChild(notes);
      if (c.clash) {
        var dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'dot-clash';
        dot.setAttribute('aria-label', 'Show clash');
        dot.addEventListener('click', function (e) {
          e.stopPropagation();
          reshowClash();
        });
        tile.appendChild(dot);
      }
      var x = document.createElement('button');
      x.type = 'button';
      x.className = 'x';
      x.textContent = '×';
      x.setAttribute('aria-label', 'Remove');
      x.addEventListener('click', function (e) {
        e.stopPropagation();
        removeChord(c.id);
      });
      tile.appendChild(x);

      tile.addEventListener('click', function () {
        if (state.selectedTile === c.id) {
          state.selectedTile = null;
        } else {
          state.selectedTile = c.id;
        }
        renderStrip();
      });
      host.appendChild(tile);
    });
  }

  function selectedScaleInfo() {
    if (!state.selectedScale) return null;
    var scale = SCALES.find(function (s) { return s.id === state.selectedScale.scaleId; });
    if (!scale) return null;
    return {
      root: state.selectedScale.root,
      scale: scale,
      label: keyLabel({ root: state.selectedScale.root, scale: scale }),
      notes: spellScaleNotes(state.selectedScale.root, scale),
      tones: scaleTones(state.selectedScale.root, scale)
    };
  }

  function selectScale(root, scaleId) {
    state.selectedScale = { root: root, scaleId: scaleId };
    // If this scale is an exact fit, also promote topKey readout when it fits all
    var scale = SCALES.find(function (s) { return s.id === scaleId; });
    if (scale && state.chords.length && chordsFitKey(state.chords, root, scale) === state.chords.length) {
      state.topKey = {
        root: root,
        scaleId: scaleId,
        name: keyLabelLong({ root: root, scale: scale }),
        short: keyLabel({ root: root, scale: scale }),
        notes: spellScaleNotes(root, scale)
      };
      state.chords.forEach(function (c) {
        c.clash = !chordFitsKey(c, root, scale);
      });
    }
    renderKey();
    renderStrip();
    renderNeck();
  }

  function makeCandChip(c, opts) {
    opts = opts || {};
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'cand' + (opts.top ? ' top' : '') + (opts.near ? ' near' : '') + (opts.more ? ' more' : '');
    var sel = state.selectedScale;
    if (sel && c.root === sel.root && c.scaleId === sel.scaleId) b.classList.add('selected');
    b.textContent = opts.more ? opts.label : c.label;
    if (opts.more) {
      b.addEventListener('click', function () { openScalesSheet(true); });
    } else {
      b.title = (c.notes || []).join(' ');
      b.addEventListener('click', function () { selectScale(c.root, c.scaleId); });
    }
    return b;
  }

  function renderKey() {
    var el = $('key-readout');
    var notesEl = $('key-notes');
    var cand = $('candidates');
    var nearHost = $('near-candidates');
    var nearSec = $('near-section');
    var fitsLab = $('fits-label');

    if (!state.chords.length) {
      if (el) el.textContent = 'Add chords to guess the key';
      if (notesEl) notesEl.textContent = '';
      if (cand) cand.innerHTML = '';
      if (nearHost) nearHost.innerHTML = '';
      if (nearSec) nearSec.hidden = true;
      if (fitsLab) fitsLab.hidden = true;
      return;
    }

    var info = selectedScaleInfo();
    if (el) {
      if (state.noExactFit && state.closestMsg) {
        el.textContent = state.closestMsg;
      } else {
        el.textContent = 'Key: ' + (state.topKey ? state.topKey.short : '—');
      }
    }
    if (notesEl) {
      var nlist = [];
      if (info) nlist = info.notes;
      else if (state.topKey) {
        var sc = SCALES.find(function (s) { return s.id === state.topKey.scaleId; });
        if (sc) nlist = spellScaleNotes(state.topKey.root, sc);
      }
      notesEl.textContent = nlist.length ? nlist.join(' ') : '';
    }

    var fits = state._fits || [];
    var near = state._near || [];
    if (fitsLab) fitsLab.hidden = !fits.length;

    if (cand) {
      cand.innerHTML = '';
      var TOP_N = 5;
      var show = fits.slice(0, TOP_N);
      show.forEach(function (c, i) {
        cand.appendChild(makeCandChip(c, { top: i === 0 }));
      });
      if (fits.length > TOP_N) {
        cand.appendChild(makeCandChip({}, {
          more: true,
          label: '+' + (fits.length - TOP_N) + ' more'
        }));
      }
      if (!fits.length) {
        var none = document.createElement('span');
        none.className = 'cand-count';
        none.textContent = 'No scale fits all';
        cand.appendChild(none);
      } else {
        var count = document.createElement('span');
        count.className = 'cand-count';
        count.textContent = fits.length + ' fit';
        cand.appendChild(count);
      }
    }

    if (nearHost && nearSec) {
      nearHost.innerHTML = '';
      var nearLab = $('near-label');
      if (nearLab) nearLab.textContent = state.noExactFit ? 'Closest (near)' : 'Near';
      if (near.length) {
        nearSec.hidden = false;
        near.slice(0, 6).forEach(function (c) {
          nearHost.appendChild(makeCandChip(c, { near: true }));
        });
        if (near.length > 6) {
          var moreN = document.createElement('span');
          moreN.className = 'cand-count';
          moreN.textContent = '+' + (near.length - 6) + ' near';
          nearHost.appendChild(moreN);
        }
      } else {
        nearSec.hidden = true;
      }
    }

    renderScalesSheetList();
  }

  function openScalesSheet(on) {
    var sheet = $('scales-sheet');
    var bd = $('scales-backdrop');
    if (!sheet || !bd) return;
    sheet.hidden = !on;
    bd.hidden = !on;
    if (on) renderScalesSheetList();
  }

  function renderScalesSheetList() {
    var host = $('scales-list');
    var hint = $('scales-sheet-hint');
    if (!host) return;
    host.innerHTML = '';
    var fits = state._fits || [];
    if (hint) {
      hint.textContent = fits.length
        ? fits.length + ' scales contain every chord tone. Tap one to see its notes.'
        : 'No scale contains every chord tone yet.';
    }
    fits.forEach(function (c) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'scale-row';
      var sel = state.selectedScale;
      if (sel && sel.root === c.root && sel.scaleId === c.scaleId) row.classList.add('active');
      row.innerHTML = '<span class="sn">' + c.label + '</span><span class="snotes">' + (c.notes || []).join(' ') + '</span>';
      row.addEventListener('click', function () {
        selectScale(c.root, c.scaleId);
        openScalesSheet(false);
      });
      host.appendChild(row);
    });
  }

  /* ---------- Quick pick ---------- */
  function renderQuick() {
    var roots = $('quick-roots');
    var quals = $('quick-qualities');
    if (roots) {
      roots.innerHTML = '';
      for (var r = 0; r < 12; r++) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'qbtn' + (state.quickRoot === r ? ' active' : '');
        b.textContent = noteName(r);
        b.setAttribute('data-root', String(r));
        b.addEventListener('click', function (ev) {
          state.quickRoot = +ev.currentTarget.getAttribute('data-root');
          renderQuick();
        });
        roots.appendChild(b);
      }
    }
    if (quals) {
      quals.innerHTML = '';
      QUALITIES.forEach(function (q) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'qbtn' + (state.quickQuality === q.id ? ' active' : '');
        b.textContent = q.label;
        b.addEventListener('click', function () {
          state.quickQuality = q.id;
          renderQuick();
          addQuickChord();
        });
        quals.appendChild(b);
      });
    }
  }

  /* ---------- Settings / tuning ---------- */
  function openSettings(on) {
    var sheet = $('settings-sheet');
    var bd = $('settings-backdrop');
    if (!sheet || !bd) return;
    sheet.hidden = !on;
    bd.hidden = !on;
    if (on) renderSettings();
  }

  function renderSettings() {
    var presets = $('tuning-presets');
    var per = $('per-string');
    if (presets) {
      presets.innerHTML = '';
      PRESETS.forEach(function (p) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'qbtn' + (state.presetId === p.id ? ' active' : '');
        b.textContent = p.name;
        b.title = p.label;
        b.addEventListener('click', function () {
          state.presetId = p.id;
          state.offsets = [0, 0, 0, 0, 0, 0];
          save();
          afterTuningChange();
          renderSettings();
        });
        presets.appendChild(b);
      });
    }
    if (per) {
      per.innerHTML = '';
      var tun = tuningPcs();
      // Show low→high with string numbers
      for (var s = 0; s < STRING_COUNT; s++) {
        var row = document.createElement('div');
        row.className = 'ps-row';
        var lab = document.createElement('div');
        lab.className = 'lab';
        lab.textContent = noteName(tun[s]);
        var note = document.createElement('div');
        note.className = 'note';
        note.textContent = 'String ' + (s + 1) + (s === 0 ? ' (low)' : s === 5 ? ' (high)' : '');
        var adj = document.createElement('div');
        adj.className = 'adj';
        var minus = document.createElement('button');
        minus.type = 'button';
        minus.textContent = '−';
        var off = document.createElement('span');
        off.className = 'off';
        var o = state.offsets[s] || 0;
        off.textContent = (o > 0 ? '+' : '') + o;
        var plus = document.createElement('button');
        plus.type = 'button';
        plus.textContent = '+';
        (function (idx) {
          minus.addEventListener('click', function () {
            state.offsets[idx] = ((state.offsets[idx] || 0) - 1);
            if (state.offsets[idx] < -5) state.offsets[idx] = -5;
            save();
            afterTuningChange();
            renderSettings();
          });
          plus.addEventListener('click', function () {
            state.offsets[idx] = ((state.offsets[idx] || 0) + 1);
            if (state.offsets[idx] > 5) state.offsets[idx] = 5;
            save();
            afterTuningChange();
            renderSettings();
          });
        })(s);
        adj.appendChild(minus);
        adj.appendChild(off);
        adj.appendChild(plus);
        row.appendChild(lab);
        row.appendChild(note);
        row.appendChild(adj);
        per.appendChild(row);
      }
    }
  }

  function afterTuningChange() {
    afterNeckChange();
  }

  /* ---------- Scrub ---------- */
  function wireScrub() {
    var scrub = $('fret-pos');
    if (!scrub) return;
    scrub.max = String(Math.max(0, MAX_FRET - FRET_WINDOW + 1));
    scrub.addEventListener('input', function () {
      state.startFret = +scrub.value || 0;
      renderNeck();
    });
  }

  /* ---------- Boot ---------- */
  function wire() {
    $('btn-clear') && $('btn-clear').addEventListener('click', clearNeck);
    $('btn-add') && $('btn-add').addEventListener('click', addCurrentChord);
    $('btn-settings') && $('btn-settings').addEventListener('click', function () { openSettings(true); });
    $('btn-settings-close') && $('btn-settings-close').addEventListener('click', function () { openSettings(false); });
    $('settings-backdrop') && $('settings-backdrop').addEventListener('click', function () { openSettings(false); });
    $('btn-scales-close') && $('btn-scales-close').addEventListener('click', function () { openScalesSheet(false); });
    $('scales-backdrop') && $('scales-backdrop').addEventListener('click', function () { openScalesSheet(false); });
    wireScrub();
  }

  // Expose for tests
  window.ChordFinder = {
    state: state,
    getStringLabelsTopToBottom: getStringLabelsTopToBottom,
    stringPitch: stringPitch,
    getFits: function () { return (state._fits || []).map(function (f) { return f.label; }); },
    getNear: function () { return (state._near || []).map(function (f) { return f.label; }); },
    selectedScaleNotes: function () {
      var info = selectedScaleInfo();
      return info ? info.notes : [];
    },
    setShape: function (shape) {
      // shape like "x32010" or "022000" low-E→high-e (bass→treble)
      var s = String(shape).toLowerCase();
      if (s.length !== 6) throw new Error('shape length');
      for (var i = 0; i < 6; i++) {
        var ch = s.charAt(i);
        if (ch === 'x') state.frets[i] = null;
        else state.frets[i] = parseInt(ch, 10);
      }
      afterNeckChange();
      return state.names.map(function (n) { return n.display; });
    },
    addCurrent: addCurrentChord,
    addQuick: function (root, qid) {
      state.quickRoot = root;
      state.quickQuality = qid;
      addQuickChord();
    },
    clearChords: function () {
      state.chords = [];
      state.topKey = null;
      state._fits = [];
      state._near = [];
      state.selectedScale = null;
      state.noExactFit = false;
      state.closestMsg = '';
      clearClashLine();
      save();
      renderKey();
      renderStrip();
      renderNeck();
    },
    noteName: noteName,
    analyze: analyzePitchSet
  };

  function boot() {
    load();
    wire();
    renderQuick();
    renderNeck();
    renderGuess();
    recomputeKeys({});
    renderStrip();
    updateAddEnabled();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
