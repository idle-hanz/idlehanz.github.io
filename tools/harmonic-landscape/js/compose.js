/**
 * Harmonic Landscape — writing partner
 * Goals, next-chord intelligence, bass/inversions, tension, critique,
 * variations, taste memory, exotic-soup guardrails.
 */
(function (global) {
  'use strict';

  const M = () => global.HLMusic;
  if (!global.HLMusic) {
    console.error('compose.js requires music.js first');
    return;
  }

  const GOALS = {
    balanced: {
      id: 'balanced',
      name: 'Balanced journey',
      hint: 'Leave home, colour, return with intent',
      prefer: { diatonic: 0.2, secondary: 0.15, interchange: 0.2, chromatic: 0.05, tritone: 0.05, parallel: 0.1 },
      wantTension: 0.55,
      wantReturn: 0.4,
    },
    stay_close: {
      id: 'stay_close',
      name: 'Stay close',
      hint: 'Mostly diatonic, smooth motion',
      prefer: { diatonic: 0.55, secondary: 0.1, interchange: 0.05, chromatic: -0.3, tritone: -0.25, parallel: 0.05 },
      wantTension: 0.35,
      wantReturn: 0.3,
    },
    get_darker: {
      id: 'get_darker',
      name: 'Get darker',
      hint: 'Minor colour, interchange, shadows',
      prefer: { diatonic: 0.1, secondary: 0.15, interchange: 0.35, chromatic: 0.15, tritone: 0.2, parallel: 0.15 },
      wantTension: 0.7,
      wantReturn: 0.25,
    },
    delay_home: {
      id: 'delay_home',
      name: 'Delay home',
      hint: 'Avoid tonic; stretch the longing',
      prefer: { diatonic: 0.15, secondary: 0.25, interchange: 0.2, chromatic: 0.1, tritone: 0.15, parallel: 0.1 },
      wantTension: 0.65,
      wantReturn: -0.5,
    },
    epic_lift: {
      id: 'epic_lift',
      name: 'Epic lift',
      hint: 'Brighter or larger harmonic gestures',
      prefer: { diatonic: 0.15, secondary: 0.2, interchange: 0.1, chromatic: 0.25, tritone: 0.05, parallel: 0.25 },
      wantTension: 0.6,
      wantReturn: 0.2,
    },
    float: {
      id: 'float',
      name: 'Float unresolved',
      hint: 'Avoid hard cadences; soft colours',
      prefer: { diatonic: 0.2, secondary: -0.1, interchange: 0.25, chromatic: 0.2, tritone: -0.15, parallel: 0.15 },
      wantTension: 0.45,
      wantReturn: -0.35,
    },
    hard_return: {
      id: 'hard_return',
      name: 'Hard return',
      hint: 'Set up a strong cadence home',
      prefer: { diatonic: 0.15, secondary: 0.35, interchange: 0.05, chromatic: 0.0, tritone: 0.2, parallel: 0.05 },
      wantTension: 0.75,
      wantReturn: 0.7,
    },
  };

  const JOB_LABELS = {
    push: 'Push / tension',
    float: 'Float',
    darken: 'Darken',
    brighten: 'Brighten',
    cadence: 'Cadence home',
    colour: 'Colour',
    continue: 'Continue',
    surprise: 'Surprise',
    land: 'Land soft',
  };

  // ─── Bass / inversions ───────────────────────────────────

  function chordTones(chord) {
    return (chord.notes || []).map((n) => ((n % 12) + 12) % 12);
  }

  function formatChordName(chord) {
    const music = M();
    const bass = chord.bassPc != null ? ((chord.bassPc % 12) + 12) % 12 : chord.root;
    // Preserve free pitch-set labels (e.g. B·C·D·F#)
    if (chord.custom || chord.quality === 'custom') {
      let name =
        chord.name && String(chord.name).indexOf('·') >= 0
          ? chord.name.split('/')[0]
          : (chord.notes || [])
              .map((n) => music.noteName(((n % 12) + 12) % 12))
              .join('·') || 'Custom ' + music.noteName(chord.root);
      if (bass !== chord.root) name += '/' + music.noteName(bass);
      return name;
    }
    const q = music.QUALITIES[chord.quality] || music.QUALITIES.maj;
    let name = music.noteName(chord.root) + (q.symbol || q.label || '');
    if (bass !== chord.root) name += '/' + music.noteName(bass);
    return name;
  }

  function withBass(chord, bassPc) {
    const b = ((bassPc % 12) + 12) % 12;
    const tones = chordTones(chord);
    let inversion = 0;
    const idx = tones.indexOf(b);
    if (idx >= 0) inversion = idx;
    const next = {
      ...chord,
      notes: tones.slice(),
      intervals: (chord.intervals || []).slice(),
      bassPc: b,
      inversion,
    };
    next.name = formatChordName(next);
    return next;
  }

  function withInversion(chord, inv) {
    const tones = chordTones(chord);
    if (!tones.length) return chord;
    const i = ((inv % tones.length) + tones.length) % tones.length;
    return withBass(chord, tones[i]);
  }

  function effectiveBass(chord) {
    if (chord.bassPc != null) return ((chord.bassPc % 12) + 12) % 12;
    return chord.root;
  }

  function bassInterval(fromChord, toChord) {
    const a = effectiveBass(fromChord);
    const b = effectiveBass(toChord);
    return Math.min(Math.abs(a - b), 12 - Math.abs(a - b));
  }

  function bassMotionLabel(semis) {
    if (semis === 0) return 'pedal';
    if (semis === 1 || semis === 2) return 'step';
    if (semis === 3 || semis === 4) return '3rd';
    if (semis === 5) return '4th/5th';
    if (semis === 6) return 'tritone';
    return 'leap';
  }

  /** 0–1 quality: stepwise and fifths good; leaps mixed; pedal ok */
  function bassMotionScore(fromChord, toChord) {
    const d = bassInterval(fromChord, toChord);
    if (d === 0) return 0.7;
    if (d === 1 || d === 2) return 1.0;
    if (d === 5) return 0.95;
    if (d === 3 || d === 4) return 0.75;
    if (d === 6) return 0.45;
    return 0.35;
  }

  /**
   * Best inversion of candidate relative to previous chord (smooth bass + VL).
   */
  function bestInversion(prevChord, candidate) {
    const tones = chordTones(candidate);
    if (!tones.length) return candidate;
    let best = withBass(candidate, candidate.root);
    let bestScore = -Infinity;
    // Root + each chord-tone bass
    const basses = [candidate.root, ...tones];
    const seen = new Set();
    basses.forEach((b) => {
      if (seen.has(b)) return;
      seen.add(b);
      const c = withBass(candidate, b);
      let score = 0;
      if (prevChord) {
        score += bassMotionScore(prevChord, c) * 1.2;
        score += M().voiceLeadingQuality(prevChord, c);
      } else {
        score += b === candidate.root ? 0.5 : 0.2;
      }
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    });
    return best;
  }

  function smoothCellVoicings(chords) {
    if (!chords.length) return [];
    const out = [];
    for (let i = 0; i < chords.length; i++) {
      const prev = i ? out[i - 1] : null;
      const src = chords[i];
      const smoothed = bestInversion(prev, src);
      out.push({
        ...smoothed,
        duration: src.duration,
        id: src.id,
        roman: src.roman,
        tag: src.tag,
        region: src.region,
        // Multi-disk: keep each step on its Chase disk
        localTonic: src.localTonic != null ? src.localTonic : smoothed.localTonic,
        localMode: src.localMode || smoothed.localMode,
        custom: src.custom || smoothed.custom,
      });
    }
    return out;
  }

  // ─── Tension ─────────────────────────────────────────────

  function chordTension(chord, tonic, modeKey) {
    const music = M();
    const t = music.pc(tonic);
    const dist = music.harmonicDistance(chord, tonic, modeKey);
    let ten = Math.min(1, dist / 3.2);

    const regionBoost = {
      diatonic: 0,
      secondary: 0.25,
      interchange: 0.2,
      chromatic: 0.3,
      tritone: 0.4,
      parallel: 0.15,
    };
    ten += regionBoost[chord.region] || 0.1;

    if (chord.quality === 'dom7') ten += 0.2;
    if (chord.quality === 'dim' || chord.quality === 'dim7' || chord.quality === 'halfdim') ten += 0.25;
    if (chord.quality === 'aug') ten += 0.2;

    // Tonic low
    const isTonic =
      chord.root === t &&
      ['min', 'maj', 'min7', 'maj7', 'minmaj7', 'min9', 'maj9'].includes(chord.quality);
    if (isTonic) ten = Math.min(ten, 0.12);

    // Dominant high
    if (chord.root === (t + 7) % 12 && (chord.quality === 'dom7' || chord.quality === 'maj')) {
      ten = Math.max(ten, 0.75);
    }

    return Math.max(0, Math.min(1, ten));
  }

  function tensionCurve(chords, tonic, modeKey) {
    return chords.map((c) => chordTension(c, tonic, modeKey));
  }

  // ─── Job / function of a move ────────────────────────────

  function describeJob(from, to, tonic, modeKey) {
    const music = M();
    const t = music.pc(tonic);
    const isTonic =
      to.root === t &&
      ['min', 'maj', 'min7', 'maj7', 'minmaj7'].includes(to.quality);
    if (isTonic) return 'cadence';

    if (to.region === 'tritone' || to.quality === 'dom7') return 'push';
    if (to.region === 'secondary') return 'push';
    if (to.region === 'chromatic') return 'surprise';
    if (to.region === 'interchange' || to.region === 'parallel') {
      const homeMinor = (music.MODES[modeKey] || music.MODES.minor).romanBase === 'minor';
      const darker = to.quality.includes('min') || to.quality.includes('dim');
      if (homeMinor && !darker) return 'brighten';
      if (!homeMinor && darker) return 'darken';
      return 'colour';
    }
    if (to.region === 'diatonic') {
      if (to.root === (t + 7) % 12) return 'push';
      if (to.root === (t + 5) % 12) return 'land';
      return 'continue';
    }
    return 'colour';
  }

  // ─── Next-chord suggestions ──────────────────────────────

  function suggestNext(opts) {
    const music = M();
    const {
      fromChord,
      tonic,
      modeKey,
      goalId = 'balanced',
      sevenths = true,
      count = 6,
      taste = null,
      path = [],
    } = opts;

    const goal = GOALS[goalId] || GOALS.balanced;
    const t = music.pc(tonic);
    const candidates = music.allPaletteChords(tonic, modeKey, sevenths);

    // Enrich with useful inversions of diatonic as separate candidates later via bestInversion
    const recentKeys = new Set(
      (path || []).slice(-3).map((c) => c.root + ':' + c.quality)
    );

    const exoticStreak = countExoticStreak(path || []);

    const scored = candidates.map((raw) => {
      let ch = raw;
      if (fromChord) ch = bestInversion(fromChord, raw);
      else ch = withBass(raw, raw.root);

      const key = raw.root + ':' + raw.quality;
      const region = raw.region || 'diatonic';
      const vl = fromChord ? music.voiceLeadingQuality(fromChord, ch) : 0.7;
      const bass = fromChord ? bassMotionScore(fromChord, ch) : 0.7;
      const bassSemis = fromChord ? bassInterval(fromChord, ch) : 0;
      const ten = chordTension(ch, tonic, modeKey);
      const job = describeJob(fromChord, ch, tonic, modeKey);
      const dist = music.harmonicDistance(ch, tonic, modeKey);

      let score = 0;
      score += vl * 1.4;
      score += bass * 1.1;
      score += (goal.prefer[region] || 0) * 1.5;

      // Goal tension preference
      score -= Math.abs(ten - goal.wantTension) * 0.8;

      // Return preference
      const isHome =
        ch.root === t &&
        ['min', 'maj', 'min7', 'maj7', 'minmaj7'].includes(ch.quality);
      if (isHome) score += goal.wantReturn * 1.2;
      else if (goal.wantReturn < 0) score += 0.15; // delay home rewards non-home

      // Hard return: boost V and tritone into home setup
      if (goalId === 'hard_return') {
        if (ch.quality === 'dom7' && (ch.root === (t + 7) % 12 || region === 'tritone')) score += 0.55;
        if (job === 'push') score += 0.25;
      }
      if (goalId === 'get_darker' && (region === 'interchange' || region === 'tritone')) score += 0.2;
      if (goalId === 'epic_lift' && (region === 'chromatic' || region === 'parallel')) score += 0.2;
      if (goalId === 'stay_close' && region === 'diatonic') score += 0.25;
      if (goalId === 'float' && (ch.quality === 'dom7' || isHome)) score -= 0.35;

      if (opts.styleBoost && ch.roman && opts.styleBoost[ch.roman]) {
        score += opts.styleBoost[ch.roman];
      }

      // Avoid immediate repeat of same chord
      if (fromChord && fromChord.root === ch.root && fromChord.quality === ch.quality) score -= 1.2;
      if (recentKeys.has(key)) score -= 0.25;

      // Exotic soup guardrail
      if (exoticStreak >= 2 && region !== 'diatonic' && !isHome) score -= 0.55;
      if (exoticStreak >= 3 && region !== 'diatonic') score -= 0.9;

      // Taste memory
      if (taste) {
        const tk = tasteKey(ch);
        score += (taste.accepted[tk] || 0) * 0.15;
        score -= (taste.rejected[tk] || 0) * 0.35;
      }

      // Prefer common-tone connections slightly
      if (fromChord) {
        const common = chordTones(fromChord).filter((n) => chordTones(ch).includes(n)).length;
        score += common * 0.08;
      }

      return {
        chord: ch,
        score,
        vl,
        bass,
        bassLabel: bassMotionLabel(bassSemis),
        tension: ten,
        job,
        jobLabel: JOB_LABELS[job] || job,
        region,
        distance: dist,
      };
    });

    scored.sort((a, b) => b.score - a.score);

    // Diversify: take top but ensure job/region variety
    const picked = [];
    const usedJobs = new Set();
    const usedKeys = new Set();
    for (const s of scored) {
      const k = s.chord.root + ':' + s.chord.quality + ':' + effectiveBass(s.chord);
      if (usedKeys.has(s.chord.root + ':' + s.chord.quality)) continue;
      // Allow a bit of job repeat after we have 3
      if (picked.length < 4 && usedJobs.has(s.job) && s.job !== 'continue') continue;
      usedKeys.add(s.chord.root + ':' + s.chord.quality);
      usedJobs.add(s.job);
      picked.push(s);
      if (picked.length >= count) break;
    }
    // Fill if diversity left gaps
    for (const s of scored) {
      if (picked.length >= count) break;
      if (picked.some((p) => p.chord.root === s.chord.root && p.chord.quality === s.chord.quality)) continue;
      picked.push(s);
    }

    return picked;
  }

  /**
   * Direction packages of 1–2 chords from `fromChord`.
   * When the rest of the sequence (`tail`) continues after the write, packages
   * are scored so the *last* new chord still joins the remaining progression.
   * Two-chord packages are preferred when a single swap would leave a bad join.
   *
   * opts: { fromChord, tail, tonic, modeKey, goalId, count, path }
   * returns: [{ chords, chord, label, job, jobLabel, score, steps, joinsTo }]
   */
  function suggestDirectionPaths(opts) {
    const music = M();
    const {
      fromChord,
      tail = [],
      tonic,
      modeKey,
      goalId = 'balanced',
      count = 6,
      path = [],
      styleBoost = null,
    } = opts;

    const packages = [];
    const pushPkg = (chords, meta) => {
      if (!chords || !chords.length) return;
      const names = chords.map((c) => c.name || music.formatChordName?.(c) || '?');
      const label = names.join(' → ');
      const key = chords.map((c) => c.root + ':' + c.quality).join('>');
      if (packages.some((p) => p.key === key)) return;
      packages.push({
        key,
        chords: chords.map((c) => music.cloneChord(c)),
        chord: music.cloneChord(chords[0]),
        label,
        job: meta.job || 'continue',
        jobLabel: meta.jobLabel || meta.job || JOB_LABELS.continue || 'continue',
        score: meta.score || 0,
        steps: chords.length,
        joinsTo: meta.joinsTo || null,
      });
    };

    const vl = (a, b) => (a && b ? music.voiceLeadingQuality(a, b) : 0.65);
    // What remains after writing L steps (replace starting at tail[0])
    const remainingAfter = (L) => (tail.length > L ? tail[L] : null);

    // ── Single-step candidates ──
    const singles = suggestNext({
      fromChord,
      tonic,
      modeKey,
      goalId,
      styleBoost: styleBoost,
      count: 8,
      path,
    });

    singles.forEach((s) => {
      const B = s.chord;
      const join = remainingAfter(1);
      const joinScore = join ? vl(B, join) : 0.7;
      // Soft-penalize bad joins — still offer if composing at end
      let score = s.score + joinScore * 0.9;
      if (join && joinScore < 0.35) score -= 0.55;
      if (join && joinScore >= 0.55) score += 0.2;

      pushPkg([B], {
        job: s.job,
        jobLabel: join
          ? (s.jobLabel || s.job) + (joinScore < 0.4 ? ' · weak into ' + join.name : ' · into ' + join.name)
          : s.jobLabel || s.job,
        score,
        joinsTo: join,
      });

      // ── Two-step extension: B → C, scored into remainingAfter(2) ──
      const seconds = suggestNext({
        fromChord: B,
        tonic,
        modeKey,
        goalId,
        count: 5,
        path: (path || []).concat([B]),
      });
      seconds.slice(0, 4).forEach((s2) => {
        const C = s2.chord;
        // Skip trivial repeats
        if (C.root === B.root && C.quality === B.quality) return;
        const join2 = remainingAfter(2);
        const mid = vl(B, C);
        const end = join2 ? vl(C, join2) : 0.68;
        let sc = s.score * 0.55 + s2.score * 0.55 + mid * 0.7 + end * 1.0;
        // Prefer two steps when one step had a weak join into old next
        if (join && joinScore < 0.4) sc += 0.45;
        // Classic setup→push / push→land feel
        if (s.job === 'continue' && s2.job === 'push') sc += 0.2;
        if (s.job === 'push' && (s2.job === 'land' || s2.job === 'cadence')) sc += 0.25;
        if (s.job === 'colour' && (s2.job === 'push' || s2.job === 'land')) sc += 0.15;
        if (join2 && end < 0.35) sc -= 0.5;
        if (join2 && end >= 0.55) sc += 0.25;

        const jobLabel = (s.jobLabel || s.job) + ' → ' + (s2.jobLabel || s2.job);
        pushPkg([B, C], {
          job: s2.job,
          jobLabel: join2
            ? jobLabel + ' · into ' + join2.name
            : jobLabel + (tail.length === 1 ? ' · rewrites next 2' : ''),
          score: sc,
          joinsTo: join2,
        });
      });
    });

    // ── Seeded 2-chord gestures (always useful vocabulary) ──
    const t = music.pc(tonic);
    const isMin = (music.MODES[modeKey] || music.MODES.minor).romanBase === 'minor';
    const gestureSeeds = [
      {
        a: music.makeChord((t + 2) % 12, isMin ? 'halfdim' : 'min7', { region: 'diatonic', tag: 'ii' }),
        b: music.makeChord((t + 7) % 12, 'dom7', { region: 'diatonic', tag: 'V7' }),
        job: 'push',
        jobLabel: 'ii → V setup',
      },
      {
        a: music.makeChord((t + 5) % 12, isMin ? 'min' : 'maj', { region: 'diatonic', tag: 'IV/iv' }),
        b: music.makeChord((t + 7) % 12, 'dom7', { region: 'diatonic', tag: 'V7' }),
        job: 'push',
        jobLabel: 'IV → V',
      },
      {
        a: music.makeChord((t + 8) % 12, 'maj', { region: 'interchange', tag: '♭VI' }),
        b: music.makeChord((t + 10) % 12, 'maj', { region: 'interchange', tag: '♭VII' }),
        job: 'colour',
        jobLabel: '♭VI → ♭VII epic',
      },
      {
        a: music.makeChord((t + 7) % 12, 'dom7', { region: 'diatonic', tag: 'V7' }),
        b: music.makeChord(t, isMin ? 'min' : 'maj', { region: 'diatonic', tag: 'home' }),
        job: 'cadence',
        jobLabel: 'V → home',
      },
      {
        a: music.makeChord((t + 1) % 12, 'dom7', { region: 'tritone', tag: '♭II7' }),
        b: music.makeChord(t, isMin ? 'min' : 'maj', { region: 'diatonic', tag: 'home' }),
        job: 'cadence',
        jobLabel: 'noir → home',
      },
    ];

    gestureSeeds.forEach((g) => {
      let A = fromChord ? bestInversion(fromChord, g.a) : g.a;
      let B = bestInversion(A, g.b);
      if (fromChord && fromChord.root === A.root && fromChord.quality === A.quality) return;
      const join2 = remainingAfter(2);
      const end = join2 ? vl(B, join2) : 0.7;
      let sc = 0.85 + vl(fromChord, A) * 0.6 + vl(A, B) * 0.7 + end * 0.9;
      if (join2 && end < 0.35) sc -= 0.4;
      pushPkg([A, B], {
        job: g.job,
        jobLabel: join2 ? g.jobLabel + ' · into ' + join2.name : g.jobLabel,
        score: sc,
        joinsTo: join2,
      });
    });

    packages.sort((a, b) => b.score - a.score);

    // Diversify: mix 1-step and 2-step, avoid same first chord dominating
    const out = [];
    const usedFirst = new Set();
    let ones = 0;
    let twos = 0;
    for (const p of packages) {
      if (out.length >= count) break;
      const fk = p.chords[0].root + ':' + p.chords[0].quality;
      // Allow a first chord twice only if one is 1-step and one is 2-step
      const firstCount = out.filter(
        (o) => o.chords[0].root === p.chords[0].root && o.chords[0].quality === p.chords[0].quality
      ).length;
      if (firstCount >= 2) continue;
      if (p.steps === 1 && ones >= Math.ceil(count * 0.45) && twos < 2) continue;
      if (p.steps === 2 && twos >= Math.ceil(count * 0.65) && ones < 2) continue;
      out.push(p);
      usedFirst.add(fk);
      if (p.steps === 1) ones += 1;
      else twos += 1;
    }
    // Fill remainder
    for (const p of packages) {
      if (out.length >= count) break;
      if (out.some((o) => o.key === p.key)) continue;
      out.push(p);
    }
    return out;
  }

  function countExoticStreak(path) {
    let n = 0;
    for (let i = path.length - 1; i >= 0; i--) {
      const r = path[i].region || 'diatonic';
      if (r === 'diatonic') break;
      n += 1;
    }
    return n;
  }

  function tasteKey(chord) {
    return chord.root + ':' + chord.quality;
  }

  // ─── Cell analysis / critique ────────────────────────────

  function analyzeCell(chords, tonic, modeKey) {
    const music = M();
    const t = music.pc(tonic);
    if (!chords.length) {
      return {
        score: 0,
        grades: { hook: 0, motion: 0, return: 0, rhythm: 0, voice: 0 },
        tensions: [],
        bassPath: [],
        strengths: [],
        weaknesses: [],
        tips: ['Add chords to start a cell — four is a strong default.'],
        guardrail: null,
      };
    }

    const tensions = tensionCurve(chords, tonic, modeKey);
    const avgT = tensions.reduce((a, b) => a + b, 0) / tensions.length;
    const maxT = Math.max(...tensions);
    const minT = Math.min(...tensions);

    // Bass path
    const bassPath = chords.map((c) => ({
      pc: effectiveBass(c),
      name: music.noteName(effectiveBass(c)),
    }));
    let bassStep = 0;
    let bassMoves = 0;
    for (let i = 1; i < chords.length; i++) {
      const d = bassInterval(chords[i - 1], chords[i]);
      bassMoves += 1;
      if (d <= 2 || d === 5) bassStep += 1;
    }
    const motionGrade = bassMoves ? bassStep / bassMoves : 0.5;

    // Voice leading average
    let vlSum = 0;
    let vlN = 0;
    for (let i = 1; i < chords.length; i++) {
      vlSum += music.voiceLeadingQuality(chords[i - 1], chords[i]);
      vlN += 1;
    }
    const voiceGrade = vlN ? vlSum / vlN : 0.7;

    // Return: ends near home or has cadence gesture
    const last = chords[chords.length - 1];
    const endsHome =
      last.root === t &&
      ['min', 'maj', 'min7', 'maj7', 'minmaj7'].includes(last.quality);
    const hasDom = chords.some(
      (c) => c.quality === 'dom7' || (c.root === (t + 7) % 12 && c.region === 'diatonic')
    );
    let returnGrade = endsHome ? 0.9 : hasDom ? 0.55 : 0.3;
    if (!endsHome && chords.some((c) => c.root === t)) returnGrade = Math.max(returnGrade, 0.45);

    // Hook: variety of roots + one distinctive colour
    const roots = new Set(chords.map((c) => c.root));
    const regions = new Set(chords.map((c) => c.region || 'diatonic'));
    let hookGrade = Math.min(1, roots.size / Math.max(3, chords.length * 0.75));
    if (regions.size > 1) hookGrade = Math.min(1, hookGrade + 0.2);
    if (roots.size === 1) hookGrade = 0.15;

    // Rhythm interest
    const durs = chords.map((c) => c.duration || 4);
    const uniqueDurs = new Set(durs.map((d) => Math.round(d * 2) / 2));
    const rhythmGrade =
      uniqueDurs.size === 1 ? (durs[0] === 4 ? 0.35 : 0.55) : Math.min(1, 0.45 + uniqueDurs.size * 0.2);
    // Long chord on high tension is good
    let longOnTension = false;
    durs.forEach((d, i) => {
      if (d >= 6 && tensions[i] >= 0.65) longOnTension = true;
    });
    if (longOnTension) rhythmGrade = Math.min(1, rhythmGrade + 0.15);

    const grades = {
      hook: round01(hookGrade),
      motion: round01(motionGrade),
      return: round01(returnGrade),
      rhythm: round01(rhythmGrade),
      voice: round01(voiceGrade),
    };
    const score = round01(
      grades.hook * 0.22 +
        grades.motion * 0.22 +
        grades.return * 0.18 +
        grades.rhythm * 0.18 +
        grades.voice * 0.2
    );

    const strengths = [];
    const weaknesses = [];
    const tips = [];

    if (grades.voice >= 0.7) strengths.push('Voice-leading between chords is mostly smooth.');
    if (grades.motion >= 0.7) strengths.push('Bass motion has good steps or fifths.');
    if (endsHome) strengths.push('Cell lands back at home — clear payoff.');
    if (regions.size > 1 && regions.size <= 3) strengths.push('Colour leaves the diatonic centre without chaos.');
    if (uniqueDurs.size > 1) strengths.push('Harmonic rhythm has shape (not all equal).');
    if (longOnTension) strengths.push('Long chord sits on tension — good storytelling.');

    if (grades.voice < 0.45) {
      weaknesses.push('Voice-leading is jumpy — try smoother inversions.');
      tips.push('Use “Smooth voicings” or set bass notes for stepwise motion.');
    }
    if (grades.motion < 0.4) {
      weaknesses.push('Bass leaps a lot — structure may feel random.');
      tips.push('Try slash chords so the bass walks (e.g. G/B → A → F#).');
    }
    if (avgT > 0.72 && minT > 0.4) {
      weaknesses.push('High tension throughout with little release.');
      tips.push('Plant a calmer diatonic chord or shorten the dark stretch.');
    }
    if (avgT < 0.28 && maxT < 0.4) {
      weaknesses.push('Stays very close to home — little journey.');
      tips.push('Borrow one interchange or secondary dominant for colour.');
    }
    if (!endsHome && goalHintNeedsReturn(chords)) {
      weaknesses.push('No clear return home yet.');
      tips.push('Open “Ways back home” or add V7 / ♭II7 into tonic.');
    }
    if (uniqueDurs.size === 1 && chords.length >= 3) {
      weaknesses.push('Every chord same length — duration is doing no work.');
      tips.push('Try a rhythm idea: hold the tense chord, or push into the landing.');
    }
    // Same function colour twice in a row
    for (let i = 1; i < chords.length; i++) {
      if (
        chords[i].root === chords[i - 1].root &&
        chords[i].quality === chords[i - 1].quality
      ) {
        weaknesses.push('Repeated identical harmony back-to-back.');
        tips.push('Change inversion/bass, or replace one with a neighbour chord.');
        break;
      }
    }
    // Reharm tip for bar 3 of 4
    if (chords.length === 4 && grades.hook < 0.7) {
      tips.push('Classic move: reharmonise chord 3 only — keep 1, 2, and 4.');
    }

    if (!strengths.length && chords.length) strengths.push('Skeleton is in place — refine motion and rhythm.');
    if (!tips.length) tips.push('Duplicate this cell and change only one chord or only the rhythm.');

    const exotic = countExoticStreak(chords);
    let guardrail = null;
    if (exotic >= 3) {
      guardrail = {
        level: 'warn',
        message: `${exotic} non-diatonic chords in a row — plant a landmark or open Ways back home.`,
      };
    } else if (exotic === 2) {
      guardrail = {
        level: 'soft',
        message: 'Two steps from the diatonic centre — one more exotic is fine if the next move explains it.',
      };
    }

    // Distance from home of last chord
    const lastDist = music.harmonicDistance(last, tonic, modeKey);

    return {
      score,
      grades,
      tensions,
      bassPath,
      strengths,
      weaknesses,
      tips,
      guardrail,
      avgTension: round01(avgT),
      lastDistance: lastDist,
      endsHome,
    };
  }

  function goalHintNeedsReturn(chords) {
    return chords.length >= 3;
  }

  function round01(x) {
    return Math.round(Math.max(0, Math.min(1, x)) * 100) / 100;
  }

  // ─── Variations ──────────────────────────────────────────

  /**
   * Force a darker colour on one chord. Always returns a different chord.
   */
  function darkenChord(chord, tonic, modeKey) {
    const music = M();
    if (!chord) return null;
    const q = String(chord.quality || 'maj');
    const r = music.pc(chord.root);
    const t = music.pc(tonic);
    const steps = [];
    const push = function (root, quality, roman, region) {
      if (root === r && quality === q) return;
      steps.push({ root: root, quality: quality, roman: roman || '', region: region || 'interchange' });
    };
    if (q === 'maj' || q === 'maj7' || q === 'add9' || q === 'sus2' || q === '6') {
      push(r, 'min', chord.roman || '', 'interchange');
      push(r, 'min7', '', 'interchange');
    }
    if (q === 'min' || q === 'min7' || q === 'madd9') {
      push(r, 'halfdim', '', 'diminished');
      push(r, 'dim', '', 'diminished');
    }
    if (q.indexOf('dom') === 0 || q === '7') {
      push(r, 'dom7b9', (chord.roman || 'V') + '♭9', 'valt');
      push(r, 'dom7alt', (chord.roman || 'V') + 'alt', 'valt');
    }
    if (q.indexOf('dim') >= 0 && q !== 'dim7') {
      push(r, 'dim7', '', 'diminished');
    }
    if (q === 'sus4' || q === '7sus4') push(r, 'min', '', 'diatonic');
    push((t + 8) % 12, 'maj', '♭VI', 'interchange');
    push((t + 3) % 12, 'maj', '♭III', 'interchange');
    push((t + 1) % 12, 'dom7', '♭II7', 'tritone');
    push((t + 10) % 12, 'dom7', '♭VII7', 'interchange');
    push(r, 'dim7', '', 'diminished');
    const pick = steps[0];
    if (!pick) return music.cloneChord(chord);
    let ch = music.makeChord(pick.root, pick.quality, {
      duration: chord.duration,
      region: pick.region,
      roman: pick.roman,
      tag: 'darken',
    });
    ch = withBass(ch, ch.root);
    ch.duration = chord.duration;
    if (chord.localTonic != null) ch.localTonic = chord.localTonic;
    if (chord.localMode) ch.localMode = chord.localMode;
    return ch;
  }

  function brightenChord(chord, tonic, modeKey) {
    const music = M();
    if (!chord) return null;
    const q = String(chord.quality || 'min');
    const r = music.pc(chord.root);
    const t = music.pc(tonic);
    const steps = [];
    const push = function (root, quality, roman, region) {
      if (root === r && quality === q) return;
      steps.push({ root: root, quality: quality, roman: roman || '', region: region || 'diatonic' });
    };
    if (q.indexOf('dim') >= 0 || q === 'halfdim') push(r, 'min', '', 'diatonic');
    if (q === 'min' || q === 'min7' || q === 'min9') push(r, 'maj', '', 'parallel');
    if (q === 'maj' || q === 'min') push(r, 'maj7', '', 'flavour');
    if (q.indexOf('dom') === 0) push(r, 'maj', '', 'diatonic');
    push((t + 5) % 12, 'maj', 'IV', 'diatonic');
    push((t + 7) % 12, 'maj', 'V', 'diatonic');
    const pick = steps[0];
    if (!pick) return music.cloneChord(chord);
    let ch = music.makeChord(pick.root, pick.quality, {
      duration: chord.duration,
      region: pick.region,
      roman: pick.roman,
      tag: 'brighten',
    });
    ch = withBass(ch, ch.root);
    ch.duration = chord.duration;
    if (chord.localTonic != null) ch.localTonic = chord.localTonic;
    if (chord.localMode) ch.localMode = chord.localMode;
    return ch;
  }

  function isMinorMode(modeKey) {
    const music = M();
    return (music.MODES[modeKey] || music.MODES.minor).romanBase === 'minor';
  }

  function sameChord(a, b) {
    return !!(a && b && a.root === b.root && a.quality === b.quality);
  }

  function pathSig(chords) {
    return (chords || [])
      .map(function (c) {
        return (c.root != null ? c.root : '?') + ':' + (c.quality || '');
      })
      .join('|');
  }

  function isBrightQuality(q) {
    q = String(q || '');
    return (
      q === 'maj' ||
      q === 'maj7' ||
      q === 'add9' ||
      q === 'sus2' ||
      q === '6' ||
      q === 'maj9'
    );
  }

  function isAlreadyDarkQuality(q) {
    q = String(q || '');
    return (
      q.indexOf('dim') >= 0 ||
      q === 'halfdim' ||
      q === 'dom7b9' ||
      q === 'dom7alt' ||
      q === 'dom7b13'
    );
  }

  function backdoorDominant(tonic, duration) {
    const music = M();
    const t = music.pc(tonic);
    let ch = music.makeChord((t + 10) % 12, 'dom7', {
      duration: duration || 2,
      region: 'interchange',
      roman: '♭VII7',
      tag: 'backdoor',
    });
    return withBass(ch, ch.root);
  }

  function closerDominant(tonic, modeKey, duration, escalate) {
    const music = M();
    const t = music.pc(tonic);
    const quality = escalate ? 'dom7b9' : 'dom7';
    let ch = music.makeChord((t + 7) % 12, quality, {
      duration: duration || 2,
      region: escalate ? 'valt' : 'diatonic',
      roman: escalate ? 'V7♭9' : 'V7',
      tag: 'closer',
    });
    return withBass(ch, ch.root);
  }

  function closerProgression(chords, tonic, modeKey) {
    const music = M();
    if (!chords || !chords.length) return chords;
    const last = chords[chords.length - 1];
    const vRoot = (music.pc(tonic) + 7) % 12;
    const alreadyV7 = last.root === vRoot && last.quality === 'dom7';
    const alreadyDark = last.root === vRoot && last.quality === 'dom7b9';
    if (alreadyDark) return chords.map((c) => music.cloneChord(c));
    return plantLastAs(chords, function (cur) {
      return closerDominant(tonic, modeKey, cur.duration, alreadyV7);
    });
  }

  function backdoorProgression(chords, tonic) {
    const music = M();
    if (!chords || !chords.length) return chords;
    const last = chords[chords.length - 1];
    const bdRoot = (music.pc(tonic) + 10) % 12;
    if (last.root === bdRoot && String(last.quality || '').indexOf('dom') === 0) {
      return chords.map((c) => music.cloneChord(c));
    }
    return plantLastAs(chords, function (cur) {
      return backdoorDominant(tonic, cur.duration);
    });
  }

  function plantInnerSecondary(chords, tonic) {
    const music = M();
    if (!chords || chords.length < 3) return chords.map((c) => music.cloneChord(c));
    const copy = chords.map((c) => music.cloneChord(c));
    const t = tonic != null ? music.pc(tonic) : copy[0].root;
    let best = null;
    let bestS = -Infinity;
    for (let i = 2; i < copy.length; i++) {
      const tgt = copy[i];
      const slot = i - 1;
      if (slot < 1) continue;
      const q = String(tgt.quality || '');
      if (q.indexOf('dim') >= 0 || q === 'halfdim') continue;
      if (q.indexOf('dom') === 0) continue;
      const cur = copy[slot];
      const vRoot = (music.pc(tgt.root) + 7) % 12;
      if (cur.root === vRoot && String(cur.quality || '').indexOf('dom') === 0) continue;
      const v = secondaryDominantOf(tgt, cur.duration);
      if (!v) continue;
      let s = 0.35;
      if (tgt.root === t) s += 0.7;
      if (
        tgt.region === 'diatonic' ||
        q === 'maj' ||
        q === 'min' ||
        q === 'maj7' ||
        q === 'min7'
      ) {
        s += 0.28;
      }
      s += (tgt.duration || 2) * 0.04;
      s -= joinScore(cur, tgt) * 0.25;
      s += joinScore(copy[slot - 1], v) * 0.55;
      s += joinScore(v, tgt) * 0.7;
      if (s > bestS) {
        bestS = s;
        best = { slot: slot, ch: v };
      }
    }
    if (best) {
      copy[best.slot] = best.ch;
      copy[best.slot].duration = chords[best.slot].duration;
    }
    return copy;
  }

  function plantLastAs(chords, maker) {
    const music = M();
    if (!chords || !chords.length) return chords;
    const copy = chords.map((c) => music.cloneChord(c));
    const last = copy[copy.length - 1];
    const ch = maker(last);
    if (ch) {
      ch.duration = last.duration;
      if (last.localTonic != null) ch.localTonic = last.localTonic;
      if (last.localMode) ch.localMode = last.localMode;
      copy[copy.length - 1] = ch;
    }
    return copy;
  }

  function secondaryDominantOf(target, duration) {
    const music = M();
    if (!target) return null;
    const root = (music.pc(target.root) + 7) % 12;
    let ch = music.makeChord(root, 'dom7', {
      duration: duration != null ? duration : target.duration || 2,
      region: 'secondary',
      roman: 'V7/',
      tag: 'secondary',
    });
    ch = withBass(ch, ch.root);
    return ch;
  }

  function tritoneSubOf(chord) {
    const music = M();
    if (!chord) return null;
    const root = (music.pc(chord.root) + 6) % 12;
    let ch = music.makeChord(root, 'dom7', {
      duration: chord.duration,
      region: 'tritone',
      roman: '♭II7',
      tag: 'tritone',
    });
    ch = withBass(ch, ch.root);
    if (chord.localTonic != null) ch.localTonic = chord.localTonic;
    if (chord.localMode) ch.localMode = chord.localMode;
    return ch;
  }

  function diminishChord(chord) {
    const music = M();
    if (!chord) return null;
    const q = String(chord.quality || '');
    const nextQ = q === 'dim' || q === 'dim7' ? 'dim7' : q.indexOf('min') === 0 ? 'dim' : 'dim';
    const quality = q === 'dim' ? 'dim7' : nextQ;
    if (quality === q) {
      return darkenChord(chord, chord.localTonic, chord.localMode);
    }
    let ch = music.makeChord(chord.root, quality, {
      duration: chord.duration,
      region: 'diminished',
      roman: (chord.roman || '') + '°',
      tag: 'dim',
    });
    ch = withBass(ch, ch.root);
    if (chord.localTonic != null) ch.localTonic = chord.localTonic;
    if (chord.localMode) ch.localMode = chord.localMode;
    return ch;
  }

  function joinScore(a, b) {
    const music = M();
    if (!a || !b) return 0.45;
    const vl = music.voiceLeadingQuality ? music.voiceLeadingQuality(a, b) : 0.5;
    return vl * 1.25 + bassMotionScore(a, b) * 0.85;
  }

  function recipeChord(tonic, deg, quality, roman, region, duration) {
    const music = M();
    let ch = music.makeChord((music.pc(tonic) + deg) % 12, quality, {
      duration: duration || 4,
      region: region || 'interchange',
      roman: roman || '',
      tag: 'darken',
    });
    return withBass(ch, ch.root);
  }

  function darkerRecipes(tonic, modeKey, dur) {
    const t = M().pc(tonic);
    const minor = isMinorMode(modeKey);
    if (minor) {
      // In minor, ♭VI / ♭III / ♭VII are already diatonic — not a darken.
      return [
        recipeChord(t, 1, 'maj', '♭II', 'neapolitan', dur),
        recipeChord(t, 1, 'dom7', '♭II7', 'tritone', dur),
        recipeChord(t, 7, 'dom7b9', 'V7♭9', 'valt', dur),
        recipeChord(t, 7, 'dom7alt', 'V7alt', 'valt', dur),
        recipeChord(t, 11, 'dim7', 'vii°7', 'diminished', dur),
        recipeChord(t, 6, 'dim7', '♯iv°7', 'diminished', dur),
        recipeChord(t, 5, 'min', 'iv', 'diatonic', dur),
        recipeChord(t, 5, 'min7', 'iv7', 'diatonic', dur),
        recipeChord(t, 10, 'dom7', '♭VII7', 'interchange', dur),
        recipeChord(t, 8, 'maj7', 'VImaj7', 'diatonic', dur),
      ];
    }
    return [
      recipeChord(t, 5, 'min', 'iv', 'interchange', dur),
      recipeChord(t, 8, 'maj', '♭VI', 'interchange', dur),
      recipeChord(t, 3, 'maj', '♭III', 'interchange', dur),
      recipeChord(t, 10, 'maj', '♭VII', 'interchange', dur),
      recipeChord(t, 10, 'dom7', '♭VII7', 'interchange', dur),
      recipeChord(t, 1, 'dom7', '♭II7', 'tritone', dur),
      recipeChord(t, 7, 'dom7b9', 'V7♭9', 'valt', dur),
      recipeChord(t, 8, 'maj7', '♭VImaj7', 'interchange', dur),
      recipeChord(t, 0, 'min', 'i', 'parallel', dur),
    ];
  }

  /** Known darker colour of THIS chord (IV→iv, V→V7♭9). Not “every major → minor”. */
  function contextualDarken(chord, tonic, modeKey) {
    const music = M();
    if (!chord) return [];
    const t = music.pc(tonic);
    const r = music.pc(chord.root);
    const q = String(chord.quality || '');
    const deg = (r - t + 12) % 12;
    const dur = chord.duration;
    const out = [];
    const minor = isMinorMode(modeKey);
    if (!minor && deg === 5 && isBrightQuality(q)) {
      out.push(recipeChord(t, 5, 'min', 'iv', 'interchange', dur));
    }
    if (deg === 7 && (isBrightQuality(q) || q === 'dom7')) {
      out.push(recipeChord(t, 7, 'dom7b9', 'V7♭9', 'valt', dur));
    }
    if (!minor && deg === 0 && isBrightQuality(q)) {
      out.push(recipeChord(t, 0, 'min', 'i', 'parallel', dur));
    }
    if (q === 'dom7') {
      out.push(
        music.makeChord(r, 'dom7b9', {
          duration: dur,
          region: 'valt',
          roman: (chord.roman || 'V') + '♭9',
          tag: 'darken',
        })
      );
    }
    if (q === 'dim') {
      out.push(
        music.makeChord(r, 'dim7', {
          duration: dur,
          region: 'diminished',
          roman: (chord.roman || '') + '°7',
          tag: 'darken',
        })
      );
    }
    return out.filter(Boolean).map(function (ch) {
      ch.duration = dur;
      return withBass(ch, ch.root);
    });
  }

  /**
   * Darken a cell as a piece: ONE classic darker join that still leads.
   * Major: IV→iv, else plant ♭VI. Minor: plant iv on a bright island, else
   * last step → V7♭9 / ♭II7. Never “paint every chord minor”.
   */
  function darkenProgression(chords, tonic, modeKey) {
    const music = M();
    if (!chords || !chords.length) return chords;
    const t = music.pc(tonic);
    const copy = chords.map((c) => music.cloneChord(c));
    const n = copy.length;
    const minor = isMinorMode(modeKey);

    const applyAt = function (i, ch) {
      if (!ch || i < 1 || i >= n) return false;
      if (sameChord(copy[i], ch)) return false;
      const next = withBass(music.cloneChord(ch), ch.root);
      next.duration = chords[i].duration;
      if (chords[i].localTonic != null) next.localTonic = chords[i].localTonic;
      if (chords[i].localMode) next.localMode = chords[i].localMode;
      copy[i] = next;
      return true;
    };
    const degOf = function (c) {
      return (music.pc(c.root) - t + 12) % 12;
    };

    // 1. Same chair: IV→iv, then V→V7♭9
    for (let i = 1; i < n; i++) {
      const q = String(copy[i].quality || '');
      if (!minor && degOf(copy[i]) === 5 && isBrightQuality(q)) {
        if (applyAt(i, recipeChord(t, 5, 'min', 'iv', 'interchange', copy[i].duration))) {
          return copy;
        }
      }
    }
    for (let i = 1; i < n; i++) {
      const q = String(copy[i].quality || '');
      if (degOf(copy[i]) === 7 && (isBrightQuality(q) || q === 'dom7')) {
        if (applyAt(i, recipeChord(t, 7, 'dom7b9', 'V7♭9', 'valt', copy[i].duration))) {
          return copy;
        }
      }
    }

    // 2. Plant the mode’s classic darker colour on a bright mid chair
    const plantDeg = minor ? 5 : 8;
    const plantQ = minor ? 'min' : 'maj';
    const plantRoman = minor ? 'iv' : '♭VI';
    const plantRegion = minor ? 'diatonic' : 'interchange';
    const plant = recipeChord(t, plantDeg, plantQ, plantRoman, plantRegion, 4);
    const plantAlready = copy.some(function (c) {
      return sameChord(c, plant);
    });
    if (!plantAlready) {
      let plantSlot = -1;
      let plantScore = -Infinity;
      for (let i = 1; i < n; i++) {
        if (sameChord(copy[i], plant)) continue;
        const prev = copy[i - 1];
        const nxt = i + 1 < n ? copy[i + 1] : copy[0];
        if (sameChord(prev, plant) || sameChord(nxt, plant)) continue;
        if (isAlreadyDarkQuality(copy[i].quality) && i !== n - 1) continue;
        let s = joinScore(prev, plant) + joinScore(plant, nxt);
        if (isBrightQuality(copy[i].quality)) s += 0.35;
        const d = degOf(copy[i]);
        if (minor && (d === 3 || d === 10)) s += 0.22;
        if (!minor && d === 5) s += 0.3;
        if (i === n - 1) s -= 0.15;
        if (s > plantScore) {
          plantScore = s;
          plantSlot = i;
        }
      }
      if (plantSlot >= 1) {
        const ch = recipeChord(
          t,
          plantDeg,
          plantQ,
          plantRoman,
          plantRegion,
          copy[plantSlot].duration
        );
        if (applyAt(plantSlot, ch)) return copy;
      }
    }

    // 3. Last step: darker cadence into home
    const lastCads = [
      recipeChord(t, 7, 'dom7b9', 'V7♭9', 'valt', copy[n - 1].duration),
      recipeChord(t, 1, 'dom7', '♭II7', 'tritone', copy[n - 1].duration),
      recipeChord(t, 10, 'dom7', '♭VII7', 'interchange', copy[n - 1].duration),
    ];
    for (let c = 0; c < lastCads.length; c++) {
      if (applyAt(n - 1, lastCads[c])) return copy;
    }

    // 4. Fallback: best remaining darker join
    const options = [];
    for (let i = 1; i < n; i++) {
      const prev = copy[i - 1];
      const cur = copy[i];
      const nxt = i + 1 < n ? copy[i + 1] : copy[0];
      const last = i === n - 1;
      if (isAlreadyDarkQuality(cur.quality) && !last) continue;
      const cands = contextualDarken(cur, t, modeKey).concat(darkerRecipes(t, modeKey, cur.duration));
      const seen = {};
      cands.forEach(function (cand) {
        if (!cand || sameChord(cand, cur)) return;
        if (last && cand.root === copy[0].root) return;
        const k = cand.root + ':' + cand.quality;
        if (seen[k]) return;
        seen[k] = 1;
        const deg = (music.pc(cand.root) - t + 12) % 12;
        const q = String(cand.quality || '');
        if (minor && isBrightQuality(q) && (deg === 3 || deg === 8 || deg === 10)) return;
        if (
          isBrightQuality(cur.quality) &&
          cand.root === cur.root &&
          String(cand.quality).indexOf('min') === 0 &&
          deg !== 5 &&
          deg !== 0
        ) {
          return;
        }
        let s = joinScore(prev, cand) + joinScore(cand, nxt);
        const already = copy.some(function (c, idx) {
          return idx !== i && sameChord(c, cand);
        });
        if (already) s -= 0.45;
        options.push({ i: i, ch: cand, score: s });
      });
    }
    options.sort(function (a, b) {
      return b.score - a.score;
    });
    if (options.length) applyAt(options[0].i, options[0].ch);
    return copy;
  }

  function brightenProgression(chords, tonic, modeKey) {
    const music = M();
    if (!chords || !chords.length) return chords.map((c) => music.cloneChord(c));
    const t = music.pc(tonic);
    const copy = chords.map((c) => music.cloneChord(c));
    const n = copy.length;
    const minor = isMinorMode(modeKey);
    const recipes = function (dur) {
      if (minor) {
        return [
          recipeChord(t, 3, 'maj', 'III', 'diatonic', dur),
          recipeChord(t, 5, 'maj', 'IV', 'interchange', dur),
          recipeChord(t, 7, 'maj', 'V', 'interchange', dur),
          recipeChord(t, 0, 'maj', 'I', 'parallel', dur),
        ];
      }
      return [
        recipeChord(t, 5, 'maj', 'IV', 'diatonic', dur),
        recipeChord(t, 7, 'maj', 'V', 'diatonic', dur),
        recipeChord(t, 0, 'maj', 'I', 'diatonic', dur),
        recipeChord(t, 9, 'min', 'vi', 'diatonic', dur),
      ];
    };
    const options = [];
    for (let i = 1; i < n; i++) {
      const prev = copy[i - 1];
      const cur = copy[i];
      const nxt = i + 1 < n ? copy[i + 1] : copy[0];
      const q = String(cur.quality || '');
      const dur = cur.duration;
      const cands = recipes(dur).slice();
      if (q.indexOf('dim') >= 0 || q === 'halfdim') {
        cands.unshift(
          music.makeChord(cur.root, 'min', {
            duration: dur,
            region: 'diatonic',
            roman: cur.roman || '',
            tag: 'brighten',
          })
        );
      }
      if (q === 'min' || q === 'min7') {
        if (cur.root === t) {
          cands.unshift(recipeChord(t, 0, 'maj', 'I', 'parallel', dur));
        } else if (!minor) {
          cands.unshift(
            music.makeChord(cur.root, 'maj', {
              duration: dur,
              region: 'parallel',
              tag: 'brighten',
            })
          );
        }
      }
      const seen = {};
      cands.forEach(function (cand) {
        if (!cand || sameChord(cand, cur)) return;
        const k = cand.root + ':' + cand.quality;
        if (seen[k]) return;
        seen[k] = 1;
        let s = joinScore(prev, cand) + joinScore(cand, nxt) * 1.1;
        const roman = cand.roman || '';
        if (roman === 'IV' || roman === 'V' || roman === 'I') s += 0.22;
        const already = copy.some(function (c, idx) {
          return idx !== i && sameChord(c, cand);
        });
        if (already) s -= 0.4;
        if (q.indexOf('dim') >= 0 || q === 'halfdim') s += 0.2;
        options.push({ i: i, ch: cand, score: s });
      });
    }
    options.sort(function (a, b) {
      return b.score - a.score;
    });
    if (!options.length) return copy;
    const pick = options[0];
    copy[pick.i] = withBass(music.cloneChord(pick.ch), pick.ch.root);
    copy[pick.i].duration = chords[pick.i].duration;
    return copy;
  }

  function varyOneChord(chords, tonic, modeKey, index) {
    const music = M();
    if (!chords.length) return chords.slice();
    const i = index != null ? index : Math.min(2, chords.length - 1);
    const copy = chords.map((c) => music.cloneChord(c));
    const prev = i > 0 ? copy[i - 1] : null;
    const next = i < copy.length - 1 ? copy[i + 1] : copy[0];
    const suggestions = suggestNext({
      fromChord: prev || copy[i],
      tonic,
      modeKey,
      goalId: 'get_darker',
      count: 10,
      path: copy.slice(0, i),
    });
    const cur = copy[i];
    let pick = null;
    let best = -Infinity;
    (suggestions || []).forEach(function (s) {
      if (!s || !s.chord) return;
      if (sameChord(s.chord, cur)) return;
      let sc = (s.score || 0) + (next ? joinScore(s.chord, next) : 0);
      if (sc > best) {
        best = sc;
        pick = s;
      }
    });
    if (pick) {
      copy[i] = {
        ...music.cloneChord(pick.chord),
        duration: cur.duration,
      };
      if (next) copy[i] = bestInversion(prev, copy[i]);
    }
    return copy;
  }

  function varyRhythmOnly(chords) {
    const music = M();
    const n = chords.length;
    if (n < 2) return chords.map((c) => music.cloneChord(c));
    const cur = chords.map(function (c) {
      return Number(c.duration) || 4;
    });
    let patterns = (music.rhythmSuggestions(n) || []).slice();
    if (n >= 5) {
      const longShort = [];
      for (let i = 0; i < n; i++) longShort.push(i % 2 === 0 ? 6 : 2);
      const pushLast = cur.slice();
      pushLast[n - 2] = 6;
      pushLast[n - 1] = 2;
      const half = cur.map(function () {
        return 8;
      });
      patterns = patterns.concat([
        { name: 'Long–short', beats: longShort },
        { name: 'Push last', beats: pushLast },
        { name: 'Half-time', beats: half },
      ]);
    }
    const differs = function (beats) {
      return (beats || []).some(function (b, i) {
        return b !== cur[i];
      });
    };
    const pat =
      patterns.find(function (p) {
        return differs(p.beats) && new Set(p.beats).size > 1;
      }) ||
      patterns.find(function (p) {
        return differs(p.beats);
      }) ||
      patterns[0];
    if (!pat) return chords.map((c) => music.cloneChord(c));
    return music.applyRhythm(
      chords.map((c) => music.cloneChord(c)),
      pat.beats
    );
  }

  /** Whole-cell 7ths: keep family, add the seventh. V stays dominant. */
  function seventhizeProgression(chords, tonic, modeKey) {
    const music = M();
    if (!chords || !chords.length) return chords;
    const t = music.pc(tonic);
    const minor = isMinorMode(modeKey);
    return chords.map(function (src) {
      const c = music.cloneChord(src);
      if (c.custom || c.quality === 'custom') return c;
      const q = String(c.quality || 'maj');
      if (
        q === 'maj7' ||
        q === 'min7' ||
        q === 'dom7' ||
        q === 'halfdim' ||
        q === 'dim7' ||
        q === 'minmaj7' ||
        q === 'maj9' ||
        q === 'min9' ||
        q.indexOf('dom7') === 0
      ) {
        return c;
      }
      const deg = (music.pc(c.root) - t + 12) % 12;
      let nextQ = null;
      if (q === 'dim') {
        nextQ = deg === 11 || deg === 2 ? (deg === 11 ? 'dim7' : 'halfdim') : 'dim7';
      } else if (q === 'min' || q === 'madd9') {
        nextQ = 'min7';
      } else if (q === 'sus4' || q === '7sus4') {
        nextQ = 'dom7';
      } else if (isBrightQuality(q)) {
        if (deg === 7) nextQ = 'dom7';
        else if (minor && deg === 10) nextQ = 'dom7';
        else nextQ = 'maj7';
      }
      if (!nextQ || nextQ === q) return c;
      let ch = music.makeChord(c.root, nextQ, {
        duration: c.duration,
        region: c.region || 'flavour',
        roman: c.roman || '',
        tag: 'sevenths',
      });
      ch = withBass(ch, c.root);
      ch.duration = c.duration;
      if (c.localTonic != null) ch.localTonic = c.localTonic;
      if (c.localMode) ch.localMode = c.localMode;
      return ch;
    });
  }

  function chordTonePcs(chord) {
    const music = M();
    if (!chord) return [];
    let notes = (chord.notes || []).map(function (n) {
      return music.pc(n);
    });
    if (!notes.length && chord.root != null) {
      const q = music.QUALITIES[chord.quality];
      const r = music.pc(chord.root);
      notes = ((q && q.intervals) || [0, 4, 7]).map(function (iv) {
        return (r + ((iv % 12) + 12) % 12) % 12;
      });
    }
    const out = [];
    notes.forEach(function (n) {
      if (out.indexOf(n) < 0) out.push(n);
    });
    return out;
  }

  /**
   * Common-tone bass, per local key. Never invents a slash note that is not
   * in the chord. Local tonic wins when it actually belongs; otherwise the
   * pitch that covers the most chords in that island. A held bass can
   * continue across a modulation if the next island still contains it.
   */
  function pedalProgression(chords, tonic) {
    const music = M();
    if (!chords || !chords.length) return chords.map((c) => music.cloneChord(c));
    const copy = chords.map((c) => music.cloneChord(c));
    const n = copy.length;
    const fallback = tonic != null ? music.pc(tonic) : music.pc(copy[0].root);
    const homeOf = function (c) {
      return c.localTonic != null ? music.pc(c.localTonic) : fallback;
    };
    const islands = [];
    let start = 0;
    for (let i = 1; i <= n; i++) {
      if (i === n || homeOf(copy[i]) !== homeOf(copy[start])) {
        islands.push({ start: start, end: i, home: homeOf(copy[start]) });
        start = i;
      }
    }

    const pickPedal = function (from, to, home, prefer) {
      const counts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (let i = from; i < to; i++) {
        chordTonePcs(copy[i]).forEach(function (p) {
          counts[p] += 1;
        });
      }
      let best = -1;
      let bestS = -1;
      for (let p = 0; p < 12; p++) {
        if (!counts[p]) continue;
        let sc = counts[p];
        if (p === home) sc += 1.2;
        if (prefer != null && p === prefer) sc += 0.9;
        if (sc > bestS) {
          bestS = sc;
          best = p;
        }
      }
      return best;
    };

    const stamp = function (i, bass, tag) {
      const src = chords[i];
      const next = withBass(copy[i], bass);
      next.duration = src.duration;
      next.tag = tag || src.tag || 'pedal';
      if (src.localTonic != null) next.localTonic = src.localTonic;
      if (src.localMode) next.localMode = src.localMode;
      copy[i] = next;
    };

    let held = null;
    islands.forEach(function (isl) {
      const pedal = pickPedal(isl.start, isl.end, isl.home, held);
      if (pedal < 0) return;
      for (let i = isl.start; i < isl.end; i++) {
        const tones = chordTonePcs(copy[i]);
        if (tones.indexOf(pedal) >= 0) {
          // Keep the first step of the whole cell in root position (home).
          if (i === 0) stamp(i, copy[i].root, copy[i].tag);
          else stamp(i, pedal, 'pedal');
          held = pedal;
        } else {
          stamp(i, copy[i].root, copy[i].tag);
        }
      }
      held = pedal;
    });
    return copy;
  }

  /** Two darker/colour joins — a whole-cell reharm take, not one step. */
  function reharmProgression(chords, tonic, modeKey) {
    const music = M();
    if (!chords || chords.length < 2) return chords.map((c) => music.cloneChord(c));
    const a = Math.min(2, Math.max(1, chords.length - 2));
    let next = varyOneChord(chords, tonic, modeKey, a);
    if (chords.length >= 5) {
      const b = Math.max(1, chords.length - 2);
      if (b !== a) next = varyOneChord(next, tonic, modeKey, b);
    }
    return next;
  }

  function reharmBar(chords, tonic, modeKey, barIndex) {
    // barIndex 0-based; default bar 3 → index 2
    const i = barIndex != null ? barIndex : Math.min(2, Math.max(0, chords.length - 2));
    return varyOneChord(chords, tonic, modeKey, i);
  }

  function varySameBassNewUpper(chords, tonic, modeKey) {
    const music = M();
    if (chords.length < 2) return chords.map((c) => music.cloneChord(c));
    const copy = chords.map((c) => music.cloneChord(c));
    // Change the highest-tension non-final chord's quality/colour but keep bass
    let target = 1;
    let bestT = -1;
    copy.forEach((c, i) => {
      if (i === copy.length - 1) return;
      const t = chordTension(c, tonic, modeKey);
      if (t > bestT) {
        bestT = t;
        target = i;
      }
    });
    const bass = effectiveBass(copy[target]);
    const suggestions = suggestNext({
      fromChord: target ? copy[target - 1] : null,
      tonic,
      modeKey,
      goalId: 'epic_lift',
      count: 10,
      path: copy.slice(0, target),
    });
    const pick = suggestions.find((s) => {
      const tones = chordTones(s.chord);
      return tones.includes(bass) && !(s.chord.root === copy[target].root && s.chord.quality === copy[target].quality);
    }) || suggestions[0];
    if (pick) {
      const dur = copy[target].duration;
      copy[target] = withBass(music.cloneChord(pick.chord), bass);
      copy[target].duration = dur;
    }
    return copy;
  }

  function structureABBA(chords) {
    // If 4 chords A B C D → A B B' A with B' slight rhythm or inversion change
    const music = M();
    if (chords.length < 2) return chords.map((c) => music.cloneChord(c));
    if (chords.length === 4) {
      const A = music.cloneChord(chords[0]);
      const B = music.cloneChord(chords[1]);
      const Bp = withInversion(music.cloneChord(chords[1]), 1);
      Bp.duration = chords[2].duration;
      const A2 = music.cloneChord(chords[0]);
      A2.duration = chords[3].duration;
      A.duration = chords[0].duration;
      B.duration = chords[1].duration;
      return [A, B, Bp, A2];
    }
    // General: A B B' A from first two
    const A = music.cloneChord(chords[0]);
    const B = music.cloneChord(chords[1] || chords[0]);
    const Bp = withInversion(music.cloneChord(B), 1);
    return [A, B, Bp, music.cloneChord(A)];
  }

  // ─── Taste memory ────────────────────────────────────────

  const TASTE_KEY = 'hl_taste_v1';

  function loadTaste() {
    try {
      const raw = localStorage.getItem(TASTE_KEY);
      if (!raw) return { accepted: {}, rejected: {}, goalCounts: {} };
      const o = JSON.parse(raw);
      return {
        accepted: o.accepted || {},
        rejected: o.rejected || {},
        goalCounts: o.goalCounts || {},
      };
    } catch (_) {
      return { accepted: {}, rejected: {}, goalCounts: {} };
    }
  }

  function saveTaste(taste) {
    try {
      localStorage.setItem(TASTE_KEY, JSON.stringify(taste));
    } catch (_) { /* ignore */ }
  }

  function acceptChord(taste, chord) {
    const k = tasteKey(chord);
    taste.accepted[k] = (taste.accepted[k] || 0) + 1;
    if (taste.rejected[k]) taste.rejected[k] = Math.max(0, taste.rejected[k] - 1);
    saveTaste(taste);
    return taste;
  }

  function rejectChord(taste, chord) {
    const k = tasteKey(chord);
    taste.rejected[k] = (taste.rejected[k] || 0) + 1;
    saveTaste(taste);
    return taste;
  }

  function noteGoalUse(taste, goalId) {
    taste.goalCounts[goalId] = (taste.goalCounts[goalId] || 0) + 1;
    saveTaste(taste);
  }

  // ─── Modulation helpers ──────────────────────────────────

  /**
   * Keys adjacent on the circle from a pivot key — Chase halo candidates.
   * Dominant / subdominant / relative / parallel only (bounded choice).
   */
  function adjacentKeys(tonic, modeKey, count = 4) {
    const music = M();
    const t = music.pc(tonic);
    const mode = modeKey || 'minor';
    const isMinor = (music.MODES[mode] || music.MODES.minor).romanBase === 'minor';
    const out = [];
    const seen = new Set();
    const add = (pc, m, relation, character) => {
      const tt = ((pc % 12) + 12) % 12;
      const mm = m || mode;
      const id = tt + ':' + mm;
      if (tt === t && mm === mode) return;
      if (seen.has(id)) return;
      seen.add(id);
      out.push({
        tonic: tt,
        mode: mm,
        relation: relation,
        character: character || '',
        name:
          music.noteName(tt) +
          ' ' +
          ((music.MODES[mm] || music.MODES.minor).name || mm),
      });
    };
    add(t + 7, mode, 'Dominant key', 'Strong pull away');
    add(t + 5, mode, 'Subdominant key', 'Softer side-step');
    if (isMinor) {
      add(t + 3, 'major', 'Relative major', 'Brighter sibling');
      add(t, 'major', 'Parallel major', 'Same root, major colour');
    } else {
      add(t + 9, 'minor', 'Relative minor', 'Darker sibling');
      add(t, 'minor', 'Parallel minor', 'Same root, minor colour');
    }
    return out.slice(0, count);
  }

  /**
   * Short “plant home” packages in a destination key (establish, not just colour).
   * Used on Chase ghost wheels around the pivot.
   */
  function establishHomeOptions(toTonic, toMode) {
    const music = M();
    const t = music.pc(toTonic);
    const mode = toMode || 'minor';
    const isMinor = (music.MODES[mode] || music.MODES.minor).romanBase === 'minor';
    const tonicChord = music.makeChord(t, isMinor ? 'min' : 'maj', {
      region: 'diatonic',
      roman: isMinor ? 'i' : 'I',
      tag: 'establish',
    });
    const dominant = music.makeChord((t + 7) % 12, 'dom7', {
      region: 'diatonic',
      roman: 'V7',
      tag: 'establish',
    });
    return [
      {
        id: 'tonic',
        label: tonicChord.name,
        job: 'land tonic',
        character: 'Direct home in new key',
        route: [tonicChord],
      },
      {
        id: 'cadence',
        label: dominant.name + ' → ' + tonicChord.name,
        job: 'V7 → home',
        character: 'Clear cadence — establishes the key',
        route: [dominant, tonicChord],
      },
    ];
  }

  /**
   * Common modulation targets from current writing key.
   * Chords stay absolute; this only suggests where gravity can move.
   */
  function modulationTargets(tonic, modeKey, count = 8) {
    const music = M();
    const t = music.pc(tonic);
    const isMinor = (music.MODES[modeKey] || music.MODES.minor).romanBase === 'minor';
    const candidates = [];

    function add(pc, mode, relation, character) {
      candidates.push({
        tonic: ((pc % 12) + 12) % 12,
        mode,
        name: music.noteName(((pc % 12) + 12) % 12) + ' ' + (music.MODES[mode] || music.MODES.minor).name,
        relation,
        character,
      });
    }

    // Closely related
    add(t + 7, modeKey, 'Dominant key', 'Strong pull away');
    add(t + 5, modeKey, 'Subdominant key', 'Softer side-step');
    if (isMinor) {
      add(t + 3, 'major', 'Relative major', 'Brighter sibling');
      add(t, 'major', 'Parallel major', 'Same root, major colour');
      add(t + 8, 'major', '♭VI major area', 'Cinematic lift');
      add(t + 10, 'major', '♭VII major area', 'Epic/modal');
      add(t + 7, 'major', 'V major / dominant region', 'Dominant territory');
      add(t + 2, 'minor', 'Supertonic minor', 'Dark neighbour');
    } else {
      add(t + 9, 'minor', 'Relative minor', 'Darker sibling');
      add(t, 'minor', 'Parallel minor', 'Same root, minor colour');
      add(t + 2, 'minor', 'ii minor region', 'Soft minor colour');
      add(t + 4, 'minor', 'iii minor', 'Mediant shade');
    }
    // Chromatic mediant keys
    add(t + 4, isMinor ? 'minor' : 'major', 'Chromatic mediant', 'Cinematic leap');
    add(t + 8, isMinor ? 'minor' : 'major', 'Chromatic mediant', 'Cinematic leap');
    add(t + 6, modeKey, 'Tritone key', 'Maximum distance');

    const seen = new Set();
    return candidates.filter((c) => {
      const k = c.tonic + ':' + c.mode;
      if (c.tonic === t && c.mode === modeKey) return false;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, count);
  }

  /**
   * Pivot chords that belong to both fromKey and toKey (shared diatonic material).
   */
  function pivotChords(fromTonic, fromMode, toTonic, toMode, sevenths = true) {
    const music = M();
    const a = music.diatonicChords(fromTonic, fromMode, sevenths);
    const b = music.diatonicChords(toTonic, toMode, sevenths);
    const bKeys = new Set(b.map((c) => c.root + ':' + roughQuality(c.quality)));
    const pivots = [];
    a.forEach((ch) => {
      const k = ch.root + ':' + roughQuality(ch.quality);
      if (bKeys.has(k)) {
        pivots.push({
          ...ch,
          tag: 'pivot',
          roman: (ch.roman || '') + ' →',
          region: 'diatonic',
        });
      }
    });
    // Also exact root+quality matches from B side for naming in new key
    return music.dedupeChords(pivots).slice(0, 8);
  }

  function roughQuality(q) {
    if (q === 'maj7' || q === 'maj9' || q === 'add9') return 'maj';
    if (q === 'min7' || q === 'min9' || q === 'minmaj7') return 'min';
    if (q === 'dom7') return 'dom';
    if (q === 'halfdim' || q === 'dim7') return 'dim';
    if (q === 'sus2' || q === 'sus4') return 'sus';
    return q;
  }

  function qualityFamiliesMatch(a, b) {
    const ra = roughQuality(a);
    const rb = roughQuality(b);
    if (ra === rb) return true;
    // Dom can pivot as major triad V in a major key
    if ((ra === 'dom' && rb === 'maj') || (ra === 'maj' && rb === 'dom')) return true;
    // Sus often stands in for maj/min on the same degree
    if (ra === 'sus' || rb === 'sus') return true;
    return false;
  }

  /**
   * Parallel minor-mode family on one root (video framing):
   * Aeolian (natural minor) · Dorian · Phrygian — same tonic, three minor flavours.
   */
  function parallelMinorFamily(tonicPc) {
    const music = M();
    const t = music.pc(tonicPc);
    const rootName = music.noteName(t);
    return [
      {
        tonic: t,
        mode: 'minor',
        name: rootName + ' minor (Aeolian)',
        shortName: rootName + 'm Aeolian',
        relation: 'Parallel minor family',
        character: 'Natural minor — classic dark home',
        family: 'parallel-minor',
        modeLabel: 'Aeolian',
      },
      {
        tonic: t,
        mode: 'dorian',
        name: rootName + ' Dorian',
        shortName: rootName + ' Dorian',
        relation: 'Parallel minor family',
        character: 'Minor with raised 6th — softer / folk',
        family: 'parallel-minor',
        modeLabel: 'Dorian',
      },
      {
        tonic: t,
        mode: 'phrygian',
        name: rootName + ' Phrygian',
        shortName: rootName + ' Phrygian',
        relation: 'Parallel minor family',
        character: 'Minor with ♭2 — Spanish / dark modal',
        family: 'parallel-minor',
        modeLabel: 'Phrygian',
      },
    ];
  }

  /**
   * Keys that treat `chord` as a diatonic (or quality-compatible) pivot.
   * Ranked: tonic function first, then closely related to current write home.
   *
   * @returns [{ tonic, mode, name, romanInKey, roleInKey, relation, character, score, establish }]
   */
  function keysForPivotChord(chord, fromTonic, fromMode, opts) {
    opts = opts || {};
    if (!chord || chord.root == null) return [];
    const music = M();
    const fromT = music.pc(fromTonic != null ? fromTonic : 0);
    const fromM = fromMode || 'minor';
    const root = music.pc(chord.root);
    const q = chord.quality || 'maj';
    const modes =
      opts.modes ||
      ['major', 'minor', 'dorian', 'phrygian', 'mixolydian', 'lydian', 'harmonic'];
    const limit = opts.limit != null ? opts.limit : 12;
    const out = [];
    const seen = new Set();

    function fifthsDist(a, b) {
      // circle-of-fifths steps between tonics
      const ai = (a * 7) % 12;
      const bi = (b * 7) % 12;
      return Math.min((ai - bi + 12) % 12, (bi - ai + 12) % 12);
    }

    function relationLabel(tonic, mode, roman) {
      const fd = fifthsDist(fromT, tonic);
      if (tonic === fromT && mode !== fromM) {
        if (
          (fromM === 'major' && (mode === 'minor' || mode === 'dorian' || mode === 'phrygian')) ||
          ((fromM === 'minor' || fromM === 'dorian' || fromM === 'phrygian') && mode === 'major')
        ) {
          return 'Parallel / same root';
        }
        return 'Same tonic · mode change';
      }
      const isFromMin = (music.MODES[fromM] || {}).romanBase === 'minor';
      const isToMin = (music.MODES[mode] || {}).romanBase === 'minor';
      if (!isFromMin && isToMin && tonic === (fromT + 9) % 12) return 'Relative minor';
      if (isFromMin && !isToMin && tonic === (fromT + 3) % 12) return 'Relative major';
      if (fd === 1 && mode === fromM) {
        return tonic === (fromT + 7) % 12 ? 'Dominant key' : 'Subdominant key';
      }
      if (fd <= 2) return 'Closely related';
      if (fd <= 4) return 'Related';
      return 'Distant';
    }

    for (let tonic = 0; tonic < 12; tonic++) {
      for (let mi = 0; mi < modes.length; mi++) {
        const mode = modes[mi];
        if (tonic === fromT && mode === fromM) continue;
        const id = tonic + ':' + mode;
        if (seen.has(id)) continue;
        const diat = music.diatonicChords(tonic, mode, false);
        let match = null;
        for (let i = 0; i < diat.length; i++) {
          const d = diat[i];
          if (d.root === root && qualityFamiliesMatch(q, d.quality)) {
            match = d;
            break;
          }
        }
        // Also allow exact extended match via sevenths set
        if (!match) {
          const diat7 = music.diatonicChords(tonic, mode, true);
          for (let i = 0; i < diat7.length; i++) {
            const d = diat7[i];
            if (d.root === root && qualityFamiliesMatch(q, d.quality)) {
              match = d;
              break;
            }
          }
        }
        if (!match) continue;
        seen.add(id);

        const roman = match.roman || '';
        const roleBoost =
          roman === 'I' || roman === 'i'
            ? 40
            : roman === 'V' || roman === 'v' || roman === 'V7'
              ? 28
              : roman === 'IV' || roman === 'iv'
                ? 24
                : roman === 'vi' || roman === 'VI' || roman === 'iii' || roman === 'III'
                  ? 18
                  : roman === 'ii' || roman === 'ii°'
                    ? 16
                    : 10;
        const fd = fifthsDist(fromT, tonic);
        const closeBoost = Math.max(0, 12 - fd * 3);
        const modeName = (music.MODES[mode] || {}).name || mode;
        const name = music.noteName(tonic) + ' ' + modeName;
        let score = roleBoost + closeBoost;
        // Prefer destinations where pivot is tonic (true re-home)
        if (roman === 'I' || roman === 'i') score += 8;
        // Slight boost for parallel minor family of this chord's root
        if (
          tonic === root &&
          (mode === 'minor' || mode === 'dorian' || mode === 'phrygian') &&
          roughQuality(q) === 'min'
        ) {
          score += 15;
        }

        const establish = establishHomeOptions(tonic, mode);
        out.push({
          tonic: tonic,
          mode: mode,
          name: name,
          shortName: music.noteName(tonic) + (mode === 'minor' ? 'm' : ' ' + mode),
          romanInKey: roman,
          roleInKey: match.role || '',
          qualityInKey: match.quality,
          relation: relationLabel(tonic, mode, roman),
          character:
            (chord.name || music.noteName(root)) +
            ' as ' +
            roman +
            ' in ' +
            name,
          score: score,
          establish: establish,
          family:
            tonic === root &&
            (mode === 'minor' || mode === 'dorian' || mode === 'phrygian')
              ? 'parallel-minor'
              : '',
        });
      }
    }

    out.sort(function (a, b) {
      return b.score - a.score || a.name.localeCompare(b.name);
    });
    return out.slice(0, limit);
  }

  /**
   * Ranked joins from `fromChord` into `toChord` (loop tail, or section seam).
   * Destination is NOT included — the next cell/loop start already is that chord.
   */
  function suggestLoopJoins(opts) {
    opts = opts || {};
    const music = M();
    const from = opts.fromChord;
    const to = opts.toChord;
    if (!from || !to) return [];
    const t = music.pc(opts.tonic != null ? opts.tonic : to.root);
    const mode = opts.modeKey || opts.mode || 'minor';
    const isMinor =
      (music.MODES[mode] || music.MODES.minor).romanBase === 'minor';
    const count = opts.count != null ? opts.count : 6;
    const dur = opts.duration != null ? opts.duration : 2;

    const mk = function (root, quality, roman, region, job) {
      let ch = music.makeChord(root, quality, {
        duration: dur,
        region: region || 'diatonic',
        roman: roman || '',
        tag: 'join',
      });
      // Root position so “A” reads as A (not A/G#) — this is a functional join, not VL
      if (withBass) ch = withBass(ch, ch.root);
      return { ch: ch, roman: roman, region: region, job: job };
    };

    const raw = [
      mk((to.root + 7) % 12, 'dom7', 'V7', 'diatonic', 'authentic into ' + (to.name || 'home')),
      mk((to.root + 7) % 12, 'dom7b9', 'V7♭9', 'valt', 'dark dominant'),
      mk((to.root + 7) % 12, isMinor ? 'min' : 'maj', isMinor ? 'v' : 'V', 'diatonic', 'soft dominant'),
      mk((to.root + 10) % 12, 'maj', isMinor ? 'VII' : '♭VII', 'diatonic', 'step into tonic'),
      mk((to.root + 5) % 12, isMinor ? 'min' : 'maj', isMinor ? 'iv' : 'IV', 'diatonic', 'plagal'),
      mk((to.root + 1) % 12, 'dom7', '♭II7', 'tritone', 'tritone into tonic'),
      mk((to.root + 10) % 12, 'dom7', '♭VII7', 'interchange', 'backdoor'),
      mk((to.root + 2) % 12, isMinor ? 'halfdim' : 'min7', isMinor ? 'iiø' : 'ii7', 'diatonic', 'supertonic'),
      mk((to.root + 8) % 12, 'maj', isMinor ? 'VI' : 'vi', 'diatonic', 'submediant colour'),
    ];

    const seen = {};
    const scored = [];
    raw.forEach(function (row) {
      const ch = row.ch;
      if (!ch) return;
      const sameAsFrom = ch.root === from.root && ch.quality === from.quality;
      const keepVisible =
        row.roman === 'VII' || row.roman === '♭VII' || row.roman === 'V7';
      if (sameAsFrom && !keepVisible) return;
      if (ch.root === to.root && (ch.quality === to.quality || (ch.quality || '').indexOf('min') === 0 && (to.quality || '').indexOf('min') === 0)) {
        return;
      }
      const k = ch.root + ':' + ch.quality;
      if (seen[k]) return;
      seen[k] = 1;
      const vlIn = from ? music.voiceLeadingQuality(from, ch) : 0.6;
      const vlOut = music.voiceLeadingQuality(ch, to);
      const bassIn = from ? bassMotionScore(from, ch) : 0.6;
      const bassOut = bassMotionScore(ch, to);
      let score = vlIn * 0.9 + vlOut * 1.3 + bassIn * 0.4 + bassOut * 0.7;
      if (row.roman === 'V7') score += 0.45;
      if (row.roman === 'V7♭9') score += 0.28;
      // Natural-minor VII (A in Bm) is the classic turnaround into i
      if (row.roman === 'VII' || row.roman === '♭VII') score += 0.62;
      if (row.roman === 'iv' || row.roman === 'IV') score += 0.18;
      if (row.region === 'tritone') score += 0.05;
      scored.push({
        id: 'join-' + k,
        label: sameAsFrom ? ch.name + ' · current' : ch.name,
        job: sameAsFrom
          ? 'already the last step · ' + (row.job || 'turnaround')
          : row.job,
        roman: row.roman,
        region: row.region,
        chords: [ch],
        mode: 'replace',
        score: score,
      });
    });
    scored.sort(function (a, b) {
      return b.score - a.score;
    });
    const pin = function (roman) {
      const hit = scored.find(function (s) {
        return s.roman === roman;
      });
      if (!hit) return;
      if (
        scored.slice(0, count).some(function (s) {
          return s.id === hit.id;
        })
      ) {
        return;
      }
      scored.splice(count - 1, 0, hit);
    };
    if (isMinor) pin('VII');
    pin('V7');
    const top = scored.slice(0, count);
    const turn =
      top.find(function (s) {
        return s.roman === 'VII' || s.roman === '♭VII' || s.roman === 'V7';
      }) || top[0];
    if (turn) {
      top.push({
        id: 'join-keep-' + turn.id,
        label: 'keep + ' + turn.label,
        job: 'insert seam · then into ' + (to.name || 'home'),
        roman: turn.roman,
        region: turn.region,
        chords: turn.chords.slice(),
        mode: 'insert',
        score: turn.score * 0.85,
      });
    }
    return top;
  }

  /**
   * Routes into a new key (not back to old home) — establish the modulation.
   */
  function waysIntoKey(fromChord, toTonic, toMode, count = 5) {
    const music = M();
    const t = music.pc(toTonic);
    const isMinor = (music.MODES[toMode] || music.MODES.minor).romanBase === 'minor';
    const tonicChord = music.makeChord(t, isMinor ? 'min' : 'maj', {
      region: 'diatonic',
      roman: isMinor ? 'i' : 'I',
      tag: 'new home',
    });
    const dominant = music.makeChord((t + 7) % 12, 'dom7', {
      region: 'diatonic',
      roman: 'V7',
      tag: 'new dominant',
    });
    const ii = music.makeChord((t + 2) % 12, isMinor ? 'halfdim' : 'min7', {
      region: 'diatonic',
      roman: 'ii',
      tag: 'ii',
    });
    const bII7 = music.makeChord((t + 1) % 12, 'dom7', {
      region: 'tritone',
      roman: '♭II7',
      tag: 'tritone into new key',
    });
    const subdom = music.makeChord((t + 5) % 12, isMinor ? 'min' : 'maj', {
      region: 'diatonic',
      roman: isMinor ? 'iv' : 'IV',
      tag: 'subdominant',
    });

    const routes = [
      { name: 'V7 → new tonic', character: 'clear cadence in new key', chords: [dominant, tonicChord] },
      { name: 'ii–V–i into new key', character: 'smooth establishment', chords: [ii, dominant, tonicChord] },
      { name: 'Direct tonic', character: 'hard cut to new home', chords: [tonicChord] },
      { name: 'Plagal into new key', character: 'soft land', chords: [subdom, tonicChord] },
      { name: 'Tritone into new key', character: 'dark surprise', chords: [bII7, tonicChord] },
    ];

    return routes.slice(0, count).map((r, i) => ({
      id: `into-${i}`,
      name: r.name,
      character: r.character,
      targetLabel: music.noteName(t) + ' ' + (music.MODES[toMode] || {}).name,
      chords: r.chords.map((c, j) =>
        music.withDuration(
          { ...c, notes: c.notes.slice(), localTonic: t, localMode: toMode },
          j === r.chords.length - 1 ? 4 : 2
        )
      ),
    }));
  }

  // ─── Common tones helper for UI ──────────────────────────

  function voiceLeadingDetail(from, to) {
    const music = M();
    const a = music.voiceLead(from, null);
    const b = music.voiceLead(to, a);
    const fromPcs = new Set(chordTones(from));
    const toPcs = chordTones(to);
    const common = toPcs.filter((n) => fromPcs.has(n)).map((n) => music.noteName(n));
    const moving = toPcs.filter((n) => !fromPcs.has(n)).map((n) => music.noteName(n));
    return {
      common,
      moving,
      quality: music.voiceLeadingQuality(from, to),
      fromMidi: a,
      toMidi: b,
      bassFrom: music.noteName(effectiveBass(from)),
      bassTo: music.noteName(effectiveBass(to)),
      bassMotion: bassMotionLabel(bassInterval(from, to)),
    };
  }

  /**
   * Close alternate versions of a chord for map-drag snapping:
   * inversions / slash bass, quality family (m↔m7), and near-neighbour colours.
   */
  function closeAlternates(chord, tonic, modeKey, limit = 8) {
    const music = M();
    const t = music.pc(tonic);
    const out = [];
    const push = (ch, label) => {
      if (!ch) return;
      const k = ch.root + ':' + ch.quality + ':' + effectiveBass(ch);
      if (out.some((o) => o.key === k)) return;
      out.push({
        key: k,
        chord: ch,
        label: label || ch.name,
      });
    };

    // Inversions (same quality)
    const tones = chordTones(chord);
    tones.forEach((pc, i) => {
      const c = withBass(chord, pc);
      c.duration = chord.duration;
      c.roman = chord.roman;
      c.tag = chord.tag;
      c.region = chord.region;
      push(c, i === 0 ? c.name + ' root' : c.name);
    });

    // Quality family on same root
    const fam = {
      min: ['min', 'min7', 'min9', 'minmaj7'],
      maj: ['maj', 'maj7', 'add9', 'maj9'],
      dom7: ['dom7', 'maj', 'sus4'],
      halfdim: ['halfdim', 'dim', 'min7'],
    };
    let family = fam.min;
    if (chord.quality.startsWith('maj') || chord.quality === 'add9') family = fam.maj;
    else if (chord.quality === 'dom7' || chord.quality === 'sus4') family = fam.dom7;
    else if (chord.quality.includes('dim')) family = fam.halfdim;
    else if (chord.quality.includes('min')) family = fam.min;

    family.forEach((q) => {
      if (q === chord.quality) return;
      let c = music.makeChord(chord.root, q, {
        region: chord.region,
        roman: chord.roman,
        tag: 'alt',
        duration: chord.duration,
      });
      c = withBass(c, effectiveBass(chord));
      c.duration = chord.duration;
      push(c, c.name);
    });

    // Near colours: ±1–2 scale steps common dark moves
    const near = [
      { d: 0, q: chord.quality },
      { d: 5, q: 'min' },
      { d: 8, q: 'maj' },
      { d: 10, q: 'maj' },
      { d: 7, q: 'dom7' },
      { d: 1, q: 'dom7' },
    ];
    near.forEach((s) => {
      const root = (chord.root + s.d) % 12;
      // relative to tonic for roman-ish labels only
      let c = music.makeChord(root, s.q, {
        region: s.d === 1 ? 'tritone' : s.d === 8 || s.d === 10 ? 'interchange' : 'diatonic',
        tag: 'near',
        duration: chord.duration,
      });
      if (root === chord.root && s.q === chord.quality) return;
      push(c, c.name);
    });

    // Prefer ones close to original root
    out.sort((a, b) => {
      const da = Math.min(
        Math.abs(a.chord.root - chord.root),
        12 - Math.abs(a.chord.root - chord.root)
      );
      const db = Math.min(
        Math.abs(b.chord.root - chord.root),
        12 - Math.abs(b.chord.root - chord.root)
      );
      return da - db;
    });

    return out.slice(0, limit);
  }

  // Enhance cloneChord to keep bass
  const _origClone = M().cloneChord;
  M().cloneChord = function (c) {
    const n = _origClone.call(M(), c);
    n.bassPc = c.bassPc != null ? c.bassPc : c.root;
    n.inversion = c.inversion || 0;
    n.name = formatChordName(n);
    return n;
  };

  // Export on HLMusic and HLCompose
  const API = {
    GOALS,
    JOB_LABELS,
    formatChordName,
    withBass,
    withInversion,
    effectiveBass,
    bassInterval,
    bassMotionLabel,
    bassMotionScore,
    bestInversion,
    smoothCellVoicings,
    chordTension,
    tensionCurve,
    describeJob,
    suggestNext,
    suggestDirectionPaths,
    analyzeCell,
    varyOneChord,
    darkenChord,
    brightenChord,
    darkenProgression,
    brightenProgression,
    backdoorDominant,
    closerDominant,
    closerProgression,
    backdoorProgression,
    plantInnerSecondary,
    plantLastAs,
    pathSig,
    secondaryDominantOf,
    tritoneSubOf,
    diminishChord,
    varyRhythmOnly,
    seventhizeProgression,
    pedalProgression,
    reharmProgression,
    reharmBar,
    varySameBassNewUpper,
    structureABBA,
    loadTaste,
    saveTaste,
    acceptChord,
    rejectChord,
    noteGoalUse,
    voiceLeadingDetail,
    tasteKey,
    countExoticStreak,
    modulationTargets,
    adjacentKeys,
    establishHomeOptions,
    pivotChords,
    keysForPivotChord,
    parallelMinorFamily,
    waysIntoKey,
    suggestLoopJoins,
    closeAlternates,
  };

  Object.assign(global.HLMusic, API);
  global.HLCompose = API;
})(typeof window !== 'undefined' ? window : globalThis);
