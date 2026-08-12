# Harmonic Landscape — app modules

Editor lives on **`window.HLApp`** (`H` in each file).

## Load order

1. Engine: `ih-session`, `music`, `compose`, `audio`, `packs`, then map:
   - `spatial.js` — ctor, camera, setPath/setOrigin API, `HLSpatial` export
   - `spatial-layout.js` — disks, seats, path/function layout
   - `spatial-input.js` — hit-test, pointer, aim/drag
   - `spatial-draw.js` — canvas paint
   (Pure split of former monolith; load in that order.)
2. `hl-core.js` — `HLApp` + `state`
3. Feature modules (all before boot):
   - `hl-undo.js` — snapshot (incl. write home), undo/redo, ownership keys
   - `hl-session.js` — session, packs, write-home / Land here
   - `hl-map-bridge.js` — seats, aim, leave-home, path edits, `afterEdit`
   - `hl-versions.js` — version chips, blue compare
   - `hl-edit.js` — smooth, rename, durations, bass
   - `hl-horizon.js` — **From here list** + fit timing (`buildHorizon` is list-only)
   - `hl-playback.js` — play / playhead / place-preserving resync
   - `hl-ui.js` — strip, slots, inspector, packs, **`refreshMap`**
4. `app.js` — `init` / `wire` only

## Lifecycle

**Sequence edit** → `H.afterEdit()`:

1. `map.clearInteraction()`  
2. `recognize` + `refreshAll()` → **`refreshMap()` once**  
3. session push + playback resync if playing  

**Do not** call `setPath` again after `afterEdit` unless special-case.

**Write home** with `skipEdit: true` only updates origin bookkeeping; callers plant then `afterEdit`.

## Product split

| | **Journey** (Chase) | **In this key** (Function) |
|--|---------------------|----------------------------|
| Job | Multi-key path | Same-key atlas |
| Map | Seats + path + purple leave-home ghosts | Diatonic / V7 / borrow chart |
| Suggestions | From here list (+ ghosts) | Function toggles + From here |

Map **next-move hollow dots** are retired (`setHorizon` is a no-op stub).

## Leave home (one plant path)

- Ghost pad / aim purple pad / From here **Mod** / **Land here**  
- Shared: `leaveHomeToKey` / `plantEstablishRoute` / `plantLandTonic`  
- Does **not** retag old steps onto the new disk  

## Hover next-arrows

- `previewNextFromStep(i)` → weighted arrows from path node to scale seats + leave-home  
- Thickness/alpha = join score (`scoreAimContext` + kind priors; dim pivots get half-step boost)  
- Click tip → append (or establish if modulate)  

## Weight

| File | Role |
|------|------|
| `spatial.js` (~2.9k) | Map layout, hit, draw |
| `compose.js` | Suggest, VL, adjacent keys, establish options |
| `hl-ui.js` | DOM + refreshMap |
| `hl-map-bridge.js` | Map ↔ state glue |
## Backups

- Pre-refactor: `Desktop/harmonic-landscape/backups/js-*-pre-refactor/`  
- Pre-split monolith: `backups/js-20260802-170014/app.js`
- Pre song-package / end-into / fretboard clip: `backups/js-20260806-175120-pre-song-schema/`

## Song / Fretboard (shared `ih-session.js`)

- Fretboard hard cap: **8** chords (`IHSession.FRETBOARD_MAX_CHORDS`). Landscape/Arrangement clip via `clipForFretboard` before handoff.
- Section cycle: `reps` + optional `endCellId` (last rep) + `intoCellId` (after reps) + `seam`.
- Song package: `format: idlehanz-song-package` via `exportSongPackage` / `importSongPackage`.
- Design pin: `Desktop/Harmonic Landscape - Design Freeze.md`
