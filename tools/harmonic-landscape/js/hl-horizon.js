/**
 * hl-horizon.js - from-here horizon (attaches to HLApp)
 */
(function (global) {
  "use strict";
  var H = global.HLApp;
  if (!H) throw new Error("HLApp missing - load hl-core.js first");
H.fitHorizonIntoSequence = function (sel, rawPieces, mode) {
    const pieces = rawPieces.map((p) => {
      const c = H.M().cloneChord(p);
      // Keep package ownership if set (seat on other disk); else write-home disk
      if (c.localTonic == null) H.stampKey(c, H.writeKey());
      else H.stampKey(c, { tonic: c.localTonic, mode: c.localMode || H.state.mode });
      return c;
    });
    const totalBefore = H.beatSum(H.state.chords);
    const n = pieces.length;
    if (!n) return null;
    const step = H.stepDuration();

    let writeAt = Math.max(0, sel + 1);

    if (mode === 'insert') {
      // Steal budget from prev (sel) and next (sel+1), like H.map-edge insert
      const needHint = Math.min(step * n, Math.max(step, n * 1.5));
      let takePrev = 0;
      let takeNext = 0;
      const prev = H.state.chords[sel];
      const next = H.state.chords[sel + 1];
      const dp = prev ? prev.duration || step : 0;
      const dn = next ? next.duration || step : 0;
      if (prev && next && dp >= 2 && dn >= 2) {
        takePrev = Math.min(needHint / 2, dp - 0.5);
        takeNext = Math.min(needHint - takePrev, dn - 0.5);
      } else if (prev && dp > 1) {
        takePrev = Math.min(needHint, dp - 0.5);
      } else if (next && dn > 1) {
        takeNext = Math.min(needHint, dn - 0.5);
      } else if (prev) {
        takePrev = Math.min(0.5, Math.max(0, dp - 0.5));
      }
      let budget = H.snapBeats(takePrev + takeNext);
      if (budget < 0.5 * n) {
        const rich = dp >= dn ? 'prev' : 'next';
        if (rich === 'prev' && prev && dp - takePrev > 0.5) {
          takePrev = Math.min(dp - 0.5, takePrev + (0.5 * n - budget));
        } else if (next && dn - takeNext > 0.5) {
          takeNext = Math.min(dn - 0.5, takeNext + (0.5 * n - budget));
        }
        budget = Math.max(0.5 * n, H.snapBeats(takePrev + takeNext));
      }
      if (prev && takePrev > 0) {
        H.state.chords[sel] = H.M().withDuration(prev, Math.max(0.5, H.snapBeats(dp - takePrev)));
      }
      if (next && takeNext > 0) {
        H.state.chords[sel + 1] = H.M().withDuration(next, Math.max(0.5, H.snapBeats(dn - takeNext)));
      }
      const durs = H.splitBudget(Math.max(0.5 * n, takePrev + takeNext), n);
      const fitted = pieces.map((p, i) => H.M().withDuration(p, durs[i]));
      writeAt = sel + 1;
      H.state.chords.splice(writeAt, 0, ...fitted);
      return {
        writeAt,
        pieces: fitted,
        mode: 'insert',
        totalBefore,
        totalAfter: H.beatSum(H.state.chords),
      };
    }

    // At end or empty: compose forward with full default lengths (do NOT steal)
    if (writeAt >= H.state.chords.length || !H.state.chords.length) {
      const fitted = pieces.map((p) => H.M().withDuration(p, step));
      if (!H.state.chords.length) {
        H.state.chords = fitted;
        return {
          writeAt: 0,
          pieces: fitted,
          mode: 'seed',
          totalBefore,
          totalAfter: H.beatSum(H.state.chords),
        };
      }
      writeAt = H.state.chords.length;
      H.state.chords.push(...fitted);
      return {
        writeAt,
        pieces: fitted,
        mode: 'append',
        totalBefore,
        totalAfter: H.beatSum(H.state.chords),
      };
    }

    // Mid-path: rewrite continuation — preserve total length of the span we replace
    const remaining = H.state.chords.length - writeAt;
    const spanCount = Math.min(Math.max(n, 1), remaining);
    let budget = 0;
    for (let i = 0; i < spanCount; i++) {
      budget += H.state.chords[writeAt + i].duration || step;
    }
    budget = Math.max(0.5 * n, budget);
    const durs = H.splitBudget(budget, n);
    const fitted = pieces.map((p, i) => H.M().withDuration(p, durs[i]));
    H.state.chords.splice(writeAt, spanCount, ...fitted);
    return {
      writeAt,
      pieces: fitted,
      mode: 'replace',
      totalBefore,
      totalAfter: H.beatSum(H.state.chords),
      spanCount,
    };
  }

  /**
   * Horizon pick = "where do I go from the selected chord?"
   * Always keeps total cell length (beats) stable by fitting into existing budget.
   * Shift-click = insert between (still steals from neighbors).
   */
  H.commitHorizon = function (item, opts) {
    opts = opts || {};
    H.pushUndo();

    const rawPieces = H.horizonPieces(item);
    if (!rawPieces.length) return;

    const sel =
      H.state.selected >= 0 && H.state.selected < H.state.chords.length
        ? H.state.selected
        : H.state.chords.length - 1;
    const hasNext = sel >= 0 && sel < H.state.chords.length - 1;

    let mode = opts.mode;
    if (!mode || mode === 'auto') {
      mode = opts.insert ? 'insert' : 'replace';
    }

    const beforeChord =
      sel >= 0 && H.state.chords[sel] ? H.M().cloneChord(H.state.chords[sel]) : null;

    // Snapshot chord after the rewrite zone for join audition (best-effort)
    let afterChordPre = null;
    if (mode === 'insert' && H.state.chords[sel + 1]) {
      afterChordPre = H.M().cloneChord(H.state.chords[sel + 1]);
    } else if (mode !== 'insert' && hasNext) {
      const peek = sel + 1 + rawPieces.length;
      if (H.state.chords[peek]) afterChordPre = H.M().cloneChord(H.state.chords[peek]);
      else if (H.state.chords[sel + 1 + 1]) afterChordPre = H.M().cloneChord(H.state.chords[sel + 2]);
    }

    const fit = H.fitHorizonIntoSequence(sel, rawPieces, mode);
    if (!fit) return;

    if (item.modulateTo) {
      const dest =
        H.M().noteName(item.modulateTo.tonic) +
        ' ' +
        (item.modulateTo.mode || 'minor');
      const ok = confirm(
        'Open a new Chase disk in ' +
          dest +
          '?\n\nOK = new write home (old key pattern stays on its disk)\nCancel = write chords only, keep current home'
      );
      if (ok) {
        // Don't retag whole path — only gravity + new chords; package just written uses new key below
        H.setWritingHome(item.modulateTo.tonic, item.modulateTo.mode || H.state.mode, {
          transpose: false,
          skipEdit: true,
        });
        // Tag the package we just wrote onto the new disk
        const start = fit.writeAt;
        const end = start + (fit.pieces ? fit.pieces.length : 0);
        for (let i = start; i < end; i++) {
          if (H.state.chords[i]) H.stampKey(H.state.chords[i], H.writeKey());
        }
      }
    }

    // New path steps inherit current write home unless already owned (seat on other disk)
    if (fit.pieces && fit.pieces.length) {
      for (let i = fit.writeAt; i < fit.writeAt + fit.pieces.length; i++) {
        if (H.state.chords[i] && H.state.chords[i].localTonic == null) {
          H.stampKey(H.state.chords[i], H.writeKey());
        }
      }
    }
    H.ensurePathOwned();

    H.state.selected = Math.min(
      fit.writeAt + fit.pieces.length - 1,
      H.state.chords.length - 1
    );
    H.state.fromPackId = null;

    // Ensure time strip rebuilds (clear any stuck resize lock)
    const strip = H.$('#time-strip');
    if (strip) {
      strip.dataset.resizing = '';
      strip.classList.remove('resizing-strip');
    }

    H.afterEdit();
    // Force strip + H.map again after session push
    H.renderTimeStrip();
    if (H.map) {
      H.map.setPath(H.state.chords, H.state.selected);
    }
    H.updateMapStatus();

    const afterIdx = fit.writeAt + fit.pieces.length;
    const afterChord =
      afterChordPre ||
      (afterIdx < H.state.chords.length ? H.state.chords[afterIdx] : null);
    H.A().ensure();
    H.auditionJoin(beforeChord, fit.pieces, afterChord);

    const labels = fit.pieces.map((p) => p.name).join(' → ');
    const durs = fit.pieces.map((p) => (p.duration || 0) + 'b').join('+');
    const lenNote =
      Math.abs((fit.totalAfter || 0) - (fit.totalBefore || 0)) < 0.05
        ? 'length kept ' + (fit.totalAfter || 0) + 'b'
        : 'length ' + (fit.totalBefore || 0) + 'b → ' + (fit.totalAfter || 0) + 'b';
    H.setSyncStatus(
      'From here · ' +
        labels +
        ' (' +
        durs +
        ') · ' +
        lenNote +
        (fit.mode === 'append' || fit.mode === 'seed'
          ? ' · step ' + H.stepDuration() + 'b'
          : '') +
        (item.job ? ' · ' + item.job : '')
    );
  }

  /** Build the chord(s) a horizon item would write (durations assigned later by fit). */
  H.horizonPieces = function (item) {
    const region = item.chord && (item.chord.region || H.regionFromKind(item.kind));
    // Prefer ownership already on the package (e.g. seat click on inactive disk)
    const pkgKey =
      item.chord && item.chord.localTonic != null
        ? { tonic: item.chord.localTonic, mode: item.chord.localMode || H.state.mode }
        : H.writeKey();
    if (item.route && item.route.length) {
      return item.route.map((c) => {
        const x = H.M().cloneChord(c);
        // duration placeholder — H.fitHorizonIntoSequence overwrites
        x.duration = c.duration || 2;
        x.tag = item.kind || x.tag || 'horizon';
        x.region = x.region || region;
        const ck =
          c.localTonic != null
            ? { tonic: c.localTonic, mode: c.localMode || H.state.mode }
            : pkgKey;
        H.stampKey(x, ck);
        return x;
      });
    }
    const ch = H.M().cloneChord(item.chord);
    ch.duration = item.chord.duration || 2;
    ch.tag = item.kind || 'horizon';
    ch.region = region;
    H.stampKey(ch, pkgKey);
    return [ch];
  }

  H.regionFromKind = function (kind) {
    if (kind === 'home') return 'diatonic';
    if (kind === 'cadence') return 'diatonic';
    if (kind === 'modulate') return 'chromatic';
    if (kind === 'flavour') return 'interchange';
    return 'diatonic';
  }

  /** Tonic / home chord for current writing key */
  H.makeHomeChord = function (opts) {
    opts = opts || {};
    const music = H.M();
    const t = H.state.tonic;
    const isMin = H.state.mode === 'minor' || (music.MODES[H.state.mode] || {}).romanBase === 'minor';
    const q = isMin ? 'min' : 'maj';
    let ch = music.makeChord(t, q, {
      duration: opts.duration != null ? opts.duration : H.stepDuration(),
      region: 'diatonic',
      roman: isMin ? 'i' : 'I',
      tag: 'home',
    });
    H.stampKey(ch, H.writeKey());
    return ch;
  }

  /** Place or jump to home as the first / next step (explicit start-at-home). */
  H.startAtHome = function () {
    const home = H.makeHomeChord({ duration: 4 });
    // Same fitting rules as From here
    H.commitHorizon(
      {
        chord: home,
        kind: 'home',
        label: home.name + ' home',
        job: 'start at tonic',
      },
      {}
    );
  }

  // ─── Horizon builders ────────────────────────────────────
  /**
   * opts.forMap — compact set for canvas constellation (no home satellite; capped)
   * opts.limit — max items when forMap
   */
  H.buildHorizon = function (opts) {
    opts = opts || {};
    const forMap = !!opts.forMap;
    const limit = opts.limit != null ? opts.limit : forMap ? 14 : 22;
    const music = H.M();
    const compose = H.C();
    const t = H.state.tonic;
    const from =
      H.state.selected >= 0 && H.state.chords[H.state.selected]
        ? H.state.chords[H.state.selected]
        : H.state.chords[H.state.chords.length - 1] || null;

    const items = [];

    // Home only in the list (centre disc owns home on the H.map)
    if (!forMap) {
      const home = H.makeHomeChord({ duration: H.stepDuration() });
      const alreadyOnHome =
        from &&
        from.root === home.root &&
        (from.quality === home.quality ||
          (from.quality || '').indexOf(home.quality === 'min' ? 'min' : 'maj') === 0);
      if (!from || !alreadyOnHome || !H.state.chords.length) {
        items.push({
          chord: home,
          kind: 'home',
          label: home.name,
          job: H.state.chords.length ? 'land home' : 'start here',
        });
      }
    }

    // Flavours — colour family moves
    const flavourSeeds = [
      { d: 8, q: 'maj', label: '♭VI colour', kind: 'flavour', job: 'dark lift' },
      { d: 10, q: 'maj', label: '♭VII modal', kind: 'flavour', job: 'epic' },
      { d: 5, q: 'min', label: 'iv soft', kind: 'flavour', job: 'pad' },
      { d: 1, q: 'maj', label: '♭II gate', kind: 'flavour', job: 'phrygian' },
      { d: 1, q: 'dom7', label: '♭II7 noir', kind: 'flavour', job: 'noir' },
      { d: 4, q: 'maj', label: 'Mediant', kind: 'flavour', job: 'cinematic' },
      { d: 3, q: 'maj', label: 'III', kind: 'flavour', job: 'relative' },
      { d: 7, q: 'dom7', label: 'V7 push', kind: 'flavour', job: 'tension' },
    ];
    flavourSeeds.forEach((s) => {
      let ch = music.makeChord((t + s.d) % 12, s.q, {
        region: s.d === 1 && s.q === 'dom7' ? 'tritone' : s.d === 4 ? 'chromatic' : 'interchange',
        tag: s.job,
        roman: s.label,
      });
      if (from && compose.bestInversion) ch = compose.bestInversion(from, ch);
      if (from && from.root === ch.root && from.quality === ch.quality) return;
      items.push({ chord: ch, kind: 'flavour', label: ch.name, job: s.job });
    });

    // Directions — 1 or 2 chord packages that still join the rest of the path
    if (compose.suggestDirectionPaths || compose.suggestNext) {
      const sel =
        H.state.selected >= 0 && H.state.selected < H.state.chords.length
          ? H.state.selected
          : H.state.chords.length - 1;
      const tail = sel >= 0 ? H.state.chords.slice(sel + 1) : [];
      const sug = compose.suggestDirectionPaths
        ? compose.suggestDirectionPaths({
            fromChord: from,
            tail,
            tonic: t,
            modeKey: H.state.mode,
            goalId: 'balanced',
            count: 7,
            path: H.state.chords.slice(0, Math.max(0, sel + 1)),
          })
        : compose.suggestNext({
            fromChord: from,
            tonic: t,
            modeKey: H.state.mode,
            goalId: 'balanced',
            count: 5,
            path: H.state.chords,
          }).map((s) => ({
            chord: s.chord,
            chords: [s.chord],
            label: s.chord.name,
            jobLabel: s.jobLabel,
            steps: 1,
          }));
      sug.forEach((s) => {
        const route = s.chords && s.chords.length ? s.chords : [s.chord];
        items.push({
          chord: route[0],
          kind: 'direction',
          label: s.label || route.map((c) => c.name).join(' → '),
          job: s.jobLabel || s.job || (route.length > 1 ? route.length + ' steps' : ''),
          // Multi-chord packages replace/insert the whole path so the join still works
          route: route.length >= 2 ? route : undefined,
          steps: route.length,
        });
      });
    }

    // Cadence colours — routes home
    if (from) {
      const routes = music.waysBackHome(from, t, H.state.mode, 4);
      routes.forEach((r) => {
        const first = r.chords[0];
        items.push({
          chord: first,
          kind: 'cadence',
          label: r.name,
          job: r.character,
          route: r.chords,
        });
      });
    }

    // Modulation links
    if (compose.modulationTargets) {
      const targets = compose.modulationTargets(t, H.state.mode, 5);
      targets.slice(0, 4).forEach((tgt) => {
        const into = compose.waysIntoKey
          ? compose.waysIntoKey(from || music.makeChord(t, 'min'), tgt.tonic, tgt.mode, 1)
          : [];
        const route = into[0];
        const first = route
          ? route.chords[0]
          : music.makeChord(tgt.tonic, (music.MODES[tgt.mode] || {}).romanBase === 'minor' ? 'min' : 'maj');
        items.push({
          chord: first,
          kind: 'modulate',
          label: '→ ' + music.noteName(tgt.tonic),
          job: tgt.relation,
          route: route ? route.chords : [first],
          modulateTo: { tonic: tgt.tonic, mode: tgt.mode },
        });
      });
    }

    // Dedupe by root+quality+kind, prefer directions when H.mapping
    const seen = new Set();
    let out = [];
    const order = forMap
      ? { direction: 0, flavour: 1, cadence: 2, modulate: 3 }
      : { home: -1, direction: 0, flavour: 1, cadence: 2, modulate: 3 };
    items.sort(
      (a, b) =>
        (order[a.kind] != null ? order[a.kind] : 9) - (order[b.kind] != null ? order[b.kind] : 9)
    );
    for (const it of items) {
      if (!it.chord) continue;
      const k = it.kind + ':' + it.chord.root + ':' + it.chord.quality + ':' + (it.label || '');
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(it);
      if (out.length >= (forMap ? limit : 22)) break;
    }
    // Map: mix so we don't only show directions
    if (forMap && out.length > limit) out = out.slice(0, limit);
    return out;
  }

  // ─── Playback / export ───────────────────────────────────
})(typeof window !== "undefined" ? window : globalThis);
