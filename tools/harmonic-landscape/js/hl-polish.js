/**
 * hl-polish.js — UX polish: toast, gesture legend, layer presets, disk legend
 */
(function (global) {
  'use strict';
  var H = global.HLApp;
  if (!H) throw new Error('HLApp missing - load hl-core.js first');

  var toastTimer = 0;

  /** Short non-blocking feedback (undoable actions). */
  H.showToast = function (msg, opts) {
    opts = opts || {};
    var el = H.$('#hl-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'hl-toast';
      el.className = 'hl-toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    var showUndo = opts.undo !== false && H.state.undoStack && H.state.undoStack.length;
    el.innerHTML =
      '<span class="hl-toast-msg"></span>' +
      (showUndo
        ? '<button type="button" class="hl-toast-undo" title="Ctrl+Z">Undo</button>'
        : '');
    el.querySelector('.hl-toast-msg').textContent = msg || '';
    var ub = el.querySelector('.hl-toast-undo');
    if (ub) {
      ub.onclick = function () {
        if (H.undo) H.undo();
        el.classList.remove('on');
      };
    }
    el.classList.add('on');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove('on');
    }, opts.ms || 4200);
  };

  H.FUNCTION_PRESETS = {
    core: {
      label: 'Core',
      title: 'Diatonic + Dom + Borrow',
      dominants: true,
      borrow: true,
      tritone: false,
      dim: false,
      valts: false,
      colours: false,
    },
    jazz: {
      label: 'Jazz',
      title: 'Core + Tritone + Dim + V alts',
      dominants: true,
      borrow: true,
      tritone: true,
      dim: true,
      valts: true,
      colours: false,
    },
    full: {
      label: 'Full',
      title: 'All strand layers + colours',
      dominants: true,
      borrow: true,
      tritone: true,
      dim: true,
      valts: true,
      colours: true,
    },
  };

  H.applyFunctionPreset = function (id, opts) {
    opts = opts || {};
    var p = H.FUNCTION_PRESETS[id] || H.FUNCTION_PRESETS.core;
    if (!H.state.functionOpts) H.state.functionOpts = {};
    H.state.functionOpts.dominants = !!p.dominants;
    H.state.functionOpts.borrow = !!p.borrow;
    H.state.functionOpts.tritone = !!p.tritone;
    H.state.functionOpts.dim = !!p.dim;
    H.state.functionOpts.valts = !!p.valts;
    H.state.functionOpts.colours = !!p.colours;
    H.state.functionPreset = id;
    if (H.syncFunctionOptsUI) H.syncFunctionOptsUI();
    if (H.syncFunctionPresetUI) H.syncFunctionPresetUI();
    if (H.map && H.map.mapView === 'function') {
      if (H.refreshMap) H.refreshMap();
    }
    if (!opts.silent) {
      H.setSyncStatus('In this key · preset ' + p.label + ' — ' + p.title);
    }
  };

  H.syncFunctionPresetUI = function () {
    var id = H.state.functionPreset || 'core';
    // Infer if checkboxes were toggled manually
    var fo = H.state.functionOpts || {};
    if (fo.colours) id = 'full';
    else if (fo.tritone || fo.dim || fo.valts) id = 'jazz';
    else id = 'core';
    H.state.functionPreset = id;
    document.querySelectorAll('[data-fo-preset]').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-fo-preset') === id);
    });
  };

  H.dismissGestureLegend = function () {
    try {
      localStorage.setItem('hl_gesture_legend_v1', '1');
    } catch (e) {}
    var el = H.$('#gesture-legend');
    if (el) el.hidden = true;
    H.state.gestureLegendDismissed = true;
  };

  H.maybeShowGestureLegend = function () {
    var el = H.$('#gesture-legend');
    if (!el) return;
    var dismissed = false;
    try {
      dismissed = localStorage.getItem('hl_gesture_legend_v1') === '1';
    } catch (e) {}
    if (H.state.gestureLegendDismissed || dismissed) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
  };

  /** Multi-disk chips under the map (Journey). */
  H.renderDiskLegend = function () {
    var host = H.$('#disk-legend');
    if (!host) return;
    host.innerHTML = '';
    if (!H.map || H.map.mapView !== 'chase') {
      host.hidden = true;
      return;
    }
    var disks = H.map.disks || [];
    if (disks.length < 2) {
      host.hidden = true;
      return;
    }
    host.hidden = false;
    var home = H.writeKey ? H.writeKey() : { tonic: H.state.tonic, mode: H.state.mode };
    disks.forEach(function (d, i) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        'disk-chip' +
        (d.active ||
        (d.tonic === home.tonic &&
          (d.mode || '') === (home.mode || ''))
          ? ' active'
          : '');
      var name =
        H.M().noteName(d.tonic) +
        ((H.M().MODES[d.mode] || {}).romanBase === 'minor' ||
        String(d.mode || '').indexOf('min') === 0
          ? 'm'
          : '') +
        ' ' +
        ((H.M().MODES[d.mode] || {}).name || d.mode || '');
      btn.textContent = name;
      btn.title = 'Focus camera on this key wheel';
      btn.addEventListener('click', function () {
        if (H.map && H.map.focusDisk) {
          H.map.focusDisk(d);
          if (H.syncCamButtons) H.syncCamButtons();
        } else if (H.setWritingHome) {
          // Soft focus: set write home without transpose
          H.setWritingHome(d.tonic, d.mode || H.state.mode, {
            transpose: false,
            skipEdit: true,
          });
          if (H.refreshMap) H.refreshMap();
        }
        H.setSyncStatus('Focused · ' + name + ' wheel');
        H.renderDiskLegend();
      });
      host.appendChild(btn);
    });
  };

  /** Wrap setFunctionOpt so presets stay in sync */
  var _setFo = H.setFunctionOpt;
  H.setFunctionOpt = function (key, value) {
    if (_setFo) _setFo.call(H, key, value);
    else {
      if (!H.state.functionOpts) H.state.functionOpts = {};
      H.state.functionOpts[key] = !!value;
    }
    if (H.syncFunctionPresetUI) H.syncFunctionPresetUI();
  };

  H.wirePolish = function () {
    H.maybeShowGestureLegend();
    var gd = H.$('#gesture-legend-dismiss');
    if (gd) gd.addEventListener('click', H.dismissGestureLegend);
    document.querySelectorAll('[data-fo-preset]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        H.applyFunctionPreset(btn.getAttribute('data-fo-preset'));
      });
    });
    H.syncFunctionPresetUI();
    document.querySelectorAll('[data-map-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        H.setMapGestureMode(btn.getAttribute('data-map-mode'));
      });
    });
    H.syncMapGestureModeUI();
  };

  H.setMapGestureMode = function (mode) {
    if (mode === 'aim' || mode === 'reorder') mode = 'select';
    var allowed = { select: 1, write: 1 };
    H.state.mapGestureMode = allowed[mode] ? mode : 'select';
    H.syncMapGestureModeUI();
    var labels = {
      select: 'Select · preview · drag reorders · Shift+drag aims · × deletes · double-click adds',
      write: 'Write · click seats / arrows / From here to add',
    };
    H.setSyncStatus(labels[H.state.mapGestureMode] || labels.select);
  };

  H.offerRouteConfirm = function (item, onInsert) {
    var el = H.$('#route-confirm');
    if (!el || !item) {
      if (onInsert) onInsert();
      return;
    }
    var route = item.route || (item.chord ? [item.chord] : []);
    var names = route
      .map(function (c) {
        return (c && c.name) || '?';
      })
      .join(' → ');
    var title = H.$('#rc-title');
    var line = H.$('#rc-route');
    var job = H.$('#rc-job');
    if (title) title.textContent = 'Insert package?';
    if (line) line.textContent = names || '—';
    if (job) job.textContent = item.job || item.label || '';
    el.hidden = false;
    var hear = H.$('#rc-hear');
    var insert = H.$('#rc-insert');
    var cancel = H.$('#rc-cancel');
    var close = function () {
      el.hidden = true;
    };
    if (hear) {
      hear.onclick = function () {
        if (H.A() && route[0]) {
          H.A().ensure();
          H.A().playChord({ chord: route[0], soft: true, duration: 0.45 });
        }
      };
    }
    if (insert) {
      insert.onclick = function () {
        close();
        if (onInsert) onInsert();
      };
    }
    if (cancel) cancel.onclick = close;
  };

  H.syncMapGestureModeUI = function () {
    var mode = H.state.mapGestureMode || 'select';
    document.querySelectorAll('[data-map-mode]').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-map-mode') === mode);
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);
