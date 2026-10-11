# Third-party dependencies

Every dependency added to Tonalia is listed here with its license. All must be compatible with **AGPL-3.0**. Models or libraries under "non-commercial" licenses are not allowed in the default configuration.

| Component | Dependency | Version | License | Notes |
|---|---|---|---|---|
| engine | pydantic | 2.x | MIT | RPC schemas |
| engine (dev) | pytest, pytest-cov | 9.x / 7.x | MIT | tests |
| engine (dev) | ruff | 0.x | MIT | lint/format |
| engine (dev) | mypy | 2.x | MIT | type checking |
| engine (build) | hatchling | 1.x | MIT | build backend |
| app | react, react-dom | 18.x | MIT | UI |
| app | i18next, react-i18next | 26.x / 17.x | MIT | i18n |
| app | @tauri-apps/api, @tauri-apps/cli | 2.x | Apache-2.0 OR MIT | desktop bridge / CLI |
| app | @fontsource/inter, space-grotesk, jetbrains-mono | 5.x | OFL-1.1 (fonts), MIT (package) | bundled fonts, no network |
| app (dev) | vite, @vitejs/plugin-react | 8.x / 6.x | MIT | bundler |
| app (dev) | tailwindcss, @tailwindcss/vite | 4.x | MIT | styles |
| app (dev) | typescript | 6.x | Apache-2.0 | types (TS 7 not yet supported by typescript-eslint) |
| app (dev) | eslint, typescript-eslint, eslint-plugin-react-hooks, eslint-plugin-react-refresh, eslint-config-prettier, globals, @eslint/js | — | MIT | lint |
| app (dev) | prettier | 3.x | MIT | formatting |
| app (dev) | vitest, jsdom, @testing-library/* | — | MIT | tests |
| app (rust) | tauri, tauri-build | 2.x | Apache-2.0 OR MIT | desktop shell |
| app (rust) | serde, serde_json | 1.x | Apache-2.0 OR MIT | serialization |
| app (rust) | tokio | 1.x | MIT | async process/IO for the engine bridge |
| engine (build) | PyInstaller | 6.x | GPL-2.0-or-later with bootloader exception | one-folder engine bundle |
| bundled binary | FFmpeg | 9.0.2 | GPL-3.0-or-later (build with `--enable-gpl --enable-version3`) | decoding; run as a separate process. macOS builds: ffmpeg.martin-riedl.de; Windows: gyan.dev (GyanD/codexffmpeg) |
| bundled binary | Rubber Band CLI | 4.0.0 | GPL-2.0-or-later | time-stretch / pitch-shift; run as a separate process (breakfastquay.com) |
| bundled binary | libsndfile (`sndfile.dll`, Windows, ships with Rubber Band) | — | LGPL-2.1-or-later | |
| app (dev) | json-schema-to-typescript | 15.x | MIT | RPC type generation |
| engine | numpy | 2.x | BSD-3-Clause | audio arrays |
| engine | mutagen | 1.x | GPL-2.0-or-later | tag reading/writing (used under GPL-3.0 terms, compatible with AGPL-3.0) |
| engine | xxhash | 3.x | BSD-2-Clause | content hash for move/duplicate detection |
| app | @tanstack/react-query, @tanstack/react-virtual | 5.x / 3.x | MIT | data cache, virtualized table |
| app | zustand | 5.x | MIT | UI state |
| app | lucide-react | 1.x | ISC | icons (DESIGN.md: Lucide) |
| app | @tauri-apps/plugin-dialog, tauri-plugin-dialog | 2.x | Apache-2.0 OR MIT | folder picker |
| engine | scipy | 1.x | BSD-3-Clause | resampling, median filters (HPSS) |
| engine | pyloudnorm | 0.1.x | MIT | ITU-R BS.1770-4 loudness (energy, quality) |
| engine | future (pyloudnorm dependency) | 1.x | MIT | — |
| engine (dev) | scipy-stubs | 1.x | BSD-3-Clause | type checking |
| engine (data) | Key profiles: Krumhansl & Kessler (1982), Temperley (1999), Faraldo et al. (2016/2017) | — | published research values | `analysis/key.py` |
| engine (data) | `key_model.json`: weights fitted on the key **annotations** of GiantSteps-MTG-Key (Faraldo et al., MTG-UPF) | — | no license declared by the dataset; facts only, no audio (see PROGRESS, pending decisions) | `analysis/key.py` |
| tools (local only) | GiantSteps Key / Tempo / MTG-Key audio and annotations (Knees et al. 2015, Faraldo et al. 2017, Schreiber v2) | — | audio is copyrighted: downloaded to git-ignored `datasets/`, never committed or bundled | `tools/fetch_datasets.py` |
