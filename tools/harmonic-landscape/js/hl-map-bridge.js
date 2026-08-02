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
    let q = (seat.qualities && seat.qualities[0]) || 'maj';
    if (seat.role === 'dom') q = 'dom7';
    if (seat.role === 'leading' || seat.role === 'supertonic') {
      q = seat.qualities[0] || (k.mode === 'major' ? 'dim' : 'halfdim');
    }
    const ch = H.M().makeChord(seat.root, q, {
      duration: H.stepDuration(),
      region: 'diatonic',
      roman: seat.roman || '',
      tag: 'chase',
    });
    return H.stampKey(ch, k);
  }

  /**
   * Drag targets on the (large) Chase chart: full scale seats + useful tension shells.
   * Built in the path chord's own key so multi-disk drag stays on that disk.
   */
  H.buildAimTargets = function (pathIndex, chord) {
    const list = [];
    const seen = new Set();
    const diskKey = H.keyOf(chord || H.state.chords[pathIndex]);
    const add = (ch, label, role) => {
      if (!ch) return;
      const k = ch.root + ':' + ch.quality;
      if (seen.has(k)) return;
      if (chord && ch.root === chord.root && ch.quality === chord.quality) return;
      seen.add(k);
      ch = { ...ch, duration: (chord && chord.duration) || H.stepDuration() };
      H.stampKey(ch, diskKey);
      list.push({ chord: ch, label: label || ch.name, role: role || '' });
    };

    // Full circular harmonic scale of THIS chord's disk
    if (H.M().circularHarmonicScale) {
      H.M()
        .circularHarmonicScale(diskKey.tonic, diskKey.mode)
        .forEach((seat) => {
          const ch = H.chordFromChaseSeat(seat, diskKey);
          add(ch, ch.name, seat.roman);
        });
    }

    // Tension / colour shell (sits outside the ring via Chase layout)
    [
      { d: 1, q: 'dom7', role: '♭II7', region: 'tritone' },
      { d: 8, q: 'maj', role: '♭VI', region: 'interchange' },
      { d: 10, q: 'maj', role: '♭VII', region: 'interchange' },
      { d: 6, q: 'dom7', role: '♭V7', region: 'tritone' },
      { d: 3, q: 'maj', role: 'III', region: 'chromatic' },
    ].forEach((s) => {
      add(
        H.M().makeChord((diskKey.tonic + s.d) % 12, s.q, { region: s.region, tag: 'shell' }),
        null,
        s.role
      );
    });

    // Quality family on same root (inversions less important on big chart)
    if (H.C().closeAlternates) {
      H.C()
        .closeAlternates(chord, diskKey.tonic, diskKey.mode, 4)
        .forEach((a) => add(a.chord, a.label, a.role || 'alt'));
    }

    return list;
  }

  /**
   * Click a Chase seat: write that scale chord into the path.
   * Seat on inactive disk → write onto that disk and switch write home (no full-path retag).
   */
  H.selectChaseSeat = function (seatInfo) {
    if (!seatInfo) return;
    const disk = seatInfo.disk;
    const diskKey = disk
      ? { tonic: disk.tonic, mode: disk.mode || H.state.mode }
      : H.writeKey();
    const ch =
      seatInfo.chord ||
      H.chordFromChaseSeat(seatInfo.seat || seatInfo, diskKey);
    if (!ch) return;
    ch.duration = H.stepDuration();
    H.stampKey(ch, diskKey);

    // Clicking another disk's seat switches gravity so From here / new steps match
    const switched =
      disk &&
      !disk.active &&
      (disk.tonic !== H.state.tonic || (disk.mode || H.state.mode) !== H.state.mode);
    if (switched) {
      H.setWritingHome(disk.tonic, disk.mode || H.state.mode, {
        transpose: false,
        skipEdit: true,
      });
    }

    H.A().ensure();
    H.A().playChord({ chord: ch, soft: true, duration: 0.4 });
    H.commitHorizon({
      chord: ch,
      kind: 'direction',
      label: ch.name,
      job:
        (seatInfo.roman || seatInfo.role || 'scale') +
        ' seat' +
        (switched ? ' · write home → ' + H.keyLabelFor(diskKey) : ''),
    });
  }

  /**
   * Pick a bridge chord between a → b that lands on a sensible Chase seat.
   * Prefer a diatonic scale seat of a's key near the circular midpoint;
   * never use arithmetic mean of pitch classes (B→C is not F#).
   */
  H.bridgeChordBetween = function (a, b, duration) {
    const bridgeKey = H.keyOf(a);
    const music = H.M();
    const mid = H.circularBlendRoot(a.root, b.root, 0.5);
    let root = mid;
    let quality = bridgeKey.mode === 'major' ? 'maj' : 'min';
    let roman = '→';

    if (music.circularHarmonicScale) {
      const seats = music.circularHarmonicScale(bridgeKey.tonic, bridgeKey.mode);
      let best = null;
      let bestScore = Infinity;
      seats.forEach((s) => {
        if (s.root === a.root || s.root === b.root) return;
        // Prefer seats close to the circular mid-root
        const score = H.pcDist(s.root, mid);
        if (score < bestScore) {
          bestScore = score;
          best = s;
        }
      });
      if (best) {
        root = best.root;
        roman = best.roman || '→';
        if (best.role === 'dom') quality = 'dom7';
        else if (best.qualities && best.qualities[0]) quality = best.qualities[0];
      }
    }

    let ch = music.makeChord(root, quality, {
      duration,
      region: 'diatonic',
      tag: 'insert',
      roman,
    });
    if (H.C().bestInversion) {
      ch = H.C().bestInversion(a, ch);
      ch.duration = duration;
      ch.tag = 'insert';
      ch.roman = roman;
    }
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
   * Map edge click → this.
   */
  H.insertBetweenWithTiming = function (afterIndex) {
    const a = H.state.chords[afterIndex];
    const b = H.state.chords[afterIndex + 1];
    if (!a || !b) {
      H.setSyncStatus('Edge insert needs two steps — click the line between them');
      return;
    }

    const plan = H.planEdgeInsertBeats(a.duration || 4, b.duration || 4);
    if (!plan) {
      H.setSyncStatus('Neighbors too short to insert (need ≥ 2 beats combined)');
      return;
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
      'Insert on edge · ' +
        ch.name +
        ' · ' +
        plan.insertDur +
        'b from neighbors · total ' +
        total +
        'b · between ' +
        a.name +
        ' → ' +
        b.name
    );
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
    // Prefer half-beat grid: e.g. 4 → 2+2, 3 → 1.5+1.5, 1 → 0.5+0.5
    const d1 = Math.max(0.5, Math.round(d) / 2);
    // Remainder on second half so total length is unchanged
    const d2 = Math.max(0.5, d - d1);
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
    H.pushUndo();
    const prev = H.state.chords[pathIndex];
    // Prefer key already on newChord (aim targets stamp disk), else keep slot's disk
    const ownKey =
      newChord && newChord.localTonic != null
        ? { tonic: newChord.localTonic, mode: newChord.localMode || H.state.mode }
        : H.keyOf(prev);
    let ch = H.M().cloneChord(newChord);
    ch.duration = prev.duration || 4;
    ch.tag = ch.tag || 'pulled';
    if (H.C().bestInversion && pathIndex > 0) {
      ch = H.C().bestInversion(H.state.chords[pathIndex - 1], ch);
      ch.duration = prev.duration || 4;
      ch.tag = ch.tag || 'pulled';
    }
    H.stampKey(ch, ownKey);
    H.state.chords[pathIndex] = ch;

    if (opts.pullNeighbors && opts.pullStrength > 0) {
      const t = Math.min(1, opts.pullStrength) * 0.55; // how far neighbors move
      // Previous: blend root toward new chord — stay on neighbor's own disk
      if (pathIndex > 0) {
        const p = H.state.chords[pathIndex - 1];
        const pKey = H.keyOf(p);
        const newRoot = H.circularBlendRoot(p.root, ch.root, t);
        let pq = p.quality;
        let pn = H.M().makeChord(newRoot, pq, {
          duration: p.duration,
          region: p.region || 'diatonic',
          roman: p.roman,
          tag: 'tugged',
        });
        if (H.C().bestInversion && pathIndex > 1) {
          pn = H.C().bestInversion(H.state.chords[pathIndex - 2], pn);
          pn.duration = p.duration;
        }
        pn.tag = 'tugged';
        H.stampKey(pn, pKey);
        H.state.chords[pathIndex - 1] = pn;
      }
      // Next: blend toward new chord from its side — keep next's disk
      if (pathIndex < H.state.chords.length - 1) {
        const n = H.state.chords[pathIndex + 1];
        const nKey = H.keyOf(n);
        const newRoot = H.circularBlendRoot(n.root, ch.root, t * 0.85);
        let nn = H.M().makeChord(newRoot, n.quality, {
          duration: n.duration,
          region: n.region || 'diatonic',
          roman: n.roman,
          tag: 'tugged',
        });
        if (H.C().bestInversion) {
          nn = H.C().bestInversion(ch, nn);
          nn.duration = n.duration;
        }
        nn.tag = 'tugged';
        H.stampKey(nn, nKey);
        H.state.chords[pathIndex + 1] = nn;
      }
    }

    H.state.selected = pathIndex;
    H.state.fromPackId = null;
    if (H.map) H.map._mode = null;
    H.afterEdit();
    H.A().ensure();
    H.A().playChord({ chord: H.state.chords[pathIndex] });
  }

  H.setDefaultDuration = function (beats, opts) {
    opts = opts || {};
    H.state.defaultDuration = Math.max(0.5, H.snapBeats(beats));
    const host = H.$('#step-dur');
    if (host) {
      host.querySelectorAll('[data-step-dur]').forEach((b) => {
        b.classList.toggle('active', parseFloat(b.dataset.stepDur) === H.state.defaultDuration);
      });
    }
    if (!opts.silent) H.setSyncStatus('New steps · ' + H.state.defaultDuration + ' beats each');
  }

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
    H.afterEdit();
    H.A().ensure();
    H.A().playChord({ chord: ch });
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
    H.recognize({ preserveName: H.state.nameLocked });
    H.refreshAll();
    if (H.S() && H.state.chords.length) {
      try {
        H.pushToSharedSession('landscape');
      } catch (_) {}
    }
    H.refreshAltPath();
  }

  /**
   * Blue compare is EXPLICIT only (Alt-click a version chip, or after forking).
   * Never auto-pick v1 / siblings — that left blue lines on screen while editing
   * v1 and felt like a bug.
   */
})(typeof window !== "undefined" ? window : globalThis);
