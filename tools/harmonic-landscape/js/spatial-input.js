/**
 * spatial-input.js - SpatialMap prototype extensions (load after spatial.js).
 * Pure extract; no intentional behavior change.
 */
(function (global) {
  "use strict";
  var HS = global.HLSpatial;
  if (!HS || !HS.SpatialMap) throw new Error("Load spatial.js before spatial-input.js");
  var SpatialMap = HS.SpatialMap;
  var REGION = HS.REGION;
  var SEAT = HS.SEAT;

  SpatialMap.prototype._appState = function () {
    return typeof global.HLApp !== 'undefined' && global.HLApp.state
      ? global.HLApp.state
      : null;
  };

  SpatialMap.prototype._gestureMode = function () {
    const st = this._appState();
    return (st && st.mapGestureMode) || 'select';
  };

  /** Select / Aim / Reorder — click never writes. Only Write mode writes on click. */
  SpatialMap.prototype._isBrowse = function () {
    return this._gestureMode() !== 'write';
  };

  SpatialMap.prototype._nearestPathNode = function (w, maxD) {
    if (!this.nodes || !this.nodes.length || !w) return null;
    let best = null;
    let bestD = Infinity;
    const cap = maxD != null ? maxD : 28;
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      if (!n) continue;
      const d = Math.hypot(w.x - n.x, w.y - n.y);
      const grabR = Math.max(cap, (n.r || 14) + 12);
      if (d > grabR) continue;
      const curWin = best && best.i === this.current;
      const thisCur = n.i === this.current;
      const later = !best || n.i > best.i;
      if (
        !best ||
        d < bestD - 0.5 ||
        (Math.abs(d - bestD) < 0.5 && (thisCur || (!curWin && later)))
      ) {
        bestD = d;
        best = n;
      }
    }
    return best;
  };

  /** World-space × badge on the selected path node. */
  SpatialMap.prototype._pathDeleteWorld = function (n) {
    if (!n) return null;
    const r = n.r || 14;
    return { x: n.x + r + 9, y: n.y - r - 9, r: 11 };
  };

  SpatialMap.prototype.beginAimAtIndex = function (index, opts) {
    opts = opts || {};
    if (index == null || index < 0) return false;
    // Layout may be stale if path just changed â€” ensure node exists
    if (!this.nodes || !this.nodes[index]) {
      if (this.path && this.path.length) this._layoutPath();
    }
    if (!this.nodes || !this.nodes[index]) return false;
    const item = this.nodes[index];
    if (this.ensureGhostHalo) this.ensureGhostHalo({ pivotIndex: index, force: true });
    this._mode = 'node';
    this._aimFromStrip = !!opts.fromStrip;
    this._aimArmed = !!opts.armed;
    this._freezeCamera = true;
    this.camera.tx = this.camera.x;
    this.camera.ty = this.camera.y;
    this.camera.tz = this.camera.zoom;
    this._dragNode = item;
    this._dragOrigin = { x: item.x, y: item.y };
    this._dragPos = { x: item.x, y: item.y };
    this._snapSticky = null;
    this._moved = !!opts.armed;
    this.snapAlt = null;
    this._aimPreview = null;
    this.current = index;
    this.alts = [];
    if (opts.clientX != null && opts.clientY != null) {
      this._ptrDown = { x: opts.clientX, y: opts.clientY };
      // Place magnet under pointer immediately for strip drags
      const fake = { clientX: opts.clientX, clientY: opts.clientY };
      const pt = this._eventCanvasXY(fake);
      const w = this.screenToWorld(pt.sx, pt.sy);
      this._dragPos = { x: w.x, y: w.y };
    }
    if (this._aimArmed) {
      let alts = [];
      if (this.onRequestAlts) {
        alts = this.onRequestAlts(index, item.chord) || [];
      }
      this._layoutAlts(index, alts);
      // Stripâ†’map: allow pads closer to origin (stacked steps need nearby seats)
      if (this._aimFromStrip || opts.fromEdge) {
        const ox = this._dragOrigin.x;
        const oy = this._dragOrigin.y;
        this.alts = (this.alts || []).filter((a) => {
          if (!a) return false;
          const d0 = Math.hypot((a.x || 0) - ox, (a.y || 0) - oy);
          return d0 >= 18; // only drop true self-stack
        });
      } else {
        this._filterNearOriginAlts();
      }
    }
    this.canvas.style.cursor = this._aimArmed ? 'crosshair' : 'grabbing';
    return true;
  };

  /** End external (document-level) aim listeners if any */

  SpatialMap.prototype.endExternalAimListeners = function () {
    if (this._extAimMove) {
      document.removeEventListener('pointermove', this._extAimMove, true);
      this._extAimMove = null;
    }
    if (this._extAimUp) {
      document.removeEventListener('pointerup', this._extAimUp, true);
      document.removeEventListener('pointercancel', this._extAimUp, true);
      this._extAimUp = null;
    }
  };

  /**
   * Drop aim pads that sit on / next to the chord being dragged.
   * Same-root colour shells (add9, maj7â€¦) used to live here and stole tiny moves.
   */

  SpatialMap.prototype._filterNearOriginAlts = function () {
    const ox = this._dragOrigin ? this._dragOrigin.x : this._dragNode && this._dragNode.x;
    const oy = this._dragOrigin ? this._dragOrigin.y : this._dragNode && this._dragNode.y;
    if (ox == null || oy == null) return;
    const MIN_AWAY = 55;
    const originCh = this._dragNode && this._dragNode.chord;
    this.alts = (this.alts || []).filter((a) => {
      if (!a) return false;
      const d0 = Math.hypot((a.x || 0) - ox, (a.y || 0) - oy);
      if (d0 < MIN_AWAY) return false;
      // Never aim to same-root colour variants (inspector owns quality)
      if (
        originCh &&
        a.chord &&
        a.chord.root === originCh.root &&
        !a.establish
      ) {
        const M = global.HLMusic;
        if (M && M.qualityFamily) {
          if (M.qualityFamily(a.chord.quality) === M.qualityFamily(originCh.quality)) {
            return false;
          }
        } else if (a.chord.quality === originCh.quality) {
          return false;
        }
      }
      return true;
    });
  };

  /**
   * Retired permanent next-move dots. From here list + hoverSuggests own suggestions.
   */

  SpatialMap.prototype._eventCanvasXY = function (e) {
    const rect = this.canvas.getBoundingClientRect();
    const cssW = Math.max(1, rect.width);
    const cssH = Math.max(1, rect.height);
    const lw = Math.max(1, this.w || cssW);
    const lh = Math.max(1, this.h || cssH);
    return {
      sx: ((e.clientX - rect.left) / cssW) * lw,
      sy: ((e.clientY - rect.top) / cssH) * lh,
      rect: rect,
      cssW: cssW,
      cssH: cssH,
    };
  };

  SpatialMap.prototype.screenToWorld = function (sx, sy) {
    const z = this.camera.zoom || 1;
    const lw = Math.max(1, this.w || 1);
    const lh = Math.max(1, this.h || 1);
    const dx = (sx - lw / 2) / z;
    const dy = (sy - lh / 2) / z;
    const rot = this.camera.rot || 0;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    return {
      x: dx * c + dy * s + (this.camera.x || 0),
      y: -dx * s + dy * c + (this.camera.y || 0),
    };
  };

  /**
   * Control point for path edges â€” MUST match drawing (_draw path edges).
   * Hit-testing used a straight line while paint used a curve â†’ clicks missed
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
      // Mid-segment only â€” endpoints belong to path nodes (strict: avoid G7 drag â†’ insert)
      if (t < 0.32 || t > 0.68) continue;
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
    // Tighter than path-node grab so edges lose near chords
    const thresh = opts.thresh != null ? opts.thresh : 9 / this.camera.zoom;
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

    // Path nodes â€” usually win so you can grab/drag steps.
    // Exception: when a path step sits ON a Chase seat OR a Function chart node,
    // that target must stay clickable to APPEND another copy (Em Em repeats).
    // Old bias -30 made "click Em again" always re-select the first Em.
    let nearPath = false;
    let bestPath = null;
    let bestPathD = Infinity;
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      const d = Math.hypot(w.x - n.x, w.y - n.y);
      const grabR = Math.max(28, (n.r || 14) + 12);
      if (d <= grabR) {
        nearPath = true;
        const curWin = bestPath && bestPath.i === this.current;
        const thisCur = n.i === this.current;
        const later = !bestPath || n.i > bestPath.i;
        if (
          !bestPath ||
          d < bestPathD - 0.5 ||
          (Math.abs(d - bestPathD) < 0.5 && (thisCur || (!curWin && later)))
        ) {
          bestPath = n;
          bestPathD = d;
        }
      }
    }
    // Lattice: triangles write / preview. Path discs are hidden and would
    // steal clicks (stacked visits on Em jumped the timeline).
    if (bestPath && !(this._atlasMode && this._atlasMode() === 'lattice')) {
      add({ type: 'path', item: bestPath }, bestPathD, -30);
    }

    // × on the selected step — highest priority so delete is always reachable
    if (
      this._mode !== 'node' &&
      this.current >= 0 &&
      this.nodes &&
      this.nodes[this.current]
    ) {
      const del = this._pathDeleteWorld(this.nodes[this.current]);
      if (del) {
        const dd = Math.hypot(w.x - del.x, w.y - del.y);
        if (dd <= del.r + 3) {
          add({ type: 'pathDelete', item: this.nodes[this.current] }, dd, -50);
        }
      }
    }

    // Path edges (curve mid-span only) â€” never win near a path node
    if (!nearPath) {
      const edge = this._hitEdge(sx, sy, { world: w });
      if (edge) {
        add(
          { type: 'edge', afterIndex: edge.afterIndex, x: edge.x, y: edge.y, d: edge.d },
          edge.d,
          4
        );
      }
    }

    // Function neighbourhood nodes (click = append like seats)
    // Bias 0 so they beat path nodes sitting on the same degree (Em Em repeats)
    if (this.mapView === 'function' && this.functionNodes && this.functionNodes.length) {
      for (let i = 0; i < this.functionNodes.length; i++) {
        const fn = this.functionNodes[i];
        const d = Math.hypot(w.x - fn.x, w.y - fn.y);
        if (d <= (fn.r || 12) + 8) {
          const kindFromRole = function (role) {
            if (role === 'secondary' || role === 'dominant') return 'secondary';
            if (role === 'secondaryii') return 'secondaryii';
            if (role === 'tritone') return 'tritone';
            if (role === 'diminished') return 'diminished';
            if (role === 'valt') return 'valt';
            if (role === 'interchange') return 'interchange';
            if (role === 'colour') return 'flavour';
            if (role === 'gate' || fn.gate) return 'gate';
            return 'direction';
          };
          const item = {
            chord: fn.chord,
            kind: kindFromRole(fn.role),
            label: fn.label,
            job:
              fn.role === 'colour'
                ? (fn.roman || '') + (fn.colourTag ? ' · ' + fn.colourTag : ' colour')
                : fn.role === 'secondaryii'
                  ? (fn.roman || 'ii/x') + ' · secondary ii–V'
                  : fn.role === 'tritone'
                    ? (fn.roman || '♭II7') + ' · tritone sub'
                    : fn.role === 'diminished'
                      ? (fn.roman || '°') + ' · dim strand'
                      : fn.role === 'valt'
                        ? (fn.roman || 'V alt') + ' · V alternative'
                        : fn.roman || fn.role,
            role: fn.role,
            house: fn.house,
            functionNodeId: fn.id,
          };
          if (fn.house) {
            const houseLab =
              fn.house === 'pull' ? 'Pull' : fn.house === 'colour' ? 'Colour' : 'Home';
            item.job = houseLab + ' · ' + (item.job || fn.roman || '');
          }
          // Build multi-step packages where resolve chain is known
          if (
            (fn.role === 'secondary' || fn.role === 'dominant') &&
            fn.resolvesToId
          ) {
            const target = this.functionNodes.find((x) => x.id === fn.resolvesToId);
            if (target && target.chord) {
              item.route = [fn.chord, target.chord];
              item.label = fn.label + ' → ' + (target.label || target.chord.name);
            }
          } else if (fn.role === 'secondaryii' && fn.resolvesToId) {
            // ii → V7 → target
            const v7n = this.functionNodes.find((x) => x.id === fn.resolvesToId);
            const tgtId = fn.routeTargetId || (v7n && v7n.resolvesToId);
            const tgt = tgtId
              ? this.functionNodes.find((x) => x.id === tgtId)
              : null;
            if (v7n && v7n.chord && tgt && tgt.chord) {
              item.route = [fn.chord, v7n.chord, tgt.chord];
              item.label =
                fn.label +
                ' → ' +
                (v7n.label || v7n.chord.name) +
                ' → ' +
                (tgt.label || tgt.chord.name);
            } else if (v7n && v7n.chord) {
              item.route = [fn.chord, v7n.chord];
              item.label = fn.label + ' → ' + (v7n.label || v7n.chord.name);
            }
          } else if (
            (fn.role === 'tritone' ||
              fn.role === 'diminished' ||
              fn.role === 'valt') &&
            fn.resolvesToId
          ) {
            const target = this.functionNodes.find((x) => x.id === fn.resolvesToId);
            if (target && target.chord) {
              item.route = [fn.chord, target.chord];
              item.label = fn.label + ' → ' + (target.label || target.chord.name);
            }
          }
          add({ type: 'functionNode', item: item }, d, 0);
        }
      }
    }

    // Chase scale seats â€” always hittable (including Function view as fallback
    // when chart nodes are sparse). Generous radius so clicks land.
    if (this.scaleSeats && this.scaleSeats.length) {
      for (let i = 0; i < this.scaleSeats.length; i++) {
        const s = this.scaleSeats[i];
        // In Function view, prefer function nodes (bias 0) over seats (bias 1.5)
        if (this.mapView === 'function' && !s.activeDisk) continue;
        const d = Math.hypot(w.x - s.x, w.y - s.y);
        const rr = (s.r || 16) + (s.activeDisk ? 14 : 8);
        const bias = this.mapView === 'function' ? 1.5 : s.activeDisk ? 0 : 3.5;
        if (d <= rr) add({ type: 'seat', item: s }, d, bias);
      }
    }

    // Weighted next-move arrows â€” tip only, never steal from path nodes
    // (shaft hits made "drag G7" fire a leave-home insert instead)
    if (
      this.hoverSuggests &&
      this.hoverSuggests.length &&
      this._mode !== 'node' &&
      !nearPath
    ) {
      for (let i = 0; i < this.hoverSuggests.length; i++) {
        const h = this.hoverSuggests[i];
        const tip = Math.hypot(w.x - h.x, w.y - h.y);
        const hitR = 12 + (h.weight || 0.5) * 4;
        if (tip <= hitR) add({ type: 'hoverSuggest', item: h }, tip, 2);
      }
    }

    // Active home centre
    const act = this._activeDisk();
    {
      const d = Math.hypot(w.x - (act.cx || 0), w.y - (act.cy || 0));
      if (d <= 28) add({ type: 'home' }, d, 1);
    }

    // Inactive disk centres (Chase only â€” Function is same-key chart)
    if (this.mapView !== 'function') {
      for (let i = 0; i < (this.disks || []).length; i++) {
        const disk = this.disks[i];
        if (disk.active) continue;
        const d = Math.hypot(w.x - (disk.cx || 0), w.y - (disk.cy || 0));
        if (d <= 22) add({ type: 'diskHome', item: disk }, d, 2);
      }
    }

    // Ghost establish-home pads (Chase pivot halo) â€” generous hit so "leave home" works
    if (this.mapView === 'chase' && this.ghostOptions && this.ghostOptions.length) {
      for (let i = 0; i < this.ghostOptions.length; i++) {
        const g = this.ghostOptions[i];
        const d = Math.hypot(w.x - g.x, w.y - g.y);
        if (d <= (g.r || 14) + 14)
          add(
            { type: 'ghostOption', item: g },
            d,
            this._isBrowse() ? 5 : -1
          );
      }
    }
    // Ghost disk face (click = land tonic)
    if (this.mapView === 'chase' && this.ghostDisks && this.ghostDisks.length) {
      for (let i = 0; i < this.ghostDisks.length; i++) {
        const g = this.ghostDisks[i];
        const d = Math.hypot(w.x - (g.cx || 0), w.y - (g.cy || 0));
        if (d <= (g.R || 60) * 0.72) add({ type: 'ghostDisk', item: g }, d, 1.5);
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

  /**
   * Looser hit for when the precise pass misses (small canvas / zoom / thick fingers).
   * Only seats, function nodes, home â€” never accidental edge inserts.
   */

  SpatialMap.prototype._hitLoose = function (sx, sy) {
    const w = this.screenToWorld(sx, sy);
    let best = null;
    let bestD = Infinity;
    const consider = (hit, d, maxD) => {
      if (d <= maxD && d < bestD) {
        bestD = d;
        best = hit;
      }
    };
    // Prefer a nearby path step so grab/select never misses onto a seat
    const pathN = this._nearestPathNode(w, 34);
    if (pathN) {
      consider(
        { type: 'path', item: pathN },
        Math.hypot(w.x - pathN.x, w.y - pathN.y),
        34
      );
    }
    // Browse: never expand onto write targets (that felt like “look” → add)
    if (this._isBrowse()) return best;
    if (this.scaleSeats && this.scaleSeats.length) {
      this.scaleSeats.forEach((s) => {
        if (this.mapView === 'function' && !s.activeDisk) return;
        consider(
          { type: 'seat', item: s },
          Math.hypot(w.x - s.x, w.y - s.y),
          36
        );
      });
    }
    if (this.mapView === 'function' && this.functionNodes) {
      this.functionNodes.forEach((fn) => {
        consider(
          {
            type: 'functionNode',
            item: {
              chord: fn.chord,
              kind:
                fn.role === 'secondary' || fn.role === 'dominant'
                  ? 'secondary'
                  : fn.role === 'interchange'
                    ? 'interchange'
                    : fn.role === 'colour'
                      ? 'flavour'
                      : 'direction',
              label: fn.label,
              job: fn.roman || fn.role,
              role: fn.role,
              functionNodeId: fn.id,
            },
          },
          Math.hypot(w.x - fn.x, w.y - fn.y),
          32
        );
      });
    }
    const act = this._activeDisk && this._activeDisk();
    if (act) {
      consider(
        { type: 'home' },
        Math.hypot(w.x - (act.cx || 0), w.y - (act.cy || 0)),
        48
      );
    }
    return best;
  };

  SpatialMap.prototype._down = function (e) {
    // Right / middle button: don't start pan/aim (context menu owns right-click)
    if (e.button != null && e.button !== 0) return;
    const pt = this._eventCanvasXY(e);
    const sx = pt.sx;
    const sy = pt.sy;
    let hit = this._hit(sx, sy);
    // Soft second pass: if miss, expand seat / function hit a bit more
    if (!hit) {
      hit = this._hitLoose(sx, sy);
    }
    this._moved = false;
    this.snapAlt = null;
    // Gesture mode from app (Select never aims unless Shift; Reorder never aims)
    var gMode =
      typeof global.HLApp !== 'undefined' && global.HLApp.state
        ? global.HLApp.state.mapGestureMode || 'select'
        : 'select';
    this._allowAim = gMode === 'aim' || (gMode === 'select' && !!e.shiftKey);
    this._reorderOnly = gMode === 'reorder' || (gMode === 'select' && !e.shiftKey);
    this._reorderDropI = -1;

    // Browse: a path chord sitting on a seat / arrow / ghost must grab, never write
    if (
      this._isBrowse() &&
      hit &&
      hit.type !== 'path' &&
      hit.type !== 'pathDelete' &&
      hit.type !== 'altNode'
    ) {
      const wwGrab = this.screenToWorld(sx, sy);
      const nearGrab = this._nearestPathNode(wwGrab, 24);
      if (nearGrab) hit = { type: 'path', item: nearGrab };
    }

    if (hit && hit.type === 'pathDelete') {
      const idx = hit.item && hit.item.i;
      if (
        typeof global.HLApp !== 'undefined' &&
        global.HLApp.removeChordAt &&
        idx != null
      ) {
        global.HLApp.removeChordAt(idx);
      }
      return;
    }

    // Shift/Ctrl+click a path node on a seat: force select (seat would win otherwise)
    if (
      hit &&
      hit.type === 'seat' &&
      (e.shiftKey || e.ctrlKey || e.metaKey) &&
      this.nodes &&
      this.nodes.length
    ) {
      const w = this.screenToWorld(sx, sy);
      let best = null;
      let bestD = Infinity;
      for (let i = 0; i < this.nodes.length; i++) {
        const n = this.nodes[i];
        const d = Math.hypot(w.x - n.x, w.y - n.y);
        if (d < bestD && d <= Math.max(28, (n.r || 14) + 12)) {
          bestD = d;
          best = n;
        }
      }
      if (best) hit = { type: 'path', item: best };
    }

    if (hit && hit.type === 'path') {
      // Click = select. Aim only after a real drag (long paths re-use seats and
      // used to feel like "everything starts dragging").
      // Cancel hover timers + arrows immediately (stale 70ms rebuilds caused "jump on click")
      if (typeof global.HLApp !== 'undefined' && global.HLApp.cancelHoverPreview) {
        global.HLApp.cancelHoverPreview();
      }
      this.hoverSuggests = [];
      this.hoverSuggestPathIndex = -1;
      this._mode = 'node';
      this._aimArmed = false;
      this._freezeCamera = true;
      // Lock camera to current visual (no lerp / no home snap mid-drag)
      this.camera.tx = this.camera.x;
      this.camera.ty = this.camera.y;
      this.camera.tz = this.camera.zoom;
      this._dragNode = hit.item;
      this._dragOrigin = { x: hit.item.x, y: hit.item.y };
      this._dragPos = { x: hit.item.x, y: hit.item.y };
      this._snapSticky = null;
      this._ptrDown = { x: e.clientX, y: e.clientY };
      this.current = hit.item.i;
      this.alts = [];
      if (this.onSelectPath) this.onSelectPath(hit.item.i, hit.item.chord, { deferUI: true });
      this.canvas.setPointerCapture(e.pointerId);
      this.canvas.style.cursor = 'pointer';
      return;
    }
    // Seats / arrows / ghosts: wait for pointerup. Press+drag used to add a chord
    // before the grab even started.
    if (
      hit &&
      (hit.type === 'hoverSuggest' ||
        hit.type === 'seat' ||
        hit.type === 'functionNode' ||
        hit.type === 'home' ||
        hit.type === 'diskHome' ||
        hit.type === 'ghostOption' ||
        hit.type === 'ghostDisk')
    ) {
      this._pendingClick = {
        hit: hit,
        shiftKey: !!e.shiftKey,
        altKey: !!e.altKey,
        ctrlKey: !!e.ctrlKey,
        metaKey: !!e.metaKey,
      };
      this._mode = 'pan';
      this._moved = false;
      this._ptrDown = { x: e.clientX, y: e.clientY };
      this._last = { x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (hit && hit.type === 'edge' && this.onInsertBetween) {
      var edgeMode =
        typeof global.HLApp !== 'undefined' && global.HLApp.state
          ? global.HLApp.state.mapGestureMode || 'select'
          : 'select';
      if (edgeMode !== 'write' && !e.shiftKey) {
        // Browse: edge click only selects nearer step — never inserts
        const ww0 = this.screenToWorld(sx, sy);
        const a0 = this.nodes[hit.afterIndex];
        const b0 = this.nodes[hit.afterIndex + 1];
        const nearer0 =
          a0 && b0
            ? Math.hypot(ww0.x - a0.x, ww0.y - a0.y) <=
              Math.hypot(ww0.x - b0.x, ww0.y - b0.y)
              ? a0
              : b0
            : a0 || b0;
        if (nearer0 && this.onSelectPath) {
          this.onSelectPath(nearer0.i, nearer0.chord, { deferUI: true });
        }
        return;
      }
      // IMPORTANT: do NOT insert on mousedown. That made short chords (G7 0.5b)
      // insert a bridge the instant you tried to drag the node.
      // Wait for a real drag; plain click selects the nearer endpoint instead.
      if (typeof global.HLApp !== 'undefined' && global.HLApp.cancelHoverPreview) {
        global.HLApp.cancelHoverPreview();
      }
      this.hoverSuggests = [];
      this.hoverSuggestPathIndex = -1;
      this._mode = 'edgePending';
      this._pendingEdgeInsert = hit.afterIndex;
      this._aimArmed = false;
      this._moved = false;
      this._freezeCamera = true;
      this.camera.tx = this.camera.x;
      this.camera.ty = this.camera.y;
      this.camera.tz = this.camera.zoom;
      this._ptrDown = { x: e.clientX, y: e.clientY };
      this._last = { x: e.clientX, y: e.clientY };
      // Highlight nearer endpoint so the user sees which side they're near
      const ww = this.screenToWorld(sx, sy);
      const a = this.nodes[hit.afterIndex];
      const b = this.nodes[hit.afterIndex + 1];
      if (a && b) {
        const da = Math.hypot(ww.x - a.x, ww.y - a.y);
        const db = Math.hypot(ww.x - b.x, ww.y - b.y);
        const nearer = da <= db ? a : b;
        this.current = nearer.i;
        if (this.onSelectPath) {
          this.onSelectPath(nearer.i, nearer.chord, { deferUI: true });
        }
      }
      this.canvas.setPointerCapture(e.pointerId);
      this.canvas.style.cursor = 'copy';
      return;
    }
    if (hit && hit.type === 'altNode') {
      if (this.onSelectAltNode) this.onSelectAltNode(hit.item);
      return;
    }
    // Miss: still pan, but report so "left click does nothing" is diagnosable
    if (
      typeof global.HLApp !== 'undefined' &&
      global.HLApp.setSyncStatus &&
      (!this.scaleSeats || !this.scaleSeats.length)
    ) {
      global.HLApp.setSyncStatus('Map has no seats yet Â· try + Home or refresh (Ctrl+F5)');
    }
    this._mode = 'pan';
    this._last = { x: e.clientX, y: e.clientY };
    this.canvas.setPointerCapture(e.pointerId);
  };

  SpatialMap.prototype._move = function (e) {
    const pt = this._eventCanvasXY(e);
    const sx = pt.sx;
    const sy = pt.sy;

    // Deferred edge insert: only mutate path after a real drag
    if (this._mode === 'edgePending' && this._ptrDown) {
      const pd = Math.hypot(e.clientX - this._ptrDown.x, e.clientY - this._ptrDown.y);
      if (pd < 14) return;
      const after = this._pendingEdgeInsert;
      this._pendingEdgeInsert = null;
      this._mode = null;
      if (after != null && this.onInsertBetween) {
        this._freezeCamera = true;
        this._keepCameraOnce = true;
        const newIndex = this.onInsertBetween(after);
        if (newIndex != null && this.beginAimAtIndex) {
          // Write/select mode would otherwise treat this as reorder-only —
          // edge insert is a place-then-aim: show gap seats immediately.
          this._allowAim = true;
          this._reorderOnly = false;
          this._edgeInsertAim = true;
          this.beginAimAtIndex(newIndex, { armed: true, fromEdge: true });
          this._aimArmed = true;
          this._moved = true;
          this.canvas.style.cursor = 'crosshair';
          this._ptrDown = { x: e.clientX, y: e.clientY };
          if (typeof global.HLApp !== 'undefined' && global.HLApp.setSyncStatus) {
            const planted =
              this._dragNode && this._dragNode.chord && this._dragNode.chord.name
                ? this._dragNode.chord.name
                : 'passing chord';
            global.HLApp.setSyncStatus(
              'Passing ' +
                planted +
                ' · drag a green/gold seat to change · release on empty space to cancel'
            );
          }
        }
      }
      // fall through if now in node mode
      if (this._mode !== 'node') return;
    }

    if (this._mode === 'pan' && this._last) {
      const pd =
        this._ptrDown
          ? Math.hypot(e.clientX - this._ptrDown.x, e.clientY - this._ptrDown.y)
          : 99;
      if (this._pendingClick && pd < 10) return;
      const zPan = this.camera.zoom || 1;
      const mdx = e.clientX - this._last.x;
      const mdy = e.clientY - this._last.y;
      const rot = this.camera.rot || 0;
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      this.camera.tx -= (mdx * c + mdy * s) / zPan;
      this.camera.ty -= (-mdx * s + mdy * c) / zPan;
      this.camera.x = this.camera.tx;
      this.camera.y = this.camera.ty;
      this._userPanned = true;
      this._last = { x: e.clientX, y: e.clientY };
      this._moved = true;
      return;
    }

    if (this._mode === 'node' && this._dragNode) {
      const w = this.screenToWorld(sx, sy);
      // Large dead-zone: slight jitter / mis-click must not arm aim or flip quality
      const ARM_PX = 36;
      if (!this._aimArmed && this._ptrDown) {
        const pd = Math.hypot(e.clientX - this._ptrDown.x, e.clientY - this._ptrDown.y);
        if (pd < ARM_PX) {
          this._dragPos = { x: w.x, y: w.y };
          return;
        }
        this._moved = true;
        if (this._reorderOnly || !this._allowAim) {
          this._aimArmed = false;
          this._dragPos = { x: w.x, y: w.y };
          this._reorderDropI = -1;
          let bestDrop = Infinity;
          for (let ni = 0; ni < (this.nodes || []).length; ni++) {
            if (this._dragNode && ni === this._dragNode.i) continue;
            const nn = this.nodes[ni];
            if (!nn) continue;
            const dd = Math.hypot(w.x - nn.x, w.y - nn.y);
            if (dd <= (nn.r || 14) + 18 && dd < bestDrop) {
              bestDrop = dd;
              this._reorderDropI = ni;
            }
          }
          this.canvas.style.cursor = 'grabbing';
          return;
        }
        this._aimArmed = true;
        if (typeof global.HLApp !== 'undefined' && global.HLApp.cancelHoverPreview) {
          global.HLApp.cancelHoverPreview();
        }
        this.hoverSuggests = [];
        let alts = [];
        if (this.onRequestAlts) {
          alts = this.onRequestAlts(this._dragNode.i, this._dragNode.chord) || [];
        }
        this._layoutAlts(this._dragNode.i, alts);
        this._filterNearOriginAlts();
        this.canvas.style.cursor = 'crosshair';
        if (typeof global.HLApp !== 'undefined' && global.HLApp.setSyncStatus) {
          global.HLApp.setSyncStatus(
            'Aiming Â· drag onto a distant seat Â· release there to swap Â· quality: inspector'
          );
        }
      }
      if (!this._aimArmed) return;
      this._moved = true;
      // Free pointer aim â€” lock only when clearly over a pad (not a wide magnet)
      const ox = this._dragOrigin ? this._dragOrigin.x : this._dragNode.x;
      const oy = this._dragOrigin ? this._dragOrigin.y : this._dragNode.y;
      const awayFromHome = Math.hypot(w.x - ox, w.y - oy);
      let best = null;
      let bestRawD = Infinity;
      this.alts.forEach((a) => {
        const d = Math.hypot(w.x - a.x, w.y - a.y);
        // Hit radius = pad size only (+ small grace). No long-range magnet.
        const hitR = (a.r || 18) + 10;
        const stickyGrace =
          this._snapSticky && this._snapSticky === a ? hitR * 1.2 : hitR;
        if (d <= stickyGrace && d < bestRawD) {
          bestRawD = d;
          best = a;
        }
      });
      // Must leave the home seat before any lock (looser when aiming from strip)
      const homeMin = this._aimFromStrip ? 16 : 40;
      if (!best || awayFromHome < homeMin) best = null;
      this._snapSticky = best;
      // Free aim: follow pointer; only stick when locked on a real seat
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
    if (hit && hit.type === 'edge')
      this.canvas.style.cursor = this._gestureMode() === 'write' ? 'copy' : 'pointer';
    else if (hit && hit.type === 'pathDelete') this.canvas.style.cursor = 'pointer';
    else this.canvas.style.cursor = hit ? 'pointer' : 'grab';

    // Path chord hover â†’ suggest next moves (hollow rings)
    if (hit && hit.type === 'path') {
      this.canvas.style.cursor = 'pointer';
      const pi = hit.item && hit.item.i;
      if (this.ensureGhostHalo) this.ensureGhostHalo({ pivotIndex: pi });
      const same =
        prev &&
        prev.type === 'path' &&
        prev.item &&
        hit.item &&
        prev.item.i === hit.item.i;
      if (!same && this.onHoverPath) {
        this.onHoverPath(pi, hit.item.chord);
      }
    } else if (
      hit &&
      hit.type === 'hoverSuggest'
    ) {
      this.canvas.style.cursor = 'pointer';
    } else if (hit && (hit.type === 'ghostOption' || hit.type === 'ghostDisk')) {
      this.canvas.style.cursor = 'pointer';
    } else if (
      !hit ||
      (hit.type !== 'hoverSuggest' &&
        hit.type !== 'path' &&
        hit.type !== 'ghostOption' &&
        hit.type !== 'ghostDisk')
    ) {
      if (this.hideGhostHalo) this.hideGhostHalo();
      // Left the chord and its suggest fan — clear previews
      if (this.hoverSuggests && this.hoverSuggests.length && this.onHoverPath) {
        // null pathIndex signals clear
        this.onHoverPath(null, null);
      }
    }

    // Stable hover ids (object identity changes when seats rebuild)
    const hoverKey = (h) => {
      if (!h) return '';
      if (h.type === 'seat' && h.item) {
        return (
          'seat:' +
          (h.item.root != null ? h.item.root : '') +
          ':' +
          (h.item.chord && h.item.chord.quality) +
          ':' +
          (h.item.disk && h.item.disk.tonic) +
          ':' +
          (h.item.disk && h.item.disk.mode)
        );
      }
      if (h.type === 'functionNode' && h.item && h.item.chord) {
        return (
          'fn:' +
          h.item.chord.root +
          ':' +
          h.item.chord.quality +
          ':' +
          (h.item.functionNodeId || h.item.role || '')
        );
      }
      if (h.type === 'home') return 'home';
      if (h.type === 'ghostOption' && h.item) {
        return 'ghost:' + (h.item.id || h.item.label || '');
      }
      if (h.type === 'path' && h.item) return 'path:' + h.item.i;
      return h.type || '';
    };
    const prevKey = hoverKey(prev);
    const nextKey = hoverKey(hit);
    // Leaving a seat/fn â†’ allow re-trigger when entering again later
    if (prevKey && !nextKey && typeof global.HLApp !== 'undefined') {
      if (global.HLApp._clearHoverSeatKey) global.HLApp._clearHoverSeatKey();
    }

    if (hit && hit.type === 'seat' && nextKey !== prevKey) {
      if (this.onHoverSeat) this.onHoverSeat(hit.item);
      this.canvas.style.cursor = 'pointer';
    }
    if (hit && hit.type === 'functionNode' && nextKey !== prevKey) {
      if (this.onHoverHorizon) this.onHoverHorizon(hit.item);
      this.canvas.style.cursor = 'pointer';
    }
    if (hit && hit.type === 'home' && nextKey !== prevKey) {
      if (this.onHoverHome) this.onHoverHome();
      this.canvas.style.cursor = 'pointer';
    }
    if (hit && hit.type === 'ghostOption' && nextKey !== prevKey) {
      if (this.onHoverGhostOption) this.onHoverGhostOption(hit.item);
      this.canvas.style.cursor = 'pointer';
    }
    if (hit && hit.type === 'ghostDisk') {
      this.canvas.style.cursor = 'pointer';
    }
  };

  SpatialMap.prototype._dispatchPendingClick = function (pending) {
    if (!pending || !pending.hit) return;
    const hit = pending.hit;
    const opts = {
      shiftKey: !!pending.shiftKey,
      altKey: !!pending.altKey,
      ctrlKey: !!pending.ctrlKey,
      metaKey: !!pending.metaKey,
    };
    if (hit.type === 'hoverSuggest' && this.onSelectHoverSuggest) {
      this.onSelectHoverSuggest(hit.item, opts);
    } else if (hit.type === 'seat' && this.onSelectSeat) {
      this.onSelectSeat(hit.item, opts);
    } else if (hit.type === 'functionNode' && this.onSelectHorizon) {
      this.onSelectHorizon(hit.item, opts);
    } else if (hit.type === 'home' && this.onSelectHome) {
      this.onSelectHome(opts);
    } else if (hit.type === 'diskHome') {
      if (this.onSelectDiskHome) this.onSelectDiskHome(hit.item);
      else if (this.onSelectHome && hit.item && hit.item.active) this.onSelectHome(opts);
    } else if (hit.type === 'ghostOption' && this.onSelectGhostOption) {
      this.onSelectGhostOption(hit.item, opts);
    } else if (hit.type === 'ghostDisk') {
      const gopts = (this.ghostOptions || []).filter(
        (o) =>
          o.ghostDisk === hit.item ||
          (o.ghostDisk &&
            hit.item &&
            o.ghostDisk.tonic === hit.item.tonic &&
            o.ghostDisk.mode === hit.item.mode)
      );
      const pick = gopts.find((o) => o.id === 'tonic') || gopts[0];
      if (pick && this.onSelectGhostOption) this.onSelectGhostOption(pick, opts);
    }
  };

  SpatialMap.prototype._up = function (e) {
    if (this._pendingClick) {
      const pending = this._pendingClick;
      this._pendingClick = null;
      const wasPan = this._mode === 'pan';
      if (!this._moved && wasPan) {
        this._mode = null;
        this._dispatchPendingClick(pending);
        this.clearInteraction();
        return;
      }
      // Dragged away — treat as pan, do not write
      this._mode = null;
      this.clearInteraction();
      if (typeof global.HLApp !== 'undefined' && global.HLApp.setSyncStatus) {
        global.HLApp.setSyncStatus('Cancelled · drag left the target · nothing added');
      }
      return;
    }

    // Edge press without drag â†’ no insert, just keep nearer endpoint selected
    if (this._mode === 'edgePending') {
      this._pendingEdgeInsert = null;
      this._aimArmed = false;
      this._ptrDown = null;
      this._mode = null;
      this.clearInteraction();
      return;
    }

    const wasNode = this._mode === 'node';
    const dragI = this._dragNode && this._dragNode.i;
    const dragCh = this._dragNode && this._dragNode.chord;
    const edgeInsertAim = !!this._edgeInsertAim;
    // Require armed aim + real travel + locked distant target (tiny moves never rewrite)
    const travelPx =
      wasNode && this._ptrDown && e
        ? Math.hypot(e.clientX - this._ptrDown.x, e.clientY - this._ptrDown.y)
        : 0;
    const canCommit =
      wasNode &&
      this._aimArmed &&
      this._moved &&
      this.snapAlt &&
      this.snapAlt.chord &&
      travelPx >= 40;
    let didAimCommit = !!canCommit;
    if (wasNode && this._dragNode) {
      if (canCommit) {
        const meta = {
          prevChord: this.nodes[this._dragNode.i - 1] && this.nodes[this._dragNode.i - 1].chord,
          nextChord: this.nodes[this._dragNode.i + 1] && this.nodes[this._dragNode.i + 1].chord,
          role: this.snapAlt.role || '',
          establish: !!this.snapAlt.establish,
          establishRoute: this.snapAlt.establishRoute || null,
          modulateTo: this.snapAlt.modulateTo || null,
        };
        this._freezeCamera = true;
        this._keepCameraOnce = true;
        if (this.onPullChord) {
          this.onPullChord(this._dragNode.i, this.snapAlt.chord, meta);
        } else if (this.onSwapChord) {
          this.onSwapChord(this._dragNode.i, this.snapAlt.chord);
        }
      } else if (edgeInsertAim) {
        // Empty space (or not locked on a seat) cancels the planted passing chord.
        // Releasing still on the new node keeps it.
        let nearPlanted = false;
        if (e && this._dragOrigin) {
          const ptUp = this._eventCanvasXY(e);
          const ww = this.screenToWorld(ptUp.sx, ptUp.sy);
          nearPlanted =
            Math.hypot(ww.x - this._dragOrigin.x, ww.y - this._dragOrigin.y) < 48;
        }
        if (this.onAimChange) this.onAimChange(this._dragNode.i, null, {});
        if (nearPlanted) {
          if (typeof global.HLApp !== 'undefined' && global.HLApp.setSyncStatus) {
            const kept = (dragCh && dragCh.name) || 'passing chord';
            global.HLApp.setSyncStatus(
              'Kept ' + kept + ' · drag a seat to change · empty space cancels'
            );
          }
        } else if (typeof global.HLApp !== 'undefined' && global.HLApp.undo) {
          if (global.HLApp._sessionPushTimer) {
            clearTimeout(global.HLApp._sessionPushTimer);
            global.HLApp._sessionPushTimer = null;
          }
          global.HLApp.undo();
          global.HLApp.setSyncStatus(
            'Cancelled insert · released on empty space · no extra chord'
          );
        }
        didAimCommit = false;
      } else if (this._moved && travelPx >= 28) {
        // Drop on another path step → reorder (no new chords). Drop on seat = above.
        let dropI = this._reorderDropI != null ? this._reorderDropI : -1;
        if (e && this.nodes && this.nodes.length) {
          const ptUp = this._eventCanvasXY(e);
          const ww = this.screenToWorld(ptUp.sx, ptUp.sy);
          let bestD = Infinity;
          for (let ni = 0; ni < this.nodes.length; ni++) {
            if (ni === dragI) continue;
            const n = this.nodes[ni];
            if (!n) continue;
            const d = Math.hypot(ww.x - n.x, ww.y - n.y);
            const hitR = (n.r || 14) + 18;
            if (d <= hitR && d < bestD) {
              bestD = d;
              dropI = ni;
            }
          }
        }
        if (dropI >= 0 && dragI != null && dragI >= 0 && dropI !== dragI) {
          this._freezeCamera = true;
          this._keepCameraOnce = true;
          if (typeof global.HLApp !== 'undefined' && global.HLApp.reorderChord) {
            global.HLApp.reorderChord(dragI, dropI);
            if (global.HLApp.setSyncStatus) {
              global.HLApp.setSyncStatus(
                'Reordered · step ' +
                  (dragI + 1) +
                  ' → position ' +
                  (dropI + 1) +
                  ' · no new chords'
              );
            }
          } else if (this.onReorderPath) {
            this.onReorderPath(dragI, dropI);
          }
        } else {
          // No seat lock, no step drop — cancel without adding chords
          if (this.onAimChange) this.onAimChange(this._dragNode.i, null, {});
          if (typeof global.HLApp !== 'undefined' && global.HLApp.setSyncStatus) {
            global.HLApp.setSyncStatus(
              'Drag: drop on another step to reorder · or onto a seat to reassign · nothing added'
            );
          }
        }
      } else if (this._moved || this._aimArmed) {
        if (this.onAimChange) this.onAimChange(this._dragNode.i, null, {});
        if (typeof global.HLApp !== 'undefined' && global.HLApp.setSyncStatus) {
          global.HLApp.setSyncStatus(
            'Aim cancelled · nothing changed · drop on a step to reorder or a seat to swap'
          );
        }
      } else if (this.onSelectPath) {
        // Plain click — select only (no full refresh that re-homes the camera)
        this.onSelectPath(this._dragNode.i, this._dragNode.chord, { deferUI: true });
        if (this.onSelectPathClick) {
          this.onSelectPathClick(this._dragNode.i, this._dragNode.chord);
        }
      }
    }
    this._aimArmed = false;
    this._ptrDown = null;
    this.clearInteraction();
    // Apply any sequence edits that arrived while aiming (map was deferred)
    if (didAimCommit) {
      this._freezeCamera = true;
      this._keepCameraOnce = true;
    }
    this._flushPathIfDirty();
    // Soft-unfreeze next frame so later Fit/Home still work
    if (didAimCommit) {
      const self = this;
      setTimeout(() => {
        self._freezeCamera = false;
        self._keepCameraOnce = false;
      }, 0);
    }
  };

})(typeof window !== "undefined" ? window : globalThis);