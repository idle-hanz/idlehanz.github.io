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
- **`.hl.json`** — Landscape project (`format: harmonic-landscape-project`): title, key, bpm, current chords with `localTonic` / durations, plus the **version family** (`cells` + `families` + `from*`). Old one-cell files still load.
- **`.song.json` / song package** — full Arrangement document (`format: idlehanz-song-package`): cells, families, arrangement, key, bpm.
- **MIDI** — chord skeleton for DAW / Fender Studio. **Not** native Fender `.song`. Import MIDI as chords in the DAW; do not promise `.song` write.

---

## 3. Fretboard compatibility

**2026-08-15:** Fretboard UI ceiling of 8 is lifted. Landscape / Arrangement send the **whole cell**. A MIDI teleprompter row on the Fretboard is song-owned; send-to-Landscape still windows (default 8) so a 90-chair import does not smash a cell. “Send this loop” is later.

| Limit | Value | Implication |
|-------|--------|-------------|
| **Cell → Fretboard** | whole cell | shrinking row (fat current + next) |
| **Teleprompter → Landscape** | window of **8** | warn; new cell; full row stays on Fretboard |
| Pair morph | Current + Next | still a pair, even on a long row |
| Custom pitch sets | Supported | `quality: custom` + `notes[]` round-trip via session |

**Rule:** Do not dump a whole teleprompter song into a Landscape cell. Cells round-trip whole.

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
| Fretboard handoff | Yes — whole **cell**; teleprompter send still windows |
| Session localStorage | Yes (Desktop kit same origin / file layout) |

---

## 7. Code map (Desktop)

```
Desktop/
  ih-session.js              shared song + handoff + flatten
  harmonic-landscape/        cell composer (spatial split: spatial.js + layout/input/draw)
  arrangement/               form editor + full-song play/MIDI
  fretboard/index.html       neck + teleprompter (do not open guitar_fretboard_app.html)
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
- Fretboard holds a whole cell; teleprompter → Landscape still windows (8)  
- MIDI song export from Arranger  
- Spatial module split (no intentional behavior change)
- **Realtime MIDI-out** from Landscape `playChord` (Web MIDI output; click / Write / Play; hover stays local)
- MIDI-out **bass split / Speak figures / clock out** (Landscape Synth port; see §18)

### Later / not now
- Auto variation generation  
- Native DAW project formats  
- Send this A–B loop / section to Landscape (replaces the 8-window)  
- Branching multi-path song graphs  
- **Studio MIDI-out** — Arrangement Play first (form skeleton). Fretboard Chase never. Fretboard Play only if still wanted. After Arrangement form. Handover **block S**. Do not reopen Landscape MIDI-out.  
- Three-tool rewrite (never as one job). Audit is done; A1 and A2 are done.  
- Journey **third+** gear train (v1 is two meshed cogs)
- Journey unused-seat rings / post-Focus ghost latch. In-place paint, not more cinema. Journey may later show In-this-key *details* on the wheel — later.
- **In this key views landed** (2026-08-17): Wheel (default write clock) · Lattice (Tonnetz) · Houses (bins). Not Focus cinema. River later.

### Journey cogs (shipped 2026-08-16 — v1)
- Default Journey = **write-home wheel + traveled other-key wheel + the path**. Ghost adjacent keys (Em / F#m halo) stay off until hover / aim / leave-home.
- Two disks sit as **meshed cogs**: a **pivot chord** (named on both rims — same pitches / same root) is the tooth. Rotate the second wheel so those seats coincide on the scale ring. Not a fifths-offset pair of floating wheels.
- That pivot is **one node** on both rims. Visit numbers stack (`2 · 4`), never overwrite. Any pair of traveled disks uses the same rule (not a hard-coded F or a hub-to-hub lock).
- **Focus** is full-viewport cinema (Esc leaves). Routes bloom through the sounding chord — scale seats plus purple leave-home wheels — then go dark as the next chord arrives. Graph turn is a hint. **Home / Fit** stay still.
- F#7 (4) and F#7/A# (8) share a V7 seat — both visit numbers show. Third+ gear train is still later.  

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
| Full Path (19) | linear Landscape dump | yes (whole cell) |

**Form (9 sections):** Intro → Verse1 (×3+end+into) → Colour1 → Verse2 (+turnaround seam) → Bridge → Colour2 → Refrain → Verse3 (+into outro) → Outro (+hold end).

Arranger: **Load SoP full** · form strip · pipes · end/into · MIDI / flat JSON.

---

## 10. How to resume work

1. Open this file.  
2. Open Desktop Landscape / Arrangement under `file://` with `ih-session.js` sibling.  
3. Prefer small patches; keep Desktop and `tools/` in sync if publishing.  
4. Do not invent Fender `.song` export. Do not dump a teleprompter song into a Landscape cell.

