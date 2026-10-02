# traffclip maintainer notes

Reference for maintaining traffclip. It records constraints, external facts, and decisions that the code does not make obvious.

## Maintaining this document

- Tone: concise and formal. Use declarative statements. No filler, first person, or promotional language.
- One fact per line where possible. Prefer short lists to paragraphs.
- Record rationale, constraints, external facts, and decisions. Do not restate what the code already makes obvious.
- Date facts that can change (camera counts, stream behavior) in the form YYYY-MM-DD.
- Update this document in the same change as the behavior it describes. Replace statements that no longer hold; do not append corrections.

## Constraints

- The deliverable is static files only. Opening `index.html` from disk (`file://`) must work with no web server, build step, install, or third-party code.
- Everything under `tools/` is maintenance tooling that regenerates data files. The page never runs or requires it.
- Scripts are classic scripts sharing globals; ES modules fail under `file://`. Camera data is a script (`cameras.js`), not JSON fetched at runtime.
- Icons are Lucide path data (ISC license, lucide-static 1.49.0: maximize, minimize, picture-in-picture-2, play, square, merge, clapperboard, star) inlined in `app.js` as path strings (`ICONS`, `CONNECT_ICONS`, `POP_ICON`, `MERGE_ICON`, `CLIP_ICON`, `STAR_ICON`) and rendered by `icon()`. Text glyphs (×, ▾, ⌫, ●, +, −) are plain characters.
- Map outlines are baked into `basemap.js`; the map loads no tiles or remote data.
- Target: desktop Chrome. Requires Media Source Extensions with H.264 and Web Workers created from `blob:` URLs.

## Files

| File | Role |
| --- | --- |
| `index.html` | Markup: header with its popovers (tutorial, clip list, settings), grid, map layer, window layer, status bar. |
| `style.css` | All styling. |
| `app.js` | Grid, controls, clip list, favorites, settings, keybinds. |
| `mapview.js` | Map view: outlines, camera dots, pan and zoom. |
| `popout.js` | Floating camera windows. |
| `live.js` | `Tick` (worker timer), `Player` (MSE), `Live` (HLS polling and sample timeline). |
| `demux.js` | MPEG-TS demuxer and SPS parser. |
| `mp4.js` | MP4 writer for MSE fragments and saved files. |
| `cameras.js` | Generated camera list with coordinates where known. Do not edit by hand. |
| `basemap.js` | Generated map outlines. Do not edit by hand. |
| `images/` | Generated placeholder stills, one per camera id. |
| `tools/refresh.py` | Rebuilds `cameras.js` and `images/`. Needs Python 3 and ffmpeg. |
| `tools/names.json` | Camera names read from on-video captions. Overrides open-data names. |
| `tools/locations.json` | Location cache and manual corrections. |
| `tools/basemap.py` | Rebuilds `basemap.js` from US Census files. |
| `README.md` | User-facing usage. |
| `docs.md` | This document. |

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
- Outlines come from US Census files (public domain); some locations derive from OpenStreetMap (ODbL). The status bar shows both attributions in map view.
- 2026-09-29: 466 of 518 cameras located (349 open data, 10 siblings, 107 lookups). The other 52 have names without two roads (weather sites, bridge and mile-marker cameras) or roads OSM does not match.

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
- MSE receives one init segment per codec configuration and one fragment per HLS segment. Playback starts at the buffered end minus (1.3 × segment duration + 1 s), about 15 s behind the newest data. The tick jumps forward when playback falls more than 20 s behind that point, skips buffer gaps, and removes buffered media more than 30 s behind the playhead.
- A decode or MSE error rebuilds the `Player` and resumes at the next keyframe. More than three errors in 60 s are shown instead.
- An SPS or PPS change creates a new configuration at a keyframe. MSE receives a new init segment; saved files split at configuration boundaries.

## Clips and recordings

- Replay buffer length N is one setting for all cameras (default 30 s, range 5–3600 s).
- The buffer keeps samples from the keyframe at or before (on-screen time − N). Before playback starts, or while a hidden tab pauses video, only the cap (newest − N − 60 s) applies.
- A clip runs from that keyframe to the frame on screen, not to the newer media already fetched.
- A recording starts at the keyframe at or before the frame on screen and ends at the frame on screen when stopped. Disconnecting a camera stops and keeps its recording. The stopwatch shows wall-clock time.
- Every clip and recording is stored in `state.list`. `plan()` derives download entries on demand.
- With merge on, clips of one camera and one connection whose sample ranges overlap or touch form one entry. Samples are concatenated in order without duplicates. Turning merge off separates them again.
- Saved files are flat MP4 (`ftyp`, `mdat`, `moov`; one chunk; edit list for B-frame delay; `co64` when needed).
- File names: `<id>_<name-slug>_<YYYY-MM-DD_HH-MM-SS>_<clip|rec|clip-mergedN>.mp4`.
- Several files download 300 ms apart. Chrome asks once to allow multiple downloads.
- "Remove clips after saving" (default on) removes saved entries. When off, entries remain and are marked saved.
- Leaving the page warns only when unsaved clips exist or a recording is running.

