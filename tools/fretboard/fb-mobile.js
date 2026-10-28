/**
 * Phone Fretboard UI — Add chord / Find chord / Quick pick / live sync / embed.
 */
(function () {
  'use strict';

  var PARAMS = new URLSearchParams(location.search || '');
  var EMBED = PARAMS.get('embed') === '1';
  var lastRemoteAt = null;
  var applyingRemote = false;
  var findPoll = null;
  var addSheetOpen = false;
  var savedScaleDisplay = null;
  var STRING_LABELS = ['e', 'B', 'G', 'D', 'A', 'E']; // high → low (board top → bottom)

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
    el._t = setTimeout(function () { el.classList.remove('show'); }, 1800);
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

  function noteName(pc) {
    try {
      if (typeof getNoteName === 'function') return getNoteName(pc);
    } catch (_) {}
    return ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][((pc % 12) + 12) % 12];
  }

  function songKeyTonic() {
    try {
      if (!window.IHSession || !IHSession.loadSong) return 0;
      var song = IHSession.loadSong();
      if (song && song.key && song.key.tonic != null) return ((+song.key.tonic) % 12 + 12) % 12;
      if (typeof scaleRoot !== 'undefined') return ((scaleRoot % 12) + 12) % 12;
    } catch (_) {}
    return 0;
  }

  function songKeyMode() {
    try {
      if (!window.IHSession || !IHSession.loadSong) return 'major';
      var song = IHSession.loadSong();
      var m = song && song.key && (song.key.mode || song.key.quality || '');
      if (/min/i.test(String(m))) return 'minor';
    } catch (_) {}
    try {
      if (typeof scaleType === 'string' && /min|aeolian|dorian/i.test(scaleType)) return 'minor';
    } catch (_) {}
    return 'major';
  }

  /** Diatonic quick-pick: [{label, root, typeIdx}] typeIdx 0=Maj 1=Min 6=Dim */
  function diatonicPicks() {
    var t = songKeyTonic();
    var minor = songKeyMode() === 'minor';
    var steps, quals, romans;
    if (minor) {
      steps = [0, 2, 3, 5, 7, 8, 10];
      quals = [1, 6, 0, 1, 1, 0, 0]; // i ii° III iv v VI VII
      romans = ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'];
    } else {
      steps = [0, 2, 4, 5, 7, 9, 11];
      quals = [0, 1, 1, 0, 0, 1, 6]; // I ii iii IV V vi vii°
      romans = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
    }
    return steps.map(function (st, i) {
      var root = (t + st) % 12;
      var ti = quals[i];
      var short = noteName(root) + (ti === 1 ? 'm' : ti === 6 ? 'dim' : '');
      return { label: romans[i] + ' · ' + short, root: root, typeIdx: ti, short: short };
    });
  }

  function getPinMap() {
    if (typeof window.getShapePinFrets === 'function') return window.getShapePinFrets() || {};
    return {};
  }

  function renderStringRow() {
    var row = $('#fb-string-row');
    if (!row) return;
    var pins = getPinMap();
    var n = 6;
    try {
      if (typeof numStrings === 'function') n = numStrings();
    } catch (_) {}
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

  function analyzeGuess() {
    var el = $('#fb-find-guess');
    var alts = $('#fb-find-alts');
    var addBtn = $('#fb-find-add');
    if (!el) return;
    try {
      if (typeof getChordDetectPcs !== 'function' || typeof analyzePitchSet !== 'function') {
        el.textContent = 'Tap frets…';
        if (addBtn) addBtn.disabled = true;
        return;
      }
      var pcs = getChordDetectPcs();
      // Ignore leftover detectNotes when no pins — require real shape pins
      var pins = getPinMap();
      var pinCount = Object.keys(pins).length;
      if (pinCount < 2) {
        el.textContent = pinCount === 1 ? 'Need one more string…' : 'Tap frets on the neck';
        if (alts) alts.textContent = 'Nut = open · × = mute · one fret per string';
        if (addBtn) addBtn.disabled = true;
        renderStringRow();
        return;
      }
      if (!pcs || pcs.size < 2) {
        el.textContent = 'Need more notes…';
        if (alts) alts.textContent = '';
        if (addBtn) addBtn.disabled = true;
        renderStringRow();
        return;
      }
      var hits = analyzePitchSet(pcs) || [];
      if (!hits.length) {
        el.textContent = 'No exact match';
        if (alts) alts.textContent = 'Try open strings or clear a pin';
        if (addBtn) addBtn.disabled = false; // still allow custom add
        renderStringRow();
        return;
      }
      var top = hits[0];
      var name = noteName(top.root) + ' ' + top.name;
      el.textContent = name;
      if (alts) {
        alts.textContent = hits.slice(1, 4).map(function (h) {
          return noteName(h.root) + ' ' + h.name;
        }).join(' · ');
      }
      if (addBtn) {
        addBtn.disabled = false;
        addBtn.textContent = 'Add ' + name;
      }
      renderStringRow();
    } catch (e) {
      el.textContent = 'Detect…';
    }
  }

  function setFind(on) {
    unlockAudio();
    on = !!on;
    if (typeof window.setFindChordMode === 'function') {
      window.setFindChordMode(on);
    }
    var btn = $('#fb-m-find');
    if (btn) btn.classList.toggle('active', on);
    document.body.classList.toggle('fb-find-chord', on);
    // Do NOT clear fb-add-open here — openAddSheet(true) calls setFind(false)

    // Sync app chrome
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ source: 'song-builder-fb', type: 'ih-find-state', on: on }, location.origin);
      }
    } catch (_) {}

    if (on) {
      addSheetOpen = false;
      document.body.classList.remove('fb-add-open');
      // Clean neck for tapping
      try {
        if (savedScaleDisplay == null && typeof scaleDisplay !== 'undefined') savedScaleDisplay = scaleDisplay;
        if (typeof setScaleDisplay === 'function') setScaleDisplay('off');
      } catch (_) {}
      try {
        if (typeof clearShapePins === 'function') clearShapePins();
        if (typeof clearDetectNotes === 'function') clearDetectNotes();
        if (typeof clearExtraPins === 'function') clearExtraPins();
      } catch (_) {}
      if (findPoll) clearInterval(findPoll);
      findPoll = setInterval(analyzeGuess, 220);
      analyzeGuess();
      renderStringRow();
      var addBtn = $('#fb-find-add');
      if (addBtn) addBtn.textContent = 'Add to song';
    } else {
      if (findPoll) { clearInterval(findPoll); findPoll = null; }
      try {
        if (savedScaleDisplay != null && typeof setScaleDisplay === 'function') {
          setScaleDisplay(savedScaleDisplay === 'off' ? 'chords' : savedScaleDisplay);
        } else if (typeof setScaleDisplay === 'function') {
          setScaleDisplay('chords');
        }
        savedScaleDisplay = null;
      } catch (_) {}
    }
  }

  function openAddSheet(open) {
    addSheetOpen = !!open;
    document.body.classList.toggle('fb-add-open', addSheetOpen);
    if (addSheetOpen) {
      setFind(false);
      renderQuickPicks();
    }
  }

  function renderQuickPicks() {
    var host = $('#fb-quick-picks');
    if (!host) return;
    var picks = diatonicPicks();
    var tonic = noteName(songKeyTonic());
    var mode = songKeyMode();
    var head = $('#fb-quick-key');
    if (head) head.textContent = 'In ' + tonic + ' ' + mode;
    host.innerHTML = picks.map(function (p, i) {
      return '<button type="button" class="fb-qp" data-i="' + i + '">' +
        '<span class="rn">' + p.label.split(' · ')[0] + '</span>' +
        '<span class="nm">' + p.short + '</span></button>';
    }).join('');
  }

  function addDetectedToSong() {
    unlockAudio();
    var pins = getPinMap();
    if (Object.keys(pins).length < 2) {
      toast('Tap at least two strings first');
      return;
    }
    if (typeof window.useDetectedChord === 'function') {
      window.useDetectedChord({ by: 'fretboard-detect', addNew: true });
    } else if (typeof applyBestChordDetect === 'function') {
      if (typeof addSlot === 'function') addSlot();
      applyBestChordDetect();
    }
    var name = ($('#fb-find-guess') && $('#fb-find-guess').textContent) || 'Chord';
    if (/tap|need|detect|match/i.test(name)) name = 'Chord';
    toast('Added ' + name);
    setFind(false);
  }

  function addNamedPick(pick) {
    unlockAudio();
    if (typeof window.addNamedChord === 'function') {
      window.addNamedChord(pick.root, pick.typeIdx, 'fretboard-pick');
    } else if (typeof window.addSlot === 'function' && typeof window.FbTour !== 'undefined' && FbTour.setNamed) {
      addSlot();
      // fallback: set last via tour helper if focus moved — may not
    }
    toast('Added ' + pick.short);
    openAddSheet(false);
  }

  function onStringRowClick(e) {
    var btn = e.target.closest('button[data-act]');
    if (!btn) return;
    var s = +btn.getAttribute('data-s');
    var act = btn.getAttribute('data-act');
    unlockAudio();
    if (act === 'mute') {
      if (typeof window.muteShapeString === 'function') window.muteShapeString(s);
      else if (typeof toggleShapePin === 'function') {
        var pins = getPinMap();
        if (pins[s] != null) toggleShapePin(s, pins[s]);
      }
    } else if (act === 'state') {
      // Cycle: muted → open → (keep fretted if set) → muted
      var pins2 = getPinMap();
      if (pins2[s] == null) {
        // muted → open
        if (typeof toggleShapePin === 'function') toggleShapePin(s, 0);
      } else if (pins2[s] === 0) {
        // open → mute
        if (typeof window.muteShapeString === 'function') window.muteShapeString(s);
        else if (typeof toggleShapePin === 'function') toggleShapePin(s, 0);
      } else {
        // fretted → mute
        if (typeof window.muteShapeString === 'function') window.muteShapeString(s);
        else if (typeof toggleShapePin === 'function') toggleShapePin(s, pins2[s]);
      }
    }
    analyzeGuess();
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
        applyRemoteSong({ type: 'song-updated', by: 'landscape', updatedAt: 'show-' + Date.now() });
        setTimeout(function () {
          if (typeof resizeCanvas === 'function') resizeCanvas();
          neckWindowForOrientation();
        }, 80);
      }
      if (data.type === 'ih-find-chord') {
        var on = data.on != null ? !!data.on : !(window.isFindChordMode && window.isFindChordMode());
        if (on) {
          // Prefer the add sheet so user can pick Find or Quick
          openAddSheet(true);
        } else {
          setFind(false);
          openAddSheet(false);
        }
      }
      if (data.type === 'ih-add-chord') openAddSheet(true);
      if (data.type === 'ih-more') openMore(true);
      if (data.type === 'ih-more-close') openMore(false);
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
      '<button type="button" id="fb-m-add" class="add-main">+ Chord</button>' +
      '<button type="button" class="grow" id="fb-m-more">More</button>';

    var shell = $('.app-shell');
    if (shell) shell.insertBefore(mbar, shell.firstChild);
    else document.body.insertBefore(mbar, document.body.firstChild);

    var boardCard = document.querySelector('.fretboard-container');

    // Find HUD — sits at TOP when finding (not under Play)
    var findBar = document.createElement('div');
    findBar.className = 'fb-find-bar';
    findBar.innerHTML =
      '<div class="fb-find-head">' +
      '<div class="guess" id="fb-find-guess">Tap frets on the neck</div>' +
      '<div class="alts" id="fb-find-alts">Nut = open · × = mute · one fret per string</div>' +
      '</div>' +
      '<div class="fb-string-row" id="fb-string-row"></div>' +
      '<div class="row">' +
      '<button type="button" class="primary" id="fb-find-add" disabled>Add to song</button>' +
      '<button type="button" id="fb-find-clear">Clear</button>' +
      '<button type="button" id="fb-find-done">Cancel</button>' +
      '</div>';
    if (boardCard && boardCard.parentElement) {
      boardCard.parentElement.insertBefore(findBar, boardCard);
    }

    var scrub = document.createElement('div');
    scrub.className = 'fb-neck-scrub';
    scrub.innerHTML =
      '<label id="fb-neck-lab">Frets 0–5</label>' +
      '<input type="range" id="fb-neck-pos" min="0" max="18" value="0" step="1" aria-label="Neck position">';
    if (boardCard && boardCard.parentElement) {
      boardCard.parentElement.insertBefore(scrub, boardCard.nextSibling);
    }

    // Add-chord sheet (Find vs Quick pick)
    var addBack = document.createElement('div');
    addBack.className = 'fb-add-backdrop';
    addBack.id = 'fb-add-backdrop';
    document.body.appendChild(addBack);

    var addSheet = document.createElement('div');
    addSheet.className = 'fb-add-sheet';
    addSheet.id = 'fb-add-sheet';
    addSheet.innerHTML =
      '<h3>Add a chord</h3>' +
      '<p class="hint">Name what you\'re fretting, or tap a chord in the key.</p>' +
      '<button type="button" class="big-find" id="fb-go-find">Find on the neck</button>' +
      '<div class="fb-quick-key" id="fb-quick-key">In C major</div>' +
      '<div class="fb-quick-picks" id="fb-quick-picks"></div>' +
      '<button type="button" class="fb-add-close" id="fb-add-close">Cancel</button>';
    document.body.appendChild(addSheet);

    var dock = document.createElement('div');
    dock.className = 'fb-mdock';
    dock.innerHTML =
      '<button type="button" class="step-btn" id="fb-m-prev" aria-label="Previous">◀</button>' +
      '<button type="button" class="add-dock" id="fb-m-add2">+ Chord</button>' +
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
    try {
      if (typeof setScaleDisplay === 'function') setScaleDisplay('chords');
      var cos = document.getElementById('colour-open-strings');
      if (cos) { cos.checked = false; cos.dispatchEvent(new Event('change', { bubbles: true })); }
      var sn = document.getElementById('show-notes');
      if (sn) { sn.checked = false; sn.dispatchEvent(new Event('change', { bubbles: true })); }
    } catch (_) {}
    setTimeout(function () {
      if (typeof resizeCanvas === 'function') resizeCanvas();
      syncScrubLabel();
      if (typeof updateFretboard === 'function') updateFretboard();
      simplifySlotCards();
    }, 100);
    setTimeout(function () {
      if (typeof resizeCanvas === 'function') resizeCanvas();
      simplifySlotCards();
    }, 400);
  }

  function simplifySlotCards() {
    // Strip desktop editing chrome that leaks into phone cards
    $all('#progression-slots > *').forEach(function (card) {
      card.querySelectorAll('select, input, label, .fa-eye, [onclick*="cycleSlotEye"]').forEach(function (el) {
        el.style.display = 'none';
      });
      // Keep a single visible remove if present — style as ×
      card.querySelectorAll('[onclick*="removeSlot"]').forEach(function (el) {
        el.style.display = '';
        el.textContent = '×';
        el.classList.add('fb-slot-x');
      });
    });
  }

  function wire() {
    inject();
    wireSync();

    document.addEventListener('pointerup', unlockAudio, { passive: true, capture: true });
    document.addEventListener('touchend', unlockAudio, { passive: true, capture: true });

    function openAdd() { unlockAudio(); openAddSheet(true); }

    $('#fb-m-add') && $('#fb-m-add').addEventListener('click', openAdd);
    $('#fb-m-add2') && $('#fb-m-add2').addEventListener('click', openAdd);
    $('#fb-add-close') && $('#fb-add-close').addEventListener('click', function () { openAddSheet(false); });
    $('#fb-add-backdrop') && $('#fb-add-backdrop').addEventListener('click', function () { openAddSheet(false); });
    $('#fb-go-find') && $('#fb-go-find').addEventListener('click', function () {
      openAddSheet(false);
      setFind(true);
    });
    $('#fb-quick-picks') && $('#fb-quick-picks').addEventListener('click', function (e) {
      var b = e.target.closest('.fb-qp');
      if (!b) return;
      var picks = diatonicPicks();
      var p = picks[+b.getAttribute('data-i')];
      if (p) addNamedPick(p);
    });

    $('#fb-m-more') && $('#fb-m-more').addEventListener('click', function () { openMore(true); });
    $('#fb-m-close') && $('#fb-m-close').addEventListener('click', function () { openMore(false); });
    $('#fb-msheet-backdrop') && $('#fb-msheet-backdrop').addEventListener('click', function () { openMore(false); });

    // Legacy desktop find button (hidden on phone) still wires
    var deskFind = $('#btn-find-chord');
    if (deskFind) {
      deskFind.addEventListener('click', function () {
        var on = !(window.isFindChordMode && window.isFindChordMode());
        setFind(on);
        deskFind.textContent = on ? 'Finding… (tap frets)' : 'Find chord';
      });
    }

    $('#fb-find-add') && $('#fb-find-add').addEventListener('click', addDetectedToSong);
    $('#fb-find-clear') && $('#fb-find-clear').addEventListener('click', function () {
      if (typeof clearShapePins === 'function') clearShapePins();
      if (typeof clearDetectNotes === 'function') clearDetectNotes();
      analyzeGuess();
    });
    $('#fb-find-done') && $('#fb-find-done').addEventListener('click', function () { setFind(false); });
    $('#fb-string-row') && $('#fb-string-row').addEventListener('click', onStringRowClick);

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

    // Observe progression re-renders to keep cards clean
    var slots = document.getElementById('progression-slots');
    if (slots && window.MutationObserver) {
      var mo = new MutationObserver(function () { simplifySlotCards(); });
      mo.observe(slots, { childList: true, subtree: true });
    }

    setInterval(function () { if (isMobile()) syncPlay(); }, 500);
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
