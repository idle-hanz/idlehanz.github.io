/**
 * hl-map-bridge.js - map seats, aim, edge insert (attaches to HLApp)
 */
(function (global) {
  "use strict";
  var H = global.HLApp;
  if (!H) throw new Error("HLApp missing - load hl-core.js first");
H.chordFromChaseSeat = function (seat, key) {
    if (!seat) return null;
    const k = key || H.writeKey();
    const music = H.M();
    // True diatonic triads (I ii iii IV V vi vii°) — not V as G7 by default.
    // G7 and B° share B–D–F; forcing V7 made “the 5” and “the 7” sound alike.
    let q =
      music.seatDefaultQuality
        ? music.seatDefaultQuality(seat, k.mode)
        : (seat.qualities && seat.qualities[0]) || 'maj';
    if (seat.role === 'leading') {
      q = (seat.qualities && seat.qualities[0]) || (k.mode === 'major' ? 'dim' : 'dim');
    } else if (seat.role === 'supertonic' && /°/.test(String(seat.roman || ''))) {
      q = (seat.qualities && seat.qualities[0]) || 'dim';
    }
    const ch = music.makeChord(seat.root, q, {
      duration: H.stepDuration(),
      region: 'diatonic',
      roman: seat.roman || '',
      tag: 'chase',
    });
    return H.stampKey(ch, k);
  };

  /**
   * Neighbours for aim scoring at pathIndex.
   * - middle: prev + next
   * - building: last chord, loop off → only prev (open end / still writing)
   * - loop: last chord, loop on → next wraps to first chord
   * - start: first chord → next only (or loop from last if loop on)
   */
  H.aimNeighbors = function (pathIndex) {
    const chords = H.state.chords || [];
    const n = chords.length;
    if (!n || pathIndex < 0 || pathIndex >= n) {
      return { prev: null, next: null, mode: 'empty', home: null };
    }
    const home = H.makeHomeChord
      ? H.makeHomeChord()
      : H.M().makeChord(H.state.tonic, H.state.mode === 'major' ? 'maj' : 'min', {
          region: 'diatonic',
          roman: H.state.mode === 'major' ? 'I' : 'i',
        });
    const looping = !!H.state.loop && n >= 2;
    let prev = pathIndex > 0 ? chords[pathIndex - 1] : null;
    let next = pathIndex < n - 1 ? chords[pathIndex + 1] : null;
    let mode = 'middle';

    if (pathIndex === n - 1 && pathIndex === 0) {
      // single chord
      mode = looping ? 'loop' : 'building';
      prev = null;
      next = null;
    } else if (pathIndex === n - 1) {
      // last step
      if (looping) {
        next = chords[0];
        mode = 'loop';
      } else {
        next = null;
        mode = 'building';
      }
    } else if (pathIndex === 0) {
      mode = 'start';
      if (looping) prev = chords[n - 1]; // arrival from loop end
    }

    return { prev: prev, next: next, mode: mode, home: home, looping: looping };
  };

  /**
   * Scale-degree index 0–6 in the write-home (or given) key, or -1 if off-scale.
   * Major degrees: I ii iii IV V vi vii°  ·  minor: i ii° III iv v/V VI VII
   */
  H.scaleDegreeIndex = function (chord, tonic, modeKey) {
    if (!chord) return -1;
    const music = H.M();
    const t = music.pc ? music.pc(tonic) : ((tonic % 12) + 12) % 12;
    const root = music.pc ? music.pc(chord.root) : ((chord.root % 12) + 12) % 12;
    const mode = (music.MODES && music.MODES[modeKey]) || (music.MODES && music.MODES.major);
    const degrees = (mode && mode.degrees) || [0, 2, 4, 5, 7, 9, 11];
    const d = (root - t + 12) % 12;
    return degrees.indexOf(d);
  };

  /**
   * Functional strength of moving from → to inside a key (0–1).
   * Common-practice affinities so e.g. iii→vi ranks above iii→vii°.
   * Not a hard rule — colours aim pads / hover arrows so strong moves read clearly.
   */
  H.scoreDegreeProgression = function (from, to, tonic, modeKey) {
    if (!from || !to) return 0.4;
    const music = H.M();
    const t =
      tonic != null
        ? music.pc
          ? music.pc(tonic)
          : ((tonic % 12) + 12) % 12
        : music.pc
          ? music.pc(H.state.tonic)
          : H.state.tonic;
    const mode = modeKey || H.state.mode || 'major';
    const isMin =
      music.MODES && music.MODES[mode]
        ? music.MODES[mode].romanBase === 'minor'
        : mode === 'minor';

    const fi = H.scaleDegreeIndex(from, t, mode);
    const ti = H.scaleDegreeIndex(to, t, mode);

    // Off-scale / colour chords: modest baseline (secondaries handled elsewhere)
    if (fi < 0 || ti < 0) {
      const leap = Math.min(
        Math.abs(((from.root - to.root) % 12 + 12) % 12),
        12 - Math.abs(((from.root - to.root) % 12 + 12) % 12)
      );
      if (leap === 5 || leap === 7) return 0.55;
      if (leap <= 2) return 0.48;
      return 0.32;
    }
    if (fi === ti) return 0.12; // same seat / static

    // Rows = from degree, cols = to degree. Values ~ common-practice likelihood.
    // Indices: 0=I/i, 1=ii, 2=iii/III, 3=IV/iv, 4=V/v, 5=vi/VI, 6=vii/VII
    // Major-leaning matrix (works well for minor with small tweaks below)
    const MAJ = [
      // to:  I    ii   iii  IV   V    vi   vii
      /*I*/ [0.15, 0.72, 0.52, 0.9, 0.95, 0.82, 0.38],
      /*ii*/ [0.7, 0.15, 0.32, 0.55, 0.96, 0.48, 0.28],
      /*iii*/ [0.5, 0.42, 0.15, 0.72, 0.48, 0.92, 0.28], // vi >> vii
      /*IV*/ [0.9, 0.62, 0.35, 0.15, 0.94, 0.52, 0.3],
      /*V*/ [0.98, 0.35, 0.38, 0.48, 0.15, 0.72, 0.32],
      /*vi*/ [0.68, 0.88, 0.48, 0.82, 0.7, 0.15, 0.3],
      /*vii*/ [0.92, 0.28, 0.55, 0.32, 0.58, 0.28, 0.15],
    ];
    // Minor-leaning: i←V strong; III→VI; VI→ii/iv; VII→III; avoid weak dim piles
    const MIN = [
      /*i*/ [0.15, 0.55, 0.58, 0.88, 0.96, 0.78, 0.55],
      /*ii*/ [0.55, 0.15, 0.35, 0.5, 0.92, 0.42, 0.35],
      /*III*/ [0.48, 0.38, 0.15, 0.65, 0.45, 0.9, 0.55],
      /*iv*/ [0.88, 0.55, 0.4, 0.15, 0.92, 0.5, 0.35],
      /*v/V*/ [0.98, 0.32, 0.42, 0.5, 0.15, 0.68, 0.4],
      /*VI*/ [0.72, 0.75, 0.62, 0.85, 0.65, 0.15, 0.42],
      /*VII*/ [0.7, 0.3, 0.78, 0.4, 0.55, 0.38, 0.15],
    ];
    const Mtx = isMin ? MIN : MAJ;
    let s = Mtx[fi][ti];

    // Descending fifth / ascending fourth (root motion −7 / +5): classic strong pull
    const rootLeap = ((to.root - from.root) % 12 + 12) % 12;
    if (rootLeap === 5 || rootLeap === 7) s = Math.min(1, s + 0.08);
    // Descending third (e.g. iii→I, vi→IV, V→iii): common fall
    if (rootLeap === 9 || rootLeap === 8) s = Math.min(1, s + 0.04);
    // Dom7 / V-family resolving up a 4th
    if (
      (from.quality === 'dom7' || (fi === 4 && /dom|maj|7/.test(String(from.quality || '')))) &&
      rootLeap === 5
    ) {
      s = Math.min(1, s + 0.12);
    }
    // Leading-tone / dim resolving to tonic
    if (fi === 6 && ti === 0) s = Math.min(1, s + 0.06);
    // Two unstable seats in a row (vii° and ii°) — keep available but soft
    if ((fi === 6 || fi === 1) && (ti === 6 || ti === 1) && fi !== ti) {
      s = Math.max(0.15, s - 0.12);
    }
    return Math.max(0.08, Math.min(1, s));
  };

  /**
   * How well target sits between prev and next.
   * Blend: functional degree motion (primary) + voice-leading + cadence cues.
   * mode: middle | building | loop | start — changes weights for last-chord cases.
   */
  H.scoreAimContext = function (prev, target, next, opts) {
    opts = opts || {};
    if (!target) return 0;
    const music = H.M();
    const mode = opts.mode || (next && prev ? 'middle' : next ? 'start' : prev ? 'building' : 'solo');
    const home = opts.home || null;
    const tonic =
      (home && home.root != null
        ? home.root
        : opts.tonic != null
          ? opts.tonic
          : H.state.tonic);
    const modeKey = opts.modeKey || (home && home.localMode) || H.state.mode || 'major';
    const pcDist = (a, b) => {
      const d = Math.abs(((a - b) % 12 + 12) % 12);
      return Math.min(d, 12 - d);
    };
    // Lower baseline so degree affinity can spread the field
    let score = 0.18;

    const join = (a, b, w) => {
      if (!a || !b || !(w > 0)) return;
      // Functional strength carries most of the weight inside the key
      const deg = H.scoreDegreeProgression(a, b, tonic, modeKey);
      score += deg * 0.72 * w;
      const vl = music.voiceLeadingQuality ? music.voiceLeadingQuality(a, b) : 0.55;
      score += (vl != null ? vl : 0.55) * 0.28 * w;
      const leap = pcDist(a.root, b.root);
      if (leap === 0) score -= 0.2 * w;
      else if (leap === 1 || leap === 2) score += 0.06 * w;
      else if (leap === 5 || leap === 7) score += 0.05 * w;
      else if (leap >= 6) score -= 0.04 * w;
      if (a.quality === 'dom7' && ((a.root + 5) % 12) === b.root) score += 0.22 * w;
    };

    if (mode === 'building') {
      // Open end — still writing: leave-from-prev is the story
      // If no prev (solo / first), use the chord being aimed as functional “from”
      // so iii→vi still ranks above iii→vii° when you drag that step.
      const fromChord = prev || opts.origin || null;
      join(fromChord, target, 1.15);
      const reg = target.region || '';
      if (reg === 'diatonic') score += 0.08;
      else if (reg === 'secondary') score += 0.06;
      else if (reg === 'interchange') score += 0.04;
      // Strong continuation gestures toward home / cadence setup
      if (home) {
        if (target.root === home.root && (target.quality === home.quality || !home.quality)) {
          score += 0.16; // land home
        }
        if (target.quality === 'dom7' && ((target.root + 5) % 12) === home.root) {
          score += 0.2; // V7 of home — classic open-end setup
        }
      }
      // Dim / half-dim pivots (e.g. C#° in Bm): half-step resolve + home pull
      if (fromChord && fromChord.quality && /dim/.test(String(fromChord.quality))) {
        const up = (fromChord.root + 1) % 12;
        const down = (fromChord.root + 11) % 12;
        if (target.root === up || target.root === down) score += 0.18;
        if (home && target.root === home.root) score += 0.14;
        if (home && target.quality === 'dom7' && ((target.root + 5) % 12) === home.root) {
          score += 0.1;
        }
      }
      if (fromChord && fromChord.quality === 'dom7' && ((fromChord.root + 5) % 12) === target.root) {
        score += 0.18;
      }
      if (fromChord && target.notes && target.notes.length) {
        const tones = target.notes.map((n) => ((n % 12) + 12) % 12);
        if (tones.indexOf(((fromChord.root % 12) + 12) % 12) >= 0) score += 0.05;
      }
    } else if (mode === 'loop') {
      join(prev, target, 0.5);
      join(target, next, 0.75);
      if (next && target.quality === 'dom7' && ((target.root + 5) % 12) === next.root) {
        score += 0.22;
      }
      if (next && target.root === next.root) score -= 0.12;
    } else if (mode === 'start') {
      // First step: how well target leads into next; degree from origin if replacing
      if (opts.origin) join(opts.origin, target, 0.35);
      join(prev, target, prev ? 0.35 : 0);
      join(target, next, 1.0);
    } else {
      // Middle: sandwich fit + light “from this step’s degree” so in-key ranking
      // still reflects common moves (e.g. replacing iii, vi is stronger than vii°)
      join(prev, target, 0.5);
      join(target, next, 0.5);
      if (opts.origin) join(opts.origin, target, 0.45);
    }

    const reg = target.region || '';
    if (mode !== 'building') {
      if (reg === 'diatonic') score += 0.06;
      else if (reg === 'secondary') score += 0.04;
      else if (reg === 'interchange') score += 0.03;
      else if (reg === 'tritone' || reg === 'chromatic') score -= 0.05;
    }

    if (next && target.quality === 'dom7' && ((target.root + 5) % 12) === next.root) {
      score += 0.1;
    }
    if (prev && prev.quality === 'dom7' && ((prev.root + 5) % 12) === target.root) {
      score += 0.14;
    }

    // Style lens: prefer destinations this style surfaces (goth → VI/III, jazz → ii/V…)
    if (H.styleNextBoost && target.roman) {
      score += H.styleNextBoost(target.roman) || 0;
    }
    if (H.styleColourWeight && target.tag) {
      const cw = H.styleColourWeight(target.tag);
      if (cw > 0.5) score += (cw - 0.5) * 0.2;
    }

    return score;
  };

  H.tierAimScore = function (score, mode) {
    // Absolute thresholds (used as fallback). Prefer assignRelativeAimTiers when
    // ranking a full set of same-key seats so one clear winner isn't flattened.
    if (mode === 'building') {
      if (score >= 0.78) return 'good';
      if (score >= 0.48) return 'ok';
      return 'weak';
    }
    if (score >= 0.85) return 'good';
    if (score >= 0.52) return 'ok';
    return 'weak';
  };

  /**
   * Spread good / ok / weak across a scored list so strong degree moves
   * (iii→vi) read clearly stronger than weak ones (iii→vii°).
   */
  H.assignRelativeAimTiers = function (list) {
    if (!list || !list.length) return list;
    const sorted = list.slice().sort((a, b) => (b.score || 0) - (a.score || 0));
    const n = sorted.length;
    if (n === 1) {
      sorted[0].tier = 'good';
      return list;
    }
    const best = sorted[0].score || 0;
    const worst = sorted[n - 1].score || 0;
    const span = Math.max(0.08, best - worst);
    sorted.forEach((item, i) => {
      const s = item.score || 0;
      const rel = (s - worst) / span; // 0..1 within this set
      // Top ~30% or near the best score → good; bottom ~30% → weak
      if (i === 0 || (rel >= 0.72 && i < Math.max(2, Math.ceil(n * 0.35)))) {
        item.tier = 'good';
      } else if (rel <= 0.32 || i >= n - Math.max(1, Math.floor(n * 0.3))) {
        item.tier = 'weak';
      } else {
        item.tier = 'ok';
      }
      // Absolute floor/ceiling so a lonely high score still glows green
      if (s >= best - 0.04 && s >= 0.55) item.tier = 'good';
      if (s <= worst + 0.03 && s < best - 0.12) item.tier = 'weak';
    });
    return list;
  };

  /**
   * Drag targets for map pull-to-swap.
   * Chase view: scale seats + tension shells (path lands on Chase layout).
   * Function view: only neighbourhood chart seats at their exact chart positions
   * (Chase alts next to Function nodes looked like double chords).
   * Each target is scored against prev/next path chords for aim guidance.
   */
  H.buildAimTargets = function (pathIndex, chord) {
    const list = [];
    const seen = new Set();
    const diskKey = H.keyOf(chord || H.state.chords[pathIndex]);
    const dur = (chord && chord.duration) || H.stepDuration();
    const nbr = H.aimNeighbors(pathIndex);
    const prev = nbr.prev;
    const next = nbr.next;
    const aimMode = nbr.mode;

    const add = (ch, label, role, extra) => {
      if (!ch) return;
      const k = ch.root + ':' + ch.quality;
      if (seen.has(k)) return;
      if (chord && ch.root === chord.root && ch.quality === chord.quality) return;
      seen.add(k);
      const music = H.M();
      ch = music.cloneChord
        ? music.cloneChord(ch)
        : { ...ch, notes: (ch.notes || []).slice() };
      ch.duration = dur;
      // Map seats are root-position functional picks — strip slash bass from chart nodes
      ch.bassPc = ch.root;
      if (H.C().withBass) ch = H.C().withBass(ch, ch.root);
      else if (ch.name && String(ch.name).indexOf('/') >= 0) {
        ch.name = String(ch.name).split('/')[0];
      }
      H.stampKey(ch, diskKey);
      const score = H.scoreAimContext(prev, ch, next, {
        mode: aimMode,
        home: nbr.home,
        tonic: diskKey.tonic,
        modeKey: diskKey.mode,
        // Chord being replaced — used as “from” when prev is missing (open end / solo)
        origin: chord,
      });
      list.push(
        Object.assign(
          {
            chord: ch,
            label: label || ch.name,
            role: role || '',
            score: score,
            tier: H.tierAimScore(score, aimMode),
            aimMode: aimMode,
          },
          extra || {}
        )
      );
    };

    // Same-root colour variants (add9, maj7, maj9…) are inspector-only.
    // They used to sit as aim pads on top of the current node and stole micro-drags.
    const isSameRootColour = (ch) => {
      if (!chord || !ch || ch.root !== chord.root) return false;
      if (ch.quality === chord.quality) return true;
      if (
        H.M().qualityFamily &&
        H.M().qualityFamily(ch.quality) === H.M().qualityFamily(chord.quality)
      ) {
        return true;
      }
      return false;
    };

    // Function view: snap only to chart seats (diatonic, V7s, borrow)
    if (
      H.map &&
      H.map.mapView === 'function' &&
      H.map.functionNodes &&
      H.map.functionNodes.length
    ) {
      H.map.functionNodes.forEach((fn) => {
        if (!fn.chord) return;
        if (isSameRootColour(fn.chord)) return;
        add(fn.chord, fn.label || fn.chord.name, fn.roman || fn.role || '', {
          functionNodeId: fn.id,
          _fnX: fn.x,
          _fnY: fn.y,
        });
      });
      list.sort((a, b) => (b.score || 0) - (a.score || 0));
      if (H.assignRelativeAimTiers) H.assignRelativeAimTiers(list);
      return list;
    }

    // Chase: aim pads = one chord per scale seat (default quality only).
    // Leave-home: purple ghost click / Land here.
    const stampSeat = (ch, seat) => {
      if (!H.map || !H.map.scaleSeats) return {};
      const hit =
        H.map.scaleSeats.find(
          (s) =>
            s.activeDisk === true &&
            s.root === ch.root &&
            s.chord &&
            s.chord.quality === ch.quality
        ) ||
        H.map.scaleSeats.find((s) => s.activeDisk === true && s.root === ch.root);
      if (hit) return { _seatX: hit.x, _seatY: hit.y };
      if (seat && H.map._activeDisk) {
        const disk = H.map._activeDisk();
        const rad = seat.role === 'tonic' ? disk.R * 0.42 : disk.R * 0.72;
        return {
          _seatX: (disk.cx || 0) + Math.cos(seat.angle) * rad,
          _seatY: (disk.cy || 0) + Math.sin(seat.angle) * rad * 0.88,
        };
      }
      return {};
    };

    if (H.M().circularHarmonicScale) {
      H.M()
        .circularHarmonicScale(diskKey.tonic, diskKey.mode)
        .forEach((seat) => {
          const ch = H.chordFromChaseSeat(seat, diskKey);
          // No self / same-colour pad on the seat you're already on
          if (isSameRootColour(ch)) return;
          add(ch, ch.name, seat.roman, stampSeat(ch, seat));
        });
    }

    list.sort((a, b) => (b.score || 0) - (a.score || 0));
    // Relative tiers: strongest degree moves (e.g. iii→vi) glow; weak (iii→vii°) dim
    if (H.assignRelativeAimTiers) H.assignRelativeAimTiers(list);
    return list;
  };

  /**
   * Drop / From-here / ghost: plant a new-key package after the pivot.
   * Keeps the existing I–V–I–V (etc.) intact — does not replace the pivot chord.
   */
  H.leaveHomeToKey = function (dest, route, pivotIndex, opts) {
    opts = opts || {};
    if (!dest || !route || !route.length) return false;
    if (H.ensurePathOwned) H.ensurePathOwned();
    if (!opts.skipUndo) H.pushUndo();

    const pivotSel =
      pivotIndex != null && pivotIndex >= 0 && pivotIndex < H.state.chords.length
        ? pivotIndex
        : H.state.selected >= 0 && H.state.selected < H.state.chords.length
          ? H.state.selected
          : H.state.chords.length
            ? H.state.chords.length - 1
            : -1;

    H.setWritingHome(dest.tonic, dest.mode || H.state.mode, {
      transpose: false,
      skipEdit: true,
    });

    // plantEstablishRoute clones + stamps once
    const planted = H.plantEstablishRoute
      ? H.plantEstablishRoute(
          { tonic: dest.tonic, mode: dest.mode || H.state.mode },
          route,
          pivotSel
        )
      : null;

    H.afterEdit();
    const isMin =
      (dest.mode || H.state.mode) === 'minor' ||
      ((H.M().MODES[dest.mode || H.state.mode] || {}).romanBase === 'minor');
    H.setSyncStatus(
      'Left home → ' +
        H.M().noteName(dest.tonic) +
        (isMin ? 'm' : '') +
        (planted ? ' · ' + planted : '') +
        ' · earlier steps stay on their wheels'
    );
    return true;
  };

  /**
   * Right-click pivot into a new key.
   * establish:
   *   'none' | false | null — only change write home (+ restamp pivot). No new chords.
   *   'tonic'  — plant destination I/i after pivot
   *   'cadence' — plant V7→I after pivot
   *   array    — custom route
   * Default is 'none' so pivot does not force “straight home”.
   */
  H.pivotLeaveHome = function (dest, pivotIndex, establish) {
    if (!dest || dest.tonic == null) return false;
    const mode = dest.mode || H.state.mode;
    const music = H.M();
    const pivotSel =
      pivotIndex != null && pivotIndex >= 0 && pivotIndex < H.state.chords.length
        ? pivotIndex
        : H.state.selected >= 0 && H.state.selected < H.state.chords.length
          ? H.state.selected
          : H.state.chords.length
            ? H.state.chords.length - 1
            : -1;

    // Re-home only: no establish package (user can keep writing / drag freely)
    if (
      establish == null ||
      establish === false ||
      establish === 'none' ||
      establish === 'home-only'
    ) {
      if (H.ensurePathOwned) H.ensurePathOwned();
      H.pushUndo();
      H.setWritingHome(dest.tonic, mode, {
        transpose: false,
        skipEdit: true,
      });
      // Restamp pivot so it belongs to the new wheel (still the same notes)
      if (pivotSel >= 0 && H.state.chords[pivotSel]) {
        H.stampKey(H.state.chords[pivotSel], { tonic: dest.tonic, mode: mode });
        // Tag as pivot for clarity
        if (!H.state.chords[pivotSel].tag) H.state.chords[pivotSel].tag = 'pivot';
      }
      H.state.selected = pivotSel >= 0 ? pivotSel : H.state.selected;
      H.afterEdit();
      const roman = dest.romanInKey ? ' as ' + dest.romanInKey : '';
      H.setSyncStatus(
        'Write home → ' +
          (dest.name ||
            music.noteName(dest.tonic) +
              ' ' +
              ((music.MODES[mode] || {}).name || mode)) +
          roman +
          ' · no new chords · keep writing / drag to reorder'
      );
      return true;
    }

    const C = H.C && H.C();
    let route = null;
    if (Array.isArray(establish) && establish.length) {
      route = establish;
    } else if (C && C.establishHomeOptions) {
      const opts = C.establishHomeOptions(dest.tonic, mode);
      const want = establish === 'tonic' ? 'tonic' : 'cadence';
      const hit =
        opts.find(function (o) {
          return o.id === want;
        }) ||
        opts[0] ||
        opts[1];
      route = hit && hit.route ? hit.route : null;
    }
    if (!route || !route.length) {
      const isMin =
        mode === 'minor' || (music.MODES[mode] || {}).romanBase === 'minor';
      route = [
        music.makeChord(dest.tonic, isMin ? 'min' : 'maj', {
          region: 'diatonic',
          roman: isMin ? 'i' : 'I',
          tag: 'establish',
        }),
      ];
    }
    // Restamp pivot onto new key before planting establish package
    if (pivotSel >= 0 && H.state.chords[pivotSel]) {
      // leaveHomeToKey also setWritingHome; pre-stamp so pivot rides new disk
      H.stampKey(H.state.chords[pivotSel], { tonic: dest.tonic, mode: mode });
    }
    const ok = H.leaveHomeToKey(
      { tonic: dest.tonic, mode: mode },
      route,
      pivotSel,
      { skipUndo: false }
    );
    if (ok) {
      const roman = dest.romanInKey ? ' as ' + dest.romanInKey : '';
      H.setSyncStatus(
        'Pivot' +
          roman +
          ' → ' +
          (dest.name ||
            music.noteName(dest.tonic) +
              ' ' +
              ((music.MODES[mode] || {}).name || mode)) +
          ' · ' +
          (establish === 'tonic' ? 'landed tonic' : 'landed V7→I') +
          ' after step ' +
          (pivotSel + 1)
      );
    }
    return ok;
  };

  /**
   * Commit “establish home” on a Chase ghost adjacent-key wheel.
   * Writes V7→I or tonic into the path and switches write home to that key.
   * Existing path steps keep their disks — only the new package lands on the new wheel.
   * One undo frame covers home + package. End-of-path appends full lengths (no steal).
   */
  H.establishKeyFromGhost = function (opt) {
    if (!opt || !opt.ghostDisk) return;
    const g = opt.ghostDisk;
    const dest = { tonic: g.tonic, mode: g.mode || H.state.mode };
    const route = (opt.route || []).map((c) => {
      const x = H.M().cloneChord
        ? H.M().cloneChord(c)
        : { ...c, notes: (c.notes || []).slice() };
      x.duration = H.stepDuration();
      x.tag = x.tag || 'establish';
      H.stampKey(x, dest);
      return x;
    });
    if (!route.length) return;
    H.leaveHomeToKey(dest, route, H.state.selected, { skipUndo: false });
  };

  /**
   * Insert/append an establish route after pivotSel onto dest disk.
   * End of path → full stepDuration (grows cell). Mid-path → insert with steal.
   * Returns planted names or null.
   */
  H.plantEstablishRoute = function (dest, route, pivotSel) {
    if (!dest || !route || !route.length) return null;
    const music = H.M();
    const step = H.stepDuration();
    const pieces = route.map((c) => {
      const x = music.cloneChord
        ? music.cloneChord(c)
        : Object.assign({}, c, { notes: (c.notes || []).slice() });
      x.duration = step;
      x.tag = x.tag || 'establish';
      H.stampKey(x, { tonic: dest.tonic, mode: dest.mode });
      return x;
    });

    const atEnd =
      !H.state.chords.length ||
      pivotSel == null ||
      pivotSel < 0 ||
      pivotSel >= H.state.chords.length - 1;

    if (!H.state.chords.length || atEnd) {
      const fitted = pieces.map((p) => music.withDuration(p, step));
      if (!H.state.chords.length) {
        H.state.chords = fitted;
        H.state.selected = fitted.length - 1;
      } else {
        H.state.chords.push(...fitted);
        H.state.selected = H.state.chords.length - 1;
      }
    } else if (H.fitHorizonIntoSequence) {
      const fit = H.fitHorizonIntoSequence(pivotSel, pieces, 'insert');
      if (fit && fit.pieces && fit.pieces.length) {
        H.state.selected = fit.writeAt + fit.pieces.length - 1;
        for (let i = fit.writeAt; i < fit.writeAt + fit.pieces.length; i++) {
          if (H.state.chords[i]) H.stampKey(H.state.chords[i], dest);
        }
      }
    } else {
      H.state.chords.splice(
        pivotSel + 1,
        0,
        ...pieces.map((p) => music.withDuration(p, step))
      );
      H.state.selected = pivotSel + pieces.length;
    }
    return pieces.map((p) => p.name).join(' → ');
  };

  /**
   * Click a Chase seat: write that scale chord into the path.
   * Seat on inactive disk → write onto that disk and switch write home (no full-path retag).
   */
  H.selectChaseSeat = function (seatInfo, clickOpts) {
    if (!seatInfo) return;
    try {
      clickOpts = clickOpts || {};
      const disk = seatInfo.disk;
      const diskKey = disk
        ? { tonic: disk.tonic, mode: disk.mode || H.state.mode }
        : H.writeKey();
      const ch =
        seatInfo.chord ||
        H.chordFromChaseSeat(seatInfo.seat || seatInfo, diskKey);
      if (!ch) {
        H.setSyncStatus && H.setSyncStatus('Could not build chord for that seat');
        return;
      }
      ch.duration = H.stepDuration();
      H.stampKey(ch, diskKey);

      // Clicking another disk's seat switches gravity so From here / new steps match
      const switched =
        disk &&
        !disk.active &&
        (disk.tonic !== H.state.tonic || (disk.mode || H.state.mode) !== H.state.mode);

      // One undo for home switch + chord (commitHorizon skipUndo when we pre-push)
      if (switched) {
        H.pushUndo();
        H.setWritingHome(disk.tonic, disk.mode || H.state.mode, {
          transpose: false,
          skipEdit: true,
        });
      }

      if (H.A()) {
        H.A().ensure();
        H.A().playChord({ chord: ch, soft: true, duration: 0.4, identify: true });
      }
      // Seat write rules:
      //   mid-path selected → edit that step
      //   last step / empty → append (build forward)
      //   Shift → insert after selection
      //   Alt → force append at end
      let intent = 'auto';
      if (clickOpts.altKey) intent = 'append';
      else if (clickOpts.shiftKey) intent = 'insert';
      const job =
        (seatInfo.roman || seatInfo.role || 'scale') +
        ' seat' +
        (switched ? ' · write home → ' + H.keyLabelFor(diskKey) : '');
      if (H.writeChordToPath) {
        H.writeChordToPath(ch, {
          intent: intent,
          kind: 'direction',
          label: ch.name,
          job: job,
          skipUndo: switched,
        });
      } else {
        H.commitHorizon(
          { chord: ch, kind: 'direction', label: ch.name, job: job },
          { mode: 'append', skipUndo: switched }
        );
      }
    } catch (err) {
      console.error('selectChaseSeat failed', err);
      if (H.setSyncStatus) H.setSyncStatus('Add failed · ' + (err && err.message ? err.message : 'error'));
    }
  };

  /**
   * Pick a bridge chord between a → b.
   * Scores diatonic (and light colour) candidates as a→?→b joins — root position,
   * no auto-inversion (map seats are functional picks the user can then drag).
   */
  H.bridgeChordBetween = function (a, b, duration) {
    const bridgeKey = H.keyOf(a);
    const music = H.M();
    const mid = H.circularBlendRoot(a.root, b.root, 0.5);
    const cands = [];
    const seen = new Set();
    const pushCand = (root, quality, roman, region) => {
      const k = root + ':' + quality;
      if (seen.has(k)) return;
      if (a && root === a.root && quality === a.quality) return;
      if (b && root === b.root && quality === b.quality) return;
      seen.add(k);
      let ch = music.makeChord(root, quality, {
        duration: duration,
        region: region || 'diatonic',
        tag: 'insert',
        roman: roman || '',
      });
      // Always root position for edge inserts
      if (H.C().withBass) ch = H.C().withBass(ch, ch.root);
      else ch.bassPc = ch.root;
      H.stampKey(ch, bridgeKey);
      const score = H.scoreAimContext
        ? H.scoreAimContext(a, ch, b, { mode: 'middle' })
        : 0.5 - H.pcDist(root, mid) * 0.05;
      // Prefer seats near circular mid between a and b
      const midBias = 0.08 * (3 - Math.min(3, H.pcDist(root, mid)));
      cands.push({ ch: ch, score: score + midBias });
    };

    if (music.circularHarmonicScale) {
      music.circularHarmonicScale(bridgeKey.tonic, bridgeKey.mode).forEach((s) => {
        let q = (s.qualities && s.qualities[0]) || 'maj';
        if (s.role === 'dom') q = 'dom7';
        pushCand(s.root, q, s.roman || '', 'diatonic');
      });
    }
    // A couple of common bridges if scale is thin
    [
      { d: 5, q: 'maj', roman: 'IV', region: 'diatonic' },
      { d: 7, q: 'dom7', roman: 'V7', region: 'diatonic' },
      { d: 2, q: bridgeKey.mode === 'major' ? 'min' : 'dim', roman: 'ii', region: 'diatonic' },
    ].forEach((s) => {
      pushCand((bridgeKey.tonic + s.d) % 12, s.q, s.roman, s.region);
    });

    cands.sort((x, y) => y.score - x.score);
    if (cands.length) {
      const best = cands[0].ch;
      best.duration = duration;
      best.tag = 'insert';
      return best;
    }

    // Fallback: mid root diatonic triad
    let root = mid;
    let quality = bridgeKey.mode === 'major' ? 'maj' : 'min';
    let ch = music.makeChord(root, quality, {
      duration: duration,
      region: 'diatonic',
      tag: 'insert',
      roman: '→',
    });
    if (H.C().withBass) ch = H.C().withBass(ch, ch.root);
    return H.stampKey(ch, bridgeKey);
  }

  /**
   * Plan how many beats to steal from each neighbor for an edge insert.
   * Returns null if neighbors are too short. Never leaves a side below 0.5.
   */
  H.planEdgeInsertBeats = function (da, db) {
    da = da || 4;
    db = db || 4;
    if (da + db < 2) return null;

    let takeA = 0;
    let takeB = 0;
    let insertDur = 2;

    if (da >= 3 && db >= 3) {
      takeA = 1;
      takeB = 1;
      insertDur = 2;
    } else if (da >= 2.5 && db >= 1.5) {
      takeA = 1;
      takeB = 0.5;
      insertDur = 1.5;
    } else if (da >= 2) {
      takeA = Math.min(1.5, Math.max(0.5, H.snapBeats(da - 1)));
      insertDur = takeA;
    } else if (db >= 2) {
      takeB = Math.min(1.5, Math.max(0.5, H.snapBeats(db - 1)));
      insertDur = takeB;
    } else if (da > 1 && db > 1) {
      takeA = 0.5;
      takeB = 0.5;
      insertDur = 1;
    } else if (da > 0.5) {
      takeA = 0.5;
      insertDur = 0.5;
    } else if (db > 0.5) {
      takeB = 0.5;
      insertDur = 0.5;
    } else {
      return null;
    }

    // Floor neighbors at 0.5
    if (da - takeA < 0.5) takeA = Math.max(0, da - 0.5);
    if (db - takeB < 0.5) takeB = Math.max(0, db - 0.5);
    insertDur = Math.max(0.5, H.snapBeats(takeA + takeB));
    if (insertDur < 0.5 || takeA + takeB < 0.5) return null;

    return {
      takeA,
      takeB,
      insertDur,
      leftDur: Math.max(0.5, H.snapBeats(da - takeA)),
      rightDur: Math.max(0.5, H.snapBeats(db - takeB)),
    };
  }

  /**
   * Insert between two chords without lengthening the cell.
   * Map edge click → this. Returns the new path index, or null on failure.
   * Caller may enter aim-mode on that index so the user can drag to a seat.
   */
  H.insertBetweenWithTiming = function (afterIndex) {
    const a = H.state.chords[afterIndex];
    const b = H.state.chords[afterIndex + 1];
    if (!a || !b) {
      H.setSyncStatus('Edge insert needs two steps — click the line between them');
      return null;
    }

    const plan = H.planEdgeInsertBeats(a.duration || 4, b.duration || 4);
    if (!plan) {
      H.setSyncStatus('Neighbors too short to insert (need ≥ 2 beats combined)');
      return null;
    }

    H.pushUndo();
    const ch = H.bridgeChordBetween(a, b, plan.insertDur);
    H.state.chords[afterIndex] = H.M().withDuration(a, plan.leftDur);
    H.state.chords[afterIndex + 1] = H.M().withDuration(b, plan.rightDur);
    H.state.chords.splice(afterIndex + 1, 0, ch);
    H.state.selected = afterIndex + 1;
    H.state.fromPackId = null;
    H.afterEdit();
    H.A().ensure();
    H.A().playChord({ chord: ch });
    const total = H.state.chords.reduce((s, c) => s + (c.duration || 0), 0);
    H.setSyncStatus(
      'New step · ' +
        ch.name +
        ' between ' +
        a.name +
        ' → ' +
        b.name +
        ' · ' +
        plan.insertDur +
        'b · drag it onto a seat to change · total ' +
        total +
        'b'
    );
    return afterIndex + 1;
  }

  /**
   * Split a time-strip step into two equal(ish) halves.
   * Total cell length is unchanged — only this step is bisected.
   */
  H.splitChordAt = function (index) {
    if (index < 0 || index >= H.state.chords.length) return;
    const src = H.state.chords[index];
    const d = src.duration || 4;
    if (d < 1) {
      H.setSyncStatus('Too short to split (need ≥ 1 beat)');
      return;
    }
    H.pushUndo();
    // Half-beat grid: e.g. 4 → 2+2, 3 → 1.5+1.5, 5 → 2.5+2.5
    const d1 = H.snapBeats(d / 2);
    // Remainder on second half so total length is unchanged
    const d2 = Math.max(0.5, H.snapBeats(d - d1));
    H.state.chords[index] = H.M().withDuration(src, d1);
    let ch = H.M().cloneChord(src);
    ch.duration = d2;
    ch.tag = 'split';
    H.state.chords.splice(index + 1, 0, ch);
    H.state.selected = index + 1;
    H.state.fromPackId = null;
    H.afterEdit();
    H.A().ensure();
    H.A().playChord({ chord: ch, soft: true, duration: 0.4 });
    const total = H.state.chords.reduce((s, c) => s + (c.duration || 0), 0);
    H.setSyncStatus('Split step ' + (index + 1) + ' · ' + d1 + 'b + ' + d2 + 'b · total still ' + total + 'b');
  }

  H.circularBlendRoot = function (a, b, t) {
    // shortest arc blend on pitch-class circle
    let d = ((H.pcNorm(b) - H.pcNorm(a) + 12) % 12);
    if (d > 6) d -= 12;
    return H.pcNorm(H.pcNorm(a) + Math.round(d * t));
  }

  H.applyChordAtIndex = function (pathIndex, newChord, opts) {
    opts = opts || {};
    if (pathIndex < 0 || pathIndex >= H.state.chords.length) return;
    if (!opts.skipUndo) H.pushUndo();
    const prev = H.state.chords[pathIndex];
    // Prefer key already on newChord (aim targets stamp disk), else keep slot's disk
    const ownKey =
      newChord && newChord.localTonic != null
        ? { tonic: newChord.localTonic, mode: newChord.localMode || H.state.mode }
        : H.keyOf(prev);
    let ch = H.M().cloneChord(newChord);
    ch.duration = prev.duration != null ? prev.duration : 4;
    ch.tag = ch.tag || 'pulled';
    // Map drag chooses a functional seat — root position (no auto-inversion spam)
    if (H.C().withBass) {
      ch = H.C().withBass(ch, ch.root);
      ch.duration = prev.duration != null ? prev.duration : 4;
      ch.tag = ch.tag || 'pulled';
    } else {
      ch.bassPc = ch.root;
      if (ch.name && String(ch.name).indexOf('/') >= 0) {
        ch.name = String(ch.name).split('/')[0];
      }
    }
    if (opts.job) ch.tag = opts.job;
    if (newChord.roman) ch.roman = newChord.roman;
    else if (H.romanForChordInKey) {
      ch.roman = H.romanForChordInKey(ch, ownKey) || ch.roman || '';
    }
    H.stampKey(ch, ownKey);
    H.state.chords[pathIndex] = ch;
    H.state.selected = pathIndex;
    H.state.fromPackId = null;
    if (H.map) H.map._mode = null;
    H.afterEdit();
    if (H.A()) {
      H.A().ensure();
      H.A().playChord({ chord: H.state.chords[pathIndex] });
    }
    if (!opts.silent) {
      H.setSyncStatus(
        'Edited step ' +
          (pathIndex + 1) +
          ' · ' +
          (ch.name || '') +
          (opts.job ? ' · ' + opts.job : '')
      );
    }
  };

  /**
   * Write a chord into the path with clear edit vs append rules.
   *
   * intent:
   *   'edit'   — replace pathIndex / selected (timeline / path menu colours)
   *   'append' — always grow at end
   *   'insert' — insert after pathIndex / selected
   *   'auto'   — mid-path selection → edit; last step or empty → append
   *              (building forward). Shift from map → insert.
   */
  H.writeChordToPath = function (chord, opts) {
    opts = opts || {};
    if (!chord) return null;
    const n = (H.state.chords || []).length;
    let idx =
      opts.pathIndex != null && opts.pathIndex >= 0
        ? opts.pathIndex
        : H.state.selected;
    if (idx == null || idx < 0 || idx >= n) {
      idx = n > 0 ? n - 1 : -1;
    }
    let intent = opts.intent || 'auto';

    if (n === 0) intent = 'append';
    else if (intent === 'auto') {
      // Continue writing from the end; change a middle step in place
      intent = idx >= 0 && idx < n - 1 ? 'edit' : 'append';
    }

    if (intent === 'edit' && idx >= 0 && idx < n) {
      H.applyChordAtIndex(idx, chord, {
        skipUndo: opts.skipUndo,
        job: opts.job,
        silent: opts.silent,
      });
      return 'edit';
    }

    if (intent === 'insert' && idx >= 0 && idx < n) {
      H.state.selected = idx;
      H.commitHorizon(
        {
          chord: chord,
          kind: opts.kind || 'direction',
          label: opts.label || chord.name || '',
          job: opts.job || 'insert',
          route: opts.route,
        },
        {
          mode: idx >= n - 1 ? 'append' : 'insert',
          skipUndo: opts.skipUndo,
        }
      );
      return idx >= n - 1 ? 'append' : 'insert';
    }

    // append (default grow)
    H.commitHorizon(
      {
        chord: chord,
        kind: opts.kind || 'direction',
        label: opts.label || chord.name || '',
        job: opts.job || 'append',
        route: opts.route,
      },
      { mode: 'append', skipUndo: opts.skipUndo }
    );
    return 'append';
  };

  H.setDefaultDuration = function (beats, opts) {
    opts = opts || {};
    H.state.defaultDuration = H.snapBeats(beats);
    if (H.syncDurationBar) H.syncDurationBar();
    if (!opts.silent) {
      H.setSyncStatus(
        'Default for new chords · ' + H.state.defaultDuration + ' beats each'
      );
    }
  };

  /** Refresh default / multi-select duration chip UI */
  H.syncDurationBar = function () {
    const def = H.state.defaultDuration != null ? H.state.defaultDuration : 4;
    const multi = H.getSelectedIndices ? H.getSelectedIndices() : [];
    const multiOn = multi.length > 1;
    const host = H.$('#step-dur');
    if (host) {
      host.querySelectorAll('[data-step-dur]').forEach((b) => {
        const v = parseFloat(b.dataset.stepDur);
        // When multi-select: highlight chips matching common duration if any
        if (multiOn) {
          const durs = multi.map((i) => H.state.chords[i] && H.state.chords[i].duration);
          const same = durs.length && durs.every((d) => d === durs[0]);
          b.classList.toggle('active', same && Number(durs[0]) === v);
        } else {
          b.classList.toggle('active', v === def);
        }
      });
      const custom = host.querySelector('#step-dur-num');
      if (custom && document.activeElement !== custom) {
        if (multiOn) {
          const durs = multi.map((i) => H.state.chords[i] && H.state.chords[i].duration);
          const same = durs.length && durs.every((d) => d === durs[0]);
          custom.value = same ? String(durs[0]) : '';
          custom.placeholder = multi.length + ' sel';
        } else {
          custom.value = String(def);
          custom.placeholder = '';
        }
      }
      const modeEl = host.querySelector('#dur-mode-label');
      if (modeEl) {
        modeEl.textContent = multiOn
          ? multi.length + ' selected · set length'
          : 'Default for new chords';
      }
      host.classList.toggle('multi-sel', multiOn);
    }
    const selBar = H.$('#sel-dur');
    if (selBar) {
      selBar.hidden = !multiOn && !(multi.length === 1);
      const lab = selBar.querySelector('#sel-dur-label');
      if (lab) {
        lab.textContent =
          multi.length > 1
            ? multi.length + ' steps selected'
            : multi.length === 1
              ? 'Step ' + (multi[0] + 1)
              : '';
      }
    }
  };

  H.makeEnteredChord = function (root, q) {
    const dur = H.stepDuration();
    let ch = H.M().makeChord(root, q, {
      duration: dur,
      region: 'diatonic',
      tag: 'entered',
    });
    const prev =
      H.state.selected >= 0 && H.state.chords[H.state.selected]
        ? H.state.chords[H.state.selected]
        : H.state.chords[H.state.chords.length - 1];
    if (prev && H.C().bestInversion) {
      ch = H.C().bestInversion(prev, ch);
      ch.duration = dur;
      ch.tag = 'entered';
    }
    // Picker always writes onto current write-home disk
    H.stampKey(ch, H.writeKey());
    return ch;
  }

  H.addChordFromPicker = function (insertMode) {
    H.pushUndo();
    const root = parseInt(H.$('#add-root').value, 10);
    const q = H.$('#add-quality').value;
    const ch = H.makeEnteredChord(root, q);
    if (insertMode === 'before' && H.state.selected >= 0) {
      H.state.chords.splice(H.state.selected, 0, ch);
    } else if (insertMode === 'after' && H.state.selected >= 0) {
      H.state.chords.splice(H.state.selected + 1, 0, ch);
      H.state.selected += 1;
    } else {
      H.state.chords.push(ch);
      H.state.selected = H.state.chords.length - 1;
    }
    H.state.fromPackId = null;
    H.afterEdit(); // clears aim mode + refreshMap/setPath once
    H.A().ensure();
    H.A().playChord({ chord: ch });
    H.setSyncStatus(
      'Added ' +
        (ch.name || '') +
        ' · ' +
        (ch.duration || H.stepDuration()) +
        'b · step ' +
        (H.state.selected + 1)
    );
  }

  H.duplicateSelected = function () {
    if (H.state.selected < 0 || !H.state.chords[H.state.selected]) return;
    H.pushUndo();
    const copy = H.M().cloneChord(H.state.chords[H.state.selected]);
    copy.duration = H.state.chords[H.state.selected].duration;
    H.state.chords.splice(H.state.selected + 1, 0, copy);
    H.state.selected += 1;
    H.state.fromPackId = null;
    H.afterEdit();
  }

  H.moveSelected = function (delta) {
    const i = H.state.selected;
    const j = i + delta;
    if (i < 0 || j < 0 || j >= H.state.chords.length) return;
    H.pushUndo();
    const t = H.state.chords[i];
    H.state.chords[i] = H.state.chords[j];
    H.state.chords[j] = t;
    H.state.selected = j;
    H.state.fromPackId = null;
    H.afterEdit();
  }

  H.reorderChord = function (from, to) {
    if (from === to || from < 0 || to < 0 || from >= H.state.chords.length || to >= H.state.chords.length) return;
    H.pushUndo();
    const [item] = H.state.chords.splice(from, 1);
    H.state.chords.splice(to, 0, item);
    H.state.selected = to;
    H.state.fromPackId = null;
    H.afterEdit();
  }

  H.afterEdit = function () {
    // Preserve camera across this refresh (aim commit / inspector edit)
    if (H.map) {
      H.map._freezeCamera = true;
      H.map._keepCameraOnce = true;
    }
    // Single map lifecycle: clear aim → refresh sequence/map/strip once
    if (H.map && H.map.clearInteraction) H.map.clearInteraction();
    if (H.clearNextPreview) H.clearNextPreview();
    H.recognize({ preserveName: H.state.nameLocked });
    H.refreshAll();
    // Unfreeze after layout has run under freeze
    if (H.map) {
      const m = H.map;
      setTimeout(() => {
        m._freezeCamera = false;
        m._keepCameraOnce = false;
      }, 0);
    }
    if (H.S() && H.state.chords.length) {
      try {
        H.pushToSharedSession('landscape');
      } catch (_) {}
    }
    H.refreshAltPath();
    if (H.updateUndoButtons) H.updateUndoButtons();
    if (H.updateEmptyStart) H.updateEmptyStart();
    if (H.updateCoach) H.updateCoach();
    if (H.renderPlaceReadout) H.renderPlaceReadout();
    // Path may have grown/shrunk/changed under a running loop — keep place
    if (H.A() && H.A().isPlaying && H.A().isPlaying() && H.resyncPlaybackPreservingPlace) {
      H.resyncPlaybackPreservingPlace({ resetFrom: true });
    }
  };

  /**
   * Blue compare is EXPLICIT only (Alt-click a version chip, or after forking).
   * Never auto-pick v1 / siblings — that left blue lines on screen while editing
   * v1 and felt like a bug.
   */
})(typeof window !== "undefined" ? window : globalThis);
