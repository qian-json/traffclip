# traffclip

Watch, clip, and record live traffic cameras. Currently every live Louisiana 511 (LA DOTD) camera.

Open `index.html` in Chrome. No server, no install, no dependencies.

- **Click the footage**: connects or disconnects the camera (live, about 15–25 s behind real time).
- **Expand icon** (corner of the footage): opens the camera large. × or Esc closes it.
- **rec**: records until you press stop.
- **clip**: grabs the last N seconds (30 by default; change it in settings).
- **key**: a key that clips that camera. More keys are in settings.
- **N clips** (top right): every clip and recording lands in this list. Save them all or one at a time.
- **merge overlaps**: clips of one camera that overlap become one video.
- **tutorial** (or **?**): a short guide.
- **settings**: replay buffer length, "one camera at a time", "remove clips after saving", and keybinds (including one for every connected camera).

Files save as `.mp4`.

## Refreshing the camera list

```
python3 tools/refresh.py
```

This finds live cameras on DOTD's stream servers, names them, and saves a still of each to `images/`. It needs Python 3 and ffmpeg (the page itself needs neither).

Camera names come from `tools/names.json` first, then the state's open-data list.
