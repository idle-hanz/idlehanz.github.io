# Harmonic Landscape — app modules

The editor used to be one ~4k-line `app.js`. It is split across a shared namespace
**`window.HLApp`** (`H` in each file).

## Load order

1. Engine libs: `ih-session`, `music`, `compose`, `audio`, `packs`, `spatial`
2. `hl-core.js` — creates `HLApp` + `state`
3. Feature modules (any order among themselves is OK if all load before boot):
   - `hl-undo.js` — snapshot, undo/redo, ownership keys, session chord convert
   - `hl-session.js` — IHSession handoff, packs, write-home / Land here
   - `hl-map-bridge.js` — Chase seats, aim drag, edge insert, path edits, `afterEdit`
   - `hl-versions.js` — version chips, blue compare, fork variations
   - `hl-edit.js` — smooth, rename, durations, bass, strip resize math
   - `hl-horizon.js` — From here packages + fit timing
   - `hl-playback.js` — play / playhead / export
   - `hl-ui.js` — render strip, slots, inspector, packs, horizon lists, **`refreshMap`**
4. `app.js` — **boot only**: `init`, `wire`, `DOMContentLoaded`

## Conventions

- Shared state: `H.state` (chords, tonic, cellId, compareCellId, …)
- Map instance: `H.map` (`SpatialMap` from `spatial.js`)
- DOM: `H.$('#id')`
- Engines: `H.M()` `H.A()` `H.C()` `H.P()` `H.S()`
- Methods: `H.playSeq()`, `H.afterEdit()`, …

## Lifecycle (keep thin)

**Sequence edit** → `H.afterEdit()`:

1. `map.clearInteraction()` — end aim/pan, flush deferred horizon  
2. `recognize` + `refreshAll()`  
3. `refreshAll` → `refreshMap()` once (origin, path, horizon/function chart, time strip)  
4. optional session push + alt path  

**Do not** call `setPath` / `renderTimeStrip` again after `afterEdit` unless you have a special case.

**View switch** → `H.setMapView(view)` → `refreshMap({ keepCamera: true })`.

**Map interaction modes** (`spatial.js`):

| Mode | Meaning |
|------|---------|
| `null` | Idle / hover |
| `pan` | Dragging empty canvas |
| `node` | Aiming a path chord (or post edge-insert aim) |

`clearInteraction()` is the single exit from `pan`/`node`.

## Product split (Chase vs Function)

| | **Chase** | **Function** |
|--|-----------|--------------|
| Job | Journey / multi-key | Same-key atlas |
| Path seats | Write-home scale seats (ownership wins) | Function chart seats (aligned radii) |
| Suggestions | Next-move: direction / cadence / mod | Dominants + Borrow toggles |
| Key change | Ghost adjacent wheels + establish I / V7→I | Auto → Chase on committed key change |

## Where the weight is

| File | Role | Notes |
|------|------|--------|
| `spatial.js` (~3k lines) | All map layout + hit + draw | Largest; further splits could be layout / hit / draw later |
| `compose.js` | Suggest, VL, modulate helpers | Adjacent keys + establish options for ghosts |
| `hl-horizon.js` | From here + map horizon | `forMap` filters lean Chase dots |
| `hl-map-bridge.js` | Path edits, aim targets, afterEdit | Prefer this for map↔state glue |
| `hl-ui.js` | DOM render + `refreshMap` | Single map refresh entry |

## Debt / next cleanups (not blocking)

- Split `spatial.js` draw vs layout vs input if it grows further  
- `setWritingHome` still does its own `setOrigin`/`setPath` when `skipEdit` (could call `refreshMap`)  
- `workbench.js` is a separate tool surface; keep out of HLApp path  
- Engine libs (`music`/`compose`) could share a single `seatRadius(disk, role)` with map `SEAT` constants  

## Pre-split backup

`backups/js-20260802-170014/app.js` — monolith before this split.
