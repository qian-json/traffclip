# AGENTS.md

Start here. This file is the entry point for any agent or new maintainer; `docs.md` holds the full detail.

## Read first

1. `docs.md` — the handoff document: what the app is, the owner's working rules, constraints, code map, external facts, interface decisions, testing, open items. Read "Working with the owner" and "Constraints" before changing anything.
2. `README.md` — user-facing usage. Keep it in step with the interface.

## Non-negotiables

- Static files only. `index.html` opened from disk (`file://`) must work with no server, build, install, or third-party code. Classic scripts sharing globals; no ES modules in the page.
- Commit or push only when the owner asks. Commits carry only the owner's authorship: no co-author or generated-by trailers.
- Update `docs.md` (and `README.md` when usage changes) in the same change as the behavior. Facts removed from the screen go in docs.md under "Behavior the interface does not explain".
- The header never reflows. No instructional hints, onboarding banners, or disclaimers in the interface. Do not remove icons or clear affordances in the name of style.

## Run and test

- Run: open `index.html` in desktop Chrome.
- Smoke test (Node 22, Chrome, ffmpeg; uses the live DOTD streams): `node tools/test/cdp.mjs tools/test/smoke.mjs` from the repo root. New checks: copy `smoke.mjs` and drive the page through the globals listed in docs.md "Code map".
- Data refresh: `python3 tools/refresh.py` (cameras, names, locations, stills), `--refs day|night` (scan views), `python3 tools/basemap.py` (map outlines).

## Where things are

- Page: `index.html`, `style.css`, `app.js` (core), `mapview.js`, `popout.js`, `scan.js`, `live.js` / `demux.js` / `mp4.js` (video pipeline).
- Generated data, never edited by hand: `cameras.js`, `basemap.js`, `refs.js`, `images/`.
- Maintenance tooling (never loaded by the page): `tools/`.
