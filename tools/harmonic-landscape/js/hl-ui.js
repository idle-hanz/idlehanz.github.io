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
    // Always preserve camera across path refresh unless caller opts out
    const keep = opts.keepCamera !== false;
    if (keep) {
      H.map._keepCameraOnce = true;
      H.map._freezeCamera = true;
    }
    const camSnap =
      keep && H.map.snapshotCamera ? H.map.snapshotCamera() : null;
    try {
      // Origin only — path layout is owned by setPath (avoids layout with stale path)
      if (H.map.setOrigin) {
        H.map.setOrigin(H.state.tonic, H.state.mode, { layoutPath: false });
      }
      H.map.setPath(H.state.chords, H.state.selected);
      // Journey: seats + path + ghosts. In this key: neighbourhood chart.
      if (H.map.mapView === 'function' && H.buildFunctionChart) {
        H.map.setFunctionChart(H.buildFunctionChart());
      } else if (H.map.setFunctionChart) {
        H.map.setFunctionChart(null);
      }
      if (H.map.setHorizon) H.map.setHorizon([]);
      H.refreshAltPath();
      if (camSnap && H.map.restoreCamera) {
        H.map.restoreCamera(camSnap, { snap: true });
      }
    } catch (err) {
      console.error('refreshMap failed', err);
      try {
        if (H.map.clearInteraction) H.map.clearInteraction();
        H.map.setPath(H.state.chords, H.state.selected);
        if (camSnap && H.map.restoreCamera) {
          H.map.restoreCamera(camSnap, { snap: true });
        }
      } catch (err2) {
        console.error('refreshMap setPath recovery failed', err2);
      }
    } finally {
      // Hold camera freeze a few frames so layout settles without lerp chase
      const m = H.map;
      if (m) {
        m._keepCameraOnce = true;
        m._freezeCamera = true;
        let n = 0;
        const unfreeze = () => {
          n++;
          if (n < 3) {
            requestAnimationFrame(unfreeze);
            return;
          }
          m._keepCameraOnce = false;
          m._freezeCamera = false;
        };
        requestAnimationFrame(unfreeze);
      }
      H.renderTimeStrip({ force: true });
      if (H.renderDiskLegend) H.renderDiskLegend();
    }
  };

  /**
   * After a committed write-home key change while on Function, jump to Chase.
   * Multi-disk only reads clearly there. Returns true if the view flipped.
   */
  H.maybeChaseAfterKeyChange = function (opts) {
    opts = opts || {};
    if (!H.map || H.map.mapView !== 'function') return false;
    H.setMapView('chase', { silent: true });
    // Soft zoom-out only if still at default home framing (don't yank a panned view)
    if (H.map.disks && H.map.disks.length > 1) {
      const panned = Math.hypot(H.map.camera.tx || 0, H.map.camera.ty || 0) > 40;
      if (!panned) {
        H.map.camera.tz = Math.min(H.map.camera.tz || 1, 0.72);
        H.map.camera.zoom = H.map.camera.tz;
      }
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
    document.querySelectorAll('[data-map-view]').forEach(function (btn) {
      const on = btn.getAttribute('data-map-view') === view;
      btn.classList.toggle('active', on);
      btn.classList.toggle('primary', on);
      btn.classList.toggle('ghost', !on);
    });
    const bar = H.$('#function-opts');
    if (bar) bar.hidden = view !== 'function';
    H.syncFunctionOptsUI();
    if (H.syncFunctionPresetUI) H.syncFunctionPresetUI();
    H.refreshMap({ keepCamera: true });
    if (H.renderDiskLegend) H.renderDiskLegend();
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
      const stLabel = H.getStyle ? H.getStyle().label : '';
      H.setSyncStatus(
        view === 'function'
          ? 'In this key · Dom / Borrow / Tritone / Dim / V alts · right-click colours' +
              (stLabel ? ' · style ' + stLabel : '') +
              ' · leave home → Journey'
          : 'Journey · seats + path · right-click colours/packs · style ' +
              (stLabel || 'Neutral')
      );
    }
  };

  H.syncFunctionOptsUI = function () {
    const fo = H.state.functionOpts || {};
    const map = {
      'fo-dominants': 'dominants',
      'fo-borrow': 'borrow',
      'fo-tritone': 'tritone',
      'fo-dim': 'dim',
      'fo-valts': 'valts',
      'fo-colours': 'colours',
    };
    // Off-by-default layers
    const offDefault = { colours: 1, tritone: 1, dim: 1, valts: 1 };
    Object.keys(map).forEach((id) => {
      const el = H.$('#' + id);
      if (!el) return;
      const key = map[id];
      if (offDefault[key]) el.checked = fo[key] === true;
      else el.checked = fo[key] !== false;
    });
  };

  H.syncStyleUI = function () {
    const sel = H.$('#style-select');
    if (!sel) return;
    const id = H.getStyleId ? H.getStyleId() : H.state.style || 'neutral';
    if (sel.value !== id) sel.value = id;
    const blurb = H.$('#style-blurb');
    const st = H.getStyle ? H.getStyle() : null;
    if (blurb && st) {
      blurb.textContent = st.blurb || '';
      blurb.title = st.blurb || '';
    }
    const bar = H.$('#style-bar');
    if (bar && st) bar.title = (st.label || 'Style') + (st.blurb ? ' — ' + st.blurb : '');
  };

  H.setFunctionOpt = function (key, value) {
    if (!H.state.functionOpts) {
      H.state.functionOpts = {
        dominants: true,
        borrow: true,
        tritone: false,
        dim: false,
        valts: false,
        colours: false,
      };
    }
    H.state.functionOpts[key] = !!value;
    if (H.map && H.map.mapView === 'function') H.refreshMap();
    if (H.renderHorizonLists) H.renderHorizonLists();
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
      host.innerHTML =
        '<span class="ts-empty">Time strip empty — use <strong>+ Start on I</strong> or click a seat</span>';
      return;
    }
    const totalBeats = H.state.chords.reduce((s, c) => s + (c.duration || 4), 0) || 1;
    const islands =
      H.C() && H.C().segmentKeyIslands
        ? H.C().segmentKeyIslands(H.state.chords, H.state.tonic, H.state.mode)
        : [];
    const keyAt = {};
    islands.forEach(function (isl) {
      keyAt[isl.start] = isl;
    });
    H.state.chords.forEach((ch, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.i = String(i);
      const playingIdx =
        H.map && H.map.playing >= 0
          ? H.map.playing
          : H._playingIndex != null
            ? H._playingIndex
            : -1;
      btn.className =
        'ts-step' +
        (i === H.state.selected ? ' selected' : '') +
        (playingIdx === i ? ' playing' : '');
      // Width proportional to beats; keep readable min-width (scroll wrapper handles overflow)
      const beats = ch.duration != null ? ch.duration : 4;
      const n = H.state.chords.length;
      const minW = n > 20 ? 2.4 : 2.8;
      const beatScale = n > 20 ? 0.45 : 0.55;
      // Grow with beats; basis keeps cells readable so the wrap can scroll
      const basis = Math.max(minW, beats * beatScale);
      btn.style.flex = beats + ' 0 0 ' + basis + 'rem';
      btn.style.minWidth = basis + 'rem';
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
        ' — ⋮⋮ drag reorder · body drag→map reassign · edge resize · right-click pivot';
      btn.draggable = false;
      btn.classList.toggle('selected', (H.getSelectedIndices() || []).indexOf(i) >= 0);
      btn.classList.toggle('primary-sel', i === H.state.selected);
      btn.classList.toggle(
        'multi',
        (H.getSelectedIndices() || []).length > 1 &&
          (H.getSelectedIndices() || []).indexOf(i) >= 0
      );
      const isl = keyAt[i];
      const keyHtml = isl
        ? `<span class="ts-key" title="Key from here">${
            H.C().shortKeyLabel
              ? H.C().shortKeyLabel(isl.tonic, isl.mode)
              : ''
          }</span>`
        : '';
      btn.innerHTML =
        `<span class="ts-playhead" aria-hidden="true"></span>` +
        `<span class="ts-grip" title="Drag to reorder steps" draggable="true">⋮⋮</span>` +
        `<span class="ts-n">${i + 1}</span>` +
        keyHtml +
        `<span class="ts-name">${ch.name}</span>` +
        `<span class="ts-dur">${beats}b</span>` +
        `<button type="button" class="ts-del" title="Delete step (Backspace / Delete)" aria-label="Delete step">×</button>`;

      // Grip drag = reorder in the strip (body drag still aims to the map)
      const grip = btn.querySelector('.ts-grip');
      if (grip) {
        grip.addEventListener('dragstart', (e) => {
          e.stopPropagation();
          H.dragSlotIndex = i;
          e.dataTransfer.effectAllowed = 'move';
          try {
            e.dataTransfer.setData('text/plain', String(i));
          } catch (_) {}
          btn.classList.add('dragging');
          if (H.setSyncStatus) {
            H.setSyncStatus(
              'Reorder step ' + (i + 1) + ' · drop on another strip step'
            );
          }
        });
        grip.addEventListener('dragend', () => {
          btn.classList.remove('dragging');
          H.dragSlotIndex = null;
          host.querySelectorAll('.ts-step.drop-target').forEach((el) => {
            el.classList.remove('drop-target');
          });
        });
        grip.addEventListener('pointerdown', (e) => {
          // Don't start map-aim when grabbing the grip
          e.stopPropagation();
        });
      }
      btn.addEventListener('dragover', (e) => {
        if (H.dragSlotIndex == null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        btn.classList.add('drop-target');
      });
      btn.addEventListener('dragleave', () => {
        btn.classList.remove('drop-target');
      });
      btn.addEventListener('drop', (e) => {
        if (H.dragSlotIndex == null && !e.dataTransfer) return;
        e.preventDefault();
        e.stopPropagation();
        btn.classList.remove('drop-target');
        let from = H.dragSlotIndex;
        if (from == null) {
          try {
            from = parseInt(e.dataTransfer.getData('text/plain'), 10);
          } catch (_) {
            from = NaN;
          }
        }
        if (!isNaN(from) && from !== i && H.reorderChord) {
          H.reorderChord(from, i);
          if (H.setSyncStatus) {
            H.setSyncStatus(
              'Reordered · step ' + (from + 1) + ' → position ' + (i + 1)
            );
          }
        }
        H.dragSlotIndex = null;
        host.dataset.didMapAim = '1';
      });

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
      const delBtn = btn.querySelector('.ts-del');
      if (delBtn) {
        delBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (H.removeChordAt) H.removeChordAt(i);
        });
        delBtn.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
        });
      }

      // Drag body of step → map aim (reassign stacked steps). Edge handle = resize.
      btn.addEventListener('pointerdown', (e) => {
        if (e.button != null && e.button !== 0) return;
        if (e.target && e.target.classList && e.target.classList.contains('ts-handle')) {
          return;
        }
        // Don't steal double-click split
        H._stripPtr = {
          i: i,
          x: e.clientX,
          y: e.clientY,
          id: e.pointerId,
          armed: false,
        };
      });

      btn.addEventListener('click', (e) => {
        if (host.dataset.didResize === '1') {
          host.dataset.didResize = '';
          return;
        }
        if (host.dataset.didMapAim === '1') {
          host.dataset.didMapAim = '';
          return;
        }
        // Ctrl/Cmd = toggle multi · Shift = range · plain = single
        const additive = !!(e.ctrlKey || e.metaKey);
        const range = !!e.shiftKey && !additive;
        if (H.selectStep) {
          H.selectStep(i, {
            play: !additive && !range,
            additive: additive,
            range: range,
          });
          if (
            !additive &&
            !range &&
            H.A() &&
            H.A().isPlaying &&
            H.A().isPlaying() &&
            H.playSeq
          ) {
            H.playSeq({
              fromIndex: i,
              force: true,
              label: 'Seek step ' + (i + 1),
            });
          } else if (!additive && !range && ch && H.A().playChord) {
            H.A().playChord({
              chord: ch,
              duration: H.chordAudioSeconds(ch, { soft: false }),
            });
          }
        } else {
          H.state.selected = i;
          H.refreshUI();
        }
      });
      // Right-click: same colour / next / packs palette as the map
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const step = H.state.chords[i];
        if (!step || !H.openContextMenu) return;
        H.state.selected = i;
        if (H.map) H.map.current = i;
        // Light chrome sync without full map thrash
        host.querySelectorAll('.ts-step').forEach((el) => {
          el.classList.toggle('selected', el.dataset.i === String(i));
        });
        if (H.renderSlots) H.renderSlots();
        if (H.renderInspector) H.renderInspector();
        if (H.updateMapStatus) H.updateMapStatus();
        H.openContextMenu({
          kind: 'path',
          pathIndex: i,
          chord: step,
          clientX: e.clientX,
          clientY: e.clientY,
        });
      });
      // Double-click: split this step (timing stays same total)
      btn.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        H.splitChordAt(i);
      });
      host.appendChild(btn);
    });
    // Scroll strip only when selection changed (smooth scroll every rebuild felt jumpy)
    if (opts.scrollToSelected !== false) {
      const focus = host.querySelector('.ts-step.selected');
      if (focus && focus.scrollIntoView && host.dataset.lastScrollSel !== String(H.state.selected)) {
        host.dataset.lastScrollSel = String(H.state.selected);
        try {
          focus.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
        } catch (_) {
          focus.scrollIntoView(false);
        }
      }
    }
  };

  /**
   * Drag a time-strip step onto the map to reassign it (same aim pads / scoring
   * as dragging the path node). Fixes stacked map seats that are hard to grab.
   */
  H.beginStripMapAim = function (index, e, host) {
    if (!H.map || index == null || index < 0 || !H.state.chords[index]) return false;
    host = host || H.$('#time-strip');
    // Ensure map path nodes exist for this index
    if (!H.map.nodes || !H.map.nodes[index]) {
      try {
        H.map.setPath(H.state.chords, index);
      } catch (_) {
        /* ignore */
      }
    }
    if (!H.map.beginAimAtIndex) return false;

    H.state.selected = index;
    if (H.map) H.map.current = index;
    if (H.cancelHoverPreview) H.cancelHoverPreview();
    if (H.closeContextMenu) H.closeContextMenu();

    const ok = H.map.beginAimAtIndex(index, {
      armed: true,
      fromStrip: true,
      clientX: e.clientX,
      clientY: e.clientY,
    });
    if (!ok) return false;

    host.dataset.didMapAim = '1';
    host.classList.add('aiming-to-map');
    const stepEl = host.querySelector('.ts-step[data-i="' + index + '"]');
    if (stepEl) stepEl.classList.add('aiming');

    if (H.setSyncStatus) {
      H.setSyncStatus(
        'Reassign step ' +
          (index + 1) +
          ' · ' +
          (H.state.chords[index].name || '') +
          ' · drag onto a highlighted seat · release to set'
      );
    }

    // Drive map aim from document so pointer can leave the strip
    H.map.endExternalAimListeners && H.map.endExternalAimListeners();
    H.map._extAimMove = function (ev) {
      if (H.map && H.map._mode === 'node' && H.map._move) {
        H.map._move(ev);
      }
    };
    H.map._extAimUp = function (ev) {
      H.map.endExternalAimListeners && H.map.endExternalAimListeners();
      host.classList.remove('aiming-to-map');
      host.querySelectorAll('.ts-step.aiming').forEach((el) => {
        el.classList.remove('aiming');
      });
      if (H.map && H.map._mode === 'node' && H.map._up) {
        H.map._up(ev);
      }
      // Keep flag briefly so click handler doesn't re-select/play
      setTimeout(() => {
        if (host) host.dataset.didMapAim = '';
      }, 30);
    };
    document.addEventListener('pointermove', H.map._extAimMove, true);
    document.addEventListener('pointerup', H.map._extAimUp, true);
    document.addEventListener('pointercancel', H.map._extAimUp, true);
    return true;
  };

  // Global strip body drag → map (arm after small move so click still selects)
  if (typeof document !== 'undefined' && !H._stripMapAimWired) {
    H._stripMapAimWired = true;
    document.addEventListener(
      'pointermove',
      function (e) {
        const st = H._stripPtr;
        if (!st || st.armed) return;
        const d = Math.hypot(e.clientX - st.x, e.clientY - st.y);
        if (d < 10) return;
        const mode = (H.state && H.state.mapGestureMode) || 'select';
        // Only Aim mode (or Shift) reassigns from the strip — Select drag was adding/swapping
        if (mode !== 'aim' && !e.shiftKey) return;
        st.armed = true;
        const host = H.$('#time-strip');
        H.beginStripMapAim(st.i, e, host);
      },
      true
    );
    document.addEventListener(
      'pointerup',
      function () {
        H._stripPtr = null;
      },
      true
    );
    document.addEventListener(
      'pointercancel',
      function () {
        H._stripPtr = null;
      },
      true
    );
  }

  /**
   * Drag the right border of a time-strip step to change durations.
   */
  H.beginStripResize = function (index, e, host) {
    if (index < 0 || !H.state.chords[index]) return;
    // Undo only if the drag actually changes lengths (not bare click on handle)
    let undoPushed = false;
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
      if (Math.abs(dx) > 2) {
        if (!moved && !undoPushed) {
          H.pushUndo();
          undoPushed = true;
        }
        moved = true;
      }
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
        // Resize finished — rebuild loop schedule from new lengths, keep place
        if (H.resyncPlaybackPreservingPlace) H.resyncPlaybackPreservingPlace();
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
    const stepDur = H.stepDuration ? H.stepDuration() : 4;
    const candidates = [];
    for (let d = 0; d < 12; d++) {
      ['min', 'maj', 'dom7', 'min7', 'maj7'].forEach((q) => {
        const root = (t + d) % 12;
        let ch = H.M().makeChord(root, q, {
          duration: stepDur,
          region: d === 0 ? 'diatonic' : 'interchange',
        });
        const pos = H.map._chordPos(ch, 0, 0);
        const s = pos.x >= 0 ? 1 : -1;
        if (s !== wantSide) return;
        const dist = Math.abs(pos.x) + Math.abs(pos.y) * 0.5;
        candidates.push({
          ch,
          score:
            dist +
            (H.M().voiceLeadingQuality ? H.M().voiceLeadingQuality(last, ch) * 20 : 0),
        });
      });
    }
    candidates.sort((a, b) => b.score - a.score);
    const pick = candidates[0];
    if (!pick) return;
    H.pushUndo();
    let ch = pick.ch;
    if (H.C().bestInversion) ch = H.C().bestInversion(last, ch);
    ch.duration = stepDur;
    ch.tag = 'swing';
    H.stampKey(ch, H.writeKey());
    H.state.chords.push(ch);
    H.state.selected = H.state.chords.length - 1;
    H.setSelectedIndices([H.state.selected], H.state.selected);
    H.state.fromPackId = null;
    H.afterEdit();
    H.A().ensure();
    H.A().playChord({ chord: ch });
    H.setSyncStatus('Added swing step · ' + ch.name);
  };

  H.suggestArchHome = function () {
    if (!H.state.chords.length) return;
    const last = H.state.chords[H.state.chords.length - 1];
    const t = H.state.tonic;
    // V7 then will want home — just add V7
    H.pushUndo();
    let ch = H.M().makeChord((t + 7) % 12, 'dom7', {
      duration: H.stepDuration() > 2 ? 2 : H.stepDuration(),
      region: 'diatonic',
      roman: 'V7',
      tag: 'arch-home',
    });
    if (H.C().bestInversion) ch = H.C().bestInversion(last, ch);
    ch.duration = ch.duration || 2;
    H.stampKey(ch, H.writeKey());
    H.state.chords.push(ch);
    // Then tonic
    let home = H.M().makeChord(t, H.state.mode === 'major' ? 'maj' : 'min', {
      duration: H.stepDuration(),
      region: 'diatonic',
      roman: 'i',
      tag: 'home',
    });
    if (H.C().bestInversion) home = H.C().bestInversion(ch, home);
    home.duration = H.stepDuration();
    H.stampKey(home, H.writeKey());
    H.state.chords.push(home);
    H.state.selected = H.state.chords.length - 1;
    H.setSelectedIndices([H.state.selected], H.state.selected);
    H.state.fromPackId = null;
    H.afterEdit();
    H.A().ensure();
    H.A().playSequence([ch, home], H.state.bpm, { pulse: false });
    H.setSyncStatus('Arch home · V7 → tonic');
  };

  /** Recolour one path index. Used by right-click. */
  H.applyStepColour = function (kind, index) {
    if (!H.state.chords.length || !H.C()) return;
    const C = H.C();
    const n = H.state.chords.length;
    const i = index != null && index >= 0 && index < n ? index : H.state.selected;
    if (i == null || i < 0 || i >= n) return;
    const cur = H.state.chords[i];
    const key = H.keyOf ? H.keyOf(cur) : { tonic: H.state.tonic, mode: H.state.mode };
    const t = key.tonic;
    const m = key.mode;
    let ch = null;
    if (kind === 'darker' && C.darkenChord) ch = C.darkenChord(cur, t, m);
    else if (kind === 'brighter' && C.brightenChord) ch = C.brightenChord(cur, t, m);
    else if (kind === 'secondary' && C.secondaryDominantOf) {
      ch = C.secondaryDominantOf(H.state.chords[i + 1] || H.state.chords[0], cur.duration);
    } else if (kind === 'tritone' && C.tritoneSubOf) {
      const base =
        String(cur.quality || '').indexOf('dom') === 0
          ? cur
          : C.secondaryDominantOf(H.state.chords[i + 1] || H.state.chords[0], cur.duration) ||
            cur;
      ch = C.tritoneSubOf(base);
    } else if (kind === 'dim' && C.diminishChord) ch = C.diminishChord(cur);
    if (!ch) {
      H.setSyncStatus('No change for this step');
      return;
    }
    H.applyChordAtIndex(i, ch, { job: kind });
    if (H.showToast) H.showToast('Step ' + (i + 1) + ' · ' + (ch.name || kind));
  };

  /** Apply a compose variation to the WHOLE path. Single-step colour is right-click. */
  H.applyPathVariation = function (kind) {
    if (!H.state.chords.length || !H.C()) return;
    const C = H.C();
    const t = H.state.tonic;
    const m = H.state.mode;
    let next = null;
    const src = H.state.chords.map((c) => H.M().cloneChord(c));
    if (kind === 'darker' && C.darkenProgression) {
      next = C.darkenProgression(src, t, m);
    } else if (kind === 'brighter' && C.brightenProgression) {
      next = C.brightenProgression(src, t, m);
    } else if (kind === 'closer' && C.closerProgression) {
      next = C.closerProgression(src, t, m);
    } else if (kind === 'backdoor' && C.backdoorProgression) {
      next = C.backdoorProgression(src, t, m);
    } else if (kind === 'inner-v' && C.plantInnerSecondary) {
      next = C.plantInnerSecondary(src, t);
    } else if (kind === 'reharm' && C.reharmProgression) {
      next = C.reharmProgression(src, t, m);
    } else if (kind === 'reharm' && C.reharmBar) {
      next = C.reharmBar(src, t, m);
    } else if (kind === 'reharm' && C.varyOneChord) {
      next = C.varyOneChord(src, t, m, Math.min(2, src.length - 1));
    } else if (kind === 'rhythm' && C.varyRhythmOnly) {
      next = C.varyRhythmOnly(src);
    } else if (kind === 'bass-colour' && C.varySameBassNewUpper) {
      next = C.varySameBassNewUpper(src, t, m);
    } else if (kind === 'smooth' && H.smoothVoicings) {
      H.smoothVoicings();
      return;
    }
    if (!next || !next.length) {
      H.setSyncStatus('Variation not available');
      return;
    }
    const sig = C.pathSig
      ? C.pathSig
      : function (arr) {
          return (arr || [])
            .map(function (c) {
              return c.root + ':' + (c.quality || '');
            })
            .join('|');
        };
    if (sig(next) === sig(src)) {
      H.setSyncStatus('Already that colour · try another tool or right-click a step');
      return;
    }
    H.pushUndo();
    H.state.chords = next.map((c, i) => {
      const prev = src[i];
      const key =
        c.localTonic != null
          ? { tonic: c.localTonic, mode: c.localMode || (prev && prev.localMode) || m }
          : prev
            ? H.keyOf(prev)
            : H.writeKey();
      H.stampKey(c, key);
      return c;
    });
    H.state.fromPackId = null;
    if (H.state.selected >= H.state.chords.length) {
      H.state.selected = H.state.chords.length - 1;
    }
    H.setSelectedIndices([H.state.selected], H.state.selected);
    H.afterEdit();
    H.A().ensure();
    if (H.A().playSeq || H.playSeq) {
      if (H.playSeq) H.playSeq({ once: true, force: true, label: 'Hear variation' });
    } else if (H.state.chords[H.state.selected]) {
      H.A().playChord({ chord: H.state.chords[H.state.selected] });
    }
    const labels = {
      darker: 'Darker join · one colour that still leads',
      brighter: 'Brighter join',
      closer: 'Closer · last step is V7 into home',
      backdoor: 'Backdoor · last step is ♭VII7',
      'inner-v': 'Inner V · one V7 of a later chord',
      reharm: 'Reharmed one step',
      rhythm: 'Rhythm shape',
      'bass-colour': 'Same bass · new colour',
    };
    H.setSyncStatus((labels[kind] || 'Varied') + ' · undo if needed');
  };

  H.refreshSequence = function () {
    H.renderTitle();
    H.renderSlots();
    H.renderInspector();
    H.renderVlReadout();
    H.renderCritique();
    H.updateMapStatus();
    H.renderPlaceReadout();
    H.updateEmptyStart();
    H.updateCoach();
    if (H.renderVersionBar) H.renderVersionBar();
    if (H.syncDurationBar) H.syncDurationBar();
    if (H.syncSelectionChrome) H.syncSelectionChrome();
  };

  /** Empty-path quick actions visibility */
  H.updateEmptyStart = function () {
    const el = H.$('#empty-start');
    if (el) el.hidden = !!H.state.chords.length;
    const canResume =
      !(H.state.chords && H.state.chords.length) &&
      H.hasResumableSession &&
      H.hasResumableSession();
    const resume = H.$('#btn-resume-session');
    if (resume) resume.hidden = !canResume;
    const resumeHdr = H.$('#btn-resume-header');
    if (resumeHdr) resumeHdr.hidden = !canResume;
  };

  /** First-run coach strip */
  H.updateCoach = function () {
    const el = H.$('#coach');
    if (!el) return;
    let dismissed = !!H.state.coachDismissed;
    try {
      if (global.localStorage && localStorage.getItem('hl-coach-dismissed') === '1') {
        dismissed = true;
        H.state.coachDismissed = true;
      }
    } catch (_) {}
    // Hide after user has a real path (still re-show if they clear? no — stay dismissed)
    if (dismissed || H.state.chords.length >= 4) el.hidden = true;
    else el.hidden = false;
  };

  H.dismissCoach = function () {
    H.state.coachDismissed = true;
    try {
      if (global.localStorage) localStorage.setItem('hl-coach-dismissed', '1');
    } catch (_) {}
    H.updateCoach();
  };

  /**
   * Live “where am I” line under the sequence list.
   * Selected = edit target; playing = transport (may differ while looping).
   */
  H.renderPlaceReadout = function () {
    const el = H.$('#place-readout');
    if (!el) return;
    if (!H.state.chords.length) {
      el.innerHTML =
        'Empty · <strong>+ Start on I</strong> or click a seat · Write home is <strong>' +
        H.escapeHtml(H.keyLabel()) +
        '</strong>';
      return;
    }
    const si =
      H.state.selected >= 0 && H.state.selected < H.state.chords.length
        ? H.state.selected
        : 0;
    const ch = H.state.chords[si];
    const own = H.keyOf(ch);
    const beats = ch.duration != null ? ch.duration : 4;
    const pi =
      H.map && H.map.playing >= 0
        ? H.map.playing
        : H._playingIndex != null
          ? H._playingIndex
          : -1;
    const playBit =
      pi >= 0 && H.state.chords[pi]
        ? ' · <span class="pl-play">playing ' +
          (pi + 1) +
          '. ' +
          H.escapeHtml(H.state.chords[pi].name || '?') +
          '</span>'
        : '';
    const staged = H.hasPendingHome && H.hasPendingHome()
      ? ' · <span class="pl-play">staged ' +
        H.escapeHtml(H.keyLabelFor(H.dropdownKey())) +
        ' — Land here</span>'
      : '';
    el.innerHTML =
      'Selected <strong>' +
      (si + 1) +
      '/' +
      H.state.chords.length +
      '</strong> · ' +
      H.escapeHtml(ch.name || '?') +
      (ch.roman ? ' (' + H.escapeHtml(ch.roman) + ')' : '') +
      ' · ' +
      beats +
      'b · ' +
      H.escapeHtml(H.keyLabelFor(own)) +
      playBit +
      staged;
  };

  H.updateMapStatus = function () {
    const el = H.$('#map-status');
    if (!el) return;
    if (!H.state.chords.length) {
      el.textContent =
        'Empty path — + Start on I, click a coloured seat around home, or open Feels';
      H.renderPlaceReadout();
      return;
    }
    const i = Math.max(0, Math.min(H.state.selected, H.state.chords.length - 1));
    const ch = H.state.chords[i];
    if (!ch) {
      el.textContent = 'Select a step in the list or on the path';
      H.renderPlaceReadout();
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
        ? ' · tip: click another seat, +V, or drag this chord toward a purple pad to leave home'
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
    H.renderPlaceReadout();
  };

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
    const strip = H.S() && H.S().stripLineageFromName;
    const base = strip ? strip(H.state.title) : H.state.title;
    // Theme only — lineage lives in the locked chip
    if (titleEl && titleEl.tagName === 'INPUT') {
      if (document.activeElement !== titleEl) titleEl.value = base || '';
    } else if (titleEl) {
      titleEl.textContent = base || H.state.title;
    }
    const lock = H.$('#seq-lineage');
    if (lock) {
      let txt = '';
      if (H.S() && H.S().lineageLockText && H.state.cellId) {
        const song = H.S().loadSong ? H.S().loadSong() : null;
        const cell = song && song.cells[H.state.cellId];
        if (cell) txt = H.S().lineageLockText(cell) || '';
      }
      lock.textContent = txt;
      lock.hidden = !txt;
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
    const n = H.state.chords.length;
    // Multi-select: additive (Ctrl/Cmd) or range (Shift)
    if (opts.additive) {
      const set = H.getSelectedIndices();
      const at = set.indexOf(i);
      if (at >= 0 && set.length > 1) set.splice(at, 1);
      else if (at < 0) set.push(i);
      H.setSelectedIndices(set, i);
    } else if (opts.range) {
      const anchor =
        H.state._selAnchor != null ? H.state._selAnchor : H.state.selected;
      const a = Math.max(0, Math.min(n - 1, anchor));
      const b = i;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const range = [];
      for (let k = lo; k <= hi; k++) range.push(k);
      H.setSelectedIndices(range, i);
    } else {
      H.setSelectedIndices([i], i);
      H.state._selAnchor = i;
    }
    const ch = H.state.chords[H.state.selected];
    // Soft preview while the sequence is already playing (don't stack a loud hit)
    if (opts.play !== false && ch && !opts.additive && !opts.range) {
      H.A().ensure();
      const soft = !!(H.A().isPlaying && H.A().isPlaying());
      H.A().playChord({
        chord: ch,
        soft: soft,
        duration: soft ? 0.35 : undefined,
      });
    }
    if (H.map) {
      H.map.current = H.state.selected;
      // Don't rebuild ghost halo on every select — that made browse feel laggy
    }
    H.syncSelectionChrome();
    H.renderInspector();
    H.renderVlReadout();
    H.updateMapStatus();
    H.renderPlaceReadout();
    if (H.syncDurationBar) H.syncDurationBar();
    // Show weighted next-arrows for the primary selected step
    if (
      H.previewNextFromStep &&
      H.map &&
      H.map.mapView !== 'function' &&
      !opts.additive &&
      !opts.skipPreview
    ) {
      if (H._previewSelTimer) clearTimeout(H._previewSelTimer);
      H._previewSelTimer = setTimeout(function () {
        H._previewSelTimer = null;
        if (H.map && H.map._mode === 'node') return;
        H.previewNextFromStep(H.state.selected, { silent: true });
      }, 140);
    }
  };

  /** Update strip + slots selection classes (incl. multi-select). */
  H.syncSelectionChrome = function () {
    const sel = H.getSelectedIndices();
    const primary = H.state.selected;
    const host = H.$('#slots');
    if (host) {
      host.querySelectorAll('.slot').forEach((el) => {
        const idx = parseInt(el.dataset.index, 10);
        el.classList.toggle('selected', sel.indexOf(idx) >= 0);
        el.classList.toggle('primary-sel', idx === primary);
      });
    }
    const strip = H.$('#time-strip');
    if (strip) {
      strip.querySelectorAll('.ts-step').forEach((el) => {
        const idx = parseInt(el.dataset.i, 10);
        el.classList.toggle('selected', sel.indexOf(idx) >= 0);
        el.classList.toggle('primary-sel', idx === primary);
        el.classList.toggle('multi', sel.length > 1 && sel.indexOf(idx) >= 0);
      });
    }
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
      host.innerHTML =
        '<p class="hint">Select a step on the <strong>timeline</strong> (or map). Edit root, quality, duration, bass here. Multi-select on timeline to set length in batch.</p>';
      return;
    }
    const multi = H.getSelectedIndices ? H.getSelectedIndices() : [H.state.selected];
    const multiNote =
      multi.length > 1
        ? '<p class="hint" style="margin:0 0 0.35rem;color:#7eb8da">' +
          multi.length +
          ' steps selected · duration chips apply to all · root/quality edit the primary (gold)</p>'
        : '';
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
      ${multiNote}
      <div class="insp-name">${ch.name}${multi.length > 1 ? ' · primary' : ''}</div>
      <div class="insp-row">
        <label class="field">Root
          <select id="insp-root">${rootOpts}</select>
        </label>
        <label class="field">Quality
          <select id="insp-q">${qOpts}</select>
        </label>
      </div>
      <label class="field">Duration (beats)${multi.length > 1 ? ' · all selected' : ''}
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
    // Read live select values (don't close over a stale chord snapshot)
    host.querySelector('#insp-root').addEventListener('change', (e) => {
      const qEl = host.querySelector('#insp-q');
      const q = qEl ? qEl.value : ch.quality;
      H.setSelectedRootQuality(parseInt(e.target.value, 10), q);
    });
    host.querySelector('#insp-q').addEventListener('change', (e) => {
      const rEl = host.querySelector('#insp-root');
      const root = rEl ? parseInt(rEl.value, 10) : ch.root;
      H.setSelectedRootQuality(root, e.target.value);
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
        // Multi-select: set all selected steps live
        const idxs = H.getSelectedIndices ? H.getSelectedIndices() : [H.state.selected];
        H.setDurationForIndices(idxs, v, { skipUndo: true, silent: true });
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
    const host = H.$('#list-from-here');
    if (!host) return;
    host.innerHTML = '';

    const st = H.getStyle ? H.getStyle() : null;
    const goalId = H.activeGoalId ? H.activeGoalId() : 'balanced';
    const goalNames = {
      balanced: 'Balanced',
      stay_close: 'Stay close',
      get_darker: 'Darker',
      delay_home: 'Delay home',
      epic_lift: 'Lift',
      float: 'Float',
      hard_return: 'Home',
    };
    const lens = document.createElement('div');
    lens.className = 'hz-section hz-lens';
    lens.innerHTML =
      '<div class="hz-section-title">Style · ' +
      H.escapeHtml((st && st.label) || 'Neutral') +
      ' · ' +
      H.escapeHtml(goalNames[goalId] || goalId) +
      '</div><div class="hz-section-hint">Ranks next moves. Pick a goal to override the style default.</div>';
    host.appendChild(lens);
    const goals = ['stay_close', 'get_darker', 'hard_return', 'float', 'balanced'];
    const row = document.createElement('div');
    row.className = 'hz-goal-row';
    goals.forEach(function (id) {
      const g = document.createElement('button');
      g.type = 'button';
      g.className = 'chip' + (goalId === id ? ' on' : '');
      g.textContent = goalNames[id] || id;
      g.addEventListener('click', function () {
        H.state.goalId = H.state.goalId === id ? null : id;
        H.renderHorizonLists();
        H.setSyncStatus(
          'Goal · ' +
            (H.state.goalId ? goalNames[H.state.goalId] : 'style default') +
            ' · From here re-ranked'
        );
      });
      row.appendChild(g);
    });
    host.appendChild(row);

    const joins = H.buildLoopJoins ? H.buildLoopJoins() : [];
    if (joins.length) {
      const last = H.state.chords[H.state.chords.length - 1];
      const first = H.state.chords[0];
      const jh = document.createElement('div');
      jh.className = 'hz-section';
      jh.innerHTML =
        '<div class="hz-section-title">Ways home</div><div class="hz-section-hint">Loop join · ' +
        H.escapeHtml((last && last.name) || '?') +
        ' → ' +
        H.escapeHtml((first && first.name) || 'start') +
        ' · click replaces last · “keep +” inserts a seam</div>';
      host.appendChild(jh);
      joins.forEach(function (it) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'hz kind-join';
        b.innerHTML =
          '<span class="hz-tag">Join</span><strong>' +
          H.escapeHtml(it.label) +
          '</strong><span>' +
          H.escapeHtml(it.job || '') +
          '</span>';
        b.addEventListener('mouseenter', function () {
          if (!H.A() || !it.chord) return;
          H.A().ensure();
          const home = first || (H.makeHomeChord && H.makeHomeChord({ duration: 1 }));
          const a = H.M().cloneChord ? H.M().cloneChord(it.chord) : it.chord;
          a.duration = 1.15;
          if (H.A().isPlaying && H.A().isPlaying()) {
            H.A().playChord({ chord: a, soft: true, duration: 0.32 });
            if (H._joinPrevTimer) clearTimeout(H._joinPrevTimer);
            H._joinPrevTimer = setTimeout(function () {
              if (home) {
                H.A().playChord({ chord: home, soft: true, duration: 0.42 });
              }
            }, 340);
            return;
          }
          if (home && H.A().playSequence) {
            const bch = H.M().cloneChord ? H.M().cloneChord(home) : home;
            bch.duration = 1.5;
            H.A().playSequence([a, bch], Math.max(H.state.bpm || 96, 100), {
              pulse: false,
              loop: false,
            });
          } else {
            H.A().playChord({ chord: a, soft: true, duration: 0.4, identify: true });
          }
        });
        b.addEventListener('click', function () {
          if (H.applyLoopJoin) H.applyLoopJoin(it);
        });
        host.appendChild(b);
      });
    }

    const items = H.buildHorizon();
    const order = {
      home: -1,
      recipe: 0,
      secondaryii: 1,
      diminished: 1,
      secondary: 2,
      interchange: 3,
      gate: 4,
      tritone: 5,
      valt: 5,
      direction: 6,
      flavour: 7,
      cadence: 8,
      modulate: 9,
    };
    items.sort(
      (a, b) =>
        (order[a.kind] != null ? order[a.kind] : 9) - (order[b.kind] != null ? order[b.kind] : 9)
    );

    const hasNext = H.state.selected >= 0 && H.state.selected < H.state.chords.length - 1;
    const tipDefault = hasNext
      ? 'Click = insert after selection · Shift+click = overwrite what follows · hover = audition'
      : 'Click = append · Shift+click = overwrite · hover = audition';
    const kindLabel = {
      join: 'Join',
      home: 'Home',
      secondary: 'V7/x',
      secondaryii: 'ii–V/x',
      interchange: 'Borrow',
      gate: 'Gate',
      recipe: 'Recipe',
      tritone: 'Tritone',
      diminished: 'Dim',
      valt: 'V alt',
      direction: 'Dir',
      flavour: 'Colour',
      cadence: 'Cadence',
      modulate: 'Mod',
    };
    const sectionMeta = {
      secondary: { title: 'Secondary dominants', hint: 'Pull into a scale chord (V7 → target)' },
      interchange: { title: 'Modal interchange', hint: 'Borrowed colour from the parallel mode' },
      gate: { title: 'Gates (I · IV · V)', hint: 'Ways in and out of borrowed colour' },
      recipe: {
        title: 'Strand recipes',
        hint: 'ii–V/x · V alts · backdoor · dim→I — multi-chord packages',
      },
      move: { title: 'Moves & cadences', hint: 'Directions, colour, home routes, modulate' },
    };
    const sectionOf = (it) => {
      if (it.kind === 'secondary') return 'secondary';
      if (it.kind === 'interchange') return 'interchange';
      if (it.kind === 'gate') return 'gate';
      if (
        it.kind === 'recipe' ||
        it.kind === 'secondaryii' ||
        it.kind === 'tritone' ||
        it.kind === 'diminished' ||
        it.kind === 'valt' ||
        it.section === 'recipe'
      ) {
        return 'recipe';
      }
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
        const pieces =
          it.route && it.route.length ? it.route : it.chord ? [it.chord] : [];
        const first = pieces[0];
        if (!first || !H.A()) return;
        H.A().ensure();
        H.A().playChord({ chord: first, soft: true, duration: 0.4, identify: true });
      });
      b.addEventListener('click', (e) => {
        const shift = !!(e && e.shiftKey);
        const go = function () {
          H.commitHorizon(it, {
            insert: !shift,
            replace: shift,
          });
        };
        if (
          !shift &&
          it.route &&
          it.route.length > 1 &&
          H.offerRouteConfirm
        ) {
          H.offerRouteConfirm(it, go);
          return;
        }
        go();
      });
      host.appendChild(b);
    });
  }

})(typeof window !== "undefined" ? window : globalThis);
