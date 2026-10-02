#!/usr/bin/env python3
"""Build basemap.js: Louisiana outline, parishes, and major highways as SVG paths.

Sources are US Census cartographic boundary and TIGER/Line files (public
domain). Coordinates are projected with the same equirectangular projection
the page uses for cameras (see PROJ below).

  python3 tools/basemap.py
"""
import io
import json
import math
import os
import struct
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CENSUS = "https://www2.census.gov/geo/tiger/"
STATE = CENSUS + "GENZ2023/shp/cb_2023_us_state_5m.zip"
COUNTY = CENSUS + "GENZ2023/shp/cb_2023_us_county_5m.zip"
ROADS = CENSUS + "TIGER2023/PRISECROADS/tl_2023_22_prisecroads.zip"
LA = "22"

# x = (lon - lon0) * cos(lat0) * k, y = (lat0 - lat) * k; one unit is 0.01 degree of latitude
PROJ = {"lon0": -91.5, "lat0": 31.0, "k": 100}
COS = math.cos(math.radians(PROJ["lat0"]))
TOLERANCE = 0.06


def fetch_zip(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "traffclip-basemap"}), timeout=120) as r:
        return zipfile.ZipFile(io.BytesIO(r.read()))


def read_dbf(data):
    count, header_len, rec_len = struct.unpack("<IHH", data[4:12])
    fields, o = [], 32
    while data[o] != 0x0D:
        name = data[o:o + 11].split(b"\0")[0].decode()
        fields.append((name, data[o + 16]))
        o += 32
    rows = []
    for i in range(count):
        rec, pos, row = data[header_len + i * rec_len:header_len + (i + 1) * rec_len], 1, {}
        for name, size in fields:
            row[name] = rec[pos:pos + size].decode("utf8", "replace").strip()
            pos += size
        rows.append(row)
    return rows


def read_shp(data):
    shapes, o = [], 100
    while o < len(data):
        length = struct.unpack(">i", data[o + 4:o + 8])[0] * 2
        rec = data[o + 8:o + 8 + length]
        o += 8 + length
        if struct.unpack("<i", rec[:4])[0] == 0:
            shapes.append([])
            continue
        parts, points = struct.unpack("<ii", rec[36:44])
        starts = list(struct.unpack(f"<{parts}i", rec[44:44 + 4 * parts])) + [points]
        xy = struct.unpack(f"<{2 * points}d", rec[44 + 4 * parts:44 + 4 * parts + 16 * points])
        pts = list(zip(xy[0::2], xy[1::2]))
        shapes.append([pts[starts[i]:starts[i + 1]] for i in range(parts)])
    return shapes


def layer(zf):
    base = next(n for n in zf.namelist() if n.endswith(".shp"))[:-4]
    return read_dbf(zf.read(base + ".dbf")), read_shp(zf.read(base + ".shp"))


def project(lon, lat):
    return ((lon - PROJ["lon0"]) * COS * PROJ["k"], (PROJ["lat0"] - lat) * PROJ["k"])


def simplify(pts, tol):
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = pts[a], pts[b]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy) or 1e-12
        best, idx = -1, None
        for i in range(a + 1, b):
            d = abs(dy * (pts[i][0] - ax) - dx * (pts[i][1] - ay)) / norm
            if d > best:
                best, idx = d, i
        if idx is not None and best > tol:
            keep[idx] = True
            stack += [(a, idx), (idx, b)]
    return [p for p, k in zip(pts, keep) if k]


def simplify_ring(pts, tol):
    # a closed ring starts and ends on one point, so split it at the vertex farthest from the start
    far = max(range(len(pts)), key=lambda i: math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]))
    return simplify(pts[:far + 1], tol)[:-1] + simplify(pts[far:], tol)


def path(rings, closed):
    out = []
    for ring in rings:
        pts = [project(*p) for p in ring]
        pts = simplify_ring(pts, TOLERANCE) if closed else simplify(pts, TOLERANCE)
        if closed and len(pts) < 4:
            continue
        if len(pts) < 2:
            continue
        r = [(round(x, 2), round(y, 2)) for x, y in pts]
        seg = [f"M{r[0][0]:g} {r[0][1]:g}"]
        seg += [f"l{round(x - px, 2):g} {round(y - py, 2):g}" for (px, py), (x, y) in zip(r, r[1:])]
        out.append("".join(seg) + ("z" if closed else ""))
    return "".join(out)


def main():
    rows, shapes = layer(fetch_zip(STATE))
    state = [s for r, s in zip(rows, shapes) if r["STATEFP"] == LA][0]
    rows, shapes = layer(fetch_zip(COUNTY))
    parishes = [ring for r, s in zip(rows, shapes) if r["STATEFP"] == LA for ring in s]
    rows, shapes = layer(fetch_zip(ROADS))
    interstates = [line for r, s in zip(rows, shapes) if r["RTTYP"] == "I" for line in s]
    highways = [line for r, s in zip(rows, shapes) if r["RTTYP"] == "U" for line in s]

    xs, ys = zip(*[project(*p) for ring in state for p in ring])
    pad = 8
    view = [round(min(xs) - pad), round(min(ys) - pad), round(max(xs) - min(xs) + 2 * pad), round(max(ys) - min(ys) + 2 * pad)]
    data = {**PROJ, "view": view, "state": path(state, True), "parishes": path(parishes, True),
            "interstates": path(interstates, False), "highways": path(highways, False)}
    with open(os.path.join(ROOT, "basemap.js"), "w") as f:
        f.write("// Generated by tools/basemap.py from US Census boundary and TIGER/Line files (public domain).\n")
        f.write(f"window.BASEMAP = {json.dumps(data, separators=(',', ':'))};\n")
    print("basemap.js", os.path.getsize(os.path.join(ROOT, "basemap.js")) // 1024, "KB;",
          {k: len(v) // 1024 for k, v in data.items() if isinstance(v, str)})


if __name__ == "__main__":
    main()
