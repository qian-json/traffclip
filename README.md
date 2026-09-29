# traffclip

Watch, clip, and record live traffic cameras. Currently every live Louisiana 511 (LA DOTD) camera.

Open `index.html` in Chrome. No server, no install, no dependencies.

- **connect**: plays the camera live (about 15–25 s behind real time).
- **Click the footage**: opens the camera large. × or Esc closes it.
- **rec**: records until you press stop.
- **clip**: saves the last N seconds (the box next to it, 30 by default).
- **key**: a key that clips that camera. More keys are in settings.
- **queue**: holds downloads until you press it again, then saves them all.
- **merge overlaps**: queued clips of one camera that overlap become one video.
- **settings**: keybinds (including one for every connected camera) and "one camera at a time".

Files save as `.mp4`.

## Refreshing the camera list

```
python3 tools/refresh.py
```

This finds live cameras on DOTD's stream servers, names them, and saves a still of each to `images/`. It needs Python 3 and ffmpeg (the page itself needs neither).

Camera names come from `tools/names.json` first, then the state's open-data list.