---

---

## 11. Current pin (2026-08-13)

- **Browse-first map:** Select previews; Write or double-click adds; drag reorders; Shift+drag aims. From here is a commit list (click adds). Hover does not stop the loop.
- **Mid-path Write inserts after** the selected step. Replace is inspector / right-click / Shift on From here.
- **Session is a bus.** Landscape boot is empty unless hash handoff or **Resume**. `pushToSharedSession` does not overwrite song key when the song already has form.
- **Handoff keeps `familyId` / `versionIndex` / `sectionId`.** A Landscape cell sent to Fretboard is the whole cell. A teleprompter send-back must not rewrite that cell with the full song.

---

## 12. Current pin (2026-08-15) — teleprompter

- Fretboard `Desktop/fretboard/index.html` may hold a long timed row (MIDI import). Current + next stay fat.
- Landscape / Arrangement **→** Fretboard: send the **whole cell**. No 8-clip.
- Fretboard teleprompter **→** Landscape: still window (default 8), warn, new cell. Full row stays on the Fretboard.
- `idlehanz_song_v1.teleprompter` + `conductor` are Fretboard-owned. They do not replace `cells`.
- **One fretboard:** `Desktop/fretboard/index.html` (same as site). Do not open `guitar_fretboard_app.html`.
- **Arrangement:** confirm overwrite / delete section; form undo (Ctrl+Z); **This section** plays only the selected section.

---

## 13. Current pin (2026-08-15) — after chase

- Chase v2 is on Desktop Fretboard. DAW is master. **MTC + clock.** **SPP never** on this Studio One / Fender Studio port. Cycle follow only if MTC jumps. User confirmed it works.
- Operating plan: `Desktop\Idle-Hanz-Studio-HANDOVER.md`. Audit is done (see §14). Do not rewrite all three.
- Four MIDIs: Web Audio hear-while-writing (shipped); realtime MIDI-out v1 (shipped); `.mid` file export (Arrangement + cell dump); chase input (shipped). Do not mix them.
- **One fretboard:** `Desktop/fretboard/index.html`. Logger: `fretboard/midi-monitor.html`. Do not open `guitar_fretboard_app.html`.

---

## 14. Current pin (2026-08-16) — after audit

- Findings: `Desktop\Idle-Hanz-Studio-AUDIT.md`. Do not re-run the audit.
- Named fixes: **A1** keep disk stamps on Fretboard → Landscape cell write-back (**done** 2026-08-16); **A2** Landscape boot empty unless hash or Resume (**done** 2026-08-16). In-place. Not a refactor. Not an overhaul.
- Operating plan: `Desktop\Idle-Hanz-Studio-HANDOVER.md`.

---

## 15. Current pin (2026-08-16) — after gap-join; A2 done; MIDI-out next

- Green-edge insert plants a **passing** `a → ? → b` (not write-home tonic). Write or Shift+drag the edge. Aim pads are gap joins. Empty-space release cancels; release on the planted node keeps it. Same-root colour stays in the inspector.
- **A2 is done** 2026-08-16 (`?v=20260816h`). Landscape boot is empty unless hash/query handoff or **Resume**. Resume is the last cell on this origin’s session — not Save/Load, not a second project file. Play toggles Stop. Owner browser: Edge.

