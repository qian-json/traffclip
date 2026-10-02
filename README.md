# traffclip

Watch, clip, and record live traffic cameras. Currently every live Louisiana 511 (LA DOTD) camera.

Open `index.html` in Chrome. No server, no install, no dependencies.

- **Play / stop icon** (bottom-right of the footage, on hover): connects or disconnects the camera (live, about 15–25 s behind real time).
- **Window icon** (next to it): opens the camera in a small window you can drag and resize while you use the rest of the app.
- **Expand icon** (corner): opens the camera large. × or Esc closes it.
- **rec**: records until you press stop.
- **clip**: grabs the last N seconds (30 by default; change it in settings).
- **key**: a key that clips that camera. More keys are in settings.
- **N clips** (top right): every clip and recording lands in this list. Save them all or one at a time.
- **Star** (next to a camera's name): marks a favorite. The star in the header shows only favorites.
- **grid / map**: switches between the camera grid and a map of Louisiana. Click a dot to open that camera.
- **tutorial**: a short guide.
- **settings**: replay buffer length, merge overlaps (overlapping clips of one camera become one video), "one camera at a time", "remove clips after saving", and keybinds (including one for every connected camera).

Files save as `.mp4`.

## Refreshing the camera list

```
python3 tools/refresh.py
```

This finds live cameras on DOTD's stream servers, names and locates them, and saves a still of each to `images/`. It needs Python 3 and ffmpeg (the page itself needs neither).

Camera names come from `tools/names.json` first, then the state's open-data list. Locations come from the open-data list, then OpenStreetMap lookups cached in `tools/locations.json`.

`python3 tools/basemap.py` rebuilds the map outlines in `basemap.js` from US Census files.
