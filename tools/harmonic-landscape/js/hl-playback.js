/**
 * hl-playback.js - play, playhead, export (attaches to HLApp)
 */
(function (global) {
  "use strict";
  var H = global.HLApp;
  if (!H) throw new Error("HLApp missing - load hl-core.js first");
H.stopPlayheadLoop = function () {
    if (H.playheadRaf) {
      cancelAnimationFrame(H.playheadRaf);
      H.playheadRaf = 0;
    }
    // Clear progress fills
    document.querySelectorAll('.ts-step .ts-playhead').forEach((el) => {
      el.style.width = '0%';
    });
  }

  /** Drive time-strip fill from AudioContext clock (BPM-accurate). */
  H.startPlayheadLoop = function (fromIndex) {
    H.stopPlayheadLoop();
    fromIndex = fromIndex || 0;
    const tick = () => {
      if (!H.A().isPlaying()) {
        H.stopPlayheadLoop();
        return;
      }
      const ph = H.A().getPlayhead && H.A().getPlayhead();
      if (ph) {
        const absIdx = fromIndex + ph.stepIndex;
        document.querySelectorAll('.ts-step').forEach((el) => {
          const i = parseInt(el.dataset.i, 10);
          const fill = el.querySelector('.ts-playhead');
          if (!fill) return;
          if (i === absIdx) {
            fill.style.width = Math.round(ph.stepProgress * 1000) / 10 + '%';
          } else if (i < absIdx) {
            fill.style.width = '100%';
          } else {
            fill.style.width = '0%';
          }
        });
      }
      H.playheadRaf = requestAnimationFrame(tick);
    };
    H.playheadRaf = requestAnimationFrame(tick);
  }

  /** Preview / one-shot duration in seconds for a chord at current BPM. */
  H.chordAudioSeconds = function (ch, opts) {
    opts = opts || {};
    const beats = ch && ch.duration != null ? ch.duration : H.stepDuration();
    const sec = H.A().beatsToSeconds(beats, H.state.bpm);
    // Soft previews stay short; full hits use almost the whole step
    if (opts.soft) return Math.min(0.55, Math.max(0.2, sec * 0.45));
    return Math.max(0.15, sec * 0.97);
  }

  H.stopPlaybackUI = function () {
    H.stopPlayheadLoop();
    if (H.A().stopPlayback) H.A().stopPlayback();
    if (H.map) H.map.setPlaying(-1);
    H.updatePlayBtn();
    H.renderSlots();
    H.renderTimeStrip();
  }

  /**
   * Map absolute beats-elapsed onto { stepIndex, beatsIntoStep } for a chord list.
   * Wraps when beatsElapsed ≥ total (loop place).
   */
  H.beatsToStepOffset = function (chords, beatsElapsed) {
    const list = chords || [];
    if (!list.length) return { stepIndex: 0, beatsIntoStep: 0 };
    let rem = Math.max(0, Number(beatsElapsed) || 0);
    const total = H.beatSum(list);
    if (total > 0 && rem >= total) rem = rem % total;
    for (let i = 0; i < list.length; i++) {
      const b = list[i].duration != null ? Number(list[i].duration) : 4;
      if (rem < b - 0.001) {
        return { stepIndex: i, beatsIntoStep: rem };
      }
      rem -= b;
    }
    const last = list.length - 1;
    const lb = list[last].duration != null ? Number(list[last].duration) : 4;
    return { stepIndex: last, beatsIntoStep: Math.max(0, lb - 0.05) };
  };

  /**
   * While audio is running, rebuild the schedule from current H.state.chords
   * and continue from the same loop place (beats elapsed).
   * Call after duration / length edits so the loop doesn't keep the old timeline.
   */
  H.resyncPlaybackPreservingPlace = function (opts) {
    opts = opts || {};
    if (!H.A().isPlaying || !H.A().isPlaying()) return false;
    // Don't fight an in-progress strip drag — pointerup will resync once
    const strip = H.$('#time-strip');
    if (strip && strip.dataset.resizing === '1') return false;
    const ph = H.A().getPlayhead && H.A().getPlayhead();
    if (!ph) return false;
    const meta = H._transportMeta || { fromIndex: 0, loop: !!H.state.loop };
    // Custom one-shot sequences (A/B, aim audition) — leave alone unless forced
    if (meta.external && !opts.forceExternal) return false;
    const from = Math.max(0, meta.fromIndex || 0);
    // Prefer explicit loop override (checkbox mid-play), else transport meta, else state
    const loop =
      opts.loop != null
        ? !!opts.loop
        : meta.loop != null
          ? !!meta.loop
          : !!H.state.loop;
    if (!H.state.chords.length) {
      H.stopPlaybackUI();
      return false;
    }
    // Structural edits always play full path from 0 (fromIndex may be stale)
    const useFrom = opts.resetFrom ? 0 : from;
    const source = H.state.chords.slice(useFrom);
    if (!source.length) {
      H.stopPlaybackUI();
      return false;
    }
    let targetBeats = ph.beatsElapsed;
    // If we dropped a non-zero fromIndex, map absolute place into full timeline
    if (opts.resetFrom && from > 0) {
      let prefix = 0;
      for (let i = 0; i < from && i < H.state.chords.length; i++) {
        prefix += H.state.chords[i].duration != null ? H.state.chords[i].duration : 4;
      }
      targetBeats = prefix + ph.beatsElapsed;
    }
    const newTotal = H.beatSum(source);
    if (newTotal <= 0) return false;
    if (loop) {
      if (targetBeats >= newTotal) targetBeats = targetBeats % newTotal;
    } else {
      targetBeats = Math.min(targetBeats, Math.max(0, newTotal - 0.05));
    }
    const at = H.beatsToStepOffset(source, targetBeats);
    H.playSeq({
      force: true,
      fromIndex: useFrom,
      loop: loop,
      once: !loop,
      startAt: at,
      silent: true,
    });
    return true;
  };

  /**
   * Play sequence. opts: { once, fromIndex, chords, label, onEnd, startAt, silent, force, loop }
   * fromIndex — start at selected (or given) step of H.state.chords
   * startAt — { stepIndex, beatsIntoStep } relative to the slice (place-preserving resync)
   * Durations are in beats; audio engine locks them to H.state.bpm.
   */
  H.playSeq = function (opts) {
    opts = opts || {};
    H.A().ensure();
    if (H.A().isPlaying()) {
      if (!opts.force) {
        H.stopPlaybackUI();
        return;
      }
      H.stopPlayheadLoop();
      H.A().stopPlayback();
      if (H.map) H.map.setPlaying(-1);
    }
    const from = Math.max(0, opts.fromIndex != null ? opts.fromIndex : 0);
    const source = opts.chords || H.state.chords;
    if (!source.length) return;
    // Clone with explicit beat durations so nothing is lost
    const slice = source.slice(from).map((c) => {
      const x = H.M().cloneChord(c);
      x.duration = c.duration != null ? c.duration : 4;
      return x;
    });
    if (!slice.length) return;
    const once = opts.once != null ? opts.once : !H.state.loop;
    const loop = opts.loop != null ? opts.loop : once ? false : H.state.loop;
    const bpm = Math.max(40, Math.min(200, H.state.bpm || 96));

    H._transportMeta = {
      fromIndex: from,
      loop: loop,
      external: !!opts.chords,
    };

    H.A().playSequence(slice, bpm, {
      loop,
      pulse: H.state.pulse,
      startAt: opts.startAt || null,
      onStep: (i) => {
        const idx = from + i;
        H._playingIndex = idx;
        if (H.map) H.map.setPlaying(opts.chords ? -1 : idx);
        if (!opts.chords) {
          // Optional follow: default off so duration/inspector stay on the step you picked
          if (H.state.followPlayhead) {
            H.state.selected = Math.min(idx, H.state.chords.length - 1);
            H.renderSlots();
            H.renderInspector && H.renderInspector();
          } else {
            // Light playing highlight only — leave selected alone
            const slots = H.$('#slots');
            if (slots) {
              slots.querySelectorAll('.slot').forEach((el) => {
                const ei = parseInt(el.dataset.index, 10);
                el.classList.toggle('playing', ei === idx);
              });
            }
          }
          const host = H.$('#time-strip');
          if (host && host.dataset.resizing !== '1') {
            host.querySelectorAll('.ts-step').forEach((el) => {
              const ei = parseInt(el.dataset.i, 10);
              el.classList.toggle('selected', ei === H.state.selected);
              el.classList.toggle('playing', ei === idx);
            });
          }
          H.updateMapStatus();
          if (H.renderPlaceReadout) H.renderPlaceReadout();
        }
      },
      onEnd: () => {
        H._playingIndex = -1;
        H.stopPlayheadLoop();
        if (H.map) H.map.setPlaying(-1);
        H.renderTimeStrip();
        H.renderSlots();
        H.updatePlayBtn();
        if (H.renderPlaceReadout) H.renderPlaceReadout();
        if (opts.onEnd) opts.onEnd();
      },
    });
    if (!opts.chords) H.startPlayheadLoop(from);
    H.updatePlayBtn();
    if (opts.silent) return;
    const totalBeats = slice.reduce((s, c) => s + (c.duration || 4), 0);
    const totalSec = H.A().beatsToSeconds(totalBeats, bpm);
    if (opts.label) H.setSyncStatus(opts.label);
    else if (from > 0) {
      H.setSyncStatus(
        'Playing from step ' +
          (from + 1) +
          ' · ' +
          bpm +
          ' BPM · ' +
          totalBeats +
          ' beats (~' +
          totalSec.toFixed(1) +
          's)'
      );
    } else {
      H.setSyncStatus(
        'Playing · ' + bpm + ' BPM · ' + totalBeats + ' beats (~' + totalSec.toFixed(1) + 's)'
      );
    }
  }

  H.playFromSelection = function () {
    if (!H.state.chords.length) return;
    const from = Math.max(0, H.state.selected >= 0 ? H.state.selected : 0);
    H.playSeq({ fromIndex: from, once: !H.state.loop, force: true, label: 'From step ' + (from + 1) });
  }

  /** A then B: current cell, then comparison version. */
  H.playAB = function () {
    if (!H.state.chords.length) return;
    H.A().ensure();
    if (H.A().isPlaying()) H.stopPlaybackUI();
    const song = H.S() && H.S().loadSong();
    const other = song ? H.resolveCompareCell(song) : null;
    const nameA = H.state.title || 'A';
    const nameB = other ? other.name || 'B' : null;
    H.setSyncStatus('A/B · A: ' + nameA);
    H.playSeq({
      once: true,
      loop: false,
      force: true,
      label: 'A · ' + nameA,
      onEnd: () => {
        if (!other || !other.chords || !other.chords.length) {
          H.setSyncStatus('A/B · no comparison version (Alt-click a version chip)');
          return;
        }
        const bChords = other.chords.map((sc) => H.sessionChordToLandscape(sc));
        setTimeout(() => {
          H.playSeq({
            chords: bChords,
            once: true,
            loop: false,
            force: true,
            label: 'B · ' + nameB + ' (blue path)',
          });
        }, 280);
      },
    });
  }

  H.updatePlayBtn = function () {
    const playing = H.A().isPlaying();
    const b = H.$('#btn-play');
    if (b) {
      b.textContent = playing ? 'Stop' : H.state.loop ? 'Play ↻' : 'Play';
      b.classList.toggle('on', playing);
    }
    const bf = H.$('#btn-play-from');
    if (bf) bf.classList.toggle('on', false);
  }

  /** Audition join: chord before write → new package → what follows. */
  H.auditionJoin = function (beforeChord, pieces, afterChord) {
    const seq = [];
    if (beforeChord) seq.push(H.M().cloneChord(beforeChord));
    (pieces || []).forEach((p) => {
      const x = H.M().cloneChord(p);
      x.duration = Math.min(2, x.duration || 2);
      seq.push(x);
    });
    if (afterChord) seq.push(H.M().cloneChord(afterChord));
    if (seq.length < 2) {
      if (seq[0]) H.A().playChord({ chord: seq[0] });
      return;
    }
    seq.forEach((c) => {
      c.duration = Math.min(1.6, c.duration || 1.6);
    });
    H.A().ensure();
    if (H.A().stopPlayback) H.A().stopPlayback();
    H.A().playSequence(seq, Math.max(H.state.bpm, 100), { pulse: false, loop: false });
  }

  H.exportText = function () {
    const lines = [
      `# ${H.state.title}`,
      `Key: ${H.keyLabel()} · ${H.state.bpm} BPM`,
      H.state.recognition
        ? `Canonical: ${H.state.recognition.pack.name} (${H.state.recognition.match})`
        : 'Canonical: —',
      '',
      H.M().formatChordList(H.state.chords, H.state.bpm),
    ];
    if (H.state.recognition && H.state.recognition.pack.why) {
      lines.push('', 'Feel: ' + H.state.recognition.pack.why);
    }
    const text = lines.join('\n');
    H.$('#export-out').value = text;
    H.dl(new Blob([text], { type: 'text/plain' }), H.slug(H.state.title) + '.txt');
  }

  H.exportMidi = function () {
    if (!H.state.chords.length) return;
    H.dl(new Blob([H.buildMidi(H.state.chords, H.state.bpm)], { type: 'audio/midi' }), H.slug(H.state.title) + '.mid');
  }

  H.dl = function (blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }

  H.slug = function (s) {
    return String(s || 'seq')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  H.buildMidi = function (chords, bpm) {
    const tpq = 480;
    const micro = Math.round(60000000 / bpm);
    const events = [
      { tick: 0, data: [0xff, 0x51, 0x03, (micro >> 16) & 0xff, (micro >> 8) & 0xff, micro & 0xff] },
    ];
    let tick = 0;
    let prev = null;
    chords.forEach((ch) => {
      const midi = H.M().voiceLead(ch, prev, 3);
      prev = midi;
      const dur = Math.max(1, Math.round((ch.duration || 4) * tpq));
      midi.forEach((n, i) => events.push({ tick, data: [0x90, n, i === 0 ? 95 : 72] }));
      midi.forEach((n) => events.push({ tick: tick + dur, data: [0x80, n, 0] }));
      tick += dur;
    });
    events.push({ tick, data: [0xff, 0x2f, 0x00] });
    events.sort((a, b) => a.tick - b.tick);
    const track = [];
    let last = 0;
    events.forEach((ev) => {
      let v = ev.tick - last;
      last = ev.tick;
      let buf = v & 0x7f;
      while ((v >>= 7)) {
        buf <<= 8;
        buf |= (v & 0x7f) | 0x80;
      }
      for (;;) {
        track.push(buf & 0xff);
        if (buf & 0x80) buf >>= 8;
        else break;
      }
      ev.data.forEach((b) => track.push(b));
    });
    const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (tpq >> 8) & 0xff, tpq & 0xff];
    const th = [
      0x4d, 0x54, 0x72, 0x6b,
      (track.length >> 24) & 0xff, (track.length >> 16) & 0xff, (track.length >> 8) & 0xff, track.length & 0xff,
    ];
    return new Uint8Array([...header, ...th, ...track]);
  }

  // ─── Render ──────────────────────────────────────────────
})(typeof window !== "undefined" ? window : globalThis);