## 16. Current pin (2026-08-16) — realtime MIDI-out shipped

- Landscape header **Synth** picker → Web MIDI **output**. Same pitches as `playChord`. Click / Write / Play go to the port; hover / aim stay Web Audio.
- Mute tones optional (pulse click unchanged). Panic + Esc / Stop send note-off + All Notes Off / All Sound Off.
- Port name + mute persist on this Landscape origin (`ih_landscape_midi_out`). Not the song. Not `ih-session.js`.
- Use a **second** loopMIDI port (or USB / DIN interface). Do not steal **Idle Hanz Chase**.
- Bass split / Speak / clock out shipped 2026-08-16 (see §18). Arrangement realtime out is still later (block C).
- Cache: MIDI-out v1 `audio.js` / `midi-out.js` / `app.js` `?v=20260816m`; v2 bump on those files is §18.

## 17. Current pin (2026-08-16) — versions persist (owner confirmed)

- Darken / Reharm / … siblings stay on the chips after you edit or extend a **non-v1** take. Editor holds `familyId` / `versionIndex` / `from*` (`rememberCellLineage`) so a push cannot orphan the take onto v1.
- Family records heal from `familyId` on the cells if `families[id]` went missing. A 0–1 cell `saveSong` cannot wipe a family on disk unless Reset/Delete set `_okToShrink`.
- Click a chip while **Stopped** = open that take on the timeline. While looping: same-length arms next pass; different length jumps now. `_loopLive` is false unless audio is actually playing.
- **Save project** writes the whole version family into `.hl.json`. Load restores those takes. One-cell files from before this pin still open.
- **Reset** is on the Build row (Delete / Undo / Redo) and on the empty-path row — not only inside Add / insert / clear.
- Cache: `ih-session.js` / `hl-session.js` / `hl-versions.js` / `hl-playback.js` / `hl-undo.js` / `hl-edit.js` `?v=20260816q`. `app.js` `?v=20260816p`. `hl-ui.js` `?v=20260816n`.

## 18. Current pin (2026-08-16) — MIDI-out v2 (bass / Speak / clock)

- Same Landscape **Synth** port as v1. Still not chase. Still not `.mid` file export. Still not Arrangement realtime out.
- **Bass split:** lowest voicing note → MIDI **channel 2**, uppers → **channel 1**. Off = all notes on ch 1 (v1).
- **Speak** (Play only — needs beats + bpm): **Hold** (v1 pad) · **Pulse** (bass each beat, pad holds) · **Walk** (bass root then fifth, 2-beat slots) · **Stab** (short hits each beat). Click / Write / hover stay hold. Hover still Web Audio only.
- **Clock:** MIDI Start + 24 ppqn + Stop on that port while **Play** runs. Tempo only — no SPP. Auditions / From-here previews do not start clock. Resync and tempo change keep the clock running (no extra Start). Esc / Stop / natural end send Stop.
- Prefs stay on this Landscape origin (`ih_landscape_midi_out`). Not the song. Not `ih-session.js`.
- Do not steal **Idle Hanz Chase**. Clock + notes on the chase port is warned, not blocked.
- Cache: `audio.js` / `midi-out.js` / `hl-playback.js` `?v=20260816r`.

## 19. Current pin (2026-08-16) — MIDI range (oct / spread)

