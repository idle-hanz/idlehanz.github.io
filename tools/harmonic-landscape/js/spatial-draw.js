/**
 * spatial-draw.js - SpatialMap prototype extensions (load after spatial.js).
 * Pure extract; no intentional behavior change.
 */
(function (global) {
  "use strict";
  var HS = global.HLSpatial;
  if (!HS || !HS.SpatialMap) throw new Error("Load spatial.js before spatial-draw.js");
  var SpatialMap = HS.SpatialMap;
  var REGION = HS.REGION;
  var SEAT = HS.SEAT;

  SpatialMap.prototype._followFocusDisk = function () {
    const i = this.playing >= 0 ? this.playing : this.current;
    const ch = this.path && i >= 0 ? this.path[i] : null;
    if (ch && this._diskForChord) return this._diskForChord(ch);
    return this._activeDisk && this._activeDisk();
  };

  SpatialMap.prototype._wakeK = function () {
    if (this._wakeFrom == null || this._wakeFrom < 0 || !this._wakeAt) return 1;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const ms = this._wakeMs || 2400;
    let u = (now - this._wakeAt) / ms;
    if (u < 0) u = 0;
    if (u > 1) u = 1;
    return u * u * (3 - 2 * u);
  };

  SpatialMap.prototype._followFocusWorld = function () {
    const i = this.playing >= 0 ? this.playing : this.current;
    if (this.nodes && this.nodes[i]) {
      return { x: this.nodes[i].x, y: this.nodes[i].y };
    }
    const d = this._followFocusDisk();
    return { x: (d && d.cx) || 0, y: (d && d.cy) || 0 };
  };

  SpatialMap.prototype._drawFocusOptions = function (ctx) {
    const list = this._focusOptions || [];
    if (!list.length) return;
    const from = this._followFocusWorld();
    const z = this.camera.zoom || 1;
    const t = this.pulseT || 0;
    const bloom = this._focusBloom ? this._focusBloom() : 0.5;
    list.forEach((o, idx) => {
      const breath = 0.88 + 0.12 * Math.sin(t * 0.85 + idx * 0.55);
      const rise = bloom * breath;
      if (o.kind === 'modulate') {
        const gR = o.r || 64;
        const rumour = o.rumoured ? 0.35 : 1;
        const a = (0.2 + 0.75 * rise) * o.weight * rumour;
        ctx.globalAlpha = a;
        const fill = ctx.createRadialGradient(o.x, o.y, gR * 0.1, o.x, o.y, gR * 1.05);
        fill.addColorStop(0, 'rgba(70, 42, 110, 0.45)');
        fill.addColorStop(1, 'rgba(20, 10, 40, 0)');
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.ellipse(o.x, o.y, gR, gR * 0.88, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(o.x, o.y, gR * 1.02, gR * 1.02 * 0.88, 0, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(196,170,255,' + (0.35 + 0.55 * rise) + ')';
        ctx.lineWidth = 2 / z;
        ctx.setLineDash([6 / z, 5 / z]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(230,214,255,' + (0.4 + 0.55 * rise) + ')';
        ctx.font = `bold ${12 / z}px DM Sans, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(o.label || 'key', o.x, o.y - 4 / z);
        if (o.relation) {
          ctx.font = `${8.5 / z}px DM Sans, sans-serif`;
          ctx.fillStyle = 'rgba(180,160,230,' + (0.3 + 0.45 * rise) + ')';
          ctx.fillText(o.relation, o.x, o.y + 11 / z);
        }
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(o.x, o.y);
        ctx.strokeStyle = 'rgba(167,139,250,' + (0.08 + 0.28 * rise) + ')';
        ctx.lineWidth = 1.1 / z;
        ctx.stroke();
        return;
      }
      const late = o.next && bloom > 0.62 ? (bloom - 0.62) / 0.38 : 0;
      const a =
        (o.next ? 0.38 + late * 0.55 : 0.16 + o.weight * 0.38) * rise;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(o.x, o.y);
      ctx.strokeStyle = o.next
        ? 'rgba(255,226,170,' + a * 0.7 + ')'
        : 'rgba(232,201,138,' + a * 0.45 + ')';
      ctx.lineWidth = (o.next ? 1.8 : 0.9) / z;
      ctx.lineCap = 'round';
      ctx.stroke();
      const rad = ((o.next ? 14 : 8 + o.weight * 7) / z) * (0.85 + 0.15 * rise);
      const ember = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, rad * 2.6);
      ember.addColorStop(0, 'rgba(255,236,196,' + a + ')');
      ember.addColorStop(0.4, 'rgba(220,160,80,' + a * 0.4 + ')');
      ember.addColorStop(1, 'rgba(80,40,10,0)');
      ctx.fillStyle = ember;
      ctx.beginPath();
      ctx.arc(o.x, o.y, rad * 2.6, 0, Math.PI * 2);
      ctx.fill();
    });
  };

  SpatialMap.prototype._drawFollowAtmosphere = function (ctx) {
    const focus =
      (this._focusLampWorld && this._focusLampWorld()) ||
      this._followFocusWorld();
    const disk = this._followFocusDisk();
    const R = (disk && disk.R) || 120;
    const fx = focus.x;
    const fy = focus.y;
    const z = this.camera.zoom || 1;
    const pulse = 1 + 0.04 * Math.sin((this.pulseT || 0) * 1.4);

    const glow = ctx.createRadialGradient(fx, fy, 4, fx, fy, R * 0.92 * pulse);
    glow.addColorStop(0, 'rgba(255,228,176,0.14)');
    glow.addColorStop(0.35, 'rgba(200,140,70,0.07)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(fx, fy, R * 0.95, 0, Math.PI * 2);
    ctx.fill();

    const cover = Math.max(R * 4.5, (Math.max(this.w || 500, this.h || 360) / z) * 1.4);
    const fog = ctx.createRadialGradient(fx, fy, R * 0.28, fx, fy, cover);
    fog.addColorStop(0, 'rgba(6,4,3,0)');
    fog.addColorStop(0.38, 'rgba(5,3,2,0.22)');
    fog.addColorStop(0.62, 'rgba(3,2,2,0.62)');
    fog.addColorStop(0.82, 'rgba(1,1,1,0.86)');
    fog.addColorStop(1, 'rgba(0,0,0,0.94)');
    ctx.fillStyle = fog;
    ctx.beginPath();
    ctx.arc(fx, fy, cover, 0, Math.PI * 2);
    ctx.fill();

    const st = this._focusRunState && this._focusRunState();
    const fadeT = this._focusFadeT ? this._focusFadeT() : 0;
    if (st && st.nxt && fadeT > 0.02) {
      const ix = st.nxt.cx || 0;
      const iy = st.nxt.cy || 0;
      const iR = st.nxt.R || R;
      const dawn = ctx.createRadialGradient(ix, iy, iR * 0.08, ix, iy, iR * 1.05);
      dawn.addColorStop(0, 'rgba(200,170,255,' + (0.04 + fadeT * 0.18) + ')');
      dawn.addColorStop(0.45, 'rgba(140,110,200,' + fadeT * 0.09 + ')');
      dawn.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = dawn;
      ctx.beginPath();
      ctx.arc(ix, iy, iR * 1.08, 0, Math.PI * 2);
      ctx.fill();
      const tooth = this._meshContactBetween
        ? this._meshContactBetween(st.here, st.nxt)
        : null;
      if (tooth && fadeT > 0.28 && fadeT < 0.85) {
        const hold = 1 - Math.abs(fadeT - 0.5) / 0.35;
        const tw = Math.max(0, Math.min(1, hold));
        const toothG = ctx.createRadialGradient(
          tooth.x,
          tooth.y,
          4,
          tooth.x,
          tooth.y,
          R * 0.55
        );
        toothG.addColorStop(0, 'rgba(255,236,200,' + (0.12 + tw * 0.28) + ')');
        toothG.addColorStop(0.45, 'rgba(210,170,255,' + tw * 0.14 + ')');
        toothG.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = toothG;
        ctx.beginPath();
        ctx.arc(tooth.x, tooth.y, R * 0.58, 0, Math.PI * 2);
        ctx.fill();
      }
    }

  };

  /** Screen-space sounding name only — never the incoming key preview. */
  SpatialMap.prototype._drawFocusFogName = function (ctx, w, h) {
    const name = this._focusSoundingName ? this._focusSoundingName() : '';
    if (!name) return;
    const now =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (this._fogNameText !== name) {
      this._fogNamePrev = this._fogNameText || '';
      this._fogNamePrevSlot = this._fogNameSlot;
      this._fogNameText = name;
      this._fogNameAt = now;
      this._fogNameSlot = this._focusNameSlotFor
        ? this._focusNameSlotFor(name, w, h)
        : 0;
    }
    const pockets = this._focusNamePockets
      ? this._focusNamePockets(w, h)
      : [{ x: w * 0.07, y: h * 0.78, align: 'left' }];
    const fadeMs = 1100;
    const u = Math.min(1, (now - (this._fogNameAt || now)) / fadeMs);
    const size = Math.max(40, Math.min(w, h) * 0.082);
    const paint = (text, slot, alpha) => {
      if (!text || alpha < 0.02) return;
      const p = pockets[slot] || pockets[0];
      ctx.save();
      ctx.globalAlpha = alpha * 0.38;
      ctx.fillStyle = '#e8d4a8';
      ctx.font = '500 ' + size + 'px Cinzel, Georgia, serif';
      ctx.textAlign = p.align || 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, p.x, p.y);
      ctx.restore();
    };
    if (this._fogNamePrev && u < 1) {
      paint(this._fogNamePrev, this._fogNamePrevSlot || 0, 1 - u);
    }
    paint(name, this._fogNameSlot || 0, u < 1 ? 0.15 + u * 0.85 : 1);
  };

  SpatialMap.prototype._chordPcs = function (ch) {
    const notes = (ch && ch.notes) || [];
    const set = [];
    notes.forEach((n) => {
      const p = ((Number(n) % 12) + 12) % 12;
      if (set.indexOf(p) < 0) set.push(p);
    });
    if (!set.length && ch && ch.root != null) {
      set.push(((Number(ch.root) % 12) + 12) % 12);
    }
    return set;
  };

  SpatialMap.prototype._sharedPcs = function (a, b) {
    const A = this._chordPcs(a);
    const B = this._chordPcs(b);
    return A.filter((p) => B.indexOf(p) >= 0);
  };

  SpatialMap.prototype._drawFunctionHouses = function (ctx, z) {
    const disk = this._activeDisk();
    const R = disk.R || 120;
    const bandW = R * 1.22;
    const bandH = R * 2.55;
    const cols = [
      { id: 'home', x: -R * 1.58, label: 'HOME', fill: 'rgba(232,201,138,0.07)', stroke: 'rgba(232,201,138,0.32)' },
      { id: 'colour', x: 0, label: 'COLOUR', fill: 'rgba(167,139,250,0.07)', stroke: 'rgba(167,139,250,0.32)' },
      { id: 'pull', x: R * 1.58, label: 'PULL', fill: 'rgba(212,120,106,0.07)', stroke: 'rgba(212,120,106,0.32)' },
    ];
    cols.forEach((c) => {
      const x = c.x - bandW / 2;
      const y = -bandH / 2;
      ctx.beginPath();
      const r = 18;
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + bandW - r, y);
      ctx.quadraticCurveTo(x + bandW, y, x + bandW, y + r);
      ctx.lineTo(x + bandW, y + bandH - r);
      ctx.quadraticCurveTo(x + bandW, y + bandH, x + bandW - r, y + bandH);
      ctx.lineTo(x + r, y + bandH);
      ctx.quadraticCurveTo(x, y + bandH, x, y + bandH - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
      ctx.fillStyle = c.fill;
      ctx.fill();
      ctx.strokeStyle = c.stroke;
      ctx.lineWidth = 1.3 / z;
      ctx.stroke();
      ctx.fillStyle = c.stroke;
      ctx.font = `bold ${10 / z}px DM Sans, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(c.label, c.x, y - 8 / z);
    });
  };

  SpatialMap.prototype._drawFunctionLattice = function (ctx, hoverId, z) {
    const M = global.HLMusic;
    const tn = this.tonnetz || {};
    const verts = tn.verts || [];
    const hover = this.functionNodes.find((n) => n.id === hoverId);

    // Pitch-class vertices + fifth / third edges (the Tonnetz, not a star)
    const seen = {};
    verts.forEach((v) => {
      (this.functionNodes || []).forEach((n) => {
        if (!n.tri) return;
        n.tri.forEach((u) => {
          if (u === v) return;
          const di = Math.abs(u.i - v.i) + Math.abs(u.j - v.j);
          const adj =
            (u.i === v.i && Math.abs(u.j - v.j) === 1) ||
            (u.j === v.j && Math.abs(u.i - v.i) === 1) ||
            (u.i - v.i === 1 && u.j - v.j === -1) ||
            (v.i - u.i === 1 && v.j - u.j === -1);
          if (!adj && di > 2) return;
          if (!adj) return;
          const k = v.i + ',' + v.j + '>' + u.i + ',' + u.j;
          const k2 = u.i + ',' + u.j + '>' + v.i + ',' + v.j;
          if (seen[k] || seen[k2]) return;
          seen[k] = true;
          ctx.beginPath();
          ctx.moveTo(v.x, v.y);
          ctx.lineTo(u.x, u.y);
          ctx.strokeStyle = 'rgba(196,165,116,0.45)';
          ctx.lineWidth = 1.4 / z;
          ctx.stroke();
        });
      });
    });

    const visitsOf = (n) => {
      const vis = [];
      (this.path || []).forEach((ch, i) => {
        if (!ch || !n.chord) return;
        if (ch.root !== n.chord.root) return;
        const sameQ = ch.quality === n.chord.quality;
        const bothTri =
          this._tonnetzMode &&
          this._tonnetzMode(ch) &&
          this._tonnetzMode(ch) === this._tonnetzMode(n.chord);
        if (sameQ || bothTri) vis.push(i + 1);
      });
      return vis;
    };

    // Path thread through triangles you already wrote (same job as Journey gold)
    const pathPts = [];
    (this.path || []).forEach((ch) => {
      if (!ch) return;
      const hit = this.functionNodes.find(
        (n) =>
          n.chord &&
          n.chord.root === ch.root &&
          (n.chord.quality === ch.quality ||
            (this._tonnetzMode &&
              this._tonnetzMode(ch) &&
              this._tonnetzMode(ch) === this._tonnetzMode(n.chord)))
      );
      if (hit) pathPts.push(hit);
    });
    if (pathPts.length > 1) {
      ctx.beginPath();
      pathPts.forEach((n, i) => {
        if (i === 0) ctx.moveTo(n.x, n.y);
        else ctx.lineTo(n.x, n.y);
      });
      ctx.strokeStyle = 'rgba(232,201,138,0.85)';
      ctx.lineWidth = 3 / z;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    this.functionNodes.forEach((n) => {
      if (!n.tri || n.tri.length < 3) return;
      const a = n.tri[0];
      const b = n.tri[1];
      const c = n.tri[2];
      const isLamp = !!n.lamp;
      const isH = hover && n.id === hover.id;
      const vis = visitsOf(n);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.closePath();
      ctx.fillStyle = isLamp
        ? 'rgba(232,201,138,0.38)'
        : isH
          ? 'rgba(232,201,138,0.22)'
          : n.onPath
            ? 'rgba(196,165,116,0.16)'
            : n.plr
              ? 'rgba(126,184,218,0.10)'
              : 'rgba(20,16,12,0.45)';
      ctx.fill();
      ctx.strokeStyle = isLamp || isH ? '#e8c98a' : n.onPath ? 'rgba(232,201,138,0.7)' : 'rgba(180,168,150,0.35)';
      ctx.lineWidth = (isLamp ? 2.4 : 1.3) / z;
      ctx.stroke();
      ctx.fillStyle = isLamp ? '#1a1410' : 'rgba(230,220,200,0.92)';
      ctx.font = `bold ${11 / z}px DM Sans, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(n.roman || n.label || '?', n.x, n.y - (n.plr || vis.length ? 7 / z : 0));
      if (vis.length) {
        ctx.fillStyle = isLamp ? '#1a1410' : '#e8c98a';
        ctx.font = `bold ${9 / z}px DM Sans, sans-serif`;
        ctx.fillText(vis.join(' · '), n.x, n.y + 8 / z);
      } else if (n.plr) {
        ctx.fillStyle = '#7eb8da';
        ctx.font = `bold ${9 / z}px DM Sans, sans-serif`;
        ctx.fillText(n.plr, n.x, n.y + 10 / z);
      }
    });

    verts.forEach((v) => {
      ctx.beginPath();
      ctx.arc(v.x, v.y, 11 / z, 0, Math.PI * 2);
      ctx.fillStyle = '#2a2218';
      ctx.fill();
      ctx.strokeStyle = 'rgba(232,201,138,0.75)';
      ctx.lineWidth = 1.4 / z;
      ctx.stroke();
      ctx.fillStyle = '#e8c98a';
      ctx.font = `bold ${9 / z}px DM Sans, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(M && M.noteName ? M.noteName(v.pc) : String(v.pc), v.x, v.y);
    });
  };

  SpatialMap.prototype._drawFunctionChart = function (ctx) {
    if (!this.functionChart || !this.functionNodes.length) return;
    const byId = {};
    this.functionNodes.forEach((n) => {
      byId[n.id] = n;
    });
    const z = this.camera.zoom || 1;
    const atlas = this._atlasMode ? this._atlasMode() : 'wheel';
    if (atlas === 'houses') this._drawFunctionHouses(ctx, z);
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

    if (atlas === 'lattice') {
      const lamp = this.functionNodes.find((n) => n.lamp);
      this._drawFunctionLattice(ctx, (lamp && lamp.id) || hoverId, z);
    }

    // While dragging a path chord, aim pads sit on these seats — skip node
    // discs so we don't paint double chords at the same coordinates.
    const dragging = this._mode === 'node';
    if (dragging) return;
    if (atlas === 'lattice') return;

    this.functionNodes.forEach((n) => {
      const col =
        n.role === 'secondary' || n.role === 'dominant'
          ? REGION.secondary
          : n.role === 'secondaryii'
            ? REGION.secondaryii || REGION.secondary
            : n.role === 'tritone'
              ? REGION.tritone
              : n.role === 'diminished'
                ? REGION.diminished || REGION.chromatic
                : n.role === 'valt'
                  ? REGION.valt || REGION.flavour
                  : n.role === 'interchange'
                    ? REGION.interchange
                    : n.role === 'colour'
                      ? REGION.flavour
                      : n.gate
                        ? REGION.gate
                        : REGION.diatonic;
      const isH = !!(hoverId && n.id === hoverId) || !!n.lamp;
      const hoverN = hoverId && this.functionNodes.find((x) => x.id === hoverId);
      const isNeighbor =
        !!(hoverN &&
          hoverN.chord &&
          n.chord &&
          n.id !== hoverN.id &&
          this._sharedPcs(hoverN.chord, n.chord).length >= 2);
      const onPath = fo.showPath !== false && n.onPath;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r + (isH ? 3 : isNeighbor ? 1.5 : onPath ? 1 : 0), 0, Math.PI * 2);
      ctx.fillStyle = isH ? col.fill : 'rgba(12,10,8,0.85)';
      ctx.fill();
      ctx.strokeStyle = onPath && !isH ? '#e8c98a' : isNeighbor && !isH ? '#fff4d6' : col.fill;
      ctx.lineWidth = (isH ? 2.8 : onPath ? 2.4 : isNeighbor ? 2.2 : 1.6) / z;
      if (n.role === 'secondary' || n.role === 'dominant' || n.role === 'secondaryii') {
        ctx.setLineDash([3 / z, 2 / z]);
      } else if (n.role === 'tritone' || n.role === 'valt') {
        ctx.setLineDash([4 / z, 2 / z]);
      } else if (n.role === 'diminished') {
        ctx.setLineDash([2 / z, 3 / z]);
      } else if (n.role === 'colour') ctx.setLineDash([2 / z, 2 / z]);
      else ctx.setLineDash([]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = isH ? '#0a0806' : 'rgba(230,220,200,0.92)';
      ctx.font = `bold ${10 / z}px DM Sans, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const roman = n.roman || '';
      ctx.fillText(roman || n.label || (n.chord && n.chord.name) || '?', n.x, n.y - (isH ? 3 / z : 0));
      if (isH && n.label && roman) {
        ctx.fillStyle = 'rgba(10,8,6,0.75)';
        ctx.font = `${7.5 / z}px DM Sans, sans-serif`;
        ctx.fillText(n.label, n.x, n.y + 9 / z);
      }
    });
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

    const followLook = this.cameraMode === 'follow' && this.mapView !== 'function';
    const g = ctx.createRadialGradient(w * 0.5, h * 0.42, 10, w * 0.5, h * 0.5, Math.max(w, h) * 0.7);
    if (followLook) {
      g.addColorStop(0, '#100c09');
      g.addColorStop(0.45, '#070605');
      g.addColorStop(1, '#010100');
    } else {
      g.addColorStop(0, '#1a1410');
      g.addColorStop(0.5, '#0c0b0a');
      g.addColorStop(1, '#050505');
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(this.camera.zoom, this.camera.zoom);
    if (this.camera.rot) ctx.rotate(this.camera.rot);
    ctx.translate(-this.camera.x, -this.camera.y);
    const worldFillText = ctx.fillText.bind(ctx);
    const lean = this.camera.rot || 0;
    if (lean) {
      ctx.fillText = function (text, x, y) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(-lean);
        worldFillText(text, 0, 0);
        ctx.restore();
      };
    }

    const M = global.HLMusic;
    if (!this.disks || !this.disks.length) this._rebuildDisks(false);

    // Ã¢â€â‚¬Ã¢â€â‚¬ Chase disks (circular harmonic scales) Ã¢â€â‚¬Ã¢â€â‚¬
    // Function view = same-key chart only â€” hide other-key disks (they looked
    // like a second graph lighting up next to the centred Function chart).
    // Draw inactive keys first, then active write-home disk
    const atlasNow = this._atlasMode ? this._atlasMode() : null;
    const disksDraw =
      this.mapView === 'function' && atlasNow !== 'wheel'
        ? []
        : (this.disks || [])
            .filter((d) => this.mapView !== 'function' || d.active)
            .slice()
            .sort((a, b) => (a.active ? 1 : 0) - (b.active ? 1 : 0));
    const focusDisk = followLook
      ? this._followFocusDisk && this._followFocusDisk()
      : null;
    disksDraw.forEach((disk) => {
      const active = !!disk.active;
      const paint =
        followLook && this._focusDiskPaint
          ? this._focusDiskPaint(disk)
          : null;
      const faceA = paint ? Math.max(0.05, paint.face) : active ? 1 : 0.72;
      const seatA = paint ? Math.max(0.04, paint.seats) : faceA;
      const rimA = paint ? Math.max(0.05, paint.rim) : faceA;
      const isFocus = paint ? paint.seats > 0.22 : !followLook || !focusDisk ||
        (this._sameDiskRef && this._sameDiskRef(disk, focusDisk));
      ctx.globalAlpha = faceA;
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
      ctx.globalAlpha = rimA;
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

      // Harmonic-scale seats (Chase) â€” skip active disk in Function view.
      // While dragging: draw seats very dim under aim pads (don't remove them â€”
      // popping seats on/off felt like the map shaking).
      const seats =
        M && M.circularHarmonicScale && !(this.mapView === 'function' && active)
          ? M.circularHarmonicScale(disk.tonic, disk.mode)
          : [];
      const dragDim = this._mode === 'node' && active;
      ctx.globalAlpha = seatA;
      seats.forEach((s) => {
        const rad = s.role === 'tonic' ? dR * SEAT.tonic : dR * SEAT.scale;
        const ang = s.angle + (disk.rot || 0);
        const sx = cx + Math.cos(ang) * rad;
        const sy = cy + Math.sin(ang) * rad * SEAT.squash;
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
          if ((!followLook && active) || (followLook && isFocus)) {
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

      if (!followLook) {
        if (!active) {
          ctx.fillStyle = 'rgba(160,180,210,0.55)';
          ctx.font = `${8 / this.camera.zoom}px Crimson Text, Georgia, serif`;
          ctx.fillText('traveled', cx, cy + dR * 0.95);
        } else {
          ctx.fillStyle = 'rgba(180,168,150,0.4)';
          ctx.font = `${8 / this.camera.zoom}px Crimson Text, Georgia, serif`;
          ctx.fillText('write home', cx, cy + dR * 1.18);
        }
      }

      ctx.globalAlpha = 1;
    });

    // Ã¢â€â‚¬Ã¢â€â‚¬ Ghost adjacent-key halo (Chase only) Ã¢â€â‚¬Ã¢â€â‚¬
    if (!followLook && this.mapView === 'chase' && this.ghostDisks && this.ghostDisks.length) {
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
        ctx.globalAlpha = followLook ? (hot ? 0.28 : 0.1) : hot ? 0.85 : 0.55;
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
              ? 'V7â†’I'
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

    // Function neighbourhood chart (same write-home key â€” not a second disk)
    if (this.mapView === 'function') {
      this._drawFunctionChart(ctx);
    }

    // Bridge: path edges that cross disks get a soft glow (modulation leap)
    // (drawn later with path edges; tag nodes with disk id for style)

    // Active home hover / empty coaching on active disk centre
    const homeHover = this.hover && this.hover.type === 'home';
    const empty = !this.nodes || !this.nodes.length;
    const act = this._activeDisk();
    if (this.mapView !== 'function' && (homeHover || empty)) {
      const pulse = empty ? 1 + 0.1 * Math.sin((this.pulseT || 0) * 2.2) : 1;
      ctx.beginPath();
      ctx.arc(act.cx || 0, act.cy || 0, 22 * pulse, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(232,201,138,0.55)';
      ctx.lineWidth = 2 / this.camera.zoom;
      ctx.stroke();
    }
    if (this.mapView !== 'function' && empty && this._mode !== 'node' && !followLook) {
      ctx.fillStyle = 'rgba(200,184,160,0.8)';
      ctx.font = `${10 / this.camera.zoom}px Crimson Text, Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.fillText(
        'Chase · click HOME or a roman seat · purple rings = leave home · From here list = moves',
        act.cx || 0,
        (act.cy || 0) + (act.R || 100) * 0.95
      );
    }

    // Weighted arrows: hovered path chord â†’ available seats / leave-home
    if (
      this.hoverSuggests &&
      this.hoverSuggests.length &&
      this._mode !== 'node' &&
      this.mapView !== 'function'
    ) {
      const z = this.camera.zoom || 1;
      // Weak arrows first so strong ones paint on top
      const ordered = this.hoverSuggests.slice().sort((a, b) => (a.weight || 0) - (b.weight || 0));
      ordered.forEach((h) => {
        const isH =
          this.hover &&
          this.hover.type === 'hoverSuggest' &&
          this.hover.item === h;
        const wgt = Math.max(0.15, Math.min(1, h.weight != null ? h.weight : 0.5));
        const ax = h.fromX != null ? h.fromX : 0;
        const ay = h.fromY != null ? h.fromY : 0;
        const bx = h.x;
        const by = h.y;
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.hypot(dx, dy) || 1;
        // Stop short of the seat centre so the head sits on the rim
        const inset = Math.min(18, len * 0.22);
        const ex = bx - (dx / len) * inset;
        const ey = by - (dy / len) * inset;
        const sx = ax + (dx / len) * Math.min(12, len * 0.15);
        const sy = ay + (dy / len) * Math.min(12, len * 0.15);

        const alpha = isH ? 0.95 : 0.22 + wgt * 0.7;
        const lw = (isH ? 2.2 + wgt * 3.2 : 0.9 + wgt * 3.6) / z;
        let col =
          h.kind === 'modulate'
            ? '167,139,250'
            : h.kind === 'cadence' || h.kind === 'home'
              ? '157,222,168'
              : '232,201,138';
        if (isH) col = '157,222,168';

        // Soft glow for strong moves
        if (wgt > 0.55 || isH) {
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(ex, ey);
          ctx.strokeStyle = 'rgba(' + col + ',' + (isH ? 0.35 : 0.12 + wgt * 0.2) + ')';
          ctx.lineWidth = lw * 2.4;
          ctx.lineCap = 'round';
          ctx.stroke();
        }

        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.strokeStyle = 'rgba(' + col + ',' + alpha + ')';
        ctx.lineWidth = lw;
        ctx.lineCap = 'round';
        ctx.stroke();

        // Arrow head
        const headLen = (7 + wgt * 7) / z;
        const ang = Math.atan2(dy, dx);
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(
          ex - headLen * Math.cos(ang - 0.4),
          ey - headLen * Math.sin(ang - 0.4)
        );
        ctx.lineTo(
          ex - headLen * Math.cos(ang + 0.4),
          ey - headLen * Math.sin(ang + 0.4)
        );
        ctx.closePath();
        ctx.fillStyle = 'rgba(' + col + ',' + alpha + ')';
        ctx.fill();

        // Tip label only when hovered or strong
        if (isH || wgt >= 0.72) {
          ctx.fillStyle = isH
            ? 'rgba(233,213,255,0.98)'
            : 'rgba(240,230,210,' + (0.45 + wgt * 0.5) + ')';
          ctx.font = `bold ${(isH ? 10 : 8.5) / z}px DM Sans, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          const short =
            (h.label || '?').length > 12
              ? String(h.label).slice(0, 11) + 'â€¦'
              : h.label || '?';
          ctx.fillText(short, bx, by - 14 / z);
        }
      });
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
          return false; // identical to gold â€” no blue ghost
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
        // (same root+quality) â€” only show diffs and true alt seats
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
        // Compare tooltip: gold â†’ blue on hover
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
            ' â†’ ' +
            (n.chord.name || '?') +
            (div ? ' Â· differ' : ' Â· same');
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

    // Path edges: Journey + In-this-key wheel. Not houses (volley) or lattice (triangles).
    if (
      this.mapView !== 'function' ||
      (this._atlasMode && this._atlasMode() === 'wheel')
    )
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
      if (followLook && playing >= 0) {
        if (i < playing - 1) alpha = 0.08;
        else if (i === playing - 1) alpha = 0.55;
        else alpha = 0.06;
      } else if (playing >= 0) {
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
      if (followLook && playing >= 0 && i < playing) {
        const zW = this.camera.zoom || 1;
        const age = playing - i;
        const dust = Math.max(3, 9 - age);
        for (let s = 1; s < dust; s++) {
          const tt = s / dust;
          const px =
            (1 - tt) * (1 - tt) * ax + 2 * (1 - tt) * tt * mx + tt * tt * bx;
          const py =
            (1 - tt) * (1 - tt) * ay + 2 * (1 - tt) * tt * my + tt * tt * by;
          ctx.beginPath();
          ctx.arc(px, py, (1.6 + (1 - tt) * 1.4) / zW, 0, Math.PI * 2);
          ctx.fillStyle =
            'rgba(232,201,138,' + (0.14 / age) * (1 - tt * 0.4) + ')';
          ctx.fill();
        }
      }
      const wakeI = this._wakeFrom;
      const wakeK = this._wakeK ? this._wakeK() : 1;
      const wraps =
        this._isLooping &&
        this._isLooping() &&
        wakeI === (this.nodes.length - 1) &&
        playing === 0;
      const isComet =
        followLook &&
        playing >= 0 &&
        wakeI >= 0 &&
        wakeK < 1 &&
        ((i === wakeI && playing === wakeI + 1) ||
          (wraps && i === this.nodes.length - 1));
      if (isComet) {
        const zW = this.camera.zoom || 1;
        const fade = 1 - wakeK;
        for (let s = 1; s <= 18; s++) {
          const tt = s / 18;
          const px =
            (1 - tt) * (1 - tt) * ax + 2 * (1 - tt) * tt * mx + tt * tt * bx;
          const py =
            (1 - tt) * (1 - tt) * ay + 2 * (1 - tt) * tt * my + tt * tt * by;
          const head = tt * tt;
          ctx.beginPath();
          ctx.arc(px, py, (1.2 + head * 5.5) / zW, 0, Math.PI * 2);
          ctx.fillStyle =
            'rgba(255,228,176,' + (0.06 + head * 0.45) * fade + ')';
          ctx.fill();
        }
      }
      // Playhead bead on the edge into current step
      if (playing >= 1 && i === playing - 1 && !followLook) {
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

    // Aim / reorder: chord stays put; magnet follows the pointer
    if (this._mode === 'node' && this._dragNode) {
      const origin = this._dragOrigin || { x: this._dragNode.x, y: this._dragNode.y };
      const magnet = this._dragPos || origin;
      const i = this._dragNode.i;
      const z = this.camera.zoom;
      const reorderDrag = !!(this._reorderOnly || !this._allowAim);

      if (reorderDrag) {
        ctx.beginPath();
        ctx.moveTo(origin.x, origin.y);
        ctx.lineTo(magnet.x, magnet.y);
        ctx.strokeStyle = 'rgba(232,201,138,0.45)';
        ctx.lineWidth = 1.6 / z;
        ctx.setLineDash([5 / z, 4 / z]);
        ctx.stroke();
        ctx.setLineDash([]);
        const dropI = this._reorderDropI;
        const dropN =
          dropI >= 0 && this.nodes && this.nodes[dropI] ? this.nodes[dropI] : null;
        if (dropN) {
          ctx.beginPath();
          ctx.arc(dropN.x, dropN.y, (dropN.r || 14) + 10, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(126,184,218,0.95)';
          ctx.lineWidth = 2.4 / z;
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(magnet.x, magnet.y, (this._dragNode.r || 14) * 0.92, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(232,201,138,0.28)';
        ctx.fill();
        ctx.strokeStyle = '#e8c98a';
        ctx.lineWidth = 1.8 / z;
        ctx.stroke();
        ctx.fillStyle = 'rgba(232,201,138,0.95)';
        ctx.font = `bold ${11 / z}px DM Sans, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const nm =
          (this._dragNode.chord && this._dragNode.chord.name) || 'step';
        ctx.fillText(nm, magnet.x, magnet.y);
        ctx.font = `${10 / z}px DM Sans, sans-serif`;
        ctx.fillStyle = 'rgba(232,201,138,0.8)';
        ctx.fillText(
          dropN
            ? 'Release → position ' + (dropI + 1)
            : 'Drop on another step to reorder · miss cancels',
          magnet.x,
          magnet.y - (this._dragNode.r || 14) - 16 / z
        );
      } else {

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

      // Aim targets: good joins (green) > ok (gold) > weak (dim) â€” scored from prev/next
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
          ctx.fillText('â˜…', a.x, a.y - padR - 6 / z);
        }
      });

      // Preview path: prev â†’ aimed target â†’ next (where the progression will go)
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

      // Aim line + magnet (this is your aim point â€” not a free-floating chord)
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
        ? 'Release â†’ ' + this.snapAlt.label + (this.snapAlt.role ? ' Â· ' + this.snapAlt.role : '')
        : 'Drag onto a seat Â· release free = cancel Â· quality in inspector';
      ctx.fillText(hud, magnet.x, magnet.y - 18 / z);
      }
    }

    // Primary path nodes — solid, numbered, heavier than hollow options
    // Lattice: triangles carry the path; discs would cover the Tonnetz.
    this.nodes.forEach((n) => {
      if (this._atlasMode && this._atlasMode() === 'lattice') return;
      const vis = n.visitIndices || [n.i];
      const groupCur = vis.indexOf(this.current) >= 0;
      const groupPlay = vis.indexOf(this.playing) >= 0;
      const isCur = n.i === this.current;
      const isPlay = n.i === this.playing;
      const aiming =
        this._mode === 'node' &&
        this._dragNode &&
        vis.indexOf(this._dragNode.i) >= 0;
      if (n.drawBody === false) {
        if (isCur && this._mode !== 'node' && this._pathDeleteWorld) {
          const b = this._pathDeleteWorld(n);
          if (b) {
            const zDel = this.camera.zoom || 1;
            const hovered =
              this.hover &&
              this.hover.type === 'pathDelete' &&
              this.hover.item === n;
            ctx.beginPath();
            ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
            ctx.fillStyle = hovered ? 'rgba(224,122,106,0.95)' : 'rgba(20,14,12,0.9)';
            ctx.fill();
            ctx.strokeStyle = hovered ? '#fff4d6' : 'rgba(224,122,106,0.95)';
            ctx.lineWidth = 1.3 / zDel;
            ctx.stroke();
            ctx.fillStyle = hovered ? '#1a1410' : '#e07a6a';
            ctx.font = `bold ${12 / zDel}px DM Sans, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('×', b.x, b.y + 0.5 / zDel);
          }
        }
        return;
      }
      const reg = n.chord.region || 'diatonic';
      const col = REGION[reg] || REGION.diatonic;
      const div =
        vis.some((vi) => this.divergent.indexOf(vi) >= 0) &&
        this.showAlt &&
        this.altNodes.length;
      const x = n.x;
      const y = n.y;
      const playI = this.playing;
      const wakeI = this._wakeFrom;
      const wakeK = this._wakeK ? this._wakeK() : 1;
      const isWake =
        followLook &&
        wakeI >= 0 &&
        wakeK < 1 &&
        vis.indexOf(wakeI) >= 0 &&
        !groupPlay;
      if (isWake) {
        const zW = this.camera.zoom || 1;
        const r0 = n.r * 1.04;
        const r1 = 2.8 / zW;
        const rr = r0 + (r1 - r0) * wakeK;
        ctx.globalAlpha = 0.82 * (1 - wakeK * 0.78);
        ctx.beginPath();
        ctx.arc(x, y, rr, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(232,201,138,0.95)';
        ctx.fill();
        ctx.globalAlpha = 1;
        return;
      }
      if (followLook && playI >= 0 && vis[vis.length - 1] < playI && !groupPlay) {
        const age = playI - vis[vis.length - 1];
        const zW = this.camera.zoom || 1;
        ctx.globalAlpha = Math.max(0.04, 0.2 / age);
        ctx.beginPath();
        ctx.arc(x, y, (2.4 + 1.2 / age) / zW, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(232,201,138,0.9)';
        ctx.fill();
        ctx.globalAlpha = 1;
        return;
      }
      const pulse = groupPlay
        ? 1 + 0.018 * Math.sin((this.pulseT || 0) * 0.32)
        : 1;
      const r = n.r * (groupPlay || groupCur || aiming ? 1.06 : 1) * pulse;
      // Dim past steps while playing (journey)
      let nodeAlpha = 1;
      if (playI >= 0 && vis[vis.length - 1] < playI) nodeAlpha = 0.4;
      else if (playI >= 0 && vis[0] > playI) nodeAlpha = 0.55;
      if (followLook && !groupPlay && !groupCur) nodeAlpha *= 0.45;
      ctx.globalAlpha = nodeAlpha;

      // Playhead / selection ring (any visit in a shared node)
      if (groupPlay || groupCur) {
        if (followLook && groupPlay) {
          const halo = ctx.createRadialGradient(
            x,
            y,
            r,
            x,
            y,
            r + 18 / this.camera.zoom
          );
          halo.addColorStop(0, 'rgba(255,230,180,0.16)');
          halo.addColorStop(1, 'rgba(255,200,120,0)');
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(x, y, r + 18 / this.camera.zoom, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(x, y, r + 8 / this.camera.zoom, 0, Math.PI * 2);
        ctx.strokeStyle = groupPlay ? 'rgba(255,244,214,0.85)' : 'rgba(232,201,138,0.55)';
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
        if (groupCur || groupPlay) {
          ctx.strokeStyle = '#fff4d6';
          ctx.lineWidth = 2.5 / this.camera.zoom;
          ctx.stroke();
        }
      }

      // Step number badge — stack revisits / pivot visits (4 · 8), never last-wins
      if (followLook) {
        if (groupPlay) {
          ctx.fillStyle = '#0a0a0a';
          ctx.font = `bold ${Math.max(9, 12 / this.camera.zoom)}px DM Sans, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(n.chord.name, x, y);
        }
        ctx.globalAlpha = 1;
        return;
      }
      const visitNums = n.visits && n.visits.length ? n.visits : [n.i + 1];
      const badge = visitNums.join(' · ');
      const zB = this.camera.zoom || 1;
      ctx.font = `bold ${10 / zB}px DM Sans, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const bx = x - r * 0.75;
      const by = y - r * 0.75;
      if (visitNums.length === 1) {
        ctx.beginPath();
        ctx.arc(bx, by, 9 / zB, 0, Math.PI * 2);
        ctx.fillStyle = groupPlay ? '#fff4d6' : 'rgba(20,16,12,0.85)';
        ctx.fill();
        ctx.fillStyle = groupPlay ? '#1a1410' : '#e8c98a';
        ctx.fillText(badge, bx, by);
      } else {
        const tw = ctx.measureText(badge).width;
        const pad = 5 / zB;
        const bh = 14 / zB;
        const bw = tw + pad * 2;
        const rx = bx - bw / 2;
        const ry = by - bh / 2;
        const rr = 7 / zB;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(rx, ry, bw, bh, rr);
        else ctx.rect(rx, ry, bw, bh);
        ctx.fillStyle = groupPlay ? '#fff4d6' : 'rgba(20,16,12,0.9)';
        ctx.fill();
        ctx.strokeStyle = groupPlay ? 'rgba(26,20,16,0.35)' : 'rgba(232,201,138,0.55)';
        ctx.lineWidth = 1 / zB;
        ctx.stroke();
        ctx.fillStyle = groupPlay ? '#1a1410' : '#e8c98a';
        ctx.fillText(badge, bx, by);
      }

      // Other-key pip (owned by a different disk than write home)
      if (n.foreignKey) {
        const px = x + r * 0.78;
        const py = y - r * 0.78;
        ctx.beginPath();
        ctx.arc(px, py, 5 / this.camera.zoom, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(126,184,218,0.95)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(20,16,12,0.75)';
        ctx.lineWidth = 1 / this.camera.zoom;
        ctx.stroke();
      }

      // Delete badge on the selected step (not while dragging)
      if (isCur && this._mode !== 'node' && this._pathDeleteWorld) {
        const b = this._pathDeleteWorld(n);
        if (b) {
          const zDel = this.camera.zoom || 1;
          const hovered =
            this.hover &&
            this.hover.type === 'pathDelete' &&
            this.hover.item === n;
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
          ctx.fillStyle = hovered ? 'rgba(224,122,106,0.95)' : 'rgba(20,14,12,0.9)';
          ctx.fill();
          ctx.strokeStyle = hovered ? '#fff4d6' : 'rgba(224,122,106,0.95)';
          ctx.lineWidth = 1.3 / zDel;
          ctx.stroke();
          ctx.fillStyle = hovered ? '#1a1410' : '#e07a6a';
          ctx.font = `bold ${12 / zDel}px DM Sans, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('×', b.x, b.y + 0.5 / zDel);
        }
      }

      ctx.fillStyle = aiming ? 'rgba(232,201,138,0.9)' : '#0a0a0a';
      ctx.font = `bold ${Math.max(9, 11 / this.camera.zoom)}px DM Sans, sans-serif`;
      ctx.textBaseline = 'middle';
      const nameSrc =
        groupCur && this.nodes[this.current] && this.nodes[this.current].chord
          ? this.nodes[this.current]
          : n;
      ctx.fillText((nameSrc.chord && nameSrc.chord.name) || n.chord.name, x, y);

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

    if (followLook) this._drawFollowAtmosphere(ctx);
    if (followLook) this._drawFocusOptions(ctx);

    if (lean) ctx.fillText = worldFillText;
    ctx.restore();

    if (followLook) {
      const vg = ctx.createRadialGradient(
        w * 0.5,
        h * 0.48,
        Math.min(w, h) * 0.16,
        w * 0.5,
        h * 0.5,
        Math.max(w, h) * 0.64
      );
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(0.48, 'rgba(0,0,0,0.28)');
      vg.addColorStop(0.76, 'rgba(0,0,0,0.62)');
      vg.addColorStop(1, 'rgba(0,0,0,0.88)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);
      const smokeT = this.pulseT || 0;
      ctx.globalAlpha = 0.045;
      for (let s = 0; s < 3; s++) {
        const sx = w * (0.35 + 0.18 * s) + Math.sin(smokeT * 0.07 + s) * 28;
        const sy = h * (0.4 + 0.12 * s) + Math.cos(smokeT * 0.05 + s * 1.3) * 22;
        const sr = Math.min(w, h) * (0.22 + s * 0.08);
        const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
        sg.addColorStop(0, 'rgba(180,150,110,0.55)');
        sg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.ellipse(sx, sy, sr, sr * 0.62, s * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 0.035;
      ctx.fillStyle = '#d8c4a0';
      const seed = Math.floor(smokeT * 0.15);
      for (let d = 0; d < 40; d++) {
        const px = ((d * 97 + seed * 13) % 1000) / 1000 * w;
        const py = ((d * 53 + seed * 7) % 1000) / 1000 * h;
        ctx.fillRect(px, py, 1.1, 1.1);
      }
      ctx.globalAlpha = 1;
      this._drawFocusFogName(ctx, w, h);
      return;
    }

    // Legend + tip (screen space)
    ctx.fillStyle = 'rgba(180,168,150,0.55)';
    ctx.font = '11px Crimson Text, Georgia, serif';
    ctx.textAlign = 'left';
    const browse = this._isBrowse ? this._isBrowse() : true;
    const writeHint = browse ? ' · double-click to add · or switch to Write' : ' · click to add';
    let tip =
      this._mode === 'node'
        ? this._reorderOnly || !this._allowAim
          ? this._reorderDropI >= 0
            ? 'Release to reorder · nothing new is added'
            : 'Drop on another step to reorder · miss cancels · nothing added'
          : this.snapAlt
            ? 'Release to set · audition: prev → ' + this.snapAlt.label + ' → next'
            : 'Drag onto a seat to change · release here cancels'
        : this.hover && this.hover.type === 'pathDelete'
          ? 'Delete this step · Backspace / Delete also works'
        : this.hover && this.hover.type === 'edge'
          ? browse
            ? 'Select a nearby step · switch to Write to insert on the edge'
            : 'Click edge → insert a step between · then drag it onto a chord seat'
        : this.hover && this.hover.type === 'home'
          ? 'HOME = write-key tonic' + writeHint
          : this.hover && this.hover.type === 'diskHome'
            ? 'Previous key disk — click centre to make it write home again (path keeps ownership)'
            : this.hover && this.hover.type === 'functionNode'
              ? 'In this key · ' +
                ((this.hover.item && this.hover.item.job) ||
                  (this.hover.item && this.hover.item.label) ||
                  '') +
                writeHint
              : this.hover && this.hover.type === 'horizon'
                ? 'Option on/near the scale' + writeHint
                : this.hover && this.hover.type === 'altNode'
                    ? 'Blue compare path — names show where versions differ'
                    : this.hover && this.hover.type === 'seat'
                      ? (browse ? 'Preview ' : 'Add ') +
                        (this.hover.item.roman || '') +
                        writeHint
                      : this.hover && this.hover.type === 'ghostOption'
                        ? 'Nearby key · ' +
                          ((this.hover.item && this.hover.item.label) || '') +
                          writeHint
                        : this.hover && this.hover.type === 'ghostDisk'
                          ? 'Nearby key · double-click a pad to leave home · Write mode = click'
                          : this.hover && this.hover.type === 'hoverSuggest'
                            ? 'Next move · ' +
                              ((this.hover.item && this.hover.item.label) || '') +
                              writeHint
                          : this.mapView === 'function'
                            ? (this.functionAtlas === 'houses'
                                ? 'Houses · bins only'
                                : this.functionAtlas === 'lattice'
                                  ? 'Lattice · Write click a triangle · P/L/R = one-note moves'
                                  : 'Wheel · Write click a seat · same clock as Journey')
                            : this.nodes && this.nodes.length
                              ? 'Select = preview / drag reorder · × deletes · Write or double-click adds'
                              : 'Write or double-click HOME / a roman seat to start';
    ctx.fillText(tip, 10, h - 12);

    // Map reading legend (top-left)
    ctx.font = '9px DM Sans, sans-serif';
    ctx.fillStyle = 'rgba(180,168,150,0.5)';
    ctx.fillText(
      this.mapView === 'function'
        ? (this.functionAtlas === 'houses'
            ? 'Houses · bins only'
            : this.functionAtlas === 'lattice'
              ? 'Lattice · Tonnetz · vertices are notes'
              : 'Wheel · In this key · click a roman seat')
        : 'Journey · two cogs + path · hover / aim shows nearby keys · I / V7→I plant home',
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

})(typeof window !== "undefined" ? window : globalThis);