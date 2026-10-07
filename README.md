# traffclip

Watch, clip, and record live traffic cameras. Currently every live Louisiana 511 (LA DOTD) camera.

Open `index.html` in Chrome. No server, no install, no dependencies.

- **Click a camera** (or its play button): starts the live feed, about 15–25 s behind real time. The square in the corner ends it.
- **Clapperboard**: keeps the last N seconds (30 by default; change it in settings). A bound key shows inside the button.
- **Red dot**: records until you press the square.
- **Window icon** (corner, on hover): opens the camera in a small window you can drag and resize while you use the rest of the app. In its bar, the target icon finds the camera in the grid or on the map, and the expand icon (or a double-click on the bar) opens it large.
- **Expand icon** (corner, on hover): opens the camera large. Esc closes it.
- **All regions**: narrows the grid and the map to one region.
- **Clips** (top right): every clip and recording lands in this list. Save them all or one at a time.
- **Star** (next to a camera's name): marks a favorite. The star in the header shows only favorites; press it again to get back to the same spot in the full grid.
- **Live** (top right): lists every playing camera with a live thumbnail. Find, enlarge, pop out, or stop each one, or stop them all.
- **Grid / Map**: switches between the camera grid and a map of Louisiana. Click a dot to open that camera.
- **Scan**: opens a small menu to start a scan, watch its progress, and see the last scan's numbers. A scan checks the cameras on screen and lists the ones turned away from their usual view. Operators turn cameras toward crashes and work zones. Expect some false alarms, mostly at night. Results show when the scan ran and stay through a reload for 3 hours.
- **?**: help, in seven steps.
- **Settings**: clip length, merge overlapping clips, one camera at a time, remove clips after saving, scan every 10 minutes, and keys (including one for every playing camera).

Files save as `.mp4`.

## Refreshing the camera list

```
python3 tools/refresh.py
```

This finds live cameras on DOTD's stream servers, names and locates them, and saves a still of each to `images/`. It needs Python 3 and ffmpeg (the page itself needs neither).

Camera names come from `tools/names.json` first, then the state's open-data list. Locations come from the open-data list, then OpenStreetMap lookups cached in `tools/locations.json`.

`python3 tools/basemap.py` rebuilds the map outlines in `basemap.js` from US Census files.

`python3 tools/refresh.py --refs day` (run in daylight) and `--refs night` (after dark) save each camera's usual view for the scan. Run them when nothing unusual is happening.
