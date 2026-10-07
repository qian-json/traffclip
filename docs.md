# traffclip maintainer notes

Handoff document for traffclip. A new maintainer, human or agent, should be able to read this file and the code and keep working productively. It records what the project is, how to run and test it, the owner's working rules, the architecture, external facts, and the decisions behind the interface.

## Maintaining this document

- Tone: concise and formal. Use declarative statements. No filler, first person, or promotional language.
- One fact per line where possible. Prefer short lists to paragraphs.
- Record rationale, constraints, external facts, decisions, and anything a newcomer would otherwise have to rediscover. Do not restate what the code already makes obvious.
- Facts the interface no longer spells out (removed hints, disclaimers) belong here; see "Behavior the interface does not explain".
- Date facts that can change (camera counts, stream behavior, owner decisions) in the form YYYY-MM-DD.
- Update this document in the same change as the behavior it describes. Replace statements that no longer hold; do not append corrections.

## At a glance

- A static web page that shows every live Louisiana DOTD (511LA) traffic camera, plays any of them live, and saves clips and recordings as MP4. The owner plans to add camera sources beyond 511LA (the project was renamed from "511la" on 2026-09-29 for that reason).
- Features: camera grid with search, region picker, and favorites filter; live playback through a custom HLS → MSE pipeline; replay-buffer clips (default 30 s) with per-camera keybinds; recordings; a clip list with optional merging of overlapping clips; a large in-page view; floating windows; a map view; a Live menu of playing cameras; an anomaly scan that flags cameras turned away from their usual view.
- Status 2026-10-07: 518 cameras; all features above work; dark-only interface after a redesign and two "look less AI-generated" passes.

## Quick start

- Run: open `index.html` in desktop Chrome. No server, build, or install.
- Regenerate data (needs Python 3 and ffmpeg; the page needs neither):
  - `python3 tools/refresh.py`: find live cameras, name and locate them, grab stills, write `cameras.js` and `images/`. Flags: `--new-only`, `--no-frames`, `--no-scan` (rename and relocate only), `--frames-only`.
  - `python3 tools/refresh.py --refs day` (in daylight) and `--refs night` (after dark): capture each camera's usual view into `refs.js`. `--refs-from-stills` seeds day views from `images/`.
  - `python3 tools/basemap.py`: rebuild `basemap.js` from US Census files.
- Test: see "Testing". There is no automated test suite in the repository; tests are headless-Chrome scripts written per change.

## Working with the owner

- The owner prefers Claude to own implementation and iterate quickly. Small UI requests arrive in bursts, often mid-task; fold them into the work in progress.
- Commit or push only when asked. Commits carry only the owner's authorship: no co-author or generated-by trailers, no AI-related files. Never create repositories or add collaborators.
- Deliverable constraints are absolute: static files, zero dependencies, works from `file://` (see "Constraints").
- Update this document and `README.md` in the same change as the behavior.
- Code comments: no comments that restate the code; keep comments that explain why, quirks, and licenses; section dividers are fine.
- Copy: short, plain, sentence case, one idea per line, no jargon. Follow the stop-slop rules (active voice, no adverbs, no em dashes). Tooltips and labels use sentence case.
- The header must never reflow: no text in it changes width unless the control has a fixed minimum width.
- Look: avoid generated-UI tells (instructional hints, onboarding banners, disclaimers, duplicated counts, uppercase letter-spaced or monospace labels, numbered-circle steps, pill tags, glassy blur, decorative animation the owner did not ask for). Do not "de-AI" by removing icons or clear affordances; the owner rejected that (2026-10-05).
- Cut redundant interface: if two elements say or do the same thing, remove one. Examples: the LIVE tag (removed, the moving picture says it), the favorites section (removed, the star filter does it), panel-title counts beside a badge (removed).
- Owner decisions to keep unless asked: the floating clapperboard badge on every clip (requested as "like a like on a livestream"); the big round play button; icons on Scan, Live, Clips, Grid, Map; count badges on Live and Clips; "Search 518 cameras" placeholder together with the heading count; dark-only theme.

