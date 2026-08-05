/**
 * hl-ui.js - render UI (attaches to HLApp)
 */
(function (global) {
  "use strict";
  var H = global.HLApp;
  if (!H) throw new Error("HLApp missing - load hl-core.js first");
H.refreshAll = function () {
    H.refreshSequence();
    H.renderVersionBar();
    H.renderPacks();
    H.renderHorizonLists();
    H.refreshMap();
    H.updatePlayBtn();
  }

  H.refreshUI = function () {
    H.refreshSequence();
    H.renderVersionBar();
    H.renderHorizonLists();
    H.refreshMap();
  }

  H.refreshMap = function (opts) {
    opts = opts || {};
    if (!H.map) {
      H.renderTimeStrip({ force: true });
      return;
    }
    H.ensurePathOwned();
    const keep = !!opts.keepCamera;
    if (keep) H.map._keepCameraOnce = true;
    const camSnap = keep && H.map.snapshotCamera ? H.map.snapshotCamera() : null;
    try {
      // Origin only — path layout is owned by setPath (avoids layout with stale path)
      if (H.map.setOrigin) {
        H.map.setOrigin(H.state.tonic, H.state.mode, { layoutPath: false });
      }
      H.map.setPath(H.state.chords, H.state.selected);
      // Chase: seats + path + ghosts only (no next-move hollow dots on the map).
      // Function: neighbourhood chart. From here list still has full suggestions.
      if (H.map.mapView === 'function' && H.buildFunctionChart) {
        H.map.setFunctionChart(H.buildFunctionChart());
        H.map.setHorizon([]);
      } else {
        if (H.map.setFunctionChart) H.map.setFunctionChart(null);
        H.map.setHorizon([]);
      }
      H.refreshAltPath();
      if (camSnap && H.map.restoreCamera) {
        H.map.restoreCamera(camSnap, { snap: true });
      }
    } catch (err) {
      console.error('refreshMap failed', err);
      // Last-ditch: still push path onto map so Chase matches sequence
      try {
        if (H.map.clearInteraction) H.map.clearInteraction({ skipHorizon: true });
        H.map.setPath(H.state.chords, H.state.selected);
      } catch (err2) {
        console.error('refreshMap setPath recovery failed', err2);
      }
    } finally {
      H.map._keepCameraOnce = false;
      // Always refresh timeline — never depend on map layout succeeding
      H.renderTimeStrip({ force: true });
    }
  }

  /**
   * After a committed write-home key change while on Function, jump to Chase.
   * Multi-disk only reads clearly there. Returns true if the view flipped.
   */
  H.maybeChaseAfterKeyChange = function (opts) {
    opts = opts || {};
    if (!H.map || H.map.mapView !== 'function') return false;
    H.setMapView('chase', { silent: true });
    // Frame both disks when present
    if (H.map.disks && H.map.disks.length > 1) {
      H.map.camera.tz = Math.min(H.map.camera.tz || 1, 0.72);
      H.map.camera.tx = 0;
      H.map.camera.ty = 0;
      H.map.camera.x = 0;
      H.map.camera.y = 0;
      H.map.camera.zoom = H.map.camera.tz;
    }
    if (!opts.silent) {
      H.setSyncStatus(
        opts.message ||
          'New key → Chase · multi-disk journey · Function is same-key atlas only'
      );
    }
    return true;
  };

  /** Switch map between Chase (scale seats) and Function (neighbourhood chart). */
  H.setMapView = function (view, opts) {
    opts = opts || {};
    view = view === 'function' ? 'function' : 'chase';
    // Freeze scale before anything runs — Home lock used to force zoom=1
    const camSnap = H.map && H.map.snapshotCamera ? H.map.snapshotCamera() : null;
    if (H.map) H.map._keepCameraOnce = true;
    if (H.map && H.map.setMapView) H.map.setMapView(view);
    const chaseBtn = H.$('#view-chase');
    const fnBtn = H.$('#view-function');
    if (chaseBtn) chaseBtn.classList.toggle('active', view === 'chase');
    if (fnBtn) fnBtn.classList.toggle('active', view === 'function');
    const bar = H.$('#function-opts');
    if (bar) bar.hidden = view !== 'function';
    // Next-move dots removed from map (seats + ghosts only)
    const horz = H.$('#tog-horizon');
    if (horz && horz.closest) {
      const wrap = horz.closest('label') || horz;
      if (wrap) wrap.hidden = true;
    }
    H.syncFunctionOptsUI();
    H.refreshMap({ keepCamera: true });
    if (camSnap && H.map && H.map.restoreCamera) {
      // Same write-home wheel, same zoom. Re-centre only if already near home.
      const nearHome =
        Math.hypot(camSnap.tx || 0, camSnap.ty || 0) < 80 ||
        H.map.cameraMode === 'home';
      if (nearHome) {
        camSnap.tx = 0;
        camSnap.ty = 0;
        camSnap.x = 0;
        camSnap.y = 0;
      }
      // tz/zoom from before the switch — never Fit/Home rescale
      H.map.restoreCamera(camSnap, { snap: true });
    }
    if (H.map) H.map._keepCameraOnce = false;
    if (!opts.silent) {
      H.setSyncStatus(
        view === 'function'
          ? 'Function · same-key atlas (diatonic, V7s, borrow) · Land/modulate → Chase'
          : 'Chase · seats + path + nearby-key ghosts · advanced colour on Function'
      );
    }
  };

  H.syncFunctionOptsUI = function () {
    const fo = H.state.functionOpts || {};
    const map = {
      'fo-dominants': 'dominants',
      'fo-borrow': 'borrow',
    };
    Object.keys(map).forEach((id) => {
      const el = H.$('#' + id);
      if (el) el.checked = fo[map[id]] !== false;
    });
  };

  H.setFunctionOpt = function (key, value) {
    if (!H.state.functionOpts) H.state.functionOpts = { dominants: true, borrow: true };
    H.state.functionOpts[key] = !!value;
    if (H.map && H.map.mapView === 'function') H.refreshMap();
  };

  H.renderTimeStrip = function (opts) {
    opts = opts || {};
    const host = H.$('#time-strip');
    if (!host) return;
    // Don't rebuild DOM mid-drag — unless force (sequence edit / view switch)
    if (host.dataset.resizing === '1' && !opts.force) return;
    host.dataset.resizing = '';
    host.innerHTML = '';
    if (!H.state.chords.length) {
      host.innerHTML = '<span class="ts-empty">Time strip — path steps appear here</span>';
      return;
    }
    const totalBeats = H.state.chords.reduce((s, c) => s + (c.duration || 4), 0) || 1;
    H.state.chords.forEach((ch, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.i = String(i);
      btn.className =
        'ts-step' +
        (i === H.state.selected ? ' selected' : '') +
        (H.map && H.map.playing === i ? ' playing' : '');
      // Width proportional to beats; shrink min-width for long sequences
      const beats = ch.duration != null ? ch.duration : 4;
      const n = H.state.chords.length;
      const minW = n > 24 ? 1.4 : n > 14 ? 1.8 : 2.2;
      const beatScale = n > 24 ? 0.28 : n > 14 ? 0.4 : 0.55;
      btn.style.flex = beats + ' 1 0';
      btn.style.minWidth = Math.max(minW, beats * beatScale) + 'rem';
      const sec = H.A().beatsToSeconds ? H.A().beatsToSeconds(beats, H.state.bpm) : beats;
      btn.title =
        i +
        1 +
        '. ' +
        ch.name +
        ' · ' +
        beats +
        ' beats @ ' +
        H.state.bpm +
        ' BPM ≈ ' +
        (typeof sec === 'number' ? sec.toFixed(2) + 's' : '') +
        ' — drag right edge to resize';
      btn.innerHTML =
        `<span class="ts-playhead" aria-hidden="true"></span>` +
        `<span class="ts-n">${i + 1}</span>` +
        `<span class="ts-name">${ch.name}</span>` +
        `<span class="ts-dur">${beats}b</span>`;

      // Resize handle on right edge
      const handle = document.createElement('span');
      handle.className = 'ts-handle';
      handle.title =
        i < H.state.chords.length - 1
          ? 'Drag to redistribute beats with next chord'
          : 'Drag to change length';
      handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        H.beginStripResize(i, e, host);
      });
      btn.appendChild(handle);

      btn.addEventListener('click', (e) => {
        if (host.dataset.didResize === '1') {
          host.dataset.didResize = '';
          return;
        }
        H.state.selected = i;
        H.A().ensure();
        // Preview at real beat length for current BPM (not a fixed 1.35s)
        H.A().playChord({
          chord: ch,
          duration: H.chordAudioSeconds(ch, { soft: false }),
        });
        H.refreshUI();
      });
      // Double-click: split this step (timing stays same total)
      btn.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        H.splitChordAt(i);
      });
      host.appendChild(btn);
    });
  }

  /**
   * Drag the right border of a time-strip step to change durations.
   */
  H.beginStripResize = function (index, e, host) {
    if (index < 0 || !H.state.chords[index]) return;
    H.pushUndo();
    host.dataset.resizing = '1';
    host.classList.add('resizing-strip');
    const startX = e.clientX;
    const startDur = H.state.chords[index].duration || 4;
    const startNext =
      index < H.state.chords.length - 1 ? H.state.chords[index + 1].duration || 4 : null;
    // Beats per pixel from current strip width / total beats
    const totalBeats = H.state.chords.reduce((s, c) => s + (c.duration || 4), 0) || 1;
    const stripW = Math.max(40, host.getBoundingClientRect().width);
    const beatsPerPx = totalBeats / stripW;
    let lastApplied = 0;
    let moved = false;

    const stepEl = host.querySelector('.ts-step[data-i="' + index + '"]');
    const nextEl = host.querySelector('.ts-step[data-i="' + (index + 1) + '"]');
    if (stepEl) stepEl.classList.add('resizing');
    const handle = stepEl && stepEl.querySelector('.ts-handle');
    if (handle) handle.classList.add('active');

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      if (Math.abs(dx) > 2) moved = true;
      const delta = dx * beatsPerPx;
      // Restore base then apply so snap doesn't accumulate error
      H.state.chords[index] = H.M().withDuration(H.state.chords[index], startDur);
      if (startNext != null && H.state.chords[index + 1]) {
        H.state.chords[index + 1] = H.M().withDuration(H.state.chords[index + 1], startNext);
      }
      H.resizeStripEdge(index, delta, { live: true });
      lastApplied = delta;
      // Live flex update
      const a = H.state.chords[index];
      const da = a.duration || 4;
      if (stepEl) {
        stepEl.style.flex = da + ' 1 0';
        const durEl = stepEl.querySelector('.ts-dur');
        if (durEl) durEl.textContent = da + 'b';
        stepEl.title = index + 1 + '. ' + a.name + ' · ' + da + ' beats';
      }
      if (nextEl && H.state.chords[index + 1]) {
        const b = H.state.chords[index + 1];
        const db = b.duration || 4;
        nextEl.style.flex = db + ' 1 0';
        const durEl = nextEl.querySelector('.ts-dur');
        if (durEl) durEl.textContent = db + 'b';
        nextEl.title = index + 2 + '. ' + b.name + ' · ' + db + ' beats';
      }
      const pair =
        startNext != null && H.state.chords[index + 1]
          ? da + 'b + ' + (H.state.chords[index + 1].duration || 4) + 'b'
          : da + 'b';
      H.setSyncStatus('Resize: ' + a.name + ' · ' + pair);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      host.dataset.resizing = '';
      host.classList.remove('resizing-strip');
      if (stepEl) stepEl.classList.remove('resizing');
      if (handle) handle.classList.remove('active');
      if (moved) {
        host.dataset.didResize = '1';
        H.state.selected = index;
        H.state.fromPackId = null;
        H.afterEdit();
        const a = H.state.chords[index];
        const msg =
          startNext != null && H.state.chords[index + 1]
            ? 'Lengths: ' +
              a.name +
              ' ' +
              (a.duration || 4) +
              'b · ' +
              H.state.chords[index + 1].name +
              ' ' +
              (H.state.chords[index + 1].duration || 4) +
              'b'
            : a.name + ' · ' + (a.duration || 4) + ' beats';
        H.setSyncStatus(msg);
      }
      // Full refresh so inspector + H.map duration tails match
      H.refreshUI();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    try {
      handle && handle.setPointerCapture && handle.setPointerCapture(e.pointerId);
    } catch (_) { /* ignore */ }
  }

  /** Prefer next chords that continue L–R swing or arch home */
  H.suggestSwingNext = function () {
    if (!H.state.chords.length || !H.map) return;
    const last = H.state.chords[H.state.chords.length - 1];
    const nodes = H.map.nodes || [];
    const lastNode = nodes[nodes.length - 1];
    const side = lastNode ? (lastNode.x >= 0 ? 1 : -1) : 1;
    // Want opposite side of home
    const wantSide = -side;
    const t = H.state.tonic;
    const candidates = [];
    for (let d = 0; d < 12; d++) {
      ['min', 'maj', 'dom7', 'min7', 'maj7'].forEach((q) => {
        const root = (t + d) % 12;
        let ch = H.M().makeChord(root, q, { duration: 4, region: d === 0 ? 'diatonic' : 'interchange' });
        const pos = H.map._chordPos(ch, 0, 0);
        const s = pos.x >= 0 ? 1 : -1;
        if (s !== wantSide) return;
        const dist = Math.abs(pos.x) + Math.abs(pos.y) * 0.5;
        candidates.push({ ch, score: dist + (H.M().voiceLeadingQuality ? H.M().voiceLeadingQuality(last, ch) * 20 : 0) });
      });
    }
    candidates.sort((a, b) => b.score - a.score);
    const pick = candidates[0];
    if (!pick) return;
    H.pushUndo();
    let ch = pick.ch;
    if (H.C().bestInversion) ch = H.C().bestInversion(last, ch);
    ch.duration = 4;
    ch.tag = 'swing';
    H.stampKey(ch, H.writeKey());
    H.state.chords.push(ch);
    H.state.selected = H.state.chords.length - 1;
    H.state.fromPackId = null;
    H.afterEdit();
    H.A().ensure();
    H.A().playChord({ chord: ch });
    H.setSyncStatus('Added swing step · ' + ch.name);
  }

  H.suggestArchHome = function () {
    if (!H.state.chords.length) return;
    const last = H.state.chords[H.state.chords.length - 1];
    const t = H.state.tonic;
    // V7 then will want home — just add V7
    H.pushUndo();
    let ch = H.M().makeChord((t + 7) % 12, 'dom7', {
      duration: 2,
      region: 'diatonic',
      roman: 'V7',
      tag: 'arch-home',
    });
    if (H.C().bestInversion) ch = H.C().bestInversion(last, ch);
    ch.duration = 2;
    H.stampKey(ch, H.writeKey());
    H.state.chords.push(ch);
    // Then tonic
    let home = H.M().makeChord(t, H.state.mode === 'major' ? 'maj' : 'min', {
      duration: 4,
      region: 'diatonic',
      roman: 'i',
      tag: 'home',
    });
    if (H.C().bestInversion) home = H.C().bestInversion(ch, home);
    home.duration = 4;
    H.stampKey(home, H.writeKey());
    H.state.chords.push(home);
    H.state.selected = H.state.chords.length - 1;
    H.state.fromPackId = null;
    H.afterEdit();
    H.A().ensure();
    H.A().playSequence([ch, home], H.state.bpm, { pulse: false });
    H.setSyncStatus('Arch home · V7 → tonic');
  }

  H.refreshSequence = function () {
    H.renderTitle();
    H.renderSlots();
    H.renderInspector();
    H.renderVlReadout();
    H.renderCritique();
    H.updateMapStatus();
  }

  H.updateMapStatus = function () {
    const el = H.$('#map-status');
    if (!el) return;
    if (!H.state.chords.length) {
      el.textContent =
        'Empty path — click a coloured dot around home (or use From here / Add) to place the first chord';
      return;
    }
    const i = Math.max(0, Math.min(H.state.selected, H.state.chords.length - 1));
    const ch = H.state.chords[i];
    if (!ch) {
      el.textContent = 'Select a step in the list or on the path';
      return;
    }
    let side = '';
    if (H.map && H.map.nodes && H.map.nodes[i]) {
      const x = H.map.nodes[i].x;
      side = x < -12 ? ' · left of home' : x > 12 ? ' · right of home' : ' · near home';
    }
    const play = H.map && H.map.playing === i ? ' · playing' : '';
    const coach =
      H.state.chords.length < 2
        ? ' · tip: click another outer dot for the next step, or drag this chord to aim a swap'
        : '';
    const own = H.keyOf(ch);
    const diskNote =
      own.tonic !== H.state.tonic || own.mode !== H.state.mode
        ? ' · on ' + H.keyLabelFor(own) + ' disk'
        : '';
    const multi =
      H.map && H.map.disks && H.map.disks.length > 1
        ? ' · ' + H.map.disks.length + ' disks'
        : '';
    el.textContent =
      'Step ' +
      (i + 1) +
      ' of ' +
      H.state.chords.length +
      ' · ' +
      ch.name +
      ' · ' +
      (ch.duration || 4) +
      'b' +
      diskNote +
      multi +
      side +
      play +
      coach;
  }

  H.renderVlReadout = function () {
    const el = H.$('#vl-readout');
    if (!el) return;
    const i = H.state.selected;
    if (i < 1 || !H.state.chords[i] || !H.C().voiceLeadingDetail) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    const d = H.C().voiceLeadingDetail(H.state.chords[i - 1], H.state.chords[i]);
    if (!d) {
      el.hidden = true;
      return;
    }
    const q =
      d.quality >= 0.7 ? 'smooth' : d.quality >= 0.45 ? 'ok' : 'jumpy';
    el.hidden = false;
    el.textContent =
      'Into ' +
      H.state.chords[i].name +
      ': bass ' +
      d.bassFrom +
      '→' +
      d.bassTo +
      ' (' +
      d.bassMotion +
      ') · common ' +
      (d.common.length ? d.common.join(' ') : '—') +
      ' · moving ' +
      (d.moving.length ? d.moving.join(' ') : '—') +
      ' · ' +
      q;
  }

  H.renderCritique = function () {
    const el = H.$('#critique');
    if (!el) return;
    if (!H.state.chords.length || !H.C().analyzeCell) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    const a = H.C().analyzeCell(H.state.chords, H.state.tonic, H.state.mode);
    const g = a.grades || {};
    const pct = (x) => Math.round((x || 0) * 100);
    el.hidden = false;
    el.innerHTML =
      '<div><strong>Cell read</strong> · score ' +
      pct(a.score) +
      '%</div>' +
      '<div class="grades">' +
      ['hook', 'motion', 'return', 'rhythm', 'voice']
        .map((k) => '<span class="g">' + k + ' ' + pct(g[k]) + '</span>')
        .join('') +
      '</div>' +
      (a.strengths && a.strengths[0]
        ? '<div>✓ ' + H.escapeHtml(a.strengths[0]) + '</div>'
        : '') +
      (a.weaknesses && a.weaknesses[0]
        ? '<div>△ ' + H.escapeHtml(a.weaknesses[0]) + '</div>'
        : '') +
      (a.tips && a.tips[0] ? '<div>→ ' + H.escapeHtml(a.tips[0]) + '</div>' : '');
  }

  H.renderTitle = function () {
    const titleEl = H.$('#seq-title');
    // Editable cell name
    if (titleEl && titleEl.tagName === 'INPUT') {
      if (document.activeElement !== titleEl) titleEl.value = H.state.title;
    } else if (titleEl) {
      titleEl.textContent = H.state.title;
    }
    H.$('#seq-key').textContent = H.keyLabel();
    const badge = H.$('#canonical-badge');
    if (H.state.recognition && H.state.recognition.confidence >= 0.75) {
      badge.hidden = false;
      badge.textContent = H.state.recognition.exact
        ? 'Matches pack · ' + H.state.recognition.pack.name
        : 'Related · ' + H.state.recognition.pack.name;
      badge.className = 'badge' + (H.state.recognition.exact ? ' exact' : '');
    } else {
      badge.hidden = true;
    }
    const why = H.$('#seq-why');
    if (H.state.recognition && H.state.recognition.pack) {
      why.textContent = H.state.recognition.pack.why;
    } else {
      why.textContent =
        'Edit the path · From here suggests next moves · versions live under the name';
    }
    H.$('#path-text').textContent = H.state.chords.map((c) => c.name).join(' → ') || 'Empty — add a chord or load a feel';
  }

  /** Light select — no full map rebuild (important for long sequences). */
  H.selectStep = function (i, opts) {
    opts = opts || {};
    if (i < 0 || i >= H.state.chords.length) return;
    H.state.selected = i;
    const ch = H.state.chords[i];
    if (opts.play !== false && ch) {
      H.A().ensure();
      H.A().playChord({ chord: ch });
    }
    if (H.map) {
      H.map.current = i;
      if (H.map._rebuildGhostHalo) H.map._rebuildGhostHalo();
    }
    // Update slot chrome without nuking the whole list
    const host = H.$('#slots');
    if (host) {
      host.querySelectorAll('.slot').forEach((el) => {
        const idx = parseInt(el.dataset.index, 10);
        el.classList.toggle('selected', idx === i);
      });
    }
    const strip = H.$('#time-strip');
    if (strip) {
      strip.querySelectorAll('.ts-step').forEach((el) => {
        const idx = parseInt(el.dataset.i, 10);
        el.classList.toggle('selected', idx === i);
      });
    }
    H.renderInspector();
    H.renderVlReadout();
    H.updateMapStatus();
  };

  H.renderSlots = function () {
    const host = H.$('#slots');
    if (!host) return;
    host.innerHTML = '';
    // Long lists: keep the list scrollable so add/edit stay reachable
    if (H.state.chords.length > 12) {
      host.style.maxHeight = 'min(48vh, 28rem)';
      host.style.overflowY = 'auto';
    } else {
      host.style.maxHeight = '';
      host.style.overflowY = '';
    }
    const diffs = H.diffIndicesVsCompare();
    const playing = H.map ? H.map.playing : -1;
    H.state.chords.forEach((ch, i) => {
      const el = document.createElement('div');
      el.className =
        'slot' +
        (i === H.state.selected ? ' selected' : '') +
        (diffs.has(i) ? ' diff' : '') +
        (playing === i ? ' playing-step' : '');
      // Only the grip reorders — whole-row drag made long lists feel broken
      el.draggable = false;
      el.dataset.index = String(i);
      el.innerHTML = `
        <span class="grip" title="Drag to reorder" draggable="true">⋮⋮</span>
        <span class="n">${i + 1}</span>
        <span class="nm">${ch.name}</span>
        <span class="rm">${ch.roman || ''}</span>
        <span class="du">${ch.duration}b</span>
        <button type="button" class="x" title="Remove">×</button>
      `;
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('x') || e.target.classList.contains('grip')) return;
        H.selectStep(i);
      });
      el.querySelector('.x').addEventListener('click', (e) => {
        e.stopPropagation();
        H.state.selected = i;
        H.removeSelected();
      });
      const grip = el.querySelector('.grip');
      grip.addEventListener('dragstart', (e) => {
        H.dragSlotIndex = i;
        el.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(i));
        try {
          e.dataTransfer.setDragImage(el, 12, 12);
        } catch (_) {}
      });
      grip.addEventListener('dragend', () => {
        el.classList.remove('dragging');
        H.dragSlotIndex = null;
        host.querySelectorAll('.slot').forEach((s) => s.classList.remove('drag-over'));
      });
      el.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        el.classList.add('drag-over');
      });
      el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        el.classList.remove('drag-over');
        const from =
          H.dragSlotIndex != null
            ? H.dragSlotIndex
            : parseInt(e.dataTransfer.getData('text/plain'), 10);
        if (!isNaN(from)) H.reorderChord(from, i);
      });
      host.appendChild(el);
    });
    // Keep selected step in view for long lists
    const sel = host.querySelector('.slot.selected');
    if (sel && sel.scrollIntoView) {
      sel.scrollIntoView({ block: 'nearest' });
    }
  }

  H.renderInspector = function () {
    const host = H.$('#inspector');
    const ch = H.state.chords[H.state.selected];
    if (!ch) {
      host.innerHTML = '<p class="hint">Select a chord — edit root, quality, duration, bass. Drag slots to reorder.</p>';
      return;
    }
    const tones = [...new Set([ch.root, ...(ch.notes || [])])];
    const bass = ch.bassPc != null ? ch.bassPc : ch.root;
    const rootOpts = H.M().NOTE_NAMES.map(
      (n, i) => `<option value="${i}"${i === ch.root ? ' selected' : ''}>${n}</option>`
    ).join('');
    const qOpts = Object.keys(H.M().QUALITIES)
      .map(
        (k) =>
          `<option value="${k}"${k === ch.quality ? ' selected' : ''}>${H.M().QUALITIES[k].symbol || H.M().QUALITIES[k].label || k}</option>`
      )
      .join('');
    host.innerHTML = `
      <div class="insp-name">${ch.name}</div>
      <div class="insp-row">
        <label class="field">Root
          <select id="insp-root">${rootOpts}</select>
        </label>
        <label class="field">Quality
          <select id="insp-q">${qOpts}</select>
        </label>
      </div>
      <label class="field">Duration (beats)
        <div class="row" style="align-items:center;gap:0.4rem;margin-top:0.2rem">
          <input type="range" id="dur" min="0.5" max="64" step="0.5" value="${Math.min(64, Math.max(0.5, ch.duration || 4))}" style="flex:1" />
          <input type="number" id="dur-num" min="0.5" max="256" step="0.5" value="${ch.duration || 4}" style="width:3.8rem;padding:0.2rem 0.3rem;border-radius:6px;border:1px solid var(--line);background:#12110f;color:var(--ink)" title="Type any length (e.g. 20 for four bars of 5/4)" />
          <span class="hint" style="margin:0">b</span>
        </div>
      </label>
      <div class="dur-presets row" style="margin:0.35rem 0;flex-wrap:wrap">
        ${[0.5, 1, 2, 4, 5, 8, 10, 16, 20, 32].map((b) => `<button type="button" class="chip dur-p${Number(ch.duration) === b ? ' on' : ''}" data-b="${b}">${b}</button>`).join('')}
      </div>
      <div class="field" style="margin-top:0.35rem">Bass</div>
      <div class="bass-row" id="bass-row"></div>
      <div class="row" style="margin-top:0.5rem">
        <button type="button" class="btn ghost" id="insp-dup">Duplicate</button>
        <button type="button" class="btn ghost" id="insp-split" title="Split duration in half">Split</button>
        <button type="button" class="btn ghost" id="insp-up">↑</button>
        <button type="button" class="btn ghost" id="insp-dn">↓</button>
      </div>
    `;
    const row = host.querySelector('#bass-row');
    tones.forEach((pc) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (pc === bass ? ' on' : '');
      b.textContent = H.M().noteName(pc) + (pc === ch.root ? ' root' : '');
      b.addEventListener('click', () => H.setBass(pc));
      row.appendChild(b);
    });
    host.querySelector('#insp-root').addEventListener('change', (e) => {
      H.setSelectedRootQuality(parseInt(e.target.value, 10), ch.quality);
    });
    host.querySelector('#insp-q').addEventListener('change', (e) => {
      H.setSelectedRootQuality(ch.root, e.target.value);
    });
    const slider = host.querySelector('#dur');
    const durNum = host.querySelector('#dur-num');
    const syncDurUI = (v) => {
      const d = H.snapBeats(v);
      if (slider) {
        // Range tops out at 64 for usability; number field can go higher
        slider.value = String(Math.min(64, d));
      }
      if (durNum && document.activeElement !== durNum) durNum.value = String(d);
      host.querySelectorAll('.dur-p').forEach((btn) => {
        btn.classList.toggle('on', parseFloat(btn.dataset.b) === d);
      });
    };
    let durUndoArmed = false;
    if (slider) {
      slider.addEventListener('pointerdown', () => {
        durUndoArmed = true;
        H.pushUndo();
      });
      slider.addEventListener('input', () => {
        const v = parseFloat(slider.value);
        if (durNum) durNum.value = String(v);
        H.setDuration(v, true);
        host.querySelectorAll('.dur-p').forEach((btn) => {
          btn.classList.toggle('on', parseFloat(btn.dataset.b) === v);
        });
      });
    }
    if (durNum) {
      const applyNum = () => {
        const v = H.snapBeats(parseFloat(durNum.value));
        durNum.value = String(v);
        H.setDuration(v);
        syncDurUI(v);
      };
      durNum.addEventListener('change', applyNum);
      durNum.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          applyNum();
        }
      });
    }
    host.querySelectorAll('.dur-p').forEach((btn) => {
      btn.addEventListener('click', () => {
        const v = parseFloat(btn.dataset.b);
        H.setDuration(v);
        syncDurUI(v);
      });
    });
    host.querySelector('#insp-dup').addEventListener('click', H.duplicateSelected);
    if (host.querySelector('#insp-split')) {
      host.querySelector('#insp-split').addEventListener('click', () => H.splitChordAt(H.state.selected));
    }
    host.querySelector('#insp-up').addEventListener('click', () => H.moveSelected(-1));
    host.querySelector('#insp-dn').addEventListener('click', () => H.moveSelected(1));
  }

  H.renderPacks = function () {
    const filter = H.$('#feel-filter').value || 'all';
    const host = H.$('#pack-list');
    host.innerHTML = '';
    H.P().byFeel(filter).forEach((pack) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pack' + (H.state.fromPackId === pack.id ? ' active' : '');
      b.innerHTML = `<strong>${pack.name}</strong><span>${pack.feel} · ${pack.colour}</span><em>${pack.why}</em>`;
      b.addEventListener('click', () => H.loadPack(pack.id));
      host.appendChild(b);
    });
  }

  H.renderHorizonLists = function () {
    const host = H.$('#list-from-here') || H.$('#list-direction');
    if (!host) return;
    host.innerHTML = '';
    ['list-flavour', 'list-direction', 'list-cadence', 'list-modulate'].forEach((id) => {
      const el = document.getElementById(id);
      if (el && el !== host) el.innerHTML = '';
    });

    const items = H.buildHorizon();
    const order = {
      home: -1,
      secondary: 0,
      interchange: 1,
      gate: 2,
      direction: 3,
      flavour: 4,
      cadence: 5,
      modulate: 6,
    };
    items.sort(
      (a, b) =>
        (order[a.kind] != null ? order[a.kind] : 9) - (order[b.kind] != null ? order[b.kind] : 9)
    );

    const hasNext = H.state.selected >= 0 && H.state.selected < H.state.chords.length - 1;
    const tipDefault = hasNext
      ? 'Click = replace next · Shift+click = insert · hover = audition'
      : 'Click = append · Shift+click = insert · hover = audition';
    const kindLabel = {
      home: 'Home',
      secondary: 'V7/x',
      interchange: 'Borrow',
      gate: 'Gate',
      direction: 'Dir',
      flavour: 'Colour',
      cadence: 'Cadence',
      modulate: 'Mod',
    };
    const sectionMeta = {
      secondary: { title: 'Secondary dominants', hint: 'Pull into a scale chord (V7 → target)' },
      interchange: { title: 'Modal interchange', hint: 'Borrowed colour from the parallel mode' },
      gate: { title: 'Gates (I · IV · V)', hint: 'Ways in and out of borrowed colour' },
      move: { title: 'Moves & cadences', hint: 'Directions, colour, home routes, modulate' },
    };
    const sectionOf = (it) => {
      if (it.kind === 'secondary') return 'secondary';
      if (it.kind === 'interchange') return 'interchange';
      if (it.kind === 'gate') return 'gate';
      if (it.kind === 'home') return 'move';
      return 'move';
    };

    let lastSec = null;
    items.forEach((it) => {
      const sec = sectionOf(it);
      if (sec !== lastSec) {
        lastSec = sec;
        const meta = sectionMeta[sec] || sectionMeta.move;
        const head = document.createElement('div');
        head.className = 'hz-section';
        head.innerHTML =
          '<div class="hz-section-title">' +
          H.escapeHtml(meta.title) +
          '</div><div class="hz-section-hint">' +
          H.escapeHtml(meta.hint) +
          '</div>';
        host.appendChild(head);
      }

      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'hz kind-' + it.kind;
      b.title =
        tipDefault +
        (it.kind === 'modulate'
          ? ' · may change home key'
          : it.kind === 'secondary'
            ? ' · secondary dominant package'
            : it.kind === 'interchange'
              ? ' · borrowed chord'
              : it.kind === 'gate'
                ? ' · diatonic gate'
                : '');
      b.innerHTML =
        '<span class="hz-tag">' +
        (kindLabel[it.kind] || it.kind) +
        '</span><strong>' +
        H.escapeHtml(it.label) +
        '</strong><span>' +
        H.escapeHtml(it.job || (it.chord && it.chord.name) || '') +
        '</span>';
      b.addEventListener('mouseenter', () => {
        H.A().ensure();
        const pieces =
          it.route && it.route.length ? it.route : it.chord ? [it.chord] : [];
        const seq = [];
        const sel =
          H.state.selected >= 0 && H.state.chords[H.state.selected]
            ? H.state.chords[H.state.selected]
            : null;
        if (sel) seq.push(sel);
        pieces.forEach((c) => seq.push(c));
        if (pieces.length === 1 && H.state.chords[H.state.selected + 2]) {
          seq.push(H.state.chords[H.state.selected + 2]);
        } else if (pieces.length >= 2 && H.state.chords[H.state.selected + 1 + pieces.length]) {
          seq.push(H.state.chords[H.state.selected + 1 + pieces.length]);
        } else if (hasNext && pieces.length === 1 && H.state.chords[H.state.selected + 1]) {
          if (H.state.chords[H.state.selected + 2]) seq.push(H.state.chords[H.state.selected + 2]);
        }
        if (seq.length >= 2) {
          if (H.A().stopPlayback) H.A().stopPlayback();
          H.A().playSequence(
            seq.map((c) => {
              const x = H.M().cloneChord(c);
              x.duration = 1.35;
              return x;
            }),
            Math.max(H.state.bpm, 110),
            { pulse: false, loop: false }
          );
        } else if (pieces[0]) {
          H.A().playChord({ chord: pieces[0], soft: true, duration: 0.45 });
        }
      });
      b.addEventListener('click', (e) => {
        H.commitHorizon(it, { insert: !!(e && e.shiftKey) });
      });
      host.appendChild(b);
    });
  }

})(typeof window !== "undefined" ? window : globalThis);
