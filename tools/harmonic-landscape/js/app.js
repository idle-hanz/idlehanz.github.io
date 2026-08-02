/**
 * Harmonic Landscape — boot (H.init + H.wire only)
 * Load last after hl-core.js and all hl-*.js modules.
 */
(function (global) {
  "use strict";
  var H = global.HLApp;
  if (!H) throw new Error("HLApp missing - load hl-core.js first");

  H.init = function () {
    H.map = new HLSpatial.SpatialMap(H.$('#map'));
    H.map.setOrigin(H.state.tonic, H.state.mode);
    H.map.onSelectPath = (i, ch) => {
      H.state.selected = i;
      H.A().ensure();
      H.A().playChord({ chord: ch });
      H.refreshUI();
    };
    H.map.onSelectHorizon = (item) => H.commitHorizon(item);
    H.map.onHoverHorizon = (item) => {
      H.A().ensure();
      H.A().playChord({ chord: item.chord, soft: true, duration: 0.45 });
    };
    // Click the gold home disc to start (or land) on the tonic
    H.map.onSelectHome = () => H.startAtHome();
    H.map.onHoverHome = () => {
      H.A().ensure();
      H.A().playChord({ chord: H.makeHomeChord(), soft: true, duration: 0.4 });
    };
    // Click centre of an older Chase disk → switch write home back (path ownership stays)
    H.map.onSelectDiskHome = (disk) => {
      if (!disk) return;
      H.setWritingHome(disk.tonic, disk.mode || H.state.mode, { transpose: false });
      H.setSyncStatus(
        'Write home → ' +
          H.keyLabel() +
          ' · older disk reactivated · path steps keep their disks · Land here retags from selection'
      );
    };
    H.map.onRequestAlts = (pathIndex, chord) => H.buildAimTargets(pathIndex, chord);
    H.map.onSwapChord = (pathIndex, newChord) => {
      H.applyChordAtIndex(pathIndex, newChord, { pullNeighbors: false });
    };
    // Only called when user released on a locked aim target (swap in place — never append)
    H.map.onPullChord = (pathIndex, chord, meta) => {
      H.applyChordAtIndex(pathIndex, chord, {
        pullNeighbors: !!(meta && meta.pullNeighbors),
        pullStrength: 0.5,
      });
      const where =
        H.map && H.map.mapView === 'function' ? ' on Function chart' : ' on Chase chart';
      H.setSyncStatus(
        'Moved to ' +
          (chord.name || '') +
          (meta && meta.role ? ' · ' + meta.role : '') +
          where
      );
    };
    // Click empty scale seat → add that chord
    H.map.onSelectSeat = (seatInfo) => H.selectChaseSeat(seatInfo);
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
    H.map.onHoverSeat = (seatInfo) => {
      if (!seatInfo || !seatInfo.chord) return;
      H.A().ensure();
      H.A().playChord({ chord: seatInfo.chord, soft: true, duration: 0.35 });
    };
    let aimTimer = null;
    H.map.onAimChange = (pathIndex, target, meta) => {
      if (aimTimer) {
        clearTimeout(aimTimer);
        aimTimer = null;
      }
      // Stop any previous context audition so targets don't stack
      if (H.A().stopPlayback) H.A().stopPlayback();
      if (!target) {
        H.setSyncStatus('Aim cancelled — nothing changed');
        return;
      }
      H.A().ensure();
      // Immediate soft hit of the aimed chord
      H.A().playChord({ chord: target.chord, soft: true, duration: 0.5 });
      const roleBit = target.role ? ' · ' + target.role : '';
      const tier = target.tier || (target.score != null ? H.tierAimScore(target.score) : '');
      const fitBit =
        tier === 'good'
          ? ' · ★ strong join with neighbours'
          : tier === 'ok'
            ? ' · ok with neighbours'
            : tier === 'weak'
              ? ' · weak join (still allowed)'
              : '';
      H.setSyncStatus(
        'Aiming ' + target.label + roleBit + fitBit + ' — hold to hear context, release to set'
      );
      // After a short hold, audition prev → target → next (where you're going)
      aimTimer = setTimeout(() => {
        if (!H.map.snapAlt || H.map.snapAlt !== target) return;
        const seq = [];
        if (meta && meta.prevChord) seq.push(meta.prevChord);
        seq.push(target.chord);
        if (meta && meta.nextChord) seq.push(meta.nextChord);
        if (seq.length >= 2) {
          H.A().playSequence(
            seq.map((c) => {
              const x = H.M().cloneChord(c);
              x.duration = 1.4;
              return x;
            }),
            Math.max(H.state.bpm, 110),
            { pulse: false, loop: false }
          );
          H.setSyncStatus(
            'Audition: ' +
              seq.map((c) => c.name).join(' → ') +
              ' · release to set ' +
              target.label
          );
        }
      }, 280);
    };
    H.map.onInsertBetween = (afterIndex) => {
      H.insertBetweenWithTiming(afterIndex);
    };
    H.map.onTrajectory = (info) => {
      const el = H.$('#traj-caption');
      if (el && info) el.textContent = info.caption || '';
      H.renderTimeStrip();
    };
    H.map.setCameraMode('home');
    H.map.start();

    H.fillControls();
    H.wire();
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
    H.setSyncStatus(
      loaded
        ? 'Loaded shared session'
        : 'Empty · pick Write home · click seats / From here / a feel pack to start'
    );

    document.body.addEventListener('pointerdown', () => H.A().ensure(), { once: true });
    requestAnimationFrame(() => {
      H.map.resize();
      H.refreshMap();
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
    });
    H.$('#loop').addEventListener('change', (e) => {
      H.state.loop = e.target.checked;
      H.updatePlayBtn();
    });
    H.$('#pulse').addEventListener('change', (e) => {
      H.state.pulse = e.target.checked;
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
    if (H.$('#btn-smooth')) H.$('#btn-smooth').addEventListener('click', H.smoothVoicings);
    if (H.$('#btn-H.undo-edit')) H.$('#btn-H.undo-edit').addEventListener('click', H.undo);
    if (H.$('#btn-H.redo-edit')) H.$('#btn-H.redo-edit').addEventListener('click', H.redo);
    if (H.$('#btn-H.undo')) H.$('#btn-H.undo').addEventListener('click', H.undo);
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
    H.$('#btn-home').addEventListener('click', () => {
      H.map.setCameraMode('home');
      H.map.focusHome();
      H.syncCamButtons();
    });
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
      H.$('#step-dur').querySelectorAll('[data-step-dur]').forEach((btn) => {
        btn.addEventListener('click', () => H.setDefaultDuration(parseFloat(btn.dataset.stepDur)));
      });
      H.setDefaultDuration(H.state.defaultDuration, { silent: true });
    }
    if (H.$('#btn-swing')) H.$('#btn-swing').addEventListener('click', H.suggestSwingNext);
    if (H.$('#btn-arch')) H.$('#btn-arch').addEventListener('click', H.suggestArchHome);
    if (H.$('#view-chase')) {
      H.$('#view-chase').addEventListener('click', () => H.setMapView('chase'));
    }
    if (H.$('#view-function')) {
      H.$('#view-function').addEventListener('click', () => H.setMapView('function'));
    }
    // Function layers: Dominants + Borrow (home ring always on)
    const foMap = {
      'fo-dominants': 'dominants',
      'fo-borrow': 'borrow',
    };
    Object.keys(foMap).forEach((id) => {
      const el = H.$('#' + id);
      if (!el) return;
      el.addEventListener('change', () => {
        H.setFunctionOpt(foMap[id], el.checked);
      });
    });
    if (H.syncFunctionOptsUI) H.syncFunctionOptsUI();
    if (H.$('#function-opts')) H.$('#function-opts').hidden = true;
    if (H.$('#tog-horizon')) {
      H.$('#tog-horizon').addEventListener('change', (e) => {
        H.map.setShowHorizon(e.target.checked);
      });
      H.map.setShowHorizon(H.$('#tog-horizon').checked);
    }
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
      if (e.target.matches('input, textarea, select')) return;
      if (e.key === ' ' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (e.shiftKey) H.playFromSelection();
        else if (H.A().isPlaying()) H.stopPlaybackUI();
        else H.playSeq({ fromIndex: 0, force: true });
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        H.undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        H.redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault();
        H.duplicateSelected();
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
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
        H.state.selected = Math.max(0, H.state.selected - 1);
        H.refreshUI();
        H.A().ensure();
        H.A().playChord({ chord: H.state.chords[H.state.selected] });
      } else if (e.key === 'ArrowRight' && H.state.chords.length) {
        e.preventDefault();
        H.state.selected = Math.min(H.state.chords.length - 1, H.state.selected + 1);
        H.refreshUI();
        H.A().ensure();
        H.A().playChord({ chord: H.state.chords[H.state.selected] });
      } else if (e.key === 'Escape') {
        H.stopPlaybackUI();
      }
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { H.init(); });
  } else {
    H.init();
  }
})(typeof window !== 'undefined' ? window : globalThis);