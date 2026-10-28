/**
 * Phone Fretboard UI + Find chord + live session sync + embed mode.
 */
(function () {
  'use strict';

  var PARAMS = new URLSearchParams(location.search || '');
  var EMBED = PARAMS.get('embed') === '1';
  var lastRemoteAt = null;
  var applyingRemote = false;
  var findPoll = null;

  function isMobile() {
    try {
      return window.matchMedia('(max-width: 760px), ((max-width: 980px) and (pointer: coarse))').matches;
    } catch (_) {
      return window.innerWidth <= 760;
    }
  }

  function $(s) { return document.querySelector(s); }
  function $all(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }

  function unlockAudio() {
    try { if (typeof ensureAudio === 'function') ensureAudio(); } catch (_) {}
    try {
      if (typeof audioCtx !== 'undefined' && audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    } catch (_) {}
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!window.__fbUnlock) window.__fbUnlock = new AC();
      if (window.__fbUnlock.state === 'suspended') window.__fbUnlock.resume();
    } catch (_) {}
  }

  function openMore(open) {
    document.body.classList.toggle('fb-more-open', !!open);
  }

  function neckWindowForOrientation() {
    if (!isMobile() || typeof setFretRange !== 'function') return;
    var landscape = false;
    try {
      landscape = window.matchMedia('(orientation: landscape)').matches;
    } catch (_) {
      landscape = window.innerWidth > window.innerHeight;
    }
    if (landscape) setFretRange(0, 12);
    else setFretRange(0, 6);
  }

  function syncPlay() {
    var btn = $('#fb-m-play');
    if (!btn) return;
    var lab = document.getElementById('prog-play-label');
    var playing = lab && /stop/i.test(lab.textContent || '');
    btn.textContent = playing ? 'Stop' : 'Play';
  }

  function analyzeGuess() {
    var el = $('#fb-find-guess');
    var alts = $('#fb-find-alts');
    if (!el) return;
    try {
      if (typeof getChordDetectPcs !== 'function' || typeof analyzePitchSet !== 'function') {
        el.textContent = 'Tap frets…';
        return;
      }
      var pcs = getChordDetectPcs();
      if (!pcs || pcs.size < 2) {
        el.textContent = pcs && pcs.size ? 'Need more notes…' : 'Tap frets on the neck';
        if (alts) alts.textContent = '';
        return;
      }
      var hits = analyzePitchSet(pcs) || [];
      if (!hits.length) {
        el.textContent = 'No exact match';
        if (alts) alts.textContent = 'Try open strings or clear a pin';
        return;
      }
      var top = hits[0];
      var name = (typeof getNoteName === 'function' ? getNoteName(top.root) : top.root) + ' ' + top.name;
      el.textContent = name;
      if (alts) {
        alts.textContent = hits.slice(1, 4).map(function (h) {
          return (typeof getNoteName === 'function' ? getNoteName(h.root) : h.root) + ' ' + h.name;
        }).join(' · ');
      }
    } catch (e) {
      el.textContent = 'Detect…';
    }
  }

  function setFind(on) {
    unlockAudio();
    if (typeof window.setFindChordMode === 'function') {
      window.setFindChordMode(!!on);
    }
    var btn = $('#fb-m-find');
    if (btn) btn.classList.toggle('active', !!on);
    document.body.classList.toggle('fb-find-chord', !!on);
    if (on) {
      if (findPoll) clearInterval(findPoll);
      findPoll = setInterval(analyzeGuess, 280);
      analyzeGuess();
    } else if (findPoll) {
      clearInterval(findPoll);
      findPoll = null;
    }
  }

  function useChord() {
    unlockAudio();
    if (typeof window.useDetectedChord === 'function') {
      window.useDetectedChord({ by: 'fretboard-detect' });
    } else if (typeof applyBestChordDetect === 'function') {
      applyBestChordDetect();
    }
    analyzeGuess();
    setFind(false);
  }

  function applyRemoteSong(msg) {
    if (applyingRemote) return;
    var by = (msg && msg.by) || '';
    // Ignore our own writes
    if (/^fretboard/i.test(by)) return;
    if (msg && msg.updatedAt && msg.updatedAt === lastRemoteAt) return;
    if (!window.IHSession) return;
    applyingRemote = true;
    try {
      if (IHSession.reloadSongFromDisk) IHSession.reloadSongFromDisk();
      else if (IHSession.loadSong) {
        /* force disk next */
      }
      lastRemoteAt = msg && msg.updatedAt;
      if (typeof window.tryLoadFocusedSongCell === 'function') {
        window.tryLoadFocusedSongCell();
      } else if (typeof window.pullFromLandscapeSession === 'function') {
        window.pullFromLandscapeSession();
      }
    } catch (e) {
      console.warn('remote song apply', e);
    } finally {
      setTimeout(function () { applyingRemote = false; }, 200);
    }
  }

  function wireSync() {
    if (!window.IHSession || !IHSession.subscribeSongChanges) return;
    IHSession.subscribeSongChanges(function (msg) {
      if (!msg || msg.type !== 'song-updated') return;
      applyRemoteSong(msg);
    });
    window.addEventListener('message', function (e) {
      if (e.origin !== location.origin) return;
      var data = e.data || {};
      if (data.source !== 'song-builder') return;
      if (data.type === 'ih-show') {
        // Tab became visible — refresh from session
        applyRemoteSong({ type: 'song-updated', by: 'landscape', updatedAt: 'show-' + Date.now() });
      }
    });
  }

  function inject() {
    if (EMBED) {
      document.documentElement.classList.add('fb-embed');
      document.body.classList.add('fb-embed');
    }
    if (isMobile()) document.body.classList.add('fb-mobile-ui');

    if ($('#fb-mbar')) return;

    var mbar = document.createElement('div');
    mbar.id = 'fb-mbar';
    mbar.className = 'fb-mbar';
    mbar.innerHTML =
      '<span class="brand">Fretboard</span>' +
      (EMBED ? '' : '<a href="../harmonic-landscape/" style="font-size:0.75rem;opacity:0.85;text-decoration:underline;color:inherit;min-height:44px;display:inline-flex;align-items:center;padding:0 0.35rem">Landscape</a>') +
      '<button type="button" id="fb-m-find">Find chord</button>' +
      '<button type="button" class="grow" id="fb-m-more">More</button>';

    var shell = $('.app-shell');
    if (shell) shell.insertBefore(mbar, shell.firstChild);
    else document.body.insertBefore(mbar, document.body.firstChild);

    var hint = document.createElement('p');
    hint.className = 'fb-rotate-hint';
    hint.textContent = 'Tip: turn sideways for a wider neck.';
    var boardCard = document.querySelector('.fretboard-container');
    if (boardCard && boardCard.parentElement) {
      boardCard.parentElement.insertBefore(hint, boardCard);
    } else if (shell) shell.appendChild(hint);

    // Neck scrub under board
    var scrub = document.createElement('div');
    scrub.className = 'fb-neck-scrub';
    scrub.innerHTML =
      '<label id="fb-neck-lab">Frets 0–6</label>' +
      '<input type="range" id="fb-neck-pos" min="0" max="18" value="0" step="1" aria-label="Neck position">';
    if (boardCard && boardCard.parentElement) {
      boardCard.parentElement.insertBefore(scrub, boardCard.nextSibling);
    }

    var findBar = document.createElement('div');
    findBar.className = 'fb-find-bar';
    findBar.innerHTML =
      '<div class="guess" id="fb-find-guess">Tap frets on the neck</div>' +
      '<div class="alts" id="fb-find-alts"></div>' +
      '<div class="row">' +
      '<button type="button" class="primary" id="fb-find-use">Use this chord</button>' +
      '<button type="button" id="fb-find-clear">Clear</button>' +
      '<button type="button" id="fb-find-done">Done</button>' +
      '</div>';
    if (boardCard && boardCard.parentElement) {
      boardCard.parentElement.insertBefore(findBar, scrub.nextSibling);
    }

    var dock = document.createElement('div');
    dock.className = 'fb-mdock';
    dock.innerHTML =
      '<button type="button" class="step-btn" id="fb-m-prev" aria-label="Previous">◀</button>' +
      '<button type="button" class="play-big" id="fb-m-play">Play</button>' +
      '<button type="button" class="step-btn" id="fb-m-next" aria-label="Next">▶</button>';
    document.body.appendChild(dock);

    var backdrop = document.createElement('div');
    backdrop.className = 'fb-msheet-backdrop';
    backdrop.id = 'fb-msheet-backdrop';
    document.body.appendChild(backdrop);

    var sheet = document.createElement('div');
    sheet.className = 'fb-msheet';
    sheet.innerHTML =
      '<h3>More</h3>' +
      '<p class="hint">Export to bring the song to your PC. Audio settings live here so the neck stays clear.</p>' +
      '<div class="row">' +
      '<button type="button" id="fb-m-export">Export song</button>' +
      '<button type="button" id="fb-m-share">Copy share link</button>' +
      (EMBED ? '' : '<button type="button" id="fb-m-landscape">Open Landscape</button>') +
      '</div>' +
      '<textarea class="share-out" id="fb-m-share-out" readonly placeholder="Share link appears here"></textarea>' +
      '<div class="row" style="margin-top:0.55rem">' +
      '<button type="button" id="fb-m-loop">Loop</button>' +
      '<button type="button" id="fb-m-click">Click</button>' +
      '<button type="button" id="fb-m-close">Close</button>' +
      '</div>' +
      '<div id="fb-m-audio-host"></div>';
    document.body.appendChild(sheet);

    var audio = $('#audio-panel');
    var host = $('#fb-m-audio-host');
    if (audio && host) {
      var clone = audio.cloneNode(true);
      clone.id = 'fb-m-audio-panel';
      clone.querySelectorAll('[id]').forEach(function (el) { el.id = 'm-' + el.id; });
      host.appendChild(clone);
      ['audio-pattern', 'audio-tempo', 'audio-loop', 'audio-click', 'audio-volume', 'audio-octave'].forEach(function (id) {
        var c = document.getElementById('m-' + id);
        var o = document.getElementById(id);
        if (!c || !o) return;
        var sync = function () {
          if (o.type === 'checkbox') o.checked = c.checked;
          else o.value = c.value;
          o.dispatchEvent(new Event(o.type === 'checkbox' ? 'change' : 'input', { bubbles: true }));
        };
        c.addEventListener('input', sync);
        c.addEventListener('change', sync);
      });
    }

    neckWindowForOrientation();
    setTimeout(function () {
      if (typeof resizeCanvas === 'function') resizeCanvas();
    }, 100);
  }

  function wire() {
    inject();
    wireSync();

    document.addEventListener('pointerup', unlockAudio, { passive: true, capture: true });
    document.addEventListener('touchend', unlockAudio, { passive: true, capture: true });

    $('#fb-m-more') && $('#fb-m-more').addEventListener('click', function () { openMore(true); });
    $('#fb-m-close') && $('#fb-m-close').addEventListener('click', function () { openMore(false); });
    $('#fb-msheet-backdrop') && $('#fb-msheet-backdrop').addEventListener('click', function () { openMore(false); });

    $('#fb-m-find') && $('#fb-m-find').addEventListener('click', function () {
      var on = !(window.isFindChordMode && window.isFindChordMode());
      setFind(on);
    });
    // Desktop detect panel button
    var deskFind = $('#btn-find-chord');
    if (deskFind) {
      deskFind.addEventListener('click', function () {
        var on = !(window.isFindChordMode && window.isFindChordMode());
        setFind(on);
        deskFind.textContent = on ? 'Finding… (tap frets)' : 'Find chord';
      });
    }

    $('#fb-find-use') && $('#fb-find-use').addEventListener('click', useChord);
    $('#fb-find-clear') && $('#fb-find-clear').addEventListener('click', function () {
      if (typeof clearShapePins === 'function') clearShapePins();
      analyzeGuess();
    });
    $('#fb-find-done') && $('#fb-find-done').addEventListener('click', function () { setFind(false); });

    var scrub = $('#fb-neck-pos');
    var lab = $('#fb-neck-lab');
    if (scrub) {
      scrub.addEventListener('input', function () {
        var start = +scrub.value || 0;
        var span = 6;
        try {
          if (window.matchMedia('(orientation: landscape)').matches) span = 12;
        } catch (_) {}
        if (typeof setFretRange === 'function') setFretRange(start, Math.min(24, start + span));
        if (lab) lab.textContent = 'Frets ' + start + '–' + Math.min(24, start + span);
      });
    }

    window.addEventListener('orientationchange', function () {
      setTimeout(neckWindowForOrientation, 200);
    });
    window.addEventListener('resize', function () {
      if (isMobile()) document.body.classList.add('fb-mobile-ui');
    });

    $('#fb-m-play') && $('#fb-m-play').addEventListener('click', function () {
      unlockAudio();
      if (typeof toggleProgressionPlay === 'function') toggleProgressionPlay();
      else { var b = $('#prog-play-btn'); if (b) b.click(); }
      setTimeout(syncPlay, 60);
    });
    $('#fb-m-prev') && $('#fb-m-prev').addEventListener('click', function () {
      unlockAudio();
      if (typeof stepProgression === 'function') stepProgression(-1);
    });
    $('#fb-m-next') && $('#fb-m-next').addEventListener('click', function () {
      unlockAudio();
      if (typeof stepProgression === 'function') stepProgression(1);
    });

    $('#fb-m-export') && $('#fb-m-export').addEventListener('click', function () {
      unlockAudio();
      if (typeof exportInstanceFile === 'function') exportInstanceFile();
    });
    $('#fb-m-share') && $('#fb-m-share').addEventListener('click', function () {
      unlockAudio();
      try {
        if (!window.IHSession) return;
        if (typeof pushProgressionToSongSession === 'function') pushProgressionToSongSession('fretboard');
        var song = IHSession.loadSong && IHSession.loadSong();
        var cell = song && IHSession.getFocusedCell && IHSession.getFocusedCell(song);
        if (!cell) return;
        var payload = IHSession.buildHandoffPayload({
          by: 'fretboard', to: 'landscape', title: cell.name, bpm: song.bpm,
          key: song.key, cellId: cell.id, cellName: cell.name,
          chords: (cell.chords || []).slice(0, IHSession.FRETBOARD_MAX_CHORDS || 8),
        });
        var hash = IHSession.encodeHandoff(payload);
        var frag = hash ? (hash.charAt(0) === '#' ? hash : '#' + hash) : '';
        var url = location.origin + '/tools/harmonic-landscape/' + frag;
        var out = $('#fb-m-share-out');
        if (out) out.value = url;
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).catch(function () {});
      } catch (e) { console.warn(e); }
    });
    $('#fb-m-landscape') && $('#fb-m-landscape').addEventListener('click', function () {
      location.href = '../harmonic-landscape/';
    });
    $('#fb-m-loop') && $('#fb-m-loop').addEventListener('click', function () {
      var o = $('#audio-loop');
      if (o) { o.checked = !o.checked; o.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    $('#fb-m-click') && $('#fb-m-click').addEventListener('click', function () {
      var o = $('#audio-click');
      if (o) { o.checked = !o.checked; o.dispatchEvent(new Event('change', { bubbles: true })); }
    });

    setInterval(function () { if (isMobile()) syncPlay(); }, 500);
  }

  function boot() {
    // Wait for main app init
    var n = 0;
    var t = setInterval(function () {
      n++;
      if (typeof toggleShapePin === 'function' || n > 40) {
        clearInterval(t);
        wire();
      }
    }, 100);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
