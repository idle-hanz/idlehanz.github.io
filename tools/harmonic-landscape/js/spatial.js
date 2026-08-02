/**
 * Path-in-space map: fixed home stage, trajectory, dual versions, edit gestures
 */
(function (global) {
  'use strict';

  const REGION = {
    diatonic:    { fill: '#c4a574', ghost: 'rgba(196,165,116,0.35)' },
    secondary:   { fill: '#7eb8da', ghost: 'rgba(126,184,218,0.45)' },
    interchange: { fill: '#c4a0e0', ghost: 'rgba(196,160,224,0.4)' },
    gate:        { fill: '#e8c98a', ghost: 'rgba(232,201,138,0.5)' },
    chromatic:   { fill: '#d4786a', ghost: 'rgba(212,120,106,0.45)' },
    tritone:     { fill: '#e85d4c', ghost: 'rgba(232,93,76,0.5)' },
    parallel:    { fill: '#6bb38a', ghost: 'rgba(107,179,138,0.4)' },
    cadence:     { fill: '#e8c98a', ghost: 'rgba(232,201,138,0.45)' },
    modulate:    { fill: '#a78bfa', ghost: 'rgba(167,139,250,0.45)' },
    flavour:     { fill: '#f0a070', ghost: 'rgba(240,160,112,0.4)' },
    direction:   { fill: '#7eb8da', ghost: 'rgba(126,184,218,0.35)' },
    home:        { fill: '#e8c98a', ghost: 'rgba(232,201,138,0.65)' },
    alt:         { fill: '#e8c98a', ghost: 'rgba(232,201,138,0.55)' },
  };

  function SpatialMap(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.w = 0;
    this.h = 0;
    this.origin = { tonic: 11, mode: 'minor' };
    /** Chase disks: active write-home + keys traveled in the path */
    this.disks = [];
    this.keyLedger = []; // optional history (not all drawn — path owns travel)
    /** Ghost adjacent-key wheels around the pivot (Chase only) */
    this.ghostDisks = [];
    /** Establish-home pads on ghost disks */
    this.ghostOptions = [];
    this.path = [];
    this.nodes = [];
    this.altPath = [];
    this.altNodes = [];
    this.divergent = [];
    this.horizon = [];
    this.alts = [];
    this.current = -1;
    this.playing = -1;
    this.cameraMode = 'home';
    /** 'chase' = scale seats · 'function' = neighbourhood chart (same key) */
    this.mapView = 'chase';
    this.functionChart = null; // { nodes, edges, tonic, mode }
    this.functionNodes = [];
    this.showHorizon = true;
    this.showAlt = true;
    this.camera = { x: 0, y: 0, zoom: 1, tx: 0, ty: 0, tz: 1 };
    this.hover = null;
    this.snapAlt = null;
    this.pulseT = 0;
    this.onSelectPath = null;
    this.onSelectHorizon = null;
    this.onHoverHorizon = null;
    this.onSelectHome = null; // click gold home disc → start/land on tonic
    this.onHoverHome = null;
    this.onSelectSeat = null; // click Chase scale seat → add chord
    this.onHoverSeat = null;
    this.onRequestAlts = null;
    this.onSwapChord = null;
    this.onPullChord = null; // (pathIndex, chord, meta) only when aimed at a target
    this.onSelectAltNode = null; // click blue compare node
    this.onSelectGhostOption = null; // establish home on adjacent key
    this.onHoverGhostOption = null;
    this.onAimChange = null; // (pathIndex, target|{null}, meta) for live audition
    this.onInsertBetween = null; // (afterIndex) => void
    this.onTrajectory = null; // (caption) => void
    this.snapRadius = 56; // larger seats → easier drop
    this.scaleSeats = []; // clickable seats on active disk
    this._mode = null;
    this._dragNode = null;
    this._dragOrigin = null; // original node world pos (chord stays here)
    this._dragPos = null; // magnet / aim point — not the chord
    this._last = null;
    this._moved = false;
    this._aimPreview = null; // { chord, x, y, label, role }
    this._bind();
    this.resize();
    this.rememberKey(this.origin.tonic, this.origin.mode);
    this._rebuildDisks();
  }

  SpatialMap.prototype._bind = function () {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this._down(e));
    c.addEventListener('pointermove', (e) => this._move(e));
    c.addEventListener('pointerup', (e) => this._up(e));
    c.addEventListener('pointercancel', (e) => this._up(e));
    c.addEventListener('pointerleave', () => {
      if (this._mode !== 'node') this.hover = null;
    });
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.camera.tz = Math.max(0.5, Math.min(2.2, this.camera.tz * (e.deltaY > 0 ? 0.92 : 1.08)));
      },
      { passive: false }
    );
    window.addEventListener('resize', () => this.resize());
  };

  SpatialMap.prototype.resize = function () {
    const r = this.canvas.getBoundingClientRect();
    const nw = Math.max(280, r.width);
    const nh = Math.max(220, r.height);
    // Skip no-op / mid-aim resizes (DOM reflow while aiming caused shake)
    if (this._mode === 'node') return;
    if (Math.abs(nw - (this.w || 0)) < 1 && Math.abs(nh - (this.h || 0)) < 1) return;
    this.w = nw;
    this.h = nh;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // Keep disk radii in proportion to canvas
    if (this.disks && this.disks.length) {
      const R = Math.min(this.w, this.h) * 0.46;
      this.disks.forEach((d, i) => {
        d.R = i === 0 || d.active ? R : R * 0.72;
      });
      if (this.path && this.path.length) this._layoutPath();
    }
  };

  SpatialMap.prototype._keyId = function (tonic, mode) {
    return ((tonic % 12) + 12) % 12 + ':' + (mode || 'minor');
  };

  SpatialMap.prototype.rememberKey = function (tonic, mode) {
    const t = ((Number(tonic) % 12) + 12) % 12;
    const m = mode || 'minor';
    if (!this.keyLedger) this.keyLedger = [];
    const id = this._keyId(t, m);
    if (!this.keyLedger.some((k) => this._keyId(k.tonic, k.mode) === id)) {
      this.keyLedger.push({ tonic: t, mode: m });
    }
  };

  SpatialMap.prototype.setOrigin = function (tonic, mode) {
    const M = global.HLMusic;
    const next = {
      tonic: typeof tonic === 'number' ? tonic : M ? M.pc(tonic) : 0,
      mode: mode || 'minor',
    };
    const prev = this.origin;
    if (prev && (prev.tonic !== next.tonic || prev.mode !== next.mode)) {
      this.rememberKey(prev.tonic, prev.mode);
    }
    this.origin = next;
    this.rememberKey(next.tonic, next.mode);
    // Mid-drag rebuilds re-layout the path and make the map jitter
    if (this._mode === 'node') return;
    // Same key already loaded — skip rebuild (view switch was jumping the wheel)
    if (
      prev &&
      prev.tonic === next.tonic &&
      prev.mode === next.mode &&
      this.disks &&
      this.disks.length &&
      this._keepCameraOnce
    ) {
      return;
    }
    this._rebuildDisks();
    if (this.path && this.path.length) {
      this._layoutPath();
      this._emitTrajectory();
    }
  };

  /**
   * Solid Chase disks = keys you traveled (path ownership) + write home.
   * Adjacent unexplored keys are ghost disks from _rebuildGhostHalo (not here).
   */
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

    // Current write home (active) — always present
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
        // Always offset — never sit under the active disk
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

    // Multi-disk: only suggest a wider zoom when not preserving camera (view switch)
    if (
      this.disks.length > 1 &&
      this.cameraMode === 'home' &&
      !this._keepCameraOnce
    ) {
      this.camera.tz = Math.min(this.camera.tz || 1, 0.65);
      this.camera.tx = 0;
      this.camera.ty = 0;
    }
    this._rebuildScaleSeats();
    this._rebuildGhostHalo();
  };

  /**
   * Chase halo: adjacent keys around the pivot (selected path step).
   * Ghost wheels offer “establish home” pads; they clear when pivot moves
   * unless that key becomes a solid traveled disk.
   */
  SpatialMap.prototype._rebuildGhostHalo = function () {
    this.ghostDisks = [];
    this.ghostOptions = [];
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
    const adj = C.adjacentKeys(pT, pM, 4).filter(
      (k) => !solidIds.has(this._keyId(k.tonic, k.mode))
    );
    if (!adj.length) return;

    const gR = baseR * 0.72;
    const dist = baseR * 1.65;
    // Fan ghosts around pivot disk, slightly outward on fifths circle
    adj.forEach((k, i) => {
      let steps = M.fifthsDistance ? M.fifthsDistance(pT, k.tonic) : i + 1;
      if (steps === 0) steps = k.mode !== pM ? 0.5 : i + 1;
      const ang =
        -Math.PI / 2 +
        (steps !== 0
          ? (steps / 6) * Math.PI
          : ((i + 0.5) / adj.length) * Math.PI * 1.5 - 0.4);
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

      const opts = C.establishHomeOptions(k.tonic, k.mode);
      // Stack establish pads at ghost centre (I above, V7→I below)
      opts.forEach((opt, j) => {
        this.ghostOptions.push({
          id: opt.id,
          label: opt.label,
          job: opt.job,
          character: opt.character,
          route: opt.route,
          ghostDisk: ghost,
          x: gcx,
          y: gcy + (j === 0 ? -16 : 16),
          r: 15,
        });
      });
    });
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

  SpatialMap.prototype.setShowHorizon = function (on) {
    this.showHorizon = !!on;
  };

  SpatialMap.prototype.setShowAlt = function (on) {
    this.showAlt = !!on;
  };

  SpatialMap.prototype.setMapView = function (view) {
    const cam = this.snapshotCamera();
    this.mapView = view === 'function' ? 'function' : 'chase';
    if (this.mapView === 'chase') {
      this.functionNodes = [];
    } else if (this.functionChart) {
      this._layoutFunctionChart();
    }
    this._keepCameraOnce = true;
    if (this.path && this.path.length) this._layoutPath();
    else if (this.altPath && this.altPath.length) this._layoutAltPath();
    this._keepCameraOnce = false;
    this.restoreCamera(cam, { snap: true });
  };

  /** Snap view to the active write-home disk without changing zoom much. */
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
  SpatialMap.prototype.setFunctionChart = function (chart) {
    this.functionChart = chart || null;
    if (!chart || this.mapView !== 'function') {
      this.functionNodes = [];
      return;
    }
    this._layoutFunctionChart();
    // Snap path nodes onto chart seats so adding G doesn't draw a second G nearby
    if (this.path && this.path.length) this._layoutPath();
  };

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
    const SEAT_R = R * 0.72; // matches Chase scale-seat ring
    const TONIC_R = R * 0.42;
    const BORROW_R = R * 1.12; // matches Chase shell ring (not a bigger orbit)
    const V7_R = R * 0.92;

    // Chase harmonic-scale seats → exact same angles/radii for diatonic Function nodes
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
        y: cy + Math.sin(ang) * BORROW_R * 0.88,
      };
    });

    const byId = {};
    chart.nodes.forEach((n) => {
      byId[n.id] = n;
    });

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
        const target = byId[n.resolvesToId];
        const probe =
          target && target.chord
            ? target.chord
            : {
                root: parseInt(String(n.resolvesToId).split(':')[0], 10) || 0,
                quality: 'maj',
              };
        const seat = seatByRoot[probe.root];
        const tAng = seat
          ? seat.angle
          : M.chaseChordPos
            ? Math.atan2(
                M.chaseChordPos(probe, t, mode, { cx: cx, cy: cy, R: R }).y - cy,
                M.chaseChordPos(probe, t, mode, { cx: cx, cy: cy, R: R }).x - cx
              )
            : -Math.PI / 2;
        const ang = tAng + 0.52;
        x = cx + Math.cos(ang) * V7_R;
        y = cy + Math.sin(ang) * V7_R * 0.88;
      } else {
        // Diatonic / gates: same ring as Chase roman seats (same wheel)
        const seat = seatByRoot[ch.root];
        if (seat) {
          const rad = seat.role === 'tonic' ? TONIC_R : SEAT_R;
          x = cx + Math.cos(seat.angle) * rad;
          y = cy + Math.sin(seat.angle) * rad * 0.88;
        } else if (M && M.chaseChordPos) {
          const base = M.chaseChordPos(ch, t, mode, { cx: cx, cy: cy, R: R });
          x = base.x;
          y = base.y;
        } else {
          x = cx;
          y = cy;
        }
      }
      this.functionNodes.push({
        id: n.id,
        chord: ch,
        role: n.role || 'diatonic',
        label: n.label || ch.name,
        roman: n.roman || '',
        gate: !!n.gate,
        resolvesToId: n.resolvesToId || null,
        canOrbitPeers: !!n.canOrbitPeers,
        onPath: !!n.onPath,
        x: x,
        y: y,
        r:
          n.role === 'secondary' || n.role === 'dominant'
            ? 13
            : n.role === 'interchange'
              ? 12
              : 14,
      });
    });
  };

  /** Draw Function neighbourhood: resolution edges + role-coloured nodes */
  SpatialMap.prototype._drawFunctionChart = function (ctx) {
    if (!this.functionChart || !this.functionNodes.length) return;
    const byId = {};
    this.functionNodes.forEach((n) => {
      byId[n.id] = n;
    });
    const z = this.camera.zoom || 1;
    const hoverItem =
      this.hover && this.hover.type === 'functionNode' ? this.hover.item : null;
    // Resolve hover to function node id (prefer explicit id from hit test)
    let hoverId = null;
    if (hoverItem) {
      if (hoverItem.functionNodeId) hoverId = hoverItem.functionNodeId;
      else if (hoverItem.chord) {
        const hit = this.functionNodes.find(
          (n) =>
            n.chord &&
            n.chord.root === hoverItem.chord.root &&
            n.chord.quality === hoverItem.chord.quality &&
            (!hoverItem.role ||
              n.role === hoverItem.role ||
              (hoverItem.role === 'secondary' && n.role === 'dominant'))
        );
        if (hit) hoverId = hit.id;
      }
    }

    const fo = (this.functionChart && this.functionChart.opts) || {};
    const bothWays = fo.hoverBothWays !== false;

    const edgeTouchesHover = (e) => {
      if (!hoverId) return false;
      if (bothWays) return e.fromId === hoverId || e.toId === hoverId;
      return e.fromId === hoverId; // outbound only
    };

    // Soft orbit ring always (when borrow on): connects interchange nodes in angle order
    const inter = this.functionNodes.filter((n) => n.role === 'interchange');
    if (fo.showOrbit !== false && inter.length >= 2) {
      const ordered = inter.slice().sort((a, b) => Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x));
      ctx.beginPath();
      ordered.forEach((n, i) => {
        if (i === 0) ctx.moveTo(n.x, n.y);
        else ctx.lineTo(n.x, n.y);
      });
      ctx.closePath();
      ctx.strokeStyle = hoverId && ordered.some((n) => n.id === hoverId)
        ? 'rgba(196,160,224,0.55)'
        : 'rgba(196,160,224,0.22)';
      ctx.lineWidth = 1.4 / z;
      ctx.setLineDash([4 / z, 5 / z]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Edges under nodes — dim all, brighten paths from/to hovered chord
    (this.functionChart.edges || []).forEach((e) => {
      const a = byId[e.fromId];
      const b = byId[e.toId];
      if (!a || !b) return;
      // Orbit spokes: draw all from hovered borrow chord (complete star)
      if (e.kind === 'orbit') {
        if (!hoverId || !edgeTouchesHover(e)) return;
        // only need one direction drawn when bothWays creates pairs
        if (e.fromId !== hoverId) return;
      }

      const lit = !hoverId || edgeTouchesHover(e);
      const dim = hoverId && !edgeTouchesHover(e);
      // Gate lines curve outward so they don't look collinear with mid-belt V7s
      const isGate = e.kind === 'gate';
      ctx.beginPath();
      if (isGate) {
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        // Perpendicular bulge away from origin so path skirts the dominant belt
        const ox = mx - (this._activeDisk().cx || 0);
        const oy = my - (this._activeDisk().cy || 0);
        const olen = Math.hypot(ox, oy) || 1;
        const bulge = 28;
        const cpx = mx + (ox / olen) * bulge;
        const cpy = my + (oy / olen) * bulge;
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(cpx, cpy, b.x, b.y);
      } else {
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      if (e.kind === 'resolve' || e.kind === 'chain') {
        ctx.strokeStyle = lit
          ? 'rgba(126,184,218,' + (dim ? '0.08' : hoverId ? '0.95' : e.kind === 'chain' ? '0.45' : '0.55') + ')'
          : 'rgba(126,184,218,0.55)';
        ctx.lineWidth = (lit && hoverId ? 2.8 : e.kind === 'chain' ? 1.5 : 1.8) / z;
        ctx.setLineDash(e.kind === 'chain' ? [8 / z, 3 / z] : [5 / z, 4 / z]);
      } else if (e.kind === 'orbit') {
        ctx.strokeStyle = 'rgba(196,160,224,' + (hoverId ? '0.75' : '0.35') + ')';
        ctx.lineWidth = (hoverId ? 2 : 1.2) / z;
        ctx.setLineDash([2 / z, 4 / z]);
      } else if (e.kind === 'skeleton') {
        ctx.strokeStyle = lit
          ? 'rgba(232,201,138,' + (dim ? '0.06' : hoverId ? '0.75' : '0.22') + ')'
          : 'rgba(232,201,138,0.22)';
        ctx.lineWidth = (lit && hoverId ? 2 : 1.1) / z;
        ctx.setLineDash([]);
      } else {
        // gate
        ctx.strokeStyle = lit
          ? 'rgba(196,160,224,' + (dim ? '0.06' : hoverId ? '0.85' : '0.28') + ')'
          : 'rgba(196,160,224,0.28)';
        ctx.lineWidth = (lit && hoverId ? 2.2 : 1.1) / z;
        ctx.setLineDash([3 / z, 5 / z]);
      }
      if (dim) ctx.globalAlpha = 0.22;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
      if (dim || e.kind === 'skeleton') return;
      // arrow head toward target
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const ax = b.x - Math.cos(ang) * (b.r + 4);
      const ay = b.y - Math.sin(ang) * (b.r + 4);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax - Math.cos(ang - 0.4) * 7 / z, ay - Math.sin(ang - 0.4) * 7 / z);
      ctx.lineTo(ax - Math.cos(ang + 0.4) * 7 / z, ay - Math.sin(ang + 0.4) * 7 / z);
      ctx.closePath();
      ctx.fillStyle =
        e.kind === 'resolve' || e.kind === 'chain'
          ? 'rgba(126,184,218,' + (hoverId ? '0.95' : '0.7') + ')'
          : 'rgba(196,160,224,' + (hoverId ? '0.9' : '0.4') + ')';
      ctx.fill();
    });

    // While dragging a path chord, aim pads sit on these seats — skip node
    // discs so we don't paint double chords at the same coordinates.
    const dragging = this._mode === 'node';
    if (dragging) return;

    this.functionNodes.forEach((n) => {
      const col =
        n.role === 'secondary' || n.role === 'dominant'
          ? REGION.secondary
          : n.role === 'interchange'
            ? REGION.interchange
            : n.gate
              ? REGION.gate
              : REGION.diatonic;
      const isH = hoverId && n.id === hoverId;
      const isNeighbor =
        hoverId &&
        (this.functionChart.edges || []).some((e) => {
          if (bothWays) {
            return (
              (e.fromId === hoverId && e.toId === n.id) ||
              (e.toId === hoverId && e.fromId === n.id)
            );
          }
          return e.fromId === hoverId && e.toId === n.id;
        });
      const onPath = fo.showPath !== false && n.onPath;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r + (isH ? 3 : isNeighbor ? 1.5 : onPath ? 1 : 0), 0, Math.PI * 2);
      ctx.fillStyle = isH ? col.fill : 'rgba(12,10,8,0.85)';
      ctx.fill();
      ctx.strokeStyle = onPath && !isH ? '#e8c98a' : isNeighbor && !isH ? '#fff4d6' : col.fill;
      ctx.lineWidth = (isH ? 2.8 : onPath ? 2.4 : isNeighbor ? 2.2 : 1.6) / z;
      if (n.role === 'secondary' || n.role === 'dominant') ctx.setLineDash([3 / z, 2 / z]);
      else ctx.setLineDash([]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = isH ? '#0a0806' : 'rgba(230,220,200,0.92)';
      ctx.font = `bold ${9 / z}px DM Sans, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(n.label || n.chord.name, n.x, n.y - (n.roman ? 3 / z : 0));
      if (n.roman) {
        ctx.fillStyle = isH ? 'rgba(10,8,6,0.75)' : 'rgba(180,168,150,0.85)';
        ctx.font = `${7.5 / z}px DM Sans, sans-serif`;
        ctx.fillText(n.roman, n.x, n.y + 9 / z);
      }
    });
  };

  SpatialMap.prototype.setPath = function (chords, currentIndex) {
    if (this._mode === 'node') return;
    this.path = (chords || []).map((c) => ({ ...c }));
    this.current = currentIndex != null ? currentIndex : this.path.length - 1;
    // Disks follow keys present in the path so multi-key journeys stay visible
    this._rebuildDisks();
    this._layoutPath();
    this._emitTrajectory();
  };

  /**
   * Enter aim/drag mode on an existing path step (e.g. after edge insert).
   * Pointer capture is the caller's job if continuing a gesture.
   */
  SpatialMap.prototype.beginAimAtIndex = function (index) {
    if (index == null || index < 0 || !this.nodes || !this.nodes[index]) return false;
    // Ensure layout is current (insert just refreshed path)
    if (!this.nodes[index]) return false;
    const item = this.nodes[index];
    this._mode = 'node';
    this.camera.tx = this.camera.x;
    this.camera.ty = this.camera.y;
    this.camera.tz = this.camera.zoom;
    this._dragNode = item;
    this._dragOrigin = { x: item.x, y: item.y };
    this._dragPos = { x: item.x, y: item.y };
    this._snapSticky = null;
    this._moved = false;
    this.snapAlt = null;
    this._aimPreview = null;
    this.current = index;
    let alts = [];
    if (this.onRequestAlts) alts = this.onRequestAlts(index, item.chord) || [];
    this._layoutAlts(index, alts);
    this.canvas.style.cursor = 'grabbing';
    return true;
  };

  /**
   * Options sit on the same Chase seats the path will use after click.
   * (Old soft-pull toward selection made suggestions look local but the
   * written chord jumped to its true seat — far from the hollow ring.)
   */
  SpatialMap.prototype.setHorizon = function (items) {
    if (this._mode === 'node') return;
    const M = global.HLMusic;
    const disk = this._activeDisk();
    const anchor =
      this.current >= 0 && this.nodes[this.current]
        ? this.nodes[this.current]
        : { x: disk.cx || 0, y: disk.cy || 0, r: 14 };

    const orbitItems = (items || []).filter((it) => it.kind !== 'home').slice(0, 14);
    const used = [];

    this.horizon = orbitItems.map((it, i) => {
      const ch = it.chord;
      let x = disk.cx || 0;
      let y = disk.cy || 0;
      let onScale = false;
      let shell = false;
      let naturalX = x;
      let naturalY = y;

      if (ch) {
        // Same layout as path nodes so click lands under the suggestion
        const probe = {
          ...ch,
          localTonic: ch.localTonic != null ? ch.localTonic : this.origin.tonic,
          localMode: ch.localMode || this.origin.mode,
        };
        const pos = this._chordPos(probe, 0, 0);
        x = pos.x;
        y = pos.y;
        naturalX = pos.x;
        naturalY = pos.y;
        onScale = !!pos.onScale;
        shell = pos.shell;
      } else if (M && M.chaseChordPos) {
        // fallback
        const ang = -Math.PI / 2 + (i / Math.max(1, orbitItems.length)) * Math.PI * 2;
        x = (disk.cx || 0) + Math.cos(ang) * (disk.R || 100) * 0.74;
        y = (disk.cy || 0) + Math.sin(ang) * (disk.R || 100) * 0.66;
        naturalX = x;
        naturalY = y;
      }

      // Tiny de-stack only — keep near true seat (≤1 step)
      const deStack = (ox, oy, minD, step) => {
        let px = ox;
        let py = oy;
        for (let k = 0; k < 6; k++) {
          let hit = null;
          used.forEach((u) => {
            if (Math.hypot(px - u.x, py - u.y) < minD) hit = u;
          });
          (this.nodes || []).forEach((n) => {
            if (Math.hypot(px - n.x, py - n.y) < minD * 0.85) hit = n;
          });
          if (!hit) break;
          const ang =
            Math.atan2(py - (disk.cy || 0), px - (disk.cx || 0)) + 0.45 + k * 0.2;
          px = naturalX + Math.cos(ang) * step * (k + 1);
          py = naturalY + Math.sin(ang) * step * 0.88 * (k + 1);
        }
        return { x: px, y: py };
      };
      const stacked = deStack(x, y, 24, 11);
      x = stacked.x;
      y = stacked.y;

      const node = {
        chord: ch,
        kind: it.kind || 'direction',
        label: it.label || (ch && ch.name) || '?',
        job: it.job || '',
        route: it.route,
        modulateTo: it.modulateTo,
        x,
        y,
        naturalX,
        naturalY,
        r: 11,
        onScale,
        shell,
        _anchor: { x: anchor.x, y: anchor.y },
      };
      used.push(node);
      return node;
    });
  };

  SpatialMap.prototype.setCameraMode = function (mode) {
    this.cameraMode = mode === 'follow' || mode === 'fit' ? mode : 'home';
    this._applyCameraForMode();
  };

  SpatialMap.prototype.setPlaying = function (i) {
    this.playing = i;
    if (this.cameraMode === 'follow' && i >= 0 && this.nodes[i] && this._mode !== 'node') {
      this.camera.tx = this.nodes[i].x;
      this.camera.ty = this.nodes[i].y;
    }
  };

  SpatialMap.prototype.setAltPath = function (chords) {
    this.altPath = (chords || []).map((c) => ({ ...c }));
    this._layoutAltPath();
    this._computeDivergent();
    this._emitTrajectory();
  };

  /**
   * Chase circular-harmonic-scale position on the disk that owns this chord.
   * lane 1 = compare path (slight radial nudge).
   * stackPath: which sequence to count prior visits on (default gold path).
   */
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

  SpatialMap.prototype._separateNodes = function (nodes, minDist) {
    minDist = minDist || 32;
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let d = Math.hypot(dx, dy) || 0.01;
          if (d < minDist) {
            const push = ((minDist - d) / 2) * 0.7;
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
   * stamped to another key — that caused Em→B minor disk and Chase≠Function).
   */
  SpatialMap.prototype._pathShouldUseActiveWheel = function (ch) {
    if (!ch) return true;
    const writeT = this.origin.tonic;
    const writeM = this.origin.mode || 'minor';
    if (ch.localTonic == null) return true;
    if (
      ch.localTonic === writeT &&
      (ch.localMode || writeM) === writeM
    ) {
      return true;
    }
    const M = global.HLMusic;
    if (M && M.seatForChord) {
      const hit = M.seatForChord(ch, writeT, writeM);
      // On-scale in write home (incl. quality variants on a scale root)
      if (hit && hit.onScale) return true;
    }
    return false;
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
    let rad = R * 0.72;
    if (hit.seat.role === 'tonic' && hit.onScale && !hit.shell) rad = R * 0.42;
    else if (hit.shell === 'secondary') rad = R * 0.92;
    else if (hit.shell === 'variant') rad = R * 0.82;
    else if (hit.shell === true) rad = R * 1.12;
    const ang = hit.seat.angle;
    let x = cx + Math.cos(ang) * rad;
    let y = cy + Math.sin(ang) * rad * 0.88;
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
      return {
        chord: ch,
        x: pos.x,
        y: pos.y,
        r,
        i,
        onScale: pos.onScale,
        shell: pos.shell,
        seat: pos.seat,
      };
    });
    // Never soft-separate path off seats — that made Chase ≠ Function
    this._layoutAltPath();
    this._computeDivergent();
    this._rebuildScaleSeats();
    this._rebuildGhostHalo();
    // View switch / explicit keep: don't yank the wheel to Home lock
    if (this._mode !== 'node' && !this._keepCameraOnce) this._applyCameraForMode();
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
    // Prefer diatonic seat over V7/borrow with same root (path Em → iii, not a shell)
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
   * Blue compare path — both views:
   * 1) same root as gold step → sit beside gold (parallel maj/min)
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
      //    same quality → under gold (ghost, not drawn); quality flip → beside
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
    // Soft only — hard _separateNodes flung blue nodes into empty corners
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
    // Never clobber zoom while switching Chase ↔ Function
    if (this._keepCameraOnce) return;
    const keepZ = this.camera.tz > 0 ? this.camera.tz : 1;
    if (this.cameraMode === 'home' || !this.nodes.length) {
      this.camera.tx = 0;
      this.camera.ty = 0;
      // Keep zoom — forcing tz=1 made every refresh jump to a different scale
      this.camera.tz = keepZ;
      return;
    }
    if (this.cameraMode === 'follow') {
      const n = this.nodes[Math.max(0, Math.min(this.current, this.nodes.length - 1))];
      if (n) {
        this.camera.tx = n.x;
        this.camera.ty = n.y;
        // Preserve scale; only re-centre on the step
        this.camera.tz = keepZ;
      }
      return;
    }
    // Fit: re-frame path, but keep zoom if sticky
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
  SpatialMap.prototype.snapshotCamera = function () {
    return {
      tx: this.camera.tx,
      ty: this.camera.ty,
      tz: this.camera.tz,
      x: this.camera.x,
      y: this.camera.y,
      zoom: this.camera.zoom,
    };
  };

  SpatialMap.prototype.restoreCamera = function (snap, opts) {
    if (!snap) return;
    opts = opts || {};
    this.camera.tx = snap.tx;
    this.camera.ty = snap.ty;
    this.camera.tz = snap.tz > 0 ? snap.tz : 1;
    // Hard-snap zoom so Chase↔Function never eases to a different scale
    if (opts.snap !== false) {
      this.camera.x = snap.tx;
      this.camera.y = snap.ty;
      this.camera.zoom = this.camera.tz;
    } else {
      this.camera.x = snap.x;
      this.camera.y = snap.y;
      this.camera.zoom = snap.zoom > 0 ? snap.zoom : this.camera.tz;
    }
  };

  /** Analyze path shape for caption + swing suggestions */
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
    if (swing >= 0.45) caption = 'Strong left–right swing';
    else if (swing >= 0.25) caption = 'Some side-to-side motion';
    else caption = 'Path stays on one side of home';

    if (arch >= 0.5) caption += ' · arch out then in';
    if (returns) caption += ' · returns toward home';
    else if (outMax > 80) caption += ' · stays out far';

    if (this.altNodes.length && this.divergent.length) {
      caption += ' · variation differs at step(s) ' + this.divergent.map((i) => i + 1).join(', ');
    } else if (this.altNodes.length) {
      caption += ' · variation nearly parallel';
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
        x: x,
        y: y,
        r: useFn
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
        let q = (s.qualities && s.qualities[0]) || 'maj';
        if (s.role === 'dom') q = 'dom7';
        const ch = M.makeChord(s.root, q, {
          region: 'diatonic',
          roman: s.roman,
          tag: 'chase-seat',
        });
        // Same radii as path seats + Function diatonic ring
        const radius = s.role === 'tonic' ? disk.R * 0.42 : disk.R * 0.72;
        const x = disk.cx + Math.cos(s.angle) * radius;
        const y = disk.cy + Math.sin(s.angle) * radius * 0.88;
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

  SpatialMap.prototype.screenToWorld = function (sx, sy) {
    return {
      x: (sx - this.w / 2) / this.camera.zoom + this.camera.x,
      y: (sy - this.h / 2) / this.camera.zoom + this.camera.y,
    };
  };

  /**
   * Control point for path edges — MUST match drawing (_draw path edges).
   * Hit-testing used a straight line while paint used a curve → clicks missed
   * the visible edge or fired on the wrong segment.
   */
  SpatialMap.prototype._edgeControl = function (a, b) {
    const ax = a.x;
    const ay = a.y;
    const bx = b.x;
    const by = b.y;
    return {
      ax,
      ay,
      bx,
      by,
      mx: (ax + bx) / 2 + (by - ay) * 0.08,
      my: (ay + by) / 2 - (bx - ax) * 0.08,
    };
  };

  SpatialMap.prototype._quadPoint = function (c, t) {
    const omt = 1 - t;
    return {
      x: omt * omt * c.ax + 2 * omt * t * c.mx + t * t * c.bx,
      y: omt * omt * c.ay + 2 * omt * t * c.my + t * t * c.by,
    };
  };

  /**
   * Closest point on the drawn quadratic edge (samples).
   * Only mid-span counts for insert (avoid fighting path nodes at ends).
   */
  SpatialMap.prototype._closestOnEdge = function (a, b, wx, wy) {
    const c = this._edgeControl(a, b);
    const span = Math.hypot(b.x - a.x, b.y - a.y);
    // Tiny / stacked edges: don't offer insert (would look like teleport)
    if (span < 18) return null;
    let bestT = 0.5;
    let bestD = Infinity;
    let bestP = { x: c.mx, y: c.my };
    const steps = 28;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // Mid-segment only — endpoints belong to path nodes
      if (t < 0.18 || t > 0.82) continue;
      const p = this._quadPoint(c, t);
      const d = Math.hypot(wx - p.x, wy - p.y);
      if (d < bestD) {
        bestD = d;
        bestT = t;
        bestP = p;
      }
    }
    return { t: bestT, d: bestD, x: bestP.x, y: bestP.y, span };
  };

  SpatialMap.prototype._hitEdge = function (sx, sy, opts) {
    opts = opts || {};
    const w =
      opts.world ||
      this.screenToWorld(sx, sy);
    // ~12px screen — constant feel at any zoom
    const thresh = opts.thresh != null ? opts.thresh : 12 / this.camera.zoom;
    let best = null;
    for (let i = 0; i < this.nodes.length - 1; i++) {
      const a = this.nodes[i];
      const b = this.nodes[i + 1];
      const hit = this._closestOnEdge(a, b, w.x, w.y);
      if (!hit || hit.d > thresh) continue;
      if (!best || hit.d < best.d) {
        best = {
          type: 'edge',
          afterIndex: i,
          x: hit.x,
          y: hit.y,
          d: hit.d,
          t: hit.t,
        };
      }
    }
    return best;
  };

  /**
   * Score-based hit test: pick the closest target so edges / seats / options
   * don't steal from each other based on arbitrary check order.
   * Lower score wins. Small type bias breaks ties predictably.
   */
  SpatialMap.prototype._hit = function (sx, sy) {
    const w = this.screenToWorld(sx, sy);
    // While dragging a path chord, only aim targets matter
    if (this._mode === 'node' && this.alts.length) {
      for (let i = this.alts.length - 1; i >= 0; i--) {
        const a = this.alts[i];
        if (Math.hypot(w.x - a.x, w.y - a.y) <= 28) return { type: 'alt', item: a };
      }
      return null;
    }

    const cands = [];
    const add = (hit, d, bias) => {
      if (d == null || !(d <= 1e5)) return;
      cands.push({ hit: hit, d: d, score: d + (bias || 0) });
    };

    // Path nodes — highest priority when under the cursor
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      const d = Math.hypot(w.x - n.x, w.y - n.y);
      if (d <= (n.r || 14) + 6) add({ type: 'path', item: n }, d, -4);
    }

    // Path edges (curve mid-span)
    const edge = this._hitEdge(sx, sy, { world: w });
    if (edge) {
      add(
        { type: 'edge', afterIndex: edge.afterIndex, x: edge.x, y: edge.y, d: edge.d },
        edge.d,
        1.5
      );
    }

    // Function neighbourhood nodes (click = write like From here)
    if (this.mapView === 'function' && this.functionNodes && this.functionNodes.length) {
      for (let i = 0; i < this.functionNodes.length; i++) {
        const fn = this.functionNodes[i];
        const d = Math.hypot(w.x - fn.x, w.y - fn.y);
        if (d <= (fn.r || 12) + 6) {
          const item = {
            chord: fn.chord,
            kind:
              fn.role === 'secondary' || fn.role === 'dominant'
                ? 'secondary'
                : fn.role === 'interchange'
                  ? 'interchange'
                  : fn.gate
                    ? 'gate'
                    : 'direction',
            label: fn.label,
            job: fn.roman || fn.role,
            role: fn.role,
            functionNodeId: fn.id,
          };
          // Dominant / secondary: write V7 → target as a 2-step package
          if (
            (fn.role === 'secondary' || fn.role === 'dominant') &&
            fn.resolvesToId
          ) {
            const target = this.functionNodes.find((x) => x.id === fn.resolvesToId);
            if (target && target.chord) {
              item.route = [fn.chord, target.chord];
              item.label = fn.label + ' → ' + (target.label || target.chord.name);
            }
          }
          add({ type: 'functionNode', item: item }, d, 0.2);
        }
      }
    }

    // Horizon options (hollow rings) — Chase next-move dots
    if (this.showHorizon && this.mapView !== 'function') {
      for (let i = 0; i < this.horizon.length; i++) {
        const h = this.horizon[i];
        if (h.kind === 'home') continue;
        const d = Math.hypot(w.x - h.x, w.y - h.y);
        if (d <= (h.r || 10) + 8) add({ type: 'horizon', item: h }, d, 0.5);
      }
    }

    // Chase scale seats (hidden as primary targets in Function view)
    if (this.scaleSeats && this.scaleSeats.length && this.mapView !== 'function') {
      for (let i = 0; i < this.scaleSeats.length; i++) {
        const s = this.scaleSeats[i];
        const d = Math.hypot(w.x - s.x, w.y - s.y);
        const rr = (s.r || 16) + (s.activeDisk ? 5 : 3);
        if (d <= rr) add({ type: 'seat', item: s }, d, s.activeDisk ? 2 : 3.5);
      }
    }

    // Active home centre
    const act = this._activeDisk();
    {
      const d = Math.hypot(w.x - (act.cx || 0), w.y - (act.cy || 0));
      if (d <= 28) add({ type: 'home' }, d, 1);
    }

    // Inactive disk centres (Chase only — Function is same-key chart)
    if (this.mapView !== 'function') {
      for (let i = 0; i < (this.disks || []).length; i++) {
        const disk = this.disks[i];
        if (disk.active) continue;
        const d = Math.hypot(w.x - (disk.cx || 0), w.y - (disk.cy || 0));
        if (d <= 22) add({ type: 'diskHome', item: disk }, d, 2);
      }
    }

    // Ghost establish-home pads (Chase pivot halo)
    if (this.mapView === 'chase' && this.ghostOptions && this.ghostOptions.length) {
      for (let i = 0; i < this.ghostOptions.length; i++) {
        const g = this.ghostOptions[i];
        const d = Math.hypot(w.x - g.x, w.y - g.y);
        if (d <= (g.r || 14) + 6) add({ type: 'ghostOption', item: g }, d, 0.3);
      }
    }
    // Ghost disk face (weaker than pads)
    if (this.mapView === 'chase' && this.ghostDisks && this.ghostDisks.length) {
      for (let i = 0; i < this.ghostDisks.length; i++) {
        const g = this.ghostDisks[i];
        const d = Math.hypot(w.x - (g.cx || 0), w.y - (g.cy || 0));
        if (d <= (g.R || 60) * 0.55) add({ type: 'ghostDisk', item: g }, d, 4);
      }
    }

    // Compare-path alt nodes
    if (this.showAlt && this.altNodes && this.altNodes.length) {
      for (let i = 0; i < this.altNodes.length; i++) {
        const n = this.altNodes[i];
        const d = Math.hypot(w.x - n.x, w.y - n.y);
        if (d <= (n.r || 10) + 5) add({ type: 'altNode', item: n }, d, 4);
      }
    }

    if (!cands.length) return null;
    cands.sort((a, b) => a.score - b.score || a.d - b.d);
    return cands[0].hit;
  };

  SpatialMap.prototype._down = function (e) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const hit = this._hit(sx, sy);
    this._moved = false;
    this.snapAlt = null;

    if (hit && hit.type === 'path') {
      this._mode = 'node';
      // Lock camera to current visual pose so aim coords stay stable
      this.camera.tx = this.camera.x;
      this.camera.ty = this.camera.y;
      this.camera.tz = this.camera.zoom;
      this._dragNode = hit.item;
      this._dragOrigin = { x: hit.item.x, y: hit.item.y };
      this._dragPos = { x: hit.item.x, y: hit.item.y };
      this._snapSticky = null; // hysteresis for aim target
      this.current = hit.item.i;
      // Light select only — full refreshUI rebuilds layout mid-drag (jitter)
      if (this.onSelectPath) this.onSelectPath(hit.item.i, hit.item.chord, { deferUI: true });
      let alts = [];
      if (this.onRequestAlts) alts = this.onRequestAlts(hit.item.i, hit.item.chord) || [];
      this._layoutAlts(hit.item.i, alts);
      this.canvas.setPointerCapture(e.pointerId);
      this.canvas.style.cursor = 'grabbing';
      return;
    }
    if (hit && hit.type === 'seat') {
      if (this.onSelectSeat) this.onSelectSeat(hit.item);
      return;
    }
    if (hit && hit.type === 'functionNode') {
      // Same write path as From here / horizon
      if (this.onSelectHorizon) this.onSelectHorizon(hit.item);
      return;
    }
    if (hit && hit.type === 'horizon') {
      if (this.onSelectHorizon) this.onSelectHorizon(hit.item);
      return;
    }
    if (hit && hit.type === 'home') {
      if (this.onSelectHome) this.onSelectHome();
      return;
    }
    if (hit && hit.type === 'diskHome') {
      // Click centre of a previous-key disk → re-activate that write home
      if (this.onSelectDiskHome) this.onSelectDiskHome(hit.item);
      else if (this.onSelectHome && hit.item && hit.item.active) this.onSelectHome();
      return;
    }
    if (hit && hit.type === 'ghostOption') {
      if (this.onSelectGhostOption) this.onSelectGhostOption(hit.item);
      return;
    }
    if (hit && hit.type === 'ghostDisk') {
      // Soft select first establish option (tonic) if present
      const opts = (this.ghostOptions || []).filter(
        (o) => o.ghostDisk === hit.item || (o.ghostDisk && hit.item && o.ghostDisk.tonic === hit.item.tonic && o.ghostDisk.mode === hit.item.mode)
      );
      const pick = opts.find((o) => o.id === 'tonic') || opts[0];
      if (pick && this.onSelectGhostOption) this.onSelectGhostOption(pick);
      return;
    }
    if (hit && hit.type === 'edge' && this.onInsertBetween) {
      // Insert a bridge node, then enter aim so the same gesture can drag it
      // onto a sensible seat (or release to keep the default bridge).
      const newIndex = this.onInsertBetween(hit.afterIndex);
      if (newIndex != null && this.beginAimAtIndex) {
        if (this.beginAimAtIndex(newIndex)) {
          this.canvas.setPointerCapture(e.pointerId);
          this.canvas.style.cursor = 'grabbing';
        }
      }
      return;
    }
    if (hit && hit.type === 'altNode') {
      if (this.onSelectAltNode) this.onSelectAltNode(hit.item);
      return;
    }
    this._mode = 'pan';
    this._last = { x: e.clientX, y: e.clientY };
    this.canvas.setPointerCapture(e.pointerId);
  };

  SpatialMap.prototype._move = function (e) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (this._mode === 'pan' && this._last) {
      this.camera.tx -= (e.clientX - this._last.x) / this.camera.zoom;
      this.camera.ty -= (e.clientY - this._last.y) / this.camera.zoom;
      this.camera.x = this.camera.tx;
      this.camera.y = this.camera.ty;
      this._last = { x: e.clientX, y: e.clientY };
      this._moved = true;
      return;
    }

    if (this._mode === 'node' && this._dragNode) {
      const w = this.screenToWorld(sx, sy);
      this._moved = true;
      // Pure pointer aim — no soft magnet (that pulled the crosshair every frame
      // and made the scene feel like it was shaking). Hard lock only.
      let best = null;
      let bestScore = Infinity;
      let bestRawD = Infinity;
      this.alts.forEach((a) => {
        const d = Math.hypot(w.x - a.x, w.y - a.y);
        const bias = a.tier === 'good' ? -10 : a.tier === 'ok' ? -3 : 4;
        // Sticky: keep current lock unless clearly closer to another pad
        const sticky = this._snapSticky && this._snapSticky === a ? -16 : 0;
        const scored = d + bias + sticky;
        if (scored < bestScore) {
          bestScore = scored;
          bestRawD = d;
          best = a;
        }
      });
      const lockR =
        this.snapRadius *
        (best && best.tier === 'weak' ? 0.7 : best && best.tier === 'good' ? 1.12 : 1);
      // Stay locked a bit further out once sticky (hysteresis on exit)
      const exitR =
        this._snapSticky && best === this._snapSticky
          ? lockR * 1.22
          : lockR;
      if (!best || bestRawD > exitR) best = null;
      this._snapSticky = best;
      // Magnet: follow pointer freely; only snap dead-centre when locked
      this._dragPos = best
        ? { x: best.x, y: best.y }
        : { x: w.x, y: w.y };
      const prev = this.snapAlt;
      this.snapAlt = best;
      this._aimPreview = best
        ? {
            chord: best.chord,
            x: best.x,
            y: best.y,
            label: best.label,
            role: best.role || '',
            tier: best.tier || 'ok',
            score: best.score,
            aimMode: best.aimMode || '',
          }
        : null;
      if (best !== prev && this.onAimChange) {
        const i = this._dragNode.i;
        // Prefer app-level neighbors (loop / building aware)
        let prevChord = this.nodes[i - 1] && this.nodes[i - 1].chord;
        let nextChord = this.nodes[i + 1] && this.nodes[i + 1].chord;
        let aimMode = (best && best.aimMode) || '';
        if (typeof global.HLApp !== 'undefined' && global.HLApp.aimNeighbors) {
          const nbr = global.HLApp.aimNeighbors(i);
          prevChord = nbr.prev;
          nextChord = nbr.next;
          aimMode = aimMode || nbr.mode || '';
        }
        this.onAimChange(i, best, {
          prevChord: prevChord,
          nextChord: nextChord,
          originChord: this._dragNode.chord,
          aimMode: aimMode,
        });
      }
      this.canvas.style.cursor = best ? 'pointer' : 'crosshair';
      return;
    }

    const hit = this._hit(sx, sy);
    const prev = this.hover;
    this.hover = hit;
    if (hit && hit.type === 'edge') this.canvas.style.cursor = 'copy';
    else this.canvas.style.cursor = hit ? 'pointer' : 'grab';
    if (hit && hit.type === 'horizon' && (!prev || prev.item !== hit.item)) {
      if (this.onHoverHorizon) this.onHoverHorizon(hit.item);
    }
    if (hit && hit.type === 'seat' && (!prev || prev.item !== hit.item)) {
      if (this.onHoverSeat) this.onHoverSeat(hit.item);
      this.canvas.style.cursor = 'pointer';
    }
    if (hit && hit.type === 'functionNode' && (!prev || prev.item !== hit.item)) {
      if (this.onHoverHorizon) this.onHoverHorizon(hit.item);
      this.canvas.style.cursor = 'pointer';
    }
    if (hit && hit.type === 'home' && (!prev || prev.type !== 'home')) {
      if (this.onHoverHome) this.onHoverHome();
      this.canvas.style.cursor = 'pointer';
    }
    if (hit && hit.type === 'ghostOption' && (!prev || prev.item !== hit.item)) {
      if (this.onHoverGhostOption) this.onHoverGhostOption(hit.item);
      this.canvas.style.cursor = 'pointer';
    }
    if (hit && hit.type === 'ghostDisk') {
      this.canvas.style.cursor = 'pointer';
    }
  };

  SpatialMap.prototype._up = function () {
    const wasNode = this._mode === 'node';
    const dragI = this._dragNode && this._dragNode.i;
    const dragCh = this._dragNode && this._dragNode.chord;
    if (wasNode && this._dragNode) {
      if (this._moved) {
        // Only commit if aimed at a target — no free-space "teleport"
        if (this.snapAlt) {
          const meta = {
            prevChord: this.nodes[this._dragNode.i - 1] && this.nodes[this._dragNode.i - 1].chord,
            nextChord: this.nodes[this._dragNode.i + 1] && this.nodes[this._dragNode.i + 1].chord,
            pullNeighbors: false, // neighbor tug is explicit later / shift
            role: this.snapAlt.role || '',
          };
          if (this.onPullChord) {
            this.onPullChord(this._dragNode.i, this.snapAlt.chord, meta);
          } else if (this.onSwapChord) {
            this.onSwapChord(this._dragNode.i, this.snapAlt.chord);
          }
        } else if (this.onAimChange) {
          // cancel aim
          this.onAimChange(this._dragNode.i, null, {});
        }
      } else if (this.onSelectPath) {
        this.onSelectPath(this._dragNode.i, this._dragNode.chord);
      }
    }
    this._mode = null;
    this._dragNode = null;
    this._dragOrigin = null;
    this._dragPos = null;
    this._snapSticky = null;
    this._last = null;
    this.alts = [];
    this.snapAlt = null;
    this._aimPreview = null;
    this.canvas.style.cursor = 'grab';
    // After aim, catch up UI that we deferred at pointer-down
    if (wasNode && dragCh && this.onSelectPath && this._moved) {
      // pull already refreshed via afterEdit; only need select refresh if cancelled
    } else if (wasNode && dragCh && this.onSelectPath && !this._moved) {
      // click-select already requested full UI above
    }
  };

  /** Nearest sensible map position among alts + path-compatible palette ghosts */
  SpatialMap.prototype.nearestSensible = function (wx, wy, pathIndex) {
    let best = null;
    let bestD = Infinity;
    const consider = (chord, label, x, y) => {
      const d = (wx - x) * (wx - x) + (wy - y) * (wy - y);
      if (d < bestD) {
        bestD = d;
        best = { chord, label: label || chord.name, x, y, dist: Math.sqrt(d) };
      }
    };
    this.alts.forEach((a) => consider(a.chord, a.label, a.x, a.y));
    // Also sample common roots around home
    const M = global.HLMusic;
    if (M) {
      const quals = ['min', 'maj', 'dom7', 'min7', 'maj7'];
      for (let r = 0; r < 12; r++) {
        quals.forEach((q) => {
          const ch = M.makeChord(r, q, { region: 'diatonic' });
          const pos = this._chordPos(ch, pathIndex || 0, 0);
          consider(ch, ch.name, pos.x, pos.y);
        });
      }
    }
    // Only accept if reasonably close (not random far drop)
    if (best && best.dist < 90) return best;
    return best; // still return nearest even if far — caller uses strength
  };

  SpatialMap.prototype.start = function () {
    const loop = () => {
      requestAnimationFrame(loop);
      this.pulseT += 0.05;
      const cam = this.camera;
      // Freeze camera while panning or aiming a path chord. If we keep lerping
      // during drag, screenToWorld drifts every frame (mouse still → world moves)
      // and the whole map looks like it is shaking.
      if (this._mode === 'pan' || this._mode === 'node') {
        cam.x = cam.tx;
        cam.y = cam.ty;
        cam.zoom = cam.tz;
      } else {
        cam.x += (cam.tx - cam.x) * 0.12;
        cam.y += (cam.ty - cam.y) * 0.12;
        cam.zoom += (cam.tz - cam.zoom) * 0.12;
      }
      this.draw();
    };
    loop();
  };

  SpatialMap.prototype._edgeStyle = function (a, b) {
    const dx = Math.abs(a.chord.root - b.chord.root);
    const rootDist = Math.min(dx, 12 - dx);
    const cross = a.x * b.x < 0;
    // Motion type colour
    if (rootDist === 6) return { color: 'rgba(232,93,76,0.85)', w: 3.2, kind: 'tritone' };
    if (rootDist === 5 || rootDist === 7) return { color: 'rgba(126,184,218,0.85)', w: 3, kind: 'fifth' };
    if (rootDist <= 2) return { color: 'rgba(125,186,146,0.8)', w: 2.6, kind: 'step' };
    if (cross) return { color: 'rgba(232,201,138,0.9)', w: 3.4, kind: 'swing' };
    return { color: 'rgba(196,165,116,0.55)', w: 2.5, kind: 'leap' };
  };

  SpatialMap.prototype.draw = function () {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    if (!w) return;

    const g = ctx.createRadialGradient(w * 0.5, h * 0.42, 10, w * 0.5, h * 0.5, Math.max(w, h) * 0.7);
    g.addColorStop(0, '#1a1410');
    g.addColorStop(0.5, '#0c0b0a');
    g.addColorStop(1, '#050505');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(this.camera.zoom, this.camera.zoom);
    ctx.translate(-this.camera.x, -this.camera.y);

    const M = global.HLMusic;
    if (!this.disks || !this.disks.length) this._rebuildDisks(false);

    // ── Chase disks (circular harmonic scales) ──
    // Function view = same-key chart only — hide other-key disks (they looked
    // like a second graph lighting up next to the centred Function chart).
    // Draw inactive keys first, then active write-home disk
    const disksDraw = (this.disks || [])
      .filter((d) => this.mapView !== 'function' || d.active)
      .slice()
      .sort((a, b) => (a.active ? 1 : 0) - (b.active ? 1 : 0));
    disksDraw.forEach((disk) => {
      const active = !!disk.active;
      // Inactive disks must read as full second charts, not a faint ghost
      const alpha = active ? 1 : 0.72;
      ctx.globalAlpha = alpha;
      const cx = disk.cx || 0;
      const cy = disk.cy || 0;
      const dR = disk.R || 120;

      // Disk face
      const gdisk = ctx.createRadialGradient(cx, cy, dR * 0.1, cx, cy, dR * 1.15);
      gdisk.addColorStop(0, active ? 'rgba(40,32,24,0.5)' : 'rgba(30,28,40,0.35)');
      gdisk.addColorStop(0.7, active ? 'rgba(20,16,12,0.25)' : 'rgba(16,14,22,0.2)');
      gdisk.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gdisk;
      ctx.beginPath();
      ctx.ellipse(cx, cy, dR * 1.12, dR * 1.12 * 0.88, 0, 0, Math.PI * 2);
      ctx.fill();

      // Scale ring + shell ring
      ctx.beginPath();
      ctx.ellipse(cx, cy, dR * 0.72, dR * 0.72 * 0.88, 0, 0, Math.PI * 2);
      ctx.strokeStyle = active ? 'rgba(232,201,138,0.35)' : 'rgba(126,184,218,0.25)';
      ctx.lineWidth = (active ? 2 : 1.2) / this.camera.zoom;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(cx, cy, dR * 1.12, dR * 1.12 * 0.88, 0, 0, Math.PI * 2);
      ctx.strokeStyle = active ? 'rgba(212,120,106,0.2)' : 'rgba(126,184,218,0.12)';
      ctx.lineWidth = 1 / this.camera.zoom;
      ctx.setLineDash([4 / this.camera.zoom, 5 / this.camera.zoom]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Harmonic-scale seats (Chase) — skip active disk in Function view.
      // While dragging: draw seats very dim under aim pads (don't remove them —
      // popping seats on/off felt like the map shaking).
      const seats =
        M && M.circularHarmonicScale && !(this.mapView === 'function' && active)
          ? M.circularHarmonicScale(disk.tonic, disk.mode)
          : [];
      const dragDim = this._mode === 'node' && active;
      seats.forEach((s) => {
        const rad = s.role === 'tonic' ? dR * 0.42 : dR * 0.72;
        const sx = cx + Math.cos(s.angle) * rad;
        const sy = cy + Math.sin(s.angle) * rad * 0.88;
        const seatHover =
          !dragDim &&
          this.hover &&
          this.hover.type === 'seat' &&
          this.hover.item &&
          this.hover.item.root === s.root &&
          this.hover.item.activeDisk === active;
        const seatR = (active ? 20 : 11) / this.camera.zoom;
        ctx.beginPath();
        ctx.arc(sx, sy, seatR * (seatHover ? 1.2 : dragDim ? 0.85 : 1), 0, Math.PI * 2);
        if (dragDim) {
          ctx.fillStyle = 'rgba(180,168,150,0.06)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(232,201,138,0.12)';
          ctx.lineWidth = 1 / this.camera.zoom;
          ctx.stroke();
        } else if (seatHover && active) {
          ctx.fillStyle = 'rgba(232,201,138,0.45)';
          ctx.fill();
          ctx.strokeStyle = '#e8c98a';
          ctx.lineWidth = 2 / this.camera.zoom;
          ctx.stroke();
        } else {
          ctx.fillStyle =
            s.role === 'tonic'
              ? 'rgba(232,201,138,0.35)'
              : s.role === 'dom'
                ? 'rgba(232,93,76,0.28)'
                : 'rgba(180,168,150,0.12)';
          ctx.fill();
          ctx.strokeStyle = active ? 'rgba(232,201,138,0.45)' : 'rgba(126,184,218,0.3)';
          ctx.lineWidth = 1.2 / this.camera.zoom;
          ctx.stroke();
        }
        if (!dragDim) {
          ctx.fillStyle = active
            ? seatHover
              ? '#fff4d6'
              : 'rgba(230,220,200,0.9)'
            : 'rgba(160,170,190,0.55)';
          ctx.font = `bold ${12 / this.camera.zoom}px DM Sans, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(s.roman, sx, sy - (active ? 2 / this.camera.zoom : 0));
          if (active) {
            const nm = M.noteName(s.root);
            ctx.fillStyle = seatHover
              ? 'rgba(255,244,214,0.95)'
              : 'rgba(200,184,160,0.75)';
            ctx.font = `${9 / this.camera.zoom}px DM Sans, sans-serif`;
            ctx.fillText(nm, sx, sy + 12 / this.camera.zoom);
          }
        }
      });

      // Disk centre label
      const isMin =
        disk.mode === 'minor' ||
        (M && M.MODES && M.MODES[disk.mode] && M.MODES[disk.mode].romanBase === 'minor');
      const homeName = M ? M.noteName(disk.tonic) + (isMin ? 'm' : '') : disk.label || '';
      ctx.beginPath();
      ctx.arc(cx, cy, active ? 17 : 13, 0, Math.PI * 2);
      ctx.fillStyle = active ? '#e8c98a' : 'rgba(126,184,218,0.5)';
      ctx.fill();
      ctx.strokeStyle = active ? 'rgba(255,244,214,0.7)' : 'rgba(180,200,230,0.4)';
      ctx.lineWidth = 1.5 / this.camera.zoom;
      ctx.stroke();
      ctx.fillStyle = active ? '#1a1410' : 'rgba(10,10,16,0.9)';
      ctx.font = `bold ${active ? 12 : 10}px DM Sans, sans-serif`;
      // font size with zoom
      ctx.font = `bold ${(active ? 12 : 10) / this.camera.zoom}px DM Sans, sans-serif`;
      ctx.fillText(homeName, cx, cy - 1 / this.camera.zoom);
      ctx.font = `${7.5 / this.camera.zoom}px DM Sans, sans-serif`;
      ctx.fillStyle = active ? 'rgba(26,20,16,0.65)' : 'rgba(200,220,255,0.7)';
      ctx.fillText(active ? 'WRITE' : 'KEY', cx, cy + 11 / this.camera.zoom);

      if (!active) {
        ctx.fillStyle = 'rgba(160,180,210,0.55)';
        ctx.font = `${8 / this.camera.zoom}px Crimson Text, Georgia, serif`;
        ctx.fillText('traveled', cx, cy + dR * 0.95);
      } else {
        ctx.fillStyle = 'rgba(180,168,150,0.4)';
        ctx.font = `${8 / this.camera.zoom}px Crimson Text, Georgia, serif`;
        ctx.fillText('write home', cx, cy + dR * 1.18);
      }

      ctx.globalAlpha = 1;
    });

    // ── Ghost adjacent-key halo (Chase only) ──
    if (this.mapView === 'chase' && this.ghostDisks && this.ghostDisks.length) {
      const z = this.camera.zoom || 1;
      this.ghostDisks.forEach((g) => {
        const gcx = g.cx || 0;
        const gcy = g.cy || 0;
        const gR = g.R || 80;
        const hot =
          this.hover &&
          ((this.hover.type === 'ghostDisk' && this.hover.item === g) ||
            (this.hover.type === 'ghostOption' &&
              this.hover.item &&
              this.hover.item.ghostDisk === g));
        ctx.globalAlpha = hot ? 0.85 : 0.55;
        ctx.beginPath();
        ctx.ellipse(gcx, gcy, gR * 1.05, gR * 1.05 * 0.88, 0, 0, Math.PI * 2);
        ctx.strokeStyle = hot ? 'rgba(167,139,250,0.75)' : 'rgba(167,139,250,0.35)';
        ctx.lineWidth = (hot ? 2.2 : 1.4) / z;
        ctx.setLineDash([5 / z, 5 / z]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.ellipse(gcx, gcy, gR * 0.72, gR * 0.72 * 0.88, 0, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(167,139,250,0.2)';
        ctx.lineWidth = 1 / z;
        ctx.stroke();
        // Soft face
        const gg = ctx.createRadialGradient(gcx, gcy, gR * 0.1, gcx, gcy, gR);
        gg.addColorStop(0, 'rgba(40, 32, 55, 0.35)');
        gg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gg;
        ctx.beginPath();
        ctx.ellipse(gcx, gcy, gR, gR * 0.88, 0, 0, Math.PI * 2);
        ctx.fill();
        // Key label
        const isMin =
          g.mode === 'minor' ||
          (M && M.MODES && M.MODES[g.mode] && M.MODES[g.mode].romanBase === 'minor');
        const nm = M ? M.noteName(g.tonic) + (isMin ? 'm' : '') : g.label || '?';
        ctx.fillStyle = hot ? '#e9d5ff' : 'rgba(196,180,230,0.85)';
        ctx.font = `bold ${11 / z}px DM Sans, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(nm, gcx, gcy - gR * 0.95);
        ctx.fillStyle = 'rgba(167,139,250,0.7)';
        ctx.font = `${8 / z}px DM Sans, sans-serif`;
        ctx.fillText(g.relation || 'nearby key', gcx, gcy - gR * 0.95 + 12 / z);
      });
      // Establish-home pads
      (this.ghostOptions || []).forEach((opt) => {
        const isH =
          this.hover &&
          this.hover.type === 'ghostOption' &&
          this.hover.item === opt;
        ctx.globalAlpha = isH ? 0.95 : 0.8;
        ctx.beginPath();
        ctx.arc(opt.x, opt.y, (opt.r || 14) * (isH ? 1.15 : 1), 0, Math.PI * 2);
        ctx.fillStyle = isH ? 'rgba(167,139,250,0.75)' : 'rgba(20,16,28,0.88)';
        ctx.fill();
        ctx.strokeStyle = isH ? '#e9d5ff' : 'rgba(167,139,250,0.7)';
        ctx.lineWidth = (isH ? 2.4 : 1.6) / z;
        ctx.stroke();
        ctx.fillStyle = isH ? '#1a1020' : '#e9d5ff';
        ctx.font = `bold ${9 / z}px DM Sans, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // Short label: roman-ish job or name
        const short =
          opt.id === 'tonic'
            ? opt.label || 'I'
            : opt.id === 'cadence'
              ? 'V7→I'
              : (opt.label || '?').slice(0, 8);
        ctx.fillText(short, opt.x, opt.y - (opt.job ? 3 / z : 0));
        if (opt.job && isH) {
          ctx.fillStyle = 'rgba(233,213,255,0.9)';
          ctx.font = `${7.5 / z}px DM Sans, sans-serif`;
          ctx.fillText(opt.job, opt.x, opt.y + 10 / z);
        }
      });
      ctx.globalAlpha = 1;
    }

    // Function neighbourhood chart (same write-home key — not a second disk)
    if (this.mapView === 'function') {
      this._drawFunctionChart(ctx);
    }

    // Bridge: path edges that cross disks get a soft glow (modulation leap)
    // (drawn later with path edges; tag nodes with disk id for style)

    // Active home hover / empty coaching on active disk centre
    const homeHover = this.hover && this.hover.type === 'home';
    const empty = !this.nodes || !this.nodes.length;
    const act = this._activeDisk();
    if (homeHover || empty) {
      const pulse = empty ? 1 + 0.1 * Math.sin((this.pulseT || 0) * 2.2) : 1;
      ctx.beginPath();
      ctx.arc(act.cx || 0, act.cy || 0, 22 * pulse, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(232,201,138,0.55)';
      ctx.lineWidth = 2 / this.camera.zoom;
      ctx.stroke();
    }
    if (empty && this._mode !== 'node') {
      ctx.fillStyle = 'rgba(200,184,160,0.8)';
      ctx.font = `${10 / this.camera.zoom}px Crimson Text, Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.fillText(
        this.mapView === 'function'
          ? 'Function · same-key atlas · click chords · Land/modulate → Chase'
          : 'Chase · click HOME or a roman seat · next-move = path / cadence / mod',
        act.cx || 0,
        (act.cy || 0) + (act.R || 100) * 0.95
      );
    }

    // Options: hollow rings on true Chase seats (same place the path will land)
    // Hidden while dragging — drag uses Chase seats as drop targets instead
    // Also hidden in Function view (neighbourhood nodes replace next-move dots)
    if (this.showHorizon && this.mapView !== 'function' && this._mode !== 'node' && this.horizon.length) {
      const ax =
        (this.horizon[0] && this.horizon[0]._anchor && this.horizon[0]._anchor.x) ||
        (this.nodes[this.current] && this.nodes[this.current].x) ||
        0;
      const ay =
        (this.horizon[0] && this.horizon[0]._anchor && this.horizon[0]._anchor.y) ||
        (this.nodes[this.current] && this.nodes[this.current].y) ||
        0;

      this.horizon.forEach((h) => {
        if (h.kind === 'home') return;
        const col = REGION[h.kind] || REGION[h.chord && h.chord.region] || REGION.flavour;
        const isH = this.hover && this.hover.type === 'horizon' && this.hover.item === h;
        // Thin stem from selection → true seat (honest hop, not a local fan)
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(h.x, h.y);
        ctx.strokeStyle = isH ? 'rgba(157,222,168,0.55)' : 'rgba(180,168,150,0.12)';
        ctx.lineWidth = (isH ? 1.6 : 0.9) / this.camera.zoom;
        ctx.setLineDash(isH ? [] : [3 / this.camera.zoom, 4 / this.camera.zoom]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Hollow option sitting on the landing seat
        const rr = isH ? 13 : 10;
        ctx.beginPath();
        ctx.arc(h.x, h.y, rr, 0, Math.PI * 2);
        ctx.fillStyle = isH ? 'rgba(20,16,12,0.92)' : 'rgba(12,10,8,0.5)';
        ctx.fill();
        ctx.strokeStyle = isH ? '#9ddea8' : col.fill || '#c4a574';
        ctx.lineWidth = (isH ? 2.4 : 1.5) / this.camera.zoom;
        ctx.setLineDash(isH ? [] : [2.5 / this.camera.zoom, 2 / this.camera.zoom]);
        ctx.stroke();
        ctx.setLineDash([]);

        const kindTag =
          h.kind === 'direction'
            ? 'next'
            : h.kind === 'cadence'
              ? 'cad'
              : h.kind === 'modulate'
                ? 'key'
                : h.kind === 'flavour'
                  ? 'colour'
                  : '';
        ctx.fillStyle = isH ? '#9ddea8' : 'rgba(230,220,200,0.9)';
        ctx.font = `bold ${8.5 / this.camera.zoom}px DM Sans, sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.fillText(h.label, h.x, h.y - (kindTag ? 3 / this.camera.zoom : 0));
        if (kindTag) {
          ctx.fillStyle = isH ? 'rgba(157,222,168,0.85)' : 'rgba(160,150,135,0.8)';
          ctx.font = `${7 / this.camera.zoom}px DM Sans, sans-serif`;
          ctx.fillText(kindTag, h.x, h.y + 10 / this.camera.zoom);
        }
      });

      // Ghost path on option hover: selection → landing seat (and onward)
      if (this.hover && this.hover.type === 'horizon' && this.hover.item) {
        const h = this.hover.item;
        const ci = this.current;
        const prevN = ci > 0 ? this.nodes[ci - 1] : null;
        const nextN = ci >= 0 && ci < this.nodes.length - 1 ? this.nodes[ci + 1] : null;
        const fromN = this.nodes[ci] || null;
        // Prefer true seat for ghost so it matches post-click path
        const hx = h.naturalX != null ? h.naturalX : h.x;
        const hy = h.naturalY != null ? h.naturalY : h.y;
        ctx.strokeStyle = 'rgba(125,186,146,0.75)';
        ctx.lineWidth = 2.5 / this.camera.zoom;
        ctx.lineCap = 'round';
        if (fromN) {
          ctx.beginPath();
          ctx.moveTo(fromN.x, fromN.y);
          ctx.lineTo(hx, hy);
          ctx.stroke();
        }
        if (nextN && fromN) {
          // show option replacing next
          ctx.globalAlpha = 0.45;
          ctx.beginPath();
          ctx.moveTo(hx, hy);
          ctx.lineTo(nextN.x, nextN.y);
          ctx.stroke();
          ctx.globalAlpha = 1;
        } else if (prevN && !fromN) {
          ctx.beginPath();
          ctx.moveTo(prevN.x, prevN.y);
          ctx.lineTo(hx, hy);
          ctx.stroke();
        }
      }
    }

    // Alt path
    if (this.showAlt) {
      const altVis = (n, i) => {
        if (!n) return false;
        const g = this.nodes[i];
        if (
          g &&
          g.chord &&
          n.chord &&
          g.chord.root === n.chord.root &&
          g.chord.quality === n.chord.quality
        ) {
          return false; // identical to gold — no blue ghost
        }
        return true;
      };
      for (let i = 0; i < this.altNodes.length - 1; i++) {
        const a = this.altNodes[i];
        const b = this.altNodes[i + 1];
        // Only draw blue edge when at least one end is a real compare diff
        if (!altVis(a, i) && !altVis(b, i + 1)) continue;
        const ax = altVis(a, i) ? a.x : this.nodes[i] ? this.nodes[i].x : a.x;
        const ay = altVis(a, i) ? a.y : this.nodes[i] ? this.nodes[i].y : a.y;
        const bx = altVis(b, i + 1) ? b.x : this.nodes[i + 1] ? this.nodes[i + 1].x : b.x;
        const by = altVis(b, i + 1) ? b.y : this.nodes[i + 1] ? this.nodes[i + 1].y : b.y;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.strokeStyle = 'rgba(126,184,218,0.5)';
        ctx.lineWidth = 3.5 / this.camera.zoom;
        ctx.setLineDash([6 / this.camera.zoom, 4 / this.camera.zoom]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      this.altNodes.forEach((n, i) => {
        const div = this.divergent.indexOf(i) >= 0;
        const altHover =
          this.hover && this.hover.type === 'altNode' && this.hover.item === n;
        // Skip drawing a blue ghost that sits under an identical gold step
        // (same root+quality) — only show diffs and true alt seats
        const gold = this.nodes[i];
        const sameAsGold =
          gold &&
          gold.chord &&
          n.chord &&
          gold.chord.root === n.chord.root &&
          gold.chord.quality === n.chord.quality;
        if (sameAsGold && !div && !altHover) return;

        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r * (div ? 1.05 : 0.85), 0, Math.PI * 2);
        ctx.fillStyle = div ? 'rgba(126,184,218,0.55)' : 'rgba(126,184,218,0.28)';
        ctx.fill();
        ctx.strokeStyle = div || altHover ? '#b8e0f5' : '#7eb8da';
        ctx.lineWidth = (div || altHover ? 2.5 : 1.2) / this.camera.zoom;
        ctx.stroke();
        // Always name divergent blue chords so they aren't mysterious orphans
        if (div || altHover) {
          ctx.fillStyle = altHover ? '#fff4d6' : '#b8e0f5';
          ctx.font = `bold ${9 / this.camera.zoom}px DM Sans, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(n.chord.name || '?', n.x, n.y);
        }
        if (div) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.r + 6 / this.camera.zoom, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(126,184,218,0.45)';
          ctx.lineWidth = 1.5 / this.camera.zoom;
          ctx.stroke();
        }
        // Compare tooltip: gold → blue on hover
        if (
          (altHover ||
            (div &&
              this.hover &&
              this.hover.type === 'path' &&
              this.hover.item &&
              this.hover.item.i === i)) &&
          gold &&
          gold.chord
        ) {
          const label =
            (gold.chord.name || '?') +
            ' → ' +
            (n.chord.name || '?') +
            (div ? ' · differ' : ' · same');
          ctx.fillStyle = 'rgba(10,8,6,0.88)';
          const tw = Math.max(80, label.length * 5.2) / this.camera.zoom;
          const th = 16 / this.camera.zoom;
          ctx.fillRect(n.x - tw / 2, n.y - n.r - th - 8 / this.camera.zoom, tw, th);
          ctx.fillStyle = '#b8e0f5';
          ctx.font = `bold ${9 / this.camera.zoom}px DM Sans, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, n.x, n.y - n.r - th / 2 - 8 / this.camera.zoom);
        }
      });
    }

    // Hover edge marker
    if (this.hover && this.hover.type === 'edge') {
      ctx.beginPath();
      ctx.arc(this.hover.x, this.hover.y, 8 / this.camera.zoom, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(125,186,146,0.85)';
      ctx.fill();
      ctx.fillStyle = '#0a0a0a';
      ctx.font = `bold ${11 / this.camera.zoom}px DM Sans, sans-serif`;
      ctx.fillText('+', this.hover.x, this.hover.y + 1);
    }

    // Primary path edges — journey trail (dim past, bright current during play)
    // Curve geometry shared with _hitEdge via _edgeControl
    for (let i = 0; i < this.nodes.length - 1; i++) {
      const a = this.nodes[i];
      const b = this.nodes[i + 1];
      const ec = this._edgeControl(a, b);
      const ax = ec.ax;
      const ay = ec.ay;
      const bx = ec.bx;
      const by = ec.by;
      const mx = ec.mx;
      const my = ec.my;
      const st = this._edgeStyle(a, b);
      const playing = this.playing;
      let alpha = 1;
      if (playing >= 0) {
        if (i < playing - 1) alpha = 0.28;
        else if (i === playing - 1) alpha = 0.95;
        else if (i >= playing) alpha = 0.4;
      }
      // Cross-disk edge = modulation bridge
      const aKey = (a.chord.localTonic != null ? a.chord.localTonic : this.origin.tonic) + ':' + (a.chord.localMode || this.origin.mode);
      const bKey = (b.chord.localTonic != null ? b.chord.localTonic : this.origin.tonic) + ':' + (b.chord.localMode || this.origin.mode);
      const crossKey = aKey !== bKey;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(mx, my, bx, by);
      ctx.strokeStyle = crossKey ? 'rgba(167,139,250,0.9)' : st.color;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = (st.w * (i === playing - 1 ? 1.35 : 1) * (crossKey ? 1.4 : 1)) / this.camera.zoom;
      if (crossKey) {
        ctx.setLineDash([6 / this.camera.zoom, 4 / this.camera.zoom]);
      }
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      // Playhead bead on the edge into current step
      if (playing >= 1 && i === playing - 1) {
        const t = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(this.pulseT * 3));
        const px = (1 - t) * (1 - t) * ax + 2 * (1 - t) * t * mx + t * t * bx;
        const py = (1 - t) * (1 - t) * ay + 2 * (1 - t) * t * my + t * t * by;
        ctx.beginPath();
        ctx.arc(px, py, 5 / this.camera.zoom, 0, Math.PI * 2);
        ctx.fillStyle = '#fff4d6';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,244,214,0.5)';
        ctx.lineWidth = 2 / this.camera.zoom;
        ctx.stroke();
      } else {
        const t = 0.55;
        const px = (1 - t) * (1 - t) * ax + 2 * (1 - t) * t * mx + t * t * bx;
        const py = (1 - t) * (1 - t) * ay + 2 * (1 - t) * t * my + t * t * by;
        ctx.beginPath();
        ctx.arc(px, py, 2.5 / this.camera.zoom, 0, Math.PI * 2);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = st.color;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // Aim mode: chord stays put; magnet aims at ring of labelled targets
    if (this._mode === 'node' && this._dragNode) {
      const origin = this._dragOrigin || { x: this._dragNode.x, y: this._dragNode.y };
      const magnet = this._dragPos || origin;
      const i = this._dragNode.i;
      const z = this.camera.zoom;

      // Dim everything slightly under aim overlay feel via faint guide rings
      ctx.beginPath();
      ctx.arc(origin.x, origin.y, 58, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(232,201,138,0.12)';
      ctx.lineWidth = 1 / z;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(origin.x, origin.y, 96, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(232,201,138,0.08)';
      ctx.lineWidth = 1 / z;
      ctx.stroke();

      // Aim targets: good joins (green) > ok (gold) > weak (dim) — scored from prev/next
      const fnAim = this.mapView === 'function';
      // Draw weak first so strong pads sit on top
      const ordered = this.alts.slice().sort((a, b) => {
        const rank = (t) => (t === 'good' ? 2 : t === 'ok' ? 1 : 0);
        return rank(a.tier) - rank(b.tier);
      });
      ordered.forEach((a) => {
        const isSnap = this.snapAlt === a;
        const tier = a.tier || 'ok';
        const baseR = fnAim
          ? tier === 'good'
            ? 17
            : tier === 'ok'
              ? 14
              : 11
          : tier === 'good'
            ? 24
            : tier === 'ok'
              ? 20
              : 15;
        const padR = isSnap ? baseR + 3 : baseR;
        ctx.beginPath();
        ctx.arc(a.x, a.y, padR, 0, Math.PI * 2);
        if (tier === 'good') {
          ctx.fillStyle = isSnap ? 'rgba(125,186,146,0.78)' : 'rgba(125,186,146,0.38)';
          ctx.strokeStyle = isSnap ? '#9ddea8' : 'rgba(125,186,146,0.85)';
        } else if (tier === 'ok') {
          ctx.fillStyle = isSnap ? 'rgba(232,201,138,0.65)' : 'rgba(20,16,12,0.72)';
          ctx.strokeStyle = isSnap ? '#e8c98a' : 'rgba(232,201,138,0.75)';
        } else {
          ctx.fillStyle = isSnap ? 'rgba(140,130,120,0.45)' : 'rgba(12,10,8,0.35)';
          ctx.strokeStyle = isSnap ? 'rgba(180,168,150,0.7)' : 'rgba(180,168,150,0.28)';
        }
        ctx.fill();
        ctx.lineWidth = (isSnap ? 3.2 : tier === 'good' ? 2.2 : tier === 'ok' ? 1.6 : 1) / z;
        if (tier === 'weak' && !isSnap) ctx.setLineDash([3 / z, 3 / z]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle =
          isSnap && tier === 'good'
            ? '#0a0a0a'
            : tier === 'weak'
              ? 'rgba(200,190,175,0.45)'
              : '#fff4d6';
        ctx.font = `bold ${(fnAim ? (tier === 'weak' ? 9 : 11) : tier === 'weak' ? 10 : 13) / z}px DM Sans, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(a.role || a.label, a.x, a.y - (a.role && tier !== 'weak' ? 5 / z : 0));
        if (a.role && tier !== 'weak') {
          ctx.fillStyle = isSnap && tier === 'good' ? 'rgba(10,10,10,0.75)' : 'rgba(232,201,138,0.9)';
          ctx.font = `${(fnAim ? 9 : 10) / z}px DM Sans, sans-serif`;
          ctx.fillText(a.label, a.x, a.y + 11 / z);
        }
        // Small star on best joins
        if (tier === 'good' && !isSnap) {
          ctx.fillStyle = 'rgba(125,186,146,0.95)';
          ctx.font = `bold ${9 / z}px DM Sans, sans-serif`;
          ctx.fillText('★', a.x, a.y - padR - 6 / z);
        }
      });

      // Preview path: prev → aimed target → next (where the progression will go)
      if (this.snapAlt) {
        const t = this.snapAlt;
        const prevN = this.nodes[i - 1];
        const nextN = this.nodes[i + 1];
        ctx.strokeStyle = 'rgba(125,186,146,0.85)';
        ctx.lineWidth = 3.2 / z;
        ctx.lineCap = 'round';
        if (prevN) {
          ctx.beginPath();
          ctx.moveTo(prevN.x, prevN.y);
          ctx.lineTo(t.x, t.y);
          ctx.stroke();
        }
        if (nextN) {
          ctx.beginPath();
          ctx.moveTo(t.x, t.y);
          ctx.lineTo(nextN.x, nextN.y);
          ctx.stroke();
        }
        // Big preview node at target
        ctx.beginPath();
        ctx.arc(t.x, t.y, this._dragNode.r * 1.15, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(125,186,146,0.4)';
        ctx.fill();
        ctx.strokeStyle = '#9ddea8';
        ctx.lineWidth = 2.5 / z;
        ctx.stroke();
      }

      // Aim line + magnet (this is your aim point — not a free-floating chord)
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.lineTo(magnet.x, magnet.y);
      ctx.strokeStyle = this.snapAlt ? 'rgba(125,186,146,0.55)' : 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1.4 / z;
      ctx.setLineDash([4 / z, 4 / z]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Crosshair magnet
      const mr = 9 / z;
      ctx.beginPath();
      ctx.arc(magnet.x, magnet.y, mr, 0, Math.PI * 2);
      ctx.fillStyle = this.snapAlt ? 'rgba(125,186,146,0.95)' : 'rgba(255,255,255,0.55)';
      ctx.fill();
      ctx.strokeStyle = this.snapAlt ? '#fff' : 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 1.5 / z;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(magnet.x - mr * 1.6, magnet.y);
      ctx.lineTo(magnet.x + mr * 1.6, magnet.y);
      ctx.moveTo(magnet.x, magnet.y - mr * 1.6);
      ctx.lineTo(magnet.x, magnet.y + mr * 1.6);
      ctx.strokeStyle = this.snapAlt ? 'rgba(10,10,10,0.55)' : 'rgba(255,255,255,0.65)';
      ctx.lineWidth = 1.2 / z;
      ctx.stroke();

      // HUD near magnet
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = this.snapAlt ? 'rgba(157,222,168,0.98)' : 'rgba(255,255,255,0.7)';
      ctx.font = `bold ${11 / z}px DM Sans, sans-serif`;
      const hud = this.snapAlt
        ? 'Release → ' + this.snapAlt.label + (this.snapAlt.role ? ' · ' + this.snapAlt.role : '')
        : 'Aim at a target · release outside = cancel';
      ctx.fillText(hud, magnet.x, magnet.y - 18 / z);
    }

    // Primary path nodes — solid, numbered, heavier than hollow options
    this.nodes.forEach((n) => {
      const reg = n.chord.region || 'diatonic';
      const col = REGION[reg] || REGION.diatonic;
      const isCur = n.i === this.current;
      const isPlay = n.i === this.playing;
      const aiming = this._mode === 'node' && this._dragNode && this._dragNode.i === n.i;
      const div = this.divergent.indexOf(n.i) >= 0 && this.showAlt && this.altNodes.length;
      const x = n.x;
      const y = n.y;
      const pulse = isPlay ? 1 + 0.08 * Math.sin(this.pulseT * 2) : 1;
      const r = n.r * (isPlay || isCur || aiming ? 1.14 : 1) * pulse;
      // Dim past steps while playing (journey)
      let nodeAlpha = 1;
      if (this.playing >= 0 && n.i < this.playing) nodeAlpha = 0.4;
      else if (this.playing >= 0 && n.i > this.playing) nodeAlpha = 0.55;
      ctx.globalAlpha = nodeAlpha;

      // Playhead / selection ring
      if (isPlay || isCur) {
        ctx.beginPath();
        ctx.arc(x, y, r + 8 / this.camera.zoom, 0, Math.PI * 2);
        ctx.strokeStyle = isPlay ? 'rgba(255,244,214,0.85)' : 'rgba(232,201,138,0.55)';
        ctx.lineWidth = 2.8 / this.camera.zoom;
        ctx.stroke();
      }
      if (div) {
        ctx.beginPath();
        ctx.arc(x, y, r + 12 / this.camera.zoom, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(126,184,218,0.55)';
        ctx.lineWidth = 2 / this.camera.zoom;
        ctx.setLineDash([4 / this.camera.zoom, 3 / this.camera.zoom]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      // While aiming this step, show as dashed "from" source
      if (aiming) {
        ctx.fillStyle = 'rgba(196,165,116,0.35)';
        ctx.fill();
        ctx.setLineDash([5 / this.camera.zoom, 4 / this.camera.zoom]);
        ctx.strokeStyle = 'rgba(232,201,138,0.85)';
        ctx.lineWidth = 2.2 / this.camera.zoom;
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = col.fill;
        ctx.fill();
        if (isCur || isPlay) {
          ctx.strokeStyle = '#fff4d6';
          ctx.lineWidth = 2.5 / this.camera.zoom;
          ctx.stroke();
        }
      }

      // Step number badge
      ctx.beginPath();
      ctx.arc(x - r * 0.75, y - r * 0.75, 9 / this.camera.zoom, 0, Math.PI * 2);
      ctx.fillStyle = isPlay ? '#fff4d6' : 'rgba(20,16,12,0.85)';
      ctx.fill();
      ctx.fillStyle = isPlay ? '#1a1410' : '#e8c98a';
      ctx.font = `bold ${10 / this.camera.zoom}px DM Sans, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(n.i + 1), x - r * 0.75, y - r * 0.75);

      ctx.fillStyle = aiming ? 'rgba(232,201,138,0.9)' : '#0a0a0a';
      ctx.font = `bold ${Math.max(9, 11 / this.camera.zoom)}px DM Sans, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.fillText(n.chord.name, x, y);

      if (aiming) {
        ctx.fillStyle = 'rgba(232,201,138,0.7)';
        ctx.font = `${9 / this.camera.zoom}px DM Sans, sans-serif`;
        ctx.fillText('from', x, y - r - 10 / this.camera.zoom);
      }

      // Duration tail hint
      ctx.fillStyle = 'rgba(200,184,160,0.65)';
      ctx.font = `${8 / this.camera.zoom}px DM Sans, sans-serif`;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText((n.chord.duration || 4) + 'b', x, y + r + 11 / this.camera.zoom);

      if (
        div &&
        this.hover &&
        this.hover.type === 'path' &&
        this.hover.item === n &&
        this.altNodes[n.i]
      ) {
        const blue = this.altNodes[n.i].chord;
        const label = (n.chord.name || '?') + '  vs  ' + (blue.name || '?');
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(10,8,6,0.9)';
        const tw = Math.max(90, label.length * 5.5) / this.camera.zoom;
        const th = 18 / this.camera.zoom;
        ctx.fillRect(x - tw / 2, y + r + 14 / this.camera.zoom, tw, th);
        ctx.fillStyle = '#b8e0f5';
        ctx.font = `bold ${9 / this.camera.zoom}px DM Sans, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x, y + r + 14 / this.camera.zoom + th / 2);
      }
      ctx.globalAlpha = 1;
    });

    ctx.restore();

    // Legend + tip (screen space)
    ctx.fillStyle = 'rgba(180,168,150,0.55)';
    ctx.font = '11px Crimson Text, Georgia, serif';
    ctx.textAlign = 'left';
    let tip =
      this._mode === 'node'
        ? this.snapAlt
          ? 'Release to set · audition: prev → ' + this.snapAlt.label + ' → next'
          : 'Drag onto a seat to change · release here keeps this bridge chord'
        : this.hover && this.hover.type === 'edge'
          ? 'Click edge → insert a step between · then drag it onto a chord seat'
        : this.hover && this.hover.type === 'home'
          ? 'HOME = write-key tonic (Chase disk centre) — click to start/land'
          : this.hover && this.hover.type === 'diskHome'
            ? 'Previous key disk — click centre to make it write home again (path keeps ownership)'
            : this.hover && this.hover.type === 'functionNode'
              ? 'Function chart · click to write ' +
                ((this.hover.item && this.hover.item.label) || '') +
                ' · same key neighbourhood'
              : this.hover && this.hover.type === 'horizon'
                ? 'Option on/near harmonic scale · green ghost = join · click to write'
                : this.hover && this.hover.type === 'edge'
                  ? 'Click green + on the curve to insert a bridge chord (keeps total length)'
                  : this.hover && this.hover.type === 'altNode'
                    ? 'Blue compare path — names show where versions differ'
                    : this.hover && this.hover.type === 'seat'
                      ? 'Click seat to add ' +
                        (this.hover.item.roman || '') +
                        (this.hover.item.activeDisk
                          ? ' · drag a path chord onto a seat to move it'
                          : ' on other disk · switches write home')
                      : this.hover && this.hover.type === 'ghostOption'
                        ? 'Establish home in ' +
                          ((this.hover.item &&
                            this.hover.item.ghostDisk &&
                            this.hover.item.label) ||
                            'nearby key') +
                          ' · click to land'
                        : this.hover && this.hover.type === 'ghostDisk'
                          ? 'Nearby key · click a pad (I or V7→I) to establish home'
                          : this.mapView === 'function'
                            ? 'Function · same-key atlas · blue V7 · purple borrow · Land/mod → Chase'
                            : this.nodes && this.nodes.length
                              ? 'Chase · seats = in-key · purple ghosts = adjacent keys · establish home to travel'
                              : 'Click HOME or a roman seat (IV, V, vi…) to start';
    ctx.fillText(tip, 10, h - 12);

    // Map reading legend (top-left)
    ctx.font = '9px DM Sans, sans-serif';
    ctx.fillStyle = 'rgba(180,168,150,0.5)';
    ctx.fillText(
      this.mapView === 'function'
        ? 'Function · gold diatonic · blue V7→target · purple borrow · same write-home key'
        : 'Chase · solid = traveled keys · purple ghosts = nearby keys from pivot · I / V7→I plant home',
      10,
      14
    );

    // Edge colour legend
    const legs = [
      ['#7dba92', 'step'],
      ['#7eb8da', '5th'],
      ['#e8c98a', 'swing'],
      ['#e85d4c', 'tritone'],
      ['#c4a574', 'gold=you'],
      ['#7eb8da', 'blue=cmp'],
    ];
    let lx = 10;
    legs.forEach(([col, lab]) => {
      ctx.fillStyle = col;
      ctx.fillRect(lx, h - 28, 10, 3);
      ctx.fillStyle = 'rgba(180,168,150,0.7)';
      ctx.fillText(lab, lx + 12, h - 24);
      lx += lab.length > 6 ? 62 : 48;
    });
  };

  SpatialMap.prototype.focusHome = function () {
    this.cameraMode = 'home';
    this.camera.tx = 0;
    this.camera.ty = 0;
    this.camera.tz = 1;
  };

  /**
   * Offline map hit-test self-check (no audio/DOM paint needed).
   * Returns { ok, failures: string[] }. Call from console: HLSpatial.selfTest()
   */
  function selfTest() {
    const failures = [];
    const assert = (cond, msg) => {
      if (!cond) failures.push(msg);
    };

    // Minimal fake canvas
    const canvas = {
      getContext: () => ({
        setTransform: () => {},
        clearRect: () => {},
      }),
      getBoundingClientRect: () => ({ width: 600, height: 400, left: 0, top: 0 }),
      width: 600,
      height: 400,
      style: {},
      addEventListener: () => {},
      setPointerCapture: () => {},
    };
    // Avoid real listeners / rAF
    const protoBind = SpatialMap.prototype._bind;
    SpatialMap.prototype._bind = function () {};
    const map = new SpatialMap(canvas);
    SpatialMap.prototype._bind = protoBind;
    map.w = 600;
    map.h = 400;
    map.camera = { x: 0, y: 0, zoom: 1, tx: 0, ty: 0, tz: 1 };
    map.origin = { tonic: 11, mode: 'minor' };
    map.disks = [{ cx: 0, cy: 0, R: 160, tonic: 11, mode: 'minor', active: true }];
    map.nodes = [
      { x: -80, y: 0, r: 18, i: 0, chord: { root: 11, quality: 'min', localTonic: 11 } },
      { x: 80, y: 0, r: 18, i: 1, chord: { root: 4, quality: 'min', localTonic: 11 } },
      { x: 40, y: 70, r: 18, i: 2, chord: { root: 6, quality: 'dom7', localTonic: 11 } },
    ];
    map.path = map.nodes.map((n) => n.chord);
    map.scaleSeats = [
      { x: 0, y: -60, r: 22, activeDisk: true, roman: 'i', chord: { root: 11 } },
    ];
    map.horizon = [];
    map.showHorizon = true;
    map.showAlt = false;
    map.altNodes = [];

    // 1) Midpoint of first edge (curve bows up slightly) should be edge
    const c01 = map._edgeControl(map.nodes[0], map.nodes[1]);
    const mid = map._quadPoint(c01, 0.5);
    // world → screen for _hit (uses screen coords)
    const toScreen = (wx, wy) => ({
      sx: wx * map.camera.zoom + map.w / 2,
      sy: wy * map.camera.zoom + map.h / 2,
    });
    let s = toScreen(mid.x, mid.y);
    let hit = map._hit(s.sx, s.sy);
    assert(hit && hit.type === 'edge' && hit.afterIndex === 0, 'mid curve → edge 0, got ' + (hit && hit.type));

    // 2) Near path node should be path, not edge
    s = toScreen(map.nodes[0].x, map.nodes[0].y);
    hit = map._hit(s.sx, s.sy);
    assert(hit && hit.type === 'path' && hit.item.i === 0, 'on node 0 → path, got ' + (hit && hit.type));

    // 3) Far away → null
    s = toScreen(300, 300);
    hit = map._hit(s.sx, s.sy);
    assert(!hit, 'far point → null, got ' + (hit && hit.type));

    // 4) Straight-line midpoint != curve midpoint: old bug would miss curve
    const straightMid = { x: 0, y: 0 }; // nodes at y=0
    // Curve control pulls perpendicular; mid of quad is slightly off y=0
    assert(Math.abs(mid.y) > 0.5 || Math.abs(c01.my) > 0.5, 'curve has bend (control offset)');
    const onStraight = map._closestOnEdge(map.nodes[0], map.nodes[1], straightMid.x, straightMid.y);
    const onCurve = map._closestOnEdge(map.nodes[0], map.nodes[1], mid.x, mid.y);
    assert(onCurve && onCurve.d < 2, 'closest on curve mid is ~0');
    // Clicking the visual mid should beat clicking only the chord
    s = toScreen(mid.x, mid.y);
    hit = map._hit(s.sx, s.sy);
    assert(hit && hit.type === 'edge', 'curve mid hit is edge');

    // 5) Seat at (0,-60) — not edge
    s = toScreen(0, -60);
    hit = map._hit(s.sx, s.sy);
    assert(hit && hit.type === 'seat', 'seat hit, got ' + (hit && hit.type));

    // 6) Tiny edge ignored
    map.nodes = [
      { x: 0, y: 0, r: 16, i: 0, chord: { root: 0 } },
      { x: 5, y: 0, r: 16, i: 1, chord: { root: 1 } },
    ];
    const tiny = map._closestOnEdge(map.nodes[0], map.nodes[1], 2.5, 0);
    assert(tiny == null, 'tiny edge returns null');

    // 7) Circular blend root sanity (inline mirror of app helper)
    const blend = (a, b, t) => {
      let d = (b - a + 12) % 12;
      if (d > 6) d -= 12;
      return ((a + Math.round(d * t)) % 12 + 12) % 12;
    };
    // B(11)→C(0): short arc is +1 → mid is B or C, never F# (6) from arithmetic mean
    assert(blend(11, 0, 0.5) === 0 || blend(11, 0, 0.5) === 11, 'B→C mid on short arc not F#');
    assert(blend(11, 0, 0.5) !== 6, 'B→C must not use arithmetic mean (F#)');
    // C(0)→G(7): short arc is −5 → mid near Bb/A, not E
    const cg = blend(0, 7, 0.5);
    assert(cg === 9 || cg === 10 || cg === 11 || cg === 0, 'C→G short-arc mid, got ' + cg);
    // Arithmetic mean of 11 and 0 is the classic wrong answer
    assert(Math.round((11 + 0) / 2) % 12 === 6, 'sanity: arithmetic mean is F#');

    return {
      ok: failures.length === 0,
      failures,
      passed: 7 - failures.length,
    };
  }

  global.HLSpatial = { SpatialMap, REGION, selfTest };
})(typeof window !== 'undefined' ? window : globalThis);
