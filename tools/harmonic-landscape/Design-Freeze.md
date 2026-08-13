# Harmonic Landscape — Design Freeze

**Pinned:** 2026-08-06  
**Owner:** Desktop kit (`Desktop/harmonic-landscape`, `Desktop/arrangement`, `Desktop/guitar_fretboard_app.html`, `Desktop/ih-session.js`)  
**Also synced:** `Projects/idlehanz.github.io/tools/` when publishing.

Session chat memory is **not** durable. This file is the product pin.

---

## 1. Three tools, one song

| Tool | Job |
|------|-----|
| **Landscape** | Compose a **cell** (short path) with map, multi-key, durations, audio |
| **Arrangement** | Order **cells** into **sections** (form of the song), reps, seams, play/export full song |
| **Fretboard** | Practice shapes for a short progression (pair morph, scale view) |

Shared state: `ih-session.js` → `localStorage` key `idlehanz_song_v1` + URL-hash handoff.

---

## 2. Frozen product model

### Musical units
- **Cell** — short idea (often ~4 chords). Has chords + optional family (v1, v2…).
- **Family** — linked versions of one idea (`familyId`, `versionIndex`).
- **Section** — named form slot (Verse, Chorus…). Points at a cell **chain**, **reps**, optional **end / into**, and a **seam** into the next section.
- **Path / sequence** — what Landscape edits *right now* (one cell’s chords).

### Landscape map
- **Journey** — multi-key path, seats, leave-home / Land here. Each step may stamp `localTonic` + `localMode` (multi-disk ownership). Land/establish does **not** retag old steps onto the new disk.
- **In this key** — same-key atlas (diatonic / dominants / borrow).
- **Edit vs append** — path step / context menu **replaces**; empty aim / append targets **append**. `writeChordToPath` is the single write funnel.
- **Hover next** — weighted arrows, not hollow next-dots.
- **Aim** — large dead-zone; no micro-snap to add9 variants on tiny drags.

### Arrangement / form schema (song package)
```
section {
  id, name,
  cellId,          // primary / first in chain
  chain: [cellId…],// versions in order (e.g. v1 → v2)
  reps: N,         // full body repeats
  endCellId?,      // last rep only: play this cell instead of chain (cycle exit)
  intoCellId?,     // after all reps, once: bridge cell before next section
  seam: { type: none|smooth|turnaround|custom, chords: [] }
}
```
**Flatten order:** for each section → (reps of chain, last rep may use `end`) → optional `into` → seam into next.

### Project vs song files
- **`.hl.json`** — Landscape cell project (`format: harmonic-landscape-project`): title, key, bpm, chords with `localTonic` / durations.
- **`.song.json` / song package** — full Arrangement document (`format: idlehanz-song-package`): cells, families, arrangement, key, bpm.
- **MIDI** — chord skeleton for DAW / Fender Studio. **Not** native Fender `.song`. Import MIDI as chords in the DAW; do not promise `.song` write.

---

## 3. Fretboard compatibility (hard limits)

| Limit | Value | Implication |
|-------|--------|-------------|
| **Max chords in progression** | **8** | `addSlot` refuses 9th; Landscape / Arrangement **must clip** before open handoff |
| Pair morph | Current + Next | Long cells are for Landscape/Arranger, not full fretting |
| Custom pitch sets | Supported | `quality: custom` + `notes[]` round-trip via session |

**Rule:** Send to Fretboard → take first 8 chords (or focused window of 8), warn if truncated. Full song lives in Arrangement + MIDI, not on the neck UI.

`localTonic` is preserved in session/song JSON and Landscape. Fretboard may drop multi-key stamps on round-trip (practice view is one scale at a time).

---

## 4. Multi-key & modulation

- Path steps own a **local** key (`localTonic` / `localMode`).
- Write home / origin can move (Land here) without rewriting history.
- Modulation portals, ghost establish, and “ways back” stay Landscape concerns.
- Song form does not need every chord’s disk for MIDI — only pitches + durations.

---

## 5. Loop / end / into / seams (SoP-style)

Songs like **The Speed of Pain** are not one long linear list:

