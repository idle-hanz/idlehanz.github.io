/**
 * Phone Fretboard — one screen: tap neck → pick name chip → Stick ↓ → strip.
 * No sheets / modes. Neck always places shape pins.
 */
(function () {
  'use strict';

  var PARAMS = new URLSearchParams(location.search || '');
  var EMBED = PARAMS.get('embed') === '1';
  var lastRemoteAt = null;
  var applyingRemote = false;
  var poll = null;
  var selectedHit = null; // { root, typeIdx, name, label }
  var editingIdx = null; // null = will add new; number = update that slot
  var STRING_LABELS = ['e', 'B', 'G', 'D', 'A', 'E'];
  var lastHitsSig = '';

  function isMobile() {
    try {
      return window.matchMedia('(max-width: 760px), ((max-width: 980px) and (pointer: coarse))').matches;
    } catch (_) {
      return window.innerWidth <= 760;
    }
  }

  function $(s) { return document.querySelector(s); }

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

  function toast(msg) {
    var el = $('#fb-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'fb-toast';
      el.className = 'fb-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('show'); }, 1600);
  }

  function noteName(pc) {
    try {
      if (typeof getNoteName === 'function') return getNoteName(pc);
    } catch (_) {}
    return ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][((pc % 12) + 12) % 12];
  }

  function songKeyTonic() {
    try {
      if (window.IHSession && IHSession.loadSong) {
        var song = IHSession.loadSong();
        if (song && song.key && song.key.tonic != null) return ((+song.key.tonic) % 12 + 12) % 12;
      }
    } catch (_) {}
    return 0;
  }

  function songKeyMode() {
    try {
      if (window.IHSession && IHSession.loadSong) {
        var song = IHSession.loadSong();
        var m = song && song.key && (song.key.mode || song.key.quality || '');
        if (/min/i.test(String(m))) return 'minor';
      }
    } catch (_) {}
    return 'major';
  }

  function diatonicPicks() {
    var t = songKeyTonic();
    var minor = songKeyMode() === 'minor';
    var steps = minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
    var quals = minor ? [1, 6, 0, 1, 1, 0, 0] : [0, 1, 1, 0, 0, 1, 6];
    var romans = minor
      ? ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII']
      : ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
    return steps.map(function (st, i) {
      var root = (t + st) % 12;
      var ti = quals[i];
      var short = noteName(root) + (ti === 1 ? 'm' : ti === 6 ? 'dim' : '');
      return { root: root, typeIdx: ti, short: short, roman: romans[i] };
    });
  }

  function getPinMap() {
    if (typeof window.getShapePinFrets === 'function') return window.getShapePinFrets() || {};
    return {};
  }

  function fretsArrayFromPins() {
    var n = 6;
    try { if (typeof numStrings === 'function') n = numStrings(); } catch (_) {}
    var pins = getPinMap();
    var out = [];
    for (var s = 0; s < n; s++) {
      out.push(pins[s] == null ? -1 : (pins[s] | 0));
    }
    return out;
  }

  function ensurePhonePinMode() {
    // Neck taps must always place pins on phone — no mode to enter.
    // Do NOT re-call setFindChordMode when already on (avoids updateFretboard thrash).
    document.body.classList.add('fb-phone-compose');
    try {
      if (window.isFindChordMode && window.isFindChordMode()) return;
      if (typeof window.setFindChordMode === 'function') window.setFindChordMode(true);
    } catch (_) {}
    try {
      if (typeof setScaleDisplay === 'function') setScaleDisplay('off');
    } catch (_) {}
  }

  function renderStringRow() {
    var row = $('#fb-string-row');
    if (!row) return;
    var pins = getPinMap();
    var n = 6;
    try { if (typeof numStrings === 'function') n = numStrings(); } catch (_) {}
    var html = '';
    for (var s = 0; s < n; s++) {
      var lab = STRING_LABELS[s] || ('S' + (s + 1));
      var f = pins[s];
      var state = (f == null) ? 'X' : (f === 0 ? 'O' : String(f));
      var cls = (f == null) ? 'muted' : (f === 0 ? 'open' : 'fretted');
      html +=
        '<div class="fb-str ' + cls + '" data-s="' + s + '">' +
        '<span class="lab">' + lab + '</span>' +
        '<button type="button" class="st" data-act="state" data-s="' + s + '">' + state + '</button>' +
        '<button type="button" class="mx" data-act="mute" data-s="' + s + '" aria-label="Mute">×</button>' +
        '</div>';
    }
    row.innerHTML = html;
  }

  function hitLabel(h) {
    if (!h) return '';
    return noteName(h.root) + ' ' + h.name;
  }

  function shortLabel(h) {
    if (!h) return '';
    var n = noteName(h.root);
    var nm = String(h.name || '');
    if (/^Major$/i.test(nm)) return n;
    if (/^Minor$/i.test(nm)) return n + 'm';
    if (/Dominant 7/i.test(nm)) return n + '7';
    if (/Major 7/i.test(nm)) return n + 'maj7';
    if (/Minor 7/i.test(nm)) return n + 'm7';
    if (/Diminish/i.test(nm)) return n + 'dim';
    if (/^sus/i.test(nm)) return n + nm;
    return n + ' ' + nm;
  }

  function renderChips(hits) {
    var host = $('#fb-name-chips');
    if (!host) return;
    hits = hits || [];
    if (!hits.length) {
      host.innerHTML = '<div class="fb-chip-hint">Tap frets on the neck</div>';
      selectedHit = null;
      syncStickBtn();
      return;
    }
    // Keep selection if still in list
    if (selectedHit) {
      var still = hits.some(function (h) {
        return h.root === selectedHit.root && h.typeIdx === selectedHit.typeIdx;
      });
      if (!still) selectedHit = null;
    }
    if (!selectedHit) {
      selectedHit = {
        root: hits[0].root,
        typeIdx: hits[0].typeIdx,
        name: hits[0].name,
        label: shortLabel(hits[0])
      };
    }
    host.innerHTML = hits.slice(0, 6).map(function (h, i) {
      var lab = shortLabel(h);
      var full = hitLabel(h);
      var sel = selectedHit && selectedHit.root === h.root && selectedHit.typeIdx === h.typeIdx;
      return '<button type="button" class="fb-name-chip' + (sel ? ' selected' : '') + (i === 0 ? ' best' : '') +
        '" data-i="' + i + '" title="' + full + '">' + lab + '</button>';
    }).join('');
    syncStickBtn();
  }

  function analyze() {
    renderStringRow();
    var stick = $('#fb-stick');
    try {
      var pins = getPinMap();
      var pinCount = Object.keys(pins).length;
      if (pinCount < 2) {
        lastHitsSig = 'empty';
        renderChips([]);
        var hint = $('#fb-compose-hint');
        if (hint) {
          hint.textContent = editingIdx != null
            ? ('Editing chord ' + (editingIdx + 1) + ' — tap frets, then Stick')
            : 'Tap frets · nut = open · × = mute';
        }
        if (stick) stick.disabled = true;
        return;
      }
      if (typeof getChordDetectPcs !== 'function' || typeof analyzePitchSet !== 'function') {
        renderChips([]);
        return;
      }
      var pcs = getChordDetectPcs();
      var hits = (pcs && pcs.size >= 2) ? (analyzePitchSet(pcs) || []) : [];
      var sig = hits.map(function (h) { return h.root + ':' + h.typeIdx; }).join('|') + '#' + pinCount;
      if (sig !== lastHitsSig) {
        lastHitsSig = sig;
        renderChips(hits);
      } else {
        renderStringRow();
        syncStickBtn();
      }
      var hint2 = $('#fb-compose-hint');
      if (hint2 && hits[0]) {
        hint2.textContent = editingIdx != null
          ? ('Editing ' + (editingIdx + 1) + ' · ' + shortLabel(hits[0]))
          : ('Looks like ' + shortLabel(hits[0]) + ' — Stick when ready');
      }
    } catch (e) {
      console.warn('analyze', e);
    }
  }

  function syncStickBtn() {
    var stick = $('#fb-stick');
    if (!stick) return;
    var pins = getPinMap();
    var ok = Object.keys(pins).length >= 2 && selectedHit;
    stick.disabled = !ok;
    if (editingIdx != null) {
      stick.textContent = ok ? ('Update · ' + selectedHit.label) : 'Update';
      stick.classList.add('updating');
    } else {
      stick.textContent = ok ? ('Stick ↓  ' + selectedHit.label) : 'Stick ↓';
      stick.classList.remove('updating');
    }
  }

  function clearNeck() {
    try {
      if (typeof clearShapePins === 'function') clearShapePins();
      if (typeof clearDetectNotes === 'function') clearDetectNotes();
      if (typeof clearExtraPins === 'function') clearExtraPins();
    } catch (_) {}
    selectedHit = null;
    lastHitsSig = '';
    analyze();
  }

  function stickChord() {
    unlockAudio();
    if (!selectedHit) {
      toast('Pick a name first');
      return;
    }
    var frets = fretsArrayFromPins();
    var voiced = frets.filter(function (f) { return f >= 0; }).length;
    if (voiced < 2) {
      toast('Need at least two strings');
      return;
    }
    var opts = {
      by: 'fretboard-phone',
      root: selectedHit.root,
      typeIdx: selectedHit.typeIdx,
      frets: frets,
      label: selectedHit.label
    };
    if (editingIdx != null) {
      opts.updateIdx = editingIdx;
    } else {
      opts.addNew = true;
    }
    if (typeof window.stickVoicedChord === 'function') {
      window.stickVoicedChord(opts);
    } else if (typeof window.useDetectedChord === 'function') {
      window.useDetectedChord({ by: opts.by, addNew: !opts.updateIdx, updateIdx: opts.updateIdx });
    }
    toast((editingIdx != null ? 'Updated ' : 'Stuck ') + selectedHit.label);
    editingIdx = null;
    document.body.classList.remove('fb-editing');
    clearNeck();
    ensurePhonePinMode();
    simplifySlotCards();
    markStripSelection();
  }

  function loadSlotOntoNeck(idx) {
    unlockAudio();
    ensurePhonePinMode();
    editingIdx = idx;
    document.body.classList.add('fb-editing');
    if (typeof window.loadSlotVoicing === 'function') {
      window.loadSlotVoicing(idx);
    }
    // Focus that slot
    if (typeof window.setProgressionFocus === 'function') {
      window.setProgressionFocus(idx);
    }
    selectedHit = null;
    lastHitsSig = '';
    setTimeout(analyze, 50);
    toast('Editing chord ' + (idx + 1));
    markStripSelection();
  }

  function markStripSelection() {
    var host = document.getElementById('progression-slots');
    if (!host) return;
    Array.prototype.forEach.call(host.children, function (el, i) {
      el.classList.toggle('fb-strip-edit', editingIdx != null && i === editingIdx);
    });
  }

  function onStringRowClick(e) {
    var btn = e.target.closest('button[data-act]');
    if (!btn) return;
    var s = +btn.getAttribute('data-s');
    var act = btn.getAttribute('data-act');
    unlockAudio();
    ensurePhonePinMode();
    if (act === 'mute') {
      if (typeof window.muteShapeString === 'function') window.muteShapeString(s);
    } else if (act === 'state') {
      var pins = getPinMap();
      if (pins[s] == null) {
        if (typeof toggleShapePin === 'function') toggleShapePin(s, 0);
      } else if (pins[s] === 0) {
        if (typeof window.muteShapeString === 'function') window.muteShapeString(s);
      } else {
        if (typeof window.muteShapeString === 'function') window.muteShapeString(s);
      }
    }
    analyze();
  }

  function applyRemoteSong(msg) {
    if (applyingRemote) return;
    var by = (msg && msg.by) || '';
    if (/^fretboard/i.test(by)) return;
    if (msg && msg.updatedAt && msg.updatedAt === lastRemoteAt) return;
    if (!window.IHSession) return;
    applyingRemote = true;
    try {
      if (IHSession.reloadSongFromDisk) IHSession.reloadSongFromDisk();
      lastRemoteAt = msg && msg.updatedAt;
      if (typeof window.tryLoadFocusedSongCell === 'function') window.tryLoadFocusedSongCell();
      else if (typeof window.pullFromLandscapeSession === 'function') window.pullFromLandscapeSession();
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
        applyRemoteSong({ type: 'song-updated', by: 'landscape', updatedAt: 'show-' + Date.now() });
        setTimeout(function () {
          if (typeof resizeCanvas === 'function') resizeCanvas();
          neckWindowForOrientation();
          ensurePhonePinMode();
        }, 80);
      }
      if (data.type === 'ih-more') openMore(true);
      if (data.type === 'ih-more-close') openMore(false);
      if (data.type === 'ih-clear-neck') {
        editingIdx = null;
        document.body.classList.remove('fb-editing');
        clearNeck();
      }
      // Legacy messages — ignore sheets, keep composing
      if (data.type === 'ih-add-chord' || data.type === 'ih-find-chord') {
        ensurePhonePinMode();
        clearNeck();
      }
    });
  }

  function neckWindowForOrientation() {
    if (!isMobile() || typeof setFretRange !== 'function') return;
    var landscape = false;
    try {
      landscape = window.matchMedia('(orientation: landscape)').matches;
    } catch (_) {
      landscape = window.innerWidth > window.innerHeight;
    }
    if (landscape) setFretRange(0, 8);
    else setFretRange(0, 5);
    setTimeout(function () {
      if (typeof resizeCanvas === 'function') resizeCanvas();
      syncScrubLabel();
    }, 30);
  }

  function syncScrubLabel() {
    var lab = document.getElementById('fb-neck-lab');
    var scrub = document.getElementById('fb-neck-pos');
    if (!lab || typeof startFret === 'undefined') return;
    var a = startFret | 0;
    var b = (typeof endFret !== 'undefined' ? endFret : a + 5) | 0;
    lab.textContent = 'Frets ' + a + '–' + b;
    if (scrub) {
      var nFrets = a === 0 ? b : (b - a + 1);
      scrub.max = String(Math.max(0, 24 - nFrets + 1));
      scrub.value = String(a);
    }
  }

  function syncPlay() {
    var btn = $('#fb-m-play');
    if (!btn) return;
    var lab = document.getElementById('prog-play-label');
    var playing = lab && /stop/i.test(lab.textContent || '');
    btn.textContent = playing ? 'Stop' : 'Play';
  }

  function renderQuickMini() {
    var host = $('#fb-quick-mini');
    if (!host) return;
    var picks = diatonicPicks();
    host.innerHTML = picks.map(function (p, i) {
      return '<button type="button" class="fb-qmini" data-i="' + i + '">' + p.short + '</button>';
    }).join('');
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
      (EMBED ? '' : '<a href="../harmonic-landscape/" class="fb-link">Landscape</a>') +
      '<button type="button" id="fb-m-clear">Clear</button>' +
      '<button type="button" class="grow" id="fb-m-more">More</button>';
    var shell = $('.app-shell');
    if (shell) shell.insertBefore(mbar, shell.firstChild);
    else document.body.insertBefore(mbar, document.body.firstChild);

    var boardCard = document.querySelector('.fretboard-container');
    var parent = boardCard && boardCard.parentElement;

    // Compose HUD — ABOVE neck, never covers it
    var hud = document.createElement('div');
    hud.className = 'fb-compose';
    hud.id = 'fb-compose';
    hud.innerHTML =
      '<div class="fb-compose-hint" id="fb-compose-hint">Tap frets · nut = open · × = mute</div>' +
      '<div class="fb-name-chips" id="fb-name-chips"><div class="fb-chip-hint">Tap frets on the neck</div></div>' +
      '<div class="fb-string-row" id="fb-string-row"></div>' +
      '<div class="fb-compose-actions">' +
      '<button type="button" class="stick" id="fb-stick" disabled>Stick ↓</button>' +
      '<button type="button" class="ghost" id="fb-cancel-edit" hidden>Cancel edit</button>' +
      '</div>' +
      '<div class="fb-quick-mini" id="fb-quick-mini" title="Quick pick in key"></div>';
    if (parent) parent.insertBefore(hud, boardCard);

    var scrub = document.createElement('div');
    scrub.className = 'fb-neck-scrub';
    scrub.innerHTML =
      '<label id="fb-neck-lab">Frets 0–5</label>' +
      '<input type="range" id="fb-neck-pos" min="0" max="18" value="0" step="1" aria-label="Neck position">';
    if (parent) parent.insertBefore(scrub, boardCard.nextSibling);

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
      '<p class="hint">Export to bring the song to your PC.</p>' +
      '<div class="row">' +
      '<button type="button" id="fb-m-export">Export song</button>' +
      '<button type="button" id="fb-m-share">Copy share link</button>' +
      (EMBED ? '' : '<button type="button" id="fb-m-landscape">Open Landscape</button>') +
      '</div>' +
      '<textarea class="share-out" id="fb-m-share-out" readonly></textarea>' +
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
    try {
      var cos = document.getElementById('colour-open-strings');
      if (cos) { cos.checked = false; cos.dispatchEvent(new Event('change', { bubbles: true })); }
      var sn = document.getElementById('show-notes');
      if (sn) { sn.checked = false; sn.dispatchEvent(new Event('change', { bubbles: true })); }
    } catch (_) {}

    renderQuickMini();
    ensurePhonePinMode();

    setTimeout(function () {
      if (typeof resizeCanvas === 'function') resizeCanvas();
      syncScrubLabel();
      ensurePhonePinMode();
      if (typeof updateFretboard === 'function') updateFretboard();
      simplifySlotCards();
      analyze();
    }, 120);
    setTimeout(function () {
      if (typeof resizeCanvas === 'function') resizeCanvas();
      ensurePhonePinMode();
    }, 400);
  }

  function simplifySlotCards() {
    var host = document.getElementById('progression-slots');
    if (!host) return;
    Array.prototype.forEach.call(host.children, function (card, idx) {
      card.querySelectorAll('select, input, label, .fa-eye, [onclick*="cycleSlotEye"]').forEach(function (el) {
        el.style.display = 'none';
      });
      card.querySelectorAll('[onclick*="removeSlot"]').forEach(function (el) {
        el.style.display = '';
        el.textContent = '×';
        el.classList.add('fb-slot-x');
        el.setAttribute('data-rm', String(idx));
      });
      // Tap card (not ×) → load voicing
      if (!card.dataset.fbWire) {
        card.dataset.fbWire = '1';
        card.addEventListener('click', function (e) {
          if (e.target.closest('.fb-slot-x, [onclick*="removeSlot"], select, input, button.vis-toggle')) return;
          var i = card.dataset.slotIndex != null ? +card.dataset.slotIndex : idx;
          loadSlotOntoNeck(i);
        });
        // Long-press delete
        var hold = null;
        card.addEventListener('pointerdown', function (e) {
          if (e.target.closest('.fb-slot-x, button, select, input')) return;
          hold = setTimeout(function () {
            hold = null;
            if (typeof window.removeSlot === 'function') {
              window.removeSlot(card.dataset.slotIndex != null ? +card.dataset.slotIndex : idx);
              if (editingIdx === idx) {
                editingIdx = null;
                document.body.classList.remove('fb-editing');
                clearNeck();
              }
              toast('Removed');
              simplifySlotCards();
            }
          }, 650);
        });
        card.addEventListener('pointerup', function () { if (hold) clearTimeout(hold); hold = null; });
        card.addEventListener('pointercancel', function () { if (hold) clearTimeout(hold); hold = null; });
        card.addEventListener('pointerleave', function () { if (hold) clearTimeout(hold); hold = null; });
      }
    });
    markStripSelection();
  }

  function wire() {
    inject();
    wireSync();

    document.addEventListener('pointerup', unlockAudio, { passive: true, capture: true });
    document.addEventListener('touchend', unlockAudio, { passive: true, capture: true });

    // After any canvas interaction, refresh chips
    var canvas = document.getElementById('fretboard');
    if (canvas) {
      ['click', 'pointerup', 'touchend'].forEach(function (ev) {
        canvas.addEventListener(ev, function () {
          ensurePhonePinMode();
          setTimeout(analyze, 30);
        }, { passive: true });
      });
    }

    $('#fb-m-more') && $('#fb-m-more').addEventListener('click', function () { openMore(true); });
    $('#fb-m-close') && $('#fb-m-close').addEventListener('click', function () { openMore(false); });
    $('#fb-msheet-backdrop') && $('#fb-msheet-backdrop').addEventListener('click', function () { openMore(false); });
    $('#fb-m-clear') && $('#fb-m-clear').addEventListener('click', function () {
      editingIdx = null;
      document.body.classList.remove('fb-editing');
      clearNeck();
      toast('Neck cleared');
    });
    $('#fb-stick') && $('#fb-stick').addEventListener('click', stickChord);
    $('#fb-cancel-edit') && $('#fb-cancel-edit').addEventListener('click', function () {
      editingIdx = null;
      document.body.classList.remove('fb-editing');
      clearNeck();
      $('#fb-cancel-edit').hidden = true;
    });
    $('#fb-string-row') && $('#fb-string-row').addEventListener('click', onStringRowClick);
    $('#fb-name-chips') && $('#fb-name-chips').addEventListener('click', function (e) {
      var b = e.target.closest('.fb-name-chip');
      if (!b) return;
      var i = +b.getAttribute('data-i');
      try {
        var pcs = getChordDetectPcs();
        var hits = analyzePitchSet(pcs) || [];
        var h = hits[i];
        if (!h) return;
        selectedHit = { root: h.root, typeIdx: h.typeIdx, name: h.name, label: shortLabel(h) };
        renderChips(hits);
      } catch (_) {}
    });
    $('#fb-quick-mini') && $('#fb-quick-mini').addEventListener('click', function (e) {
      var b = e.target.closest('.fb-qmini');
      if (!b) return;
      var picks = diatonicPicks();
      var p = picks[+b.getAttribute('data-i')];
      if (!p) return;
      unlockAudio();
      // Quick pick sticks a named chord with empty frets (no grip) — still useful
      if (typeof window.stickVoicedChord === 'function') {
        window.stickVoicedChord({
          by: 'fretboard-pick',
          root: p.root,
          typeIdx: p.typeIdx,
          frets: null,
          label: p.short,
          addNew: true
        });
      } else if (typeof window.addNamedChord === 'function') {
        window.addNamedChord(p.root, p.typeIdx, 'fretboard-pick');
      }
      toast('Added ' + p.short);
      editingIdx = null;
      clearNeck();
      simplifySlotCards();
    });

    var scrub = $('#fb-neck-pos');
    var lab = $('#fb-neck-lab');
    if (scrub) {
      scrub.addEventListener('input', function () {
        var start = +scrub.value || 0;
        var nFrets = 5;
        try {
          if (window.matchMedia('(orientation: landscape)').matches) nFrets = 8;
        } catch (_) {}
        var end = start === 0 ? nFrets : Math.min(24, start + nFrets - 1);
        if (start > 0 && end - start + 1 < nFrets) start = Math.max(0, end - nFrets + 1);
        if (typeof setFretRange === 'function') setFretRange(start, end);
        if (lab) lab.textContent = 'Frets ' + start + '–' + end;
        if (typeof resizeCanvas === 'function') resizeCanvas();
      });
    }

    window.addEventListener('orientationchange', function () {
      setTimeout(function () { neckWindowForOrientation(); ensurePhonePinMode(); }, 200);
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
      if (typeof exportInstanceFile === 'function') exportInstanceFile();
    });
    $('#fb-m-share') && $('#fb-m-share').addEventListener('click', function () {
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

    var slots = document.getElementById('progression-slots');
    if (slots && window.MutationObserver) {
      var mo = new MutationObserver(function () { simplifySlotCards(); });
      mo.observe(slots, { childList: true, subtree: true });
    }

    // Show cancel when editing
    setInterval(function () {
      if (!isMobile()) return;
      syncPlay();
      var ce = $('#fb-cancel-edit');
      if (ce) ce.hidden = editingIdx == null;
      // Re-enable only if something turned find mode off
      try {
        if (!(window.isFindChordMode && window.isFindChordMode())) ensurePhonePinMode();
      } catch (_) {}
    }, 800);

    if (poll) clearInterval(poll);
    poll = setInterval(analyze, 280);
  }

  function boot() {
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