## Constraints

- The deliverable is static files only. Opening `index.html` from disk (`file://`) must work with no web server, build step, install, or third-party code.
- Everything under `tools/` is maintenance tooling that regenerates data files. The page never runs or requires it.
- Scripts are classic scripts sharing globals; ES modules fail under `file://`. Camera data is a script (`cameras.js`), not JSON fetched at runtime.
- Icons are Lucide path data (ISC license, lucide-static 1.49.0: maximize, minimize, locate-fixed, play, square, merge, picture-in-picture-2, star, clapperboard, cctv, search, layout-grid, map, binoculars, circle-help, settings-2, download, x, chevron-down, plus, minus) inlined in `app.js` as the `ICON` map and rendered by `icon()`. Static markup names its icon with `data-icon="<key>"`; `app.js` fills those at load. Text glyphs (⌫, ●) are plain characters. New icons: copy path data from `https://unpkg.com/lucide-static@1.49.0/icons/<name>.svg`.
- Fonts are the system stack (San Francisco on macOS); no web fonts are loaded.
- Map outlines are baked into `basemap.js`; the map loads no tiles or remote data.
- Target: desktop Chrome. Requires Media Source Extensions with H.264, WebCodecs (scan), IndexedDB (scan memory), and Web Workers created from `blob:` URLs.

## Files

| File | Role |
| --- | --- |
| `index.html` | Markup: header (search, region picker, favorites filter, Grid/Map, Scan with its menu, Live, Clips, Help, Settings) with its popovers, grid heading, grid, map layer, window layer, toast, large-view backdrop. Script load order. |
| `style.css` | All styling. Tokens on `:root`. Sections: header, popovers, grid, large view, clip badge and toast, map, windows. |
| `app.js` | Core: icons, camera tiles, connect/disconnect, clips, recordings, clip list, filters, region picker, Live menu, settings, keybinds, popover system, toasts. |
| `mapview.js` | Map view: outlines, camera dots, pan and zoom, hover card, grid/map switch. |
| `popout.js` | Floating camera windows and "find this camera" (`jumpTo`). |
| `scan.js` | Anomaly scan: sampling, comparison, results, scan menu, IndexedDB memory and cache, auto-scan. |
| `live.js` | `Tick` (worker timer), `Player` (MSE), `Live` (HLS polling and sample timeline). |
| `demux.js` | MPEG-TS demuxer and SPS parser. |
| `mp4.js` | MP4 writer for MSE fragments, saved files, and the `avcC` record WebCodecs needs. |
| `cameras.js` | Generated camera list (`id`, `name`, `region`, `url`, `lat`/`lon` where known). Do not edit by hand. |
| `basemap.js` | Generated map outlines (`window.BASEMAP`). Do not edit by hand. |
| `refs.js` | Generated usual views for the scan (64×48 grayscale per camera, day and night, base64). Loaded on the first scan. About 4 MB. Do not edit by hand. |
| `images/` | Generated placeholder stills, one per camera id. |
| `tools/refresh.py` | Rebuilds `cameras.js`, `images/`, and `refs.js`. |
| `tools/names.json` | Camera names read from on-video captions. Overrides open-data names. |
| `tools/locations.json` | Location cache and manual corrections. |
| `tools/basemap.py` | Rebuilds `basemap.js` from US Census files. |
| `README.md` | User-facing usage. |
| `docs.md` | This document. |

## Code map

- Load order: `cameras.js`, `basemap.js`, `demux.js`, `mp4.js`, `live.js`, `app.js`, `mapview.js`, `popout.js`, `scan.js`. Later files use globals from earlier ones and register into shared structures (`POPS`, `STICKY`).
- `app.js` state:
  - `cams`: one object per camera, extending the `cameras.js` record with `i` (index), `el` (tile), `view`, `btn` (buttons by `data-a`), `st` (status text), `sw` (stopwatch), `kbd`, `secs`, `live` (a `Live` or null), `buf` (replay samples), `rec`, `win`, `odd`, `spacer`.
  - `state`: `merge`, `favOnly`, `oddOnly`, `list` (every clip and recording), `listening` (key slot awaiting a press), `max` (camera in the large view).
  - `keys` (camera id or `*` → `{combo, label}`), `favs` (Set of ids), `replaySecs`, `store` (`localStorage` wrapper).
