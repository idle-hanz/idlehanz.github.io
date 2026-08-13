/**
 * hl-context-menu.js — right-click palette on map (path / seat / function node)
 */
(function (global) {
  'use strict';
  var H = global.HLApp;
  if (!H) throw new Error('HLApp missing - load hl-core.js first');

  var menuEl = null;
  var openFor = null;

  function ensureMenu() {
    if (menuEl) return menuEl;
    menuEl = document.createElement('div');
    menuEl.id = 'hl-ctx-menu';
    menuEl.className = 'hl-ctx-menu';
    menuEl.hidden = true;
    menuEl.setAttribute('role', 'menu');
    document.body.appendChild(menuEl);
    document.addEventListener('pointerdown', function (e) {
      if (!menuEl || menuEl.hidden) return;
      if (menuEl.contains(e.target)) return;
      H.closeContextMenu();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') H.closeContextMenu();
    });
    return menuEl;
  }

  function addSection(host, title) {
    const sec = document.createElement('div');
    sec.className = 'hl-ctx-sec';
    const h = document.createElement('div');
    h.className = 'hl-ctx-sec-title';
    h.textContent = title;
    sec.appendChild(h);
    host.appendChild(sec);
    return sec;
  }

  function addItem(sec, label, sub, onClick, opts) {
    opts = opts || {};
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hl-ctx-item' + (opts.primary ? ' primary' : '') + (opts.danger ? ' danger' : '');
    btn.setAttribute('role', 'menuitem');
    btn.innerHTML =
      '<span class="hl-ctx-label">' +
      escapeHtml(label) +
      '</span>' +
      (sub ? '<span class="hl-ctx-sub">' + escapeHtml(sub) + '</span>' : '');
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      H.closeContextMenu();
      onClick();
    });
    btn.addEventListener('mouseenter', function () {
      if (opts.chord && H.A()) {
        H.A().ensure();
        H.A().playChord({
          chord: opts.chord,
          soft: true,
          duration: 0.4,
          identify: true,
        });
      }
    });
    sec.appendChild(btn);
    return btn;
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  H.closeContextMenu = function () {
    if (menuEl) {
      menuEl.hidden = true;
      menuEl.innerHTML = '';
    }
    openFor = null;
  };

  /**
   * @param {object} payload
   *  - kind: 'path' | 'seat' | 'function' | 'empty'
   *  - chord, pathIndex, root, seatInfo, functionItem
   *  - clientX, clientY
   */
  H.openContextMenu = function (payload) {
    payload = payload || {};
    const el = ensureMenu();
    el.innerHTML = '';
    openFor = payload;

    const style = H.getStyle ? H.getStyle() : { label: 'Neutral' };
    const head = document.createElement('div');
    head.className = 'hl-ctx-head';
    const title =
      payload.kind === 'path'
        ? 'Path · ' + ((payload.chord && payload.chord.name) || '?')
        : payload.kind === 'seat'
          ? 'Seat · ' + (payload.roman || '') + ' ' + ((payload.chord && payload.chord.name) || '')
          : payload.kind === 'function'
            ? 'Chart · ' + ((payload.chord && payload.chord.name) || payload.label || '')
            : 'Map';
    head.innerHTML =
      '<div class="hl-ctx-title">' +
      escapeHtml(title.trim()) +
      '</div><div class="hl-ctx-style">' +
      escapeHtml(style.label || '') +
      ' style</div>';
    el.appendChild(head);

    const key = H.writeKey ? H.writeKey() : { tonic: H.state.tonic, mode: H.state.mode };
    const chord = payload.chord;
    const root =
      payload.root != null
        ? payload.root
        : chord
          ? chord.root
          : null;

    const pathIdx =
      payload.kind === 'path' && payload.pathIndex != null
        ? payload.pathIndex
        : null;
    const editingPath = pathIdx != null && H.state.chords[pathIdx];

    // --- Path step ---
    if (editingPath && chord) {
      const secAct = addSection(el, 'Path step ' + (pathIdx + 1));
      addItem(
        secAct,
        'Add again',
        'append a copy at end',
        function () {
          if (H.writeChordToPath) {
            H.writeChordToPath(chord, {
              intent: 'append',
              job: 'duplicate',
              label: chord.name,
            });
          } else {
            H.pushUndo && H.pushUndo();
            const copy = H.M().cloneChord(chord);
            copy.duration = chord.duration || H.stepDuration();
            H.state.chords.push(
              H.stampKey ? H.stampKey(copy, H.keyOf(chord) || key) : copy
            );
            H.state.selected = H.state.chords.length - 1;
            H.afterEdit && H.afterEdit();
          }
        },
        { chord: chord }
      );
      addItem(
        secAct,
        'Duplicate after',
        'insert next to this step',
        function () {
          H.state.selected = pathIdx;
          if (H.duplicateSelected) H.duplicateSelected();
        },
        { chord: chord }
      );
      addItem(secAct, 'Select only', '', function () {
        if (H.selectStep) H.selectStep(pathIdx, { play: true });
        else H.state.selected = pathIdx;
      });
      addItem(
        secAct,
        'Delete step',
        'Backspace / Delete',
        function () {
          if (H.removeChordAt) H.removeChordAt(pathIdx);
          else if (H.removeSelected) {
            H.state.selected = pathIdx;
            H.removeSelected();
          }
        },
        { danger: true }
      );
    }

    // --- Colours for this root ---
    // On a path step → REPLACE that step (edit). On seat/chart → writeChord auto.
    if (root != null && H.coloursForRoot) {
      const colours = H.coloursForRoot(root, { key: key, limit: 8 });
      const secC = addSection(
        el,
        editingPath ? 'Change this step · colour' : 'Colours · this degree'
      );
      if (!colours.length) {
        const p = document.createElement('p');
        p.className = 'hl-ctx-empty';
        p.textContent = 'No colours';
        secC.appendChild(p);
      }
      colours.forEach(function (item) {
        addItem(
          secC,
          item.label,
          editingPath
            ? 'replace step ' + (pathIdx + 1)
            : (item.roman ? item.roman + ' · ' : '') + (item.tag || 'colour'),
          function () {
            if (editingPath && H.writeChordToPath) {
              H.writeChordToPath(item.chord, {
                intent: 'edit',
                pathIndex: pathIdx,
                kind: 'flavour',
                job: item.tag || 'colour',
                label: item.label,
              });
            } else if (H.writeChordToPath) {
              H.writeChordToPath(item.chord, {
                intent: 'auto',
                kind: 'flavour',
                job: item.tag || 'colour',
                label: item.label,
              });
            } else {
              H.commitHorizon(
                {
                  chord: item.chord,
                  kind: 'flavour',
                  label: item.label,
                  job: item.tag || 'colour',
                },
                { mode: 'append' }
              );
            }
          },
          { chord: item.chord, primary: editingPath }
        );
      });
    }

    // --- Strong next (always AFTER this chord — never overwrites) ---
    if (chord && H.styleNextMoves) {
      const nexts = H.styleNextMoves(chord, { key: key, limit: 6 });
      const secN = addSection(el, 'Strong next · after this');
      nexts.forEach(function (m) {
        addItem(
          secN,
          m.label,
          m.kind === 'colour' ? 'colour · insert after' : 'in key · insert after',
          function () {
            if (editingPath) H.state.selected = pathIdx;
            if (H.writeChordToPath) {
              H.writeChordToPath(m.chord, {
                intent: editingPath ? 'insert' : 'append',
                pathIndex: editingPath ? pathIdx : undefined,
                kind: m.kind === 'colour' ? 'flavour' : 'direction',
                job: m.roman || m.kind,
                label: m.label,
              });
            } else {
              H.commitHorizon(
                {
                  chord: m.chord,
                  kind: m.kind === 'colour' ? 'flavour' : 'direction',
                  label: m.label,
                  job: m.roman || m.kind,
                },
                { mode: 'append' }
              );
            }
          },
          { chord: m.chord }
        );
      });
    }

    // --- Style packs (insert package after this step) ---
    if (chord && H.stylePacksForChord) {
      const packs = H.stylePacksForChord(chord);
      if (packs.length) {
        const secP = addSection(el, 'Packs · after this');
        packs.forEach(function (pk) {
          addItem(
            secP,
            pk.label,
            pk.job || 'pack',
            function () {
              if (editingPath) H.state.selected = pathIdx;
              H.commitHorizon(
                {
                  chord: pk.route[0],
                  route: pk.route,
                  kind: 'direction',
                  label: pk.label,
                  job: pk.job,
                },
                {
                  mode:
                    editingPath && pathIdx < H.state.chords.length - 1
                      ? 'insert'
                      : 'append',
                }
              );
            },
            { chord: pk.route[0] }
          );
        });
      }
    }

    // --- Pivot · leave home as this chord (Journey path / current step) ---
    if (chord && (editingPath || payload.kind === 'path' || payload.kind === 'seat')) {
      const C = H.C && H.C();
      const pivotAt =
        pathIdx != null
          ? pathIdx
          : H.state.selected >= 0
            ? H.state.selected
            : H.state.chords.length
              ? H.state.chords.length - 1
              : -1;

      // Parallel minor family on this chord's root (Aeolian / Dorian / Phrygian)
      if (C && C.parallelMinorFamily) {
        const fam = C.parallelMinorFamily(chord.root);
        const secFam = addSection(
          el,
          'Parallel minor · ' + (H.M().noteName(chord.root) || '') + ' (new home only)'
        );
        fam.forEach(function (dest) {
          if (
            dest.tonic === key.tonic &&
            dest.mode === (key.mode || H.state.mode)
          ) {
            return;
          }
          addItem(
            secFam,
            dest.modeLabel || dest.shortName || dest.name,
            'switch write home · no new chords',
            function () {
              if (pivotAt >= 0) H.state.selected = pivotAt;
              if (H.pivotLeaveHome) H.pivotLeaveHome(dest, pivotAt, 'none');
            },
            { chord: chord, primary: dest.mode === 'minor' }
          );
          addItem(
            secFam,
            (dest.modeLabel || dest.shortName) + ' + V7→i',
            'also plant cadence after this step',
            function () {
              if (pivotAt >= 0) H.state.selected = pivotAt;
              if (H.pivotLeaveHome) H.pivotLeaveHome(dest, pivotAt, 'cadence');
            },
            { chord: chord }
          );
        });
      }

      // Keys that treat this chord as a diatonic pivot
      if (C && C.keysForPivotChord) {
        const pivots = C.keysForPivotChord(chord, key.tonic, key.mode || H.state.mode, {
          limit: 8,
        });
        if (pivots.length) {
          const secPv = addSection(
            el,
            'Pivot · keys for ' + (chord.name || 'chord') + ' (home only)'
          );
          pivots.forEach(function (dest) {
            if (
              dest.family === 'parallel-minor' &&
              dest.tonic === chord.root &&
              (dest.mode === 'minor' ||
                dest.mode === 'dorian' ||
                dest.mode === 'phrygian')
            ) {
              return;
            }
            const destObj = {
              tonic: dest.tonic,
              mode: dest.mode,
              name: dest.name,
              romanInKey: dest.romanInKey,
            };
            addItem(
              secPv,
              dest.shortName || dest.name,
              (dest.romanInKey ? dest.romanInKey + ' · ' : '') +
                (dest.relation || '') +
                ' · home only',
              function () {
                if (pivotAt >= 0) H.state.selected = pivotAt;
                if (H.pivotLeaveHome) H.pivotLeaveHome(destObj, pivotAt, 'none');
              },
              { chord: chord, primary: dest.romanInKey === 'i' || dest.romanInKey === 'I' }
            );
            addItem(
              secPv,
              (dest.shortName || dest.name) + ' + V7→I',
              'plant establish after step',
              function () {
                if (pivotAt >= 0) H.state.selected = pivotAt;
                if (H.pivotLeaveHome) H.pivotLeaveHome(destObj, pivotAt, 'cadence');
              },
              { chord: chord }
            );
          });
        } else {
          const secPv = addSection(el, 'Pivot · keys');
          const p = document.createElement('p');
          p.className = 'hl-ctx-empty';
          p.textContent = 'No diatonic pivot keys found for this colour';
          secPv.appendChild(p);
        }
      }
    }

    // --- Seat / function: apply to selection or append ---
    if ((payload.kind === 'seat' || payload.kind === 'function') && chord) {
      const secA = addSection(el, 'Write');
      const hasSel =
        H.state.selected >= 0 && H.state.selected < H.state.chords.length;
      addItem(
        secA,
        hasSel && H.state.selected < H.state.chords.length - 1
          ? 'Replace selected · ' + (chord.name || '')
          : 'Add · ' + (chord.name || ''),
        hasSel && H.state.selected < H.state.chords.length - 1
          ? 'edit step ' + (H.state.selected + 1)
          : 'append / build',
        function () {
          if (payload.kind === 'seat' && payload.seatInfo && H.selectChaseSeat) {
            H.selectChaseSeat(payload.seatInfo, { forceWrite: true });
          } else if (H.writeChordToPath) {
            H.writeChordToPath(chord, {
              intent: 'auto',
              kind: payload.horizonKind || 'direction',
              label: chord.name,
              job: payload.job || '',
              route: payload.route,
            });
          } else {
            H.commitHorizon(
              {
                chord: chord,
                kind: payload.horizonKind || 'direction',
                label: chord.name,
                job: payload.job || '',
                route: payload.route,
              },
              { mode: 'append' }
            );
          }
        },
        { primary: true, chord: chord }
      );
    }

    if (payload.kind === 'empty' || payload.job === 'background') {
      const secE = addSection(el, 'Start');
      addItem(
        secE,
        'Add home (I / i)',
        'tonic of write home',
        function () {
          if (H.startAtHome) H.startAtHome();
        },
        { primary: true }
      );
      if (H.loadStyleDemo) {
        addItem(secE, 'Demo: Speed of Pain', 'Em · goth colours', function () {
          H.loadStyleDemo('speed-of-pain');
        });
      }
    }

    // Footer tip
    const foot = document.createElement('div');
    foot.className = 'hl-ctx-foot';
    foot.textContent = editingPath
      ? 'Colours edit · Strong next inserts · Pivot lands new key after this · Esc'
      : 'Pivot / packs after chord · mid-path click edits · Esc closes';
    el.appendChild(foot);

    // Position
    el.hidden = false;
    const x = payload.clientX || 0;
    const y = payload.clientY || 0;
    el.style.left = '0px';
    el.style.top = '0px';
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let left = x + 4;
    let top = y + 4;
    if (left + rect.width > window.innerWidth - pad) left = window.innerWidth - rect.width - pad;
    if (top + rect.height > window.innerHeight - pad) top = window.innerHeight - rect.height - pad;
    if (left < pad) left = pad;
    if (top < pad) top = pad;
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  };

  // ---
})(typeof window !== 'undefined' ? window : globalThis);
