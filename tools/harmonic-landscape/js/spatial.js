/**
 * Path-in-space map: fixed home stage, trajectory, dual versions, edit gestures
 */
(function (global) {
  'use strict';

  const REGION = {
    diatonic:    { fill: '#c4a574', ghost: 'rgba(196,165,116,0.35)' },
    secondary:   { fill: '#7eb8da', ghost: 'rgba(126,184,218,0.45)' },
    secondaryii: { fill: '#5a9ec4', ghost: 'rgba(90,158,196,0.45)' },
    interchange: { fill: '#c4a0e0', ghost: 'rgba(196,160,224,0.4)' },
    gate:        { fill: '#e8c98a', ghost: 'rgba(232,201,138,0.5)' },
    chromatic:   { fill: '#d4786a', ghost: 'rgba(212,120,106,0.45)' },
    tritone:     { fill: '#e85d4c', ghost: 'rgba(232,93,76,0.5)' },
    diminished:  { fill: '#b07ad4', ghost: 'rgba(176,122,212,0.5)' },
    valt:        { fill: '#e0a060', ghost: 'rgba(224,160,96,0.5)' },
    parallel:    { fill: '#6bb38a', ghost: 'rgba(107,179,138,0.4)' },
    cadence:     { fill: '#e8c98a', ghost: 'rgba(232,201,138,0.45)' },
    modulate:    { fill: '#a78bfa', ghost: 'rgba(167,139,250,0.45)' },
    flavour:     { fill: '#f0a070', ghost: 'rgba(240,160,112,0.4)' },
    direction:   { fill: '#7eb8da', ghost: 'rgba(126,184,218,0.35)' },
    home:        { fill: '#e8c98a', ghost: 'rgba(232,201,138,0.65)' },
    alt:         { fill: '#e8c98a', ghost: 'rgba(232,201,138,0.55)' },
  };

  /** Shared seat radii (fraction of disk R) â€” Chase seats + Function diatonic ring */
  const SEAT = {
    tonic: 0.42,
    scale: 0.72,
    shell: 1.12,
    v7: 0.92,
    squash: 0.88,
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
    this.keyLedger = []; // optional history (not all drawn â€” path owns travel)
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
    /** 'chase' = scale seats Â· 'function' = neighbourhood chart (same key) */
    this.mapView = 'chase';
    this.functionChart = null; // { nodes, edges, tonic, mode }
    this.functionNodes = [];
    /** @deprecated next-move hollow dots removed â€” Chase is seats + ghosts only */
    this.showHorizon = false;
    this.horizon = [];
    this.showAlt = true;
    this.camera = { x: 0, y: 0, zoom: 1, tx: 0, ty: 0, tz: 1 };
    this.hover = null;
    this.snapAlt = null;
    this.pulseT = 0;
    this.onSelectPath = null;
    this.onSelectHorizon = null;
    this.onHoverHorizon = null;
    this.onHoverPath = null; // (pathIndex, chord) â€” â€œwhat next?â€ previews
    this.onSelectHoverSuggest = null; // click a temporary next-move ring
    this.onSelectHome = null; // click gold home disc â†’ start/land on tonic
    this.onHoverHome = null;
    this.onSelectSeat = null; // click Chase scale seat â†’ add chord
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
    this.snapRadius = 56; // larger seats â†’ easier drop
    this.scaleSeats = []; // clickable seats on active disk
    /** Temporary next-move pads while hovering a path chord */
    this.hoverSuggests = [];
    this.hoverSuggestPathIndex = -1;
    /** Freeze pan/zoom through aim + commit (avoids Home-lock yank) */
    this._freezeCamera = false;
    this._userPanned = false;
    this._forceHomeCenter = false;
    this._mode = null; // null | 'pan' | 'node' (aim/drag)
    this._dragNode = null;
    this._dragOrigin = null; // original node world pos (chord stays here)
    this._dragPos = null; // magnet / aim point â€” not the chord
    this._last = null;
    this._moved = false;
    this._aimPreview = null; // { chord, x, y, label, role }
    this._pathDirty = false; // sequence changed while aiming
    this._bind();
    this.resize();
    this.rememberKey(this.origin.tonic, this.origin.mode);
    this._rebuildDisks();
  }

  /**
   * End pan/aim interaction. Single exit for afterEdit / Add / refresh recovery.
   */

  SpatialMap.prototype.clearInteraction = function (opts) {
    opts = opts || {};
    this.endExternalAimListeners && this.endExternalAimListeners();
    this._mode = null;
    this._dragNode = null;
    this._dragOrigin = null;
    this._dragPos = null;
    this._snapSticky = null;
    this._last = null;
    this._pendingEdgeInsert = null;
    this._aimFromStrip = false;
    this._reorderDropI = -1;
    this._pendingClick = null;
    this.alts = [];
    this.snapAlt = null;
    this._aimPreview = null;
    this._pathDirty = false;
    this.hoverSuggests = [];
    this.hoverSuggestPathIndex = -1;
    if (this.canvas) this.canvas.style.cursor = 'grab';
  };

  SpatialMap.prototype._bind = function () {
    const c = this.canvas;
    try {
      c.tabIndex = 0;
    } catch (_) {}
    c.addEventListener('pointerdown', (e) => {
      try {
        c.focus({ preventScroll: true });
      } catch (_) {
        try {
          c.focus();
        } catch (__) {}
      }
      this._down(e);
    });
    c.addEventListener('pointermove', (e) => this._move(e));
    c.addEventListener('pointerup', (e) => this._up(e));
    c.addEventListener('pointercancel', (e) => this._up(e));
    c.addEventListener('pointerleave', () => {
      if (this._mode !== 'node') this.hover = null;
    });
    // Double-click writes in Select/browse mode (single click is preview only)
    c.addEventListener('dblclick', (e) => {
      if (e.button != null && e.button !== 0) return;
      const pt = this._eventCanvasXY(e);
      let hit = this._hit(pt.sx, pt.sy);
      if (!hit) hit = this._hitLoose(pt.sx, pt.sy);
      // Double-clicking a path step must never add — the seat under it used to write
      if (hit && (hit.type === 'path' || hit.type === 'pathDelete')) return;
      if (this._nearestPathNode) {
        const ww = this.screenToWorld(pt.sx, pt.sy);
        if (this._nearestPathNode(ww, 22)) return;
      }
      if (!hit) return;
      const writeOpts = {
        dblClick: true,
        shiftKey: !!e.shiftKey,
        altKey: !!e.altKey,
        forceWrite: true,
      };
      if (hit.type === 'seat' && this.onSelectSeat) {
        this.onSelectSeat(hit.item, writeOpts);
      } else if (hit.type === 'functionNode' && this.onSelectHorizon) {
        this.onSelectHorizon(hit.item, writeOpts);
      } else if (hit.type === 'hoverSuggest' && this.onSelectHoverSuggest) {
        this.onSelectHoverSuggest(hit.item, writeOpts);
      } else if (hit.type === 'home' && this.onSelectHome) {
        this.onSelectHome(writeOpts);
      } else if (hit.type === 'ghostOption' && this.onSelectGhostOption) {
        this.onSelectGhostOption(hit.item, writeOpts);
      } else if (hit.type === 'ghostDisk') {
        const opts = (this.ghostOptions || []).filter(function (o) {
          return (
            o.ghostDisk === hit.item ||
            (o.ghostDisk &&
              hit.item &&
              o.ghostDisk.tonic === hit.item.tonic &&
              o.ghostDisk.mode === hit.item.mode)
          );
        });
        const pick = opts.find(function (o) {
          return o.id === 'tonic';
        }) || opts[0];
        if (pick && this.onSelectGhostOption) this.onSelectGhostOption(pick, writeOpts);
      }
    });
    // Right-click palette (colours / strong next / packs) â€” not browser menu
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this._mode === 'node' || this._mode === 'edgePending') return;
      const pt = this._eventCanvasXY(e);
      let hit = this._hit(pt.sx, pt.sy);
      if (!hit) hit = this._hitLoose(pt.sx, pt.sy);
      if (typeof this.onContextMenu === 'function') {
        this.onContextMenu(hit, e, { sx: pt.sx, sy: pt.sy });
      }
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
    // Don't force a huge minimum that overflows the flex stage (caused loop: grow â†’
    // scrollbar â†’ shrink â†’ grow â†’ flicker, and blocked reliable clicks).
    const nw = Math.max(120, Math.floor(r.width));
    const nh = Math.max(120, Math.floor(r.height));
    // Skip no-op / mid-aim resizes (DOM reflow while aiming caused shake)
    if (this._mode === 'node' || this._mode === 'edgePending') return;
    // Always accept a real size when we still have the constructor defaults
    // (w=0 from failed first layout left hits broken forever)
    if (
      this.w > 0 &&
      this.h > 0 &&
      Math.abs(nw - (this.w || 0)) < 2 &&
      Math.abs(nh - (this.h || 0)) < 2
    ) {
      return;
    }
    // Debounce rapid thrash (toolbar wrap / sidebar collapse)
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (this._lastResizeAt && now - this._lastResizeAt < 40) {
      if (!this._resizePending) {
        this._resizePending = true;
        const self = this;
        setTimeout(() => {
          self._resizePending = false;
          self.resize();
        }, 50);
      }
      return;
    }
    this._lastResizeAt = now;
    this.w = nw;
    this.h = nh;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // IMPORTANT: do NOT rebuild disks / seats / path here.
    // Scaling R and re-laying-out on every resize made the world jump under a
    // fixed camera (felt like the camera was thrashing). Layout only changes
    // via setPath / setOrigin / Fit. Canvas buffer just matches the CSS box.
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

  SpatialMap.prototype.setOrigin = function (tonic, mode, opts) {
    opts = opts || {};
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
    // Mid-drag: only record origin (path layout deferred)
    if (this._mode === 'node') return;
    // Same key + camera freeze: skip disk rebuild (view switch)
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
    // Path layout is setPath's job (refreshMap passes layoutPath:false).
    // Only layout here when called standalone (e.g. early boot).
    if (opts.layoutPath !== false && this.path && this.path.length) {
      this._layoutPath();
      this._emitTrajectory();
    }
  };

  /**
   * Solid Chase disks = keys you traveled (path ownership) + write home.
   * Adjacent unexplored keys are ghost disks from _rebuildGhostHalo (not here).
   */

  SpatialMap.prototype.setShowHorizon = function (/* on */) {
    this.showHorizon = false;
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

  SpatialMap.prototype.setPath = function (chords, currentIndex) {
    // Deep-ish clone so list edits (quality/name/notes) never leave stale node labels
    this.path = (chords || []).map((c) => {
      if (!c) return c;
      return Object.assign({}, c, {
        notes: (c.notes || []).slice(),
        intervals: (c.intervals || []).slice(),
        name: c.name,
        quality: c.quality,
        root: c.root,
        roman: c.roman,
        duration: c.duration,
        localTonic: c.localTonic,
        localMode: c.localMode,
        region: c.region,
        bassPc: c.bassPc,
      });
    });
    this.current =
      currentIndex != null
        ? currentIndex
        : this.path.length
          ? this.path.length - 1
          : -1;
    // Mid-aim: defer layout so drag stays stable, but don't drop the update
    if (this._mode === 'node') {
      this._pathDirty = true;
      return;
    }
    this._pathDirty = false;
    try {
      // Disks follow keys present in the path so multi-key journeys stay visible
      this._rebuildDisks();
      this._layoutPath();
      this._emitTrajectory();
    } catch (err) {
      console.error('setPath layout failed', err);
      // Always rebuild nodes from path on failure (length-stable edits used to keep stale chords)
      try {
        this.nodes = this.path.map((ch, i) => ({
          chord: ch,
          x:
            (this.nodes && this.nodes[i] && this.nodes[i].x) ||
            (i - (this.path.length - 1) / 2) * 40,
          y: (this.nodes && this.nodes[i] && this.nodes[i].y) || 0,
          r: 16 + Math.min(11, ((ch && ch.duration) || 4) * 1.15),
          i: i,
        }));
        this._emitTrajectory();
      } catch (_) {}
    }
  };

  SpatialMap.prototype._flushPathIfDirty = function () {
    if (!this._pathDirty || this._mode === 'node') return;
    this._pathDirty = false;
    this._rebuildDisks();
    this._layoutPath();
    this._emitTrajectory();
  };

  /**
   * Enter aim/drag mode on an existing path step (e.g. after edge insert).
   * Pointer capture is the caller's job if continuing a gesture.
   * opts.armed â€” true when starting from the time strip (show recommendations immediately)
   * opts.clientX/Y â€” seed pointer for external (stripâ†’map) drags
   */

  SpatialMap.prototype.setHorizon = function (/* items */) {
    this.horizon = [];
  };

  /** Temporary â€œwhere next?â€ pads while hovering a path chord. */

  SpatialMap.prototype.setHoverSuggests = function (pads, pathIndex) {
    this.hoverSuggests = pads || [];
    this.hoverSuggestPathIndex =
      pathIndex != null ? pathIndex : this.hoverSuggestPathIndex;
  };

  SpatialMap.prototype.clearHoverSuggests = function () {
    this.hoverSuggests = [];
    this.hoverSuggestPathIndex = -1;
  };

  SpatialMap.prototype.setCameraMode = function (mode) {
    const next = mode === 'follow' || mode === 'fit' ? mode : 'home';
    const prev = this.cameraMode;
    this.cameraMode = next;
    // Explicit Home lock click â†’ re-centre; Fit always re-frames
    if (next === 'home' && prev !== 'home') {
      this._userPanned = false;
      this._forceHomeCenter = true;
    }
    if (next === 'fit') this._userPanned = false;
    this._freezeCamera = false;
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
    // Hard-snap zoom so ChaseÃ¢â€ â€Function never eases to a different scale
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

  SpatialMap.prototype.start = function () {
    const loop = () => {
      requestAnimationFrame(loop);
      this.pulseT += 0.05;
      const cam = this.camera;
      // Snap camera during interact; soft lerp only for deliberate mode changes
      // (Fit/Home). Fast lerp after path edits felt like constant jumpiness.
      const interact =
        this._mode === 'pan' ||
        this._mode === 'node' ||
        this._mode === 'edgePending' ||
        this._freezeCamera ||
        this._keepCameraOnce;
      if (interact) {
        cam.x = cam.tx;
        cam.y = cam.ty;
        cam.zoom = cam.tz;
      } else {
        // Gentler ease (was 0.12 â€” snappy enough to feel like a jolt)
        const k = 0.08;
        cam.x += (cam.tx - cam.x) * k;
        cam.y += (cam.ty - cam.y) * k;
        cam.zoom += (cam.tz - cam.zoom) * k;
        // Snap when close enough to avoid endless micro-drift
        if (Math.abs(cam.tx - cam.x) < 0.15) cam.x = cam.tx;
        if (Math.abs(cam.ty - cam.y) < 0.15) cam.y = cam.ty;
        if (Math.abs(cam.tz - cam.zoom) < 0.002) cam.zoom = cam.tz;
      }
      this.draw();
    };
    loop();
  };

  SpatialMap.prototype.focusHome = function () {
    this.cameraMode = 'home';
    this.camera.tx = 0;
    this.camera.ty = 0;
    this.camera.tz = 1;
  };

  /** Pan camera so a multi-key disk sits near the viewport centre. */
  SpatialMap.prototype.focusDisk = function (disk) {
    if (!disk) return this.focusHome();
    this.cameraMode = 'free';
    // World coords: disk centre should approach view origin under pan
    this.camera.tx = -(disk.cx || 0);
    this.camera.ty = -(disk.cy || 0);
    if (this.camera.tz == null || this.camera.tz < 0.85) this.camera.tz = 1;
    this.draw && this.draw();
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
    map.showHorizon = false;
    map.showAlt = false;
    map.altNodes = [];

    // 1) Midpoint of first edge (curve bows up slightly) should be edge
    const c01 = map._edgeControl(map.nodes[0], map.nodes[1]);
    const mid = map._quadPoint(c01, 0.5);
    // world â†’ screen for _hit (uses screen coords)
    const toScreen = (wx, wy) => ({
      sx: wx * map.camera.zoom + map.w / 2,
      sy: wy * map.camera.zoom + map.h / 2,
    });
    let s = toScreen(mid.x, mid.y);
    let hit = map._hit(s.sx, s.sy);
    assert(hit && hit.type === 'edge' && hit.afterIndex === 0, 'mid curve â†’ edge 0, got ' + (hit && hit.type));

    // 2) Near path node should be path, not edge
    s = toScreen(map.nodes[0].x, map.nodes[0].y);
    hit = map._hit(s.sx, s.sy);
    assert(hit && hit.type === 'path' && hit.item.i === 0, 'on node 0 â†’ path, got ' + (hit && hit.type));

    // 3) Far away â†’ null
    s = toScreen(300, 300);
    hit = map._hit(s.sx, s.sy);
    assert(!hit, 'far point â†’ null, got ' + (hit && hit.type));

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

    // 5) Seat at (0,-60) â€” not edge
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
    // B(11)â†’C(0): short arc is +1 â†’ mid is B or C, never F# (6) from arithmetic mean
    assert(blend(11, 0, 0.5) === 0 || blend(11, 0, 0.5) === 11, 'Bâ†’C mid on short arc not F#');
    assert(blend(11, 0, 0.5) !== 6, 'Bâ†’C must not use arithmetic mean (F#)');
    // C(0)â†’G(7): short arc is Ã¢Ë†â€™5 â†’ mid near Bb/A, not E
    const cg = blend(0, 7, 0.5);
    assert(cg === 9 || cg === 10 || cg === 11 || cg === 0, 'Câ†’G short-arc mid, got ' + cg);
    // Arithmetic mean of 11 and 0 is the classic wrong answer
    assert(Math.round((11 + 0) / 2) % 12 === 6, 'sanity: arithmetic mean is F#');

    return {
      ok: failures.length === 0,
      failures,
      passed: 7 - failures.length,
    };
  }

  global.HLSpatial = { SpatialMap: SpatialMap, REGION: REGION, SEAT: SEAT, selfTest: selfTest };
})(typeof window !== 'undefined' ? window : globalThis);
