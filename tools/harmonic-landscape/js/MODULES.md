# Harmonic Landscape — app modules

The editor used to be one ~4k-line `app.js`. It is split across a shared namespace
**`window.HLApp`** (`H` in each file).

## Load order

1. Engine libs: `ih-session`, `music`, `compose`, `audio`, `packs`, `spatial`
2. `hl-core.js` — creates `HLApp` + `state`
3. Feature modules (any order among themselves is OK if all load before boot):
   - `hl-undo.js` — snapshot, undo/redo, ownership keys, session chord convert
   - `hl-session.js` — IHSession handoff, packs, write-home / Land here
   - `hl-map-bridge.js` — Chase seats, aim drag, edge insert, path edits
   - `hl-versions.js` — version chips, blue compare, fork variations
   - `hl-edit.js` — smooth, rename, durations, bass, strip resize math
   - `hl-horizon.js` — From here packages + fit timing
   - `hl-playback.js` — play / playhead / export
   - `hl-ui.js` — render strip, slots, inspector, packs, horizon lists
4. `app.js` — **boot only**: `init`, `wire`, `DOMContentLoaded`

## Conventions

- Shared state: `H.state` (chords, tonic, cellId, compareCellId, …)
- Map instance: `H.map`
- DOM: `H.$('#id')`
- Engines: `H.M()` `H.A()` `H.C()` `H.P()` `H.S()`
- Methods: `H.playSeq()`, `H.afterEdit()`, …

## Pre-split backup

`backups/js-20260802-170014/app.js` — monolith before this split.
