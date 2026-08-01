/**
 * Path-in-space map: fixed home stage, trajectory, dual versions, edit gestures
 */
(function (global) {
  'use strict';

  const REGION = {
    diatonic:    { fill: '#c4a574', ghost: 'rgba(196,165,116,0.35)' },
    secondary:   { fill: '#7eb8da', ghost: 'rgba(126,184,218,0.4)' },
    interchange: { fill: '#9b7bb8', ghost: 'rgba(155,123,184,0.4)' },
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
    this.path = [];
    this.nodes = [];
    this.altPath = [];
    this.altNodes = [];
    this.divergent = []; // indices where alt differs from primary
    this.horizon = [];
    this.alts = [];
    this.current = -1;
    this.playing = -1;
    this.cameraMode = 'home';
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
    this.onRequestAlts = null;
    this.onSwapChord = null;
    this.onPullChord = null; // (pathIndex, chord, meta) only when aimed at a target
    this.onAimChange = null; // (pathIndex, target|{null}, meta) for live audition
    this.onInsertBetween = null; // (afterIndex) => void
    this.onTrajectory = null; // (caption) => void
    this.snapRadius = 42; // magnet must enter this to lock a target
    this._mode = null;
    this._dragNode = null;
    this._dragOrigin = null; // original node world pos (chord stays here)
    this._dragPos = null; // magnet / aim point — not the chord
    this._last = null;
    this._moved = false;
    this._aimPreview = null; // { chord, x, y, label, role }
    this._bind();
    this.resize();
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
    this.w = Math.max(280, r.width);
    this.h = Math.max(220, r.height);
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  };

  SpatialMap.prototype.setOrigin = function (tonic, mode) {
    this.origin = {
      tonic: typeof tonic === 'number' ? tonic : global.HLMusic.pc(tonic),
      mode: mode || 'minor',
    };
  };

  SpatialMap.prototype.setShowHorizon = function (on) {
    this.showHorizon = !!on;
  };

  SpatialMap.prototype.setShowAlt = function (on) {
    this.showAlt = !!on;
  };

  SpatialMap.prototype.setPath = function (chords, currentIndex) {
    if (this._mode === 'node') return;
    this.path = (chords || []).map((c) => ({ ...c }));
    this.current = currentIndex != null ? currentIndex : this.path.length - 1;
    this._layoutPath();
    this._emitTrajectory();
  };

  /**
   * Options fan around the *selected path node* (constellation), not a second
   * cloud on home. Home stays the global centre disc only.
   */
  SpatialMap.prototype.setHorizon = function (items) {
    if (this._mode === 'node') return;
    const M = global.HLMusic;
    const anchor =
      this.current >= 0 && this.nodes[this.current]
        ? this.nodes[this.current]
        : { x: 0, y: 0, r: 14 };

    // Cap density on canvas; full catalog lives in From here list
    const orbitItems = (items || [])
      .filter((it) => it.kind !== 'home')
      .slice(0, 8);

    const n = orbitItems.length || 1;
    // Two rings so labels stay readable
    const rInner = 52 + (anchor.r || 14);
    const rOuter = 78 + (anchor.r || 14);

    this.horizon = orbitItems.map((it, i) => {
      const ch = it.chord;
      // Prefer harmonic bearing from home, expressed as angle around selection
      let ang = 0;
      if (M && ch) {
        ang = M.harmonicAngle(ch, this.origin.tonic);
      }
      // Fan evenly if many share a bearing
      ang += (i / n) * 0.35 + i * 0.08;
      const ring = i % 2 === 0 ? rInner : rOuter;
      const x = anchor.x + Math.cos(ang) * ring;
      const y = anchor.y + Math.sin(ang) * ring * 0.78;
      return {
        chord: ch,
        kind: it.kind || 'direction',
        label: it.label || (ch && ch.name) || '?',
        job: it.job || '',
        route: it.route,
        modulateTo: it.modulateTo,
        x,
        y,
        r: 10, // smaller hollow options (drawn differently)
        _anchor: { x: anchor.x, y: anchor.y },
      };
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
   * Harmonic polar position + mild step spiral so the sequence reads as a journey
   * (not a pile of overlapping same-root visits).
   */
  SpatialMap.prototype._chordPos = function (ch, index, lane) {
    const M = global.HLMusic;
    const R = Math.min(this.w || 500, this.h || 360) * 0.36;
    const dist = M.harmonicDistance(ch, this.origin.tonic, this.origin.mode);
    // Step bias: each step walks slightly around + out so order is visible
    const stepAng = index * 0.22;
    const ang = M.harmonicAngle(ch, this.origin.tonic) + stepAng * 0.15;
    const radius = 36 + dist * (R / 2.55) + index * 11;
    const off = lane === 1 ? 14 : 0;
    const perp = ang + Math.PI / 2;
    return {
      x: Math.cos(ang) * radius + (lane === 1 ? Math.cos(perp) * off : 0),
      y: Math.sin(ang) * radius * 0.72 + (lane === 1 ? Math.sin(perp) * off * 0.72 : 0),
    };
  };

  SpatialMap.prototype._separateNodes = function (nodes, minDist) {
    minDist = minDist || 36;
    for (let pass = 0; pass < 4; pass++) {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let d = Math.hypot(dx, dy) || 0.01;
          if (d < minDist) {
            const push = ((minDist - d) / 2) * 0.85;
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

  SpatialMap.prototype._layoutPath = function () {
    const M = global.HLMusic;
    if (!M) return;
    this.nodes = this.path.map((ch, i) => {
      const pos = this._chordPos(ch, i, 0);
      // Path nodes read heavier than option ghosts
      const r = 17 + Math.min(12, (ch.duration || 4) * 1.2);
      return { chord: ch, x: pos.x, y: pos.y, r, i };
    });
    this._separateNodes(this.nodes, 40);
    this._layoutAltPath();
    this._computeDivergent();
    if (this._mode !== 'node') this._applyCameraForMode();
  };

  SpatialMap.prototype._layoutAltPath = function () {
    const M = global.HLMusic;
    if (!M) {
      this.altNodes = [];
      return;
    }
    this.altNodes = (this.altPath || []).map((ch, i) => {
      const pos = this._chordPos(ch, i, 1);
      const r = 13 + Math.min(10, (ch.duration || 4) * 1.1);
      return { chord: ch, x: pos.x, y: pos.y, r, i };
    });
    this._separateNodes(this.altNodes, 34);
  };

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
    if (this.cameraMode === 'home' || !this.nodes.length) {
      this.camera.tx = 0;
      this.camera.ty = 0;
      this.camera.tz = 1;
      return;
    }
    if (this.cameraMode === 'follow') {
      const n = this.nodes[Math.max(0, Math.min(this.current, this.nodes.length - 1))];
      if (n) {
        this.camera.tx = n.x;
        this.camera.ty = n.y;
        this.camera.tz = 1.05;
      }
      return;
    }
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
   * Aim targets sit in a readable ring around the chord you grabbed.
   * Natural harmonic direction is preserved as angle; radius is fixed so
   * every option is nearby and scannable (not a free-space teleport).
   */
  SpatialMap.prototype._layoutAlts = function (pathIndex, alts) {
    const origin = this.nodes[pathIndex] || { x: 0, y: 0 };
    const list = alts || [];
    const n = list.length || 1;
    // Two rings if many targets so nothing piles up
    const rInner = 58;
    const rOuter = 96;
    this.alts = list.map((a, i) => {
      const natural = this._chordPos(a.chord, pathIndex, 0);
      // Prefer true harmonic bearing from home/origin; fall back to even fan
      let ang = Math.atan2(natural.y - origin.y, natural.x - origin.x);
      if (!isFinite(ang) || (Math.abs(natural.x - origin.x) < 1 && Math.abs(natural.y - origin.y) < 1)) {
        ang = -Math.PI / 2 + (i / n) * Math.PI * 2;
      }
      // Spread collisions by index on a second ring
      const ring = i % 2 === 0 ? rInner : rOuter;
      // Slight index jitter so same-bearing targets don't stack
      const jitter = ((i * 0.37) % 0.55) - 0.27;
      ang += jitter;
      const x = origin.x + Math.cos(ang) * ring;
      const y = origin.y + Math.sin(ang) * ring * 0.85;
      return {
        chord: a.chord,
        label: a.label || a.chord.name,
        role: a.role || '',
        x,
        y,
        r: 16,
        naturalX: natural.x,
        naturalY: natural.y,
      };
    });
  };

  SpatialMap.prototype.screenToWorld = function (sx, sy) {
    return {
      x: (sx - this.w / 2) / this.camera.zoom + this.camera.x,
      y: (sy - this.h / 2) / this.camera.zoom + this.camera.y,
    };
  };

  SpatialMap.prototype._hitEdge = function (sx, sy) {
    const w = this.screenToWorld(sx, sy);
    const thresh = 14 / this.camera.zoom;
    for (let i = 0; i < this.nodes.length - 1; i++) {
      const a = this.nodes[i];
      const b = this.nodes[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy || 1;
      let t = ((w.x - a.x) * dx + (w.y - a.y) * dy) / len2;
      t = Math.max(0.15, Math.min(0.85, t));
      const px = a.x + t * dx;
      const py = a.y + t * dy;
      const d = Math.hypot(w.x - px, w.y - py);
      if (d < thresh) return { type: 'edge', afterIndex: i, x: px, y: py };
    }
    return null;
  };

  SpatialMap.prototype._hit = function (sx, sy) {
    const w = this.screenToWorld(sx, sy);
    if (this._mode === 'node' && this.alts.length) {
      for (let i = this.alts.length - 1; i >= 0; i--) {
        const a = this.alts[i];
        const dx = w.x - a.x;
        const dy = w.y - a.y;
        if (dx * dx + dy * dy <= 18 * 18) return { type: 'alt', item: a };
      }
    }
    if (this.showHorizon && this._mode !== 'node') {
      for (let i = this.horizon.length - 1; i >= 0; i--) {
        const h = this.horizon[i];
        const dx = w.x - h.x;
        const dy = w.y - h.y;
        const rr = (h.r || 10) + 8;
        if (dx * dx + dy * dy <= rr * rr) return { type: 'horizon', item: h };
      }
    }
    // Centre disc IS home (start / land on tonic) — generous hit
    if (this._mode !== 'node') {
      const dHome = w.x * w.x + w.y * w.y;
      if (dHome <= 28 * 28) return { type: 'home' };
    }
    // Blue compare nodes (for tooltips)
    if (this.showAlt && this._mode !== 'node' && this.altNodes && this.altNodes.length) {
      for (let i = this.altNodes.length - 1; i >= 0; i--) {
        const n = this.altNodes[i];
        const dx = w.x - n.x;
        const dy = w.y - n.y;
        if (dx * dx + dy * dy <= (n.r + 5) * (n.r + 5)) return { type: 'altNode', item: n };
      }
    }
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const n = this.nodes[i];
      const dx = w.x - n.x;
      const dy = w.y - n.y;
      if (dx * dx + dy * dy <= (n.r + 6) * (n.r + 6)) return { type: 'path', item: n };
    }
    const edge = this._hitEdge(sx, sy);
    if (edge) return edge;
    return null;
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
      this._dragNode = hit.item;
      this._dragOrigin = { x: hit.item.x, y: hit.item.y };
      this._dragPos = { x: hit.item.x, y: hit.item.y };
      this.current = hit.item.i;
      if (this.onSelectPath) this.onSelectPath(hit.item.i, hit.item.chord);
      let alts = [];
      if (this.onRequestAlts) alts = this.onRequestAlts(hit.item.i, hit.item.chord) || [];
      this._layoutAlts(hit.item.i, alts);
      this.canvas.setPointerCapture(e.pointerId);
      this.canvas.style.cursor = 'grabbing';
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
    if (hit && hit.type === 'edge' && this.onInsertBetween) {
      this.onInsertBetween(hit.afterIndex);
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
      // Find nearest aim target; soft-magnet pulls pointer toward it when close
      let best = null;
      let bestD = Infinity;
      this.alts.forEach((a) => {
        const d = Math.hypot(w.x - a.x, w.y - a.y);
        if (d < bestD) {
          bestD = d;
          best = a;
        }
      });
      const lockR = this.snapRadius;
      const pullR = this.snapRadius * 1.65;
      let mx = w.x;
      let my = w.y;
      if (best && bestD < pullR) {
        // Soft pull: magnet eases toward target center (easier aiming)
        const t = 1 - bestD / pullR;
        const ease = t * t * 0.72;
        mx = w.x + (best.x - w.x) * ease;
        my = w.y + (best.y - w.y) * ease;
      }
      // Hard lock only inside snap radius
      if (!best || bestD > lockR) best = null;
      this._dragPos = { x: mx, y: my };
      const prev = this.snapAlt;
      this.snapAlt = best;
      this._aimPreview = best
        ? { chord: best.chord, x: best.x, y: best.y, label: best.label, role: best.role || '' }
        : null;
      if (best !== prev && this.onAimChange) {
        this.onAimChange(this._dragNode.i, best, {
          prevChord: this.nodes[this._dragNode.i - 1] && this.nodes[this._dragNode.i - 1].chord,
          nextChord: this.nodes[this._dragNode.i + 1] && this.nodes[this._dragNode.i + 1].chord,
          originChord: this._dragNode.chord,
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
    if (hit && hit.type === 'home' && (!prev || prev.type !== 'home')) {
      if (this.onHoverHome) this.onHoverHome();
      this.canvas.style.cursor = 'pointer';
    }
  };

  SpatialMap.prototype._up = function () {
    if (this._mode === 'node' && this._dragNode) {
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
    this._last = null;
    this.alts = [];
    this.snapAlt = null;
    this._aimPreview = null;
    this.canvas.style.cursor = 'grab';
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
      if (this._mode !== 'pan') {
        cam.x += (cam.tx - cam.x) * 0.1;
        cam.y += (cam.ty - cam.y) * 0.1;
      }
      cam.zoom += (cam.tz - cam.zoom) * 0.1;
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

    const R = Math.min(w, h) * 0.36;
    // Function wedges (subtle)
    const wedges = [
      { a0: -0.6, a1: 0.6, c: 'rgba(196,165,116,0.04)' }, // near tonic angles rough
    ];
    [0.35, 0.6, 0.9].forEach((f, i) => {
      ctx.beginPath();
      ctx.ellipse(0, 0, R * f, R * f * 0.72, 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(196,165,116,${0.12 - i * 0.025})`;
      ctx.lineWidth = 1.2 / this.camera.zoom;
      ctx.stroke();
    });

    // Home = the centre disc (clickable tonic). Outer orbit = other options only.
    const homeHover = this.hover && this.hover.type === 'home';
    const empty = !this.nodes || !this.nodes.length;
    const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 55);
    glow.addColorStop(0, homeHover ? 'rgba(255,220,140,0.55)' : 'rgba(255,200,120,0.4)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, 55, 0, Math.PI * 2);
    ctx.fill();
    // Soft rings around home (global frame only)
    if (this._mode !== 'node') {
      ctx.beginPath();
      ctx.arc(0, 0, 72, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(232,201,138,0.08)';
      ctx.lineWidth = 1 / this.camera.zoom;
      ctx.setLineDash([4 / this.camera.zoom, 6 / this.camera.zoom]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const M = global.HLMusic;
    const homeName = M ? M.noteName(this.origin.tonic) : '';
    const homeR = homeHover || empty ? 18 : 14;
    if (empty || homeHover) {
      const pulse = empty ? 1 + 0.1 * Math.sin((this.pulseT || 0) * 2.2) : 1;
      ctx.beginPath();
      ctx.arc(0, 0, (homeR + 6) * pulse, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(232,201,138,0.55)';
      ctx.lineWidth = 2 / this.camera.zoom;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, homeR, 0, Math.PI * 2);
    ctx.fillStyle = homeHover ? '#fff4d6' : '#e8c98a';
    ctx.fill();
    ctx.strokeStyle = homeHover ? '#fff' : 'rgba(255,244,214,0.65)';
    ctx.lineWidth = 2 / this.camera.zoom;
    ctx.stroke();
    // Chord name in the centre — this is the tonic you start with
    ctx.fillStyle = '#1a1410';
    ctx.font = `bold ${11 / this.camera.zoom}px DM Sans, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const isMinHome =
      this.origin.mode === 'minor' ||
      (M && M.MODES && M.MODES[this.origin.mode] && M.MODES[this.origin.mode].romanBase === 'minor');
    const homeChordLabel = homeName + (isMinHome ? 'm' : '');
    ctx.fillText(homeChordLabel || 'I', 0, -1 / this.camera.zoom);
    ctx.fillStyle = homeHover ? 'rgba(26,20,16,0.75)' : 'rgba(26,20,16,0.55)';
    ctx.font = `${7.5 / this.camera.zoom}px DM Sans, sans-serif`;
    ctx.fillText('HOME', 0, 11 / this.camera.zoom);

    ctx.fillStyle = 'rgba(232,201,138,0.75)';
    ctx.font = `${10 / this.camera.zoom}px Cinzel, serif`;
    ctx.fillText(
      empty ? 'click to start' : 'click = tonic',
      0,
      homeR + 16 / this.camera.zoom
    );

    if (empty && this._mode !== 'node') {
      ctx.fillStyle = 'rgba(180,168,150,0.55)';
      ctx.font = `${9 / this.camera.zoom}px DM Sans, sans-serif`;
      ctx.fillText('outer dots = other first moves', 0, homeR + 30 / this.camera.zoom);
    } else if (this.nodes && this.nodes.length === 1 && this.showHorizon && this._mode !== 'node') {
      ctx.fillStyle = 'rgba(200,184,160,0.55)';
      ctx.font = `${9 / this.camera.zoom}px DM Sans, sans-serif`;
      ctx.fillText('Click outer dots for next · drag path to swap', 0, homeR + 30 / this.camera.zoom);
    }

    // Options: hollow rings around the *selected* path node (constellation)
    if (this.showHorizon && this._mode !== 'node' && this.horizon.length) {
      const ax =
        (this.horizon[0] && this.horizon[0]._anchor && this.horizon[0]._anchor.x) ||
        (this.nodes[this.current] && this.nodes[this.current].x) ||
        0;
      const ay =
        (this.horizon[0] && this.horizon[0]._anchor && this.horizon[0]._anchor.y) ||
        (this.nodes[this.current] && this.nodes[this.current].y) ||
        0;
      // Soft selection orbit
      ctx.beginPath();
      ctx.arc(ax, ay, 58, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(126,184,218,0.15)';
      ctx.lineWidth = 1 / this.camera.zoom;
      ctx.setLineDash([3 / this.camera.zoom, 4 / this.camera.zoom]);
      ctx.stroke();
      ctx.setLineDash([]);

      this.horizon.forEach((h) => {
        if (h.kind === 'home') return;
        const col = REGION[h.kind] || REGION[h.chord && h.chord.region] || REGION.flavour;
        const isH = this.hover && this.hover.type === 'horizon' && this.hover.item === h;
        // Stem from selection, not from map origin
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(h.x, h.y);
        ctx.strokeStyle = isH ? 'rgba(157,222,168,0.55)' : 'rgba(180,168,150,0.14)';
        ctx.lineWidth = (isH ? 1.6 : 1) / this.camera.zoom;
        ctx.stroke();

        // Hollow option (not solid path-node look)
        const rr = isH ? 12 : 9;
        ctx.beginPath();
        ctx.arc(h.x, h.y, rr, 0, Math.PI * 2);
        ctx.fillStyle = isH ? 'rgba(20,16,12,0.92)' : 'rgba(12,10,8,0.55)';
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
        ctx.fillStyle = isH ? '#9ddea8' : 'rgba(230,220,200,0.88)';
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

      // Ghost path on option hover: prev → option → next (visual join)
      if (this.hover && this.hover.type === 'horizon' && this.hover.item) {
        const h = this.hover.item;
        const ci = this.current;
        const prevN = ci > 0 ? this.nodes[ci - 1] : null;
        const nextN = ci >= 0 && ci < this.nodes.length - 1 ? this.nodes[ci + 1] : null;
        // If options mean "next move", ghost through selected → option
        const fromN = this.nodes[ci] || null;
        ctx.strokeStyle = 'rgba(125,186,146,0.7)';
        ctx.lineWidth = 2.5 / this.camera.zoom;
        ctx.lineCap = 'round';
        if (fromN) {
          ctx.beginPath();
          ctx.moveTo(fromN.x, fromN.y);
          ctx.lineTo(h.x, h.y);
          ctx.stroke();
        }
        if (nextN && fromN) {
          // show option replacing next
          ctx.globalAlpha = 0.45;
          ctx.beginPath();
          ctx.moveTo(h.x, h.y);
          ctx.lineTo(nextN.x, nextN.y);
          ctx.stroke();
          ctx.globalAlpha = 1;
        } else if (prevN && !fromN) {
          ctx.beginPath();
          ctx.moveTo(prevN.x, prevN.y);
          ctx.lineTo(h.x, h.y);
          ctx.stroke();
        }
      }
    }

    // Alt path
    if (this.showAlt) {
      for (let i = 0; i < this.altNodes.length - 1; i++) {
        const a = this.altNodes[i];
        const b = this.altNodes[i + 1];
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
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
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r * (div ? 1.05 : 0.85), 0, Math.PI * 2);
        ctx.fillStyle = div ? 'rgba(126,184,218,0.55)' : 'rgba(126,184,218,0.28)';
        ctx.fill();
        ctx.strokeStyle = div || altHover ? '#b8e0f5' : '#7eb8da';
        ctx.lineWidth = (div || altHover ? 2.5 : 1.2) / this.camera.zoom;
        ctx.stroke();
        if (div) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.r + 6 / this.camera.zoom, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(126,184,218,0.45)';
          ctx.lineWidth = 1.5 / this.camera.zoom;
          ctx.stroke();
        }
        // Compare tooltip on divergent steps
        if ((altHover || (div && this.hover && this.hover.type === 'path' && this.hover.item && this.hover.item.i === i)) && this.nodes[i]) {
          const gold = this.nodes[i].chord;
          const blue = n.chord;
          const tip =
            'v? ' +
            (gold.name || '?') +
            '  ·  compare ' +
            (blue.name || '?');
          const label =
            (gold.name || '?') + ' → ' + (blue.name || '?') + (div ? ' · differ' : ' · same');
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
    for (let i = 0; i < this.nodes.length - 1; i++) {
      const a = this.nodes[i];
      const b = this.nodes[i + 1];
      const ax = a.x;
      const ay = a.y;
      const bx = b.x;
      const by = b.y;
      const st = this._edgeStyle(a, b);
      const playing = this.playing;
      let alpha = 1;
      if (playing >= 0) {
        if (i < playing - 1) alpha = 0.28;
        else if (i === playing - 1) alpha = 0.95;
        else if (i >= playing) alpha = 0.4;
      }
      ctx.beginPath();
      const mx = (ax + bx) / 2 + (by - ay) * 0.08;
      const my = (ay + by) / 2 - (bx - ax) * 0.08;
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(mx, my, bx, by);
      ctx.strokeStyle = st.color;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = (st.w * (i === playing - 1 ? 1.35 : 1)) / this.camera.zoom;
      ctx.lineCap = 'round';
      ctx.stroke();
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

      // Aim targets — always visible while aiming
      this.alts.forEach((a) => {
        const isSnap = this.snapAlt === a;
        if (isSnap) {
          ctx.beginPath();
          ctx.arc(a.x, a.y, this.snapRadius, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(125,186,146,0.12)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(125,186,146,0.45)';
          ctx.lineWidth = 1.5 / z;
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(a.x, a.y, isSnap ? 18 : 14, 0, Math.PI * 2);
        ctx.fillStyle = isSnap ? 'rgba(125,186,146,0.7)' : 'rgba(20,16,12,0.82)';
        ctx.fill();
        ctx.strokeStyle = isSnap ? '#9ddea8' : 'rgba(232,201,138,0.75)';
        ctx.lineWidth = (isSnap ? 3 : 1.6) / z;
        ctx.stroke();
        ctx.fillStyle = isSnap ? '#0a0a0a' : 'rgba(255,244,214,0.95)';
        ctx.font = `bold ${10 / z}px DM Sans, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(a.label, a.x, a.y - (a.role ? 3 / z : 0));
        if (a.role) {
          ctx.fillStyle = isSnap ? 'rgba(10,10,10,0.75)' : 'rgba(180,168,150,0.9)';
          ctx.font = `${8 / z}px DM Sans, sans-serif`;
          ctx.fillText(a.role, a.x, a.y + 11 / z);
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
          : 'Move crosshair onto a labelled target to audition · release off-target = cancel'
        : this.hover && this.hover.type === 'home'
          ? 'Centre = write-home tonic — click to start or land'
          : this.hover && this.hover.type === 'horizon'
            ? 'Option from selection · green ghost = join · click to write'
            : this.hover && this.hover.type === 'edge'
              ? 'Click edge to insert (steals time from neighbors)'
              : this.hover && this.hover.type === 'altNode'
                ? 'Blue compare path — names show where versions differ'
                : this.nodes && this.nodes.length
                  ? 'Solid numbered = path · hollow around selection = options · drag path to swap'
                  : 'Click the centre gold disc to start on the home chord';
    ctx.fillText(tip, 10, h - 12);

    // Map reading legend (top-left)
    ctx.font = '9px DM Sans, sans-serif';
    ctx.fillStyle = 'rgba(180,168,150,0.5)';
    ctx.fillText(
      'Home centre · solid path · hollow options from selection · blue = compare',
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

  global.HLSpatial = { SpatialMap, REGION };
})(typeof window !== 'undefined' ? window : globalThis);
