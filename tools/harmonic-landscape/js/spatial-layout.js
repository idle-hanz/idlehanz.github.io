/**
 * spatial-layout.js - SpatialMap prototype extensions (load after spatial.js).
 * Pure extract; no intentional behavior change.
 */
(function (global) {
  "use strict";
  var HS = global.HLSpatial;
  if (!HS || !HS.SpatialMap) throw new Error("Load spatial.js before spatial-layout.js");
  var SpatialMap = HS.SpatialMap;
  var REGION = HS.REGION;
  var SEAT = HS.SEAT;

  SpatialMap.prototype._rebuildDisks = function () {
    const M = global.HLMusic;
    const R = Math.min(this.w || 500, this.h || 360) * 0.38;
    const keys = new Map();

    const addKey = (tonic, mode, active) => {
      if (tonic == null) return;
      const t = ((tonic % 12) + 12) % 12;
      const m = mode || 'minor';
      const id = this._keyId(t, m);
      const prev = keys.get(id);
      keys.set(id, {
        tonic: t,
        mode: m,
        active: !!(active || (prev && prev.active)),
      });
      this.rememberKey(t, m);
    };

    // Path ownership = wheels you traveled through
    (this.path || []).forEach((ch) => {
      if (!ch) return;
      const t = ch.localTonic != null ? ch.localTonic : null;
      const m = ch.localMode || null;
      if (t != null) addKey(t, m || this.origin.mode, false);
    });

    // Current write home (active) â€” always present
    addKey(this.origin.tonic, this.origin.mode, true);
    // Clear active flags then set only write home active
    keys.forEach((k) => {
      k.active = this._keyId(k.tonic, k.mode) === this._keyId(this.origin.tonic, this.origin.mode);
    });

    const list = Array.from(keys.values());
    list.sort((a, b) => {
      if (a.active) return -1;
      if (b.active) return 1;
      const da = M && M.fifthsDistance ? Math.abs(M.fifthsDistance(this.origin.tonic, a.tonic)) : 0;
      const db = M && M.fifthsDistance ? Math.abs(M.fifthsDistance(this.origin.tonic, b.tonic)) : 0;
      return da - db || a.tonic - b.tonic;
    });

    const others = list.filter((k) => !k.active);
    this.disks = list.map((k) => {
      const isActive = !!k.active;
      let cx = 0;
      let cy = 0;
      let dR = R;
      if (!isActive) {
        const idx = others.indexOf(k);
        const steps =
          M && M.fifthsDistance ? M.fifthsDistance(this.origin.tonic, k.tonic) : idx + 1;
        // Always offset â€” never sit under the active disk
        const ang =
          -Math.PI / 2 +
          (steps !== 0
            ? (steps / 6) * Math.PI
            : ((idx + 1) / Math.max(1, others.length)) * Math.PI * 1.6 - 0.4);
        const dist = R * (1.85 + idx * 0.35);
        cx = Math.cos(ang) * dist;
        cy = Math.sin(ang) * dist * 0.9;
        dR = R * 0.85;
      }
      return {
        tonic: k.tonic,
        mode: k.mode,
        cx,
        cy,
        R: dR,
        active: isActive,
        label: M ? M.noteName(k.tonic) : '?',
      };
    });

    // Never auto-pan/zoom here â€” rebuilds run on every setPath and caused jumpiness.
    // User re-frames with Fit / Home lock / wheel / pan.
    this._rebuildScaleSeats();
    // Ghosts: only when not dragging (layout under the pointer feels jumpy)
    if (this._mode !== 'node' && this._mode !== 'edgePending') {
      this._rebuildGhostHalo();
    }
  };

  /**
   * Chase halo: adjacent keys around the pivot (selected path step).
   * Ghost wheels offer "establish home" pads; they clear when pivot moves
   * unless that key becomes a solid traveled disk.
   * Never throw â€” a failure must not freeze path/timeline updates.
   */

  SpatialMap.prototype._rebuildGhostHalo = function () {
    this.ghostDisks = [];
    this.ghostOptions = [];
    try {
      if (this.mapView !== 'chase') return;
      if (!this.path || !this.path.length) return;
      const M = global.HLMusic;
      const C = global.HLCompose || M;
      if (!M || !C || !C.adjacentKeys || !C.establishHomeOptions) return;

      const idx =
        this.current >= 0 && this.current < this.path.length
          ? this.current
          : this.path.length - 1;
      const pivotCh = this.path[idx];
      if (!pivotCh) return;

      const pT =
        pivotCh.localTonic != null ? pivotCh.localTonic : this.origin.tonic;
      const pM = pivotCh.localMode || this.origin.mode;
      const pivotDisk = this._diskForChord(pivotCh) || this._activeDisk();
      const basex = pivotDisk.cx || 0;
      const basey = pivotDisk.cy || 0;
      const baseR = pivotDisk.R || 120;

      const solidIds = new Set(
        (this.disks || []).map((d) => this._keyId(d.tonic, d.mode))
      );
      const adj = (C.adjacentKeys(pT, pM, 4) || []).filter(
        (k) => k && !solidIds.has(this._keyId(k.tonic, k.mode))
      );
      if (!adj.length) return;

      const gR = baseR * 0.72;
      const dist = baseR * 1.65;
      adj.forEach((k, i) => {
        let steps = M.fifthsDistance ? M.fifthsDistance(pT, k.tonic) : i + 1;
        if (steps === 0) steps = k.mode !== pM ? 0.5 : i + 1;
        const ang =
          -Math.PI / 2 +
          (steps !== 0
            ? (steps / 6) * Math.PI
            : ((i + 0.5) / Math.max(1, adj.length)) * Math.PI * 1.5 - 0.4);
        const gcx = basex + Math.cos(ang) * dist;
        const gcy = basey + Math.sin(ang) * dist * 0.9;
        const ghost = {
          tonic: k.tonic,
          mode: k.mode,
          cx: gcx,
          cy: gcy,
          R: gR,
          active: false,
          ghost: true,
          relation: k.relation || '',
          character: k.character || '',
          label: M.noteName(k.tonic),
          pivotIndex: idx,
        };
        this.ghostDisks.push(ghost);

        const opts = C.establishHomeOptions(k.tonic, k.mode) || [];
        opts.forEach((opt, j) => {
          this.ghostOptions.push({
            id: opt.id,
            label: opt.label,
            job: opt.job,
            character: opt.character,
            route: opt.route,
            ghostDisk: ghost,
            x: gcx,
            y: gcy + (j === 0 ? -18 : 18),
            r: 18,
          });
        });
      });
      // Never auto-zoom on hover rebuild â€” that yanked the view under the cursor
      // (user can Fit / Home lock when they want a re-frame)
    } catch (err) {
      console.warn('_rebuildGhostHalo failed', err);
      this.ghostDisks = [];
      this.ghostOptions = [];
    }
  };

  SpatialMap.prototype._activeDisk = function () {
    return (
      (this.disks && this.disks.find((d) => d.active)) || {
        cx: 0,
        cy: 0,
        R: Math.min(this.w || 500, this.h || 360) * 0.42,
        tonic: this.origin.tonic,
        mode: this.origin.mode,
        active: true,
      }
    );
  };

  /** Disk that owns a chord (localTonic if set, else active write-home) */

  SpatialMap.prototype._diskForChord = function (ch) {
    const t = ch.localTonic != null ? ch.localTonic : this.origin.tonic;
    const m = ch.localMode || this.origin.mode;
    let found = (this.disks || []).find((d) => d.tonic === t && d.mode === m);
    if (!found) {
      // Ensure disk exists for this chord's key
      found = (this.disks || []).find((d) => d.tonic === t);
    }
    return found || this._activeDisk();
  };

  /** Retired next-move map dots â€” API kept as no-op. */

  SpatialMap.prototype._layoutFunctionChart = function () {
    const M = global.HLMusic;
    const chart = this.functionChart;
    this.functionNodes = [];
    if (!chart || !chart.nodes || !chart.nodes.length) return;
    const disk = this._activeDisk();
    const t = chart.tonic != null ? chart.tonic : this.origin.tonic;
    const mode = chart.mode || this.origin.mode;
    const cx = disk.cx || 0;
    const cy = disk.cy || 0;
    // Same R as Chase seats so the wheel is the same physical size in both views
    const R = disk.R || 120;
    const SEAT_R = R * SEAT.scale;
    const TONIC_R = R * SEAT.tonic;
    const BORROW_R = R * SEAT.shell;
    const V7_R = R * SEAT.v7;

    // Chase harmonic-scale seats â†’ exact same angles/radii for diatonic Function nodes
    const scaleSeats =
      M && M.circularHarmonicScale ? M.circularHarmonicScale(t, mode) : [];
    const seatByRoot = {};
    scaleSeats.forEach((s) => {
      seatByRoot[s.root] = s;
    });

    // Interchange on the outer shell ring (same radius as Chase colour shell)
    const interList = chart.nodes.filter((n) => n.role === 'interchange');
    const interPos = {};
    interList.forEach((n, i) => {
      const ch = n.chord;
      // Prefer Chase angle for same root when it exists
      const seat = ch && seatByRoot[ch.root];
      const ang = seat
        ? seat.angle
        : -Math.PI / 2 + (i / Math.max(1, interList.length)) * Math.PI * 2;
      interPos[n.id] = {
        x: cx + Math.cos(ang) * BORROW_R,
        y: cy + Math.sin(ang) * BORROW_R * SEAT.squash,
      };
    });

    const byId = {};
    chart.nodes.forEach((n) => {
      byId[n.id] = n;
    });

    // Helper: angle of a resolve target (or root seat)
    const targetAngle = function (resolvesToId, fallbackRoot) {
      const target = resolvesToId ? byId[resolvesToId] : null;
      const probe =
        target && target.chord
          ? target.chord
          : {
              root:
                fallbackRoot != null
                  ? fallbackRoot
                  : parseInt(String(resolvesToId || '0').split(':')[0], 10) || 0,
              quality: 'maj',
            };
      const seat = seatByRoot[probe.root];
      if (seat) return seat.angle;
      if (M && M.chaseChordPos) {
        const p = M.chaseChordPos(probe, t, mode, { cx: cx, cy: cy, R: R });
        return Math.atan2(p.y - cy, p.x - cx);
      }
      return -Math.PI / 2;
    };

    chart.nodes.forEach((n) => {
      const ch = n.chord;
      if (!ch) return;
      let x;
      let y;
      if (n.role === 'interchange' && interPos[n.id]) {
        x = interPos[n.id].x;
        y = interPos[n.id].y;
      } else if (
        (n.role === 'secondary' || n.role === 'dominant') &&
        n.resolvesToId &&
        M
      ) {
        // V7s on mid belt beside target — still inside/near Chase shell
        const tAng = targetAngle(n.resolvesToId, ch.root);
        const ang = tAng + 0.52;
        x = cx + Math.cos(ang) * V7_R;
        y = cy + Math.sin(ang) * V7_R * SEAT.squash;
      } else if (n.role === 'secondaryii' && n.resolvesToId) {
        // ii of a secondary sits opposite the V7, slightly inside the V belt
        const tAng = targetAngle(n.routeTargetId || n.resolvesToId, ch.root);
        const ang = tAng - 0.48;
        const rr = V7_R * 0.86;
        x = cx + Math.cos(ang) * rr;
        y = cy + Math.sin(ang) * rr * SEAT.squash;
      } else if (n.role === 'tritone') {
        // Tritone sub outside the V belt, toward shell
        const tAng = targetAngle(n.resolvesToId, ch.root);
        const ang = tAng + 0.92;
        const rr = BORROW_R * 0.92;
        x = cx + Math.cos(ang) * rr;
        y = cy + Math.sin(ang) * rr * SEAT.squash;
      } else if (n.role === 'diminished') {
        const tAng = targetAngle(n.resolvesToId, ch.root);
        const tag = String(n.dimTag || n.roman || '');
        let angOff = -0.55;
        let rr = R * 1.0;
        if (/common-tone|I°|i°/i.test(tag)) {
          angOff = 0.2;
          rr = TONIC_R * 1.55;
        } else if (/V7b9|as V7/i.test(tag)) {
          angOff = 0.75;
          rr = V7_R * 1.05;
        }
        const ang = tAng + angOff;
        x = cx + Math.cos(ang) * rr;
        y = cy + Math.sin(ang) * rr * SEAT.squash;
      } else if (n.role === 'valt') {
        // Fan V-alts around the dominant seat
        const vSeat = scaleSeats.find(function (s) {
          return s.role === 'dom';
        });
        const baseAng = vSeat ? vSeat.angle : targetAngle(n.resolvesToId, ch.root);
        const tag = String(n.valtTag || n.roman || n.label || '');
        let angOff = 0.35;
        let rr = V7_R * 1.08;
        if (/alt/i.test(tag)) angOff = 0.55;
        else if (/♭9|b9/i.test(tag)) angOff = 0.2;
        else if (/♯9|s9|#9/i.test(tag)) angOff = 0.7;
        else if (/♯11|s11|#11/i.test(tag)) angOff = -0.25;
        else if (/b13|♭13/i.test(tag)) angOff = -0.5;
        else if (/sus/i.test(tag)) angOff = -0.7;
        else if (/backdoor|♭VII/i.test(tag)) {
          angOff = 1.1;
          rr = BORROW_R * 0.88;
        } else if (/ii\/V|V7\/V|delayed/i.test(tag)) {
          angOff = -0.95;
          rr = V7_R * 0.95;
        }
        const ang = baseAng + angOff;
        x = cx + Math.cos(ang) * rr;
        y = cy + Math.sin(ang) * rr * SEAT.squash;
      } else if (n.role === 'colour') {
        // Colours hug their degree seat, slightly outward + rotated so sus/II stay readable
        const hostRoot =
          n.colourHostRoot != null
            ? n.colourHostRoot
            : ch.root;
        const seat = seatByRoot[hostRoot] || seatByRoot[ch.root];
        const COLOUR_R = R * 0.88;
        if (seat) {
          // Offset by tag so several colours on one degree fan out
          const tag = String(n.colourTag || n.roman || '');
          let angOff = 0.38;
          if (/II|bright/i.test(tag)) angOff = 0.55;
          else if (/sus/i.test(tag)) angOff = -0.42;
          else if (/7|dorian/i.test(tag)) angOff = 0.28;
          const ang = seat.angle + angOff;
          x = cx + Math.cos(ang) * COLOUR_R;
          y = cy + Math.sin(ang) * COLOUR_R * SEAT.squash;
        } else if (M && M.chaseChordPos) {
          const base = M.chaseChordPos(ch, t, mode, { cx: cx, cy: cy, R: R });
          x = base.x * 1.08;
          y = base.y * 1.08;
        } else {
          x = cx;
          y = cy;
        }
      } else {
        // Diatonic / gates: same ring as Chase roman seats (same wheel)
        const seat = seatByRoot[ch.root];
        if (seat) {
          const rad = seat.role === 'tonic' ? TONIC_R : SEAT_R;
          x = cx + Math.cos(seat.angle) * rad;
          y = cy + Math.sin(seat.angle) * rad * SEAT.squash;
        } else if (M && M.chaseChordPos) {
          const base = M.chaseChordPos(ch, t, mode, { cx: cx, cy: cy, R: R });
          x = base.x;
          y = base.y;
        } else {
          x = cx;
          y = cy;
        }
      }
      const rByRole = {
        secondary: 13,
        dominant: 13,
        secondaryii: 11,
        tritone: 12,
        diminished: 11,
        valt: 11,
        interchange: 12,
        colour: 11,
      };
      this.functionNodes.push({
        id: n.id,
        chord: ch,
        role: n.role || 'diatonic',
        label: n.label || ch.name,
        roman: n.roman || '',
        gate: !!n.gate,
        resolvesToId: n.resolvesToId || null,
        routeTargetId: n.routeTargetId || null,
        canOrbitPeers: !!n.canOrbitPeers,
        onPath: !!n.onPath,
        colourTag: n.colourTag || '',
        dimTag: n.dimTag || '',
        valtTag: n.valtTag || '',
        x: x,
        y: y,
        r: rByRole[n.role] != null ? rByRole[n.role] : 14,
      });
    });
  };

  /** Draw Function neighbourhood: resolution edges + role-coloured nodes */

  SpatialMap.prototype._chordPos = function (ch, index, lane, stackPath) {
    const M = global.HLMusic;
    if (!M || !M.chaseChordPos) {
      const R = Math.min(this.w || 500, this.h || 360) * 0.34;
      const ang = ((ch.root || 0) / 12) * Math.PI * 2 - Math.PI / 2;
      return { x: Math.cos(ang) * R * 0.7, y: Math.sin(ang) * R * 0.6, onScale: true };
    }
    const disk = this._diskForChord(ch);
    const pos = M.chaseChordPos(
      ch,
      disk.tonic != null ? disk.tonic : this.origin.tonic,
      disk.mode || this.origin.mode,
      disk
    );
    if (lane === 1) {
      // Compare path slightly outward on same seat
      const ang = Math.atan2(pos.y - disk.cy, pos.x - disk.cx);
      pos.x += Math.cos(ang) * 12;
      pos.y += Math.sin(ang) * 10;
    }
    // Stack visits to same seat along a short tangent so repeats don't fully overlap
    const peers = stackPath || this.path;
    if (index > 0 && peers) {
      let stack = 0;
      for (let j = 0; j < index; j++) {
        const prev = peers[j];
        if (prev && prev.root === ch.root) stack += 1;
      }
      if (stack > 0) {
        const ang =
          Math.atan2(pos.y - (disk.cy || 0), pos.x - (disk.cx || 0)) + Math.PI / 2;
        pos.x += Math.cos(ang) * stack * 7;
        pos.y += Math.sin(ang) * stack * 6;
      }
    }
    return pos;
  };

  /** Mild de-overlap that never flings nodes far from their seats. */

  SpatialMap.prototype._softSeparate = function (nodes, minDist, maxPush) {
    minDist = minDist || 22;
    maxPush = maxPush != null ? maxPush : 7;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let d = Math.hypot(dx, dy) || 0.01;
          if (d < minDist) {
            const push = Math.min(maxPush, ((minDist - d) / 2) * 0.55);
            dx /= d;
            dy /= d;
            a.x -= dx * push;
            a.y -= dy * push;
            b.x += dx * push;
            b.y += dy * push;
          }
        }
      }
    }
    return nodes;
  };

  /**
   * Should this path chord sit on the write-home wheel?
   * Yes if unsigned, same disk, OR diatonic in write home (even if wrongly
   * stamped to another key â€” that caused Emâ†’B minor disk and Chaseâ‰ Function).
   */

  SpatialMap.prototype._pathShouldUseActiveWheel = function (ch) {
    if (!ch) return true;
    const writeT = this.origin.tonic;
    const writeM = this.origin.mode || 'minor';
    // Explicit ownership wins â€” multi-key journey stays on each step's disk
    if (ch.localTonic == null) return true;
    return (
      ch.localTonic === writeT && (ch.localMode || writeM) === writeM
    );
  };

  /**
   * Exact Chase scale-seat position on the active write-home disk.
   * Shared by Chase path + Function path so both views share the same wheel.
   */

  SpatialMap.prototype._activeSeatPos = function (ch, index, stackPath) {
    const M = global.HLMusic;
    if (!M || !M.seatForChord || !ch) return null;
    const disk = this._activeDisk();
    const cx = disk.cx || 0;
    const cy = disk.cy || 0;
    const R = disk.R || 120;
    const t = this.origin.tonic;
    const mode = this.origin.mode || 'minor';
    const hit = M.seatForChord(ch, t, mode);
    if (!hit || !hit.seat) return null;
    let rad = R * SEAT.scale;
    if (hit.seat.role === 'tonic' && hit.onScale && !hit.shell) rad = R * SEAT.tonic;
    else if (hit.shell === 'secondary') rad = R * SEAT.v7;
    else if (hit.shell === 'variant') rad = R * 0.82;
    else if (hit.shell === true) rad = R * SEAT.shell;
    const ang = hit.seat.angle;
    let x = cx + Math.cos(ang) * rad;
    let y = cy + Math.sin(ang) * rad * SEAT.squash;
    // Stack revisits slightly so repeats don't fully cover
    let stack = 0;
    const peers = stackPath || this.path || [];
    for (let j = 0; j < index; j++) {
      const prev = peers[j];
      if (prev && prev.root === ch.root && prev.quality === ch.quality) stack++;
    }
    if (stack > 0) {
      x += Math.cos(ang + Math.PI / 2) * stack * 6;
      y += Math.sin(ang + Math.PI / 2) * stack * 5;
    }
    return {
      x: x,
      y: y,
      onScale: !!hit.onScale,
      shell: hit.shell,
      seat: hit.seat,
    };
  };

  SpatialMap.prototype._layoutPath = function () {
    const M = global.HLMusic;
    if (!M) return;
    if (!this.disks || !this.disks.length) this._rebuildDisks(false);
    const useFn =
      this.mapView === 'function' && this.functionNodes && this.functionNodes.length;
    this.nodes = this.path.map((ch, i) => {
      let pos = null;
      if (useFn && ch) {
        // Function chart seats first (aligned to Chase scale ring)
        pos = this._functionSeatForChord(ch, i, this.path);
      }
      // Chase + Function fallback: same write-home seat math
      if (!pos && ch && this._pathShouldUseActiveWheel(ch)) {
        pos = this._activeSeatPos(ch, i, this.path);
      }
      // True other-key ownership only (not diatonic in write home)
      if (!pos) pos = this._chordPos(ch, i, 0);
      const r = 16 + Math.min(11, (ch.duration || 4) * 1.15);
      const ownT =
        ch.localTonic != null ? ((ch.localTonic % 12) + 12) % 12 : null;
      const homeT =
        this.origin && this.origin.tonic != null
          ? ((this.origin.tonic % 12) + 12) % 12
          : null;
      const foreignKey =
        ownT != null && homeT != null && ownT !== homeT;
      return {
        chord: ch,
        x: pos.x,
        y: pos.y,
        r,
        i,
        onScale: pos.onScale,
        shell: pos.shell,
        seat: pos.seat,
        foreignKey: foreignKey,
        keyTonic: ownT != null ? ownT : homeT,
      };
    });
    // Never soft-separate path off seats â€” that made Chase â‰  Function
    this._layoutAltPath();
    this._computeDivergent();
    this._rebuildScaleSeats();
    // Mid-aim: freeze ghosts so drag targets don't re-orbit under the pointer
    if (this._mode !== 'node' && this._mode !== 'edgePending') {
      this._rebuildGhostHalo();
    }
    // Path layout must NEVER move the camera (was the main source of jumpiness).
    // Camera only changes via setCameraMode / focusHome / pan / wheel.
  };

  /**
   * Place a chord on the Function chart (same rules as gold path).
   * Returns null if not in Function view or no seat found.
   */

  SpatialMap.prototype._functionSeatForChord = function (ch, index, stackPath) {
    if (
      this.mapView !== 'function' ||
      !this.functionNodes ||
      !this.functionNodes.length ||
      !ch
    ) {
      return null;
    }
    // Prefer diatonic seat over V7/borrow with same root (path Em â†’ iii, not a shell)
    const exact = this.functionNodes.find(
      (n) =>
        n.chord &&
        n.chord.root === ch.root &&
        n.chord.quality === ch.quality &&
        n.role === 'diatonic'
    ) ||
      this.functionNodes.find(
        (n) =>
          n.chord && n.chord.root === ch.root && n.chord.quality === ch.quality
      );
    const soft = exact
      ? null
      : this.functionNodes.find(
          (n) => n.chord && n.chord.root === ch.root && n.role === 'diatonic'
        ) ||
        this.functionNodes.find((n) => n.chord && n.chord.root === ch.root);
    const fn = exact || soft;
    if (!fn) return null;
    let stack = 0;
    const peers = stackPath || this.path || [];
    for (let j = 0; j < index; j++) {
      const prev = peers[j];
      if (prev && prev.root === ch.root && prev.quality === ch.quality) stack++;
    }
    const disk = this._activeDisk();
    const cx = (disk && disk.cx) || 0;
    const cy = (disk && disk.cy) || 0;
    const ang = Math.atan2(fn.y - cy, fn.x - cx) + Math.PI / 2;
    return {
      x: fn.x + Math.cos(ang) * stack * 6,
      y: fn.y + Math.sin(ang) * stack * 5,
      onScale: true,
      shell: false,
      seat: null,
      fn: fn,
    };
  };

  /**
   * Blue compare path â€” both views:
   * 1) same root as gold step â†’ sit beside gold (parallel maj/min)
   * 2) Function: chart seats; Chase: that step's disk seat
   * Never hard-separate into distant orphans.
   */

  SpatialMap.prototype._layoutAltPath = function () {
    const M = global.HLMusic;
    if (!M) {
      this.altNodes = [];
      return;
    }
    const useFn =
      this.mapView === 'function' && this.functionNodes && this.functionNodes.length;
    const act = this._activeDisk();
    this.altNodes = (this.altPath || []).map((ch, i) => {
      let pos = null;
      const gold = this.nodes && this.nodes[i];

      // 1) Same root as gold step (Chase + Function)
      //    same quality â†’ under gold (ghost, not drawn); quality flip â†’ beside
      if (ch && gold && gold.chord && gold.chord.root === ch.root) {
        const sameQ = gold.chord.quality === ch.quality;
        if (sameQ) {
          pos = {
            x: gold.x,
            y: gold.y,
            onScale: true,
            shell: false,
          };
        } else {
          const disk =
            (gold.chord && this._diskForChord(gold.chord)) || act || { cx: 0, cy: 0 };
          const cx = disk.cx || 0;
          const cy = disk.cy || 0;
          const ang = Math.atan2(gold.y - cy, gold.x - cx);
          const out = useFn ? 20 : 15;
          pos = {
            x: gold.x + Math.cos(ang) * out,
            y: gold.y + Math.sin(ang) * out * 0.88,
            onScale: true,
            shell: false,
          };
        }
      }

      // 2) Function chart seat
      if (!pos && useFn && ch) {
        const seat = this._functionSeatForChord(ch, i, this.altPath);
        if (seat) {
          const cx = (act && act.cx) || 0;
          const cy = (act && act.cy) || 0;
          const ang = Math.atan2(seat.y - cy, seat.x - cx);
          pos = {
            x: seat.x + Math.cos(ang) * 14,
            y: seat.y + Math.sin(ang) * 12,
            onScale: true,
            shell: false,
          };
        }
      }

      // 3) Chase seat on the disk that owns the step (prefer gold's disk for compare)
      if (!pos && ch) {
        const probe = {
          root: ch.root,
          quality: ch.quality,
          notes: ch.notes,
          region: ch.region,
          localTonic:
            ch.localTonic != null
              ? ch.localTonic
              : gold && gold.chord && gold.chord.localTonic != null
                ? gold.chord.localTonic
                : this.origin.tonic,
          localMode:
            ch.localMode ||
            (gold && gold.chord && gold.chord.localMode) ||
            this.origin.mode,
        };
        // Function fallback: stay on active write-home disk only
        if (useFn) {
          probe.localTonic = this.origin.tonic;
          probe.localMode = this.origin.mode;
        }
        pos = this._chordPos(probe, i, 1, this.altPath);
      }

      if (!pos) pos = { x: 0, y: 0, onScale: false, shell: false };
      const r = 13 + Math.min(9, (ch.duration || 4) * 1.05);
      return {
        chord: ch,
        x: pos.x,
        y: pos.y,
        r: r,
        i: i,
        onScale: pos.onScale,
        shell: pos.shell,
      };
    });
    // Soft only â€” hard _separateNodes flung blue nodes into empty corners
    this._softSeparate(this.altNodes, 20, 6);
  };

  // (camera apply is in _layoutPath / setCameraMode)

  SpatialMap.prototype._computeDivergent = function () {
    this.divergent = [];
    const n = Math.min(this.nodes.length, this.altNodes.length);
    for (let i = 0; i < n; i++) {
      const a = this.nodes[i].chord;
      const b = this.altNodes[i].chord;
      if (a.root !== b.root || a.quality !== b.quality) this.divergent.push(i);
    }
    // If lengths differ, mark extra indices on the longer path
    if (this.nodes.length !== this.altNodes.length && this.altNodes.length) {
      const max = Math.max(this.nodes.length, this.altNodes.length);
      for (let i = n; i < max; i++) this.divergent.push(i);
    }
  };

  SpatialMap.prototype._applyCameraForMode = function () {
    // Never clobber zoom/pan while switching views, freezing after aim, or dragging
    if (this._keepCameraOnce || this._freezeCamera || this._mode === 'node') return;
    const keepZ = this.camera.tz > 0 ? this.camera.tz : 1;
    if (this.cameraMode === 'home' || !this.nodes.length) {
      // Home lock: only re-centre if user hasn't panned (or just switched to home)
      if (!this._userPanned || this._forceHomeCenter) {
        this.camera.tx = 0;
        this.camera.ty = 0;
        this._forceHomeCenter = false;
      }
      this.camera.tz = keepZ;
      return;
    }
    if (this.cameraMode === 'follow') {
      const n = this.nodes[Math.max(0, Math.min(this.current, this.nodes.length - 1))];
      if (n) {
        this.camera.tx = n.x;
        this.camera.ty = n.y;
        this.camera.tz = keepZ;
      }
      return;
    }
    // Fit: re-frame path
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const all = this.nodes.concat(this.showAlt ? this.altNodes || [] : []);
    all.forEach((n) => {
      minX = Math.min(minX, n.x - n.r);
      maxX = Math.max(maxX, n.x + n.r);
      minY = Math.min(minY, n.y - n.r);
      maxY = Math.max(maxY, n.y + n.r);
    });
    this.camera.tx = (minX + maxX) / 2;
    this.camera.ty = (minY + maxY) / 2;
    const span = Math.max(maxX - minX, maxY - minY, 80);
    this.camera.tz = Math.min(1.3, Math.max(0.55, (Math.min(this.w, this.h) * 0.55) / span));
  };

  /** Snapshot / restore camera (scale + pan). Snap visual immediately so zoom doesn't lerp. */

  SpatialMap.prototype.analyzeTrajectory = function () {
    if (this.nodes.length < 2) {
      return { caption: 'Add chords to draw a path', swing: 0, arch: 0, returns: false, crosses: 0 };
    }
    let crosses = 0;
    let outMax = 0;
    let radii = [];
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      const r = Math.sqrt(n.x * n.x + n.y * n.y);
      radii.push(r);
      outMax = Math.max(outMax, r);
    }
    for (let i = 0; i < this.nodes.length - 1; i++) {
      const a = this.nodes[i];
      const b = this.nodes[i + 1];
      if (a.x * b.x < 0) crosses++;
    }
    const first = radii[0];
    const last = radii[radii.length - 1];
    const mid = radii[Math.floor(radii.length / 2)] || 0;
    const arch = mid > first && mid > last ? 1 : mid > (first + last) / 2 ? 0.5 : 0;
    const returns = last < outMax * 0.55;
    const swing = crosses / Math.max(1, this.nodes.length - 1);

    let caption = '';
    if (swing >= 0.45) caption = 'Strong leftâ€“right swing';
    else if (swing >= 0.25) caption = 'Some side-to-side motion';
    else caption = 'Path stays on one side of home';

    if (arch >= 0.5) caption += ' Â· arch out then in';
    if (returns) caption += ' Â· returns toward home';
    else if (outMax > 80) caption += ' Â· stays out far';

    if (this.altNodes.length && this.divergent.length) {
      caption += ' Â· variation differs at step(s) ' + this.divergent.map((i) => i + 1).join(', ');
    } else if (this.altNodes.length) {
      caption += ' Â· variation nearly parallel';
    }

    return { caption, swing, arch, returns, crosses, divergent: this.divergent.slice() };
  };

  SpatialMap.prototype._emitTrajectory = function () {
    if (this.onTrajectory) this.onTrajectory(this.analyzeTrajectory());
  };

  /**
   * Drag targets sit on real seats the path will use after drop.
   * Function: chart node coords. Chase: active scaleSeats (same as drawn rings).
   */

  SpatialMap.prototype._layoutAlts = function (pathIndex, alts) {
    const list = alts || [];
    const used = [];
    const useFn =
      this.mapView === 'function' && this.functionNodes && this.functionNodes.length;
    this.alts = list.map((a, i) => {
      let x;
      let y;
      // Prefer coords stamped by buildAimTargets from functionNodes
      if (a._fnX != null && a._fnY != null) {
        x = a._fnX;
        y = a._fnY;
      } else if (a._seatX != null && a._seatY != null) {
        x = a._seatX;
        y = a._seatY;
      } else if (useFn && a.chord) {
        const exact = this.functionNodes.find(
          (n) =>
            n.chord &&
            n.chord.root === a.chord.root &&
            n.chord.quality === a.chord.quality
        );
        const soft = exact
          ? null
          : this.functionNodes.find((n) => n.chord && n.chord.root === a.chord.root);
        const fn = exact || soft;
        if (fn) {
          x = fn.x;
          y = fn.y;
        }
      } else if (!useFn && a.chord && this.scaleSeats && this.scaleSeats.length) {
        // Snap to drawn Chase seats (active disk preferred)
        const root = a.chord.root;
        const exact = this.scaleSeats.find(
          (s) =>
            s.activeDisk &&
            s.root === root &&
            s.chord &&
            s.chord.quality === a.chord.quality
        );
        const soft = exact
          ? null
          : this.scaleSeats.find((s) => s.activeDisk && s.root === root) ||
            this.scaleSeats.find((s) => s.root === root);
        if (exact || soft) {
          const s = exact || soft;
          x = s.x;
          y = s.y;
        }
      }
      if (x == null || y == null) {
        const natural = this._chordPos(a.chord, pathIndex, 0);
        x = natural.x;
        y = natural.y;
      }
      // Gentle de-stack when two pads share a seat (shell vs diatonic same root)
      used.forEach((u) => {
        const d = Math.hypot(x - u.x, y - u.y);
        if (d < 18) {
          const disk = this._activeDisk();
          const ang =
            Math.atan2(y - (disk.cy || 0), x - (disk.cx || 0)) + 0.55 * (i + 1);
          x += Math.cos(ang) * 10;
          y += Math.sin(ang) * 8;
        }
      });
      const tier = a.tier || 'ok';
      const t = {
        chord: a.chord,
        label: a.label || a.chord.name,
        role: a.role || '',
        functionNodeId: a.functionNodeId || null,
        score: a.score != null ? a.score : 0.5,
        tier: tier,
        // Leave-home aim pads (adjacent keys)
        establish: !!a.establish,
        establishRoute: a.establishRoute || null,
        modulateTo: a.modulateTo || null,
        x: x,
        y: y,
        r: a.establish
          ? 22
          : useFn
            ? tier === 'good'
              ? 18
              : tier === 'ok'
                ? 15
                : 12
            : tier === 'good'
              ? 24
              : tier === 'ok'
                ? 20
                : 16,
        naturalX: x,
        naturalY: y,
      };
      used.push(t);
      return t;
    });
  };

  /** Build clickable Chase seats for the active disk (and dim seats on prev disk). */

  SpatialMap.prototype._rebuildScaleSeats = function () {
    const M = global.HLMusic;
    this.scaleSeats = [];
    if (!M || !M.circularHarmonicScale || !M.makeChord) return;
    (this.disks || []).forEach((disk) => {
      const seats = M.circularHarmonicScale(disk.tonic, disk.mode);
      seats.forEach((s) => {
        // Diatonic triad defaults (V = maj, viiÂ° = dim) so hover IDs correctly
        let q = M.seatDefaultQuality
          ? M.seatDefaultQuality(s, disk.mode)
          : (s.qualities && s.qualities[0]) || 'maj';
        if (s.role === 'leading') q = (s.qualities && s.qualities[0]) || 'dim';
        const ch = M.makeChord(s.root, q, {
          region: 'diatonic',
          roman: s.roman,
          tag: 'chase-seat',
        });
        // Same radii as path seats + Function diatonic ring
        const radius = s.role === 'tonic' ? disk.R * SEAT.tonic : disk.R * SEAT.scale;
        const x = disk.cx + Math.cos(s.angle) * radius;
        const y = disk.cy + Math.sin(s.angle) * radius * SEAT.squash;
        // Stamp disk ownership on seat chords so drop/click keep multi-disk correct
        ch.localTonic = disk.tonic;
        ch.localMode = disk.mode;
        this.scaleSeats.push({
          x,
          y,
          r: disk.active ? 22 : 16,
          root: s.root,
          roman: s.roman,
          role: s.role,
          qualities: s.qualities,
          chord: ch,
          activeDisk: !!disk.active,
          seat: s,
          disk,
        });
      });
    });
  };

  /**
   * Map a pointer event into canvas logical coords (this.w Ã— this.h).
   * CSS size can differ from the drawing buffer size â€” using raw client offsets
   * alone made hits miss every seat ("left click does nothing").
   */

  SpatialMap.prototype.frameActiveDisk = function (opts) {
    opts = opts || {};
    const d = this._activeDisk();
    this.camera.tx = (d && d.cx) || 0;
    this.camera.ty = (d && d.cy) || 0;
    if (opts.zoom != null) this.camera.tz = opts.zoom;
    if (opts.snap) {
      this.camera.x = this.camera.tx;
      this.camera.y = this.camera.ty;
      this.camera.zoom = this.camera.tz;
    }
  };

  /**
   * Function / neighbourhood chart for active write-home disk.
   * chart: { nodes:[{id,chord,role,label,roman,resolvesToId,gate}], edges:[{kind,fromId,toId}] }
   */

})(typeof window !== "undefined" ? window : globalThis);