- Kontakt / VSTi range lives on the Landscape **Synth** port only. Browser tones stay on the written voicing.
- **Pad oct** / **Bass oct:** −3…+3. Pad = uppers (ch 1). Bass = lowest note (ch 2 if split).
- **Pad spr:** Close · As written · Open · **Shell** (3rd+7th, or 3rd+5th on a triad) · **Rootless** (omit chord root) · **Drop 2** (second-from-top down an octave). MIDI pad only.
- **Bass spr:** 1 note · +8va double · ±8va. Walk fifth follows the shifted bass.
- Prefs stay on `ih_landscape_midi_out`. Changing a control while a step is selected re-sends that chord so you can hear the new range.
- **Header (2026-08-16):** two rows — tools + **Play** on top; write-home / tempo on the second. Mute / split / Speak / clock / range / **velocity** live in the **MIDI** panel (not the bar).
- **Velocity:** Pad and Bass sliders 1–127 (defaults 72 / 95). Next note uses the new value; dragging does not restart Play.
- **Level (CC7)** per stream, **Mute Pad / Mute Bass**, and **channel 1–16** pickers live on each stream row. Split off = both note streams on the pad channel; bass CC7 still goes to the bass channel. Same-channel split warns that the two levels share one CC7.
- **Walk** pinches a pad chord-tone (prefer 5th, then 3rd/7th) into the bass register; that pc drops off the pad while the bass has it. Click / Write also figure when Speak is not Hold (beats from duration × BPM).
- Slash / dim cells: MIDI bass is `bassPc` (not the lowest voicing note). Missing triad tones are filled onto the pad so A#°/E is E + A# + C#, not a lone A#.
- Cache: `audio.js` `?v=20260816w` / `midi-out.js` `?v=20260816y`.

## 20. Current pin (2026-08-16) — Journey cogs (v1 shipped)

- MIDI sitting is **done** (`midi-out.js` `?v=20260816z`). Walk never strips the last pad note. Style does **not** auto-drive Speak (arps = Hold + Clock). Do not reopen MIDI for map work.
- Journey cogs **v1 shipped** (`spatial*.js` / `hl-map-bridge.js` `?v=20260816j`). Two meshed cogs + path; visit numbers stack; ghosts off until hover/aim; one shared pivot node. See §8. Not In-this-key unless seat math is shared. Third+ gear train is later.
- Do not reopen this sitting to tidy MIDI, chips, Save project, or Reset.

## 21. Current pin (2026-08-16) — Journey / Focus owner-confirmed

- Owner: Speed of Pain **looks beautiful**. Journey cogs + Focus cinema are **done**. Do not reopen for more cinema. Third+ gear train is still later.
- Fog title is the **sounding** path step, screen-space, never the next-key preview (`spatial-layout.js` / `spatial-draw.js` `?v=20260817c`).
- A/B second half rides the map then restores this take — does not write the cell (`hl-playback.js` / `hl-ui.js` `?v=20260817d`).
- Site publish **done** 2026-08-16 (`idlehanz.github.io` `576f70e`). Ride + Fretboard guide left as site-only.
- Next sitting (superseded 2026-08-17): see §23.

## 22. Current pin (2026-08-17) — studio MIDI-out narrowed

- Arrangement **Play / This section / From section** get the Landscape Synth panel later (handover **block S**) so form is a compose skeleton.
- Fretboard **Chase** never sends notes or clock. The DAW already has the chords.
- Fretboard **Play** (neck + teleprompter, DAW off) only if still wanted after Arrangement MIDI.
- Landscape MIDI-out stays **done**. Do not reopen Speak / Walk / range / Focus.

## 23. Current pin (2026-08-17) — In this key next

- Owner is in the Landscape zone. **Next sitting is In this key** (handover **block K**), not Arrangement form.
- Noted order (may change): In this key → Arrangement form → Arrangement MIDI-out → Fretboard Play MIDI only if missed → panel flow later.
- In this key is the atlas of this write-home. It does **not** have to be the Journey wheel. Journey can later grow seat-detail; not this sitting. Not Focus cinema.
- **In this key views:** **Wheel** (default — same clock as Journey, write the cell) · **Lattice** (Tonnetz voice leading) · **Houses** (bins only). Focus stays Journey.
- Review page: `Desktop/in-this-key-shapes.html`.

*Last updated after C+E pick.*
