/**
 * Phone / coarse-pointer helpers for Harmonic Landscape.
 * Desktop behaviour is unchanged; this only activates under the mobile CSS query.
 */
(function () {
  'use strict';

  function isMobileLayout() {
    try {
      return window.matchMedia('(max-width: 760px), ((max-width: 980px) and (pointer: coarse))').matches;
    } catch (_) {
      return window.innerWidth <= 760;
    }
  }

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function unlockAudio() {
    try {
      var H = window.HLApp;
      if (H && H.A && H.A()) {
        H.A().ensure();
        var ctx = H.A().ctx || (H.A().getContext && H.A().getContext());
        if (ctx && ctx.state === 'suspended') ctx.resume();
      }
    } catch (_) {}
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!window.__hlUnlockCtx) window.__hlUnlockCtx = new AC();
      if (window.__hlUnlockCtx.state === 'suspended') window.__hlUnlockCtx.resume();
    } catch (_) {}
  }

  function cloneChord(ch) {
    if (!ch) return null;
    try {
      return JSON.parse(JSON.stringify(ch));
    } catch (_) {
      return ch;
    }
  }

  function stashPending(ch, label) {
    var H = window.HLApp;
    if (!H) return;
    H._mobilePendingChord = cloneChord(ch);
    H._mobilePendingLabel = label || (ch && ch.name) || '';
    updateAddButton();
  }

  function updateAddButton() {
    var btn = $('#hl-m-add');
    var lab = $('#hl-m-pending');
    var H = window.HLApp;
    if (!btn) return;
    var ch = H && H._mobilePendingChord;
    if (ch) {
      btn.disabled = false;
      btn.textContent = 'Add ' + (ch.name || H._mobilePendingLabel || 'chord');
      if (lab) {
        lab.style.display = 'block';
        lab.textContent = 'Selected · tap Add to write';
      }
    } else {
      btn.disabled = true;
      btn.textContent = 'Add';
      if (lab) lab.style.display = 'none';
    }
  }

  function wrapPreview() {
    var H = window.HLApp;
    if (!H || H._mobileWrapped) return;
    H._mobileWrapped = true;
    var prevPreview = H.previewMapChord;
    if (typeof prevPreview === 'function') {
      H.previewMapChord = function (ch, hint) {
        stashPending(ch, hint);
        return prevPreview.apply(this, arguments);
      };
    }
    var prevSelect = H.selectChaseSeat;
    if (typeof prevSelect === 'function') {
      H.selectChaseSeat = function (seatInfo, clickOpts) {
        try {
          var disk = seatInfo && seatInfo.disk;
          var diskKey = disk
            ? { tonic: disk.tonic, mode: disk.mode || H.state.mode }
            : H.writeKey && H.writeKey();
          var ch =
            (seatInfo && seatInfo.chord) ||
            (H.chordFromChaseSeat &&
              H.chordFromChaseSeat(seatInfo.seat || seatInfo, diskKey));
          if (ch) stashPending(ch, ch.name);
        } catch (_) {}
        return prevSelect.apply(this, arguments);
      };
    }
  }

  function addPendingChord() {
    unlockAudio();
    var H = window.HLApp;
    if (!H || !H._mobilePendingChord) {
      if (H && H.setSyncStatus) H.setSyncStatus('Tap a chord on the map first, then Add');
      return;
    }
    var ch = cloneChord(H._mobilePendingChord);
    if (H.writeChordToPath) {
      H.writeChordToPath(ch, {
        intent: 'append',
        kind: 'direction',
        label: ch.name,
        job: 'phone Add',
      });
    } else if (H.commitHorizon) {
      H.commitHorizon(
        { chord: ch, kind: 'direction', label: ch.name, job: 'phone Add' },
        { mode: 'append' }
      );
    }
    if (H.setSyncStatus) H.setSyncStatus('Added ' + (ch.name || 'chord'));
  }

  function setSheet(which) {
    document.body.classList.remove('hl-sheet-path', 'hl-sheet-from', 'hl-more-open');
    document.querySelectorAll('.hl-mtabs button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === which);
    });
    if (which === 'path') document.body.classList.add('hl-sheet-path');
    else if (which === 'from') {
      document.body.classList.add('hl-sheet-from');
      // Ensure From here body is visible even if desktop collapsed it
      var main = $('main');
      if (main) main.classList.remove('horizon-collapsed');
    } else if (which === 'more') document.body.classList.add('hl-more-open');
    // map = default, no sheet
  }

  function buildSharePayload() {
    var H = window.HLApp;
    if (!H || !H.S || !H.S() || !H.state || !H.state.chords || !H.state.chords.length) return null;
    var all = H.state.chords.map(function (c) {
      return H.S().fromLandscapeChord(c);
    }).filter(Boolean);
    var focus = Math.max(0, Math.min(all.length - 1, H.state.selected | 0));
    return H.S().buildHandoffPayload({
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
  }

  function copyShareLink() {
    unlockAudio();
    var H = window.HLApp;
    var payload = buildSharePayload();
    if (!payload) {
      alert('Add some chords first.');
      return;
    }
    H.pushToSharedSession && H.pushToSharedSession('landscape');
    var hash = H.S().encodeHandoff(payload); // "ih=..."
    var frag = hash ? (hash.charAt(0) === '#' ? hash : '#' + hash) : '';
    var url;
    if (!location.origin || location.origin === 'null') {
      url = '../fretboard/index.html' + frag;
    } else {
      url = location.origin + '/tools/fretboard/' + frag;
    }
    var out = $('#hl-m-share-out');
    if (out) out.value = url;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        function () {
          if (H.setSyncStatus) H.setSyncStatus('Share link copied');
        },
        function () {
          if (H.setSyncStatus) H.setSyncStatus('Share link ready — copy from More');
        }
      );
    } else if (H.setSyncStatus) {
      H.setSyncStatus('Share link ready — copy from More');
    }
  }

  function exportJson() {
    unlockAudio();
    var H = window.HLApp;
    if (H && H.saveProjectFile) {
      H.saveProjectFile();
      return;
    }
    var payload = buildSharePayload();
    if (!payload) {
      alert('Add some chords first.');
      return;
    }
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (payload.title || 'song') + '.json';
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
    }, 500);
  }

  function wireLongPress() {
    var canvas = $('#map');
    if (!canvas || canvas._hlLongPress) return;
    canvas._hlLongPress = true;
    var timer = null;
    var startX = 0;
    var startY = 0;
    var armed = false;

    function clear() {
      if (timer) clearTimeout(timer);
      timer = null;
      armed = false;
    }

    canvas.addEventListener(
      'pointerdown',
      function (e) {
        if (!isMobileLayout()) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        unlockAudio();
        startX = e.clientX;
        startY = e.clientY;
        armed = true;
        timer = setTimeout(function () {
          if (!armed) return;
          armed = false;
          var H = window.HLApp;
          if (!H || !H.map) return;
          try {
            // Synthesize a contextmenu at this point
            var ev = new MouseEvent('contextmenu', {
              bubbles: true,
              cancelable: true,
              clientX: startX,
              clientY: startY,
              view: window,
            });
            canvas.dispatchEvent(ev);
            if (H.setSyncStatus) H.setSyncStatus('Long-press menu');
          } catch (_) {}
        }, 520);
      },
      { passive: true }
    );

    canvas.addEventListener(
      'pointermove',
      function (e) {
        if (!timer) return;
        if (Math.abs(e.clientX - startX) > 12 || Math.abs(e.clientY - startY) > 12) clear();
      },
      { passive: true }
    );
    canvas.addEventListener('pointerup', clear, { passive: true });
    canvas.addEventListener('pointercancel', clear, { passive: true });
  }

  function syncPlayLabel() {
    var H = window.HLApp;
    var btn = $('#hl-m-play');
    if (!btn || !H || !H.state) return;
    btn.textContent = H.state.playing ? 'Stop' : 'Play';
  }

  function injectChrome() {
    if ($('#hl-mbar')) return;

    var mbar = document.createElement('div');
    mbar.id = 'hl-mbar';
    mbar.className = 'hl-mbar';
    mbar.innerHTML =
      '<span class="brand-mini">Landscape</span>' +
      '<button type="button" class="btn ghost" id="hl-m-undo" title="Undo">Undo</button>' +
      '<button type="button" class="btn ghost" id="hl-m-fret" title="Open on Fretboard">Fret</button>' +
      '<span class="hl-mbar-spacer"></span>' +
      '<button type="button" class="btn primary" id="hl-m-more" title="More controls">More</button>';

    var app = $('.app');
    if (app) app.insertBefore(mbar, app.firstChild);

    var tabs = document.createElement('div');
    tabs.className = 'hl-mtabs';
    tabs.innerHTML =
      '<button type="button" data-tab="map" class="active">Map</button>' +
      '<button type="button" data-tab="path">Path</button>' +
      '<button type="button" data-tab="from">From here</button>' +
      '<button type="button" data-tab="more">Share</button>';
    document.body.appendChild(tabs);

    var dock = document.createElement('div');
    dock.className = 'hl-mdock';
    dock.innerHTML =
      '<span class="pending-lab" id="hl-m-pending"></span>' +
      '<button type="button" class="btn ghost" id="hl-m-play">Play</button>' +
      '<button type="button" class="btn-add-big" id="hl-m-add" disabled>Add</button>' +
      '<button type="button" class="btn ghost" id="hl-m-del" title="Delete selected">Del</button>';
    document.body.appendChild(dock);

    var backdrop = document.createElement('div');
    backdrop.className = 'hl-msheet-backdrop';
    backdrop.id = 'hl-msheet-backdrop';
    document.body.appendChild(backdrop);

    var sheet = document.createElement('div');
    sheet.className = 'hl-msheet';
    sheet.id = 'hl-msheet';
    sheet.innerHTML =
      '<h3>More · export &amp; settings</h3>' +
      '<p class="hint">Work saves in this phone browser. Export or share a link to bring it to your PC.</p>' +
      '<div class="row">' +
      '<button type="button" class="btn primary" id="hl-m-export">Export project</button>' +
      '<button type="button" class="btn primary" id="hl-m-share">Copy share link</button>' +
      '<button type="button" class="btn ghost" id="hl-m-txt">Export text</button>' +
      '<button type="button" class="btn ghost" id="hl-m-mid">Export MIDI</button>' +
      '</div>' +
      '<textarea class="share-out" id="hl-m-share-out" readonly placeholder="Share link appears here"></textarea>' +
      '<div class="row" style="margin-top:0.65rem">' +
      '<button type="button" class="btn ghost" id="hl-m-write">Write mode</button>' +
      '<button type="button" class="btn ghost" id="hl-m-select">Select mode</button>' +
      '<button type="button" class="btn ghost" id="hl-m-home">+ Home</button>' +
      '<button type="button" class="btn ghost" id="hl-m-demo">Demo</button>' +
      '</div>' +
      '<div class="row" id="hl-m-key-row"></div>' +
      '<div class="row">' +
      '<button type="button" class="btn ghost" id="hl-m-close-more">Close</button>' +
      '</div>';
    document.body.appendChild(sheet);

    // Move key/bpm controls clone references into sheet
    var keyRow = $('#hl-m-key-row');
    if (keyRow) {
      ['tonic', 'mode', 'bpm'].forEach(function (id) {
        var src = document.getElementById(id);
        if (!src) return;
        var wrap = document.createElement('label');
        wrap.className = 'ctl';
        wrap.style.minHeight = '44px';
        wrap.textContent = id.toUpperCase() + ' ';
        // Don't move originals — mirror by clicking through to them via change sync is hard.
        // Instead leave originals in hidden header; provide big mirrors that set values.
        var clone = src.cloneNode(true);
        clone.id = 'hl-m-' + id;
        clone.removeAttribute('name');
        wrap.appendChild(clone);
        keyRow.appendChild(wrap);
        clone.addEventListener('change', function () {
          src.value = clone.value;
          src.dispatchEvent(new Event('change', { bubbles: true }));
        });
      });
    }
  }

  function wireChrome() {
    injectChrome();

    document.addEventListener('pointerup', unlockAudio, { passive: true, capture: true });
    document.addEventListener('touchend', unlockAudio, { passive: true, capture: true });

    $('#hl-m-more') &&
      $('#hl-m-more').addEventListener('click', function () {
        setSheet('more');
      });
    $('#hl-m-close-more') &&
      $('#hl-m-close-more').addEventListener('click', function () {
        setSheet('map');
      });
    $('#hl-msheet-backdrop') &&
      $('#hl-msheet-backdrop').addEventListener('click', function () {
        setSheet('map');
      });

    document.querySelectorAll('.hl-mtabs button').forEach(function (b) {
      b.addEventListener('click', function () {
        var tab = b.getAttribute('data-tab');
        setSheet(tab === 'share' ? 'more' : tab);
      });
    });

    $('#hl-m-add') && $('#hl-m-add').addEventListener('click', addPendingChord);
    $('#hl-m-play') &&
      $('#hl-m-play').addEventListener('click', function () {
        unlockAudio();
        var desk = $('#btn-play');
        if (desk) desk.click();
        setTimeout(syncPlayLabel, 50);
      });
    $('#hl-m-del') &&
      $('#hl-m-del').addEventListener('click', function () {
        var desk = $('#btn-del-step');
        if (desk) desk.click();
      });
    $('#hl-m-undo') &&
      $('#hl-m-undo').addEventListener('click', function () {
        var desk = $('#btn-undo');
        if (desk) desk.click();
      });
    $('#hl-m-fret') &&
      $('#hl-m-fret').addEventListener('click', function () {
        unlockAudio();
        var H = window.HLApp;
        if (H && H.sendToFretboard) H.sendToFretboard();
        else {
          var desk = $('#btn-fret');
          if (desk) desk.click();
        }
      });
    $('#hl-m-export') && $('#hl-m-export').addEventListener('click', exportJson);
    $('#hl-m-share') && $('#hl-m-share').addEventListener('click', copyShareLink);
    $('#hl-m-txt') &&
      $('#hl-m-txt').addEventListener('click', function () {
        var H = window.HLApp;
        if (H && H.exportText) H.exportText();
        else {
          var d = $('#btn-export-txt');
          if (d) d.click();
        }
      });
    $('#hl-m-mid') &&
      $('#hl-m-mid').addEventListener('click', function () {
        var d = $('#btn-export-mid');
        if (d) d.click();
      });
    $('#hl-m-write') &&
      $('#hl-m-write').addEventListener('click', function () {
        var b = document.querySelector('[data-map-mode="write"]');
        if (b) b.click();
        setSheet('map');
      });
    $('#hl-m-select') &&
      $('#hl-m-select').addEventListener('click', function () {
        var b = document.querySelector('[data-map-mode="select"]');
        if (b) b.click();
        setSheet('map');
      });
    $('#hl-m-home') &&
      $('#hl-m-home').addEventListener('click', function () {
        var d = $('#btn-start-home') || $('#btn-empty-home') || $('#coach-start-i');
        if (d) d.click();
        setSheet('map');
      });
    $('#hl-m-demo') &&
      $('#hl-m-demo').addEventListener('click', function () {
        var d = $('#btn-demo-sop') || $('#btn-empty-demo');
        if (d) d.click();
        setSheet('map');
      });

    wireLongPress();
    wrapPreview();
    updateAddButton();

    // Keep play label in sync
    setInterval(function () {
      if (isMobileLayout()) syncPlayLabel();
    }, 400);

    // On first mobile visit, collapse header MIDI etc already hidden by CSS.
    // Prefer Select mode so tap = preview, Add = write (per brief).
    if (isMobileLayout()) {
      var sel = document.querySelector('[data-map-mode="select"]');
      if (sel && !sel.classList.contains('active')) sel.click();
    }
  }

  function boot() {
    if (!isMobileLayout() && window.innerWidth > 980) {
      // Still unlock audio helpers and wrap pending for tablets that rotate in
      document.addEventListener(
        'resize',
        function () {
          if (isMobileLayout()) wireChrome();
        },
        { passive: true }
      );
    }
    wireChrome();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      // Wait a tick for HLApp modules
      setTimeout(boot, 0);
      setTimeout(wrapPreview, 300);
      setTimeout(wrapPreview, 1200);
    });
  } else {
    setTimeout(boot, 0);
    setTimeout(wrapPreview, 300);
    setTimeout(wrapPreview, 1200);
  }


  // ── Embed + live session sync (Song Builder app) ─────────
  (function wireEmbedSync() {
    var params = new URLSearchParams(location.search || '');
    var embed = params.get('embed') === '1';
    if (embed) {
      document.documentElement.classList.add('hl-embed');
      document.body.classList.add('hl-embed');
    }
    var lastApplied = null;
    var applying = false;
    var selfToken = 'landscape-' + Math.random().toString(36).slice(2, 8);

    function applyRemote(msg) {
      if (applying) return;
      var H = window.HLApp;
      if (!H || !H.S || !H.S()) return;
      var by = (msg && msg.by) || '';
      if (/^landscape/i.test(by)) return; // own writes
      if (msg && msg.updatedAt && msg.updatedAt === lastApplied) return;
      // Fretboard long rows: only take up to FRETBOARD_MAX_CHORDS
      applying = true;
      H._skipSessionPush = true;
      try {
        if (H.S().reloadSongFromDisk) H.S().reloadSongFromDisk();
        var song = H.S().loadSong();
        var cell = song && H.S().getFocusedCell && H.S().getFocusedCell(song);
        if (!cell || !cell.chords || !cell.chords.length) return;
        var max = (H.S().FRETBOARD_MAX_CHORDS) || 8;
        var chords = cell.chords;
        if (chords.length > max) chords = chords.slice(0, max);
        if (H.applySessionChords) {
          H.applySessionChords(chords, {
            title: cell.name || (song && song.title),
            cellId: cell.id,
            packId: cell.packId,
            tonic: song.key && song.key.tonic,
            mode: song.key && song.key.mode,
            bpm: song.bpm,
            focusIndex: song.focus && song.focus.chordIndex,
            liveSwap: true,
          });
        }
        if (H.refreshAll) H.refreshAll();
        else {
          if (H.refreshSequence) H.refreshSequence();
          if (H.refreshMap) H.refreshMap();
        }
        lastApplied = msg && msg.updatedAt;
        if (H.setSyncStatus) H.setSyncStatus('Synced from Fretboard · ' + (cell.name || 'cell'));
      } catch (e) {
        console.warn('landscape remote sync', e);
      } finally {
        setTimeout(function () {
          H._skipSessionPush = false;
          applying = false;
        }, 350);
      }
    }

    function bootSync() {
      var H = window.HLApp;
      if (!H || !H.S || !H.S() || !H.S().subscribeSongChanges) {
        setTimeout(bootSync, 200);
        return;
      }
      H.S().subscribeSongChanges(function (msg) {
        if (!msg || msg.type !== 'song-updated') return;
        applyRemote(msg);
      });
      window.addEventListener('message', function (e) {
        if (e.origin !== location.origin) return;
        var data = e.data || {};
        if (data.source !== 'song-builder') return;
        if (data.type === 'ih-show') {
          applyRemote({ type: 'song-updated', by: 'fretboard', updatedAt: 'show-' + Date.now() });
        }
      });
    }
    setTimeout(bootSync, 400);
  })();

})();