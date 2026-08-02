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
      chords: [], selected: 0, title: "Untitled sequence", recognition: null,
      fromPackId: null, cellId: null, nameLocked: false, addRoot: 11, addQuality: "min",
      syncMsg: "", undoStack: [], redoStack: [], compareCellId: null, defaultDuration: 4,
      pendingTonic: null, pendingMode: null,
      /**
       * Function-view layers (3 toggles only).
       * home = diatonic ring + skeleton + path highlight
       * dominants = V7→I + secondaries
       * borrow = interchange orbit + gates (sparse paper set)
       */
      functionOpts: {
        home: true,
        dominants: true,
        borrow: true,
      },
    }
  };
  global.HLApp = H;
})(typeof window !== "undefined" ? window : globalThis);