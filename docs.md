# traffclip maintainer notes

Reference for maintaining traffclip. It records constraints, external facts, and decisions that the code does not make obvious.

## Maintaining this document

- Tone: concise and formal. Use declarative statements. No filler, first person, or promotional language.
- One fact per line where possible. Prefer short lists to paragraphs.
- Record rationale, constraints, external facts, and decisions. Do not restate what the code already makes obvious.
- Date facts that can change (camera counts, stream behavior) in the form YYYY-MM-DD.
- Update this document in the same change as the behavior it describes. Replace statements that no longer hold; do not append corrections.

## Constraints

- The page runs from `file://` with no server, install, or dependencies.
- Scripts are classic scripts sharing globals; ES modules fail under `file://`. Camera data is a script (`cameras.js`), not JSON fetched at runtime.
- No third-party runtime code. Icons are Lucide path data (ISC license, lucide-static 1.49.0: maximize, minimize, play, square, merge, clapperboard) inlined in `app.js`.
- Target: desktop Chrome. Requires Media Source Extensions with H.264 and Web Workers created from `blob:` URLs.

## Files

| File | Role |
| --- | --- |
| `index.html` | Markup: header, popovers (help, clip list, settings), grid container. |
| `style.css` | All styling. |
| `app.js` | Grid, controls, clip list, settings, keybinds. |
| `live.js` | `Tick` (worker timer), `Player` (MSE), `Live` (HLS polling and sample timeline). |
| `demux.js` | MPEG-TS demuxer and SPS parser. |
| `mp4.js` | MP4 writer for MSE fragments and saved files. |
| `cameras.js` | Generated camera list. Do not edit by hand. |
| `images/` | Generated placeholder stills, one per camera id. |
| `tools/refresh.py` | Rebuilds `cameras.js` and `images/`. Needs Python 3 and ffmpeg. |
| `tools/names.json` | Camera names read from on-video captions. Overrides open-data names. |
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
- Clicking the footage, or Enter on a focused tile, connects or disconnects the camera. There is no connect button. The tile's title states what a click will do.
- Hovering the footage shows a play icon (disconnected) or a stop icon (connected); hovering the expand icon hides it. A spinner covers the footage from connecting until the first frame.
- Large view: the expand icon (bottom right of the footage, shown on hover) opens the tile inside the page (fixed, 24 px inset, dimmed backdrop; a spacer holds its grid slot) and connects it. The browser Fullscreen API is intentionally not used. It closes via ×, Esc, the collapse icon, or the backdrop.
- Clip is the largest control in a tile. The per-tile key button and the settings keybind list share one state.
- The header is sticky. Its clip box shows "N clips ▾" (opens the list), the merge checkbox, and "?". Both "?" and the tutorial button open one tutorial, so no help text is duplicated. Popovers are mutually exclusive; Esc and outside clicks close them.
- Tutorial copy follows the stop-slop rules: active voice, second person, no adverbs, no em dashes, one short step per item.
- There is no queue toggle; clips always go to the list.
- Every clip floats a circular "clapperboard" badge up from the clip button. When the clip merged, a smaller separate badge on its corner shows the "merge" icon and the number of clips joined (2 on the first merge). The tile status then shows only the merged duration, and the header shows a short note.
- The float combines separate rise, sway, pop, and fade animations so each curve stays smooth. Reduced-motion settings get the fade only.
- Settings: replay buffer length; one camera at a time (recording cameras stay connected); remove clips after saving; keybinds (`*` clips every connected camera).
- Keybinds ignore typing in text and number fields, not checkboxes.
- `localStorage` keys, prefixed `traffclip.`: `keys`, `replay`, `merge`, `solo`, `autoremove`.

## Verification

- Test under `file://` in headless Chrome driven over the DevTools protocol, with `Browser.setDownloadBehavior` to capture downloads. Embedded preview panes may render `file://` pages as static snapshots.
- Check saved files with `ffprobe`, a full `ffmpeg -f null` decode, and an AVFoundation decode for QuickTime compatibility.
- Regression cases: `mnr-cam-001` (large keyframes), `br-cam-015` (non-square pixels), one camera per region, overlapping clips with merge on and off, and disconnecting while recording.

## Repository

- Commits carry only the owner's authorship, with no co-author or generated-by trailers.
- Remote: `origin` at https://github.com/qian-json/traffclip (branch `main`).
- `.gitignore`: `.DS_Store`, `__pycache__/`, `images/*.part.jpg`.
