/**
 * Harmonic Landscape — boot (H.init + H.wire only)
 * Load last after hl-core.js and all hl-*.js modules.
 */
(function (global) {
  "use strict";
  var H = global.HLApp;
  if (!H) throw new Error("HLApp missing - load hl-core.js first");

  H.init = function () {
    if (H.initStyleFromStorage) H.initStyleFromStorage();
    H.map = new HLSpatial.SpatialMap(H.$('#map'));
    H.map.setOrigin(H.state.tonic, H.state.mode);
    // Right-click → colour / next / packs palette
    H.map.onContextMenu = (hit, e) => {
      if (!H.openContextMenu) return;
      const base = { clientX: e.clientX, clientY: e.clientY };
      if (hit && hit.type === 'path' && hit.item) {
        H.openContextMenu(
          Object.assign(
            {
              kind: 'path',
              pathIndex: hit.item.i,
              chord: hit.item.chord,
            },
            base
          )
        );
        return;
      }
      if (hit && hit.type === 'seat' && hit.item) {
        H.openContextMenu(
          Object.assign(
            {
              kind: 'seat',
              seatInfo: hit.item,
              chord: hit.item.chord,
              root: hit.item.root,
              roman: hit.item.roman,
            },
            base
          )
        );
        return;
      }
      if (hit && hit.type === 'functionNode' && hit.item) {
        H.openContextMenu(
          Object.assign(
            {
              kind: 'function',
              chord: hit.item.chord,
              root: hit.item.chord && hit.item.chord.root,
              label: hit.item.label,
              job: hit.item.job,
              horizonKind: hit.item.kind,
              route: hit.item.route,
            },
            base
          )
        );
        return;
      }
      if (hit && hit.type === 'home') {
        const home = H.makeHomeChord ? H.makeHomeChord() : null;
        H.openContextMenu(
          Object.assign(
            {
              kind: 'function',
              chord: home,
              root: home && home.root,
              label: home && home.name,
              job: 'home',
              horizonKind: 'home',
            },
            base
          )
        );
        return;
      }
      // Empty space: still open palette on selected step or write-home tonic
      const sel =
        H.state.selected >= 0 && H.state.chords[H.state.selected]
          ? H.state.chords[H.state.selected]
          : H.makeHomeChord
            ? H.makeHomeChord()
            : null;
      if (sel) {
        H.openContextMenu(
          Object.assign(
            {
              kind: H.state.chords[H.state.selected] ? 'path' : 'function',
              pathIndex: H.state.chords[H.state.selected] ? H.state.selected : undefined,
              chord: sel,
              root: sel.root,
              label: sel.name,
              job: 'background',
            },
            base
          )
        );
      } else {
        H.openContextMenu(Object.assign({ kind: 'empty' }, base));
      }
    };
    H.map.onSelectPath = (i, ch, opts) => {
      // Light select — full refreshUI on every map click wrecked long sequences
      // deferUI = pointer-down or post-drag click; never re-home the camera
      if (opts && opts.deferUI) {
        H.state.selected = i;
        if (H.map) H.map.current = i;
        H.updateMapStatus();
        if (H.renderPlaceReadout) H.renderPlaceReadout();
        return;
      }
      if (H.selectStep) H.selectStep(i, { play: true });
      else {
        H.state.selected = i;
        H.A().ensure();
        H.A().playChord({ chord: ch });
        H.refreshUI();
      }
      if (H.previewNextFromStep) H.previewNextFromStep(i, { silent: true });
    };
    // Plain map click (no drag): soft play + arrows without full layout thrash
    H.map.onSelectPathClick = (i, ch) => {
      H.state.selected = i;
      if (H.map) H.map.current = i;
      if (ch && H.A()) {
        H.A().ensure();
        H.A().playChord({ chord: ch, soft: true, duration: 0.35 });
      }
      // Light chrome only — selectStep would also rebuild arrows (ok, silent)
      if (H.selectStep) H.selectStep(i, { play: false });
      else {
        H.renderSlots();
        H.renderInspector();
        H.updateMapStatus();
      }
    };
    // Hover a path chord → weighted arrows to seats (debounced so it doesn't thrash)
    let _hoverPathTimer = null;
    let _hoverPathLast = -1;
    H.cancelHoverPreview = function () {
      if (_hoverPathTimer) {
        clearTimeout(_hoverPathTimer);
        _hoverPathTimer = null;
      }
      _hoverPathLast = -1;
      if (H.clearNextPreview) H.clearNextPreview();
    };
    H.map.onHoverPath = (pathIndex, chord) => {
      // Never rebuild during drag / aim — causes instant "jump" on click
      if (H.map && H.map._mode === 'node') return;
      if (pathIndex == null || pathIndex < 0) {
        H.cancelHoverPreview();
        return;
      }
      // Soft preview only when entering a new step
      if (chord && pathIndex !== _hoverPathLast && H.A()) {
        H.A().ensure();
        H.A().playChord({ chord: chord, soft: true, duration: 0.32 });
      }
      _hoverPathLast = pathIndex;
      if (_hoverPathTimer) clearTimeout(_hoverPathTimer);
      _hoverPathTimer = setTimeout(() => {
        _hoverPathTimer = null;
        if (H.map && H.map._mode === 'node') return;
        if (H.previewNextFromStep) H.previewNextFromStep(pathIndex);
      }, 90);
    };
    H.map.onSelectHoverSuggest = (pad, clickOpts) => {
      if (!pad || !pad.item) return;
      clickOpts = clickOpts || {};
      if (pad.pathIndex != null && pad.pathIndex >= 0) {
        H.state.selected = pad.pathIndex;
      }
      const previewCh =
        pad.item.chord ||
        (pad.item.route && pad.item.route[0]) ||
        null;
      if (!H.shouldWriteFromMap(clickOpts)) {
        if (H.previewMapChord) {
          H.previewMapChord(
            previewCh,
            pad.item.modulateTo ? 'Preview leave-home' : 'Preview next'
          );
        }
        return;
      }
      if (H.clearNextPreview) H.clearNextPreview();
      if (pad.item.modulateTo && pad.item.route && H.leaveHomeToKey) {
        H.leaveHomeToKey(
          pad.item.modulateTo,
          pad.item.route,
          pad.pathIndex != null ? pad.pathIndex : H.state.selected
        );
        return;
      }
      H.commitHorizon(pad.item, { insert: true });
    };
    // In-this-key: Select = preview; Write / double-click = write
    H.map.onSelectHorizon = (item, clickOpts) => {
      clickOpts = clickOpts || {};
      if (!item) return;
      if (!H.shouldWriteFromMap(clickOpts)) {
        const ch = item.chord || (item.route && item.route[0]);
        if (H.previewMapChord) H.previewMapChord(ch, 'Preview');
        return;
      }
      let intent = 'auto';
      if (clickOpts.altKey) intent = 'append';
      else if (clickOpts.shiftKey) intent = 'insert';
      if (item.route && item.route.length > 1) {
        H.state.selected =
          H.state.selected >= 0 ? H.state.selected : H.state.chords.length - 1;
        H.commitHorizon(item, {
          mode: intent === 'append' ? 'append' : intent === 'insert' ? 'insert' : 'auto',
        });
        return;
      }
      if (item.chord && H.writeChordToPath) {
        H.writeChordToPath(item.chord, {
          intent: intent,
          kind: item.kind || 'direction',
          label: item.label || item.chord.name,
          job: item.job || item.kind || '',
        });
      } else {
        H.commitHorizon(item, { mode: intent === 'edit' ? 'replace' : 'append' });
      }
    };
    let _hoverFnKey = '';
    let _hoverFnAt = 0;
    H.map.onHoverHorizon = (item) => {
      if (!item || !item.chord) return;
      const key =
        item.chord.root + ':' + item.chord.quality + ':' + (item.functionNodeId || '');
      const now = Date.now();
      if (key === _hoverFnKey) return;
      if (now - _hoverFnAt < 220) return;
      _hoverFnKey = key;
      _hoverFnAt = now;
      if (H.A()) {
        H.A().ensure();
        H.A().playChord({
          chord: item.chord,
          soft: true,
          duration: 0.4,
          identify: true,
        });
      }
    };
    // Gold home disc: Select = preview tonic; Write / double-click = plant
    H.map.onSelectHome = (clickOpts) => {
      clickOpts = clickOpts || {};
      if (!H.shouldWriteFromMap(clickOpts)) {
        if (H.makeHomeChord && H.previewMapChord) {
          H.previewMapChord(H.makeHomeChord(), 'Preview home');
        }
        return;
      }
      if (H.startAtHome) H.startAtHome();
    };
    let _hoverHomeAt = 0;
    H.map.onHoverHome = () => {
      const now = Date.now();
      if (now - _hoverHomeAt < 450) return;
      _hoverHomeAt = now;
      if (H.A() && H.makeHomeChord) {
        H.A().ensure();
        H.A().playChord({
          chord: H.makeHomeChord(),
          soft: true,
          duration: 0.4,
          identify: true,
        });
      }
    };
    // Click centre of an older Chase disk → switch write home back (path ownership stays)
    H.map.onSelectDiskHome = (disk) => {
      if (!disk) return;
      H.pushUndo();
      H.setWritingHome(disk.tonic, disk.mode || H.state.mode, { transpose: false });
      H.setSyncStatus(
        'Write home → ' +
          H.keyLabel() +
          ' · older disk reactivated · path steps keep their disks · new steps use this gravity'
      );
    };
    // Ghost adjacent-key wheel: establish home (V7→I or tonic)
    H.map.onSelectGhostOption = (opt, clickOpts) => {
      clickOpts = clickOpts || {};
      if (!opt) return;
      if (!H.shouldWriteFromMap(clickOpts)) {
        const ch = opt.route && opt.route[0];
        if (H.previewMapChord) {
          H.previewMapChord(ch, 'Preview new key');
        }
        H.setSyncStatus(
          (opt.label || 'New key') +
            ' · preview · double-click to leave home · or switch to Write'
        );
        return;
      }
      H.establishKeyFromGhost(opt);
    };
    H.map.onHoverGhostOption = (opt) => {
      if (!opt) return;
      H.A().ensure();
      const route = opt.route || [];
      if (route[0]) {
        H.A().playChord({ chord: route[0], soft: true, duration: 0.4 });
      }
      H.setSyncStatus(
        (opt.ghostDisk
          ? H.M().noteName(opt.ghostDisk.tonic) +
            ((opt.ghostDisk.mode || '').indexOf('min') === 0 ||
            (H.M().MODES[opt.ghostDisk.mode] || {}).romanBase === 'minor'
              ? 'm'
              : '') +
            ' · '
          : '') +
          (opt.label || '') +
          ' · ' +
          (opt.character || opt.job || 'establish home') +
          ' · preview · double-click to leave home · Write mode = click'
      );
    };
    H.map.onRequestAlts = (pathIndex, chord) => H.buildAimTargets(pathIndex, chord);
    H.map.onSwapChord = (pathIndex, newChord) => {
      H.applyChordAtIndex(pathIndex, newChord, {});
    };
    // Release on aim target: same-key swap, or leave-home establish (append package)
    H.map.onPullChord = (pathIndex, chord, meta) => {
      const snap = H.map && H.map.snapAlt;
      const establish =
        (meta && meta.establish) ||
        (snap && snap.establish) ||
        (chord && chord.tag === 'establish' && snap && snap.modulateTo);
      const dest =
        (meta && meta.modulateTo) ||
        (snap && snap.modulateTo) ||
        null;
      const route =
        (meta && meta.establishRoute) ||
        (snap && snap.establishRoute) ||
        (chord ? [chord] : null);
      if (establish && dest && route && route.length && H.leaveHomeToKey) {
        H.state.selected = pathIndex;
        H.leaveHomeToKey(dest, route, pathIndex);
        return;
      }
      H.applyChordAtIndex(pathIndex, chord, {});
      const where =
        H.map && H.map.mapView === 'function' ? ' on In-this-key chart' : ' on Journey map';
      H.setSyncStatus(
        'Moved to ' +
          (chord.name || '') +
          (meta && meta.role ? ' · ' + meta.role : '') +
          where
      );
    };
    // Click empty scale seat → add that chord
    H.map.onSelectSeat = (seatInfo, clickOpts) => H.selectChaseSeat(seatInfo, clickOpts);
    // Blue compare node: audition + explain (does not edit the gold path)
    H.map.onSelectAltNode = (item) => {
      if (!item || !item.chord) return;
      H.A().ensure();
      H.A().playChord({ chord: item.chord, soft: false, duration: 0.55 });
      const gold = H.state.chords[item.i];
      const bit = gold
        ? ' · gold step ' +
          (item.i + 1) +
          ' is ' +
          (gold.name || '?') +
          (gold.root === item.chord.root && gold.quality === item.chord.quality
            ? ' (same)'
            : ' → blue ' + (item.chord.name || '?'))
        : '';
      H.setSyncStatus(
        'Blue compare · ' + (item.chord.name || '?') + bit + ' · Alt-click a version chip to change'
      );
    };
    // Seat hover: play once per degree (not on every pointer-move / rebuild flicker)
    let _hoverSeatKey = '';
    let _hoverSeatAt = 0;
    H._clearHoverSeatKey = function () {
      _hoverSeatKey = '';
      _hoverFnKey = '';
    };
    H.map.onHoverSeat = (seatInfo) => {
      if (!seatInfo || !seatInfo.chord) return;
      const key =
        (seatInfo.root != null ? seatInfo.root : seatInfo.chord.root) +
        ':' +
        (seatInfo.chord.quality || '') +
        ':' +
        (seatInfo.disk && seatInfo.disk.tonic) +
        ':' +
        (seatInfo.disk && seatInfo.disk.mode);
      const now = Date.now();
      // Same seat: ignore. Different seat within 220ms: ignore (edge flicker).
      if (key === _hoverSeatKey) return;
      if (now - _hoverSeatAt < 220) return;
      _hoverSeatKey = key;
      _hoverSeatAt = now;
      if (H.A()) {
        H.A().ensure();
        H.A().playChord({
          chord: seatInfo.chord,
          soft: true,
          duration: 0.45,
          identify: true,
        });
      }
      // Don't touch #sync-status on hover — DOM writes can reflow the map stage
      // and look like camera jumps. Status line only for commits.
      if (H.map && H.map.setMapStatusLine) {
        const label =
          (seatInfo.roman ? seatInfo.roman + ' · ' : '') +
          (seatInfo.chord.name || '?');
        H.map.setMapStatusLine('Seat · ' + label);
      } else {
        const ms = H.$('#map-status');
        if (ms) {
          ms.textContent =
            'Seat · ' +
            (seatInfo.roman ? seatInfo.roman + ' · ' : '') +
            (seatInfo.chord.name || '?');
        }
      }
    };
    let aimTimer = null;
    H.map.onAimChange = (pathIndex, target, meta) => {
      if (aimTimer) {
        clearTimeout(aimTimer);
        aimTimer = null;
      }
      // Don't kill the main loop — only stop a previous aim audition (external transport)
      const mainPlaying =
        H.A().isPlaying &&
        H.A().isPlaying() &&
        H._transportMeta &&
        !H._transportMeta.external;
      if (!mainPlaying && H.A().stopPlayback) H.A().stopPlayback();
      if (!target) {
        H.setSyncStatus('Aim cancelled — nothing changed');
        return;
      }
      H.A().ensure();
      // Immediate soft hit of the aimed chord (layer-friendly; does not stop transport)
      H.A().playChord({ chord: target.chord, soft: true, duration: 0.5 });
      const roleBit = target.role ? ' · ' + target.role : '';
      const aimMode = (meta && meta.aimMode) || target.aimMode || '';
      const tier =
        target.tier ||
        (target.score != null ? H.tierAimScore(target.score, aimMode) : '');
      const fitBit =
        tier === 'good'
          ? aimMode === 'loop'
            ? ' · ★ strong loop join'
            : aimMode === 'building'
              ? ' · ★ strong from previous / open end'
              : ' · ★ strong join with neighbours'
          : tier === 'ok'
            ? aimMode === 'loop'
              ? ' · ok loop join'
              : aimMode === 'building'
                ? ' · ok continuation'
                : ' · ok with neighbours'
            : tier === 'weak'
              ? ' · weak join (still allowed)'
              : '';
      const modeBit =
        aimMode === 'loop'
          ? ' · LOOP on (last → first)'
          : aimMode === 'building'
            ? ' · open end (loop off)'
            : '';
      H.setSyncStatus(
        'Aiming ' +
          target.label +
          roleBit +
          fitBit +
          modeBit +
          ' — hold to hear context, release to set'
      );
      // After a short hold, audition prev → target → next (skip if main sequence is playing)
      aimTimer = setTimeout(() => {
        if (!H.map.snapAlt || H.map.snapAlt !== target) return;
        if (
          H.A().isPlaying &&
          H.A().isPlaying() &&
          H._transportMeta &&
          !H._transportMeta.external
        ) {
          return; // keep the loop; soft hit already played
        }
        const seq = [];
        if (meta && meta.prevChord) seq.push(meta.prevChord);
        seq.push(target.chord);
        if (meta && meta.nextChord) seq.push(meta.nextChord);
        if (seq.length >= 2) {
          // Mark external so resync/stop UI treat this as a throwaway audition
          H._transportMeta = { fromIndex: 0, loop: false, external: true };
          H.A().playSequence(
            seq.map((c) => {
              const x = H.M().cloneChord(c);
              x.duration = 1.4;
              return x;
            }),
            Math.max(H.state.bpm, 110),
            {
              pulse: false,
              loop: false,
              onEnd: () => {
                if (H._transportMeta && H._transportMeta.external) {
                  H._transportMeta = null;
                }
              },
            }
          );
          const loopNote =
            aimMode === 'loop' ? ' (loop)' : aimMode === 'building' ? ' (open end)' : '';
          H.setSyncStatus(
            'Audition' +
              loopNote +
              ': ' +
              seq.map((c) => c.name).join(' → ') +
              ' · release to set ' +
              target.label
          );
        } else if (aimMode === 'building') {
          H.setSyncStatus(
            'Open end · ' + target.label + ' from previous · release to set'
          );
        }
      }, 280);
    };
    H.map.onInsertBetween = (afterIndex) => {
      return H.insertBetweenWithTiming(afterIndex);
    };
    H.map.onTrajectory = (info) => {
      const el = H.$('#traj-caption');
      if (el && info) el.textContent = info.caption || '';
      // Caption only — full strip rebuild here fought the playhead on long paths
    };
    H.map.setCameraMode('home');
    H.map.start();

    H.fillControls();
    H.wire();
    if (H.wirePolish) H.wirePolish();
    // Prefer handoff / shared session; else start empty (no default pack)
    const loaded = H.ingestHandoffOrSession();
    if (!loaded) {
      // Zero slate: empty path, write home from dropdown defaults only
      H.state.chords = [];
      H.state.selected = -1;
      H.state.title = 'Untitled sequence';
      H.state.fromPackId = null;
      H.state.recognition = null;
      H.state.nameLocked = false;
      if (!H.state.cellId && H.S() && H.S().newCellId) {
        H.state.cellId = H.S().newCellId('cell');
      }
    }
    H.refreshAll();
    H.refreshAltPath();
    if (H.renderDiskLegend) H.renderDiskLegend();
    H.setSyncStatus(
      loaded
        ? 'Loaded shared session'
        : 'Empty · pick Write home · Write mode or double-click a seat / + Home to start'
    );

    document.body.addEventListener('pointerdown', () => H.A().ensure(), { once: true });
    requestAnimationFrame(() => {
      H.map.resize();
      H.refreshMap();
      if (H.map && H.map.canvas) {
        try {
          H.map.canvas.focus({ preventScroll: true });
        } catch (_) {}
      }
    });
  }


  H.wire = function () {
    // Track last write-home for optional "Transpose all" after a home change
    H.state._prevTonicForTranspose = H.state.tonic;

    // Dropdowns only STAGE a new home — H.map does not move until Land here
    H.$('#tonic').addEventListener('change', () => {
      H.stageWriteHomeFromDropdowns();
    });
    H.$('#mode').addEventListener('change', () => {
      H.stageWriteHomeFromDropdowns();
    });
    if (H.$('#btn-land-home')) {
      H.$('#btn-land-home').addEventListener('click', H.landSelectionAsHome);
    }
    H.updateLandButton();
    if (H.$('#btn-transpose-all')) {
      H.$('#btn-transpose-all').addEventListener('click', () => {
        if (!H.state.chords.length) {
          H.setSyncStatus('Nothing to transpose');
          return;
        }
        // If user just changed write home, transpose from previous; else ask delta via confirm
        const prev = H.state._prevTonicForTranspose;
        if (prev != null && prev !== H.state.tonic) {
          H.transposeAllToWriteHome(prev);
          return;
        }
        // No pending home change: transpose so first chord / selected becomes write home pitch?
        const ch =
          H.state.selected >= 0 && H.state.chords[H.state.selected]
            ? H.state.chords[H.state.selected]
            : H.state.chords[0];
        if (!ch) return;
        const delta = (H.state.tonic - ch.root + 12) % 12;
        if (!delta) {
          H.setSyncStatus('Already aligned with write home root');
          return;
        }
        H.pushUndo();
        H.state.chords = H.state.chords.map((c) => H.transposeChord(c, delta, H.state.tonic, H.state.mode));
        H.afterEdit();
        H.setSyncStatus('Transposed so selection/path aligns with write home ' + H.keyLabel());
      });
    }
    H.$('#bpm').addEventListener('change', (e) => {
      H.state.bpm = Math.max(40, Math.min(200, parseInt(e.target.value, 10) || 96));
      // Strip tooltips show seconds @ BPM — refresh labels
      H.renderTimeStrip();
      H.setSyncStatus('Tempo · ' + H.state.bpm + ' BPM · 1 beat = ' + (60 / H.state.bpm).toFixed(3) + 's');
      if (H.resyncPlaybackPreservingPlace) H.resyncPlaybackPreservingPlace();
    });
    H.$('#loop').addEventListener('change', (e) => {
      H.state.loop = e.target.checked;
      H.updatePlayBtn();
      // Apply to a running transport without restarting from zero
      if (H.A() && H.A().isPlaying && H.A().isPlaying() && H.resyncPlaybackPreservingPlace) {
        H.resyncPlaybackPreservingPlace({ loop: H.state.loop });
      }
    });
    H.$('#pulse').addEventListener('change', (e) => {
      H.state.pulse = e.target.checked;
      if (H.A() && H.A().isPlaying && H.A().isPlaying() && H.resyncPlaybackPreservingPlace) {
        H.resyncPlaybackPreservingPlace();
      }
    });
    H.$('#feel-filter').addEventListener('change', H.renderPacks);
    const titleInput = H.$('#seq-title');
    if (titleInput && titleInput.tagName === 'INPUT') {
      titleInput.addEventListener('change', () => H.setCellName(titleInput.value));
      titleInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          titleInput.blur();
        }
      });
    }
    if (H.$('#btn-play'))
      H.$('#btn-play').addEventListener('click', () => {
        if (H.A().isPlaying()) H.stopPlaybackUI();
        else H.playSeq({ fromIndex: 0, force: true });
      });
    if (H.$('#btn-play-from'))
      H.$('#btn-play-from').addEventListener('click', () => H.playFromSelection());
    if (H.$('#btn-ab')) H.$('#btn-ab').addEventListener('click', () => H.playAB());
    if (H.$('#btn-stop')) H.$('#btn-stop').addEventListener('click', () => H.stopPlaybackUI());
    if (H.$('#btn-add')) H.$('#btn-add').addEventListener('click', () => H.addChordFromPicker('end'));
    if (H.$('#btn-insert')) H.$('#btn-insert').addEventListener('click', () => H.addChordFromPicker('after'));
    if (H.$('#btn-dup')) H.$('#btn-dup').addEventListener('click', H.duplicateSelected);
    if (H.$('#btn-del-step')) {
      H.$('#btn-del-step').addEventListener('click', () => {
        if (H.removeSelected) H.removeSelected();
      });
    }
    if (H.$('#btn-undo')) H.$('#btn-undo').addEventListener('click', H.undo);
    if (H.$('#btn-redo-edit')) H.$('#btn-redo-edit').addEventListener('click', H.redo);
    if (H.updateUndoButtons) H.updateUndoButtons();

    // Quick build I / V and empty-path starters
    if (H.$('#btn-quick-i')) H.$('#btn-quick-i').addEventListener('click', H.quickAddTonic);
    if (H.$('#btn-quick-v')) H.$('#btn-quick-v').addEventListener('click', H.quickAddDominant);
    if (H.$('#btn-empty-home'))
      H.$('#btn-empty-home').addEventListener('click', () => {
        if (H.startAtHome) H.startAtHome();
        else if (H.quickAddTonic) H.quickAddTonic();
      });
    if (H.$('#btn-empty-v')) H.$('#btn-empty-v').addEventListener('click', H.quickAddDominant);
    if (H.$('#btn-empty-feel')) {
      H.$('#btn-empty-feel').addEventListener('click', () => {
        const fold = H.$('#fold-feels');
        if (fold) fold.open = true;
        fold && fold.scrollIntoView && fold.scrollIntoView({ block: 'nearest' });
      });
    }
    if (H.$('#btn-empty-demo')) {
      H.$('#btn-empty-demo').addEventListener('click', () => {
        if (H.loadStyleDemo) H.loadStyleDemo('speed-of-pain');
      });
    }
    if (H.$('#coach-start-i')) {
      H.$('#coach-start-i').addEventListener('click', () => {
        if (H.startAtHome) H.startAtHome();
        H.dismissCoach && H.dismissCoach();
      });
    }
    if (H.$('#coach-dismiss')) {
      H.$('#coach-dismiss').addEventListener('click', () => H.dismissCoach && H.dismissCoach());
    }
    if (H.$('#follow-playhead')) {
      H.$('#follow-playhead').checked = !!H.state.followPlayhead;
      H.$('#follow-playhead').addEventListener('change', (e) => {
        H.state.followPlayhead = !!e.target.checked;
        H.setSyncStatus(
          H.state.followPlayhead
            ? 'Follow selection on · inspector tracks the playhead'
            : 'Follow selection off · gold selected stays put while purple plays'
        );
      });
    }
    // Keyboard help
    const showHelp = (on) => {
      const ov = H.$('#help-overlay');
      if (ov) ov.hidden = !on;
    };
    if (H.$('#btn-keys-help')) {
      H.$('#btn-keys-help').addEventListener('click', () => showHelp(true));
    }
    if (H.$('#help-close')) {
      H.$('#help-close').addEventListener('click', () => showHelp(false));
    }
    if (H.$('#help-overlay')) {
      H.$('#help-overlay').addEventListener('click', (e) => {
        if (e.target === H.$('#help-overlay')) showHelp(false);
      });
    }
    H.updateEmptyStart && H.updateEmptyStart();
    H.updateCoach && H.updateCoach();
    H.updateLandButton && H.updateLandButton();
    if (H.$('#btn-clear')) {
      H.$('#btn-clear').addEventListener('click', () => {
        // Empty path only (keeps versions / write home)
        if (!H.state.chords.length || confirm('Clear the path? (Write home and versions stay)')) {
          H.clearSeq();
        }
      });
    }
    if (H.$('#btn-reset-all')) {
      H.$('#btn-reset-all').addEventListener('click', () => {
        const ok = confirm(
          'Full reset to empty?\n\n' +
            '• Clears the path and undo history\n' +
            '• Removes blue compare and map key disks\n' +
            '• Starts a new cell (no feel pack)\n' +
            '• Optional: also wipe saved session cells\n\n' +
            'OK = reset Landscape\n' +
            'Cancel = keep everything'
        );
        if (!ok) return;
        const wipeSession = confirm(
          'Also wipe the shared song session (all version cells in local storage)?\n\n' +
            'OK = clear session too\n' +
            'Cancel = keep saved versions, only reset this editor'
        );
        H.resetToEmpty({ clearSession: wipeSession, resetHome: false });
      });
    }
    if (H.$('#btn-export-txt')) H.$('#btn-export-txt').addEventListener('click', H.exportText);
    if (H.$('#btn-export-mid')) H.$('#btn-export-mid').addEventListener('click', H.exportMidi);
    if (H.$('#btn-save-project')) {
      H.$('#btn-save-project').addEventListener('click', () => {
        if (H.saveProjectFile) H.saveProjectFile();
      });
    }
    if (H.$('#btn-load-project') && H.$('#project-file-input')) {
      H.$('#btn-load-project').addEventListener('click', () => {
        H.$('#project-file-input').value = '';
        H.$('#project-file-input').click();
      });
      H.$('#project-file-input').addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        if (f && H.loadProjectFile) H.loadProjectFile(f);
      });
    }
    if (H.$('#btn-fret')) H.$('#btn-fret').addEventListener('click', H.sendToFretboard);
    if (H.$('#btn-pull-fb')) H.$('#btn-pull-fb').addEventListener('click', H.pullFromSharedSession);
    if (H.$('#btn-arrange')) {
      H.$('#btn-arrange').addEventListener('click', () => {
        if (H.S() && H.state.chords.length) H.pushToSharedSession('landscape');
        const url = H.S() ? H.S().PATHS.arrangementFromLandscape : '../arrangement/index.html';
        if (H.S() && H.S().goTo) H.S().goTo(url);
        else window.location.href = url;
      });
    }
    if (H.$('#btn-home')) {
      H.$('#btn-home').addEventListener('click', () => {
        if (!H.map) return;
        H.map.setCameraMode('home');
        if (H.map.focusHome) H.map.focusHome();
        H.syncCamButtons();
      });
    }
    if (H.$('#cam-home')) {
      H.$('#cam-home').addEventListener('click', () => {
        H.map.setCameraMode('home');
        H.syncCamButtons();
      });
    }
    if (H.$('#cam-fit')) {
      H.$('#cam-fit').addEventListener('click', () => {
        H.map.setCameraMode('fit');
        H.syncCamButtons();
      });
    }
    if (H.$('#cam-follow')) {
      H.$('#cam-follow').addEventListener('click', () => {
        H.map.setCameraMode('follow');
        H.syncCamButtons();
      });
    }
    if (H.$('#btn-start-home')) H.$('#btn-start-home').addEventListener('click', H.startAtHome);
    if (H.$('#step-dur')) {
      // Chips: multi-select → set duration on those steps; else set default for new chords
      H.$('#step-dur').querySelectorAll('[data-step-dur]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const beats = parseFloat(btn.dataset.stepDur);
          const multi = H.getSelectedIndices ? H.getSelectedIndices() : [];
          if (multi.length > 1) {
            // Batch edit selected timeline steps
            H.setDurationForIndices(multi, beats);
          } else if (multi.length === 1) {
            // Edit that step + remember as default for new chords
            H.setDurationForIndices(multi, beats, { silent: true });
            H.setDefaultDuration(beats, { silent: true });
            H.setSyncStatus(
              'Step ' +
                (multi[0] + 1) +
                ' · ' +
                H.snapBeats(beats) +
                'b · default for new too'
            );
          } else {
            H.setDefaultDuration(beats);
          }
          if (H.syncDurationBar) H.syncDurationBar();
        });
      });
      const stepNum = H.$('#step-dur-num');
      if (stepNum) {
        const applyStep = () => {
          const beats = parseFloat(stepNum.value);
          if (!(beats > 0)) return;
          const multi = H.getSelectedIndices ? H.getSelectedIndices() : [];
          if (multi.length >= 1) {
            H.setDurationForIndices(multi, beats);
            if (multi.length === 1) H.setDefaultDuration(beats, { silent: true });
          } else {
            H.setDefaultDuration(beats);
          }
        };
        stepNum.addEventListener('change', applyStep);
        stepNum.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            applyStep();
          }
        });
      }
      H.setDefaultDuration(H.state.defaultDuration, { silent: true });
      if (H.syncDurationBar) H.syncDurationBar();
    }
    // Path tools (reharm / darker / rhythm…)
    const toolMap = {
      'btn-tool-darker': 'darker',
      'btn-tool-reharm': 'reharm',
      'btn-tool-rhythm': 'rhythm',
      'btn-tool-bass': 'bass-colour',
    };
    Object.keys(toolMap).forEach((id) => {
      const el = H.$('#' + id);
      if (el) {
        el.addEventListener('click', () => {
          if (H.applyPathVariation) H.applyPathVariation(toolMap[id]);
        });
      }
    });
    if (H.$('#btn-smooth')) H.$('#btn-smooth').addEventListener('click', H.smoothVoicings);
    if (H.$('#btn-swing')) H.$('#btn-swing').addEventListener('click', H.suggestSwingNext);
    if (H.$('#btn-arch')) H.$('#btn-arch').addEventListener('click', H.suggestArchHome);
    if (H.$('#view-chase')) {
      H.$('#view-chase').addEventListener('click', () => H.setMapView('chase'));
    }
    if (H.$('#view-function')) {
      H.$('#view-function').addEventListener('click', () => H.setMapView('function'));
    }
    // Function layers: Dom + Borrow + Tritone + Dim + V alts + Colours
    const foMap = {
      'fo-dominants': 'dominants',
      'fo-borrow': 'borrow',
      'fo-tritone': 'tritone',
      'fo-dim': 'dim',
      'fo-valts': 'valts',
      'fo-colours': 'colours',
    };
    Object.keys(foMap).forEach((id) => {
      const el = H.$('#' + id);
      if (!el) return;
      el.addEventListener('change', () => {
        H.setFunctionOpt(foMap[id], el.checked);
      });
    });
    if (H.syncFunctionOptsUI) H.syncFunctionOptsUI();
    if (H.syncFunctionPresetUI) H.syncFunctionPresetUI();
    if (H.$('#function-opts')) H.$('#function-opts').hidden = true;

    // Style lens + demos
    if (H.$('#style-select')) {
      // Populate once
      if (H.STYLES) {
        const sel = H.$('#style-select');
        sel.innerHTML = '';
        Object.keys(H.STYLES).forEach((id) => {
          const st = H.STYLES[id];
          const o = document.createElement('option');
          o.value = id;
          o.textContent = st.label;
          o.title = st.blurb || '';
          sel.appendChild(o);
        });
      }
      H.$('#style-select').addEventListener('change', (e) => {
        if (H.setStyle) H.setStyle(e.target.value);
      });
    }
    if (H.syncStyleUI) H.syncStyleUI();
    if (H.$('#btn-demo-sop')) {
      H.$('#btn-demo-sop').addEventListener('click', () => {
        if (H.loadStyleDemo) H.loadStyleDemo('speed-of-pain');
      });
    }

    // Collapse right “From here” rail — more width for In this key / Journey map
    H.setHorizonCollapsed = function (collapsed, opts) {
      opts = opts || {};
      const main = document.querySelector('main');
      const btn = H.$('#btn-toggle-horizon');
      const on = !!collapsed;
      if (main) main.classList.toggle('horizon-collapsed', on);
      if (btn) {
        btn.setAttribute('aria-expanded', on ? 'false' : 'true');
        btn.title = on
          ? 'Expand From here panel'
          : 'Collapse From here panel (more map space)';
        btn.textContent = on ? 'From here' : '›';
      }
      try {
        localStorage.setItem('hl-horizon-collapsed', on ? '1' : '0');
      } catch (_) {
        /* ignore */
      }
      // Canvas must remeasure after grid change
      requestAnimationFrame(() => {
        if (H.map && H.map.resize) H.map.resize();
      });
      if (!opts.silent && H.setSyncStatus) {
        H.setSyncStatus(on ? 'From here collapsed · map wider' : 'From here open');
      }
    };
    if (H.$('#btn-toggle-horizon')) {
      let collapsed = false;
      try {
        collapsed = localStorage.getItem('hl-horizon-collapsed') === '1';
      } catch (_) {
        /* ignore */
      }
      H.$('#btn-toggle-horizon').addEventListener('click', () => {
        const main = document.querySelector('main');
        const now = !(main && main.classList.contains('horizon-collapsed'));
        H.setHorizonCollapsed(now);
      });
      if (collapsed) H.setHorizonCollapsed(true, { silent: true });
    }
    // Next-move map dots retired — seats + ghosts only
    if (H.map && H.map.setShowHorizon) H.map.setShowHorizon(false);
    if (H.$('#tog-alt')) {
      H.$('#tog-alt').addEventListener('change', (e) => {
        H.map.setShowAlt(e.target.checked);
        // Hide overlay immediately when unchecked; restore only if a compare target exists
        if (!e.target.checked) {
          if (H.map) H.map.setAltPath([]);
        } else {
          H.refreshAltPath();
        }
      });
      // Start with blue overlay off until user Alt-clicks a version (or forks)
      // If session already has an explicit compareCellId, honour checkbox H.state.
      if (!H.state.compareCellId) {
        H.map.setShowAlt(false);
        H.$('#tog-alt').checked = false;
        H.map.setAltPath([]);
      } else {
        H.map.setShowAlt(H.$('#tog-alt').checked);
      }
    }

    H.syncCamButtons = function () {
      const mode = H.map.cameraMode || 'home';
      ['home', 'fit', 'follow'].forEach((m) => {
        const el = H.$('#cam-' + m);
        if (el) el.classList.toggle('active', mode === m);
      });
    };
    H.syncCamButtons();

    document.addEventListener('keydown', (e) => {
      const typing =
        e.target &&
        (e.target.matches('input, textarea, select') || e.target.isContentEditable);
      if (e.key === ' ' && !e.ctrlKey && !e.metaKey) {
        if (typing) return;
        e.preventDefault();
        if (e.shiftKey) H.playFromSelection();
        else if (H.A().isPlaying()) H.stopPlaybackUI();
        else H.playSeq({ fromIndex: 0, force: true });
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        if (typing) return;
        e.preventDefault();
        H.undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        if (typing) return;
        e.preventDefault();
        H.redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        if (typing) return;
        e.preventDefault();
        H.duplicateSelected();
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        if (typing && e.target && e.target.matches('select')) {
          e.preventDefault();
          H.removeSelected();
          return;
        }
        if (typing) return;
        e.preventDefault();
        H.removeSelected();
      } else if (e.key === 'ArrowUp' && e.altKey) {
        e.preventDefault();
        H.moveSelected(-1);
      } else if (e.key === 'ArrowDown' && e.altKey) {
        e.preventDefault();
        H.moveSelected(1);
      } else if (e.key === 'ArrowLeft' && H.state.chords.length) {
        e.preventDefault();
        const i = Math.max(0, (H.state.selected >= 0 ? H.state.selected : 0) - 1);
        if (H.selectStep) H.selectStep(i, { play: true });
        else {
          H.state.selected = i;
          H.refreshUI();
        }
      } else if (e.key === 'ArrowRight' && H.state.chords.length) {
        e.preventDefault();
        const i = Math.min(
          H.state.chords.length - 1,
          (H.state.selected >= 0 ? H.state.selected : 0) + 1
        );
        if (H.selectStep) H.selectStep(i, { play: true });
        else {
          H.state.selected = i;
          H.refreshUI();
        }
      } else if (e.key === 'Escape') {
        const help = H.$('#help-overlay');
        if (help && !help.hidden) {
          help.hidden = true;
          return;
        }
        H.stopPlaybackUI();
      } else if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault();
        const help = H.$('#help-overlay');
        if (help) help.hidden = !help.hidden;
      }
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { H.init(); });
  } else {
    H.init();
  }
})(typeof window !== 'undefined' ? window : globalThis);