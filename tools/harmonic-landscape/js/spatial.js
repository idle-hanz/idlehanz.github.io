/**
 * Path-in-space map: sequence trail, horizon, drag-to-alternate snap
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
    this.altPath = []; // secondary version path (parallel variation)
    this.altNodes = [];
    this.horizon = [];
    this.alts = []; // snap targets while dragging a path node
    this.current = -1;
    this.playing = -1;
    /** home = lock on tonic (default); follow = pan to current (jarring); fit = frame whole path */
    this.cameraMode = 'home';
    this.camera = { x: 0, y: 0, zoom: 1, tx: 0, ty: 0, tz: 1 };
    this.hover = null;
    this.snapAlt = null;
    this.onSelectPath = null;
    this.onSelectHorizon = null;
    this.onHoverHorizon = null;
    this.onRequestAlts = null; // (pathIndex, chord) => [{chord, label}]
    this.onSwapChord = null; // (pathIndex, newChord) => void
    this._mode = null; // pan | node
    this._dragNode = null;
    this._dragPos = null;
    this._last = null;
    this._moved = false;
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

  SpatialMap.prototype.setPath = function (chords, currentIndex) {
    // Don't clobber mid-drag
    if (this._mode === 'node') return;
    this.path = (chords || []).map((c) => ({ ...c }));
    this.current = currentIndex != null ? currentIndex : this.path.length - 1;
    this._layoutPath();
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
    // Only follow playhead if camera mode is "follow"
    if (this.cameraMode === 'follow' && i >= 0 && this.nodes[i] && this._mode !== 'node') {
      this.camera.tx = this.nodes[i].x;
      this.camera.ty = this.nodes[i].y;
    }
  };

  /** Secondary path (e.g. variation v2) drawn under/beside primary. */
  SpatialMap.prototype.setAltPath = function (chords) {
    this.altPath = (chords || []).map((c) => ({ ...c }));
    this._layoutAltPath();
  };

  SpatialMap.prototype._chordPos = function (ch, index, lane) {
    const M = global.HLMusic;
    const R = Math.min(this.w || 500, this.h || 360) * 0.36;
    const dist = M.harmonicDistance(ch, this.origin.tonic, this.origin.mode);
    // Stable position from root/quality — NO index spiral (keeps variants aligned)
    const ang = M.harmonicAngle(ch, this.origin.tonic);
    const radius = 40 + dist * (R / 2.6);
    // Slight lane offset so v1/v2 don't fully stack
    const off = lane === 1 ? 10 : 0;
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
      const r = 14 + Math.min(14, (ch.duration || 4) * 1.4);
      return { chord: ch, x: pos.x, y: pos.y, r, i };
    });
    this._layoutAltPath();
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
    // fit
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const all = this.nodes.concat(this.altNodes || []);
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

  SpatialMap.prototype._layoutAlts = function (pathIndex, alts) {
    const origin = this.nodes[pathIndex] || { x: 0, y: 0 };
    const n = (alts || []).length || 1;
    this.alts = (alts || []).map((a, i) => {
      const ang = -Math.PI / 2 + (i / n) * Math.PI * 2;
      const rad = 48 + (i % 3) * 10;
      // Prefer natural harmonic position blended with ring around node
      const natural = this._chordPos(a.chord, pathIndex);
      const x = origin.x * 0.25 + natural.x * 0.35 + Math.cos(ang) * rad;
      const y = origin.y * 0.25 + natural.y * 0.35 + Math.sin(ang) * rad * 0.75;
      return {
        chord: a.chord,
        label: a.label || a.chord.name,
        x,
        y,
        r: 13,
      };
    });
  };

  SpatialMap.prototype.screenToWorld = function (sx, sy) {
    return {
      x: (sx - this.w / 2) / this.camera.zoom + this.camera.x,
      y: (sy - this.h / 2) / this.camera.zoom + this.camera.y,
    };
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
    for (let i = this.horizon.length - 1; i >= 0; i--) {
      const h = this.horizon[i];
      const dx = w.x - h.x;
      const dy = w.y - h.y;
      if (dx * dx + dy * dy <= 16 * 16) return { type: 'horizon', item: h };
    }
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const n = this.nodes[i];
      const dx = w.x - n.x;
      const dy = w.y - n.y;
      if (dx * dx + dy * dy <= (n.r + 6) * (n.r + 6)) return { type: 'path', item: n };
    }
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
      this._dragPos = { x: hit.item.x, y: hit.item.y };
      this.current = hit.item.i;
      if (this.onSelectPath) this.onSelectPath(hit.item.i, hit.item.chord);
      // Request alternate close versions
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
      this._dragPos = { x: w.x, y: w.y };
      this._moved = true;
      // Snap to nearest alt
      let best = null;
      let bestD = 28 * 28;
      this.alts.forEach((a) => {
        const dx = w.x - a.x;
        const dy = w.y - a.y;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = a;
        }
      });
      const prev = this.snapAlt;
      this.snapAlt = best;
      if (best && best !== prev && this.onHoverHorizon) {
        this.onHoverHorizon({ chord: best.chord, kind: 'alt', label: best.label });
      }
      this.canvas.style.cursor = 'grabbing';
      return;
    }

    const hit = this._hit(sx, sy);
    const prev = this.hover;
    this.hover = hit;
    this.canvas.style.cursor = hit ? 'pointer' : 'grab';
    if (hit && hit.type === 'horizon' && (!prev || prev.item !== hit.item)) {
      if (this.onHoverHorizon) this.onHoverHorizon(hit.item);
    }
  };

  SpatialMap.prototype._up = function (e) {
    if (this._mode === 'node' && this._dragNode) {
      if (this.snapAlt && this._moved && this.onSwapChord) {
        this.onSwapChord(this._dragNode.i, this.snapAlt.chord);
      } else if (!this._moved && this.onSelectPath) {
        this.onSelectPath(this._dragNode.i, this._dragNode.chord);
      }
    }
    this._mode = null;
    this._dragNode = null;
    this._dragPos = null;
    this._last = null;
    this.alts = [];
    this.snapAlt = null;
    this.canvas.style.cursor = 'grab';
  };

  SpatialMap.prototype.start = function () {
    const loop = () => {
      requestAnimationFrame(loop);
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

  SpatialMap.prototype.draw = function () {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    if (!w) return;

    const g = ctx.createRadialGradient(w * 0.5, h * 0.45, 10, w * 0.5, h * 0.5, Math.max(w, h) * 0.65);
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
    [0.35, 0.6, 0.9].forEach((f, i) => {
      ctx.beginPath();
      ctx.ellipse(0, 0, R * f, R * f * 0.72, 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(196,165,116,${0.1 - i * 0.02})`;
      ctx.lineWidth = 1.2 / this.camera.zoom;
      ctx.stroke();
    });

    // Home
    const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 50);
    glow.addColorStop(0, 'rgba(255,200,120,0.35)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, 50, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, 9, 0, Math.PI * 2);
    ctx.fillStyle = '#e8c98a';
    ctx.fill();
    const M = global.HLMusic;
    ctx.fillStyle = 'rgba(232,201,138,0.9)';
    ctx.font = `${11 / this.camera.zoom}px Cinzel, serif`;
    ctx.textAlign = 'center';
    ctx.fillText(M ? M.noteName(this.origin.tonic) + ' home' : 'home', 0, 26 / this.camera.zoom);

    // Horizon (hidden while dragging node for clarity)
    if (this._mode !== 'node') {
      this.horizon.forEach((h) => {
        const col = REGION[h.kind] || REGION.flavour;
        const isH = this.hover && this.hover.type === 'horizon' && this.hover.item === h;
        ctx.beginPath();
        ctx.arc(h.x, h.y, isH ? 14 : 11, 0, Math.PI * 2);
        ctx.fillStyle = col.ghost;
        ctx.fill();
        ctx.strokeStyle = col.fill;
        ctx.lineWidth = (isH ? 2 : 1.2) / this.camera.zoom;
        ctx.stroke();
        ctx.fillStyle = isH ? '#fff' : 'rgba(230,220,200,0.85)';
        ctx.font = `${9 / this.camera.zoom}px DM Sans, sans-serif`;
        ctx.fillText(h.label, h.x, h.y + 20 / this.camera.zoom);
      });
    }

    // Alt path (variation) — blue ribbon under gold
    for (let i = 0; i < this.altNodes.length - 1; i++) {
      const a = this.altNodes[i];
      const b = this.altNodes[i + 1];
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = 'rgba(126,184,218,0.55)';
      ctx.lineWidth = 3 / this.camera.zoom;
      ctx.stroke();
    }
    this.altNodes.forEach((n) => {
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r * 0.85, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(126,184,218,0.35)';
      ctx.fill();
      ctx.strokeStyle = '#7eb8da';
      ctx.lineWidth = 1.5 / this.camera.zoom;
      ctx.stroke();
      ctx.fillStyle = 'rgba(180,220,240,0.9)';
      ctx.font = `${8 / this.camera.zoom}px DM Sans, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(n.chord.name, n.x, n.y + n.r + 10 / this.camera.zoom);
    });

    // Path threads (primary) — colour by root motion
    for (let i = 0; i < this.nodes.length - 1; i++) {
      const a = this.nodes[i];
      const b = this.nodes[i + 1];
      const ax = this._mode === 'node' && this._dragNode && this._dragNode.i === i ? this._dragPos.x : a.x;
      const ay = this._mode === 'node' && this._dragNode && this._dragNode.i === i ? this._dragPos.y : a.y;
      const bx = this._mode === 'node' && this._dragNode && this._dragNode.i === i + 1 ? this._dragPos.x : b.x;
      const by = this._mode === 'node' && this._dragNode && this._dragNode.i === i + 1 ? this._dragPos.y : b.y;
      // Side alternation: opposite half-planes around home → brighter
      const cross = a.x * b.x < 0 || a.y * b.y < 0;
      ctx.beginPath();
      const mx = (ax + bx) / 2 + (by - ay) * 0.1;
      const my = (ay + by) / 2 - (bx - ax) * 0.1;
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(mx, my, bx, by);
      ctx.strokeStyle = cross ? 'rgba(232,201,138,0.75)' : 'rgba(232,201,138,0.4)';
      ctx.lineWidth = (cross ? 3.2 : 2.4) / this.camera.zoom;
      ctx.stroke();
    }

    // Alt snap targets
    if (this._mode === 'node') {
      this.alts.forEach((a) => {
        const isSnap = this.snapAlt === a;
        ctx.beginPath();
        ctx.arc(a.x, a.y, isSnap ? 16 : 12, 0, Math.PI * 2);
        ctx.fillStyle = isSnap ? 'rgba(232,201,138,0.55)' : 'rgba(232,201,138,0.22)';
        ctx.fill();
        ctx.strokeStyle = isSnap ? '#fff4d6' : '#c4a574';
        ctx.lineWidth = (isSnap ? 2.5 : 1.2) / this.camera.zoom;
        ctx.stroke();
        ctx.fillStyle = isSnap ? '#fff' : 'rgba(232,201,138,0.9)';
        ctx.font = `${10 / this.camera.zoom}px DM Sans, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(a.label, a.x, a.y + 22 / this.camera.zoom);
      });
      // guide text in world? skip
    }

    // Path nodes
    this.nodes.forEach((n) => {
      const reg = n.chord.region || 'diatonic';
      const col = REGION[reg] || REGION.diatonic;
      const isCur = n.i === this.current;
      const isPlay = n.i === this.playing;
      const dragging = this._mode === 'node' && this._dragNode && this._dragNode.i === n.i;
      const x = dragging ? this._dragPos.x : n.x;
      const y = dragging ? this._dragPos.y : n.y;
      const r = n.r * (isPlay || isCur || dragging ? 1.12 : 1);

      if (dragging) {
        ctx.globalAlpha = 0.95;
      }
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = col.fill;
      ctx.fill();
      if (isCur || isPlay || dragging) {
        ctx.strokeStyle = '#fff4d6';
        ctx.lineWidth = 2.5 / this.camera.zoom;
        ctx.stroke();
      }
      ctx.fillStyle = '#0a0a0a';
      ctx.font = `bold ${Math.max(9, 10 / this.camera.zoom)}px DM Sans, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(dragging && this.snapAlt ? this.snapAlt.label : n.chord.name, x, y);
      ctx.fillStyle = 'rgba(200,184,160,0.75)';
      ctx.font = `${9 / this.camera.zoom}px DM Sans, sans-serif`;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(String(n.i + 1), x, y - r - 6 / this.camera.zoom);
      ctx.globalAlpha = 1;
    });

    ctx.restore();

    ctx.fillStyle = 'rgba(180,168,150,0.55)';
    ctx.font = '11px Crimson Text, Georgia, serif';
    ctx.textAlign = 'left';
    const tip =
      this._mode === 'node'
        ? 'Drag onto a gold alternate to swap · release to commit'
        : this.altNodes.length
          ? 'Gold = this version · blue = sibling variation · camera: ' + this.cameraMode
          : 'Gold path · pale = options · camera: ' + this.cameraMode + ' (Home lock = no jolt)';
    ctx.fillText(tip, 10, h - 10);
  };

  SpatialMap.prototype.focusHome = function () {
    this.cameraMode = 'home';
    this.camera.tx = 0;
    this.camera.ty = 0;
    this.camera.tz = 1;
  };

  global.HLSpatial = { SpatialMap, REGION };
})(typeof window !== 'undefined' ? window : globalThis);
