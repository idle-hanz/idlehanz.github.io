/**
 * Harmonic Landscape — shared app namespace (HLApp)
 */
(function (global) {
  "use strict";
  var H = {
    M: function () { return global.HLMusic; },
    A: function () { return global.HLAudio; },
    C: function () { return global.HLCompose || global.HLMusic; },
    P: function () { return global.HLPacks; },
    S: function () { return global.IHSession; },
    $: function (s) { return document.querySelector(s); },
    MAX_UNDO: 40,
    map: null,
    dragSlotIndex: null,
    playheadRaf: 0,
    state: {
      tonic: 11, mode: "minor", bpm: 96, loop: true, pulse: false,
      chords: [], selected: 0,
      /** Multi-select on timeline (indices). Primary selection remains `selected`. */
      selectedIndices: [],
      title: "Untitled sequence", recognition: null,
      fromPackId: null, cellId: null, nameLocked: false, addRoot: 11, addQuality: "min",
      syncMsg: "", undoStack: [], redoStack: [], compareCellId: null, lastCompareCellId: null, defaultDuration: 4,
      pendingTonic: null, pendingMode: null,
      /**
       * When true, playhead advances H.state.selected each step (inspector follows).
       * Default false so you can edit a step while the loop runs.
       */
      followPlayhead: false,
      /** First-run coach dismissed (also mirrored to localStorage) */
      coachDismissed: false,
      /**
       * Function-view layers (home ring always on).
       * dominants = V7→I + secondaries + secondary ii–Vs
       * borrow = interchange orbit + gates
       * tritone / dim / valts = Keithson strands
       * colours = sus / II / 7ths beside degrees (in-key paint)
       */
      functionOpts: {
        dominants: true,
        borrow: true,
        tritone: false,
        dim: false,
        valts: false,
        // Colours live mainly in right-click; map accents optional
        colours: false,
      },
      /** In this key density: core | jazz | full */
      functionPreset: 'core',
      gestureLegendDismissed: false,
      /**
       * Map gesture mode:
       * select — browse only: click never writes; drag reorders; Shift+drag aims
       * write  — single-click seats / next-arrows / function nodes write
       * aim    — drag path steps onto seats to reassign
       * reorder — drag only reorders path
       */
      mapGestureMode: 'select',
      /** Style lens: neutral | classical | jazz | blues | rock | goth | metal | shoegaze */
      style: 'neutral',
      /** Override compose goal; null = derive from style */
      goalId: null,
    }
  };
  global.HLApp = H;
})(typeof window !== "undefined" ? window : globalThis);