## Interface decisions

- Styling is minimal and monochrome, using system colors (`Canvas`, `CanvasText`) for light and dark modes. Red marks recording and errors.
- Tiles are 3:2 with `object-fit: contain` on black.
- Placeholder stills are grayscale at 40% opacity so they are never mistaken for live video. They hide when the video fires `loadeddata`. Stills are grabbed with the stream's pixel aspect applied so they match the live picture.
- Hovering the footage shows three icons in its bottom-right corner, right to left: expand (large view), pop out (window), and play or stop (connect or disconnect). Clicking the footage itself does nothing. A spinner covers the footage from connecting until the first frame.
- Large view: the expand icon opens the tile inside the page (fixed, 24 px inset, dimmed backdrop; a spacer holds its grid slot) and connects it. The browser Fullscreen API is intentionally not used. It closes via ×, Esc, the collapse icon, or the backdrop.
- Windows: the pop-out icon (beside the expand icon) opens a camera in a floating, non-modal window and connects it. The bar drags it (120 px always stays on screen so it can be grabbed back); the corner resizes it (CSS `resize`). The bar has the name (with a red dot while recording), play or stop, clip, and ×; clicking the window's footage does nothing. Each window mirrors the tile's video into a canvas with `drawVideo()`, so a camera streams once; the mirror keeps updating while the tile is filtered out or under the map. Closing a window leaves the camera connected. One camera at a time never disconnects a windowed camera. Clips from a window float their badge from the window's clip button.
- Stacking (z-index): map 4, windows layer 6, header with its popovers and the status bar 7, large-view backdrop 9, large view 10, clip badges 20.
- Clip is the largest control in a tile. The per-tile key button and the settings keybind list share one state.
- The header is sticky and holds no changing text, so it never reflows. A fixed status bar at the bottom shows the camera count ("518 cameras · 2 connected", or "24 of 518 cameras" when filtered), short notices (saving, merges), and, in map view, the unplaced-camera count and attributions.
- The header's "N clips ▾" button opens the clip list; the tutorial button opens the tutorial (the only help text, so nothing is duplicated). Popovers are mutually exclusive; Esc and outside clicks close them.
- Tutorial copy follows the stop-slop rules: active voice, second person, no adverbs, no em dashes, one short step per item.
- There is no queue toggle; clips always go to the list.
- Favorites: a star before each camera name toggles it. The header star shows the count and filters to favorites in both views.
- Map: the header grid/map switch toggles a fixed layer under the header; the grid stays in the page underneath so the large view keeps working. The map projects cameras with the same equirectangular projection as `basemap.js` (origin 31°N, 91.5°W; 100 units per degree of latitude). Drag pans, the wheel and +/− zoom, fit frames the visible cameras, and picking a region fits to it. Dots keep a constant screen size through the `--u` CSS variable (map units per pixel). Favorites draw as stars; connected cameras are dark with a ring; recording cameras are red. Hovering shows the name and, for a connected camera, its live picture: a canvas copies each frame from the tile's own video, which keeps playing under the map. Other cameras show the grayed still. Clicking opens the large view. Clips taken while the map is showing pulse the dot instead of floating a badge. The status bar states how many cameras lack a location.
- Every clip floats a circular "clapperboard" badge up from the clip button. When the clip merged, a smaller separate badge on its corner shows the "merge" icon and the number of clips joined (2 on the first merge). The tile status then shows only the merged duration, and the status bar shows a short note.
- The float combines separate rise, sway, pop, and fade animations so each curve stays smooth. Reduced-motion settings get the fade only.
- Settings: replay buffer length; merge overlaps; one camera at a time (recording and windowed cameras stay connected); remove clips after saving; keybinds (`*` clips every connected camera; rows list favorites first, then connected cameras and any camera that has a key). The keybind hint shows keycaps (`esc` cancel, `⌫` clear) rather than a sentence.
- Keybinds ignore typing in text and number fields, not checkboxes.
- `localStorage` keys, prefixed `traffclip.`: `keys`, `replay`, `merge`, `solo`, `autoremove`, `favs`, `favonly`, `view`.

## Verification

- Test under `file://` in headless Chrome driven over the DevTools protocol, with `Browser.setDownloadBehavior` to capture downloads. Embedded preview panes may render `file://` pages as static snapshots.
- Check saved files with `ffprobe`, a full `ffmpeg -f null` decode, and an AVFoundation decode for QuickTime compatibility.
- Regression cases: `mnr-cam-001` (large keyframes), `br-cam-015` (non-square pixels), one camera per region, overlapping clips with merge on and off, and disconnecting while recording.

## Repository

- Commits carry only the owner's authorship, with no co-author or generated-by trailers.
- Remote: `origin` at https://github.com/qian-json/traffclip (branch `main`).
- `.gitignore`: `.DS_Store`, `__pycache__/`, `images/*.part.jpg`.
