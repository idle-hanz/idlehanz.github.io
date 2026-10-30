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
    { id: 'major', name: 'major', intervals: [0, 2, 4, 5, 7, 9, 11], weight: 1.0 },
    { id: 'minor', name: 'natural minor', short: 'minor', intervals: [0, 2, 3, 5, 7, 8, 10], weight: 1.0 },
    { id: 'harmonic', name: 'harmonic minor', short: 'harm. minor', intervals: [0, 2, 3, 5, 7, 8, 11], weight: 0.72 },
    { id: 'dorian', name: 'dorian', short: 'dorian', intervals: [0, 2, 3, 5, 7, 9, 10], weight: 0.7 },
    { id: 'mixolydian', name: 'mixolydian', short: 'mixolydian', intervals: [0, 2, 4, 5, 7, 9, 10], weight: 0.7 }
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
    quickQuality: 'maj'
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
    var degMap = {
      0: 0, 1: 0, 2: 1, 3: 1, 4: 2, 5: 3,
      6: 3, 7: 4, 8: 4, 9: 5, 10: 5, 11: 6
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
        var expected = f.intervals.map(function (iv) { return (root + iv) % 12; });
        if (!subset(pcs, expected)) continue;
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
  function scoreKey(root, scale, chordList) {
    var tones = scale.intervals.map(function (iv) { return (root + iv) % 12; });
    var fit = 0;
    var total = 0;
    for (var i = 0; i < chordList.length; i++) {
      var pcs = chordList[i].pcs || [];
      var ok = true;
      for (var j = 0; j < pcs.length; j++) {
        total++;
        if (tones.indexOf(pcs[j]) < 0) ok = false;
        else fit++;
      }
      // also count whole-chord diatonic
      if (ok) fit += 2;
    }
    var score = fit * scale.weight;
    // slight preference: if many chord roots are diatonic degrees
    return { root: root, scale: scale, score: score, fitNotes: fit, total: total, tones: tones };
  }

  function chordsFitKey(chordList, root, scale) {
    var tones = scale.intervals.map(function (iv) { return (root + iv) % 12; });
    var n = 0;
    for (var i = 0; i < chordList.length; i++) {
      var pcs = chordList[i].pcs || [];
      var ok = true;
      for (var j = 0; j < pcs.length; j++) {
        if (tones.indexOf(pcs[j]) < 0) { ok = false; break; }
      }
      if (ok) n++;
    }
    return n;
  }

  function chordFitsKey(chord, root, scale) {
    var tones = scale.intervals.map(function (iv) { return (root + iv) % 12; });
    var pcs = chord.pcs || [];
    for (var j = 0; j < pcs.length; j++) {
      if (tones.indexOf(pcs[j]) < 0) return false;
    }
    return true;
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
      // prefer major / natural minor on ties
      var aw = a.scale.weight, bw = b.scale.weight;
      if (bw !== aw) return bw - aw;
      return a.root - b.root;
    });
    return ranked;
  }

  function keyLabel(c) {
    var short = c.scale.short || c.scale.name;
    return noteName(c.root) + ' ' + short;
  }

  function keyLabelLong(c) {
    return noteName(c.root) + ' ' + c.scale.name;
  }

  function recomputeKeys(opts) {
    opts = opts || {};
    var list = state.chords;
    if (!list.length) {
      state.topKey = null;
      state.chords.forEach(function (c) { c.clash = false; });
      renderKey();
      renderStrip();
      return;
    }

    var ranked = allCandidates(list);
    var best = ranked[0];
    var prev = state.topKey;

    // Candidates that contain ALL chords so far
    var perfect = ranked.filter(function (c) {
      return chordsFitKey(list, c.root, c.scale) === list.length;
    });

    var newTop = null;
    if (perfect.length) {
      newTop = perfect[0];
    } else {
      newTop = best;
    }

    // Clash rule: if previous top still exists and new chord doesn't fit it,
    // only switch if a new key fits STRICTLY more chords than the old one.
    if (prev && opts.addedChord) {
      var oldScale = SCALES.find(function (s) { return s.id === prev.scaleId; });
      if (oldScale) {
        var oldFit = chordsFitKey(list, prev.root, oldScale);
        var newFit = chordsFitKey(list, newTop.root, newTop.scale);
        var addedFitsOld = chordFitsKey(opts.addedChord, prev.root, oldScale);
        if (!addedFitsOld && newFit <= oldFit) {
          // Keep old key; mark clash on the new chord
          newTop = { root: prev.root, scale: oldScale, score: 0, tones: oldScale.intervals.map(function (iv) { return (prev.root + iv) % 12; }) };
          opts.addedChord.clash = true;
          showClash(opts.addedChord, newTop);
        } else if (!addedFitsOld && newFit > oldFit) {
          // Switch — clear clashes and recompute
          clearClashLine();
        }
      }
    }

    state.topKey = {
      root: newTop.root,
      scaleId: newTop.scale.id,
      name: keyLabelLong(newTop),
      short: keyLabel(newTop)
    };

    // Recompute clash flags vs current top
    var topScale = SCALES.find(function (s) { return s.id === state.topKey.scaleId; });
    state.chords.forEach(function (c) {
      c.clash = !chordFitsKey(c, state.topKey.root, topScale);
    });

    // Remaining candidates that contain all chords
    state._perfect = perfect.map(function (c) {
      return { root: c.root, scaleId: c.scale.id, label: keyLabel(c) };
    });
    // If none perfect, show top few by score as "near"
    if (!state._perfect.length) {
      state._perfect = ranked.slice(0, 4).map(function (c) {
        return { root: c.root, scaleId: c.scale.id, label: keyLabel(c), partial: true };
      });
    }

    renderKey();
    renderStrip();
  }

  function findBorrowSource(chord, fromKey) {
    // Look for a related key that contains this chord: parallel minor/major, etc.
    var ranked = allCandidates([chord]);
    for (var i = 0; i < ranked.length; i++) {
      var c = ranked[i];
      if (chordFitsKey(chord, c.root, c.scale)) {
        // Prefer same root different mode, or relative
        if (c.root === fromKey.root && c.scale.id !== fromKey.scaleId) {
          return keyLabelLong(c);
        }
      }
    }
    for (var j = 0; j < ranked.length; j++) {
      if (chordFitsKey(chord, ranked[j].root, ranked[j].scale)) {
        return keyLabelLong(ranked[j]);
      }
    }
    return null;
  }

  function showClash(chord, topKeyLike) {
    var rootName = noteName(chord.root);
    var keyName = topKeyLike.scale
      ? keyLabelLong(topKeyLike)
      : (state.topKey && state.topKey.name) || 'current key';
    var borrow = findBorrowSource(chord, {
      root: topKeyLike.root,
      scaleId: topKeyLike.scale ? topKeyLike.scale.id : (state.topKey && state.topKey.scaleId)
    });
    var msg = rootName + ' is outside ' + keyName;
    if (borrow) msg += ' — borrowed from ' + borrow;
    state.clashMsg = msg;
    var el = $('clash-line');
    if (el) {
      el.hidden = false;
      el.textContent = msg;
    }
    if (state.clashTimer) clearTimeout(state.clashTimer);
    state.clashTimer = setTimeout(function () {
      clearClashLine(true);
    }, 4000);
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
            source: c.source || ''
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
            source: c.source || ''
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
    if (sounded.pcs.length < 2) {
      if (el) el.textContent = sounded.pcs.length ? 'Need more notes…' : 'Tap frets';
      if (alts) alts.innerHTML = '';
      return;
    }
    if (!state.names.length) {
      if (el) el.textContent = 'No match';
      if (alts) alts.innerHTML = '';
      return;
    }
    var top = state.names[state.selectedNameIndex] || state.names[0];
    if (el) el.textContent = top.display;
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
      pcs: (hit.pcs && hit.pcs.length ? hit.pcs : soundingPcs().pcs).slice(),
      clash: false,
      source: 'neck',
      display: hit.display
    };
    // Prefer actual sounded pcs for key fitting
    chord.pcs = soundingPcs().pcs.slice();
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
      display: name
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
      if (c.source === 'quick') {
        var sub = document.createElement('div');
        sub.className = 't-sub';
        sub.textContent = 'quick';
        tile.appendChild(sub);
      }
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

  function renderKey() {
    var el = $('key-readout');
    var cand = $('candidates');
    if (!state.chords.length) {
      if (el) el.textContent = 'Key: —';
      if (cand) cand.innerHTML = '';
      return;
    }
    if (el) el.textContent = 'Key: ' + (state.topKey ? state.topKey.short : '—');
    if (cand) {
      cand.innerHTML = '';
      var list = state._perfect || [];
      var show = list.slice(0, 6);
      show.forEach(function (c, i) {
        var s = document.createElement('span');
        s.className = 'cand' + (i === 0 ? ' top' : '');
        s.textContent = c.label + (c.partial ? '?' : '');
        cand.appendChild(s);
      });
      var count = document.createElement('span');
      count.className = 'cand-count';
      var perfectCount = list.filter(function (x) { return !x.partial; }).length;
      if (perfectCount) count.textContent = perfectCount + ' fit';
      else count.textContent = list.length + ' near';
      cand.appendChild(count);
    }
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
    wireScrub();
  }

  // Expose for tests
  window.ChordFinder = {
    state: state,
    getStringLabelsTopToBottom: getStringLabelsTopToBottom,
    stringPitch: stringPitch,
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
      clearClashLine();
      save();
      renderKey();
      renderStrip();
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
