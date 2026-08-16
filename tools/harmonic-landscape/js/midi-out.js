/**
 * Harmonic Landscape — realtime MIDI output
 * Web MIDI notes to a hardware or virtual synth. Not .mid file export.
 * Not chase (that is DAW → Fretboard input on a different port).
 *
 * Hover / soft previews stay Web Audio. Click, Write, and Play send notes.
 * Play can also send clock + start/stop. Timers are cancellable
 * (Web MIDI future timestamps are not).
 *
 * Bass split: bass notes on the bass channel, uppers on the pad channel.
 * Pad/Bass oct + spread + vel + CC7 level. Per-stream mute. Channels 1–16.
 * Speak figures (Play only, needs beats + bpm): hold / pulse / walk / stab.
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'ih_landscape_midi_out';
  var MSG_CLOCK = 0xf8;
  var MSG_START = 0xfa;
  var MSG_STOP = 0xfc;

  var access = null;
  var output = null;
  var denied = false;
  var muteBrowser = false;
  var bassSplit = false;
  var speakMode = 'hold';
  var clockOut = false;
  var padOct = 0;
  var bassOct = 0;
  var padSpread = 'written'; // close | written | open | shell | rootless | drop2
  var bassSpread = 0; // 0 one note · 1 +8va · 2 ±8va
  var padVel = 72;
  var bassVel = 95;
  var padCh = 0; // MIDI channel 1
  var bassCh = 1; // MIDI channel 2
  var padLevel = 100;
  var bassLevel = 100;
  var padMute = false;
  var bassMute = false;
  var savedName = '';
  var sounding = Object.create(null);
  var noteTimers = [];
  var clockTimers = [];
  var noteGen = 0;
  var clockGen = 0;
  var clockRunning = false;
  var clockBpm = 96;
  var nextPulseAudio = 0;
  var wired = false;

  function loadPrefs() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var o = JSON.parse(raw);
      if (o && typeof o.portName === 'string') savedName = o.portName;
      muteBrowser = !!(o && o.muteBrowser);
      bassSplit = !!(o && o.bassSplit);
      if (o && typeof o.speak === 'string' && isSpeak(o.speak)) speakMode = o.speak;
      clockOut = !!(o && o.clockOut);
      if (o && o.padOct != null) padOct = clampOct(o.padOct);
      if (o && o.bassOct != null) bassOct = clampOct(o.bassOct);
      if (o && o.padSpread != null) padSpread = padShapeId(o.padSpread);
      if (o && o.bassSpread != null) bassSpread = clampBassSpr(o.bassSpread);
      if (o && o.padVel != null) padVel = clampVel(o.padVel);
      if (o && o.bassVel != null) bassVel = clampVel(o.bassVel);
      if (o && o.padCh != null) padCh = clampCh(o.padCh);
      if (o && o.bassCh != null) bassCh = clampCh(o.bassCh);
      if (o && o.padLevel != null) padLevel = clampLevel(o.padLevel);
      if (o && o.bassLevel != null) bassLevel = clampLevel(o.bassLevel);
      padMute = !!(o && o.padMute);
      bassMute = !!(o && o.bassMute);
    } catch (_) {
      /* ignore */
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          portName: savedName || '',
          muteBrowser: !!muteBrowser,
          bassSplit: !!bassSplit,
          speak: speakMode || 'hold',
          clockOut: !!clockOut,
          padOct: padOct,
          bassOct: bassOct,
          padSpread: padSpread,
          bassSpread: bassSpread,
          padVel: padVel,
          bassVel: bassVel,
          padCh: padCh,
          bassCh: bassCh,
          padLevel: padLevel,
          bassLevel: bassLevel,
          padMute: !!padMute,
          bassMute: !!bassMute,
        })
      );
    } catch (_) {
      /* ignore */
    }
  }

  function isSpeak(v) {
    return v === 'hold' || v === 'pulse' || v === 'walk' || v === 'stab';
  }

  function clampOct(n) {
    n = parseInt(n, 10);
    if (!isFinite(n)) return 0;
    return Math.max(-3, Math.min(3, n));
  }

  function padShapeId(v) {
    if (v === 0 || v === '0' || v === 'close') return 'close';
    if (v === 2 || v === '2' || v === 'open') return 'open';
    if (v === 'shell') return 'shell';
    if (v === 'rootless') return 'rootless';
    if (v === 'drop2') return 'drop2';
    return 'written';
  }

  function clampPadSpr(n) {
    return padShapeId(n);
  }

  function clampBassSpr(n) {
    n = parseInt(n, 10);
    if (!isFinite(n)) return 0;
    return Math.max(0, Math.min(2, n));
  }

  function clampVel(n) {
    n = parseInt(n, 10);
    if (!isFinite(n)) return 80;
    return Math.max(1, Math.min(127, n));
  }

  function clampCh(n) {
    n = parseInt(n, 10);
    if (!isFinite(n)) return 0;
    return Math.max(0, Math.min(15, n));
  }

  function clampLevel(n) {
    n = parseInt(n, 10);
    if (!isFinite(n)) return 100;
    return Math.max(0, Math.min(127, n));
  }

  function padChannel() {
    return padCh;
  }

  function bassChannel() {
    return bassSplit ? bassCh : padCh;
  }

  function clampMidi(n) {
    n = n | 0;
    if (n < 0) return 0;
    if (n > 127) return 127;
    return n;
  }

  function uniqueSorted(notes) {
    var seen = Object.create(null);
    var out = [];
    (notes || []).forEach(function (n) {
      n = clampMidi(n);
      if (seen[n]) return;
      seen[n] = 1;
      out.push(n);
    });
    out.sort(function (a, b) {
      return a - b;
    });
    return out;
  }

  function pcOf(n) {
    return ((n % 12) + 12) % 12;
  }

  function chordIntervals(chord, midiNotes, bassPc) {
    var root =
      chord && chord.root != null ? pcOf(chord.root) : bassPc != null ? pcOf(bassPc) : 0;
    var raw = [];
    if (chord && chord.intervals && chord.intervals.length) {
      raw = chord.intervals;
    } else {
      var M = global.HLMusic;
      var q = chord && chord.quality && M && M.QUALITIES && M.QUALITIES[chord.quality];
      if (q && q.intervals) raw = q.intervals;
      else if (chord && chord.notes && chord.notes.length) raw = chord.notes.map(function (n) {
        return (pcOf(n) - root + 12) % 12;
      });
      else raw = (midiNotes || []).map(function (n) {
        return (pcOf(n) - root + 12) % 12;
      });
    }
    var out = [];
    var seen = Object.create(null);
    raw.forEach(function (iv) {
      var i = ((iv % 12) + 12) % 12;
      if (seen[i]) return;
      seen[i] = 1;
      out.push(i);
    });
    return { root: root, ivs: out };
  }

  function placePcNear(pc, hint) {
    var m = Math.floor(hint / 12) * 12 + pcOf(pc);
    while (m < hint - 6) m += 12;
    while (m > hint + 6) m -= 12;
    return clampMidi(m);
  }

  function closeSpread(sorted) {
    var root = sorted[0];
    var packed = [];
    sorted.forEach(function (n) {
      var m = Math.floor(root / 12) * 12 + pcOf(n);
      while (m < root) m += 12;
      if (packed.length) {
        while (m <= packed[packed.length - 1]) m += 12;
        if (m > root + 14 && m - 12 > packed[packed.length - 1]) m -= 12;
      }
      packed.push(clampMidi(m));
    });
    return uniqueSorted(packed);
  }

  function openSpread(sorted) {
    var opened = [sorted[0]];
    var i;
    for (i = 1; i < sorted.length; i++) {
      var m2 = sorted[i];
      while (m2 - opened[i - 1] < 7) m2 += 12;
      opened.push(clampMidi(m2));
    }
    return uniqueSorted(opened);
  }

  function shellVoicing(sorted, rawBass, chord) {
    var info = chordIntervals(chord, [rawBass].concat(sorted), rawBass);
    var third = null;
    var seventh = null;
    var fifth = null;
    var sus = null;
    info.ivs.forEach(function (i) {
      if (i === 3 || i === 4) third = i;
      if (i === 10 || i === 11) seventh = i;
      if (i === 7) fifth = i;
      if (i === 2 || i === 5) sus = i;
    });
    var a = third != null ? third : sus;
    var b = seventh != null ? seventh : fifth;
    if (a == null && b == null) return sorted;
    var hint = sorted.length ? sorted[0] : rawBass + 12;
    var notes = [];
    if (a != null) notes.push(placePcNear((info.root + a) % 12, hint));
    if (b != null) {
      var topHint = notes.length ? notes[0] + 6 : hint + 6;
      var top = placePcNear((info.root + b) % 12, topHint);
      if (notes.length && top <= notes[0]) top = clampMidi(top + 12);
      notes.push(top);
    }
    return uniqueSorted(notes);
  }

  function rootlessVoicing(sorted, chord, rawBass) {
    var root =
      chord && chord.root != null
        ? pcOf(chord.root)
        : rawBass != null
          ? pcOf(rawBass)
          : null;
    if (root == null) return sorted;
    var thin = sorted.filter(function (n) {
      return pcOf(n) !== root;
    });
    return thin.length ? thin : sorted;
  }

  function drop2Voicing(sorted) {
    if (sorted.length < 2) return sorted;
    var s = sorted.slice();
    var i = s.length - 2;
    var dropped = s[i] - 12;
    if (dropped < 0) return s;
    var j;
    for (j = 0; j < s.length; j++) {
      if (j !== i && s[j] === dropped) {
        dropped -= 12;
        break;
      }
    }
    if (dropped < 0) return s;
    s[i] = dropped;
    return uniqueSorted(s);
  }

  function applyPadSpread(uppers, mode, rawBass, chord) {
    var sorted = uniqueSorted(uppers);
    if (!sorted.length) {
      if (mode === 'shell') return shellVoicing([], rawBass, chord);
      return [];
    }
    if (mode === 'close') return closeSpread(sorted);
    if (mode === 'open') return openSpread(sorted);
    if (mode === 'shell') return shellVoicing(sorted, rawBass, chord);
    if (mode === 'rootless') return rootlessVoicing(sorted, chord, rawBass);
    if (mode === 'drop2') return drop2Voicing(sorted);
    return sorted;
  }

  function bassFamily(rootMidi) {
    var root = clampMidi(rootMidi);
    var out = [root];
    if (bassSpread >= 1 && root + 12 <= 127) out.push(root + 12);
    if (bassSpread >= 2 && root - 12 >= 0) out.unshift(root - 12);
    return uniqueSorted(out);
  }

  function chordBassPc(chord, fallbackMidi) {
    if (chord) {
      if (chord.bassPc != null) return pcOf(chord.bassPc);
      if (chord.root != null) return pcOf(chord.root);
    }
    if (fallbackMidi != null) return pcOf(fallbackMidi);
    return 0;
  }

  function placeBassMidi(bassPc, hint) {
    var n = 36 + pcOf(bassPc);
    if (n < 40) n += 12;
    if (n > 52) n -= 12;
    if (hint != null) {
      var near = placePcNear(bassPc, hint);
      if (near >= 28 && near <= 55) return near;
    }
    return n;
  }

  function fillChordPad(pad, chord, bassPc, hint) {
    var info = chordIntervals(chord, pad, bassPc);
    var have = Object.create(null);
    (pad || []).forEach(function (n) {
      have[pcOf(n)] = 1;
    });
    var h = hint != null ? hint : pad && pad.length ? pad[0] : 60;
    info.ivs.forEach(function (iv) {
      var p = (info.root + iv) % 12;
      if (p === bassPc || have[p]) return;
      pad.push(placePcNear(p, h));
      have[p] = 1;
    });
    return uniqueSorted(pad);
  }

  function splitForMidi(midi, chord) {
    var sorted = uniqueSorted(midi);
    var bassPc = chordBassPc(chord, sorted[0]);
    var bassMidi = null;
    var pad = [];
    sorted.forEach(function (n) {
      if (pcOf(n) === bassPc && bassMidi == null) bassMidi = n;
      else pad.push(n);
    });
    if (bassMidi == null) bassMidi = placeBassMidi(bassPc, sorted[0]);
    pad = fillChordPad(
      pad,
      chord,
      bassPc,
      pad.length ? pad[0] : bassMidi + 12
    );
    return { bassMidi: bassMidi, pad: pad };
  }

  function shapePadNotes(uppers, rawBass, chord) {
    return uniqueSorted(
      applyPadSpread(uppers, padShapeId(padSpread), rawBass, chord).map(function (n) {
        return n + padOct * 12;
      })
    );
  }

  function octLabel(n) {
    n = clampOct(n);
    if (n > 0) return '+' + n;
    return String(n);
  }

  function padSpreadLabel() {
    var s = padShapeId(padSpread);
    if (s === 'close') return 'close';
    if (s === 'open') return 'open';
    if (s === 'shell') return 'shell';
    if (s === 'rootless') return 'rootless';
    if (s === 'drop2') return 'drop 2';
    return 'as written';
  }

  function bassSpreadLabel() {
    if (bassSpread >= 2) return '±8va';
    if (bassSpread >= 1) return '+8va';
    return '1 note';
  }

  function status(msg) {
    var H = global.HLApp;
    if (H && H.setSyncStatus) H.setSyncStatus(msg);
  }

  function isChaseName(name) {
    return /chase/i.test(name || '');
  }

  function listOutputs() {
    var out = [];
    if (!access) return out;
    access.outputs.forEach(function (p) {
      out.push(p);
    });
    out.sort(function (a, b) {
      return String(a.name || a.id).localeCompare(String(b.name || b.id));
    });
    return out;
  }

  function isLive() {
    return !!(output && output.state !== 'disconnected');
  }

  function wantsChord(opts) {
    opts = opts || {};
    if (!isLive()) return false;
    if (opts.midiOut === false) return false;
    if (opts.soft) return false;
    return true;
  }

  function rawSend(data) {
    if (!output) return;
    try {
      output.send(data);
    } catch (_) {
      /* port went away */
    }
  }

  function clearList(list) {
    list.forEach(function (id) {
      clearTimeout(id);
    });
    list.length = 0;
  }

  function delayMs(audioWhen, ctx) {
    if (audioWhen == null || !ctx) return 0;
    return Math.max(0, (audioWhen - ctx.currentTime) * 1000);
  }

  function scheduleOn(list, ms, fn) {
    var id = setTimeout(function () {
      var ix = list.indexOf(id);
      if (ix >= 0) list.splice(ix, 1);
      fn();
    }, Math.max(0, ms));
    list.push(id);
  }

  function scheduleNote(ms, fn) {
    scheduleOn(noteTimers, ms, fn);
  }

  function scheduleClock(ms, fn) {
    scheduleOn(clockTimers, ms, fn);
  }

  function soundKey(ch, n) {
    return (ch | 0) + ':' + (n | 0);
  }

  function noteOffOne(ch, n) {
    n = n | 0;
    ch = ch | 0;
    if (n < 0 || n > 127) return;
    rawSend([0x80 | ch, n, 0]);
    delete sounding[soundKey(ch, n)];
  }

  function noteOnOne(ch, n, vel, stream) {
    n = n | 0;
    ch = ch | 0;
    vel = clampVel(vel);
    if (n < 0 || n > 127) return;
    if (sounding[soundKey(ch, n)]) noteOffOne(ch, n);
    rawSend([0x90 | ch, n, vel]);
    sounding[soundKey(ch, n)] = stream || 'pad';
  }

  function noteOffTracked() {
    Object.keys(sounding).forEach(function (k) {
      var parts = k.split(':');
      rawSend([0x80 | (parts[0] | 0), parts[1] | 0, 0]);
    });
    sounding = Object.create(null);
  }

  function sendCc(ch, cc, val) {
    if (!isLive()) return;
    rawSend([0xb0 | clampCh(ch), cc & 127, clampLevel(val)]);
  }

  function pushLevels() {
    sendCc(padCh, 7, padLevel);
    sendCc(bassCh, 7, bassLevel);
  }

  function sendCcSilence() {
    var seen = Object.create(null);
    [padCh, bassCh].forEach(function (ch) {
      ch = clampCh(ch);
      if (seen[ch]) return;
      seen[ch] = 1;
      rawSend([0xb0 | ch, 123, 0]);
      rawSend([0xb0 | ch, 120, 0]);
    });
  }

  function noteOffStream(stream) {
    Object.keys(sounding).forEach(function (k) {
      if (sounding[k] !== stream) return;
      var parts = k.split(':');
      rawSend([0x80 | (parts[0] | 0), parts[1] | 0, 0]);
      delete sounding[k];
    });
  }

  function silence(opts) {
    opts = opts || {};
    noteGen += 1;
    clearList(noteTimers);
    noteOffTracked();
    if (opts.cc) sendCcSilence();
  }

  function silenceAt(audioWhen, ctx) {
    if (!isLive()) return;
    scheduleNote(delayMs(audioWhen, ctx), function () {
      noteGen += 1;
      noteOffTracked();
    });
  }

  function panic() {
    noteGen += 1;
    clearList(noteTimers);
    var ch;
    var n;
    for (ch = 0; ch < 16; ch++) {
      for (n = 0; n < 128; n++) rawSend([0x80 | ch, n, 0]);
      rawSend([0xb0 | ch, 123, 0]);
      rawSend([0xb0 | ch, 120, 0]);
    }
    sounding = Object.create(null);
    status('Synth panic · all notes off');
  }

  function walkBass(rootMidi, useFifth) {
    if (!useFifth) return rootMidi;
    var up = rootMidi + 7;
    if (up <= 127) return up;
    var down = rootMidi - 5;
    return down >= 0 ? down : clampMidi(up);
  }

  function pinchWalkNote(bassRoot, padNotes, chord) {
    if (!padNotes || !padNotes.length) return walkBass(bassRoot, true);
    var bassPc = pcOf(bassRoot);
    var rootPc = chord && chord.root != null ? pcOf(chord.root) : bassPc;
    var pool = [];
    padNotes.forEach(function (n) {
      var p = pcOf(n);
      if (p === bassPc) return;
      if (pool.indexOf(p) < 0) pool.push(p);
    });
    if (!pool.length) return walkBass(bassRoot, true);
    function rank(p) {
      var iv = (p - rootPc + 12) % 12;
      var r = 5;
      if (iv === 7) r = 0;
      else if (iv === 3 || iv === 4) r = 1;
      else if (iv === 10 || iv === 11) r = 2;
      else if (iv === 6) r = 3;
      // Keep the chord root on the pad when another tone exists
      if (p === rootPc && pool.length > 1) r += 10;
      return r;
    }
    pool.sort(function (a, b) {
      var d = rank(a) - rank(b);
      return d || a - b;
    });
    var m = Math.floor(bassRoot / 12) * 12 + pool[0];
    while (m <= bassRoot) m += 12;
    if (m - bassRoot > 10 && m - 12 > bassRoot) m -= 12;
    if (m === bassRoot) m = clampMidi(m + 12);
    return clampMidi(m);
  }

  function noteOnMany(ch, notes, vel, stream) {
    if (stream === 'pad' && padMute) return;
    if (stream === 'bass' && bassMute) return;
    (notes || []).forEach(function (n) {
      noteOnOne(ch, n, vel, stream);
    });
  }

  function noteOffMany(ch, notes) {
    (notes || []).forEach(function (n) {
      noteOffOne(ch, n);
    });
  }

  function scheduleFig(token, ms, fn) {
    scheduleNote(ms, function () {
      if (token !== noteGen) return;
      fn();
    });
  }

  function msFrom(t0, offsetSec, ctx, fallbackMs) {
    if (t0 != null && ctx) return delayMs(t0 + offsetSec, ctx);
    return fallbackMs;
  }

  function holdNotes(token, bassNotes, padNotes, split, durSec, t0, ctx) {
    var bCh = split ? bassCh : padCh;
    var pCh = padCh;
    noteOnMany(bCh, bassNotes, bassVel, 'bass');
    noteOnMany(pCh, padNotes, padVel, 'pad');
    scheduleFig(token, Math.max(80, msFrom(t0, durSec, ctx, durSec * 1000)), function () {
      noteOffMany(bCh, bassNotes);
      noteOffMany(pCh, padNotes);
    });
  }

  function speakPulseOrStab(token, bassNotes, padNotes, opts) {
    var split = !!opts.split;
    var stab = opts.speak === 'stab';
    var bCh = split ? bassCh : padCh;
    var pCh = padCh;
    var beatSec = 60 / opts.bpm;
    var beats = opts.beats;
    var t = 0;

    var t0 = opts.t0;
    var ctx = opts.ctx;

    if (!stab && padNotes.length) {
      noteOnMany(pCh, padNotes, padVel, 'pad');
      scheduleFig(token, Math.max(80, msFrom(t0, opts.duration, ctx, opts.duration * 1000)), function () {
        noteOffMany(pCh, padNotes);
      });
    }

    while (t < beats - 1e-4) {
      var slot = Math.min(1, beats - t);
      var slotSec = slot * beatSec;
      var gateSec = stab
        ? Math.max(0.04, Math.min(0.11, slotSec * 0.28))
        : Math.max(0.04, slotSec * 0.82);
      var startAt = t * beatSec;
      (function (hitAt, gate, doStab) {
        scheduleFig(token, msFrom(t0, hitAt, ctx, hitAt * 1000), function () {
          noteOnMany(bCh, bassNotes, bassVel, 'bass');
          if (doStab) noteOnMany(pCh, padNotes, padVel, 'pad');
          scheduleFig(token, msFrom(t0, hitAt + gate, ctx, gate * 1000), function () {
            noteOffMany(bCh, bassNotes);
            if (doStab) noteOffMany(pCh, padNotes);
          });
        });
      })(startAt, gateSec, stab);
      t += slot;
    }
  }

  function speakWalk(token, bassRoot, padNotes, opts) {
    var split = !!opts.split;
    var bCh = split ? bassCh : padCh;
    var pCh = padCh;
    var beatSec = 60 / opts.bpm;
    var beats = opts.beats;
    var offset = Number(opts.beatOffset) || 0;
    var pinchOn = Math.floor(Math.max(0, offset) / 2) % 2 === 1;
    var t = 0;
    var t0 = opts.t0;
    var ctx = opts.ctx;
    var pinchMidi = pinchWalkNote(bassRoot, padNotes, opts.chord);
    var pinchPc = pcOf(pinchMidi);
    var pinchedPad = (padNotes || []).filter(function (n) {
      return pcOf(n) === pinchPc;
    });
    var keptPad = (padNotes || []).filter(function (n) {
      return pcOf(n) !== pinchPc;
    });
    // Never strip the pad bare (A#°/E used to pinch the only pad tone).
    if (!keptPad.length) pinchedPad = [];
    var padLive = pinchOn && keptPad.length ? keptPad : padNotes;

    if (padLive.length) {
      noteOnMany(pCh, padLive, padVel, 'pad');
    }
    scheduleFig(token, Math.max(80, msFrom(t0, opts.duration, ctx, opts.duration * 1000)), function () {
      noteOffMany(pCh, padNotes);
    });

    var firstSlot = true;
    while (t < beats - 1e-4) {
      var slot = Math.min(2, beats - t);
      var walked = bassFamily(pinchOn ? pinchMidi : bassRoot);
      var startAt = t * beatSec;
      var holdSec = Math.max(0.04, slot * beatSec);
      (function (hitAt, hold, notes, takePinch, skipPadFlip) {
        scheduleFig(token, msFrom(t0, hitAt, ctx, hitAt * 1000), function () {
          if (!skipPadFlip && pinchedPad.length) {
            if (takePinch) noteOffMany(pCh, pinchedPad);
            else noteOnMany(pCh, pinchedPad, padVel, 'pad');
          }
          noteOnMany(bCh, notes, bassVel, 'bass');
          scheduleFig(token, msFrom(t0, hitAt + hold, ctx, hold * 1000), function () {
            noteOffMany(bCh, notes);
          });
        });
      })(startAt, holdSec, walked, pinchOn, firstSlot);
      firstSlot = false;
      t += slot;
      pinchOn = !pinchOn;
    }
  }

  function soundChord(midi, opts) {
    opts = opts || {};
    if (!isLive() || !midi || !midi.length) return;
    var notes = [];
    var seen = Object.create(null);
    midi.forEach(function (m) {
      var n = m | 0;
      if (n < 0 || n > 127 || seen[n]) return;
      seen[n] = 1;
      notes.push(n);
    });
    notes.sort(function (a, b) {
      return a - b;
    });
    if (!notes.length) return;

    var dur = opts.duration != null ? Number(opts.duration) : 1.35;
    if (!(dur > 0)) dur = 1.35;
    var onMs = delayMs(opts.when, opts.ctx);
    var bpm = Number(opts.bpm);
    var beats = Number(opts.beats);
    var speak = isSpeak(opts.speak) ? opts.speak : speakMode;
    if (opts.figure === false) speak = 'hold';
    if (speak !== 'hold') {
      if (!(bpm > 0)) bpm = liveBpm();
      if (!(beats > 0) && bpm > 0 && dur > 0) beats = (dur * bpm) / 60;
    }
    var canSpeak = speak !== 'hold' && bpm > 0 && beats > 0;
    var split = !!bassSplit;

    scheduleNote(onMs, function () {
      var token = ++noteGen;
      var streams = splitForMidi(notes, opts.chord);
      var padNotes = shapePadNotes(streams.pad, streams.bassMidi, opts.chord);
      var bassRoot = clampMidi(streams.bassMidi + bassOct * 12);
      var bassNotes = bassFamily(bassRoot);
      var t0 = opts.when;
      var ctx = opts.ctx;
      if (canSpeak && speak === 'walk') {
        speakWalk(token, bassRoot, padNotes, {
          split: split,
          bpm: bpm,
          beats: beats,
          duration: dur,
          beatOffset: opts.beatOffset,
          t0: t0,
          ctx: ctx,
          chord: opts.chord,
        });
      } else if (canSpeak && (speak === 'pulse' || speak === 'stab')) {
        speakPulseOrStab(token, bassNotes, padNotes, {
          speak: speak,
          split: split,
          bpm: bpm,
          beats: beats,
          duration: dur,
          t0: t0,
          ctx: ctx,
        });
      } else {
        holdNotes(token, bassNotes, padNotes, split, dur, t0, ctx);
      }
    });
  }

  function liveBpm() {
    var H = global.HLApp;
    var n = H && H.state ? Number(H.state.bpm) : 0;
    return n > 0 ? n : clockBpm || 96;
  }

  function audioNow() {
    var H = global.HLApp;
    var ctx = H && H.A && H.A().getContext && H.A().getContext();
    return { ctx: ctx || null, when: ctx ? ctx.currentTime : 0 };
  }

  function pumpClock(myGen, ctx) {
    function pump() {
      if (myGen !== clockGen || !clockRunning) return;
      var now = ctx ? ctx.currentTime : 0;
      var ahead = now + 0.1;
      var sec = 60 / (clockBpm * 24);
      if (!(sec > 0) || !isFinite(sec)) sec = 60 / (96 * 24);
      var guard = 0;
      while (nextPulseAudio <= ahead && guard < 48) {
        guard += 1;
        (function (t) {
          scheduleClock(delayMs(t, ctx), function () {
            if (myGen !== clockGen || !clockRunning) return;
            rawSend([MSG_CLOCK]);
          });
        })(nextPulseAudio);
        nextPulseAudio += sec;
      }
      scheduleClock(45, pump);
    }
    pump();
  }

  function beginTransport(opts) {
    opts = opts || {};
    if (!clockOut || !isLive()) return;
    var bpm = Number(opts.bpm);
    if (!(bpm > 0)) bpm = liveBpm();
    clockBpm = bpm;
    if (clockRunning) return;

    var ctx = opts.ctx;
    var when = opts.when != null && ctx ? opts.when : ctx ? ctx.currentTime : 0;
    clockRunning = true;
    var myGen = ++clockGen;
    nextPulseAudio = when;
    scheduleClock(delayMs(when, ctx), function () {
      if (myGen !== clockGen || !clockRunning) return;
      rawSend([MSG_START]);
    });
    pumpClock(myGen, ctx);
  }

  function endTransport() {
    if (!clockRunning && !clockTimers.length) {
      clockGen += 1;
      return;
    }
    var was = clockRunning;
    clockGen += 1;
    clockRunning = false;
    clearList(clockTimers);
    if (was) rawSend([MSG_STOP]);
  }

  function findPortByName(name) {
    if (!name) return null;
    var ports = listOutputs();
    var i;
    for (i = 0; i < ports.length; i++) {
      if ((ports[i].name || '') === name) return ports[i];
    }
    return null;
  }

  function extraStatus() {
    var bits = [];
    if (bassSplit) bits.push('pad ch' + (padCh + 1) + ' · bass ch' + (bassCh + 1));
    if (padMute) bits.push('pad mute');
    if (bassMute) bits.push('bass mute');
    if (padLevel !== 100 || bassLevel !== 100) {
      bits.push('lvl ' + padLevel + '/' + bassLevel);
    }
    if (padOct || padShapeId(padSpread) !== 'written') {
      bits.push('pad ' + octLabel(padOct) + ' ' + padSpreadLabel());
    }
    if (bassOct || bassSpread) {
      bits.push('bass ' + octLabel(bassOct) + ' ' + bassSpreadLabel());
    }
    if (padVel !== 72 || bassVel !== 95) {
      bits.push('vel ' + padVel + '/' + bassVel);
    }
    if (speakMode && speakMode !== 'hold') bits.push('Speak ' + speakMode);
    if (clockOut) bits.push(clockRunning ? 'clock' : 'clock armed');
    return bits.length ? ' · ' + bits.join(' · ') : '';
  }

  function setOutput(port, persistName) {
    var restartClock = false;
    if (output && output !== port) {
      restartClock = clockRunning;
      endTransport();
      silence({ cc: true });
    }
    output = port || null;
    if (persistName) {
      savedName = port && port.name ? port.name : '';
      savePrefs();
    }
    if (output && output.open) {
      try {
        var p = output.open();
        if (p && p.catch) p.catch(function () {});
      } catch (_) {
        /* already open */
      }
    }
    render();
    if (!output) {
      status('Synth off · browser tones only');
      return;
    }
    if (restartClock) beginTransport({ bpm: liveBpm() });
    pushLevels();
    var name = output.name || output.id || 'output';
    if (isChaseName(name)) {
      status(
        'Synth · ' +
          name +
          ' is the chase port (DAW → Fretboard). Use a second loopMIDI port.'
      );
    } else {
      status(
        'Synth · ' +
          name +
          (muteBrowser ? ' · browser tones muted' : '') +
          extraStatus()
      );
    }
  }

  function setPortById(id) {
    if (!id) {
      setOutput(null, true);
      return;
    }
    if (!access) return;
    var port = access.outputs.get(id);
    if (!port) {
      setOutput(null, false);
      status('Synth port gone');
      return;
    }
    setOutput(port, true);
  }

  function restoreSaved() {
    if (!savedName || !access) return;
    var port = findPortByName(savedName);
    if (port) setOutput(port, false);
  }

  function render() {
    var sel = document.getElementById('midi-out-port');
    var muteEl = document.getElementById('midi-out-mute');
    var panicBtn = document.getElementById('btn-midi-panic');
    var splitEl = document.getElementById('midi-out-split');
    var speakEl = document.getElementById('midi-out-speak');
    var clockEl = document.getElementById('midi-out-clock');
    var padOctEl = document.getElementById('midi-pad-oct');
    var padSprEl = document.getElementById('midi-pad-spr');
    var bassOctEl = document.getElementById('midi-bass-oct');
    var bassSprEl = document.getElementById('midi-bass-spr');
    var padVelEl = document.getElementById('midi-pad-vel');
    var bassVelEl = document.getElementById('midi-bass-vel');
    var padChEl = document.getElementById('midi-pad-ch');
    var bassChEl = document.getElementById('midi-bass-ch');
    var padMuteEl = document.getElementById('midi-pad-mute');
    var bassMuteEl = document.getElementById('midi-bass-mute');
    var padLvlEl = document.getElementById('midi-pad-lvl');
    var bassLvlEl = document.getElementById('midi-bass-lvl');
    var ports = listOutputs();
    var liveId = output && output.id;
    var live = isLive();

    if (sel) {
      var keep = sel.value;
      sel.innerHTML = '';
      var off = document.createElement('option');
      off.value = '';
      if (!navigator.requestMIDIAccess) {
        off.textContent = 'No Web MIDI — use Edge';
      } else if (denied) {
        off.textContent = 'MIDI denied — click to retry';
      } else if (!access) {
        off.textContent = 'Allow MIDI…';
      } else if (!ports.length) {
        off.textContent = 'No outputs';
      } else {
        off.textContent = 'Off';
      }
      sel.appendChild(off);
      ports.forEach(function (p) {
        var o = document.createElement('option');
        o.value = p.id;
        var label = p.name || p.id;
        if (isChaseName(label)) label += ' · chase — skip';
        o.textContent = label;
        sel.appendChild(o);
      });
      if (liveId && ports.some(function (p) { return p.id === liveId; })) {
        sel.value = liveId;
      } else if (keep && ports.some(function (p) { return p.id === keep; })) {
        sel.value = keep;
      } else {
        sel.value = '';
        if (liveId && !ports.some(function (p) { return p.id === liveId; })) {
          endTransport();
          output = null;
          live = false;
        }
      }
    }
    if (muteEl) {
      muteEl.checked = !!muteBrowser;
      muteEl.disabled = !live;
    }
    if (panicBtn) panicBtn.disabled = !live;
    if (splitEl) {
      splitEl.checked = !!bassSplit;
      splitEl.disabled = !live;
    }
    if (speakEl) {
      speakEl.value = isSpeak(speakMode) ? speakMode : 'hold';
      speakEl.disabled = !live;
    }
    if (clockEl) {
      clockEl.checked = !!clockOut;
      clockEl.disabled = !live;
    }
    if (padOctEl) {
      padOctEl.value = String(clampOct(padOct));
      padOctEl.disabled = !live;
    }
    if (padSprEl) {
      padSprEl.value = String(clampPadSpr(padSpread));
      padSprEl.disabled = !live;
    }
    if (bassOctEl) {
      bassOctEl.value = String(clampOct(bassOct));
      bassOctEl.disabled = !live;
    }
    if (bassSprEl) {
      bassSprEl.value = String(clampBassSpr(bassSpread));
      bassSprEl.disabled = !live;
    }
    if (padVelEl) {
      padVelEl.value = String(clampVel(padVel));
      padVelEl.disabled = !live;
    }
    if (bassVelEl) {
      bassVelEl.value = String(clampVel(bassVel));
      bassVelEl.disabled = !live;
    }
    fillChSel(padChEl, padCh, live);
    fillChSel(bassChEl, bassCh, live);
    if (padMuteEl) {
      padMuteEl.checked = !!padMute;
      padMuteEl.disabled = !live;
    }
    if (bassMuteEl) {
      bassMuteEl.checked = !!bassMute;
      bassMuteEl.disabled = !live;
    }
    if (padLvlEl) {
      padLvlEl.value = String(clampLevel(padLevel));
      padLvlEl.disabled = !live;
    }
    if (bassLvlEl) {
      bassLvlEl.value = String(clampLevel(bassLevel));
      bassLvlEl.disabled = !live;
    }
    paintVelLabels();
    paintLevelLabels();
  }

  function fillChSel(el, value, live) {
    if (!el) return;
    if (!el.options.length) {
      var i;
      for (i = 1; i <= 16; i++) {
        var o = document.createElement('option');
        o.value = String(i - 1);
        o.textContent = String(i);
        el.appendChild(o);
      }
    }
    el.value = String(clampCh(value));
    el.disabled = !live;
  }

  function paintVelLabels() {
    var pn = document.getElementById('midi-pad-vel-n');
    var bn = document.getElementById('midi-bass-vel-n');
    if (pn) pn.textContent = String(clampVel(padVel));
    if (bn) bn.textContent = String(clampVel(bassVel));
  }

  function paintLevelLabels() {
    var pn = document.getElementById('midi-pad-lvl-n');
    var bn = document.getElementById('midi-bass-lvl-n');
    if (pn) pn.textContent = String(clampLevel(padLevel));
    if (bn) bn.textContent = String(clampLevel(bassLevel));
  }

  function enable() {
    if (!navigator.requestMIDIAccess) {
      denied = false;
      render();
      status('No Web MIDI · open Landscape in Edge');
      return Promise.resolve(false);
    }
    if (access) {
      render();
      restoreSaved();
      return Promise.resolve(true);
    }
    return navigator
      .requestMIDIAccess({ sysex: false })
      .then(function (midi) {
        access = midi;
        denied = false;
        access.onstatechange = function () {
          if (output && output.state === 'disconnected') {
            endTransport();
            silence({ cc: true });
            output = null;
          }
          render();
          if (!output) restoreSaved();
        };
        render();
        restoreSaved();
        return true;
      })
      .catch(function () {
        denied = true;
        access = null;
        output = null;
        render();
        status('Web MIDI denied · allow MIDI for this page, then pick a port');
        return false;
      });
  }

  function onPortChange() {
    var sel = document.getElementById('midi-out-port');
    var id = sel ? sel.value : '';
    if (!access) {
      enable().then(function (ok) {
        if (!ok) return;
        var next = document.getElementById('midi-out-port');
        setPortById(next ? next.value : id);
      });
      return;
    }
    setPortById(id);
  }

  function onMuteChange() {
    var el = document.getElementById('midi-out-mute');
    muteBrowser = !!(el && el.checked);
    savePrefs();
    if (isLive()) {
      status(
        'Synth · ' +
          (output.name || 'port') +
          (muteBrowser ? ' · browser tones muted' : ' · browser tones on') +
          extraStatus()
      );
    }
  }

  function playingNow() {
    var H = global.HLApp;
    return !!(H && H.A && H.A().isPlaying && H.A().isPlaying());
  }

  function resyncIfPlaying() {
    var H = global.HLApp;
    if (playingNow() && H.resyncPlaybackPreservingPlace) {
      H.resyncPlaybackPreservingPlace();
      return true;
    }
    return false;
  }

  function hearShape() {
    if (resyncIfPlaying()) return;
    var H = global.HLApp;
    if (!H || !H.state || !H.A) return;
    var i = H.state.selected;
    var ch = i >= 0 ? H.state.chords[i] : null;
    if (!ch || !H.A().playChord) return;
    H.A().ensure();
    H.A().playChord({ chord: ch });
  }

  function onShapeChange() {
    var padOctEl = document.getElementById('midi-pad-oct');
    var padSprEl = document.getElementById('midi-pad-spr');
    var bassOctEl = document.getElementById('midi-bass-oct');
    var bassSprEl = document.getElementById('midi-bass-spr');
    padOct = clampOct(padOctEl && padOctEl.value);
    padSpread = clampPadSpr(padSprEl && padSprEl.value);
    bassOct = clampOct(bassOctEl && bassOctEl.value);
    bassSpread = clampBassSpr(bassSprEl && bassSprEl.value);
    savePrefs();
    if (isLive()) {
      status(
        'Synth range · Pad ' +
          octLabel(padOct) +
          ' · ' +
          padSpreadLabel() +
          ' · Bass ' +
          octLabel(bassOct) +
          ' · ' +
          bassSpreadLabel()
      );
    }
    hearShape();
  }

  function readVelEls() {
    var padVelEl = document.getElementById('midi-pad-vel');
    var bassVelEl = document.getElementById('midi-bass-vel');
    if (padVelEl) padVel = clampVel(padVelEl.value);
    if (bassVelEl) bassVel = clampVel(bassVelEl.value);
    paintVelLabels();
  }

  var velHearTimer = 0;

  function onVelInput() {
    readVelEls();
    if (playingNow()) return;
    if (velHearTimer) clearTimeout(velHearTimer);
    velHearTimer = setTimeout(function () {
      velHearTimer = 0;
      hearShape();
    }, 70);
  }

  function onVelChange() {
    readVelEls();
    savePrefs();
    if (velHearTimer) {
      clearTimeout(velHearTimer);
      velHearTimer = 0;
    }
    if (isLive()) {
      status('Synth vel · pad ' + padVel + ' · bass ' + bassVel);
    }
    if (!playingNow()) hearShape();
  }

  function readLevelEls() {
    var padLvlEl = document.getElementById('midi-pad-lvl');
    var bassLvlEl = document.getElementById('midi-bass-lvl');
    if (padLvlEl) padLevel = clampLevel(padLvlEl.value);
    if (bassLvlEl) bassLevel = clampLevel(bassLvlEl.value);
    paintLevelLabels();
  }

  function onLevelInput() {
    readLevelEls();
    pushLevels();
  }

  function onLevelChange() {
    readLevelEls();
    savePrefs();
    pushLevels();
    if (isLive()) {
      status('Synth level · pad ' + padLevel + ' · bass ' + bassLevel + ' (CC7)');
    }
  }

  function onStreamMute(stream) {
    var el = document.getElementById(stream === 'bass' ? 'midi-bass-mute' : 'midi-pad-mute');
    var on = !!(el && el.checked);
    if (stream === 'bass') bassMute = on;
    else padMute = on;
    savePrefs();
    if (on) noteOffStream(stream);
    else if (playingNow()) resyncIfPlaying();
    else hearShape();
    if (isLive()) {
      status(
        'Synth · ' +
          (stream === 'bass' ? 'bass' : 'pad') +
          (on ? ' muted' : ' on')
      );
    }
  }

  function onChannelChange() {
    var padChEl = document.getElementById('midi-pad-ch');
    var bassChEl = document.getElementById('midi-bass-ch');
    noteOffTracked();
    padCh = clampCh(padChEl && padChEl.value);
    bassCh = clampCh(bassChEl && bassChEl.value);
    savePrefs();
    pushLevels();
    if (isLive()) {
      var msg = 'Synth · pad ch ' + (padCh + 1) + ' · bass ch ' + (bassCh + 1);
      if (bassSplit && padCh === bassCh) {
        msg += ' · same channel — levels share one CC7';
      }
      status(msg);
    }
    if (!playingNow()) hearShape();
    else resyncIfPlaying();
  }

  function onSplitChange() {
    var el = document.getElementById('midi-out-split');
    bassSplit = !!(el && el.checked);
    savePrefs();
    if (isLive()) {
      status(
        'Synth · ' +
          (output.name || 'port') +
          (bassSplit
            ? ' · pad ch ' + (padCh + 1) + ' · bass ch ' + (bassCh + 1)
            : ' · all notes on ch ' + (padCh + 1))
      );
    }
    if (isLive()) pushLevels();
    resyncIfPlaying();
    if (!playingNow()) hearShape();
  }

  function onSpeakChange() {
    var el = document.getElementById('midi-out-speak');
    var v = el ? el.value : 'hold';
    speakMode = isSpeak(v) ? v : 'hold';
    savePrefs();
    if (isLive()) {
      status(
        'Synth · Speak ' +
          speakMode +
          (speakMode === 'hold'
            ? ' · pad hold'
            : ' · figures on Play (click stays hold)')
      );
    }
    resyncIfPlaying();
  }

  function onClockChange() {
    var el = document.getElementById('midi-out-clock');
    clockOut = !!(el && el.checked);
    savePrefs();
    if (!clockOut) {
      endTransport();
      if (isLive()) status('Synth · clock off');
      return;
    }
    if (isChaseName(output && output.name)) {
      status(
        'Synth clock · ' +
          (output.name || 'port') +
          ' looks like chase. Use a second loopMIDI port.'
      );
    } else if (playingNow()) {
      var t = audioNow();
      beginTransport({ bpm: liveBpm(), when: t.when, ctx: t.ctx });
      status('Synth · clock on · following Play');
    } else {
      status('Synth · clock armed · starts with Play (no SPP)');
    }
  }

  function wire() {
    if (wired) return;
    wired = true;
    loadPrefs();
    var sel = document.getElementById('midi-out-port');
    var muteEl = document.getElementById('midi-out-mute');
    var panicBtn = document.getElementById('btn-midi-panic');
    var splitEl = document.getElementById('midi-out-split');
    var speakEl = document.getElementById('midi-out-speak');
    var clockEl = document.getElementById('midi-out-clock');
    var padOctEl = document.getElementById('midi-pad-oct');
    var padSprEl = document.getElementById('midi-pad-spr');
    var bassOctEl = document.getElementById('midi-bass-oct');
    var bassSprEl = document.getElementById('midi-bass-spr');
    var padVelEl = document.getElementById('midi-pad-vel');
    var bassVelEl = document.getElementById('midi-bass-vel');
    var padChEl = document.getElementById('midi-pad-ch');
    var bassChEl = document.getElementById('midi-bass-ch');
    var padMuteEl = document.getElementById('midi-pad-mute');
    var bassMuteEl = document.getElementById('midi-bass-mute');
    var padLvlEl = document.getElementById('midi-pad-lvl');
    var bassLvlEl = document.getElementById('midi-bass-lvl');
    if (sel) {
      sel.addEventListener('mousedown', function (e) {
        if (access || !navigator.requestMIDIAccess) return;
        e.preventDefault();
        enable().then(function (ok) {
          try {
            if (ok && sel.showPicker) sel.showPicker();
            else sel.focus();
          } catch (_) {
            try {
              sel.focus();
            } catch (_2) {}
          }
          if (ok) status('MIDI ready · pick a synth port (not Idle Hanz Chase)');
        });
      });
      sel.addEventListener('focus', function () {
        if (!access) enable();
      });
      sel.addEventListener('change', onPortChange);
    }
    if (muteEl) muteEl.addEventListener('change', onMuteChange);
    if (panicBtn) panicBtn.addEventListener('click', panic);
    if (splitEl) splitEl.addEventListener('change', onSplitChange);
    if (speakEl) speakEl.addEventListener('change', onSpeakChange);
    if (clockEl) clockEl.addEventListener('change', onClockChange);
    if (padOctEl) padOctEl.addEventListener('change', onShapeChange);
    if (padSprEl) padSprEl.addEventListener('change', onShapeChange);
    if (bassOctEl) bassOctEl.addEventListener('change', onShapeChange);
    if (bassSprEl) bassSprEl.addEventListener('change', onShapeChange);
    if (padVelEl) {
      padVelEl.addEventListener('input', onVelInput);
      padVelEl.addEventListener('change', onVelChange);
    }
    if (bassVelEl) {
      bassVelEl.addEventListener('input', onVelInput);
      bassVelEl.addEventListener('change', onVelChange);
    }
    if (padChEl) padChEl.addEventListener('change', onChannelChange);
    if (bassChEl) bassChEl.addEventListener('change', onChannelChange);
    if (padMuteEl) {
      padMuteEl.addEventListener('change', function () {
        onStreamMute('pad');
      });
    }
    if (bassMuteEl) {
      bassMuteEl.addEventListener('change', function () {
        onStreamMute('bass');
      });
    }
    if (padLvlEl) {
      padLvlEl.addEventListener('input', onLevelInput);
      padLvlEl.addEventListener('change', onLevelChange);
    }
    if (bassLvlEl) {
      bassLvlEl.addEventListener('input', onLevelInput);
      bassLvlEl.addEventListener('change', onLevelChange);
    }
    render();
    if (savedName) enable();
    window.addEventListener('pagehide', function () {
      endTransport();
      silence({ cc: true });
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') silence({ cc: true });
    });
  }

  global.HLMidiOut = {
    wire: wire,
    enable: enable,
    wantsChord: wantsChord,
    muteBrowser: function () {
      return !!muteBrowser && isLive();
    },
    isLive: isLive,
    soundChord: soundChord,
    silence: silence,
    silenceAt: silenceAt,
    panic: panic,
    beginTransport: beginTransport,
    endTransport: endTransport,
  };
})(typeof window !== 'undefined' ? window : globalThis);
