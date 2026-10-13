# Tonalia user guide

*Mix in harmony.* · [Español](user-guide.es.md)

Tonalia analyses your music on your computer: key, BPM, energy, structure and cue points. It then helps you prepare your sets: it writes the results to your tags, takes them to your DJ software, suggests mashups and transitions, separates stems and builds sets. No accounts, no telemetry, no servers.

To install it, see [`install.md`](install.md).

## Contents

1. [Getting started](#1-getting-started)
2. [The library](#2-the-library)
3. [Track detail: waveform, cues, wheel and piano](#3-track-detail)
4. [Editing a track's information](#4-editing-a-tracks-information)
5. [Writing and cleaning tags](#5-writing-and-cleaning-tags)
6. [Playlists and smart playlists](#6-playlists-and-smart-playlists)
7. [Exporting to your DJ software](#7-exporting-to-your-dj-software)
8. [Stems](#8-stems)
9. [Pro mode: mashups and DJ Mix](#9-pro-mode-mashups-and-dj-mix)
10. [Set builder](#10-set-builder)
11. [Settings](#11-settings)
12. [Keyboard shortcuts](#12-keyboard-shortcuts)
13. [Privacy and your files](#13-privacy-and-your-files)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. Getting started

1. Open Tonalia. The first time, you see **"Welcome to Tonalia"**.
2. Drag your music folder onto the window or click **"Choose folder…"**. Subfolders are included. Tonalia reads MP3, AAC/M4A, ALAC, AIFF, WAV, OGG and FLAC.
3. The tracks are added to the library and analysed automatically. A progress bar shows how far along it is, and you can cancel it.

Later, you can drop folders or files anywhere on the window; it shows **"Drop to add and analyze"**.

> Tonalia **does not copy or move** your music: it remembers where each file is. If you move a file, it recognises it by its content and updates the location instead of duplicating it.

### What the analysis finds

| Value | What it means |
|---|---|
| **Key** | One of the 24 keys, with a confidence and two alternatives. Low confidence shows a small warning on the chip. If the track changes key, Tonalia tells you where ("Changes to 9A at 3:12"). |
| **BPM** | The tempo and its beat grid (where each bar falls). Tracks with a variable tempo are marked. |
| **Energy 1–10** | How intense the main part of the track is (not the intro), from 1 (calm) to 10 (peak). The energy curve is drawn over the waveform. |
| **Structure and cues** | Intro, build, drop, breakdown and outro, with up to 8 cue points at the important changes, always on a downbeat. |
| **Quality** | Clipping, low bitrate, fake high quality, very low loudness and long silences. Tracks with warnings appear in **Review quality**, where each problem says what to do (hover over it) and **✓ Mark as reviewed** takes the track off the list until a new problem shows up (the notice can undo it). |

## 2. The library

**All tracks** is a table with artwork, title and artist, key, BPM, energy, cues, genre, length, status and date. It stays smooth with libraries of a hundred thousand tracks.

- **Search:** the field at the top (⌘F on Mac, Ctrl+F on Windows) searches title, artist and album as you type.
- **Sort:** click a column header. Click it again to reverse the order.
- **Density:** switch between comfortable and compact rows.
- **Selection:**
  - With the mouse: click, Shift+click for a range, ⌘/Ctrl+click for single tracks.
  - With the keyboard: arrows, Shift+arrows, Home/End and Page Up/Down.
- **Open a track:** double-click or Enter.
- **Context menu** (right-click):
  - play it or open the detail;
  - load it on a deck or add it to a playlist;
  - re-analyse it or edit its info;
  - show it in Finder/Explorer;
  - remove it from the library. Removing **never deletes the file**.

### Key notation

In **Settings → Analysis**, choose how keys are written:

| Notation | Example (A minor / C major) |
|---|---|
| Alphanumeric | 8A / 8B |
| Open Key | 1m / 1d |
| Classic | Am / C |
| Classic with flats | the same, with flats (E♭m instead of D♯m) |

The chip colour follows the position on the harmonic wheel, so neighbouring keys have neighbouring colours. The key text is always shown, so you never depend on colour alone.

The same section also has:
- **BPM range** (70–180 by default): tempo is searched between these values, and a track outside the range is read at half or double. For drum & bass, try 85 to 180. It applies to the next analyses.
- **Cue colours**: one colour per section type (intro, build, drop…). Automatic cues change colour at once; cues you coloured by hand stay as they are.
- **Parallel processes**: how many tracks are analysed at once. "Automatic" uses every core but one.

### Advanced filters

The **Filters** button opens a panel with these filters:
- Key, with **"Include compatible"**.
- BPM range, with **"Include ×2 / ÷2"** to find tracks at half or double tempo.
- Energy, genres, playlist, analysis status and quality.

Active filters appear as chips you can remove with ✕. **"Save as smart playlist"** turns the combination into a playlist that keeps itself up to date.

## 3. Track detail

Double-click a track to open it; **Back** (or Esc) returns to the list.

- **Big values:** key with its confidence and alternatives, BPM and energy.
- **Waveform:** coloured by band (lows, mids, highs), with labelled sections, the energy curve, numbered cues and a bar ruler.
- **Player:** Space to play or pause, and jumps to the previous or next cue.
- **Cue points:**
  - **1–8** jump to each cue.
  - **Drag** a cue flag to move it.
  - Click a pad to rename it, change its colour or delete it.
  - **"Set cue here"** (Snap Cue) places a cue at the current position, snapped to the beat.
  - **"Reset automatic"** recalculates the automatic cues. Re-analysing never touches your own cues; only this button does.
- **Harmonic wheel:** highlights the track's key and its compatible keys (same, ±1, relative, +2 energy…). Click a key to see the tracks compatible with it in the library.
- **Piano:** two octaves with the track's scale marked.
  - Play it with the mouse or the computer keyboard: A W S E D F T G Y H U J K O L P, with Z and X to change octave.
  - **"Play chord"** and **"Play scale"** let you check the key by ear.
  - **"Play along with the track"** plays the piano over the music.
- **Quality:** chips for bitrate, loudness (LUFS) and clipping, green when fine and amber when worth a look.

The **Guides** item in the sidebar has tutorials on harmonic mixing, energy levels, cue points and phrasing, and mashups with stems.

## 4. Editing a track's information

**"Edit info"** opens a side panel with title, artist, album, genre, year, key, BPM, energy and comment. BPM has ×2, ÷2 and **Tap tempo** buttons.

- Manual changes win over the analysis and are marked **"Edited by hand"**.
- Title, artist, album, genre, year and comment are written **to the file**, with a backup, and can be undone.

## 5. Writing and cleaning tags

Select tracks and click **Tags**. With nothing selected, every track in the current view is used.

### Write results

- **Fields:** choose what to write: key, BPM and comment. You can also put the energy in "grouping" or in the rating.
- **Comment template:** use the variables `{key}`, `{key_alt}`, `{energy}`, `{bpm}` and `{comment_original}`.
  - The default is `{key} - Energy {energy}`.
  - It can go before the existing comment, after it, or replace it.
- **Preview:** shows before → after for each track. Nothing is written until you click **"Write to N tracks"**.
- **Undo:** the original tags are backed up first. The final message has **Undo**, which restores exactly what was there. Once the message is gone, the **History** tab of the Tags screen keeps every write (results, cleaning, bulk edit and Serato cues) with its date, its tracks and an **Undo** button, which works as long as the file has not changed since.
- Above the options, Tonalia says which tracks it will write to: the selection or every track in the view, with the first titles. **Change** goes back to the library.

Rekordbox, Serato, Traktor, VirtualDJ and most DAWs read these tags.

### Clean tags

Each rule can be switched on or off, with a preview:
- Remove URLs and domains, and promotional phrases (from a list you can edit).
- Remove track numbers from titles, and "(Original Mix)".
- Remove double spaces.
- Change ALL CAPS to Title Case.
- Normalise "feat." and move the guest artist to the title or the artist field.
- Unify the artist separator.

You can also edit any field on many tracks at once.

## 6. Playlists and smart playlists

- Create **folders** and **playlists**, nested as deep as you like. Each one has an icon; click it to change it.
- **Drag** tracks onto a playlist in the sidebar to add them. Drag playlists to reorder them or move them between folders.
- **Smart playlists** fill themselves with the tracks that meet all their conditions: key (or compatible keys), BPM range, energy, genre, not analysed, review quality or favourites.
- **M3U/M3U8:** import and export playlists to use them in other software.

### Watched folders

In **Settings → Watched folders**, add the folders where you download music. New tracks there are added and analysed on their own. Tonalia checks those folders every 30 seconds while it is open, and waits until each file has finished copying.

## 7. Exporting to your DJ software

**Export** brings the five destinations together. Always click **Simulate** first: it tells you what will change without writing anything. When you export, Tonalia backs up the previous file, and **"Show backup"** takes you to it.

| Destination | What goes across | How |
|---|---|---|
| **Rekordbox** | Hot cues with name and colour, beat grid, key and playlists | Tonalia writes a `rekordbox.xml`. In Rekordbox, choose the file under Preferences → Advanced → Database → "rekordbox xml". Then drag tracks or playlists from "rekordbox xml" in the sidebar into your collection. The screen walks you through it. |
| **Traktor** | Cues and key | Tonalia updates your `collection.nml`, which it finds on its own. **Close Traktor first**: if it is open, Tonalia warns you and writes nothing. |
| **Serato** | Hot cues with colour and name | Written inside each file (MP3, M4A, FLAC, AIFF), where Serato reads them. |
| **VirtualDJ** | Cues and key | Tonalia updates its `database.xml`. Close VirtualDJ first. |
| **Engine DJ** | Hot cues with name and colour, beat grid, key and playlists | Tonalia updates its database (`Engine Library/Database2/m.db`, in your Music folder or on a USB drive). **Close Engine DJ first.** Only tracks already in Engine DJ are updated, so import new ones there first. Your playlists appear inside a "Tonalia" playlist, replaced on every export. Pads without a Tonalia cue and Engine's own analysis are kept. |

Key, BPM and energy reach every program through the [tags](#5-writing-and-cleaning-tags).

## 8. Stems

Tonalia separates each track into **vocals, drums, bass, other** and **instrumental** (everything but the vocals), on your computer.

- **Model** (Settings → Stems):
  - "Best quality" (`htdemucs_ft`, about 340 MB);
  - "Fast" (`htdemucs`, about 85 MB).

  The model is downloaded **once**, the first time you separate, and Tonalia checks that the download is complete.
- **Acceleration:** the GPU on Apple Silicon Macs and on PCs with a supported NVIDIA card; otherwise the CPU.
- **Separate:** from the track detail or a Pro deck. **"Prepare stems"** separates a whole playlist at once.
- **Export:**
  - as WAV, AIFF or FLAC (24-bit);
  - in the original key and tempo, or with the pitch and tempo changes applied;
  - with a file name template (`{artist} - {title} ({stem}) [{key} {bpm}]`);
  - to a folder you choose or to your DAW project folder.
- The stem cache can be emptied in Settings → Stems.

## 9. Pro mode: mashups and DJ Mix

Switch to **Pro** at the top of the sidebar, or click **"Open in Pro"** on a track. You get two decks: **A** (cyan) and **B** (coral).

### Mashup

1. Load a track on **Deck A**.
2. **Deck B** shows the best idea from your library, with its score and the **reason**: "Same key", "Relative", "+1 st on B", "Vocals A + Instr. B" and so on. Browse the ideas with ◀ ▶ (or ← →).
3. **"Try mashup"** (or Space) plays both decks together. B follows A's tempo and the downbeats line up.
4. Each deck has:
   - a **pitch shift** of ±6 semitones (the ideas update instantly);
   - a **stem selector** (Track / Vocals / Instrumental);
   - a **loop** of 1 to 32 bars.
5. Click a **cue** on either deck to hear that section in sync with the other deck.
6. **Idea filter:** narrow the suggestions by energy, BPM, playlists and genres, and allow or forbid pitch shifting (±2).
7. **Save favourite** keeps the combination: tracks, pitch shifts, cues, stems and mode. In **Favourite mashups** you can:
   - rate it with stars and add notes;
   - open it on the decks again;
   - export both processed files, ready for your DAW.

### DJ Mix

With the switch on **DJ Mix**, B suggests the next track for a smooth transition out of A.
- **"Try mix"** plays the end of A and the start of B with an automatic 16- or 32-bar crossfade.
- **"Move B → A"** makes B the current track and finds new ideas.
- **"Add to playlist"** builds your set one track at a time.

## 10. Set builder

1. Choose the **source**: a playlist or the library selection.
2. Choose the **length**, in minutes or in tracks, and an optional **first track**.
3. Draw the **energy curve**: drag its points or use a template (Warm-up → Peak → Close, Flat, Rising). Double-click to add or remove a point.
4. Click **"Generate set"**.

Each transition shows its score:
- green ✓: good;
- amber ~: fair;
- red ✕: a key clash with no alternative.

You can reorder tracks by dragging, **replace** a track (Tonalia shows alternatives) or remove it. Then save the set as a playlist or export it to Rekordbox, Traktor or M3U.

## 11. Settings

| Section | Options |
|---|---|
| General | Language (Spanish, English) and theme (light, dark or system) |
| Analysis | Notation, BPM decimals, number of automatic cues (0–8) |
| Watched folders | Folders that are imported and analysed automatically |
| Stems | Model, acceleration, cache, DAW folder and export template |
| Updates | Check for updates at start-up (can be turned off) and "Check now" |
| About | Version, licence, source code, **third-party licences** and "Open logs folder" |

## 12. Keyboard shortcuts

Press **?** at any time (or "Keyboard shortcuts" in the sidebar) for the full list. The most used:

| Shortcut | Action |
|---|---|
| Space | Play or pause (in Pro: try the mashup or the mix) |
| 1–8 | Jump to a cue |
| ⌘F / Ctrl+F | Search |
| ⌘1–4 / Ctrl+1–4 | Library, Pro, Favourites, Set builder |
| ⌘, / Ctrl+, | Settings |
| ← → | In Pro, previous or next idea |
| Esc | Close a dialog or panel, or go back from the detail |

The whole app works from the keyboard, with a visible focus.

## 13. Privacy and your files

- **Everything is local.** Analysis, stems and suggestions run on your computer. Tonalia only goes online for two things:
  - to download the stem model the first time;
  - to check for updates, which you can turn off.
- **Your data is never destroyed.** Tonalia makes a backup before it writes tags or changes a Traktor or VirtualDJ collection, and you can undo the change. Every write is atomic: a file is never left half-written.
- **No telemetry.** Logs stay on your computer (Settings → About → "Open logs folder").

## 14. Troubleshooting

**macOS says it cannot open Tonalia.** The app is not notarised by Apple. Follow [`install.md`](install.md) ("Open Anyway" in System Settings).

**A track's status is "error".** Hover over the icon to see why, for example a damaged file or a format that cannot be read. The rest of the queue carries on.

**The key has a ⚠ warning.** The confidence is low. Check it with the piano ("Play chord" with "Play along with the track") and fix it in "Edit info" if needed.

**The BPM is half or double.** In "Edit info", use ×2 or ÷2 (or "Tap tempo"). Manual changes are kept when you re-analyse.

**"The analysis engine has restarted" appears.** Tonalia restarts it on its own. If it keeps happening, click "Show details" and open the logs folder to [report the problem](https://github.com/fllujan/tonalia/issues/new/choose).

**Traktor, VirtualDJ or Engine DJ do not show the export.** Close the program before exporting and open it again afterwards.

**Engine DJ "did not close properly".** Open Engine DJ, quit it normally and export again. Tonalia never touches a database with pending changes.

Found a bug or have an idea? [Open an issue](https://github.com/fllujan/tonalia/issues/new/choose). To help build Tonalia, read [`CONTRIBUTING.md`](../CONTRIBUTING.md).
