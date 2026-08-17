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

    this.disks = list.map((k) => ({
      tonic: k.tonic,
      mode: k.mode,
      cx: 0,
      cy: 0,
      R: k.active ? R : R * 0.85,
      rot: 0,
      active: !!k.active,
      meshed: !!k.active,
      label: M ? M.noteName(k.tonic) : '?',
    }));

    // Journey: write-home + one traveled disk as meshed cogs at the pivot seat.
    // Third+ disks stay fifths-offset (gear train is a later sitting).
    this._placeJourneyCogs(R);

    // Never auto-pan/zoom here — rebuilds run on every setPath and caused jumpiness.
    // User re-frames with Fit / Home lock / wheel / pan.
    this._rebuildScaleSeats();
    this._syncGhostHalo();
  };

  /**
   * World XY of a seat on a disk. `rot` is added to the harmonic-scale angle
   * before squash so meshed cogs and drawn rings stay aligned.
   */
  SpatialMap.prototype._diskSeatXY = function (disk, angle, radius) {
    disk = disk || {};
    const rad = radius != null ? radius : disk.R || 120;
    return {
      x: (disk.cx || 0) + Math.cos(angle) * rad,
      y: (disk.cy || 0) + Math.sin(angle) * rad * SEAT.squash,
    };
  };

  /** Radius a chord occupies on a disk (same rings as Journey path seats). */
  SpatialMap.prototype._hitRadius = function (disk, hit) {
    const R = (disk && disk.R) || 120;
    if (!hit || !hit.seat) return R * SEAT.scale;
    if (hit.seat.role === 'tonic' && hit.onScale && !hit.shell) return R * SEAT.tonic;
    if (hit.shell === 'secondary') return R * SEAT.v7;
    if (hit.shell === 'variant') return R * 0.82;
    if (hit.shell === true) return R * SEAT.shell;
    return R * SEAT.scale;
  };

  /** Seat world position of a chord on a given disk, honouring disk.rot. */
  SpatialMap.prototype._seatPosOnDisk = function (ch, disk) {
    const M = global.HLMusic;
    const d = disk || this._activeDisk();
    if (!ch || !M || !M.seatForChord) {
      return { x: d.cx || 0, y: d.cy || 0, onScale: false, shell: false, seat: null };
    }
    const hit = M.seatForChord(
      ch,
      d.tonic != null ? d.tonic : this.origin.tonic,
      d.mode || this.origin.mode
    );
    const rad = this._hitRadius(d, hit);
    const ang = ((hit.seat && hit.seat.angle) || 0) + (d.rot || 0);
    const p = this._diskSeatXY(d, ang, rad);
    p.onScale = !!(hit && hit.onScale);
    p.shell = hit && hit.shell;
    p.seat = hit && hit.seat;
    p.hit = hit;
    p.ang = ang;
    p.rad = rad;
    return p;
  };

  SpatialMap.prototype._pitchKey = function (ch) {
    const notes = (ch && ch.notes) || [];
    if (notes.length) {
      const seen = {};
      const pcs = [];
      notes.forEach((n) => {
        const p = ((Number(n) % 12) + 12) % 12;
        if (!seen[p]) {
          seen[p] = true;
          pcs.push(p);
        }
      });
      pcs.sort((a, b) => a - b);
      return pcs.join(',');
    }
    if (ch && ch.root != null) {
      const M = global.HLMusic;
      const fam =
        M && M.qualityFamily ? M.qualityFamily(ch.quality) : ch.quality || '';
      return ch.root + ':' + fam;
    }
    return '';
  };

  /** Same-disk revisit identity: seat + ring, not exact quality / slash bass. */
  SpatialMap.prototype._visitSeatKey = function (ch) {
    if (!ch) return '';
    const disk = this._diskForChord(ch);
    const M = global.HLMusic;
    const kid = this._keyId(
      disk && disk.tonic != null ? disk.tonic : this.origin.tonic,
      (disk && disk.mode) || this.origin.mode
    );
    if (!M || !M.seatForChord) {
      return kid + ':' + ch.root + ':' + (ch.quality || '');
    }
    const hit = M.seatForChord(
      ch,
      disk && disk.tonic != null ? disk.tonic : this.origin.tonic,
      (disk && disk.mode) || this.origin.mode
    );
    const shell =
      hit.shell === true ? 'out' : hit.shell ? String(hit.shell) : 'in';
    const si =
      hit.seat && hit.seat.seatIndex != null
        ? hit.seat.seatIndex
        : 'r' + ch.root;
    return kid + ':' + si + ':' + shell;
  };

  /**
   * Named rim seat for a chord on a disk. Chromatic (no roman) is not a tooth.
   * Same-root colour (F major on Fm) still counts — it is the F tooth.
   */
  SpatialMap.prototype._namedHit = function (ch, disk) {
    const M = global.HLMusic;
    if (!ch || !disk || !M || !M.seatForChord) return null;
    const hit = M.seatForChord(ch, disk.tonic, disk.mode);
    if (!hit || !hit.seat) return null;
    if (hit.shell === true) return null;
    return hit;
  };

  /** Unrotated harmonic-scale angle of a pitch class on a disk. */
  SpatialMap.prototype._rawSeatAngle = function (disk, root) {
    const M = global.HLMusic;
    const t = disk && disk.tonic != null ? disk.tonic : 0;
    const r = M && M.pc ? M.pc(root) : ((Number(root) % 12) + 12) % 12;
    if (M && M.circularHarmonicScale) {
      const seats = M.circularHarmonicScale(t, disk.mode);
      for (let i = 0; i < seats.length; i++) {
        if (seats[i].root === r) return seats[i].angle;
      }
    }
    return -Math.PI / 2 + (((r - t) % 12) + 12) % 12 * ((Math.PI * 2) / 12);
  };

  SpatialMap.prototype._chordRootPc = function (ch) {
    const M = global.HLMusic;
    if (!ch || ch.root == null) return null;
    return M && M.pc ? M.pc(ch.root) : ((Number(ch.root) % 12) + 12) % 12;
  };

  SpatialMap.prototype._chordFam = function (ch) {
    const M = global.HLMusic;
    if (!ch) return '';
    return M && M.qualityFamily ? M.qualityFamily(ch.quality) : ch.quality || '';
  };

  /**
   * Score a path chord as the cog tooth between two disks.
   * General rule: a pivot is a chord named on both rims. Prefer a real
   * scale-seat tooth (not a hub) and a sound that appears on both disks.
   */
  SpatialMap.prototype._scorePivot = function (ch, diskA, diskB) {
    const hA = this._namedHit(ch, diskA);
    const hB = this._namedHit(ch, diskB);
    if (!hA || !hB) return -1;
    let score = 1;
    const exactA = !hA.shell;
    const exactB = !hB.shell;
    if (exactA && exactB) score += 100;
    else if (exactA || exactB) score += 50;
    const rimA = hA.seat.role !== 'tonic';
    const rimB = hB.seat.role !== 'tonic';
    if (rimA && rimB) score += 30;
    else if (rimA || rimB) score += 15;
    const root = this._chordRootPc(ch);
    const fam = this._chordFam(ch);
    const pk = this._pitchKey(ch);
    const sameSound = (p) => {
      if (!p) return false;
      if (this._chordRootPc(p) === root && this._chordFam(p) === fam) return true;
      return !!(pk && this._pitchKey(p) === pk);
    };
    const sameDisk = (d, e) =>
      d &&
      e &&
      d.tonic === e.tonic &&
      (d.mode || '') === (e.mode || '');
    let repeats = 0;
    let onA = false;
    let onB = false;
    let crossings = 0;
    const path = this.path || [];
    for (let i = 0; i < path.length; i++) {
      const p = path[i];
      if (!p) continue;
      if (sameSound(p)) {
        repeats += 1;
        const own = this._diskForChord(p);
        if (sameDisk(own, diskA)) onA = true;
        if (sameDisk(own, diskB)) onB = true;
      }
      if (i > 0 && sameSound(p)) {
        const prevD = this._diskForChord(path[i - 1]);
        const curD = this._diskForChord(p);
        if (prevD && curD && !sameDisk(prevD, curD)) crossings += 1;
      }
    }
    if (repeats >= 2) score += 40;
    // The path actually plants this sound on both rims (the visible shared F)
    if (onA && onB) score += 80;
    if (crossings) score += 20 * crossings;
    return score;
  };

  /**
   * Best path chord that is a named seat on both disks — the cog contact.
   * Not “first landing” and not a key-specific special case.
   */
  SpatialMap.prototype._findMeshPivot = function (home, other) {
    if (!home || !other) return null;
    const path = this.path || [];
    let best = null;
    let bestScore = -1;
    for (let i = 0; i < path.length; i++) {
      const ch = path[i];
      if (!ch) continue;
      const score = this._scorePivot(ch, home, other);
      if (score > bestScore) {
        bestScore = score;
        best = {
          ch: ch,
          i: i,
          hitH: this._namedHit(ch, home),
          hitO: this._namedHit(ch, other),
          score: score,
        };
      }
    }
    return best;
  };

  SpatialMap.prototype._pickMeshPartner = function (home, others) {
    if (!others || !others.length) return null;
    if (others.length === 1) return others[0];
    let best = null;
    let bestScore = -1;
    for (let i = 0; i < others.length; i++) {
      const p = this._findMeshPivot(home, others[i]);
      const s = p && p.score != null ? p.score : -1;
      if (s > bestScore) {
        best = others[i];
        bestScore = s;
      }
    }
    return best || others[0];
  };

  SpatialMap.prototype._placeDiskByFifths = function (home, disk, idx, R) {
    const M = global.HLMusic;
    const steps =
      M && M.fifthsDistance
        ? M.fifthsDistance(home.tonic, disk.tonic)
        : idx + 1;
    const ang =
      -Math.PI / 2 +
      (steps !== 0 ? (steps / 6) * Math.PI : ((idx + 1) / 4) * Math.PI * 1.6 - 0.4);
    const dist = R * (1.85 + idx * 0.35);
    disk.cx = Math.cos(ang) * dist;
    disk.cy = Math.sin(ang) * dist * 0.9;
    disk.R = R * 0.85;
    disk.rot = 0;
    disk.meshed = false;
  };

  /**
   * Mesh `moving` into `anchor` so the pivot pitch is one shared tooth.
   * Both rims use the scale ring (the roman seats) — hubs are not cog teeth.
   */
  SpatialMap.prototype._meshDiskAtPivot = function (anchor, moving, pivot, R) {
    moving.R = R;
    anchor.R = R;
    const root = this._chordRootPc(pivot.ch);
    const angA = this._rawSeatAngle(anchor, root) + (anchor.rot || 0);
    const angM0 = this._rawSeatAngle(moving, root);
    moving.rot = angA + Math.PI - angM0;
    const tooth = R * SEAT.scale;
    const dist = tooth * 2;
    moving.cx = (anchor.cx || 0) + Math.cos(angA) * dist;
    moving.cy = (anchor.cy || 0) + Math.sin(angA) * dist * SEAT.squash;
    moving.meshed = true;
    const contact = this._diskSeatXY(anchor, angA, tooth);
    if (!this._meshContacts) this._meshContacts = [];
    this._meshContacts.push({
      root: root,
      fam: this._chordFam(pivot.ch),
      pitchKey: this._pitchKey(pivot.ch),
      x: contact.x,
      y: contact.y,
      a: this._keyId(anchor.tonic, anchor.mode),
      b: this._keyId(moving.tonic, moving.mode),
    });
    this._meshPivotPitch = this._pitchKey(pivot.ch);
  };

  SpatialMap.prototype._cogContactForChord = function (ch) {
    const contacts = this._meshContacts || [];
    if (!ch || !contacts.length) return null;
    const root = this._chordRootPc(ch);
    const pk = this._pitchKey(ch);
    for (let i = 0; i < contacts.length; i++) {
      const c = contacts[i];
      if (c.root === root) return c;
      if (pk && c.pitchKey && pk === c.pitchKey) return c;
    }
    return null;
  };

  SpatialMap.prototype._firstPathIndexForDisk = function (disk) {
    const path = this.path || [];
    for (let i = 0; i < path.length; i++) {
      const d = this._diskForChord(path[i]);
      if (
        d &&
        d.tonic === disk.tonic &&
        (d.mode || '') === (disk.mode || '')
      ) {
        return i;
      }
    }
    return 1e9;
  };

  SpatialMap.prototype._placeJourneyCogs = function (R) {
    this._meshPivotPitch = null;
    this._meshContacts = [];
    const home =
      (this.disks || []).find((d) => d.active) || (this.disks && this.disks[0]);
    if (!home) return;
    home.cx = 0;
    home.cy = 0;
    home.R = R;
    home.rot = 0;
    home.meshed = true;
    const others = (this.disks || []).filter((d) => !d.active);
    if (!others.length) return;
    others.sort(
      (a, b) => this._firstPathIndexForDisk(a) - this._firstPathIndexForDisk(b)
    );
    const placed = [home];
    let extra = 0;
    others.forEach((disk) => {
      let best = null;
      let bestAnchor = null;
      let bestScore = -1;
      placed.forEach((anchor) => {
        const p = this._findMeshPivot(anchor, disk);
        const s = p && p.score != null ? p.score : -1;
        if (s > bestScore) {
          best = p;
          bestAnchor = anchor;
          bestScore = s;
        }
      });
      if (best && bestAnchor) this._meshDiskAtPivot(bestAnchor, disk, best, R);
      else {
        this._placeDiskByFifths(home, disk, extra, R);
        extra += 1;
      }
      placed.push(disk);
    });
  };

  /**
   * Same named pitches on two rims (or a same-disk revisit) = one node.
   * Visit numbers stack (2 · 4). Function view keeps offset stacking.
   */
  SpatialMap.prototype._stackVisitNodes = function () {
    if (this.mapView === 'function') return;
    const nodes = this.nodes || [];
    if (nodes.length < 2) {
      nodes.forEach((n) => {
        if (!n) return;
        n.visits = [n.i + 1];
        n.visitIndices = [n.i];
        n.drawBody = true;
        n.sharedPivot = false;
      });
      return;
    }
    const groups = new Map();
    nodes.forEach((n) => {
      if (!n) return;
      const cog = this._cogContactForChord(n.chord);
      const key = cog
        ? 'cog:' + cog.root
        : this._visitSeatKey(n.chord) || 'n' + n.i;
      if (cog) {
        n.x = cog.x;
        n.y = cog.y;
      }
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(n);
    });
    groups.forEach((group) => {
      const visits = group.map((n) => n.i + 1);
      const visitIndices = group.map((n) => n.i);
      const x = group[0].x;
      const y = group[0].y;
      let rep =
        group.find((n) => n.i === this.current) ||
        group.find((n) => n.i === this.playing) ||
        group[group.length - 1];
      group.forEach((n) => {
        n.x = x;
        n.y = y;
        n.visits = visits;
        n.visitIndices = visitIndices;
        n.drawBody = n === rep;
        n.sharedPivot = group.length > 1;
      });
    });
  };

  SpatialMap.prototype._ghostsWanted = function () {
    if (this.mapView !== 'chase') return false;
    if (this.cameraMode === 'follow') return true;
    if (this._forceGhostHalo) return true;
    if (this._mode === 'node') return true;
    return !!this._ghostsVisible;
  };

  SpatialMap.prototype.ensureGhostHalo = function (opts) {
    opts = opts || {};
    if (this.mapView !== 'chase') return;
    const idx = opts.pivotIndex;
    const same =
      this._ghostsVisible &&
      (idx == null || idx === this._ghostPivotIndex) &&
      this.ghostDisks &&
      this.ghostDisks.length;
    this._ghostsVisible = true;
    if (idx != null) this._ghostPivotIndex = idx;
    if (same && !opts.force) return;
    this._rebuildGhostHalo();
  };

  SpatialMap.prototype.hideGhostHalo = function () {
    if (this._mode === 'node') return;
    if (this._forceGhostHalo) return;
    this._ghostsVisible = false;
    this._ghostPivotIndex = null;
    this.ghostDisks = [];
    this.ghostOptions = [];
  };

  SpatialMap.prototype._syncGhostHalo = function (opts) {
    opts = opts || {};
    if (!this._ghostsWanted()) {
      if (!this._ghostsVisible) {
        this.ghostDisks = [];
        this.ghostOptions = [];
      }
      return;
    }
    if (
      this._mode === 'node' &&
      !opts.force &&
      this.ghostDisks &&
      this.ghostDisks.length
    ) {
      return;
    }
    this._rebuildGhostHalo();
  };

  /**
   * Chase halo: adjacent keys around the pivot (hovered / aimed path step).
   * Off by default — ensureGhostHalo on hover / aim / leave-home.
   * Never throw — a failure must not freeze path/timeline updates.
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

      const forced = this._ghostPivotIndex;
      const idx =
        forced != null && forced >= 0 && forced < this.path.length
          ? forced
          : this.current >= 0 && this.current < this.path.length
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

  SpatialMap.prototype._functionHouseRank = function (n) {
    const r = String((n && n.roman) || '');
    if (/^(I|i)$/.test(r)) return 0;
    if (/^(IV|iv)$/.test(r)) return 0;
    if (/^V7?$/.test(r) || (n && n.role === 'dominant')) return 0;
    if (n && n.onPath) return 1;
    if (n && n.role === 'diatonic') return 2;
    if (n && (n.role === 'colour' || n.role === 'interchange')) return 3;
    return 4;
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

  SpatialMap.prototype._atlasMode = function () {
    if (this.mapView !== 'function') return null;
    if (this.functionAtlas === 'lattice') return 'lattice';
    if (this.functionAtlas === 'houses') return 'houses';
    return 'wheel';
  };

  SpatialMap.prototype._copyFunctionSrc = function (src, extra) {
    extra = extra || {};
    return {
      id: src.id,
      chord: src.chord,
      role: src.role || 'diatonic',
      label: src.label || (src.chord && src.chord.name) || '',
      roman: src.roman || '',
      gate: !!src.gate,
      house: src.house === 'colour' || src.house === 'pull' ? src.house : 'home',
      resolvesToId: src.resolvesToId || null,
      routeTargetId: src.routeTargetId || null,
      canOrbitPeers: !!src.canOrbitPeers,
      onPath: !!src.onPath,
      colourTag: src.colourTag || '',
      dimTag: src.dimTag || '',
      valtTag: src.valtTag || '',
      lamp: !!extra.lamp,
      shared: extra.shared != null ? extra.shared : 0,
      x: extra.x,
      y: extra.y,
      r: extra.r,
    };
  };

  /** In this key: wheel (default write clock), lattice, or houses. */
  SpatialMap.prototype._layoutFunctionChart = function () {
    const chart = this.functionChart;
    this.functionNodes = [];
    if (!chart || !chart.nodes || !chart.nodes.length) return;
    const mode = this._atlasMode();
    if (mode === 'lattice') {
      this._layoutFunctionLattice();
      return;
    }
    if (mode === 'houses') {
      this._layoutFunctionHouses();
      return;
    }
    this._layoutFunctionWheel();
  };

  /** Same clock as Journey — the everyday write atlas. */
  SpatialMap.prototype._layoutFunctionWheel = function () {
    const M = global.HLMusic;
    const chart = this.functionChart;
    const disk = this._activeDisk();
    const t = chart.tonic != null ? chart.tonic : this.origin.tonic;
    const mode = chart.mode || this.origin.mode;
    const cx = disk.cx || 0;
    const cy = disk.cy || 0;
    const R = disk.R || 120;
    const SEAT_R = R * SEAT.scale;
    const TONIC_R = R * SEAT.tonic;
    const BORROW_R = R * SEAT.shell;
    const V7_R = R * SEAT.v7;
    const scaleSeats =
      M && M.circularHarmonicScale ? M.circularHarmonicScale(t, mode) : [];
    const seatByRoot = {};
    scaleSeats.forEach((s) => {
      seatByRoot[s.root] = s;
    });
    const byId = {};
    chart.nodes.forEach((n) => {
      byId[n.id] = n;
    });
    const targetAngle = (resolvesToId, fallbackRoot) => {
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
    const self = this;
    chart.nodes.forEach((n) => {
      const ch = n.chord;
      if (!ch) return;
      let x;
      let y;
      if (n.role === 'interchange') {
        const seat = seatByRoot[ch.root];
        const ang = seat
          ? seat.angle
          : -Math.PI / 2 + ((ch.root || 0) / 12) * Math.PI * 2;
        x = cx + Math.cos(ang) * BORROW_R;
        y = cy + Math.sin(ang) * BORROW_R * SEAT.squash;
      } else if (
        (n.role === 'secondary' || n.role === 'dominant') &&
        n.resolvesToId
      ) {
        const ang = targetAngle(n.resolvesToId, ch.root) + 0.52;
        x = cx + Math.cos(ang) * V7_R;
        y = cy + Math.sin(ang) * V7_R * SEAT.squash;
      } else if (n.role === 'secondaryii' && n.resolvesToId) {
        const ang = targetAngle(n.routeTargetId || n.resolvesToId, ch.root) - 0.48;
        x = cx + Math.cos(ang) * V7_R * 0.86;
        y = cy + Math.sin(ang) * V7_R * 0.86 * SEAT.squash;
      } else if (n.role === 'tritone') {
        const ang = targetAngle(n.resolvesToId, ch.root) + 0.92;
        x = cx + Math.cos(ang) * BORROW_R * 0.92;
        y = cy + Math.sin(ang) * BORROW_R * 0.92 * SEAT.squash;
      } else if (n.role === 'diminished') {
        const tag = String(n.dimTag || n.roman || '');
        let angOff = -0.55;
        let rr = R;
        if (/common-tone|I°|i°/i.test(tag)) {
          angOff = 0.2;
          rr = TONIC_R * 1.55;
        } else if (/V7b9|as V7/i.test(tag)) {
          angOff = 0.75;
          rr = V7_R * 1.05;
        }
        const ang = targetAngle(n.resolvesToId, ch.root) + angOff;
        x = cx + Math.cos(ang) * rr;
        y = cy + Math.sin(ang) * rr * SEAT.squash;
      } else if (n.role === 'valt') {
        const vSeat = scaleSeats.find((s) => s.role === 'dom');
        const baseAng = vSeat ? vSeat.angle : targetAngle(n.resolvesToId, ch.root);
        const tag = String(n.valtTag || n.roman || n.label || '');
        let angOff = 0.35;
        let rr = V7_R * 1.08;
        if (/backdoor|♭VII/i.test(tag)) {
          angOff = 1.1;
          rr = BORROW_R * 0.88;
        }
        const ang = baseAng + angOff;
        x = cx + Math.cos(ang) * rr;
        y = cy + Math.sin(ang) * rr * SEAT.squash;
      } else if (n.role === 'colour') {
        const hostRoot = n.colourHostRoot != null ? n.colourHostRoot : ch.root;
        const seat = seatByRoot[hostRoot] || seatByRoot[ch.root];
        const tag = String(n.colourTag || n.roman || '');
        let angOff = 0.38;
        if (/II|bright/i.test(tag)) angOff = 0.55;
        else if (/sus/i.test(tag)) angOff = -0.42;
        else if (/7|dorian/i.test(tag)) angOff = 0.28;
        if (seat) {
          const ang = seat.angle + angOff;
          x = cx + Math.cos(ang) * R * 0.88;
          y = cy + Math.sin(ang) * R * 0.88 * SEAT.squash;
        } else if (M && M.chaseChordPos) {
          const base = M.chaseChordPos(ch, t, mode, { cx: cx, cy: cy, R: R });
          x = base.x * 1.08;
          y = base.y * 1.08;
        } else {
          x = cx;
          y = cy;
        }
      } else {
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
      self.functionNodes.push(
        self._copyFunctionSrc(n, {
          x: x,
          y: y,
          r: rByRole[n.role] != null ? rByRole[n.role] : 14,
        })
      );
    });
  };

  SpatialMap.prototype._layoutFunctionHouses = function () {
    const chart = this.functionChart;
    const disk = this._activeDisk();
    const R = disk.R || 120;
    const colX = { home: -R * 1.58, colour: 0, pull: R * 1.58 };
    const bandH = R * 2.4;
    const buckets = { home: [], colour: [], pull: [] };
    chart.nodes.forEach((n) => {
      if (!n || !n.chord) return;
      const house = n.house === 'colour' || n.house === 'pull' ? n.house : 'home';
      buckets[house].push(n);
    });
    const self = this;
    ['home', 'colour', 'pull'].forEach((hid) => {
      const list = buckets[hid]
        .slice()
        .sort((a, b) => self._functionHouseRank(a) - self._functionHouseRank(b));
      const n = list.length;
      const gap = n <= 1 ? 0 : Math.min(44, (bandH - 36) / Math.max(1, n - 1));
      const startY = -((n - 1) * gap) / 2;
      list.forEach((src, i) => {
        const rank = self._functionHouseRank(src);
        const wobble = n > 3 ? (i % 2 === 0 ? -1 : 1) * Math.min(16, R * 0.09) : 0;
        self.functionNodes.push(
          self._copyFunctionSrc(src, {
            x: colX[hid] + wobble,
            y: startY + i * gap,
            r: rank === 0 ? 16 : src.role === 'diatonic' ? 14 : 12,
          })
        );
        self.functionNodes[self.functionNodes.length - 1].house = hid;
      });
    });
  };

  /** Major / minor only — Tonnetz triangles. 7ths sit on the parent triad. */
  SpatialMap.prototype._tonnetzMode = function (ch) {
    const q = String((ch && ch.quality) || '');
    if (/halfdim|ø|dim7|^dim/.test(q)) return null;
    if (/^min|min7|min9|minmaj|^m7|^m9/.test(q) || q === 'min') return 'min';
    if (/aug/.test(q)) return null;
    if (/sus|dom7|maj|add9|^7$/.test(q) || q === 'maj' || !q) return 'maj';
    if (/min/.test(q)) return 'min';
    return 'maj';
  };

  /**
   * Lattice coords: i = fifths, j = major thirds.
   * pc(i,j) = originPc + 7i + 4j.
   * Major triangle at root (i,j): (i,j) (i,j+1) (i+1,j).
   * Minor triangle at root (i,j): (i,j) (i+1,j) (i+1,j-1).
   */
  SpatialMap.prototype._tonnetzPc = function (i, j, originPc) {
    return (((7 * i + 4 * j + originPc) % 12) + 12) % 12;
  };

  SpatialMap.prototype._tonnetzXY = function (i, j, cell) {
    const w = cell || 56;
    return { x: (i + j * 0.5) * w, y: -j * w * 0.86 };
  };

  SpatialMap.prototype._tonnetzTriCells = function (i, j, mode) {
    if (mode === 'min') {
      return [
        { i: i, j: j },
        { i: i + 1, j: j },
        { i: i + 1, j: j - 1 },
      ];
    }
    return [
      { i: i, j: j },
      { i: i, j: j + 1 },
      { i: i + 1, j: j },
    ];
  };

  SpatialMap.prototype._plrOf = function (root, mode) {
    const r = ((Number(root) % 12) + 12) % 12;
    if (mode === 'min') {
      return {
        P: { root: r, mode: 'maj' },
        R: { root: (r + 3) % 12, mode: 'maj' },
        L: { root: (r + 8) % 12, mode: 'maj' },
      };
    }
    return {
      P: { root: r, mode: 'min' },
      R: { root: (r + 9) % 12, mode: 'min' },
      L: { root: (r + 4) % 12, mode: 'min' },
    };
  };

  /** Tonnetz fragment: pitch vertices + triad triangles + P/L/R around the lamp. */
  SpatialMap.prototype._layoutFunctionLattice = function () {
    const chart = this.functionChart;
    const disk = this._activeDisk();
    const cell = Math.max(48, (disk.R || 120) * 0.48);
    const srcs = (chart.nodes || []).filter((n) => n && n.chord);
    this.tonnetz = { verts: [], originPc: 0, cell: cell };
    if (!srcs.length) return;
    const pathCh =
      this.path && this.path.length
        ? this.path[
            this.current >= 0 && this.current < this.path.length
              ? this.current
              : this.path.length - 1
          ]
        : null;
    // Stay pinned to write-home so writing does not lurch the grid.
    const homeMode =
      this.origin &&
      (this.origin.mode === 'minor' ||
        (String(this.origin.mode || '').indexOf('min') === 0))
        ? 'min'
        : 'maj';
    const originPc =
      this.origin && this.origin.tonic != null
        ? ((Number(this.origin.tonic) % 12) + 12) % 12
        : 0;
    let pivot =
      srcs.find((n) => /^(I|i)$/.test(String(n.roman || ''))) ||
      srcs.find(
        (n) =>
          n.chord &&
          ((n.chord.root % 12) + 12) % 12 === originPc &&
          this._tonnetzMode(n.chord) === homeMode
      ) ||
      srcs[0];
    const pMode = this._tonnetzMode(pivot.chord) || homeMode;
    this.tonnetz.originPc = originPc;
    this.tonnetz.cell = cell;

    const keyOf = (i, j) => i + ',' + j;
    const vertMap = {};
    const ensureVert = (i, j) => {
      const k = keyOf(i, j);
      if (vertMap[k]) return vertMap[k];
      const p = this._tonnetzXY(i, j, cell);
      const v = {
        i: i,
        j: j,
        pc: this._tonnetzPc(i, j, originPc),
        x: p.x,
        y: p.y,
      };
      vertMap[k] = v;
      return v;
    };

    const placed = {};
    const placedSeat = {};
    const placeTri = (src, i, j, mode, plr, lamp) => {
      const id = src.id;
      if (placed[id]) return placed[id];
      const seat = mode + ':' + ((Number(src.chord.root) % 12) + 12) % 12;
      if (placedSeat[seat] && !lamp) return placedSeat[seat];
      const cells = this._tonnetzTriCells(i, j, mode);
      const verts = cells.map((c) => ensureVert(c.i, c.j));
      const x = (verts[0].x + verts[1].x + verts[2].x) / 3;
      const y = (verts[0].y + verts[1].y + verts[2].y) / 3;
      const node = this._copyFunctionSrc(src, {
        lamp: !!lamp,
        x: x,
        y: y,
        r: 22,
        shared: lamp ? 3 : 2,
      });
      node.plr = plr || '';
      node.tonnetz = true;
      node.tri = verts;
      this.functionNodes.push(node);
      placed[id] = node;
      placedSeat[seat] = node;
      return node;
    };

    // Write-home triangle stays at the origin cell (not the selected step)
    placeTri(pivot, 0, 0, pMode, '', false);

    const plr = this._plrOf(originPc, pMode);
    const plrCell = {
      P: pMode === 'min' ? { i: 0, j: 0, mode: 'maj' } : { i: 0, j: 0, mode: 'min' },
      // minor at (0,0): P is major on same root → major tri (0,0)
      // major at (0,0): P is minor on same root → minor tri (0,0) — same cells? 
      // major (0,0): (0,0)(0,1)(1,0). minor same root: (0,0)(1,0)(1,-1). Adjacent.
      R:
        pMode === 'min'
          ? { i: 1, j: -1, mode: 'maj' }
          : { i: 0, j: 1, mode: 'min' },
      L:
        pMode === 'min'
          ? { i: 0, j: -1, mode: 'maj' }
          : { i: 0, j: 0, mode: 'min' },
    };
    if (pMode === 'maj') {
      plrCell.P = { i: 0, j: 0, mode: 'min' };
      plrCell.R = { i: 0, j: 1, mode: 'min' };
      plrCell.L = { i: 1, j: 0, mode: 'min' };
    } else {
      plrCell.P = { i: 0, j: 0, mode: 'maj' };
      plrCell.R = { i: 1, j: -1, mode: 'maj' };
      plrCell.L = { i: 0, j: -1, mode: 'maj' };
    }

    const findSrc = (root, mode) => {
      const want = mode === 'min' ? /min/ : /maj|dom7|add9|sus|^$/;
      return (
        srcs.find(
          (n) =>
            n.id !== pivot.id &&
            ((n.chord.root % 12) + 12) % 12 === root &&
            this._tonnetzMode(n.chord) === mode
        ) ||
        srcs.find(
          (n) =>
            n.id !== pivot.id &&
            ((n.chord.root % 12) + 12) % 12 === root &&
            want.test(String(n.chord.quality || ''))
        )
      );
    };

    const M = global.HLMusic;
    const fakeSrc = (root, mode, plrName) => {
      const q = mode === 'min' ? 'min' : 'maj';
      const nm =
        M && M.noteName ? M.noteName(root) + (mode === 'min' ? 'm' : '') : plrName;
      const ch = M && M.makeChord
        ? M.makeChord(root, q, { region: 'diatonic' })
        : { root: root, quality: q, name: nm, notes: [] };
      return {
        id: 'plr:' + plrName + ':' + root + ':' + q,
        chord: ch,
        role: 'diatonic',
        label: ch.name || nm,
        roman: ch.roman || nm,
        house: 'home',
        onPath: false,
      };
    };

    ['P', 'L', 'R'].forEach((name) => {
      const spec = plr[name];
      const cellSpec = plrCell[name];
      const src =
        findSrc(spec.root, spec.mode) || fakeSrc(spec.root, spec.mode, name);
      placeTri(src, cellSpec.i, cellSpec.j, cellSpec.mode, name, false);
    });

    // Other in-key triads that land on a nearby cell
    srcs.forEach((src) => {
      if (placed[src.id]) return;
      const mode = this._tonnetzMode(src.chord);
      if (!mode) return;
      const root = ((Number(src.chord.root) % 12) + 12) % 12;
      let found = null;
      for (let i = -3; i <= 3 && !found; i++) {
        for (let j = -3; j <= 3 && !found; j++) {
          if (this._tonnetzPc(i, j, originPc) !== root) continue;
          if (Math.abs(i) + Math.abs(j) > 4) continue;
          found = { i: i, j: j };
        }
      }
      if (found) placeTri(src, found.i, found.j, mode, '', false);
    });

    const lampCh = pathCh || (pivot && pivot.chord);
    if (lampCh) {
      const lampNode =
        this.functionNodes.find(
          (n) =>
            n.chord &&
            n.chord.root === lampCh.root &&
            n.chord.quality === lampCh.quality
        ) ||
        this.functionNodes.find((n) => n.chord && n.chord.root === lampCh.root);
      this.functionNodes.forEach((n) => {
        n.lamp = !!(lampNode && n === lampNode);
      });
      if (lampNode) {
        const plrHere = this._plrOf(lampCh.root, this._tonnetzMode(lampCh) || pMode);
        this.functionNodes.forEach((n) => {
          if (n === lampNode) return;
          n.plr = '';
          if (!n.chord) return;
          const root = ((n.chord.root % 12) + 12) % 12;
          const mode = this._tonnetzMode(n.chord);
          if (plrHere.P.root === root && mode === plrHere.P.mode) n.plr = 'P';
          if (plrHere.R.root === root && mode === plrHere.R.mode) n.plr = 'R';
          if (plrHere.L.root === root && mode === plrHere.L.mode) n.plr = 'L';
        });
      }
    }

    const verts = [];
    Object.keys(vertMap).forEach((k) => verts.push(vertMap[k]));
    const homeN =
      this.functionNodes.find((n) => n.chord && n.chord.root === originPc) ||
      this.functionNodes[0];
    if (homeN) {
      const dx = homeN.x;
      const dy = homeN.y;
      verts.forEach((v) => {
        v.x -= dx;
        v.y -= dy;
      });
      this.functionNodes.forEach((n) => {
        n.x -= dx;
        n.y -= dy;
      });
    }
    this.tonnetz.verts = verts;
  };

  /** Path sits on the house seat; revisits stack down, not around a wheel. */

  SpatialMap.prototype._chordPos = function (ch, index, lane, stackPath) {
    const M = global.HLMusic;
    if (!M || !M.chaseChordPos) {
      const R = Math.min(this.w || 500, this.h || 360) * 0.34;
      const ang = ((ch.root || 0) / 12) * Math.PI * 2 - Math.PI / 2;
      return { x: Math.cos(ang) * R * 0.7, y: Math.sin(ang) * R * 0.6, onScale: true };
    }
    const disk = this._diskForChord(ch);
    const pos = this._seatPosOnDisk(ch, disk);
    if (lane === 1) {
      // Compare path slightly outward on same seat
      const ang = Math.atan2(pos.y - disk.cy, pos.x - disk.cx);
      pos.x += Math.cos(ang) * 12;
      pos.y += Math.sin(ang) * 10;
    }
    // Journey revisits share one node (_stackVisitNodes). Function still offsets.
    const peers = stackPath || this.path;
    if (this.mapView === 'function' && index > 0 && peers) {
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
    const ang = hit.seat.angle + (disk.rot || 0);
    let x = cx + Math.cos(ang) * rad;
    let y = cy + Math.sin(ang) * rad * SEAT.squash;
    // Function view still offsets revisits. Journey stacks numbers on one node.
    if (this.mapView === 'function') {
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
      // Journey: sit on the owning disk (mesh + visit stack handle shared seats)
      if (!pos && ch && this.mapView !== 'function') {
        pos = this._seatPosOnDisk(ch, this._diskForChord(ch));
      }
      // Function: write-home seat math, then generic fallback
      if (!pos && ch && this._pathShouldUseActiveWheel(ch)) {
        pos = this._activeSeatPos(ch, i, this.path);
      }
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
    // Never soft-separate path off seats — that made Chase ≠ Function
    this._stackVisitNodes();
    this._layoutAltPath();
    this._computeDivergent();
    this._rebuildScaleSeats();
    this._syncGhostHalo();
    if (this._refreshFocusOptions) this._refreshFocusOptions();
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
    return {
      x: fn.x + (stack ? 7 : 0),
      y: fn.y + stack * 9,
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
    const frame = this._cinematicFrame(this.cameraMode);
    if (!frame) {
      this.camera.tx = 0;
      this.camera.ty = 0;
      this.camera.tz = keepZ;
      return;
    }
    if (this.cameraMode === 'home') {
      if (!this._userPanned || this._forceHomeCenter) {
        this.camera.tx = frame.tx;
        this.camera.ty = frame.ty;
        this._forceHomeCenter = false;
      }
      this.camera.tz = frame.tz;
      return;
    }
    this.camera.tx = frame.tx;
    this.camera.ty = frame.ty;
    this.camera.tz = frame.tz;
  };

  SpatialMap.prototype._partnerDisk = function (focus) {
    const disks = this.disks || [];
    for (let i = 0; i < disks.length; i++) {
      const d = disks[i];
      if (d && !this._sameDiskRef(d, focus)) return d;
    }
    return null;
  };

  /**
   * Close cinematic shot: the focus wheel fills the stage.
   * The adjacent cog may clip — better than a tiny pair in the middle.
   * home = write-home large; follow = sounding wheel/node; fit = a little more pair.
   */
  SpatialMap.prototype._cinematicFrame = function (mode) {
    mode = mode || this.cameraMode || 'home';
    const home = this._activeDisk && this._activeDisk();
    if (!home) return null;
    let focus = home;
    let peek = 0.14;
    if (mode === 'follow') {
      const i = this.playing >= 0 ? this.playing : this.current;
      const ch = this.path && i >= 0 ? this.path[i] : null;
      if (ch) focus = this._diskForChord(ch) || home;
      peek = 0.07;
    } else if (mode === 'fit') {
      peek = 0.3;
    }
    const other =
      this.mapView === 'function' ? null : this._partnerDisk(focus);
    const fx = focus.cx || 0;
    const fy = focus.cy || 0;
    const ox = other ? other.cx || 0 : fx;
    const oy = other ? other.cy || 0 : fy;
    let tx = fx * (1 - peek) + ox * peek;
    let ty = fy * (1 - peek) + oy * peek;
    if (mode === 'follow' && this.nodes && this.nodes.length) {
      const i = this.playing >= 0 ? this.playing : this.current;
      const n =
        i >= 0 && this.nodes[i]
          ? this.nodes[i]
          : this.nodes[this.nodes.length - 1];
      if (n) {
        tx = n.x * 0.78 + fx * 0.22;
        ty = n.y * 0.78 + fy * 0.22;
      }
    }
    const R = focus.R || Math.min(this.w || 500, this.h || 360) * 0.38;
    const view = Math.min(this.w || 500, this.h || 360);
    let tz = (view * 0.42) / Math.max(R, 40);
    if (mode === 'fit') tz *= 0.88;
    if (mode === 'follow') tz *= 1.28;
    tz = Math.min(1.62, Math.max(0.82, tz));
    return { tx: tx, ty: ty, tz: tz };
  };

  SpatialMap.prototype._uprightRotForDisk = function (disk) {
    if (!disk) return 0;
    let a = -(disk.rot || 0);
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  };

  SpatialMap.prototype._sameDiskRef = function (a, b) {
    if (!a || !b) return false;
    return a.tonic === b.tonic && (a.mode || '') === (b.mode || '');
  };

  SpatialMap.prototype._stepDurationMs = function (ch) {
    const beats = (ch && ch.duration) || 4;
    let bpm = 100;
    try {
      const st = typeof global.HLApp !== 'undefined' && global.HLApp.state;
      if (st && st.bpm > 0) bpm = st.bpm;
    } catch (_) {}
    return Math.max(180, beats * (60000 / Math.max(30, bpm)));
  };

  SpatialMap.prototype._stepBeats = function (ch) {
    const n = ch && ch.duration != null ? Number(ch.duration) : 4;
    return n > 0 ? n : 4;
  };

  /** Consecutive path steps on the same disk, with beat spans. */
  SpatialMap.prototype._keyRuns = function () {
    const path = this.path || [];
    const runs = [];
    let beat0 = 0;
    for (let i = 0; i < path.length; i++) {
      const disk = this._diskForChord(path[i]);
      const beats = this._stepBeats(path[i]);
      const last = runs[runs.length - 1];
      if (last && this._sameDiskRef(last.disk, disk)) {
        last.end = i;
        last.beats += beats;
      } else {
        runs.push({
          start: i,
          end: i,
          disk: disk,
          beats: beats,
          beat0: beat0,
        });
      }
      beat0 += beats;
    }
    return runs;
  };

  SpatialMap.prototype._isLooping = function () {
    try {
      return !!(
        typeof global.HLApp !== 'undefined' &&
        global.HLApp.state &&
        global.HLApp.state.loop &&
        this.path &&
        this.path.length > 1
      );
    } catch (_) {
      return false;
    }
  };

  SpatialMap.prototype._lerpAngle = function (a, b, t) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    return a + d * t;
  };

  /**
   * Beats from the start of the path to the current playhead
   * (elapsed fraction of the sounding step).
   */
  SpatialMap.prototype._playheadBeats = function () {
    const path = this.path || [];
    if (!path.length) return 0;
    let i = this.playing;
    if (i == null || i < 0) {
      i = this.current >= 0 ? this.current : 0;
    }
    if (i >= path.length) i = path.length - 1;
    let beats = 0;
    for (let k = 0; k < i; k++) beats += this._stepBeats(path[k]);
    if (this.playing == null || this.playing < 0) return beats;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const ms = this._playStepMs || this._stepDurationMs(path[i]);
    let u = ms > 0 ? (now - (this._playStepAt || now)) / ms : 0;
    if (u < 0) u = 0;
    if (u > 1) u = 1;
    return beats + this._stepBeats(path[i]) * u;
  };

  /** Rotation when we *arrive* at run idx — matches the previous run’s end. */
  SpatialMap.prototype._runArriveRot = function (runs, idx, looping) {
    if (!runs || !runs.length) return 0;
    const n = runs.length;
    const i = ((idx % n) + n) % n;
    const run = runs[i];
    const prevI = i > 0 ? i - 1 : looping ? n - 1 : -1;
    if (prevI < 0) return this._uprightRotForDisk(run.disk);
    const prev = runs[prevI];
    if (this._sameDiskRef(prev.disk, run.disk)) {
      return this._uprightRotForDisk(run.disk);
    }
    return this._lerpAngle(
      this._uprightRotForDisk(prev.disk),
      this._uprightRotForDisk(run.disk),
      0.055
    );
  };

  /**
   * Continuous lean across key changes. Never snaps to the new wheel’s upright.
   */
  SpatialMap.prototype._rotationAtBeats = function (beats) {
    if (this.mapView === 'function') return 0;
    const runs = this._keyRuns();
    if (!runs.length) return 0;
    const looping = this._isLooping();
    const total = runs[runs.length - 1].beat0 + runs[runs.length - 1].beats;
    let head = beats;
    if (looping && total > 0) {
      head = ((head % total) + total) % total;
    }
    let idx = runs.length - 1;
    for (let i = 0; i < runs.length; i++) {
      const r = runs[i];
      if (head >= r.beat0 && head < r.beat0 + r.beats) {
        idx = i;
        break;
      }
    }
    const run = runs[idx];
    const nextI = idx < runs.length - 1 ? idx + 1 : looping ? 0 : -1;
    const from = this._runArriveRot(runs, idx, looping);
    const to =
      nextI >= 0 ? this._runArriveRot(runs, nextI, looping) : from;
    const span = run.beats > 0 ? run.beats : 1;
    const u = (head - run.beat0) / span;
    return this._lerpAngle(from, to, u);
  };

  SpatialMap.prototype._focusRunState = function () {
    const runs = this._keyRuns();
    if (!runs.length) return null;
    const looping = this._isLooping();
    const playing = this.playing != null && this.playing >= 0;
    let head = 0;
    if (playing) head = this._playheadBeats();
    else {
      const i =
        this.current >= 0 && this.current < (this.path || []).length
          ? this.current
          : 0;
      for (let k = 0; k < i; k++) head += this._stepBeats((this.path || [])[k]);
    }
    const total = runs[runs.length - 1].beat0 + runs[runs.length - 1].beats;
    if (playing && looping && total > 0) {
      head = ((head % total) + total) % total;
    }
    let run = runs[runs.length - 1];
    for (let i = 0; i < runs.length; i++) {
      const r = runs[i];
      if (head >= r.beat0 && head < r.beat0 + r.beats) {
        run = r;
        break;
      }
    }
    const idx = runs.indexOf(run);
    const next = idx < runs.length - 1 ? runs[idx + 1] : looping ? runs[0] : null;
    const span = run.beats > 0 ? run.beats : 1;
    const u = playing ? (head - run.beat0) / span : 0;
    const nxt =
      next && !this._sameDiskRef(run.disk, next.disk) ? next.disk : null;
    return { run: run, next: next, u: u, here: run.disk, nxt: nxt };
  };

  SpatialMap.prototype._focusFadeT = function () {
    const st = this._focusRunState();
    if (!st || !st.nxt) return 0;
    let t = st.u;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    return t * t * (3 - 2 * t);
  };

  SpatialMap.prototype._meshContactBetween = function (a, b) {
    if (!a || !b) return null;
    const idA = this._keyId(a.tonic, a.mode);
    const idB = this._keyId(b.tonic, b.mode);
    const list = this._meshContacts || [];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if ((c.a === idA && c.b === idB) || (c.a === idB && c.b === idA)) {
        return { x: c.x, y: c.y };
      }
    }
    return {
      x: ((a.cx || 0) + (b.cx || 0)) / 2,
      y: ((a.cy || 0) + (b.cy || 0)) / 2,
    };
  };

  SpatialMap.prototype._pathLookNow = function () {
    const nodes = this.nodes || [];
    if (!nodes.length) return { x: 0, y: 0 };
    let i = this.playing;
    if (i == null || i < 0) i = this.current;
    if (i == null || i < 0) i = 0;
    if (i >= nodes.length) i = nodes.length - 1;
    const a = nodes[i];
    if (!a) return { x: 0, y: 0 };
    let j = i + 1;
    if (j >= nodes.length) j = this._isLooping() ? 0 : i;
    const b = nodes[j] || a;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const ms = this._playStepMs || this._stepDurationMs((this.path || [])[i]);
    let u = 0;
    if (this.playing >= 0 && ms > 0) {
      u = (now - (this._playStepAt || now)) / ms;
    }
    if (u < 0) u = 0;
    if (u > 1) u = 1;
    u = u * u * (3 - 2 * u);
    const diskA = this._diskForChord((this.path || [])[i] || a.chord) || this._activeDisk();
    const diskB = this._diskForChord((this.path || [])[j] || b.chord) || diskA;
    const soft = (n, disk) => ({
      x: n.x * 0.28 + ((disk && disk.cx) || 0) * 0.72,
      y: n.y * 0.28 + ((disk && disk.cy) || 0) * 0.72,
    });
    const from = soft(a, diskA);
    const to = soft(b, diskB);
    return {
      x: from.x + (to.x - from.x) * u,
      y: from.y + (to.y - from.y) * u,
    };
  };

  /** Lamp: path look → pivot tooth → next-run look. Continuous at both ends. */
  SpatialMap.prototype._focusLampWorld = function () {
    const pathLook = this._pathLookNow();
    const st = this._focusRunState();
    const t = this._focusFadeT();
    if (!st || !st.nxt || t <= 0) return pathLook;
    const here = { x: st.here.cx || 0, y: st.here.cy || 0 };
    const nxt = { x: st.nxt.cx || 0, y: st.nxt.cy || 0 };
    const tooth = this._meshContactBetween(st.here, st.nxt) || {
      x: (here.x + nxt.x) / 2,
      y: (here.y + nxt.y) / 2,
    };
    let dest = nxt;
    if (st.next && this.nodes && this.nodes[st.next.start]) {
      const n = this.nodes[st.next.start];
      dest = {
        x: n.x * 0.28 + nxt.x * 0.72,
        y: n.y * 0.28 + nxt.y * 0.72,
      };
    }
    if (t < 0.4) {
      const u = t / 0.4;
      return {
        x: pathLook.x + (tooth.x - pathLook.x) * u,
        y: pathLook.y + (tooth.y - pathLook.y) * u,
      };
    }
    if (t < 0.62) return tooth;
    const u = (t - 0.62) / 0.38;
    return {
      x: tooth.x + (dest.x - tooth.x) * u,
      y: tooth.y + (dest.y - tooth.y) * u,
    };
  };

  /** Fog title: the sounding path step only. Never the next-key preview. */
  SpatialMap.prototype._focusSoundingName = function () {
    const i = this.playing >= 0 ? this.playing : this.current;
    if (i == null || i < 0) return '';
    const ch = this.path && this.path[i];
    if (ch && ch.name) return ch.name;
    const node = this.nodes && this.nodes[i];
    return (node && node.chord && node.chord.name) || '';
  };

  SpatialMap.prototype._worldToScreen = function (wx, wy, w, h) {
    const z = this.camera.zoom || 1;
    const rot = this.camera.rot || 0;
    const dx = (wx || 0) - (this.camera.x || 0);
    const dy = (wy || 0) - (this.camera.y || 0);
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    return {
      x: w / 2 + (dx * c - dy * s) * z,
      y: h / 2 + (dx * s + dy * c) * z,
    };
  };

  SpatialMap.prototype._focusNamePockets = function (w, h) {
    return [
      { x: w * 0.07, y: h * 0.78, align: 'left' },
      { x: w * 0.93, y: h * 0.78, align: 'right' },
      { x: w * 0.07, y: h * 0.22, align: 'left' },
      { x: w * 0.08, y: h * 0.52, align: 'left' },
    ];
  };

  SpatialMap.prototype._focusNameSlotFor = function (name, w, h) {
    const pockets = this._focusNamePockets(w, h);
    const look =
      (this._followFocusWorld && this._followFocusWorld()) || { x: 0, y: 0 };
    const scr = this._worldToScreen(look.x, look.y, w, h);
    let best = 0;
    let bestD = -1;
    for (let i = 0; i < pockets.length; i++) {
      const p = pockets[i];
      const d = Math.hypot(p.x - scr.x, p.y - scr.y);
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (name && this._fogNamePrev && this._fogNamePrev !== name) {
      const prev = this._fogNameSlot;
      if (prev === best) best = (best + 1) % pockets.length;
    }
    return best;
  };

  /** Face / rim fade later; incoming seats bloom first. */
  SpatialMap.prototype._focusDiskPaint = function (disk) {
    if (!disk || this.cameraMode !== 'follow' || this.mapView === 'function') {
      return null;
    }
    const fog = 0.08;
    const st = this._focusRunState();
    if (!st || !st.here) {
      return { face: 1, seats: 1, rim: 1 };
    }
    if (!st.nxt) {
      const on = this._sameDiskRef(disk, st.here);
      return {
        face: on ? 1 : fog,
        seats: on ? 1 : fog * 0.35,
        rim: on ? 1 : fog,
      };
    }
    const t = this._focusFadeT();
    if (this._sameDiskRef(disk, st.here)) {
      const seatT = Math.max(0, (t - 0.42) / 0.58);
      return {
        face: 1 - t * (1 - fog),
        rim: 1 - t * (1 - fog),
        seats: 1 - seatT * (1 - fog),
      };
    }
    if (this._sameDiskRef(disk, st.nxt)) {
      const seatT = Math.min(1, t / 0.46);
      const faceT = Math.max(0, (t - 0.28) / 0.72);
      return {
        face: fog + faceT * (1 - fog),
        rim: fog + faceT * (1 - fog),
        seats: fog * 0.4 + seatT * (1 - fog * 0.4),
      };
    }
    return { face: fog * 0.55, seats: 0.03, rim: fog * 0.55 };
  };

  SpatialMap.prototype._focusDiskLight = function (disk) {
    const p = this._focusDiskPaint(disk);
    return p ? p.face : null;
  };

  SpatialMap.prototype._restRotation = function () {
    const path = this.path || [];
    const i =
      this.current >= 0 && this.current < path.length
        ? this.current
        : path.length
          ? path.length - 1
          : -1;
    const d =
      i >= 0 && path[i]
        ? this._diskForChord(path[i])
        : this._activeDisk && this._activeDisk();
    return this._uprightRotForDisk(d);
  };

  /**
   * One continuous look-at: path drift, or lamp walk into the next key.
   * Low-passed so a math blip cannot snap the angle.
   */
  SpatialMap.prototype._followDriftTarget = function () {
    const look =
      (this._focusLampWorld && this._focusLampWorld()) ||
      this._pathLookNow();
    const zoom = this._cinematicFrame('follow');
    const tz = zoom && zoom.tz ? zoom.tz : 1;
    if (this._lookX == null || this._lookY == null) {
      this._lookX = look.x;
      this._lookY = look.y;
    } else {
      const k = 0.035;
      this._lookX += (look.x - this._lookX) * k;
      this._lookY += (look.y - this._lookY) * k;
    }
    return { tx: this._lookX, ty: this._lookY, tz: tz };
  };

  /**
   * Soft next-seats on the sounding wheel — where this chord can go.
   * Visual only. Never writes the path.
   */
  SpatialMap.prototype._refreshFocusOptions = function () {
    this._focusOptions = [];
    if (this.cameraMode !== 'follow' || this.mapView === 'function') return;
    const i = this.playing >= 0 ? this.playing : this.current;
    const ch = this.path && i >= 0 ? this.path[i] : null;
    if (!ch) return;
    if (this.ensureGhostHalo) this.ensureGhostHalo({ pivotIndex: i });
    if (!this.scaleSeats || !this.scaleSeats.length) return;
    const disk = this._followFocusDisk
      ? this._followFocusDisk()
      : this._diskForChord(ch);
    const nextCh =
      this.path && i >= 0 && i + 1 < this.path.length
        ? this.path[i + 1]
        : this._isLooping() && this.path && this.path[0]
          ? this.path[0]
          : null;
    const H = global.HLApp;
    const tonic =
      disk && disk.tonic != null
        ? disk.tonic
        : this.origin
          ? this.origin.tonic
          : 0;
    const mode = (disk && disk.mode) || (this.origin && this.origin.mode) || 'minor';
    const opts = [];
    const fadeT = this._focusFadeT ? this._focusFadeT() : 0;
    const st = this._focusRunState ? this._focusRunState() : null;
    const extraDisk = fadeT > 0.12 && st && st.nxt ? st.nxt : null;
    (this.scaleSeats || []).forEach((s) => {
      if (!s || s.x == null || !s.chord) return;
      const onHere =
        disk && s.disk && this._sameDiskRef && this._sameDiskRef(s.disk, disk);
      const onNext =
        extraDisk &&
        s.disk &&
        this._sameDiskRef &&
        this._sameDiskRef(s.disk, extraDisk);
      if (disk && s.disk && !onHere && !onNext) return;
      if (!s.disk && disk && !disk.active && !s.activeDisk) return;
      if (s.root === ch.root) return;
      let w = 0.42;
      if (H && H.scoreDegreeProgression) {
        const sc = H.scoreDegreeProgression(ch, s.chord, tonic, mode);
        if (typeof sc === 'number' && isFinite(sc)) w = sc;
      } else if (s.role === 'tonic') w = 0.92;
      else if (s.role === 'dom') w = 0.84;
      else if (s.role === 'subdom') w = 0.7;
      const isNext = !!(nextCh && s.root === nextCh.root);
      if (isNext) w = Math.max(w, 0.9);
      opts.push({
        x: s.x,
        y: s.y,
        weight: Math.max(0.05, Math.min(1, w)),
        next: isNext,
        roman: s.roman || '',
        kind: 'seat',
      });
    });
    const ghosts = (this.ghostDisks || []).slice().sort((a, b) => {
      const M = global.HLMusic;
      const da =
        M && M.fifthsDistance
          ? Math.abs(M.fifthsDistance(tonic, a.tonic))
          : 9;
      const db =
        M && M.fifthsDistance
          ? Math.abs(M.fifthsDistance(tonic, b.tonic))
          : 9;
      return da - db;
    });
    ghosts.forEach((g, gi) => {
      if (!g) return;
      opts.push({
        x: g.cx || 0,
        y: g.cy || 0,
        r: g.R || 70,
        weight: gi < 2 ? 0.72 : 0.26,
        next: false,
        rumoured: gi >= 2,
        roman: g.label || '',
        kind: 'modulate',
        label: g.label || '',
        relation: g.relation || '',
      });
    });
    opts.sort((a, b) => b.weight - a.weight);
    this._focusOptions = opts;
  };

  SpatialMap.prototype._focusBloom = function () {
    if (this.playing == null || this.playing < 0) return 0.42;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const ms = this._playStepMs || 1;
    let u = (now - (this._playStepAt || now)) / ms;
    if (u < 0) u = 0;
    if (u > 1) u = 1;
    return u * u * (3 - 2 * u);
  };

  SpatialMap.prototype._tickPlayRotation = function () {
    if (this.playing == null || this.playing < 0) return;
    const cam = this.camera;
    if (this.cameraMode === 'follow' && this.mapView !== 'function') {
      const rot = this._rotationAtBeats(this._playheadBeats());
      cam.rot = rot;
      cam.tr = rot;
      const drift = this._followDriftTarget();
      if (drift) {
        cam.tx = drift.tx;
        cam.ty = drift.ty;
        cam.tz = drift.tz;
      }
    } else {
      cam.tr = 0;
    }
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
        const ang = s.angle + (disk.rot || 0);
        const xy = this._diskSeatXY(disk, ang, radius);
        const x = xy.x;
        const y = xy.y;
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