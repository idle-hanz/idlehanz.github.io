/**
 * Harmonic Landscape — Web Audio chord engine
 * Soft preview, commit, BPM-accurate sequence playback.
 *
 * Sequence steps are scheduled on AudioContext.currentTime so durations
 * (in beats) and tempo stay aligned with the time strip.
 */
(function (global) {
  'use strict';

  let ctx = null;
  let master = null;
  let chordBus = null;
  let pulseBus = null;
  let reverbSend = null;
  let activeNodes = [];
  let playTimer = null;
  let pulseTimers = [];
  let uiTimers = [];
  let playing = false;
  let loopMode = false;
  /** { bpm, steps:[{i,start,end,beats,sec}], t0, len } */
  let transport = null;
  let noiseBuffer = null;

  function ensure() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();

      // Soft limiter so open voicings + pulse don't clip
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.knee.value = 18;
      comp.ratio.value = 3.5;
      comp.attack.value = 0.005;
      comp.release.value = 0.12;
      comp.connect(ctx.destination);

      master = ctx.createGain();
      master.gain.value = 0.72;
      master.connect(comp);

      chordBus = ctx.createGain();
      chordBus.gain.value = 0.85;
      chordBus.connect(master);

      // Separate louder path so metronome cuts through chords
      pulseBus = ctx.createGain();
      pulseBus.gain.value = 1.35;
      pulseBus.connect(master);

      reverbSend = ctx.createGain();
      reverbSend.gain.value = 0.18;
      const delay = ctx.createDelay(1.0);
      delay.delayTime.value = 0.22;
      const fb = ctx.createGain();
      fb.gain.value = 0.32;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2800;
      reverbSend.connect(delay);
      delay.connect(lp);
      lp.connect(fb);
      fb.connect(delay);
      lp.connect(master);

      // Shared click noise buffer
      const n = Math.floor(ctx.sampleRate * 0.04);
      noiseBuffer = ctx.createBuffer(1, n, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < n; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.006));
      }
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function midiToFreq(m) {
    return 440 * Math.pow(2, (m - 69) / 12);
  }

  function stopAll(fade) {
    fade = fade != null ? fade : 0.04;
    const c = ctx;
    if (!c) return;
    const now = c.currentTime;
    activeNodes.forEach(({ osc, gain }) => {
      try {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now);
        gain.gain.linearRampToValueAtTime(0.0001, now + fade);
        osc.stop(now + fade + 0.02);
      } catch (_) {
        /* already stopped */
      }
    });
    activeNodes = [];
  }

  /** Fade out active voices at a future audio time (for step boundaries). */
  function stopAllAt(when, fade) {
    fade = fade != null ? fade : 0.035;
    const c = ctx;
    if (!c || !activeNodes.length) return;
    const t = Math.max(c.currentTime, when);
    const nodes = activeNodes.slice();
    activeNodes = [];
    nodes.forEach(({ osc, gain }) => {
      try {
        gain.gain.cancelScheduledValues(t);
        const cur = Math.max(0.0001, gain.gain.value);
        gain.gain.setValueAtTime(cur, t);
        gain.gain.linearRampToValueAtTime(0.0001, t + fade);
        osc.stop(t + fade + 0.02);
      } catch (_) {
        /* ignore */
      }
    });
  }

  function clearTimers(list) {
    list.forEach((id) => clearTimeout(id));
    list.length = 0;
  }

  /**
   * Metronome click — noise tick + bright square, scheduled on the audio clock
   * (not setTimeout) so it stays on the beat and loud enough to hear.
   */
  function schedulePulseAt(when, isDownbeat) {
    const c = ensure();
    if (!pulseBus || when < c.currentTime - 0.02) return;

    // Noise burst (woodblock-ish)
    if (noiseBuffer) {
      const src = c.createBufferSource();
      src.buffer = noiseBuffer;
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = isDownbeat ? 1600 : 2800;
      bp.Q.value = 2.4;
      const hp = c.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 600;
      const g = c.createGain();
      const peak = isDownbeat ? 0.55 : 0.32;
      g.gain.setValueAtTime(0.0001, when);
      g.gain.linearRampToValueAtTime(peak, when + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, when + (isDownbeat ? 0.07 : 0.045));
      src.connect(hp);
      hp.connect(bp);
      bp.connect(g);
      g.connect(pulseBus);
      src.start(when);
      src.stop(when + 0.08);
    }

    // Bright pitched tick on top
    const osc = c.createOscillator();
    const og = c.createGain();
    osc.type = 'square';
    osc.frequency.value = isDownbeat ? 1046 : 1568; // C6 / G6-ish
    const opeak = isDownbeat ? 0.14 : 0.08;
    og.gain.setValueAtTime(0.0001, when);
    og.gain.linearRampToValueAtTime(opeak, when + 0.0015);
    og.gain.exponentialRampToValueAtTime(0.0001, when + 0.035);
    const hp2 = c.createBiquadFilter();
    hp2.type = 'highpass';
    hp2.frequency.value = 800;
    osc.connect(hp2);
    hp2.connect(og);
    og.connect(pulseBus);
    osc.start(when);
    osc.stop(when + 0.05);
  }

  function playPulse(isDownbeat) {
    schedulePulseAt(ensure().currentTime, !!isDownbeat);
  }

  /** Whole-beat metronome clicks for a step, locked to audio start time. */
  function schedulePulses(beats, bpm, startWhen) {
    const beatSec = 60 / (bpm || 120);
    const n = Math.max(0, Math.floor(Number(beats) + 1e-9));
    for (let b = 0; b < n; b++) {
      schedulePulseAt(startWhen + b * beatSec, b % 4 === 0);
    }
  }

  function scheduleUi(atAudio, fn) {
    const delayMs = Math.max(0, (atAudio - ensure().currentTime) * 1000);
    uiTimers.push(
      setTimeout(() => {
        if (playing) fn();
      }, delayMs)
    );
  }

  /**
   * Play a chord with open voicing, stereo spread, staggered bloom.
   * opts.when — AudioContext time (default now)
   * opts.duration — sustain seconds
   * opts.layer — if true, do not stop existing voices first
   */
  function playChord(opts) {
    opts = opts || {};
    const c = ensure();
    const M = global.HLMusic;
    let midi = opts.midi;
    if (!midi && opts.chord && M) {
      midi = M.voiceLead(opts.chord, opts.prevMidi || null, 3);
    }
    if (!midi || !midi.length) return null;
    midi = midi.slice().sort((a, b) => a - b);

    if (!opts.layer) stopAll(opts.soft ? 0.04 : 0.06);

    const now = opts.when != null ? opts.when : c.currentTime;
    const soft = !!opts.soft;
    const dur = opts.duration != null ? opts.duration : soft ? 0.55 : 1.35;
    const voicing = midi;
    const n = voicing.length;
    const dest = chordBus || master;

    voicing.forEach((m, i) => {
      const isBass = i === 0;
      const isTop = i === n - 1;
      // Stagger so the chord blooms open instead of a single hit
      const stagger = soft ? i * 0.014 : i * 0.02;
      const t0 = now + stagger;
      const noteDur = Math.max(0.12, dur - stagger * 0.5);

      const filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = isBass
        ? soft
          ? 750
          : 950
        : isTop
          ? soft
            ? 4500
            : 5800
          : soft
            ? 2600
            : 3400;
      filter.Q.value = 0.45;

      const gain = c.createGain();
      const peak =
        (soft ? 0.1 : 0.13) * (isBass ? 1.2 : isTop ? 0.88 : 0.96) * (1 - i * 0.03);
      const attack = soft ? 0.055 : isBass ? 0.028 : 0.02 + i * 0.005;
      const release = soft ? 0.38 : 0.42;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(peak, t0 + attack);
      const sustainEnd = Math.max(t0 + attack + 0.04, t0 + noteDur - release);
      gain.gain.setValueAtTime(peak * 0.8, sustainEnd);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + noteDur);

      const panVal =
        n <= 1 ? 0 : isBass ? 0 : ((i - (n - 1) / 2) / Math.max(1, n - 1)) * 0.7;
      let outNode = gain;
      if (c.createStereoPanner) {
        const panner = c.createStereoPanner();
        panner.pan.value = panVal;
        gain.connect(panner);
        outNode = panner;
      }
      outNode.connect(dest);
      if (!isBass) outNode.connect(reverbSend);

      const layers = isBass
        ? [
            { type: 'sine', detune: 0, mul: 0.9 },
            { type: 'triangle', detune: -5, mul: 0.5 },
          ]
        : isTop
          ? [
              { type: 'sine', detune: 0, mul: 0.65 },
              { type: 'triangle', detune: 9, mul: 0.4 },
              { type: 'sine', detune: -7, mul: 0.22 },
            ]
          : [
              { type: 'triangle', detune: 0, mul: 0.65 },
              { type: 'sine', detune: 6, mul: 0.42 },
            ];

      layers.forEach((L) => {
        const osc = c.createOscillator();
        const og = c.createGain();
        osc.type = L.type;
        osc.frequency.value = midiToFreq(m);
        try {
          osc.detune.value = L.detune;
        } catch (_) {
          /* ignore */
        }
        og.gain.value = L.mul;
        osc.connect(og);
        og.connect(filter);
        osc.start(t0);
        osc.stop(t0 + noteDur + 0.06);
        activeNodes.push({ osc: osc, gain: gain });
      });

      filter.connect(gain);
    });

    return voicing;
  }

  function beatsToSeconds(beats, bpm) {
    return ((Number(beats) || 0) * 60) / (bpm || 120);
  }

  function buildSteps(chords, t0, bpm) {
    const steps = [];
    let t = t0;
    for (let s = 0; s < chords.length; s++) {
      const beats = chords[s].duration != null ? Number(chords[s].duration) : 4;
      const sec = beatsToSeconds(beats, bpm);
      steps.push({ i: s, start: t, end: t + sec, beats: beats, sec: sec });
      t += sec;
    }
    return steps;
  }

  /**
   * Play a sequence of chords (durations in beats @ bpm).
   * Overload: playSequence(chords, bpm, opts)
   * opts: { loop, pulse, onStep, onEnd, onLoop }
   */
  function playSequence(chords, bpm, onStep, onEnd, opts) {
    if (typeof onStep === 'object' && onStep !== null && onEnd == null) {
      opts = onStep;
      onStep = opts.onStep;
      onEnd = opts.onEnd;
    }
    opts = opts || {};
    stopPlayback();
    const c = ensure();
    if (!chords || !chords.length) {
      if (onEnd) onEnd();
      return;
    }

    playing = true;
    loopMode = !!opts.loop;
    // Same rule as before: pulse if not disabled AND (looping or pulse requested)
    const pulseOn = opts.pulse !== false && (!!opts.loop || !!opts.pulse);
    const bpmN = Number(bpm) || 120;
    let prevMidi = null;

    const t0 = c.currentTime + 0.05;
    transport = {
      bpm: bpmN,
      loop: loopMode,
      t0: t0,
      steps: buildSteps(chords, t0, bpmN),
      len: chords.length,
    };

    function endOnce() {
      const last = transport && transport.steps.length
        ? transport.steps[transport.steps.length - 1].end
        : ensure().currentTime;
      scheduleUi(last, () => {
        if (!playing) return;
        playing = false;
        clearTimers(pulseTimers);
        transport = null;
        if (onEnd) onEnd();
      });
    }

    function scheduleStep(index, when) {
      if (!playing) return;

      if (index >= chords.length) {
        if (loopMode) {
          if (opts.onLoop) opts.onLoop();
          prevMidi = null;
          const nextT0 = Math.max(when, ensure().currentTime + 0.02);
          transport = {
            bpm: bpmN,
            loop: true,
            t0: nextT0,
            steps: buildSteps(chords, nextT0, bpmN),
            len: chords.length,
          };
          scheduleStep(0, nextT0);
          return;
        }
        endOnce();
        return;
      }

      const ch = chords[index];
      const beats = ch.duration != null ? Number(ch.duration) : 4;
      const sec = beatsToSeconds(beats, bpmN);

      scheduleUi(when, () => {
        if (onStep) onStep(index, ch);
      });
      if (pulseOn) schedulePulses(beats, bpmN, when);

      // Crossfade out previous voices just before this attack
      if (index > 0 || (loopMode && transport && when > transport.t0 + 0.01)) {
        stopAllAt(when - 0.012, 0.03);
      }

      const sustain = Math.max(0.1, sec * 0.98);
      prevMidi = playChord({
        chord: ch,
        prevMidi: prevMidi,
        soft: false,
        when: when,
        duration: sustain,
        layer: true,
      });

      const nextWhen = when + sec;
      const wakeMs = Math.max(0, (nextWhen - 0.06 - ensure().currentTime) * 1000);
      playTimer = setTimeout(() => {
        if (!playing) return;
        scheduleStep(index + 1, nextWhen);
      }, wakeMs);
    }

    // Clear anything still ringing from previews
    stopAll(0.04);
    scheduleStep(0, t0);
  }

  function stopPlayback() {
    playing = false;
    loopMode = false;
    if (playTimer) {
      clearTimeout(playTimer);
      playTimer = null;
    }
    clearTimers(pulseTimers);
    clearTimers(uiTimers);
    transport = null;
    stopAll(0.08);
  }

  function isPlaying() {
    return playing;
  }

  function isLooping() {
    return playing && loopMode;
  }

  function getContext() {
    return ctx;
  }

  /**
   * Live playhead for the time strip / map.
   * null if idle.
   */
  function getPlayhead() {
    if (!playing || !transport || !ctx) return null;
    const now = ctx.currentTime;
    const steps = transport.steps;
    if (!steps || !steps.length) return null;

    let step = steps[0];
    for (let s = 0; s < steps.length; s++) {
      if (now >= steps[s].start && now < steps[s].end) {
        step = steps[s];
        break;
      }
      if (now >= steps[s].start) step = steps[s];
    }
    const intoSec = Math.max(0, Math.min(step.sec, now - step.start));
    const progress = step.sec > 0 ? intoSec / step.sec : 0;
    const beatsInto = intoSec * (transport.bpm / 60);
    let beatsElapsed = 0;
    for (let s = 0; s < step.i; s++) beatsElapsed += steps[s].beats;
    beatsElapsed += beatsInto;

    return {
      stepIndex: step.i,
      beatsIntoStep: beatsInto,
      stepBeats: step.beats,
      stepProgress: Math.max(0, Math.min(1, progress)),
      totalBeats: steps.reduce((a, s) => a + s.beats, 0),
      beatsElapsed: beatsElapsed,
      bpm: transport.bpm,
    };
  }

  global.HLAudio = {
    ensure: ensure,
    playChord: playChord,
    playSequence: playSequence,
    stopPlayback: stopPlayback,
    stopAll: stopAll,
    isPlaying: isPlaying,
    isLooping: isLooping,
    beatsToSeconds: beatsToSeconds,
    getContext: getContext,
    getPlayhead: getPlayhead,
    playPulse: playPulse,
  };
})(typeof window !== 'undefined' ? window : globalThis);
