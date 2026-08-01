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

  SpatialMap.prototype.setHorizon = function (items) {
    if (this._mode === 'node') return;
    const M = global.HLMusic;
    const R = Math.min(this.w || 500, this.h || 360) * 0.36;
    const anchor =
      this.current >= 0 && this.nodes[this.current]
        ? this.nodes[this.current]
        : { x: 0, y: 0 };

    this.horizon = (items || []).map((it, i) => {
      const ch = it.chord;
      const dist = M.harmonicDistance(ch, this.origin.tonic, this.origin.mode);
      const ang = M.harmonicAngle(ch, this.origin.tonic) + i * 0.11;
      const radius = 55 + dist * (R / 2.6);
      let x = Math.cos(ang) * radius;
      let y = Math.sin(ang) * radius * 0.72;
      x = x * 0.7 + anchor.x * 0.3;
      y = y * 0.7 + anchor.y * 0.3;
      x += Math.cos(i * 1.25) * 14;
      y += Math.sin(i * 1.25) * 12;
      return {
        chord: ch,
        kind: it.kind || 'direction',
        label: it.label || ch.name,
        job: it.job || '',
        route: it.route,
        modulateTo: it.modulateTo,
        x,
        y,
        r: 12,
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

  SpatialMap.prototype._chordPos = function (ch, index, lane) {
    const M = global.HLMusic;
    const R = Math.min(this.w || 500, this.h || 360) * 0.36;
    const dist = M.harmonicDistance(ch, this.origin.tonic, this.origin.mode);
    const ang = M.harmonicAngle(ch, this.origin.tonic);
    const radius = 40 + dist * (R / 2.6);
    const off = lane === 1 ? 12 : 0;
    return {
      x: Math.cos(ang) * radius + (lane === 1 ? Math.cos(ang + Math.PI / 2) * off : 0),
      y: Math.sin(ang) * radius * 0.72 + (lane === 1 ? Math.sin(ang + Math.PI / 2) * off * 0.72 : 0),
    };
  };

  SpatialMap.prototype._layoutPath = function () {
    const M = global.HLMusic;
    if (!M) return;
    this.nodes = this.path.map((ch, i) => {
      const pos = this._chordPos(ch, i, 0);
      const r = 15 + Math.min(14, (ch.duration || 4) * 1.4);
      return { chord: ch, x: pos.x, y: pos.y, r, i };
    });
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
      const r = 12 + Math.min(12, (ch.duration || 4) * 1.2);
      return { chord: ch, x: pos.x, y: pos.y, r, i };
    });
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
        if (dx * dx + dy * dy <= 16 * 16) return { type: 'horizon', item: h };
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

    // Home
    const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 55);
    glow.addColorStop(0, 'rgba(255,200,120,0.4)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, 55, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.fillStyle = '#e8c98a';
    ctx.fill();
    const M = global.HLMusic;
    ctx.fillStyle = 'rgba(232,201,138,0.95)';
    ctx.font = `${12 / this.camera.zoom}px Cinzel, serif`;
    ctx.textAlign = 'center';
    ctx.fillText(M ? M.noteName(this.origin.tonic) + ' home' : 'home', 0, 28 / this.camera.zoom);

    // Horizon
    if (this.showHorizon && this._mode !== 'node') {
      this.horizon.forEach((h) => {
        const col = REGION[h.kind] || REGION.flavour;
        const isH = this.hover && this.hover.type === 'horizon' && this.hover.item === h;
        ctx.beginPath();
        ctx.arc(h.x, h.y, isH ? 14 : 10, 0, Math.PI * 2);
        ctx.fillStyle = col.ghost;
        ctx.fill();
        ctx.strokeStyle = col.fill;
        ctx.lineWidth = (isH ? 2 : 1) / this.camera.zoom;
        ctx.stroke();
        ctx.fillStyle = isH ? '#fff' : 'rgba(230,220,200,0.75)';
        ctx.font = `${8 / this.camera.zoom}px DM Sans, sans-serif`;
        ctx.fillText(h.label, h.x, h.y + 18 / this.camera.zoom);
      });
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
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r * (div ? 1.05 : 0.85), 0, Math.PI * 2);
        ctx.fillStyle = div ? 'rgba(126,184,218,0.55)' : 'rgba(126,184,218,0.28)';
        ctx.fill();
        ctx.strokeStyle = div ? '#b8e0f5' : '#7eb8da';
        ctx.lineWidth = (div ? 2.5 : 1.2) / this.camera.zoom;
        ctx.stroke();
        if (div) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.r + 6 / this.camera.zoom, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(126,184,218,0.45)';
          ctx.lineWidth = 1.5 / this.camera.zoom;
          ctx.stroke();
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

    // Primary path edges
    for (let i = 0; i < this.nodes.length - 1; i++) {
      const a = this.nodes[i];
      const b = this.nodes[i + 1];
      // Chord stays put while aiming — path does not free-float with the cursor
      const ax = a.x;
      const ay = a.y;
      const bx = b.x;
      const by = b.y;
      const st = this._edgeStyle(a, b);
      ctx.beginPath();
      const mx = (ax + bx) / 2 + (by - ay) * 0.08;
      const my = (ay + by) / 2 - (bx - ax) * 0.08;
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(mx, my, bx, by);
      ctx.strokeStyle = st.color;
      ctx.lineWidth = st.w / this.camera.zoom;
      ctx.lineCap = 'round';
      ctx.stroke();
      // direction tick
      const t = 0.55;
      const px = (1 - t) * (1 - t) * ax + 2 * (1 - t) * t * mx + t * t * bx;
      const py = (1 - t) * (1 - t) * ay + 2 * (1 - t) * t * my + t * t * by;
      ctx.beginPath();
      ctx.arc(px, py, 2.5 / this.camera.zoom, 0, Math.PI * 2);
      ctx.fillStyle = st.color;
      ctx.fill();
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

    // Primary nodes — always stay on path positions (never free-float with cursor)
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
      const r = n.r * (isPlay || isCur || aiming ? 1.12 : 1) * pulse;

      // Playhead / selection ring
      if (isPlay || isCur) {
        ctx.beginPath();
        ctx.arc(x, y, r + 8 / this.camera.zoom, 0, Math.PI * 2);
        ctx.strokeStyle = isPlay ? 'rgba(255,244,214,0.75)' : 'rgba(232,201,138,0.45)';
        ctx.lineWidth = 2.5 / this.camera.zoom;
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
        : this.hover && this.hover.type === 'edge'
          ? 'Click edge to insert (steals time from neighbors)'
          : 'Grab chord → aim · edge insert · gold path / blue compare';
    ctx.fillText(tip, 10, h - 12);

    // Map reading legend (top-left)
    ctx.font = '9px DM Sans, sans-serif';
    ctx.fillStyle = 'rgba(180,168,150,0.5)';
    ctx.fillText('∠ root   ·   radius = distance from home', 10, 14);

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
