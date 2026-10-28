/**
 * Song Builder shell — Landscape + Fretboard iframes, install, tab switch.
 */
(function () {
  'use strict';

  var tab = 'landscape';
  var deferredPrompt = null;
  var frames = {
    landscape: null,
    fretboard: null,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function isIos() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function isStandalone() {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
    );
  }

  function showTab(name) {
    tab = name === 'fretboard' ? 'fretboard' : 'landscape';
    var fl = $('frame-landscape');
    var ff = $('frame-fretboard');
    if (fl) fl.hidden = tab !== 'landscape';
    if (ff) ff.hidden = tab !== 'fretboard';
    document.querySelectorAll('#tabs button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === tab);
    });
    var tool = $('top-tool');
    if (tool) tool.textContent = tab === 'fretboard' ? 'Fretboard' : 'Landscape';
    var find = $('btn-find');
    var more = $('btn-tool-more');
    if (find) find.hidden = tab !== 'fretboard';
    if (more) more.hidden = tab !== 'fretboard';
    if (find) find.classList.remove('active');
    // Tell visible tool to refresh from shared session
    pingFrame(tab, { type: 'ih-show', tab: tab });
  }

  function pingFrame(name, msg) {
    var iframe = name === 'fretboard' ? $('frame-fretboard') : $('frame-landscape');
    if (!iframe || !iframe.contentWindow) return;
    try {
      iframe.contentWindow.postMessage(Object.assign({ source: 'song-builder' }, msg), location.origin);
    } catch (_) {}
  }

  function ensureFrames() {
    var fl = $('frame-landscape');
    var ff = $('frame-fretboard');
    if (fl && !fl.src) {
      fl.src = '../harmonic-landscape/index.html?embed=1';
    }
    if (ff && !ff.src) {
      // slight delay so Landscape boots first on weak phones
      setTimeout(function () {
        ff.src = '../fretboard/index.html?embed=1';
      }, 250);
    }
  }

  function registerSw() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker
      .register('../sw.js', { scope: '/tools/' })
      .then(function (reg) {
        console.info('[Song Builder] SW registered', reg.scope);
      })
      .catch(function (err) {
        console.warn('[Song Builder] SW failed', err);
      });
  }

  function wireInstall() {
    var btn = $('btn-install');
    var banner = $('install-banner');
    var ios = $('ios-hint');

    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredPrompt = e;
      if (btn) btn.hidden = false;
      if (banner && !isStandalone()) banner.classList.add('show');
    });

    window.addEventListener('appinstalled', function () {
      deferredPrompt = null;
      if (btn) btn.hidden = true;
      if (banner) banner.classList.remove('show');
    });

    function doInstall() {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.finally(function () {
          deferredPrompt = null;
          if (banner) banner.classList.remove('show');
        });
        return;
      }
      if (isIos() && !isStandalone()) {
        if (ios) ios.classList.add('show');
        return;
      }
      alert('Open this page in Chrome / Edge / Safari. On Android use Install app; on iPhone use Share → Add to Home Screen.');
    }

    if (btn) btn.addEventListener('click', doInstall);
    var bi = $('banner-install');
    if (bi) bi.addEventListener('click', doInstall);
    var bd = $('banner-dismiss');
    if (bd) bd.addEventListener('click', function () {
      if (banner) banner.classList.remove('show');
    });
    var id = $('ios-dismiss');
    if (id) id.addEventListener('click', function () {
      if (ios) ios.classList.remove('show');
    });

    // iOS: show install button as hint
    if (isIos() && !isStandalone() && btn) {
      btn.hidden = false;
      btn.textContent = 'Add to Home';
    }
  }

  function boot() {
    ensureFrames();
    registerSw();
    wireInstall();
    document.querySelectorAll('#tabs button').forEach(function (b) {
      b.addEventListener('click', function () {
        showTab(b.getAttribute('data-tab'));
      });
    });
    var findBtn = $('btn-find');
    if (findBtn) {
      findBtn.addEventListener('click', function () {
        // Always open the Add chord sheet (Find on neck + Quick pick)
        findBtn.classList.add('active');
        pingFrame('fretboard', { type: 'ih-add-chord' });
      });
    }
    window.addEventListener('message', function (e) {
      if (e.origin !== location.origin) return;
      var data = e.data || {};
      if (data.source === 'song-builder-fb' && data.type === 'ih-find-state') {
        if (findBtn) findBtn.classList.toggle('active', !!data.on);
      }
    });
    var moreBtn = $('btn-tool-more');
    if (moreBtn) {
      moreBtn.addEventListener('click', function () {
        pingFrame('fretboard', { type: 'ih-more' });
      });
    }
    showTab('landscape');

    // Hash deep-link: #fretboard / #landscape
    if (/fretboard/i.test(location.hash || '')) showTab('fretboard');

    window.addEventListener('message', function (e) {
      if (e.origin !== location.origin) return;
      var data = e.data || {};
      if (data.type === 'ih-request-tab' && data.tab) showTab(data.tab);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
