/**
 * hl-session.js - session, packs, write-home (attaches to HLApp)
 */
(function (global) {
  "use strict";
  var H = global.HLApp;
  if (!H) throw new Error("HLApp missing - load hl-core.js first");
  var LAST_CELL_KEY = 'hl_resume_cell_v1';
  var OPFS_NAME = 'hl-last-cell.json';
  var IDB_NAME = 'hl-resume';
  var IDB_STORE = 'kv';

  H.plainCellFromState = function () {
    if (!H.state || !H.state.chords || !H.state.chords.length) return null;
    const song = H.S() && H.S().loadSong ? H.S().loadSong() : null;
    const prev = song && H.state.cellId && song.cells ? song.cells[H.state.cellId] : null;
    return {
      id: H.state.cellId || 'cell-last',
      name: H.state.title || 'Cell',
      packId: H.state.fromPackId || null,
      familyId: prev && prev.familyId ? prev.familyId : null,
      versionIndex: prev && prev.versionIndex != null ? prev.versionIndex : 1,
      fromVersionIndex: prev && prev.fromVersionIndex != null ? prev.fromVersionIndex : null,
      fromKind: prev && prev.fromKind ? prev.fromKind : null,
      fromCellId: prev && prev.fromCellId ? prev.fromCellId : null,
      chords: H.state.chords.map(function (c) {
        if (!c) return null;
        return {
          root: c.root,
          quality: c.quality || 'maj',
          duration: c.duration != null ? c.duration : 4,
          bass: c.bassPc != null ? c.bassPc : c.bass,
          roman: c.roman || '',
          region: c.region || '',
          tag: c.tag || '',
          name: c.name,
          notes: (c.notes || []).slice(),
          custom: !!(c.custom || c.quality === 'custom'),
          localTonic: c.localTonic,
          localMode: c.localMode,
        };
      }).filter(Boolean),
    };
  };

  H.plainResumePayload = function (cell, meta) {
    if (!cell || !cell.chords || !cell.chords.length) return null;
    meta = meta || {};
    return {
      v: 1,
      savedAt: new Date().toISOString(),
      cell: cell,
      tonic: meta.tonic != null ? meta.tonic : H.state.tonic,
      mode: meta.mode || H.state.mode,
      bpm: meta.bpm != null ? meta.bpm : H.state.bpm,
      title: meta.title || cell.name,
    };
  };

  H._idbOpen = function () {
    return new Promise(function (resolve) {
      if (!global.indexedDB) {
        resolve(null);
        return;
      }
      var req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(IDB_STORE)) {
          req.result.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        resolve(null);
      };
    });
  };

  H._idbSet = function (key, value) {
    return H._idbOpen().then(function (db) {
      if (!db) return false;
      return new Promise(function (resolve) {
        var tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(value, key);
        tx.oncomplete = function () {
          db.close();
          resolve(true);
        };
        tx.onerror = function () {
          db.close();
          resolve(false);
        };
      });
    });
  };

  H._idbGet = function (key) {
    return H._idbOpen().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve) {
        var tx = db.transaction(IDB_STORE, 'readonly');
        var req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = function () {
          db.close();
          resolve(req.result || null);
        };
        req.onerror = function () {
          db.close();
          resolve(null);
        };
      });
    });
  };

  H._opfsWrite = function (text) {
    if (!navigator.storage || !navigator.storage.getDirectory) return Promise.resolve(false);
    return navigator.storage
      .getDirectory()
      .then(function (root) {
        return root.getFileHandle(OPFS_NAME, { create: true });
      })
      .then(function (fh) {
        return fh.createWritable();
      })
      .then(function (w) {
        return w.write(text).then(function () {
          return w.close();
        });
      })
      .then(function () {
        return true;
      })
      .catch(function () {
        return false;
      });
  };

  H._opfsRead = function () {
    if (!navigator.storage || !navigator.storage.getDirectory) return Promise.resolve(null);
    return navigator.storage
      .getDirectory()
      .then(function (root) {
        return root.getFileHandle(OPFS_NAME);
      })
      .then(function (fh) {
        return fh.getFile();
      })
      .then(function (file) {
        return file.text();
      })
      .then(function (text) {
        return H._parseResumePayload(text);
      })
      .catch(function () {
        return null;
      });
  };

  H._parseResumePayload = function (raw) {
    if (!raw) return null;
    try {
      var o = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!o) return null;
      if (o.cell && o.cell.chords && o.cell.chords.length) return o;
      if (o.chords && o.chords.length) {
        return {
          cell: {
            id: o.cellId || 'cell-last',
            name: o.title || 'Cell',
            chords: o.chords,
          },
          tonic: o.tonic,
          mode: o.mode,
          bpm: o.bpm,
          title: o.title,
        };
      }
    } catch (_) {}
    return null;
  };

  H._persistResumeAsync = function (payload, text) {
    if (navigator.storage && navigator.storage.persist) {
      try {
        navigator.storage.persist();
      } catch (_) {}
    }
    H._idbSet('lastCell', payload);
    H._opfsWrite(text);
    if (text && text.length < 3500) {
      try {
        document.cookie =
          'hlr=' + encodeURIComponent(text) + '; max-age=31536000; path=/';
      } catch (_) {}
    }
  };

  H.writeResumeSnapshot = function (cell, meta) {
    var payload = H.plainResumePayload(cell, meta);
    if (!payload) return false;
    var text;
    try {
      text = JSON.stringify(payload);
    } catch (_) {
      return false;
    }
    H._resumeMem = payload;
    var lsOk = false;
    try {
      localStorage.setItem(LAST_CELL_KEY, text);
      lsOk = localStorage.getItem(LAST_CELL_KEY) === text;
    } catch (_) {}
    try {
      sessionStorage.setItem(LAST_CELL_KEY, text);
    } catch (_) {}
    H._persistResumeAsync(payload, text);
    return lsOk || true;
  };

  H.readResumeSnapshot = function () {
    var stores = [];
    try {
      stores.push(localStorage);
    } catch (_) {}
    try {
      stores.push(sessionStorage);
    } catch (_) {}
    for (var s = 0; s < stores.length; s++) {
      try {
        var parsed = H._parseResumePayload(stores[s].getItem(LAST_CELL_KEY));
        if (parsed) return parsed;
      } catch (_) {}
    }
    try {
      var m = document.cookie && document.cookie.match(/(?:^|; )hlr=([^;]*)/);
      if (m && m[1]) return H._parseResumePayload(decodeURIComponent(m[1]));
    } catch (_) {}
    return null;
  };

  H.persistResumeFromState = function () {
    var cell = H.plainCellFromState();
    if (!cell) return false;
    if (H.rememberResumeCell) {
      H.rememberResumeCell(cell, {
        tonic: H.state.tonic,
        mode: H.state.mode,
        bpm: H.state.bpm,
        title: cell.name,
      });
    }
    return H.writeResumeSnapshot(cell, {
      tonic: H.state.tonic,
      mode: H.state.mode,
      bpm: H.state.bpm,
      title: cell.name,
    });
  };

  H.setSyncStatus = function (msg) {
    H.state.syncMsg = msg || '';
    const el = H.$('#sync-status');
    if (el) el.textContent = H.state.syncMsg;
  }

  H.rememberCellLineage = function (cell) {
    if (!cell) return;
    H.state.familyId = cell.familyId || null;
    H.state.versionIndex = cell.versionIndex != null ? cell.versionIndex : 1;
    H.state.fromVersionIndex = cell.fromVersionIndex != null ? cell.fromVersionIndex : null;
    H.state.fromKind = cell.fromKind || null;
    H.state.fromCellId = cell.fromCellId || null;
  };

  /** Apply session chords (plain objects) into working Landscape chords */
  H.applySessionChords = function (chords, meta) {
    meta = meta || {};
    const incoming = Array.isArray(chords) ? chords : [];
    H.state.chords = incoming
      .map((sc) => {
        if (!sc) return null;
        try {
          return H.sessionChordToLandscape ? H.sessionChordToLandscape(sc) : sc;
        } catch (err) {
          console.error('applySessionChords hydrate', err);
          return null;
        }
      })
      .filter(Boolean);
    if (!H.state.chords.length && incoming.length && H.M() && H.M().makeChord) {
      H.state.chords = incoming.map(function (sc) {
        if (!sc) return H.M().makeChord(0, 'maj', { duration: 4 });
        try {
          return H.M().makeChord(sc.root != null ? sc.root : 0, sc.quality || 'maj', {
            duration: sc.duration != null ? sc.duration : 4,
          });
        } catch (_) {
          return H.M().makeChord(0, 'maj', { duration: 4 });
        }
      });
    }
    // Prefer explicit cell name from session — never overwrite with pack recognition
    if (meta.title) {
      H.state.title = meta.title;
      H.state.nameLocked = true;
    }
    if (meta.cellId) H.state.cellId = meta.cellId;
    if (
      meta.familyId != null ||
      meta.versionIndex != null ||
      meta.fromKind ||
      meta.fromCellId
    ) {
      H.rememberCellLineage(meta);
    } else if (meta.cellId && H.S() && H.S().loadSong) {
      try {
        const song = H.S().loadSong();
        const cell = song && song.cells && song.cells[meta.cellId];
        if (cell) H.rememberCellLineage(cell);
      } catch (_) {
        /* keep whatever lineage we have */
      }
    }
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
    H.state.selected = H.state.chords.length
      ? Math.max(0, Math.min(H.state.chords.length - 1, meta.focusIndex || 0))
      : -1;
    const first = H.state.chords[0];
    if (first && first.localTonic != null) {
      H.state.tonic = first.localTonic;
      if (first.localMode) H.state.mode = first.localMode;
      const tEl2 = H.$('#tonic');
      if (tEl2) tEl2.value = String(H.state.tonic);
      const mEl2 = H.$('#mode');
      if (mEl2) mEl2.value = H.state.mode;
    }
    if (!meta.liveSwap) {
      if (H.map && H.map.setOrigin) H.map.setOrigin(H.state.tonic, H.state.mode);
      H.recognize({ preserveName: true });
      H.clearPendingHome();
    }
  }

  H.ingestHandoffOrSession = function (opts) {
    opts = opts || {};
    // Resume is not handoff. A leftover / empty ih= payload must not steal the button.
    if (opts.resume === true) return H.resumeLastCell();
    if (!H.S()) return false;

    // 1) URL hash / query handoff (works on file://)
    const handoff = H.S().readHandoffFromLocation() || H.S().readHandoffStorage();
    if (handoff && handoff.to === 'landscape' && handoff.cellId) {
      let chords = H.S().expandHandoffChords(handoff);
      H.S().clearHandoffHash();
      try {
        localStorage.removeItem('idlehanz_handoff_v1');
      } catch (_) {}
      const song0 = H.S().loadSong && H.S().loadSong();
      const prev0 = song0 && song0.cells && song0.cells[handoff.cellId];
      if (
        prev0 &&
        prev0.chords &&
        prev0.chords.length > (chords ? chords.length : 0) &&
        H.S().mergeClipIntoChords
      ) {
        chords = H.S().mergeClipIntoChords(
          prev0.chords,
          chords,
          handoff.clipStart || 0,
          handoff.clipMax || handoff.windowLen || null
        );
      }
      const firstStamp = chords && chords[0];
      const songKey = song0 && song0.key;
      H.applySessionChords(chords, {
        title: handoff.cellName || (prev0 && prev0.name) || handoff.title,
        cellId: handoff.cellId,
        packId: prev0 && prev0.packId,
        tonic:
          firstStamp && firstStamp.localTonic != null
            ? firstStamp.localTonic
            : songKey && songKey.tonic != null
              ? songKey.tonic
              : handoff.key && handoff.key.tonic,
        mode:
          firstStamp && firstStamp.localMode
            ? firstStamp.localMode
            : songKey && songKey.mode
              ? songKey.mode
              : handoff.key && handoff.key.mode,
        bpm: handoff.bpm,
        focusIndex: handoff.focus || 0,
      });
      if (chords && chords.length) H.pushToSharedSession('landscape');
      return true;
    }

    return false;
  }

  H.rememberResumeCell = function (cell, meta) {
    if (!cell || !cell.chords || !cell.chords.length) return;
    meta = meta || {};
    H._resumeMem = {
      cell: cell,
      tonic: meta.tonic,
      mode: meta.mode,
      bpm: meta.bpm,
      title: meta.title || cell.name,
    };
  };

  H.applyResumePayload = function (payload) {
    if (!payload || !payload.cell || !payload.cell.chords || !payload.cell.chords.length) {
      return false;
    }
    H.applySessionChords(payload.cell.chords, {
      title: payload.title || payload.cell.name,
      cellId: payload.cell.id,
      packId: payload.cell.packId,
      tonic: payload.tonic,
      mode: payload.mode,
      bpm: payload.bpm,
      focusIndex: payload.focusIndex,
    });
    return !!(H.state.chords && H.state.chords.length);
  };

  /** Last cell this Landscape wrote — memory, then snapshot, then song. */
  H.resumeLastCell = function () {
    try {
      if (H.applyResumePayload(H._resumeMem)) return true;
      if (H.applyResumePayload(H.readResumeSnapshot && H.readResumeSnapshot())) return true;
      const song = H.S() && H.S().loadSong ? H.S().loadSong() : null;
      const cell = H.pickResumableCell(song);
      if (!cell || !cell.chords || !cell.chords.length) return false;
      return H.applyResumePayload({
        cell: cell,
        title: cell.name || (song && song.title),
        tonic: song && song.key && song.key.tonic,
        mode: song && song.key && song.key.mode,
        bpm: song && song.bpm,
        focusIndex: song && song.focus && song.focus.chordIndex,
      });
    } catch (err) {
      H._resumeErr = 'Resume failed · ' + (err && err.message ? err.message : 'apply error');
      return false;
    }
  };

  H.resumeLastCellAsync = function () {
    if (H.resumeLastCell()) return Promise.resolve(true);
    return H._idbGet('lastCell')
      .then(function (row) {
        if (H.applyResumePayload(row)) return true;
        return H._opfsRead();
      })
      .then(function (row) {
        if (row === true) return true;
        return H.applyResumePayload(row);
      })
      .catch(function (err) {
        H._resumeErr =
          'Resume failed · ' + (err && err.message ? err.message : 'async error');
        return false;
      });
  };

  H.describeResumeStore = function () {
    const mem = H._resumeMem && H._resumeMem.cell && H._resumeMem.cell.chords
      ? H._resumeMem.cell.chords.length
      : 0;
    const snap = H.readResumeSnapshot && H.readResumeSnapshot();
    const snapN = snap && snap.cell && snap.cell.chords ? snap.cell.chords.length : 0;
    let songN = 0;
    try {
      const song = H.S() && H.S().loadSong ? H.S().loadSong() : null;
      const cell = H.pickResumableCell(song);
      songN = cell && cell.chords ? cell.chords.length : 0;
    } catch (_) {}
    const n = Math.max(mem, snapN, songN);
    if (!n) return 'Last cell stored: none';
    return 'Last cell stored: ' + n + ' step' + (n === 1 ? '' : 's');
  };

  H.pickResumableCell = function (song) {
    if (!song || !song.cells) return null;
    const focused = H.S() && H.S().getFocusedCell ? H.S().getFocusedCell(song) : null;
    if (focused && focused.chords && focused.chords.length) return focused;
    let best = null;
    Object.keys(song.cells).forEach(function (id) {
      const c = song.cells[id];
      const n = c && c.chords ? c.chords.length : 0;
      if (!n) return;
      if (!best || n > best.chords.length) best = c;
    });
    return best;
  };

  H.hasResumableSession = function () {
    if (H.readResumeSnapshot && H.readResumeSnapshot()) return true;
    if (!H.S()) return false;
    return !!H.pickResumableCell(H.S().loadSong());
  };

  H._finishResume = function (ok) {
    if (ok) {
      H.refreshAll();
      if (H.updateEmptyStart) H.updateEmptyStart();
      H.setSyncStatus(
        'Resumed · ' +
          H.state.chords.length +
          ' step' +
          (H.state.chords.length === 1 ? '' : 's') +
          ' · ' +
          (H.state.title || 'cell')
      );
    } else {
      H.setSyncStatus(
        H._resumeErr ||
          'Nothing to resume · last cell is the session, not a project file'
      );
    }
    return ok;
  };

  H.resumeSharedSession = function () {
    H._resumeErr = '';
    H.setSyncStatus('Resuming…');
    return H.resumeLastCellAsync().then(function (ok) {
      return H._finishResume(ok);
    });
  };

  H.pushToSharedSession = function (by) {
    if (!H.state.chords.length) return null;
    if (H.persistResumeFromState) H.persistResumeFromState();
    if (!H.S()) return null;
    let song = H.S().loadSong();
    if (!song && H.S().readSongFromDisk) song = H.S().readSongFromDisk();
    if (!song) {
      song = H.S().emptySong({
        title: 'Untitled',
        bpm: H.state.bpm,
        tonic: H.state.tonic,
        mode: H.state.mode,
        updatedBy: by || 'landscape',
      });
    }
    if (!song.cells || typeof song.cells !== 'object') song.cells = {};
    // Song title is the piece name — do not overwrite with cell name
    if (!song.title || song.title === 'Untitled') {
      song.title = song.title || 'Untitled';
    }
    song.bpm = H.state.bpm;
    const songEmpty =
      !song.arrangement ||
      !song.arrangement.length ||
      !Object.keys(song.cells || {}).length;
    if (songEmpty || !song.key || song.key.tonic == null) {
      song.key = { tonic: H.state.tonic, mode: H.state.mode };
    }
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
    const nextChords = H.state.chords
      .map((c) => H.S().fromLandscapeChord(c))
      .filter(Boolean);
    if (!nextChords.length) return song;
    const nextCell = {
      id: cellId,
      name: cellName,
      packId: H.state.fromPackId || (prevCell && prevCell.packId) || null,
      familyId:
        (prevCell && prevCell.familyId) ||
        H.state.familyId ||
        null,
      versionIndex:
        prevCell && prevCell.versionIndex != null
          ? prevCell.versionIndex
          : H.state.versionIndex != null
            ? H.state.versionIndex
            : 1,
      fromVersionIndex:
        prevCell && prevCell.fromVersionIndex != null
          ? prevCell.fromVersionIndex
          : H.state.fromVersionIndex != null
            ? H.state.fromVersionIndex
            : null,
      fromKind: (prevCell && prevCell.fromKind) || H.state.fromKind || null,
      fromCellId: (prevCell && prevCell.fromCellId) || H.state.fromCellId || null,
      chords: nextChords,
    };
    if (H.S().stripLineageFromName) {
      nextCell.name = H.S().stripLineageFromName(cellName) || cellName || 'Cell';
    }
    song.cells[cellId] = nextCell;
    if (H.S().adoptOrphanCell) H.S().adoptOrphanCell(song, nextCell);
    if (nextCell.familyId && song.families && song.families[nextCell.familyId]) {
      const ids = song.families[nextCell.familyId].versionIds || [];
      if (ids.indexOf(cellId) < 0) ids.push(cellId);
      song.families[nextCell.familyId].versionIds = ids;
    }
    if (H.S().healFamilies) H.S().healFamilies(song);
    H.rememberCellLineage(nextCell);
    H.state.title = nextCell.name;
    song.focus = {
      cellId,
      sectionId: song.focus && song.focus.sectionId ? song.focus.sectionId : null,
      chordIndex: Math.max(0, H.state.selected),
    };
    const resumeMeta = {
      tonic: H.state.tonic,
      mode: H.state.mode,
      bpm: H.state.bpm,
      title: nextCell.name,
    };
    if (H.rememberResumeCell) H.rememberResumeCell(nextCell, resumeMeta);
    const saved = H.S().saveSong(song, by || 'landscape');
    const snapOk = H.writeResumeSnapshot
      ? H.writeResumeSnapshot(nextCell, resumeMeta)
      : false;
    if (saved || snapOk) {
      H.setSyncStatus('Session saved · ' + (nextCell.name || cellName));
    } else {
      H.setSyncStatus(
        'Session not stored · this file:// page cannot keep localStorage'
      );
    }
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

  /**
   * Full project snapshot for Save / Load file (not just browser session).
   * Chords use session-friendly shape when ih-session is present.
   * Version family (Darken / Reharm / …) is stored in `cells` + `families`
   * so reload does not drop sibling takes.
   */
  H.buildProjectPayload = function () {
    const chordToJson = (c) => {
      if (!c) return null;
      if (H.S() && H.S().fromLandscapeChord) return H.S().fromLandscapeChord(c);
      return {
        root: c.root,
        quality: c.quality,
        duration: c.duration,
        bassPc: c.bassPc,
        roman: c.roman,
        region: c.region,
        tag: c.tag,
        localTonic: c.localTonic,
        localMode: c.localMode,
        name: c.name,
        notes: (c.notes || []).slice(),
        custom: !!c.custom,
      };
    };
    const chords = (H.state.chords || []).map(chordToJson).filter(Boolean);
    const payload = {
      format: 'harmonic-landscape-project',
      version: 1,
      savedAt: new Date().toISOString(),
      title: H.state.title || 'Untitled sequence',
      bpm: H.state.bpm,
      loop: !!H.state.loop,
      pulse: !!H.state.pulse,
      followPlayhead: !!H.state.followPlayhead,
      tonic: H.state.tonic,
      mode: H.state.mode,
      defaultDuration: H.state.defaultDuration != null ? H.state.defaultDuration : 4,
      style: H.state.style || 'neutral',
      selected: Math.max(0, H.state.selected | 0),
      cellId: H.state.cellId || null,
      fromPackId: H.state.fromPackId || null,
      nameLocked: !!H.state.nameLocked,
      functionOpts: H.state.functionOpts
        ? {
            dominants: H.state.functionOpts.dominants !== false,
            borrow: H.state.functionOpts.borrow !== false,
            tritone: !!H.state.functionOpts.tritone,
            dim: !!H.state.functionOpts.dim,
            valts: !!H.state.functionOpts.valts,
            colours: !!H.state.functionOpts.colours,
          }
        : {
            dominants: true,
            borrow: true,
            tritone: false,
            dim: false,
            valts: false,
            colours: false,
          },
      chords: chords,
    };
    const family = H.collectProjectFamily ? H.collectProjectFamily() : null;
    if (family && family.cells && Object.keys(family.cells).length) {
      payload.cells = family.cells;
      payload.families = family.families || {};
      const focusId = payload.cellId;
      if (focusId && payload.cells[focusId]) {
        payload.cells[focusId].chords = chords;
        payload.cells[focusId].name = H.state.title || payload.cells[focusId].name;
      }
    }
    return payload;
  };

  H.serializeSessionCell = function (cell) {
    if (!cell) return null;
    const toJson = function (c) {
      if (!c) return null;
      if (H.S() && H.S().fromLandscapeChord) return H.S().fromLandscapeChord(c);
      return c;
    };
    return {
      id: cell.id,
      name: cell.name || 'Cell',
      packId: cell.packId || null,
      familyId: cell.familyId || null,
      versionIndex: cell.versionIndex != null ? cell.versionIndex : 1,
      fromVersionIndex: cell.fromVersionIndex != null ? cell.fromVersionIndex : null,
      fromKind: cell.fromKind || null,
      fromCellId: cell.fromCellId || null,
      chords: (cell.chords || []).map(toJson).filter(Boolean),
    };
  };

  /** Current take + its Darken/Reharm/… siblings for the project file. */
  H.collectProjectFamily = function () {
    const out = { cells: {}, families: {} };
    if (!H.S() || !H.S().loadSong) return out;
    const song = H.S().loadSong();
    if (!song || !song.cells) return out;
    const cellId = H.state.cellId;
    const cur = (cellId && song.cells[cellId]) || null;
    const fid = cur && cur.familyId;
    const members =
      fid && H.S().familyVersions
        ? H.S().familyVersions(song, fid)
        : cur
          ? [cur]
          : [];
    members.forEach(function (c) {
      const ser = H.serializeSessionCell(c);
      if (ser && ser.id) out.cells[ser.id] = ser;
    });
    if (cur && !out.cells[cur.id]) {
      const ser = H.serializeSessionCell(cur);
      if (ser && ser.id) out.cells[ser.id] = ser;
    }
    if (fid && song.families && song.families[fid]) {
      out.families[fid] = {
        id: fid,
        name: song.families[fid].name || 'Cell',
        versionIds: (song.families[fid].versionIds || []).filter(function (id) {
          return !!out.cells[id] || !!song.cells[id];
        }),
      };
    }
    return out;
  };

  H.restoreProjectFamily = function (data) {
    if (!H.S() || !data || !data.cells || typeof data.cells !== 'object') return null;
    const ids = Object.keys(data.cells);
    if (!ids.length) return null;
    let song = H.S().loadSong();
    if (!song) {
      song = H.S().emptySong({
        title: data.title || 'Untitled',
        bpm: data.bpm != null ? data.bpm : H.state.bpm,
        tonic: data.tonic != null ? data.tonic : H.state.tonic,
        mode: data.mode || H.state.mode,
        updatedBy: 'landscape-load',
      });
    }
    ids.forEach(function (id) {
      const src = data.cells[id];
      if (!src || typeof src !== 'object') return;
      const prev = song.cells[id];
      song.cells[id] = {
        id: src.id || id,
        name: src.name || (prev && prev.name) || 'Cell',
        packId: src.packId || (prev && prev.packId) || null,
        familyId: src.familyId || (prev && prev.familyId) || null,
        versionIndex:
          src.versionIndex != null
            ? src.versionIndex
            : prev && prev.versionIndex != null
              ? prev.versionIndex
              : 1,
        fromVersionIndex:
          src.fromVersionIndex != null
            ? src.fromVersionIndex
            : prev && prev.fromVersionIndex != null
              ? prev.fromVersionIndex
              : null,
        fromKind: src.fromKind || (prev && prev.fromKind) || null,
        fromCellId: src.fromCellId || (prev && prev.fromCellId) || null,
        chords: Array.isArray(src.chords) ? src.chords.slice() : (prev && prev.chords) || [],
      };
    });
    if (data.families && typeof data.families === 'object') {
      if (!song.families) song.families = {};
      Object.keys(data.families).forEach(function (fid) {
        const f = data.families[fid];
        if (!f) return;
        const prev = song.families[fid];
        const idsIn = Array.isArray(f.versionIds) ? f.versionIds.slice() : [];
        song.families[fid] = {
          id: f.id || fid,
          name: f.name || (prev && prev.name) || 'Cell',
          versionIds: idsIn.length ? idsIn : (prev && prev.versionIds) || [],
        };
      });
    }
    if (H.S().healFamilies) H.S().healFamilies(song);
    const focusId = data.cellId && song.cells[data.cellId] ? data.cellId : ids[0];
    song.focus = {
      cellId: focusId,
      sectionId: song.focus && song.focus.sectionId ? song.focus.sectionId : null,
      chordIndex: data.selected != null ? data.selected : 0,
    };
    H.S().saveSong(song, 'landscape-load');
    return song;
  };

  /** Download current work as a .json project file + refresh browser session. */
  H.saveProjectFile = function () {
    if (!H.state.chords || !H.state.chords.length) {
      H.setSyncStatus('Nothing to save — add chords first');
      return;
    }
    try {
      if (H.pushToSharedSession) H.pushToSharedSession('landscape-file');
    } catch (_) {
      /* still write the file from editor state */
    }
    const payload = H.buildProjectPayload();
    const text = JSON.stringify(payload, null, 2);
    const out = H.$('#export-out');
    if (out) out.value = text;
    if (H.dl) {
      H.dl(
        new Blob([text], { type: 'application/json' }),
        (H.slug ? H.slug(payload.title) : 'harmonic-landscape') + '.hl.json'
      );
    }
    const nVer = payload.cells ? Object.keys(payload.cells).length : 1;
    H.setSyncStatus(
      'Project saved · ' +
        payload.title +
        ' · ' +
        payload.chords.length +
        ' steps' +
        (nVer > 1 ? ' · ' + nVer + ' versions' : '')
    );
  };

  /**
   * Load a .hl.json / project JSON (from file input or parsed object).
   */
  H.loadProjectPayload = function (data, opts) {
    opts = opts || {};
    if (!data || typeof data !== 'object') {
      H.setSyncStatus('Load failed · invalid file');
      return false;
    }
    // Accept our project format, or a bare handoff / cell-like object with chords
    let chordsRaw = data.chords;
    if (!chordsRaw && data.cell && data.cell.chords) chordsRaw = data.cell.chords;
    if (
      !chordsRaw &&
      data.cells &&
      data.cellId &&
      data.cells[data.cellId] &&
      data.cells[data.cellId].chords
    ) {
      chordsRaw = data.cells[data.cellId].chords;
    }
    if (!Array.isArray(chordsRaw) || !chordsRaw.length) {
      H.setSyncStatus('Load failed · no chords in file');
      return false;
    }
    if (H.pushUndo && H.state.chords && H.state.chords.length) H.pushUndo();

    const tonic =
      data.tonic != null
        ? data.tonic
        : data.key && data.key.tonic != null
          ? data.key.tonic
          : H.state.tonic;
    const mode =
      data.mode ||
      (data.key && data.key.mode) ||
      H.state.mode ||
      'minor';
    const bpm = data.bpm != null ? data.bpm : H.state.bpm;

    H.state.tonic = ((Number(tonic) % 12) + 12) % 12;
    H.state.mode = mode;
    H.state.bpm = Number(bpm) || 96;
    if (data.loop != null) H.state.loop = !!data.loop;
    if (data.pulse != null) H.state.pulse = !!data.pulse;
    if (data.followPlayhead != null) H.state.followPlayhead = !!data.followPlayhead;
    if (data.defaultDuration != null) {
      H.state.defaultDuration = H.snapBeats
        ? H.snapBeats(data.defaultDuration)
        : data.defaultDuration;
    }
    if (data.style && H.STYLES && H.STYLES[data.style]) {
      H.state.style = data.style;
      try {
        localStorage.setItem('hl-style', data.style);
      } catch (_) {
        /* ignore */
      }
    }
    if (data.functionOpts && typeof data.functionOpts === 'object') {
      H.state.functionOpts = Object.assign(
        H.state.functionOpts || {},
        data.functionOpts
      );
    }
    H.state.title = data.title || data.cellName || 'Loaded project';
    H.state.nameLocked = data.nameLocked !== false;
    H.state.fromPackId = data.fromPackId || data.packId || null;

    // Restore sibling versions before focusing this take (old files have no cells)
    const restored =
      data.cells && H.restoreProjectFamily ? H.restoreProjectFamily(data) : null;
    H.state.cellId =
      (restored && restored.focus && restored.focus.cellId) || data.cellId || null;
    if (restored && H.state.cellId && restored.cells[H.state.cellId]) {
      const focusCell = restored.cells[H.state.cellId];
      if (focusCell.name) {
        H.state.title = focusCell.name;
        H.state.nameLocked = true;
      }
    }

    // Hydrate chords
    H.state.chords = chordsRaw.map((sc) => {
      if (H.sessionChordToLandscape) return H.sessionChordToLandscape(sc);
      if (H.M() && H.M().makeChord) {
        const ch = H.M().makeChord(sc.root, sc.quality || 'maj', {
          duration: sc.duration != null ? sc.duration : 4,
          region: sc.region || 'diatonic',
          roman: sc.roman || '',
          tag: sc.tag || 'loaded',
        });
        if (sc.localTonic != null) {
          ch.localTonic = sc.localTonic;
          ch.localMode = sc.localMode || mode;
        } else if (H.stampKey) {
          H.stampKey(ch, { tonic: H.state.tonic, mode: H.state.mode });
        }
        return ch;
      }
      return sc;
    });
    const sel =
      data.selected != null
        ? data.selected
        : data.focus != null
          ? data.focus
          : 0;
    H.state.selected = Math.max(
      0,
      Math.min(H.state.chords.length - 1, sel | 0)
    );
    if (H.setSelectedIndices) {
      H.setSelectedIndices([H.state.selected], H.state.selected);
    }

    // Sync dropdowns
    const tEl = H.$('#tonic');
    const mEl = H.$('#mode');
    const bEl = H.$('#bpm');
    if (tEl) tEl.value = String(H.state.tonic);
    if (mEl) mEl.value = H.state.mode;
    if (bEl) bEl.value = String(H.state.bpm);
    const loopEl = H.$('#loop');
    if (loopEl) loopEl.checked = !!H.state.loop;
    const pulseEl = H.$('#pulse');
    if (pulseEl) pulseEl.checked = !!H.state.pulse;
    if (H.setDefaultDuration) {
      H.setDefaultDuration(H.state.defaultDuration, { silent: true });
    }
    if (H.syncStyleUI) H.syncStyleUI();
    if (H.syncFunctionOptsUI) H.syncFunctionOptsUI();
    if (H.map && H.map.setOrigin) {
      H.map.setOrigin(H.state.tonic, H.state.mode, { layoutPath: false });
    }
    if (H.refreshAll) H.refreshAll();
    else if (H.afterEdit) H.afterEdit();
    try {
      if (H.pushToSharedSession) H.pushToSharedSession('landscape-load');
    } catch (_) {
      /* ignore */
    }
    if (!opts.silent) {
      const nVer =
        data.cells && typeof data.cells === 'object'
          ? Object.keys(data.cells).length
          : 0;
      H.setSyncStatus(
        'Project loaded · ' +
          H.state.title +
          ' · ' +
          H.state.chords.length +
          ' steps · ' +
          (H.keyLabel ? H.keyLabel() : '') +
          (nVer > 1 ? ' · ' + nVer + ' versions' : '')
      );
    }
    return true;
  };

  H.loadProjectFile = function (file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const data = JSON.parse(String(reader.result || ''));
        H.loadProjectPayload(data);
        const out = H.$('#export-out');
        if (out) out.value = JSON.stringify(data, null, 2);
      } catch (err) {
        console.error(err);
        H.setSyncStatus(
          'Load failed · ' + (err && err.message ? err.message : 'bad JSON')
        );
      }
    };
    reader.onerror = function () {
      H.setSyncStatus('Load failed · could not read file');
    };
    reader.readAsText(file);
  };

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
    const all = H.state.chords.map((c) => H.S().fromLandscapeChord(c)).filter(Boolean);
    const focus = Math.max(0, Math.min(all.length - 1, H.state.selected | 0));
    const payload = H.S().buildHandoffPayload({
      by: 'landscape',
      to: 'fretboard',
      title: H.state.title,
      bpm: H.state.bpm,
      key: { tonic: H.state.tonic, mode: H.state.mode },
      cellId: H.state.cellId,
      cellName: H.state.title,
      focus: focus,
      chords: all,
      ephemeral: true,
    });
    const ok = H.S().openWithHandoff(H.S().PATHS.fretboardFromLandscape, payload);
    if (ok) {
      H.setSyncStatus('Opened Fretboard with ' + all.length + ' chords');
    } else {
      H.setSyncStatus('Could not open Fretboard — check Desktop paths');
    }
    H.$('#export-out').value = JSON.stringify(
      Object.assign({}, payload, { _sourceTotal: all.length }),
      null,
      2
    );
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
        ' — plant its tonic after the selected step (old path stays on its disks)'
      : 'Land here — stage a different Write home / Mode first, then click';
    const badge = H.$('#staged-badge');
    const lab = H.$('#staged-label');
    if (badge) {
      badge.classList.toggle('on', pending);
      if (lab) {
        lab.textContent = pending
          ? H.keyLabelFor(H.dropdownKey()) + ' · Land'
          : '—';
      }
    }
    if (H.renderPlaceReadout) H.renderPlaceReadout();
  };

  /** Append tonic (I/i) of write home — fast I–V–I–V building */
  H.quickAddTonic = function () {
    if (!H.makeHomeChord) return;
    const ch = H.makeHomeChord({ duration: H.stepDuration() });
    H.commitHorizon(
      { chord: ch, kind: 'home', label: ch.name, job: 'tonic' },
      { insert: true }
    );
  };

  /** Append V (prefer V7 in major-ish colour) of write home */
  H.quickAddDominant = function () {
    const music = H.M();
    const t = H.state.tonic;
    const isMin =
      H.state.mode === 'minor' ||
      ((music.MODES[H.state.mode] || {}).romanBase === 'minor');
    const ch = music.makeChord((t + 7) % 12, 'dom7', {
      duration: H.stepDuration(),
      region: 'diatonic',
      roman: 'V7',
      tag: 'quick',
    });
    H.stampKey(ch, H.writeKey());
    H.commitHorizon(
      {
        chord: ch,
        kind: 'direction',
        label: ch.name,
        job: isMin ? 'V7 (minor home)' : 'V7',
      },
      { insert: true }
    );
  };

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

    // Keep existing disk stamps. Unstamped steps follow the new write home
    // (do not nail them to the old key — that trapped Fretboard returns on C).
    H.state.chords.forEach((ch) => {
      if (!ch) return;
      if (ch.localTonic != null && !ch.localMode) ch.localMode = prevM;
    });

    if (opts.transpose && delta && H.state.chords.length) {
      H.pushUndo();
      H.state.chords = H.state.chords.map((ch) => H.transposeChord(ch, delta, nextT, nextM));
    }

    H.state.tonic = nextT;
    H.state.mode = nextM;
    // Sync dropdowns before clearing pending so Land-here highlight is correct
    if (H.$('#tonic')) H.$('#tonic').value = String(H.state.tonic);
    if (H.$('#mode')) H.$('#mode').value = H.state.mode;
    H.clearPendingHome();

    const keyChanged = prevT !== nextT || prevM !== nextM;

    // Function = same-key atlas. Real key change → Journey (Chase)
    let switchedToChase = false;
    if (keyChanged && H.map && H.map.mapView === 'function' && H.maybeChaseAfterKeyChange) {
      switchedToChase = H.maybeChaseAfterKeyChange({
        silent: true,
        message:
          'New key → Journey · ' +
          H.keyLabel() +
          ' · multi-disk · In this key stays same-key only',
      });
    }

    // Lightweight map bookkeeping; full path layout via afterEdit / refreshMap
    if (H.map) {
      if (H.map.rememberKey) {
        H.map.rememberKey(prevT, prevM);
        H.map.rememberKey(nextT, nextM);
      }
      if (H.map.setOrigin) {
        H.map.setOrigin(H.state.tonic, H.state.mode, { layoutPath: false });
      }
      if (!opts.skipEdit) {
        H.map.setPath(H.state.chords, H.state.selected);
      }
      // Do not auto-reframe multi-disk here — use Fit if you want both wheels in view
    }

    if (opts.skipEdit) {
      // Caller will afterEdit / plant — avoid double setPath
      H.renderTitle();
      if (H.updateMapStatus) H.updateMapStatus();
      if (switchedToChase) {
        H.setSyncStatus(
          'Write home → ' +
            H.keyLabel() +
            ' · switched to Journey · multi-disk · In this key is same-key only'
        );
      }
    } else {
      H.afterEdit();
      if (switchedToChase) {
        H.setSyncStatus(
          'Write home → ' +
            H.keyLabel() +
            ' · switched to Journey · multi-disk · In this key is same-key only'
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
   * Flow: pick key/mode (H.map stays put) → select pivot → Land here.
   * Same contract as ghost establish: switch gravity, do NOT retag old steps,
   * plant destination tonic after the pivot on the new disk.
   */
  H.landSelectionAsHome = function () {
    const dest = H.dropdownKey();
    const sameHome = dest.tonic === H.state.tonic && dest.mode === H.state.mode;

    // Empty path: set compass and seed tonic so there is something to play
    if (!H.state.chords.length) {
      H.state._prevTonicForTranspose = H.state.tonic;
      H.pushUndo();
      H.setWritingHome(dest.tonic, dest.mode, { transpose: false, skipEdit: true });
      const seeded = H.plantLandTonic(dest);
      H.afterEdit();
      H.setSyncStatus(
        'Write home → ' +
          H.keyLabel() +
          (seeded ? ' · planted ' + seeded + ' · path started' : ' · empty path · click a seat to start')
      );
      return;
    }

    if (sameHome) {
      H.setSyncStatus(
        'Already on ' +
          H.keyLabel() +
          ' · nothing landed · pick another Write home / Mode (badge turns purple), then Land here — or click a purple ghost to leave home'
      );
      H.updateLandButton();
      return;
    }

    H.state._prevTonicForTranspose = H.state.tonic;
    H.pushUndo();
    if (H.ensurePathOwned) H.ensurePathOwned();
    const pivotSel =
      H.state.selected >= 0 && H.state.selected < H.state.chords.length
        ? H.state.selected
        : H.state.chords.length - 1;
    const first = H.state.chords[0];
    const pathAlreadyDest = first && H.pcNorm(first.root) === dest.tonic;
    // Switch gravity only — old journey keeps its disks (matches ghost establish)
    const result = H.setWritingHome(dest.tonic, dest.mode, {
      transpose: false,
      skipEdit: true,
    });
    if (pathAlreadyDest) H.retagPathToKey(dest);
    // Don't plant a new I if the path already starts on that tonic
    const planted = pathAlreadyDest ? null : H.plantLandTonic(dest, pivotSel);
    H.afterEdit();
    const disks = H.map && H.map.disks ? H.map.disks.length : 1;
    H.setSyncStatus(
      'Land here · write home ' +
        H.keyLabel() +
        (disks > 1 ? ' · ' + disks + ' Chase disks' : '') +
        (planted ? ' · added ' + planted : planted === null ? ' · (tonic already next)' : '') +
        ' · earlier steps stay on their wheels' +
        (result && result.switchedToChase ? ' · switched to Chase' : '')
    );
  };

  /**
   * Insert/append destination tonic (I or i) after pivotSel.
   * Used by Land here so switching Write home is not diagram-only.
   * Returns planted chord name, or null if nothing added.
   */
  H.plantLandTonic = function (dest, pivotSel) {
    if (!dest) return null;
    const music = H.M();
    const mode = dest.mode || H.state.mode || 'minor';
    const isMinor = (music.MODES[mode] || music.MODES.minor).romanBase === 'minor';
    let route = null;
    if (H.C() && H.C().establishHomeOptions) {
      const opts = H.C().establishHomeOptions(dest.tonic, mode) || [];
      const tonicOpt = opts.find((o) => o.id === 'tonic') || opts[0];
      if (tonicOpt && tonicOpt.route && tonicOpt.route.length) {
        route = tonicOpt.route;
      }
    }
    if (!route || !route.length) {
      const t = music.pc(dest.tonic);
      route = [
        music.makeChord(t, isMinor ? 'min' : 'maj', {
          region: 'diatonic',
          roman: isMinor ? 'i' : 'I',
          tag: 'establish',
        }),
      ];
    }

    // Skip if the step after the pivot is already this same tonic (avoid double-land)
    const want = route[0];
    const after =
      pivotSel != null && pivotSel >= 0 ? H.state.chords[pivotSel + 1] : null;
    if (
      after &&
      after.root === want.root &&
      after.quality === want.quality &&
      (after.localTonic == null || after.localTonic === dest.tonic)
    ) {
      return null;
    }

    // Shared plant path with ghost establish (append at end / insert mid)
    if (H.plantEstablishRoute) {
      return H.plantEstablishRoute({ tonic: dest.tonic, mode: mode }, route, pivotSel);
    }
    // Fallback if map-bridge not loaded yet
    const step = H.stepDuration();
    const pieces = route.map((c) => {
      const x = music.cloneChord
        ? music.cloneChord(c)
        : Object.assign({}, c, { notes: (c.notes || []).slice() });
      x.duration = step;
      H.stampKey(x, { tonic: dest.tonic, mode: mode });
      return x;
    });
    H.state.chords.push(...pieces);
    H.state.selected = H.state.chords.length - 1;
    return pieces.map((p) => p.name).join(' → ');
  };

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

  /** Put the whole cell on the Write home dropdown. Notes stay if they already belong there. */
  H.retagPathToKey = function (dest) {
    dest = dest || H.writeKey();
    (H.state.chords || []).forEach(function (ch) {
      if (ch) H.stampKey(ch, dest);
    });
  };

  /** Sit every step on the Write home wheel. Pitches do not move. */
  H.assignPathToWriteHome = function () {
    if (!H.state.chords.length) {
      H.setSyncStatus('Nothing to assign');
      return;
    }
    const dest = H.dropdownKey ? H.dropdownKey() : H.writeKey();
    const live = H.writeKey();
    H.pushUndo();
    if (dest.tonic !== live.tonic || dest.mode !== live.mode) {
      H.setWritingHome(dest.tonic, dest.mode, { transpose: false, skipEdit: true });
    }
    H.retagPathToKey(dest);
    H.afterEdit();
    H.setSyncStatus('On the ' + H.keyLabel() + ' wheel · notes unchanged');
    H.state._prevTonicForTranspose = dest.tonic;
  };

  H.pathTonicGuess = function () {
    const first = H.state.chords && H.state.chords[0];
    if (!first) return H.state.tonic;
    if (first.localTonic != null) return H.pcNorm(first.localTonic);
    if (first.root != null) return H.pcNorm(first.root);
    return H.state.tonic;
  };

  H.transposeAllToWriteHome = function (fromTonic) {
    if (!H.state.chords.length) {
      H.setSyncStatus('Nothing to transpose');
      return;
    }
    const dest = H.dropdownKey ? H.dropdownKey() : H.writeKey();
    const live = H.writeKey();
    const pathTonic =
      fromTonic != null ? H.pcNorm(fromTonic) : H.pathTonicGuess();
    const first = H.state.chords[0];
    const alreadyThere =
      pathTonic === dest.tonic || (first && H.pcNorm(first.root) === dest.tonic);

    H.pushUndo();
    if (dest.tonic !== live.tonic || dest.mode !== live.mode) {
      H.setWritingHome(dest.tonic, dest.mode, { transpose: false, skipEdit: true });
    }

    if (alreadyThere) {
      H.retagPathToKey(dest);
      H.afterEdit();
      H.setSyncStatus(
        'Path on ' + H.keyLabel() + ' · notes unchanged · sitting on write-home'
      );
      H.state._prevTonicForTranspose = dest.tonic;
      return;
    }

    const delta = (dest.tonic - pathTonic + 12) % 12;
    if (!delta) {
      H.retagPathToKey(dest);
      H.afterEdit();
      H.state._prevTonicForTranspose = dest.tonic;
      return;
    }
    H.state.chords = H.state.chords.map(function (ch) {
      return H.transposeChord(ch, delta, dest.tonic, dest.mode);
    });
    H.afterEdit();
    H.setSyncStatus('Transposed into ' + H.keyLabel() + ' · all steps on write-home');
    H.state._prevTonicForTranspose = dest.tonic;
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
    // Allow undoing a pack that replaced an existing path
    if (H.state.chords.length) H.pushUndo();
    if (H.A() && H.A().isPlaying && H.A().isPlaying() && H.stopPlaybackUI) {
      H.stopPlaybackUI();
    }
    H.state.chords = H.P().materialize(pack, H.state.tonic, H.state.mode);
    H.state.fromPackId = id;
    // New cell each pack load — unique name so they don't all read "Home grit"
    H.state.cellId = H.S() ? H.S().newCellId(id) : null;
    H.state.title = H.uniqueCellName(pack.name);
    H.state.nameLocked = false;
    H.state.recognition = { pack, exact: true, match: 'exact', confidence: 1 };
    H.state.selected = Math.max(0, H.state.chords.length - 1);
    // Stamp pack chords onto current write home
    if (H.ensurePathOwned) H.ensurePathOwned();
    H.refreshAll();
    if (H.S()) H.pushToSharedSession('landscape');
    if (!opts || !opts.silent) H.playSeq({ once: true });
  };

  /** Chord for a Chase scale seat (default quality on that seat). */
})(typeof window !== "undefined" ? window : globalThis);
