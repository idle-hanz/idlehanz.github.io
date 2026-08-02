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
  let reverbSend = null;
  let activeNodes = [];
  let playTimer = null;
  let pulseTimers = [];
  let uiTimers = [];
  let playing = false;
  let loopMode = false;
  /** { bpm, steps:[{i,start,end,beats,sec}], t0, len } */
  let transport = null;

  function ensure() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);

      reverbSend = ctx.createGain();
      reverbSend.gain.value = 0.22;
      const delay = ctx.createDelay(1.0);
      delay.delayTime.value = 0.18;
      const fb = ctx.createGain();
      fb.gain.value = 0.28;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2200;
      reverbSend.connect(delay);
      delay.connect(lp);
      lp.connect(fb);
      fb.connect(delay);
      lp.connect(master);
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

  function playPulse(isDownbeat) {
    const c = ensure();
    const now = c.currentTime;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = isDownbeat ? 880 : 660;
    const peak = isDownbeat ? 0.07 : 0.035;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(peak, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    osc.connect(g);
    g.connect(master);
    osc.start(now);
    osc.stop(now + 0.08);
  }

  /** Whole-beat metronome clicks for a step, locked to audio start time. */
  function schedulePulses(beats, bpm, startWhen) {
    const c = ensure();
    const beatSec = 60 / (bpm || 120);
    const n = Math.max(0, Math.floor(Number(beats) + 1e-9));
    for (let b = 0; b < n; b++) {
      const tAudio = startWhen + b * beatSec;
      const delayMs = Math.max(0, (tAudio - c.currentTime) * 1000);
      const down = b % 4 === 0;
      pulseTimers.push(
        setTimeout(() => {
          if (playing) playPulse(down);
        }, delayMs)
      );
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
   * Play a chord.
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

    if (!opts.layer) stopAll(opts.soft ? 0.03 : 0.05);

    const now = opts.when != null ? opts.when : c.currentTime;
    const soft = !!opts.soft;
    const dur = opts.duration != null ? opts.duration : soft ? 0.55 : 1.35;
    const peak = soft ? 0.09 : 0.16;
    const attack = soft ? 0.04 : 0.02;
    const release = soft ? 0.35 : 0.4;

    const voicing = midi.slice();
    const bassNote = Math.min.apply(null, voicing);
    voicing.forEach((m, i) => {
      ['triangle', 'sine'].forEach((type) => {
        const osc = c.createOscillator();
        const gain = c.createGain();
        const filter = c.createBiquadFilter();
        filter.type = 'lowpass';
        const isBass = m === bassNote;
        filter.frequency.value = soft ? (isBass ? 900 : 2200) : isBass ? 1400 : 4200;
        filter.Q.value = 0.55;

        osc.type = type;
        osc.frequency.value = midiToFreq(m);

        const level =
          peak *
          (type === 'sine' ? (isBass ? 0.7 : 0.4) : isBass ? 0.75 : 0.95) *
          (1 - i * 0.03) *
          (isBass ? 1.05 : 1.1);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(level, now + attack);
        const sustainEnd = Math.max(now + attack + 0.02, now + dur - release);
        gain.gain.setValueAtTime(level * 0.85, sustainEnd);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(master);
        gain.connect(reverbSend);

        osc.start(now);
        osc.stop(now + dur + 0.05);
        activeNodes.push({ osc: osc, gain: gain });
      });
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
