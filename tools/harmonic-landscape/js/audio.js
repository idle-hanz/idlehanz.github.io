/**
 * Harmonic Landscape — Web Audio chord engine
 * Soft preview, commit, timed playback, looping with pulse.
 */
(function (global) {
  'use strict';

  let ctx = null;
  let master = null;
  let reverbSend = null;
  let pulseGain = null;
  let activeNodes = [];
  let playTimer = null;
  let pulseTimers = [];
  let playing = false;
  let loopMode = false;

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

      pulseGain = ctx.createGain();
      pulseGain.gain.value = 0.0;
      pulseGain.connect(master);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function midiToFreq(m) {
    return 440 * Math.pow(2, (m - 69) / 12);
  }

  function stopAll(fade = 0.04) {
    const c = ctx;
    if (!c) return;
    const now = c.currentTime;
    activeNodes.forEach(({ osc, gain }) => {
      try {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now);
        gain.gain.linearRampToValueAtTime(0.0001, now + fade);
        osc.stop(now + fade + 0.02);
      } catch (_) { /* already stopped */ }
    });
    activeNodes = [];
  }

  function clearPulseTimers() {
    pulseTimers.forEach((t) => clearTimeout(t));
    pulseTimers = [];
  }

  /** Soft metronome click (downbeat stronger) */
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

  function schedulePulses(beats, bpm, startDelayMs) {
    clearPulseTimers();
    const beatMs = (60 / (bpm || 120)) * 1000;
    for (let b = 0; b < beats; b++) {
      const t = setTimeout(() => {
        if (playing) playPulse(b % 4 === 0);
      }, (startDelayMs || 0) + b * beatMs);
      pulseTimers.push(t);
    }
  }

  /**
   * Play a chord from MIDI notes or HLMusic chord + voice lead.
   */
  function playChord(opts = {}) {
    const c = ensure();
    const M = global.HLMusic;
    let midi = opts.midi;
    if (!midi && opts.chord && M) {
      midi = M.voiceLead(opts.chord, opts.prevMidi || null, 3);
    }
    if (!midi || !midi.length) return null;

    if (!opts.layer) stopAll(opts.soft ? 0.03 : 0.05);

    const now = c.currentTime;
    const soft = !!opts.soft;
    const dur = opts.duration != null ? opts.duration : soft ? 0.55 : 1.35;
    const peak = soft ? 0.09 : 0.16;
    const attack = soft ? 0.04 : 0.02;
    const release = soft ? 0.35 : 0.45;

    const voicing = midi.slice();
    voicing.forEach((m, i) => {
      ['triangle', 'sine'].forEach((type) => {
        const osc = c.createOscillator();
        const gain = c.createGain();
        const filter = c.createBiquadFilter();
        filter.type = 'lowpass';
        // Brighter for upper voices so open voicings read clearly
        const isBass = m === Math.min(...voicing);
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
        gain.gain.setValueAtTime(level * 0.85, now + Math.max(attack, dur - release));
        gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(master);
        gain.connect(reverbSend);

        osc.start(now);
        osc.stop(now + dur + 0.05);
        activeNodes.push({ osc, gain });
      });
    });

    return voicing;
  }

  function beatsToSeconds(beats, bpm) {
    return (beats * 60) / (bpm || 120);
  }

  /**
   * Play a sequence of chords with durations (in beats).
   * opts: { loop, pulse, onStep, onEnd, onLoop }
   */
  function playSequence(chords, bpm = 120, onStep, onEnd, opts) {
    if (typeof onStep === 'object' && onStep !== null && !onEnd) {
      opts = onStep;
      onStep = opts.onStep;
      onEnd = opts.onEnd;
    }
    opts = opts || {};
    stopPlayback();
    ensure();
    if (!chords || !chords.length) {
      if (onEnd) onEnd();
      return;
    }

    playing = true;
    loopMode = !!opts.loop;
    const usePulse = opts.pulse !== false && (opts.loop || opts.pulse);
    let prevMidi = null;
    let i = 0;

    function step() {
      if (!playing) return;
      if (i >= chords.length) {
        if (loopMode) {
          i = 0;
          prevMidi = null;
          if (opts.onLoop) opts.onLoop();
        } else {
          playing = false;
          clearPulseTimers();
          if (onEnd) onEnd();
          return;
        }
      }
      const ch = chords[i];
      const sec = beatsToSeconds(ch.duration || 4, bpm);
      if (usePulse) schedulePulses(ch.duration || 4, bpm, 0);
      prevMidi = playChord({
        chord: ch,
        prevMidi,
        soft: false,
        duration: Math.max(0.25, sec * 0.92),
      });
      if (onStep) onStep(i, ch);
      i += 1;
      playTimer = setTimeout(step, sec * 1000);
    }
    step();
  }

  function stopPlayback() {
    playing = false;
    loopMode = false;
    if (playTimer) {
      clearTimeout(playTimer);
      playTimer = null;
    }
    clearPulseTimers();
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

  global.HLAudio = {
    ensure,
    playChord,
    playSequence,
    stopPlayback,
    stopAll,
    isPlaying,
    isLooping,
    beatsToSeconds,
    getContext,
    playPulse,
  };
})(typeof window !== 'undefined' ? window : globalThis);
