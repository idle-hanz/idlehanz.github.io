/**
 * Phone helpers for Guitar Fretboard — sticky transport, More sheet, share.
 */
(function () {
  'use strict';

  function isMobile() {
    try {
      return window.matchMedia('(max-width: 760px), ((max-width: 980px) and (pointer: coarse))').matches;
    } catch (_) {
      return window.innerWidth <= 760;
    }
  }

  function $(s) {
    return document.querySelector(s);
  }

  function unlockAudio() {
    try {
      if (typeof ensureAudio === 'function') ensureAudio();
    } catch (_) {}
    try {
      if (typeof audioCtx !== 'undefined' && audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
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

  function buildShare() {
    try {
      if (typeof IHSession === 'undefined' || !IHSession.buildHandoffPayload) return null;
      // Prefer current progression if available
      var chords = [];
      if (typeof progression !== 'undefined' && Array.isArray(progression)) {
        chords = progression.map(function (c) {
          return {
            name: c.name || c.label || '',
            notes: c.notes || c.pcs || [],
            root: c.root,
            quality: c.quality,
            duration: c.duration || 4,
          };
        });
      }
      if (!chords.length && typeof getProgressionForExport === 'function') {
        chords = getProgressionForExport() || [];
      }
      if (!chords.length) return null;
      return IHSession.buildHandoffPayload({
        by: 'fretboard',
        to: 'landscape',
        title: 'Fretboard song',
        bpm: (typeof getTempo === 'function' ? getTempo() : 90),
        chords: chords,
        ephemeral: true,
      });
    } catch (e) {
      console.warn('share build failed', e);
      return null;
    }
  }

  function copyShareLink() {
    unlockAudio();
    var payload = buildShare();
    if (!payload) {
      // Fallback: export instance JSON if available
      if (typeof exportInstanceFile === 'function') {
        exportInstanceFile();
        return;
      }
      alert('Nothing to share yet — add some chords first.');
      return;
    }
    var hash = IHSession.encodeHandoff(payload);
    var frag = hash ? (hash.charAt(0) === '#' ? hash : '#' + hash) : '';
    var url =
      !location.origin || location.origin === 'null'
        ? '../harmonic-landscape/index.html' + frag
        : location.origin + '/tools/harmonic-landscape/' + frag;
    var out = $('#fb-m-share-out');
    if (out) out.value = url;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).catch(function () {});
    }
  }

  function exportSong() {
    unlockAudio();
    if (typeof exportInstanceFile === 'function') {
      exportInstanceFile();
      return;
    }
    var payload = buildShare();
    if (!payload) {
      alert('Nothing to export yet.');
      return;
    }
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'fretboard-song.json';
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
    }, 400);
  }

  function syncPlay() {
    var btn = $('#fb-m-play');
    if (!btn) return;
    var lab = document.getElementById('prog-play-label');
    var playing = lab && /stop/i.test(lab.textContent || '');
    btn.textContent = playing ? 'Stop' : 'Play';
  }

  function hideDesktopHeader() {
    var h = document.querySelector('.app-header');
    if (h) h.setAttribute('data-fb-desktop-header', '1');
  }

  function inject() {
    if ($('#fb-mbar')) return;
    hideDesktopHeader();

    var mbar = document.createElement('div');
    mbar.id = 'fb-mbar';
    mbar.className = 'fb-mbar';
    mbar.innerHTML =
      '<span class="brand">Fretboard</span>' +
      '<a href="../harmonic-landscape/" style="font-size:0.75rem;opacity:0.85;text-decoration:underline;color:inherit;min-height:44px;display:inline-flex;align-items:center;padding:0 0.35rem">Landscape</a>' +
      '<button type="button" class="grow" id="fb-m-more">More</button>';

    var shell = $('.app-shell');
    if (shell) shell.insertBefore(mbar, shell.firstChild);
    else document.body.insertBefore(mbar, document.body.firstChild);

    var hint = document.createElement('p');
    hint.className = 'fb-rotate-hint';
    hint.textContent = 'Tip: turn the phone sideways for a wider neck.';
    if (shell) {
      var header = shell.querySelector('.app-header');
      if (header && header.nextSibling) shell.insertBefore(hint, header.nextSibling);
      else shell.appendChild(hint);
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
      '<h3>More · export &amp; settings</h3>' +
      '<p class="hint">Saves in this phone browser. Export JSON or copy a link to open in Landscape / on your PC.</p>' +
      '<div class="row">' +
      '<button type="button" id="fb-m-export">Export / Share song</button>' +
      '<button type="button" id="fb-m-share">Copy share link</button>' +
      '<button type="button" id="fb-m-landscape">Open Landscape</button>' +
      '</div>' +
      '<textarea class="share-out" id="fb-m-share-out" readonly placeholder="Share link appears here"></textarea>' +
      '<div class="row" style="margin-top:0.55rem">' +
      '<button type="button" id="fb-m-loop">Toggle loop</button>' +
      '<button type="button" id="fb-m-click">Toggle click</button>' +
      '<button type="button" id="fb-m-close">Close</button>' +
      '</div>' +
      '<div id="fb-m-audio-host"></div>';
    document.body.appendChild(sheet);

    // Relocate audio panel controls into sheet for phone (clone reference by moving DOM)
    var audio = $('#audio-panel');
    var host = $('#fb-m-audio-host');
    if (audio && host) {
      // Keep original in place for desktop; clone interactive bits for phone sheet
      var clone = audio.cloneNode(true);
      clone.id = 'fb-m-audio-panel';
      // Avoid duplicate IDs — strip ids on clone
      clone.querySelectorAll('[id]').forEach(function (el) {
        el.id = 'm-' + el.id;
      });
      host.appendChild(clone);
      // Wire clone controls to originals where possible
      ['audio-pattern', 'audio-tempo', 'audio-loop', 'audio-click', 'audio-volume', 'audio-octave'].forEach(function (id) {
        var c = document.getElementById('m-' + id);
        var o = document.getElementById(id);
        if (!c || !o) return;
        c.addEventListener('input', function () {
          if (o.type === 'checkbox') o.checked = c.checked;
          else o.value = c.value;
          o.dispatchEvent(new Event(o.type === 'checkbox' ? 'change' : 'input', { bubbles: true }));
        });
        c.addEventListener('change', function () {
          if (o.type === 'checkbox') o.checked = c.checked;
          else o.value = c.value;
          o.dispatchEvent(new Event('change', { bubbles: true }));
        });
      });
    }
  }

  function wire() {
    inject();
    document.addEventListener('pointerup', unlockAudio, { passive: true, capture: true });
    document.addEventListener('touchend', unlockAudio, { passive: true, capture: true });

    $('#fb-m-more') &&
      $('#fb-m-more').addEventListener('click', function () {
        openMore(true);
      });
    $('#fb-m-close') &&
      $('#fb-m-close').addEventListener('click', function () {
        openMore(false);
      });
    $('#fb-msheet-backdrop') &&
      $('#fb-msheet-backdrop').addEventListener('click', function () {
        openMore(false);
      });

    $('#fb-m-play') &&
      $('#fb-m-play').addEventListener('click', function () {
        unlockAudio();
        if (typeof toggleProgressionPlay === 'function') toggleProgressionPlay();
        else {
          var b = $('#prog-play-btn');
          if (b) b.click();
        }
        setTimeout(syncPlay, 60);
      });
    $('#fb-m-prev') &&
      $('#fb-m-prev').addEventListener('click', function () {
        unlockAudio();
        if (typeof stepProgression === 'function') stepProgression(-1);
      });
    $('#fb-m-next') &&
      $('#fb-m-next').addEventListener('click', function () {
        unlockAudio();
        if (typeof stepProgression === 'function') stepProgression(1);
      });
    $('#fb-m-export') && $('#fb-m-export').addEventListener('click', exportSong);
    $('#fb-m-share') && $('#fb-m-share').addEventListener('click', copyShareLink);
    $('#fb-m-landscape') &&
      $('#fb-m-landscape').addEventListener('click', function () {
        location.href = '../harmonic-landscape/';
      });
    $('#fb-m-loop') &&
      $('#fb-m-loop').addEventListener('click', function () {
        var o = $('#audio-loop');
        if (o) {
          o.checked = !o.checked;
          o.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    $('#fb-m-click') &&
      $('#fb-m-click').addEventListener('click', function () {
        var o = $('#audio-click');
        if (o) {
          o.checked = !o.checked;
          o.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });

    setInterval(function () {
      if (isMobile()) syncPlay();
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(wire, 0);
    });
  } else {
    setTimeout(wire, 0);
  }
})();
