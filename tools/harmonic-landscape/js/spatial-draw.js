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

    // Edges under nodes â€” dim all, brighten paths from/to hovered chord
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
      if (e.kind === 'resolve' || e.kind === 'chain' || e.kind === 'iiv') {
        ctx.strokeStyle = lit
          ? 'rgba(126,184,218,' +
            (dim
              ? '0.08'
              : hoverId
                ? '0.95'
                : e.kind === 'chain'
                  ? '0.45'
                  : e.kind === 'iiv'
                    ? '0.5'
                    : '0.55') +
            ')'
          : 'rgba(126,184,218,0.55)';
        ctx.lineWidth = (lit && hoverId ? 2.8 : e.kind === 'chain' ? 1.5 : 1.8) / z;
        ctx.setLineDash(
          e.kind === 'chain' ? [8 / z, 3 / z] : e.kind === 'iiv' ? [4 / z, 3 / z] : [5 / z, 4 / z]
        );
      } else if (e.kind === 'tritone') {
        ctx.strokeStyle = lit
          ? 'rgba(232,93,76,' + (dim ? '0.08' : hoverId ? '0.95' : '0.55') + ')'
          : 'rgba(232,93,76,0.5)';
        ctx.lineWidth = (lit && hoverId ? 2.6 : 1.6) / z;
        ctx.setLineDash([4 / z, 3 / z]);
      } else if (e.kind === 'dim') {
        ctx.strokeStyle = lit
          ? 'rgba(176,122,212,' + (dim ? '0.08' : hoverId ? '0.9' : '0.45') + ')'
          : 'rgba(176,122,212,0.4)';
        ctx.lineWidth = (lit && hoverId ? 2.4 : 1.4) / z;
        ctx.setLineDash([2 / z, 3 / z]);
      } else if (e.kind === 'valt') {
        ctx.strokeStyle = lit
          ? 'rgba(224,160,96,' + (dim ? '0.08' : hoverId ? '0.9' : '0.45') + ')'
          : 'rgba(224,160,96,0.4)';
        ctx.lineWidth = (lit && hoverId ? 2.4 : 1.4) / z;
        ctx.setLineDash([3 / z, 3 / z]);
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
      } else if (e.kind === 'colour') {
        // Gold dashed: diatonic seat → colour variant (sus, II, 7ths)
        ctx.strokeStyle = lit
          ? 'rgba(240,160,112,' + (dim ? '0.08' : hoverId ? '0.9' : '0.4') + ')'
          : 'rgba(240,160,112,0.4)';
        ctx.lineWidth = (lit && hoverId ? 2 : 1.15) / z;
        ctx.setLineDash([2 / z, 3 / z]);
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
      if (dim || e.kind === 'skeleton' || e.kind === 'colour') return;
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
        e.kind === 'resolve' || e.kind === 'chain' || e.kind === 'iiv'
          ? 'rgba(126,184,218,' + (hoverId ? '0.95' : '0.7') + ')'
          : e.kind === 'tritone'
            ? 'rgba(232,93,76,' + (hoverId ? '0.95' : '0.7') + ')'
            : e.kind === 'dim'
              ? 'rgba(176,122,212,' + (hoverId ? '0.9' : '0.65') + ')'
              : e.kind === 'valt'
                ? 'rgba(224,160,96,' + (hoverId ? '0.9' : '0.65') + ')'
                : 'rgba(196,160,224,' + (hoverId ? '0.9' : '0.4') + ')';
      ctx.fill();
    });

    // While dragging a path chord, aim pads sit on these seats â€” skip node
    // discs so we don't paint double chords at the same coordinates.
    const dragging = this._mode === 'node';
    if (dragging) return;

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

    // Ã¢â€â‚¬Ã¢â€â‚¬ Chase disks (circular harmonic scales) Ã¢â€â‚¬Ã¢â€â‚¬
    // Function view = same-key chart only â€” hide other-key disks (they looked
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

      // Harmonic-scale seats (Chase) â€” skip active disk in Function view.
      // While dragging: draw seats very dim under aim pads (don't remove them â€”
      // popping seats on/off felt like the map shaking).
      const seats =
        M && M.circularHarmonicScale && !(this.mapView === 'function' && active)
          ? M.circularHarmonicScale(disk.tonic, disk.mode)
          : [];
      const dragDim = this._mode === 'node' && active;
      seats.forEach((s) => {
        const rad = s.role === 'tonic' ? dR * SEAT.tonic : dR * SEAT.scale;
        const sx = cx + Math.cos(s.angle) * rad;
        const sy = cy + Math.sin(s.angle) * rad * SEAT.squash;
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

    // Ã¢â€â‚¬Ã¢â€â‚¬ Ghost adjacent-key halo (Chase only) Ã¢â€â‚¬Ã¢â€â‚¬
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
          ? 'Function Â· same-key atlas Â· click chords Â· leave home â†’ Journey'
          : 'Chase Â· click HOME or a roman seat Â· purple rings = leave home Â· From here list = moves',
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

    // Primary path edges â€” journey trail (dim past, bright current during play)
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

    // Primary path nodes â€” solid, numbered, heavier than hollow options
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
          ? 'Release to set Â· audition: prev â†’ ' + this.snapAlt.label + ' â†’ next'
          : 'Drag onto a seat to change Â· release here keeps this bridge chord'
        : this.hover && this.hover.type === 'edge'
          ? 'Click edge â†’ insert a step between Â· then drag it onto a chord seat'
        : this.hover && this.hover.type === 'home'
          ? 'HOME = write-key tonic (Chase disk centre) â€” click to start/land'
          : this.hover && this.hover.type === 'diskHome'
            ? 'Previous key disk â€” click centre to make it write home again (path keeps ownership)'
            : this.hover && this.hover.type === 'functionNode'
              ? 'Function chart Â· click to write ' +
                ((this.hover.item && this.hover.item.label) || '') +
                ' Â· same key neighbourhood'
              : this.hover && this.hover.type === 'horizon'
                ? 'Option on/near harmonic scale Â· green ghost = join Â· click to write'
                : this.hover && this.hover.type === 'edge'
                  ? 'Click green + on the curve to insert a bridge chord (keeps total length)'
                  : this.hover && this.hover.type === 'altNode'
                    ? 'Blue compare path â€” names show where versions differ'
                    : this.hover && this.hover.type === 'seat'
                      ? 'Click seat to add ' +
                        (this.hover.item.roman || '') +
                        (this.hover.item.activeDisk
                          ? ' Â· drag a path chord onto a seat to move it'
                          : ' on other disk Â· switches write home')
                      : this.hover && this.hover.type === 'ghostOption'
                        ? 'Establish home in ' +
                          ((this.hover.item &&
                            this.hover.item.ghostDisk &&
                            this.hover.item.label) ||
                            'nearby key') +
                          ' Â· click to land'
                        : this.hover && this.hover.type === 'ghostDisk'
                          ? 'Nearby key Â· click a pad (I or V7â†’I) to establish home'
                          : this.mapView === 'function'
                            ? 'Function Â· same-key atlas Â· blue V7 Â· purple borrow Â· Land/mod â†’ Chase'
                            : this.nodes && this.nodes.length
                              ? 'Chase Â· seats = in-key Â· purple ghosts = adjacent keys Â· establish home to travel'
                              : 'Click HOME or a roman seat (IV, V, viâ€¦) to start';
    ctx.fillText(tip, 10, h - 12);

    // Map reading legend (top-left)
    ctx.font = '9px DM Sans, sans-serif';
    ctx.fillStyle = 'rgba(180,168,150,0.5)';
    ctx.fillText(
      this.mapView === 'function'
        ? 'In this key Â· gold diatonic Â· orange colours (sus/II) Â· blue V7 Â· purple borrow'
        : 'Chase Â· solid = traveled keys Â· purple ghosts = nearby keys from pivot Â· I / V7â†’I plant home',
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