1. **Cycle body** — loop cell (e.g. Em–Asus4–Em–Asus4).
2. **End** — last time through: different cell (e.g. Em–G–F#–Em descent).
3. **Into** — optional one-shot bridge into the next section.
4. **Seam** — none / smooth VL / turnaround chords between sections.

Pipes (visual “plumbing” of cycle → end → into → next) are a **later UI milestone**; schema and flatten come first.

---

## 6. Export realism

| Target | Support |
|--------|---------|
| Text list + durations | Yes (Landscape + Arranger) |
| MIDI chords (voice-led skeleton) | Yes — primary DAW / Fender Studio path |
| Native Fender `.song` | **No** (not reverse-engineered) |
| Fretboard handoff | Yes, **≤ 8 chords** |
| Session localStorage | Yes (Desktop kit same origin / file layout) |

---

## 7. Code map (Desktop)

```
Desktop/
  ih-session.js              shared song + handoff + flatten
  harmonic-landscape/        cell composer (spatial split: spatial.js + layout/input/draw)
  arrangement/               form editor + full-song play/MIDI
  guitar_fretboard_app.html  fretting UI (max 8)
  fretboard/index.html       alternate entry (same limits)
```

Backups live under `harmonic-landscape/backups/js-*/`.

---

## 8. Frozen vs brainstorm-only

### Frozen / ship direction
- Cell vs arrangement split  
- Multi-disk `localTonic`  
- Save/Load `.hl.json`  
- Section chain + reps + seam  
- **endCellId / intoCellId** on sections  
- Fretboard max **8** + clip on send  
- MIDI song export from Arranger  
- Spatial module split (no intentional behavior change)

### Later / not now
- Auto variation generation  
- Native DAW project formats  
- Raising fretboard past 8 (would need fretboard redesign)  
- Branching multi-path song graphs  

### Key pipe (Arranger — shipped)
- **Cylinder model:** rim = **Journey / In-this-key seat wheel** (`circularHarmonicScale` / `seatForChord` — same as Landscape), **not** circle of fifths  
- Angle = functional seat (i, iv, ♭VII, …) on the chord’s `localTonic` disk; tonic at top  
- Colour = key disk (`localTonic`); time = along the pipe  
- Same seat = run along a generator; seat change = rotation on the wheel; key change = colour shift  
- Form strip left edge = key colour  
- SoP demo stamps Em (home) · C major (colour) · G major (bridge)

---

## 9. Demo song pin — The Speed of Pain (Em)

Full package: **`Desktop/the-speed-of-pain.song.json`** (also under `arrangement/`).

| Cell | Role | Frettable |
|------|------|-----------|
| Intro / Loop | Em–Asus4 cycle | yes (4) |
| End | Em–G–F#–Em exit | yes |
| Into Colour | Asus4–Em–Asus4–Cadd9 | yes |
| Colour / Colour End | Cadd9 colour + exit | yes |
| Bridge | 8-chord dark G–F#… | yes (8) |
| Refrain / Outro / Hold | Em–C + hold | yes |
| Full Path (19) | linear Landscape dump | no (clip) |

**Form (9 sections):** Intro → Verse1 (×3+end+into) → Colour1 → Verse2 (+turnaround seam) → Bridge → Colour2 → Refrain → Verse3 (+into outro) → Outro (+hold end).

Arranger: **Load SoP full** · form strip · pipes · end/into · MIDI / flat JSON.

---

## 10. How to resume work

1. Open this file.  
2. Open Desktop Landscape / Arrangement under `file://` with `ih-session.js` sibling.  
3. Prefer small patches; keep Desktop and `tools/` in sync if publishing.  
4. Do not invent Fender `.song` export. Do respect fretboard **8**.

---

---

## 11. Current pin (2026-08-13)

- **Browse-first map:** Select previews; Write or double-click adds; drag reorders; Shift+drag aims. From here is a commit list (click adds). Hover does not stop the loop.
- **Mid-path Write inserts after** the selected step. Replace is inspector / right-click / Shift on From here.
- **Session is a bus.** Landscape boot is empty unless hash handoff or **Resume**. `pushToSharedSession` does not overwrite song key when the song already has form.
- **Handoff keeps `familyId` / `versionIndex` / `sectionId`.** Fretboard clip is ephemeral — it must not rewrite the cell.
- **One fretboard:** `Desktop/fretboard/index.html` (same as site). Do not open `guitar_fretboard_app.html`.
- **Arrangement:** confirm overwrite / delete section; form undo (Ctrl+Z); **This section** plays only the selected section.

*Last updated with browse-first + handoff integrity + form undo.*
