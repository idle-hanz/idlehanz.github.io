/**
 * hl-session.js - session, packs, write-home (attaches to HLApp)
 */
(function (global) {
  "use strict";
  var H = global.HLApp;
  if (!H) throw new Error("HLApp missing - load hl-core.js first");
H.setSyncStatus = function (msg) {
    H.state.syncMsg = msg || '';
    const el = H.$('#sync-status');
    if (el) el.textContent = H.state.syncMsg;
  }

  /** Apply session chords (plain objects) into working Landscape chords */
  H.applySessionChords = function (chords, meta) {
    meta = meta || {};
    H.state.chords = (chords || []).map((sc) => H.sessionChordToLandscape(sc));
    // Prefer explicit cell name from session — never overwrite with pack recognition
    if (meta.title) {
      H.state.title = meta.title;
      H.state.nameLocked = true;
    }
    if (meta.cellId) H.state.cellId = meta.cellId;
    if (meta.packId) H.state.fromPackId = meta.packId;
    if (meta.tonic != null) {
      H.state.tonic = meta.tonic;
      const tEl = H.$('#tonic');
      if (tEl) tEl.value = String(H.state.tonic);
    }
    if (meta.mode) {
      H.state.mode = meta.mode;
      const mEl = H.$('#mode');
      if (mEl) mEl.value = H.state.mode;
    }
    if (meta.bpm != null) {
      H.state.bpm = meta.bpm;
      const bEl = H.$('#bpm');
      if (bEl) bEl.value = H.state.bpm;
    }
    // Session load is committed home — drop any staged dropdown land
    H.state.selected = Math.max(0, Math.min(H.state.chords.length - 1, meta.focusIndex || 0));
    H.map.setOrigin(H.state.tonic, H.state.mode);
    H.recognize({ preserveName: true });
    H.clearPendingHome();
  }

  H.ingestHandoffOrSession = function () {
    if (!H.S()) return false;

    // 1) URL hash handoff (works on file://)
    const handoff = H.S().readHandoffFromLocation() || H.S().readHandoffStorage();
    if (handoff && handoff.to === 'landscape' && handoff.chords && handoff.chords.length) {
      const chords = H.S().expandHandoffChords(handoff);
      H.applySessionChords(chords, {
        title: handoff.cellName || handoff.title,
        cellId: handoff.cellId,
        tonic: handoff.key && handoff.key.tonic,
        mode: handoff.key && handoff.key.mode,
        bpm: handoff.bpm,
        focusIndex: handoff.focus || 0,
      });
      H.S().clearHandoffHash();
      H.pushToSharedSession('landscape');
      return true;
    }

    // 2) Focused cell in full song session
    const song = H.S().loadSong();
    if (song) {
      const cell = H.S().getFocusedCell(song);
      if (cell && cell.chords && cell.chords.length) {
        H.applySessionChords(cell.chords, {
          title: cell.name || song.title,
          cellId: cell.id,
          packId: cell.packId,
          tonic: song.key && song.key.tonic,
          mode: song.key && song.key.mode,
          bpm: song.bpm,
          focusIndex: song.focus && song.focus.chordIndex,
        });
        return true;
      }
    }
    return false;
  }

  H.pushToSharedSession = function (by) {
    if (!H.S() || !H.state.chords.length) return null;
    let song = H.S().loadSong() || H.S().emptySong({
      title: 'Untitled',
      bpm: H.state.bpm,
      tonic: H.state.tonic,
      mode: H.state.mode,
      updatedBy: by || 'landscape',
    });
    // Song title is the piece name — do not overwrite with cell name
    if (!song.title || song.title === 'Untitled') {
      song.title = song.title || 'Untitled';
    }
    song.bpm = H.state.bpm;
    song.key = { tonic: H.state.tonic, mode: H.state.mode };
    const cellId = H.state.cellId || H.S().newCellId('cell');
    H.state.cellId = cellId;
    // Preserve existing cell name if set and current title is still a pack auto-name
    const existing = song.cells[cellId];
    let cellName = H.state.title || 'Cell';
    if (existing && existing.name && H.state.nameLocked) {
      cellName = H.state.title || existing.name;
    } else if (existing && existing.name && (!H.state.title || H.state.title === 'Untitled sequence')) {
      cellName = existing.name;
      H.state.title = existing.name;
    }
    const prevCell = song.cells[cellId];
    song.cells[cellId] = {
      id: cellId,
      name: cellName,
      packId: H.state.fromPackId || null,
      familyId: prevCell && prevCell.familyId ? prevCell.familyId : null,
      versionIndex: prevCell && prevCell.versionIndex ? prevCell.versionIndex : 1,
      chords: H.state.chords.map((c) => H.S().fromLandscapeChord(c)),
    };
    song.focus = {
      cellId,
      sectionId: song.focus && song.focus.sectionId ? song.focus.sectionId : null,
      chordIndex: Math.max(0, H.state.selected),
    };
    H.S().saveSong(song, by || 'landscape');
    H.setSyncStatus('Session saved · ' + cellName);
    return song;
  }

  H.pullFromSharedSession = function () {
    if (!H.S()) {
      H.setSyncStatus('Session module missing (ih-session.js)');
      return;
    }
    const song = H.S().loadSong();
    const cell = song && H.S().getFocusedCell(song);
    if (!cell || !cell.chords.length) {
      H.setSyncStatus('No focused cell in session — send from Fretboard first');
      return;
    }
    H.applySessionChords(cell.chords, {
      title: cell.name || song.title,
      cellId: cell.id,
      packId: cell.packId,
      tonic: song.key && song.key.tonic,
      mode: song.key && song.key.mode,
      bpm: song.bpm,
      focusIndex: song.focus && song.focus.chordIndex,
    });
    H.refreshAll();
    H.setSyncStatus('Pulled “' + (cell.name || 'cell') + '” from session');
    H.playSeq({ once: true });
  }

  H.sendToFretboard = function () {
    if (!H.state.chords.length) {
      alert('Add some chords first.');
      return;
    }
    if (!H.S()) {
      alert('ih-session.js not loaded. Keep it next to the harmonic-landscape folder on Desktop.');
      return;
    }
    H.pushToSharedSession('landscape');
    const chords = H.state.chords.map((c) => H.S().fromLandscapeChord(c));
    const payload = H.S().buildHandoffPayload({
      by: 'landscape',
      to: 'fretboard',
      title: H.state.title,
      bpm: H.state.bpm,
      key: { tonic: H.state.tonic, mode: H.state.mode },
      cellId: H.state.cellId,
      cellName: H.state.title,
      focus: H.state.selected,
      chords,
    });
    const ok = H.S().openWithHandoff(H.S().PATHS.fretboardFromLandscape, payload);
    H.setSyncStatus(ok ? 'Opened Fretboard with sequence' : 'Could not open Fretboard — check Desktop paths');
    H.$('#export-out').value = JSON.stringify(payload, null, 2);
  }

  H.fillControls = function () {
    H.M().NOTE_NAMES.forEach((n, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = n;
      if (i === H.state.tonic) o.selected = true;
      H.$('#tonic').appendChild(o);
      const o2 = o.cloneNode(true);
      if (i === H.state.addRoot) o2.selected = true;
      H.$('#add-root').appendChild(o2);
    });
    Object.keys(H.M().MODES).forEach((k) => {
      const o = document.createElement('option');
      o.value = k;
      o.textContent = H.M().MODES[k].name;
      if (k === H.state.mode) o.selected = true;
      H.$('#mode').appendChild(o);
    });
    Object.keys(H.M().QUALITIES).forEach((k) => {
      const o = document.createElement('option');
      o.value = k;
      o.textContent = H.M().QUALITIES[k].symbol || H.M().QUALITIES[k].label || k;
      if (k === 'min') o.selected = true;
      H.$('#add-quality').appendChild(o);
    });
    const feel = H.$('#feel-filter');
    const fo = document.createElement('option');
    fo.value = 'all';
    fo.textContent = 'All feels';
    feel.appendChild(fo);
    H.P().FEELS.forEach((f) => {
      const o = document.createElement('option');
      o.value = f;
      o.textContent = f;
      feel.appendChild(o);
    });
  }

  // ─── Sequence ops ────────────────────────────────────────
  H.keyLabel = function () {
    return H.keyLabelFor(H.writeKey());
  }

  /** Key currently shown in the Write home / Mode dropdowns (may be staged). */
  H.dropdownKey = function () {
    const tEl = H.$('#tonic');
    const mEl = H.$('#mode');
    let t = H.state.tonic;
    if (tEl && tEl.value !== '') t = parseInt(tEl.value, 10);
    else if (H.state.pendingTonic != null) t = H.state.pendingTonic;
    let m = H.state.mode;
    if (mEl && mEl.value) m = mEl.value;
    else if (H.state.pendingMode != null) m = H.state.pendingMode;
    return { tonic: H.pcNorm(t), mode: m || H.state.mode };
  }

  H.hasPendingHome = function () {
    const d = H.dropdownKey();
    return d.tonic !== H.state.tonic || d.mode !== H.state.mode;
  }

  H.clearPendingHome = function () {
    H.state.pendingTonic = null;
    H.state.pendingMode = null;
    H.updateLandButton();
  }

  /** Highlight Land here when dropdowns differ from the live H.map home. */
  H.updateLandButton = function () {
    const btn = H.$('#btn-land-home');
    if (!btn) return;
    const pending = H.hasPendingHome();
    btn.classList.toggle('primary', pending);
    btn.classList.toggle('ghost', !pending);
    btn.title = pending
      ? 'Commit staged key ' +
        H.keyLabelFor(H.dropdownKey()) +
        ' — open that Chase disk (H.map stays put until you click)'
      : 'Land here — use Write home + Mode as the new disk from the selected step';
  }

  /**
   * Writing home = active Chase disk + From here gravity.
   * Existing chords keep their localTonic so each key's pattern stays on its own disk.
   * New chords after this use the new write home.
   * Call this only on commit (Land here, modulate package, empty-path setup) — not while staging dropdowns.
   */
  H.setWritingHome = function (tonic, mode, opts) {
    opts = opts || {};
    const prevT = H.state.tonic;
    const prevM = H.state.mode;
    const nextT = ((tonic % 12) + 12) % 12;
    const nextM = mode || H.state.mode;
    const delta = (nextT - prevT + 12) % 12;

    // Stamp ownership BEFORE switching gravity (so old path stays on old disk)
    H.state.chords.forEach((ch) => {
      if (!ch) return;
      if (ch.localTonic == null) H.stampKey(ch, { tonic: prevT, mode: prevM });
      else if (!ch.localMode) ch.localMode = prevM;
    });

    if (opts.transpose && delta && H.state.chords.length) {
      H.pushUndo();
      H.state.chords = H.state.chords.map((ch) => H.transposeChord(ch, delta, nextT, nextM));
    }

    // Modulation pivot: selected + later steps move to the new disk; earlier stay
    if (opts.retagFromSelected && !opts.transpose && H.state.chords.length) {
      const from =
        H.state.selected >= 0 && H.state.selected < H.state.chords.length
          ? H.state.selected
          : H.state.chords.length - 1;
      for (let i = 0; i < H.state.chords.length; i++) {
        const freeze = i < from;
        H.stampKey(H.state.chords[i], {
          tonic: freeze ? prevT : nextT,
          mode: freeze ? prevM : nextM,
        });
      }
    }

    H.state.tonic = nextT;
    H.state.mode = nextM;
    // Sync dropdowns before clearing pending so Land-here highlight is correct
    if (H.$('#tonic')) H.$('#tonic').value = String(H.state.tonic);
    if (H.$('#mode')) H.$('#mode').value = H.state.mode;
    H.clearPendingHome();

    const keyChanged = prevT !== nextT || prevM !== nextM;

    // Function = same-key atlas. Real key change → Chase (two wheels).
    let switchedToChase = false;
    if (keyChanged && H.map && H.map.mapView === 'function' && H.maybeChaseAfterKeyChange) {
      switchedToChase = H.maybeChaseAfterKeyChange({
        silent: true,
        message:
          'New key → Chase · ' +
          H.keyLabel() +
          ' · multi-disk journey · Function stays same-key only',
      });
    }

    // Tell H.map about both keys before path layout
    if (H.map) {
      if (H.map.rememberKey) {
        H.map.rememberKey(prevT, prevM);
        H.map.rememberKey(nextT, nextM);
      }
      // maybeChaseAfterKeyChange already refreshed; still ensure origin/path
      H.map.setOrigin(H.state.tonic, H.state.mode);
      H.map.setPath(H.state.chords, H.state.selected);
      H.map.setHorizon([]); // Chase map: seats + ghosts only
      if (H.map.disks && H.map.disks.length > 1 && H.map.cameraMode === 'home') {
        // Zoom out enough to see both disks
        H.map.camera.tz = Math.min(H.map.camera.tz || 1, 0.72);
        H.map.camera.tx = 0;
        H.map.camera.ty = 0;
        H.map.camera.x = 0;
        H.map.camera.y = 0;
        H.map.camera.zoom = H.map.camera.tz;
      }
    }

    if (opts.skipEdit) {
      H.renderTitle();
      H.renderHorizonLists();
      H.updateMapStatus();
      H.renderTimeStrip();
      H.refreshAltPath();
      if (switchedToChase) {
        H.setSyncStatus(
          'Write home → ' +
            H.keyLabel() +
            ' · switched to Chase · multi-disk journey · Function is same-key only'
        );
      }
    } else {
      H.afterEdit();
      if (switchedToChase) {
        H.setSyncStatus(
          'Write home → ' +
            H.keyLabel() +
            ' · switched to Chase · multi-disk journey · Function is same-key only'
        );
      }
    }
    return {
      prevT: prevT,
      prevM: prevM,
      delta: delta,
      transposed: !!opts.transpose,
      keyChanged: keyChanged,
      switchedToChase: switchedToChase,
    };
  }

  H.transposeChord = function (ch, delta, newTonic, newMode) {
    const ownT = ch.localTonic != null ? ch.localTonic : H.state.tonic;
    const destTonic = newTonic != null ? H.pcNorm(newTonic) : H.pcNorm(ownT + delta);
    const destMode = newMode || ch.localMode || H.state.mode;

    let n;
    if (ch.custom || ch.quality === 'custom') {
      const notes = (ch.notes || []).map((pc) => H.pcNorm(pc + delta));
      const root = H.pcNorm(ch.root + delta);
      const bass = ch.bassPc != null ? H.pcNorm(ch.bassPc + delta) : root;
      n = H.M().makeCustomChord
        ? H.M().makeCustomChord(root, notes, {
            duration: ch.duration,
            roman: ch.roman,
            region: ch.region,
            tag: ch.tag,
            name: null,
            bassPc: bass,
          })
        : (() => {
            const x = H.M().cloneChord(ch);
            x.root = root;
            x.notes = notes;
            x.bassPc = bass;
            return x;
          })();
    } else {
      n = H.M().makeChord(H.pcNorm(ch.root + delta), ch.quality, {
        duration: ch.duration,
        roman: ch.roman,
        tag: ch.tag,
        region: ch.region,
      });
      if (ch.bassPc != null && H.C().withBass) {
        n = H.C().withBass(n, H.pcNorm(ch.bassPc + delta));
        n.duration = ch.duration;
        n.roman = ch.roman;
        n.tag = ch.tag;
        n.region = ch.region;
      }
    }
    n.localTonic = destTonic;
    n.localMode = destMode;
    return n;
  }

  /** Transpose whole sequence by delta semitones (keeps writing home fixed unless opts.moveHome). */
  H.transposeSequence = function (delta, opts) {
    opts = opts || {};
    delta = ((delta % 12) + 12) % 12;
    if (!delta || !H.state.chords.length) return;
    H.pushUndo();
    // Each step keeps its relative disk: rotate localTonic with the pitches
    H.state.chords = H.state.chords.map((ch) => {
      if (opts.moveHome || opts.forceWriteHome) {
        return H.transposeChord(
          ch,
          delta,
          opts.moveHome ? (H.state.tonic + delta) % 12 : H.state.tonic,
          H.state.mode
        );
      }
      // Preserve multi-disk: null newTonic → rotate each chord's own key
      return H.transposeChord(ch, delta, null, ch.localMode || H.state.mode);
    });
    if (opts.moveHome) {
      H.state.tonic = (H.state.tonic + delta) % 12;
      if (H.$('#tonic')) H.$('#tonic').value = String(H.state.tonic);
      if (H.map) {
        if (H.map.rememberKey) H.map.rememberKey(H.state.tonic, H.state.mode);
        H.map.setOrigin(H.state.tonic, H.state.mode);
      }
    } else if (H.map) {
      // Disks move with rotated ownership
      H.ensurePathOwned();
      H.state.chords.forEach((ch) => {
        if (H.map.rememberKey) H.map.rememberKey(ch.localTonic, ch.localMode);
      });
      H.map.setPath(H.state.chords, H.state.selected);
    }
    H.afterEdit();
    H.setSyncStatus(
      'Transposed ' +
        (delta > 6 ? delta - 12 : delta) +
        ' semitones' +
        (opts.moveHome ? ' · write home moved' : ' · write home still ' + H.keyLabel())
    );
  }

  /**
   * Commit Write home + Mode from the dropdowns.
   * Flow: pick key/mode (H.map stays put) → select the pivot step → Land here.
   * Chords keep absolute pitches; selected + later join the new disk; earlier stay.
   */
  H.landSelectionAsHome = function () {
    const dest = H.dropdownKey();
    const sameHome = dest.tonic === H.state.tonic && dest.mode === H.state.mode;

    // Empty path: just set the compass (nothing to retag)
    if (!H.state.chords.length) {
      H.state._prevTonicForTranspose = H.state.tonic;
      H.setWritingHome(dest.tonic, dest.mode, { transpose: false });
      H.setSyncStatus('Write home → ' + H.keyLabel() + ' · empty path · click Home or a seat to start');
      return;
    }

    if (sameHome) {
      H.setSyncStatus(
        'Already on ' +
          H.keyLabel() +
          ' · pick a different Write home / Mode, then Land here · or Transpose all to move pitches'
      );
      H.updateLandButton();
      return;
    }

    H.state._prevTonicForTranspose = H.state.tonic;
    H.pushUndo();
    // Pivot = selection (or last step): that step + later sit on the new disk
    const result = H.setWritingHome(dest.tonic, dest.mode, {
      transpose: false,
      retagFromSelected: true,
    });
    const disks = H.map && H.map.disks ? H.map.disks.length : 1;
    const pivot =
      H.state.selected >= 0 && H.state.selected < H.state.chords.length
        ? H.state.selected + 1
        : H.state.chords.length;
    H.setSyncStatus(
      'Land here · disk ' +
        H.keyLabel() +
        (disks > 1 ? ' · ' + disks + ' Chase disks' : '') +
        ' · from step ' +
        pivot +
        ' onward · earlier steps stay on previous key · pitches unchanged' +
        (result && result.switchedToChase ? ' · switched to Chase' : '')
    );
  }

  /** Stage Write home / Mode without moving the map (until Land here). */
  H.stageWriteHomeFromDropdowns = function (opts) {
    opts = opts || {};
    const dest = H.dropdownKey();
    H.state.pendingTonic = dest.tonic;
    H.state.pendingMode = dest.mode;

    // Empty path: nothing to protect — apply immediately so Home / seats work
    if (!H.state.chords.length) {
      H.state._prevTonicForTranspose = H.state.tonic;
      H.setWritingHome(dest.tonic, dest.mode, { transpose: false });
      if (!opts.silent) {
        H.setSyncStatus('Write home → ' + H.keyLabel() + ' · empty path');
      }
      return;
    }

    H.updateLandButton();
    if (!opts.silent) {
      if (H.hasPendingHome()) {
        H.setSyncStatus(
          'Staged ' +
            H.keyLabelFor(dest) +
            ' · H.map still ' +
            H.keyLabel() +
            ' (nothing moved) · select pivot step, then Land here'
        );
      } else {
        H.setSyncStatus('Write home already ' + H.keyLabel() + ' · change key/mode to stage a land');
      }
    }
  }

  /** Old behaviour: move every chord so they follow the Write home dropdown. */
  H.transposeAllToWriteHome = function (fromTonic) {
    const prev = fromTonic != null ? fromTonic : H.state._prevTonicForTranspose;
    if (prev == null || prev === H.state.tonic) {
      H.setSyncStatus('Pick a new Write home first, then Transpose all — or use Land here to modulate without moving chords');
      return;
    }
    const delta = (H.state.tonic - prev + 12) % 12;
    if (!delta) return;
    // Collapse to one disk: all steps move pitches + ownership onto write home
    H.pushUndo();
    H.state.chords = H.state.chords.map((ch) =>
      H.transposeChord(ch, delta, H.state.tonic, H.state.mode)
    );
    H.afterEdit();
    H.setSyncStatus('Transposed sequence into ' + H.keyLabel() + ' · all chords moved onto write-home disk');
    H.state._prevTonicForTranspose = H.state.tonic;
  }

  H.uniqueCellName = function (base) {
    if (!H.S()) return base;
    const song = H.S().loadSong();
    if (!song || !song.cells) return base;
    const names = new Set(Object.keys(song.cells).map((id) => (song.cells[id].name || '').toLowerCase()));
    if (!names.has(base.toLowerCase())) return base;
    let n = 2;
    while (names.has((base + ' ' + n).toLowerCase())) n++;
    return base + ' ' + n;
  }

  H.loadPack = function (id, opts) {
    const pack = H.P().getPack(id);
    if (!pack) return;
    H.state.chords = H.P().materialize(pack, H.state.tonic, H.state.mode);
    H.state.fromPackId = id;
    // New cell each pack load — unique name so they don't all read "Home grit"
    H.state.cellId = H.S() ? H.S().newCellId(id) : null;
    H.state.title = H.uniqueCellName(pack.name);
    H.state.nameLocked = false;
    H.state.recognition = { pack, exact: true, match: 'exact', confidence: 1 };
    H.state.selected = Math.max(0, H.state.chords.length - 1);
    H.refreshAll();
    if (H.S()) H.pushToSharedSession('landscape');
    if (!opts || !opts.silent) H.playSeq({ once: true });
  }

  /** Chord for a Chase scale seat (default quality on that seat). */
})(typeof window !== "undefined" ? window : globalThis);