- `app.js` key functions: `connect`, `disconnect`, `toggle`, `sync` (repaints a tile after state changes), `onSamples` (buffer trimming), `clip(c, from)`, `startRec`, `stopRec`, `output` (adds to the list, floats the badge, toasts), `plan` (derives saved files from `state.list`, merging), `filesOf`, `saveEntries`, `shows`/`filter`/`clearFilters`, `setRegion`, `updateHeads` (heading and Live badge), `renderLive`/`drawLive`, `openMax`/`closeMax`, `togglePop`/`closePops`, `listen`/`renderKeys`, `notify` (toast), `drawVideo` (letterboxed canvas mirror).
- Events: `camchange` on `document` after any camera, filter, or favorite change (the map repaints dots); `clipped` (detail: camera) after each clip or recording (the map pulses the dot).
- Popovers: `POPS` is a list of `[panel, button, render]`. `togglePop` opens one and closes the rest; `closePops` closes all and returns focus to the button. `STICKY` holds the camera panels that outside clicks on cameras do not close. `scan.js` adds the scan menu and results panel to both.
- `mapview.js`: `project` (equirectangular, same as `basemap.js`), `dots` (camera → SVG group), `paintDots`, `fit`, `zoomAt`, `focusDot` (center and pulse), `setView` (grid/map; persisted).
- `popout.js`: `popOut(c)` (one window per camera; mirrors the tile's video into a canvas each frame), `closeWin`, `jumpTo(c)` (show the camera in the current view).
- `scan.js`: constants at the top (thresholds, `SCAN_EVERY`, `SCAN_KEEP`), `scanState`, `scanDb` (IndexedDB), `sampleCamera`, `judge`, `runScan(quiet)`, `showResults`, `saveScan`/`restoreScan`, `renderScanMenu`, `renderOdd`.
- Rendering pattern: plain DOM. Static markup lives in `index.html`; repeated rows are built with template strings and `esc()` for text. No framework.

## Camera source

- The 511la.org API requires a registered developer key; its robots.txt disallows `/list/getdata/` and `/map/map*/`. Neither is used.
- Streams come from LA DOTD Wowza Streaming Engine 4.7.6 servers:
  - `ITSStreamingBR.dotd.la.gov`: br (Baton Rouge)
  - `ITSStreamingBR2.dotd.la.gov`: alx, laf, lkc, mnr, shr (Alexandria, Lafayette, Lake Charles, Monroe, Shreveport)
  - `ITSStreamingNO.dotd.la.gov`: hou, nor, ns (Houma, New Orleans, North Shore)
- URL form: `https://<host>/public/<prefix>-cam-NNN.streams/playlist.m3u8`.
- Servers send `Access-Control-Allow-Origin: *` and speak HTTP/1.1 only (Chrome allows six connections per host). Non-browser clients need a browser User-Agent.
- Numbering is sparse and partly route-based (`br-cam-8xx`: I-110; `lkc-cam-4xx`–`6xx`: I-10; `lkc-cam-8xx`: I-210; `ns-cam-528`: I-55). `refresh.py` probes 001–999 for every prefix: about 9,000 requests, about five minutes.
- Name precedence: `tools/names.json`, then the state open-data layer `DOTD_Traffic_Cameras` (ArcGIS; last updated 2020; 435 records, 62 without video), then `<Region> camera N`.
- Three captions are truncated on the video itself; those names end in "…".
- `refresh.py` exits without writing when no camera answers.
- Individual cameras go offline (HTTP 404) for hours; the tile then reads "offline (HTTP 404), retrying" and the loader keeps retrying.
- 2026-09-29: 518 live cameras; 169 names in `names.json`.

## Camera locations

- Precedence: entries in `tools/locations.json` with `"via": "manual"`, the open-data layer, cached lookups, a sibling camera with the same name apart from "Cam N", "DMS", or a direction, then an OpenStreetMap lookup.
- The lookup parses "<road> at <road>" names (also "@", "/", "before", "<direction> of") and converts route names to OSM refs (`I 10`, `US 190`, `LA 415`). Street types select the exact OSM name first ("Lake St" → "Lake Street"), then a looser match.
- Downloads are one Overpass query per route per region: the route inside the region box (its open-data cameras plus 0.3°) and every road or waterway within 400 m that matches one of that route's cross-road filters, plus one query for town names. Matching runs locally: points sampled every 30 m along the cross road within 120 m, then 400 m, of the route form clusters.
- Two roads can cross more than once; the largest cluster wins. Choosing by the nearest-numbered cameras instead tested no better (camera numbers are not reliably geographic).
- Accuracy, measured 2026-09-29 by locating 60 cameras whose positions the open-data layer gives: 54 found, median error 90 m, 46 within 0.5 km. Three landed at the wrong crossing of the right road (10–70 km off), for example where a road changes name ("Airline Highway" is "Airline Drive" in Kenner). Expect a few such pins among the looked-up cameras; fix them with manual entries.
- A cross road that is a town falls back to the point on the route nearest that town (within 8 km). Results outside the region box are discarded.
- `locations.json` caches hits and misses keyed by camera name; a rename triggers a new lookup. Server errors are not cached, so failed lookups retry on the next run. To correct a location, set `lat`, `lon`, and `"via": "manual"`.
- Public Overpass servers are often overloaded (HTTP 504). `overpass()` rotates through three servers with backoff. Setting `TRAFFCLIP_OVERPASS_CACHE` to a folder keeps responses so an interrupted run resumes.
- Outlines come from US Census files (public domain); some locations derive from OpenStreetMap (ODbL). The map shows both attributions at its bottom right; they are required and stay.
- 2026-09-29: 466 of 518 cameras located (349 open data, 10 siblings, 107 lookups). The other 52 have names without two roads (weather sites, bridge and mile-marker cameras) or roads OSM does not match. The map legend ends with "52 not on the map".

## Stream characteristics (2026-09-29)

- H.264 video (Baseline, Main, High) plus a timed ID3 stream. No audio.
- Mostly 352×240; mnr 720×480; nor 320×240. Some signal non-square pixels (br 40:33, displayed 16:9; ns 10:11).
- Segments about 10.7 s, three per playlist. Keyframes every 2–5 s. 11–15 fps.
- Wowza splits access units larger than about 64 KB across several PES packets that repeat the PTS/DTS; continuation payloads start mid-NAL. The demuxer joins payloads with equal timestamps before splitting NAL units.
- Chunklist names carry a Wowza session id. After a request error the loader re-fetches the master playlist.

## Playback pipeline

- `Live` polls the chunklist every 2 s using `Tick`, which runs in a worker because Chrome throttles timers in background tabs.
- The first poll fetches every listed segment, so the replay buffer starts with about 30 s.
- Samples carry AVCC data, 90 kHz `dts` and `cto`, and a duration known once the next frame arrives (one frame is held back).
- Timeline: `dts` is rebased to 0 per connection. A step of ≤0 or >3 s (lost segment, encoder restart, 33-bit wrap) is closed using the previous frame duration. Sample number `n` increases monotonically per connection.
- MSE receives one init segment per codec configuration and one fragment per HLS segment. Playback starts at the buffered end minus (1.3 × segment duration + 1 s), about 15 s behind the newest data, so video runs about 15–25 s behind real time. The tick jumps forward when playback falls more than 20 s behind that point, skips buffer gaps, and removes buffered media more than 30 s behind the playhead.
- A decode or MSE error rebuilds the `Player` and resumes at the next keyframe. More than three errors in 60 s are shown instead.
- An SPS or PPS change creates a new configuration at a keyframe. MSE receives a new init segment; saved files split at configuration boundaries.
- The placeholder still hides on the video's `playing` event, not `loadeddata`: the first decoded frame sits still until the player jumps to the live edge.
- A camera streams once. Windows, the map hover card, and Live menu thumbnails copy frames from the tile's own `<video>` with `drawVideo()`.

## Clips and recordings

- Replay buffer length N ("Clip length" in settings) is how far back a clip reaches. One setting for all cameras (default 30 s, range 5–3600 s).
- The buffer keeps samples from the keyframe at or before (on-screen time − N). Before playback starts, or while a hidden tab pauses video, only the cap (newest − N − 60 s) applies.
- A clip runs from that keyframe to the frame on screen, not to the newer media already fetched.
- A recording starts at the keyframe at or before the frame on screen and ends at the frame on screen when stopped. Disconnecting a camera stops and keeps its recording. The stopwatch shows wall-clock time.
- Every clip and recording is stored in `state.list`. `plan()` derives download entries on demand.
- Merge overlapping clips (setting, off by default): clips of one camera and one connection whose sample ranges overlap or touch form one entry and one file. Samples are concatenated in order without duplicates. Turning merge off separates them again.
- Saved files are flat MP4 (`ftyp`, `mdat`, `moov`; one chunk; edit list for B-frame delay; `co64` when needed).
- File names: `<id>_<name-slug>_<YYYY-MM-DD_HH-MM-SS>_<clip|rec|clip-mergedN>.mp4`.
- Several files download 300 ms apart. Chrome asks once to allow multiple downloads.
- "Remove clips after saving" (default on) removes saved entries. When off, entries remain and are marked saved.
- Leaving the page warns only when unsaved clips exist or a recording is running.
- Feedback per clip: the floating clapperboard badge (from the button that clipped; a key press on a windowed camera floats it from the window). A merge adds a toast "Merged N clips · length". A plain clip has no toast (owner's call, 2026-10-07); recordings, saves, and errors do.

## Anomaly scan

- Goal (set by the owner): show cameras worth a look, such as crashes, chases, and work zones. At least 20% of flagged cameras should be real; false alarms are acceptable.
- Signal: operators aim and zoom cameras at incidents, so a camera that is off its usual view is the cue. The scan does not recognize incidents inside a camera's usual view; that needs a vision model a static page cannot carry.
- Per camera: download the newest segment (about 300 KB), decode its keyframes (2–5) with WebCodecs, take the per-pixel median at 64×48 grayscale (passing headlights drop out), and compare with the usual view.
- Comparison: edge directions with doubled angles (contrast polarity does not matter), weighted by contrast-normalized strength, ignoring pixels at or above 215 and their 1 px halo, and the top 11 rows (burned-in caption and clock). The best correlation over ±4 px shifts is the similarity.
- A camera is flagged when its similarity to every usual view for the current light is below 0.25. Usual views: `refs.js` (day or night by sun elevation at the camera; both within ±3° of the horizon) plus views marked usual in the results ("Mark usual"). "Moved since last scan" means similarity below 0.2 to the previous scan of the same light within 3 hours.
- Frames with little clear structure (under 10% of pixels with an edge above 16 gray levels outside glare) count as "too dark to judge" and are not flagged.
- A scan covers the cameras the search, region, and favorites filters show. "Only these" filters the grid and map to flagged cameras but does not narrow the next scan.
- False alarms: about three in four flags at night are false (glare, rain, dirty lenses, fog). The interface no longer says so; the results list sorts the least similar first, which puts real moves near the top.
- Interface: the Scan button (binoculars icon, amber when anything is flagged) reads "Scan", "Scanning N%", or "N unusual" and opens the scan menu: last scan time and age, progress bar with "N% · done of total", the last scan's numbers, what a scan covers ("Checks the N cameras on screen, about M MB" at 0.3 MB per camera), Start scan / Stop / Scan again, and "View N unusual". A user-started scan that flags anything opens the results panel when it finishes. Results rows show a thumbnail, "region · reason · N% match", and Open, Window, and Mark usual. Flagged tiles get an amber ring and an UNUSUAL tag (while not playing); map dots an amber ring. "Rescan" in the results opens the menu and starts a scan; during an auto-scan it lets that scan finish and report back.
- Measurements, 2026-10-03 at night (510 cameras online):
  - Night frames against daytime stills: median similarity 0.20, no better than unrelated cameras (99th percentile 0.22). Comparisons therefore use views captured in the same light.
  - Same camera minutes apart, single keyframe: median 0.61; 12% fall below 0.30. Median of a segment's keyframes: median 0.68; 5.5% below 0.30, 3.3% below 0.25. Masking more glare did not help.
  - Synthetic moves at threshold 0.30: a 25% pan is caught 89% of the time, a 1.6× zoom 97%, a 2.5× zoom 100%.
  - Live scans scored by eye: 7 of 27 flags real at 20:40 (26%); 13 of 51 at 21:00 (25%), including four scenes with emergency lights; 10 of the first 16 rows real.
- Cost: a full scan downloads about 150 MB and takes about 80 s (four requests at a time per stream server). Auto-scan (settings, off by default) repeats every 10 minutes.
- Usual views in `refs.js` come from `refresh.py --refs day|night` (median of one segment's keyframes per camera) and `--refs-from-stills` (day only, one frame). Capture them when nothing unusual is happening; a camera that was off its usual view at capture time is flagged once it returns, until someone presses "Mark usual" on it. As of 2026-10-03 the night views are from 20:25 that evening and the day views are the 2026-09-29 stills.
- Browser storage: IndexedDB database `traffclip`, version 2, with stores `last` (previous scan per camera), `usual` (views marked usual, up to 6 per camera), and `scan` (the latest results, key `latest`, with JPEG thumbnails). Version 1 lacked `scan`; the upgrade keeps existing data. A tab still on version 1 blocks the upgrade; the scan then runs without storage until reload.
- Cache: a completed scan, and each "Mark usual", rewrites `scan`. A page load restores results under 3 hours old (`SCAN_KEEP`), so a reload costs no download (owner confirmed this is enough, 2026-10-07). Auto-scan times its 10 minutes from the restored scan. Older results are ignored and the button reads "Scan". A scan interrupted by a reload saves nothing; the previous results stay.

## Interface

- Look (redesigned 2026-10-04 from a Claude Design mockup, since deleted, then toned down 2026-10-05 and 2026-10-07): dark only, neutral graphite (`--bg` #0F0F0F, no blue tint), small radii (2 px pictures and tags, 4 px controls, 6 px panels), no backdrop blur, light shadows. Color is reserved for state: red for recording and errors, amber for unusual. Monospace marks data: the wordmark, counts, times, keys, and tags. Primary actions (Clip, Save all) are light buttons on the dark ground. Tokens live on `:root` in `style.css`.
- Header (sticky; never reflows): left: wordmark, search ("Search 518 cameras"), region picker, favorites filter (star), Grid/Map switch with icons. Right: Scan (binoculars), Live (CCTV icon, count badge), Clips (clapperboard, count badge), Help (?), Settings. Region, Scan, Live, and Clips have fixed minimum widths; Live and Clips stay visible at zero.
- Grid heading: "All cameras" (or "Favorites" while the star filter is on, "No cameras match" when nothing shows) with the shown count. Tiles stay in camera order; there is no separate favorites section.
- Tiles are 3:2 with `object-fit: contain` on black, so the whole camera picture shows. Idle tiles show the still in grayscale at 55% brightness, plus name, region, and star; Rec and Clip appear only while a camera plays.
- Hovering a tile brightens the still and shows a round play button (idle only) and corner icons: stop (while playing), window, expand. Clicking anywhere on an idle picture connects it; clicking a playing picture does nothing, so stopping takes the corner square. A spinner covers the footage until the first frame. Overlays carry `z-index: 1` because the `<video>` is appended after them.
- Tags at the bottom left of the picture: REC with the stopwatch, UNUSUAL. There is no LIVE tag. The burned-in DOTD caption occupies the top left, so tags stay off it.
- Connection trouble ("connecting", "reconnecting", "offline") follows the region under the name.
- Playing tiles show two icon buttons: record (red dot; a red square while recording) and clip (clapperboard, with its bound key as a keycap). No text labels.
- Large view: the expand icon opens the tile inside the page (fixed, 24 px inset, dim backdrop; a spacer holds its grid slot) and connects it. CSS grid re-lays the same tile: star, name, region, and close on top; the picture with its corner icons; record and "Last N s" clip at the bottom. The browser Fullscreen API is intentionally not used. A filtered-out camera can still open large (`.cell.max[hidden]` overrides the global hidden rule).
- Windows: the window icon opens a floating, non-modal window and connects the camera. The bar drags it (120 px always stays on screen); the corner resizes it (CSS `resize`). Bar: name (red dot while recording), find, large view (also double-click on the bar), play or stop, clip, close. Find shows the camera in the current view: on the map it centers and pulses the dot (zooming to about 60 km across); in the grid, or without a location, it scrolls to the tile and outlines it. Filters hiding it are cleared first ("Filters cleared" toast). Closing a window leaves the camera connected; "One camera at a time" never disconnects a windowed camera.
- Live menu (header Live button): one row per playing camera with a live thumbnail, region, recording time, and connection trouble, plus find, large view, window, and stop; "Stop all". Empty: "Nothing is playing."
- Clips panel: rows show the camera's still, "Clip", "Recording", or "N clips merged", length, time, "saved" when kept after saving, and save and remove icons. Save all; Clear needs a second click within 3 s.
- Settings: clip length; merge overlapping clips; one camera at a time ("Recording and windowed cameras stay on."); remove clips after saving; scan every 10 minutes ("About 150 MB per scan."); keys (`*` = every playing camera; rows list favorites first, then playing cameras and any camera with a key) with the keycap hint `esc` cancel, `⌫` clear.
- Help (?): seven numbered steps; the only guide in the interface.
- Region picker: a button holding the value ("" for all) plus a listbox with camera counts. ArrowDown opens it; arrows, Home, End, and type-ahead move; Enter or click picks; key presses inside do not reach clip keybinds. Picking dispatches `change` on the button; the map fits the region.
- Map: a fixed layer under the header; the grid stays underneath so the large view and scroll position survive. Drag pans, the wheel and +/− zoom, the target button fits the visible cameras. Dots keep a constant screen size through the `--u` CSS variable. Gray dots idle, stars favorites, white with a ring playing, red recording, amber ring unusual; a legend explains them. Hovering shows the name, region, and for a playing camera its live picture. Clips taken while the map shows pulse the dot instead of floating a badge. City labels are normal-case sans.
- Popovers are mutually exclusive and their buttons carry `aria-expanded`. Esc closes the large view first, then popovers. Outside clicks close popovers, except the camera panels (scan menu, scan results, Live, Clips) stay open while you click tiles, windows, map dots, or the large view, and their own window, open, and find buttons leave them open (owner's request, 2026-10-05). Empty space closes them.
- Favorites: turning the filter on scrolls to the top; turning it off returns to where the full grid was scrolled.
- Toasts: bottom center, 2.5 s, plain text. There is no status bar.
- Stacking (z-index): map 4, windows layer 6, header and popovers 7, large-view backdrop 9, large view 10, clip badges 20, toast 21.
- `[hidden]` is forced to `display: none !important` once, globally, because component rules set `display` on buttons and panels.
- Tooltips are sentence case and short; icon-only buttons always have a tooltip and `aria-label`.
- The clip badge combines separate rise, sway, pop, and fade animations; reduced-motion settings get the fade only. A merge adds a small badge with the merge icon and the number of clips joined (2 on the first merge).

## Behavior the interface does not explain

These facts were removed from the screen on purpose (hints and disclaimers read as filler). Keep them true and documented.

- Video runs about 15–25 s behind real time (Help says "about 20 seconds").
- Clicking a map dot opens that camera's large view.
- Esc leaves the large view; the close and collapse buttons do too.
- Clip length is how far back a clip reaches.
- Merge joins clips of one camera from one connection that overlap or touch into one video.
- Keys: click a key slot in Settings, then press the new key; Esc cancels, Backspace or Delete clears. Keybinds ignore typing in text and number fields.
- Scans flag many false alarms at night (see "Anomaly scan").
- First visits get no onboarding banner (removed 2026-10-07); Help is the guide.

## Storage

- `localStorage` keys, prefixed `traffclip.`: `keys`, `replay`, `merge`, `solo`, `autoremove`, `favs`, `favonly`, `view`, `autoscan`. Older builds also wrote `welcomed`; it is unused.
- IndexedDB `traffclip` (scan memory and cache); see "Anomaly scan".

## Testing

- Test under `file://` in headless Chrome driven over the DevTools protocol. Node 22 has a global `WebSocket`, so a small driver script needs no packages. Keep test scripts outside the repository (the deliverable has no test files).
- Driver outline: launch Chrome with `--headless=new --remote-debugging-port=<port> --user-data-dir=<scratch profile> --autoplay-policy=no-user-gesture-required`; `Target.createTarget`, `Target.attachToTarget` (flatten); `Page.navigate` to the `file://` URL; drive with `Runtime.evaluate` (`awaitPromise`, `returnByValue`), `Input.dispatchMouseEvent`, and `Input.dispatchKeyEvent`; capture with `Page.captureScreenshot`; collect downloads with `Browser.setDownloadBehavior`.
- All top-level names are globals, so tests can call `connect(cams[0])`, `openMax`, `popOut`, `runScan`, `setRegion`, `filter`, and read `state`, `scanState`, `cams[i].el`.
- Gotchas:
  - Use a dedicated remote-debugging port and refuse to start if it is taken; another browser on the same port silently receives the commands.
  - A key press that should activate a focused button (Enter) needs `type: 'keyDown'` with `text: '\r'`; `rawKeyDown` alone does not click.
  - `Page.captureScreenshot` clip coordinates are page coordinates; add `scrollY`.
  - A floating window covers part of the grid; clicks aimed at a tile under it hit the window.
  - Tests hit the live DOTD servers. Wait for `cams[i].view.classList.contains('live')` before clipping. A region scan of Alexandria (17 cameras) is a quick real scan.
  - Embedded preview panes may render `file://` pages as static snapshots; use real headless Chrome.
- Check saved files with `ffprobe`, a full `ffmpeg -f null` decode, and an AVFoundation decode for QuickTime compatibility.
- Regression cases: `mnr-cam-001` (large keyframes), `br-cam-015` (non-square pixels), one camera per region, overlapping clips with merge on and off, disconnecting while recording, the scan cache across a reload, popovers staying open during camera clicks, and the header not shifting when badges change.

## Known issues and open items

- Day usual views are the 2026-09-29 stills (single frames); run `refresh.py --refs day` in daylight for better day scans.
- Alexandria night views look unreliable: a 2026-10-03 23:47 scan flagged 11 of 17 cameras at 1–11% similarity. Recapture with `--refs night`.
- Map city labels can overlap camera dots.
- At phone width the header wraps to about a third of the screen.
- De-AI audit of 2026-10-07: applied the map labels, hints, onboarding line, panel-title counts, the Live panel title (was "Playing"), empty states, scan disclaimer, tooltip casing, settings hints, large-view Esc hint, keys hint, plain-clip toast, map note, and scan icon. Still awaiting the owner's decision: monospace wordmark; Help's numbered bold-lead steps; "·" separators (16 in the interface); UNUSUAL tag; scan-menu stats grid; the unusual count shown four times; "N% match"; "Camera" legend entry; the clip badge's sway and drift; 3D keycaps; REC tag styling; dark-only theme; Lucide everywhere; white primary buttons. Kept by choice: count badges, the round play button, the floating clip badge.

## Repository

- Commits carry only the owner's authorship, with no co-author or generated-by trailers.
- Remote: `origin` at https://github.com/qian-json/traffclip (branch `main`).
- `.gitignore`: `.DS_Store`, `__pycache__/`, `images/*.part.jpg`.
