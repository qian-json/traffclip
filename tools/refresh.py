#!/usr/bin/env python3
"""Rebuild cameras.js and images/ for traffclip from Louisiana 511 (LA DOTD).

Finds live cameras by probing LA DOTD's public HLS servers, names them from
tools/names.json (read off the on-video captions) or the state's open-data
camera list, locates them (see locate()), and saves one frame per camera to
images/<id>.jpg.

Needs Python 3 and ffmpeg (only for the frames). The page itself needs neither.

  python3 tools/refresh.py              scan, name, locate, grab every frame
  python3 tools/refresh.py --new-only   same, but only grab frames that are missing
  python3 tools/refresh.py --no-frames  scan, name, and locate only
  python3 tools/refresh.py --no-scan    rename and relocate the cameras already in cameras.js
  python3 tools/refresh.py --frames-only
  python3 tools/refresh.py --refs day|night    capture each camera's usual view for the scanner
  python3 tools/refresh.py --refs-from-stills  seed the day views from images/ (until a daytime capture)

Run --refs during the day and again at night, ideally when nothing unusual is
happening. The scanner compares live frames against these views.
"""
import base64
import concurrent.futures as cf
import datetime
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/140.0 Safari/537.36")
OPEN_DATA = ("https://services1.arcgis.com/fXHQyq63u0UsTeSM/arcgis/rest/services/"
             "DOTD_Traffic_Cameras/FeatureServer/0/query?where=1%3D1&outFields=Name,VideoUrl,Latitude,Longitude&f=json")
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter",
            "https://overpass.private.coffee/api/interpreter"]
LOCATIONS = os.path.join(ROOT, "tools", "locations.json")

# Camera ids are <prefix>-cam-NNN and numbering is sparse (lkc-cam-897 is I-210
# at Broad St, br-cam-8xx are I-110, ns-cam-528 is I-55), so every
# region gets the whole 001-999 range probed.
REGIONS = {
    "br":  ("Baton Rouge",  "ITSStreamingBR.dotd.la.gov"),
    "nor": ("New Orleans",  "ITSStreamingNO.dotd.la.gov"),
    "ns":  ("North Shore",  "ITSStreamingNO.dotd.la.gov"),
    "hou": ("Houma",        "ITSStreamingNO.dotd.la.gov"),
    "laf": ("Lafayette",    "ITSStreamingBR2.dotd.la.gov"),
    "lkc": ("Lake Charles", "ITSStreamingBR2.dotd.la.gov"),
    "shr": ("Shreveport",   "ITSStreamingBR2.dotd.la.gov"),
    "mnr": ("Monroe",       "ITSStreamingBR2.dotd.la.gov"),
    "alx": ("Alexandria",   "ITSStreamingBR2.dotd.la.gov"),
}


def get(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def stream_url(prefix, n):
    return f"https://{REGIONS[prefix][1]}/public/{prefix}-cam-{n:03d}.streams/playlist.m3u8"


def is_live(url):
    try:
        return b"#EXTM3U" in get(url)[:200]
    except Exception:
        return False


def scan():
    found = []
    nums = range(1, 1000)
    with cf.ThreadPoolExecutor(16) as ex:
        for prefix in REGIONS:
            hits = [n for n, ok in zip(nums, ex.map(lambda n: is_live(stream_url(prefix, n)), nums)) if ok]
            print(f"  {prefix}: {len(hits)}", flush=True)
            found += [(prefix, n) for n in hits]
    return found


def open_data():
    """Camera id -> {name, lat, lon} from the state's 2020 open-data layer."""
    try:
        feats = json.loads(get(OPEN_DATA, 30))["features"]
    except Exception as e:
        print("  open data unavailable:", e)
        return {}
    out = {}
    for f in feats:
        a = f["attributes"]
        m = re.search(r"/public/([a-z]+-cam-\d+)\.streams", a.get("VideoUrl") or "")
        if m:
            out[m[1]] = {"name": (a.get("Name") or "").strip(), "lat": a.get("Latitude"), "lon": a.get("Longitude")}
    return out


# Precedence: manual entries in tools/locations.json, the open-data layer,
# cached results, a same-place sibling camera, then an OpenStreetMap lookup of
# the two roads (or road and town) in the camera name. Misses are cached too,
# keyed by name, so a rename triggers a new lookup.

ROUTE = re.compile(r"^(I|US|LA|Hwy)[- ]?(\d+)([A-Z]?)(?![\w])", re.I)
SEP = re.compile(r"\s+(?:at|@|before|after|(?:north|south|east|west|[nsew])\s+of)\s+|\s*@\s*|/", re.I)
NOISE = re.compile(r"\b(?:cam(?:era)?\s*\d+|cctv\s*\d+|dms|[nsew]b|loop|hov|ramp meter [lr]b|off ramp|split \d+|"
                   r"top of bridge|mm [\d.]+|overpass|crossover|weigh scales|tower|side)\b|#\d+|[()…]", re.I)
DROP = {"st", "street", "ave", "avenue", "rd", "road", "blvd", "boulevard", "dr", "drive", "pkwy", "parkway",
        "ln", "lane", "hwy", "highway", "circle", "n", "s", "e", "w", "ne", "nw", "se", "sw", "north", "south",
        "east", "west", "at", "of", "the"}
TYPES = {"st": "Street|St", "street": "Street|St", "ave": "Avenue|Ave", "avenue": "Avenue|Ave", "rd": "Road|Rd",
         "road": "Road|Rd", "blvd": "Boulevard|Blvd", "dr": "Drive|Dr", "pkwy": "Parkway|Pkwy", "ln": "Lane|Ln",
         "hwy": "Highway|Hwy"}


def sibling_key(name):
    return " ".join(re.sub(r"\b(?:cam(?:era)?|cctv)\s*\d+\b|#\d+|\b(?:eb|wb|nb|sb|dms)\b|[^a-z0-9 ]", " ", name.lower()).split())


def road_filters(text):
    """Tag filters (key, regex, ignore case) for a road, most specific first, plus the bare name."""
    text = text.strip()
    m = ROUTE.match(text)
    if m:
        kind, num, suffix = m[1].upper(), m[2], m[3].upper()
        ref = {"I": f"I {num}", "US": f"US {num}", "LA": f"LA {num}", "HWY": f"(LA|US) {num}"}[kind]
        if suffix == "B":
            ref += "( ?B|[ -]Business)?"
        return [("ref", f"(^|;) ?{ref}($|;)", False)], None
    tokens = re.findall(r"[A-Za-z0-9']+", text)
    words = [w for w in tokens if w.lower() not in DROP]
    if not words or max(len(w) for w in words) < 3:
        return [], None
    kind = next((TYPES[t.lower()] for t in reversed(tokens) if t.lower() in TYPES), None)
    filters = [("name", f"^((North|South|East|West|N|S|E|W) )?{' '.join(words)} ({kind})$", True)] if kind else []
    filters.append(("name", ".*".join(words), True))
    return filters, " ".join(words)


def parse(name):
    clean = " ".join(NOISE.sub(" ", name).split())
    parts = SEP.split(clean, maxsplit=1)
    if len(parts) == 1:
        m = ROUTE.match(clean)
        if not m:
            return None
        parts = [m[0], clean[m.end():]]
    a, b = parts[0], re.sub(r"\s+\d$", "", SEP.split(parts[1])[0]).strip()
    fa, _ = road_filters(a)
    fb, place = road_filters(b)
    if not fa or not fb:
        return None
    return fa, fb, place


def ofilter(f):
    key, pattern, icase = f
    return f'["{key}"~"{pattern}"{",i" if icase else ""}]'


def matches(tags, f):
    key, pattern, icase = f
    value = tags.get(key)
    return value is not None and re.search(pattern, value, re.I if icase else 0) is not None


class OverpassError(Exception):
    pass


def overpass(query):
    """Run a query, rotating through public servers. Raises OverpassError if all attempts fail.

    With TRAFFCLIP_OVERPASS_CACHE set to a folder, responses are kept there so an interrupted run resumes.
    """
    cache_dir = os.environ.get("TRAFFCLIP_OVERPASS_CACHE")
    if cache_dir:
        path = os.path.join(cache_dir, hashlib.sha1(query.encode()).hexdigest() + ".json")
        if os.path.exists(path):
            with open(path) as f:
                return json.load(f)
    body = urllib.parse.urlencode({"data": query}).encode()
    last = None
    for attempt in range(8):
        req = urllib.request.Request(OVERPASS[attempt % len(OVERPASS)], data=body, headers={"User-Agent": "traffclip-refresh"})
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                data = json.loads(r.read())
            if "error" in data.get("remark", ""):
                raise OverpassError(data["remark"])
            if cache_dir:
                os.makedirs(cache_dir, exist_ok=True)
                with open(path, "w") as f:
                    json.dump(data["elements"], f)
            return data["elements"]
        except Exception as e:
            last = e
            time.sleep(8 * (attempt + 1))
    raise OverpassError(last)


def fetch_route(fa, fbs, bbox):
    """One route in a region plus every road or waterway near it that matches one of the cross-road filters."""
    box = ",".join(f"{v:.3f}" for v in bbox)
    cross = "".join(f'way["{kind}"]{ofilter(f)}(around.a:400);' for f in fbs for kind in ("highway", "waterway"))
    return overpass(f"""[out:json][timeout:120];
way["highway"]{ofilter(fa)}({box})->.a;
(.a;{cross});
out tags geom;""")


def fetch_towns(names, bbox):
    box = ",".join(f"{v:.3f}" for v in bbox)
    return overpass(f"""[out:json][timeout:60];
node["place"]["name"~"^({'|'.join(names)})$",i]({box});
out;""")


class Near:
    """Distance queries against a set of polylines, in km, on a local flat projection."""

    CELL = 0.004

    def __init__(self, ways):
        self.grid = {}
        for w in ways:
            g = [(p["lat"], p["lon"]) for p in w["geometry"]]
            for a, b in zip(g, g[1:]):
                for key in self.cells(min(a[0], b[0]), min(a[1], b[1]), max(a[0], b[0]), max(a[1], b[1])):
                    self.grid.setdefault(key, []).append((a, b))

    def cells(self, lat0, lon0, lat1, lon1, pad=0):
        c = self.CELL
        for i in range(math.floor(lat0 / c) - pad, math.floor(lat1 / c) + pad + 1):
            for j in range(math.floor(lon0 / c) - pad, math.floor(lon1 / c) + pad + 1):
                yield i, j

    def dist(self, p):
        best = math.inf
        k = math.cos(math.radians(p[0]))
        for key in self.cells(p[0], p[1], p[0], p[1], pad=1):
            for a, b in self.grid.get(key, ()):
                ax, ay = (a[1] - p[1]) * 111.32 * k, (a[0] - p[0]) * 110.57
                bx, by = (b[1] - p[1]) * 111.32 * k, (b[0] - p[0]) * 110.57
                dx, dy = bx - ax, by - ay
                t = max(0, min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy or 1e-12)))
                best = min(best, math.hypot(ax + t * dx, ay + t * dy))
        return best


def dist_km(a, b):
    return math.hypot((a[0] - b[0]) * 110.57, (a[1] - b[1]) * 111.32 * math.cos(math.radians(a[0])))


def along(way, step_km=0.03):
    g = [(p["lat"], p["lon"]) for p in way["geometry"]]
    for a, b in zip(g, g[1:]):
        n = max(1, int(dist_km(a, b) / step_km))
        for i in range(n):
            yield a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n
    if g:
        yield g[-1]


def biggest_cluster(points, km=0.4):
    """Group points into crossings and return the center of the largest."""
    groups = []
    for p in points:
        for g in groups:
            if any(dist_km(p, q) < km for q in g[-50:]):
                g.append(p)
                break
        else:
            groups.append([p])
    g = max(groups, key=len)
    return sum(p[0] for p in g) / len(g), sum(p[1] for p in g) / len(g)


def geocode(parsed, data, towns):
    fas, fbs, place = parsed
    for fa in dict.fromkeys([fas[0], fas[-1]]):
        ways = [e for e in data.get(fa, []) if e["type"] == "way" and e.get("geometry")]
        route = [w for w in ways if "highway" in w["tags"] and matches(w["tags"], fa)]
        if not route:
            continue
        near = Near(route)
        # 120 m finds street crossings; a route that ends at an interchange stops among the ramps, farther out
        for radius in (0.12, 0.4):
            for fb in fbs:
                pts = [p for w in ways if matches(w["tags"], fb) for p in along(w) if near.dist(p) <= radius]
                if pts:
                    return biggest_cluster(pts)
        if place:
            # the cross "road" may be a town: take the point on the route nearest to it
            town = next(((e["lat"], e["lon"]) for e in towns
                         if re.fullmatch(place, e.get("tags", {}).get("name", ""), re.I)), None)
            if town:
                best = min((p for w in route for p in along(w, 0.1)), key=lambda p: dist_km(p, town))
                if dist_km(best, town) < 8:
                    return best
    return None


def save_locations(cache):
    with open(LOCATIONS, "w") as f:
        f.write(json.dumps(dict(sorted(cache.items())), indent=1) + "\n")


def locate(cams, listed):
    cache = {}
    if os.path.exists(LOCATIONS):
        with open(LOCATIONS) as f:
            cache = json.load(f)
    known = {}
    for c in cams:
        o = listed.get(c["id"])
        if o and o["lat"]:
            known.setdefault(sibling_key(c["name"]), (o["lat"], o["lon"]))
    for o in listed.values():
        if o["lat"]:
            known.setdefault(sibling_key(o["name"]), (o["lat"], o["lon"]))

    # search box per region: its open-data cameras plus a margin
    boxes = {}
    for c in cams:
        o = listed.get(c["id"])
        if o and o["lat"]:
            b = boxes.setdefault(c["region"], [90, 180, -90, -180])
            boxes[c["region"]] = [min(b[0], o["lat"]), min(b[1], o["lon"]), max(b[2], o["lat"]), max(b[3], o["lon"])]
    boxes = {r: [b[0] - .3, b[1] - .3, b[2] + .3, b[3] + .3] for r, b in boxes.items()}

    todo = {}
    for c in cams:
        hit = cache.get(c["id"])
        o = listed.get(c["id"])
        if hit and hit.get("via") == "manual":
            c["loc"] = (hit["lat"], hit["lon"])
        elif o and o["lat"]:
            c["loc"] = (o["lat"], o["lon"])
        elif hit and hit.get("name") == c["name"]:
            c["loc"] = (hit["lat"], hit["lon"]) if hit.get("via") != "none" else None
        elif sibling_key(c["name"]) in known:
            c["loc"] = known[sibling_key(c["name"])]
            cache[c["id"]] = {"name": c["name"], "via": "sibling", "lat": c["loc"][0], "lon": c["loc"][1]}
        else:
            c["loc"] = None
            parsed = parse(c["name"])
            if parsed and c["region"] in boxes:
                todo.setdefault(c["region"], []).append((c, parsed))
            else:
                cache[c["id"]] = {"name": c["name"], "via": "none"}

    for region, items in todo.items():
        box = boxes[region]
        routes = {}
        for _, (fas, fbs, _) in items:
            for fa in dict.fromkeys([fas[0], fas[-1]]):
                routes.setdefault(fa, {}).update(dict.fromkeys(fbs))
        places = sorted({place for _, (_, _, place) in items if place})
        print(f"  {region}: {len(items)} cameras, {len(routes)} routes", flush=True)
        try:
            data = {}
            for fa, fbs in routes.items():
                data[fa] = fetch_route(fa, list(fbs), box)
                time.sleep(1)
            towns = fetch_towns(places, box) if places else []
        except OverpassError as e:
            print(f"  {region}: download failed ({e}); retried next run", flush=True)
            continue
        for c, parsed in items:
            loc = geocode(parsed, data, towns)
            if loc and not (box[0] <= loc[0] <= box[2] and box[1] <= loc[1] <= box[3]):
                loc = None
            c["loc"] = loc
            cache[c["id"]] = ({"name": c["name"], "via": "osm", "lat": round(loc[0], 5), "lon": round(loc[1], 5)}
                              if loc else {"name": c["name"], "via": "none"})
            print(f"    {c['id']}: {'located' if loc else 'not found'} ({c['name']})", flush=True)
        save_locations(cache)

    for c in cams:
        loc = c.pop("loc", None)
        if loc:
            c["lat"], c["lon"] = round(loc[0], 5), round(loc[1], 5)
        else:
            c.pop("lat", None)
            c.pop("lon", None)
    save_locations(cache)
    print(f"  located {sum('lat' in c for c in cams)}/{len(cams)}")


def load_cameras():
    with open(os.path.join(ROOT, "cameras.js")) as f:
        src = f.read()
    return json.loads(src[src.index("["):src.rindex("]") + 1])


def write_cameras(cams):
    lines = ",\n".join(json.dumps(c, ensure_ascii=False) for c in cams)
    stamp = datetime.date.today().isoformat()
    with open(os.path.join(ROOT, "cameras.js"), "w") as f:
        f.write(f"// Generated by tools/refresh.py on {stamp}. {len(cams)} cameras.\n")
        f.write(f"window.CAMERAS = [\n{lines}\n];\n")


def grab(cam):
    out = os.path.join(ROOT, "images", cam["id"] + ".jpg")
    tmp = out + ".part.jpg"
    cmd = ["ffmpeg", "-nostdin", "-v", "error", "-user_agent", UA, "-rw_timeout", "20000000",
           "-i", cam["url"], "-frames:v", "1",
           # apply the stream's pixel aspect so the still matches the live video's shape
           "-vf", "scale=trunc(iw*sar/2)*2:ih,setsar=1,scale='min(480,iw)':-2", "-q:v", "5", "-y", tmp]
    try:
        subprocess.run(cmd, timeout=60, capture_output=True)
    except subprocess.TimeoutExpired:
        pass
    if os.path.exists(tmp) and os.path.getsize(tmp) > 0:
        os.replace(tmp, out)
        return True
    if os.path.exists(tmp):
        os.remove(tmp)
    return False


REF_W, REF_H = 64, 48


def gray_frames(data, select_keyframes):
    """ffmpeg-decode video or image bytes into REF_W x REF_H grayscale frames (area-averaged)."""
    vf = f"scale={REF_W}:{REF_H}:flags=area,format=gray"
    if select_keyframes:
        vf = "select='eq(pict_type,I)'," + vf
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", "pipe:0", "-vf", vf, "-vsync", "vfr", "-f", "rawvideo", "pipe:1"],
                       input=data, capture_output=True, timeout=60)
    n = len(r.stdout) // (REF_W * REF_H)
    return [r.stdout[i * REF_W * REF_H:(i + 1) * REF_W * REF_H] for i in range(n)]


def median_frame(frames):
    # per-pixel median of a few frames drops passing headlights and vehicles
    return bytes(sorted(px)[len(px) // 2] for px in zip(*frames))


def capture_ref(cam):
    try:
        base = cam["url"].rsplit("/", 1)[0] + "/"
        chunk = [l for l in get(cam["url"]).decode().splitlines() if l and not l.startswith("#")][0]
        segs = [l for l in get(base + chunk).decode().splitlines() if l and not l.startswith("#")]
        frames = gray_frames(get(base + segs[-1], 30), True)
        return median_frame(frames) if frames else None
    except Exception:
        return None


def load_refs():
    path = os.path.join(ROOT, "refs.js")
    if not os.path.exists(path):
        return {"w": REF_W, "h": REF_H, "day": {}, "night": {}}
    with open(path) as f:
        src = f.read()
    return json.loads(src[src.index("{"):src.rindex("}") + 1])


def write_refs(refs):
    stamp = datetime.date.today().isoformat()
    with open(os.path.join(ROOT, "refs.js"), "w") as f:
        f.write(f"// Generated by tools/refresh.py on {stamp}. Each camera's usual view as {REF_W}x{REF_H} grayscale.\n")
        f.write(f"window.REFS = {json.dumps(refs, separators=(',', ':'))};\n")


def update_refs(regime, cams, from_stills=False):
    refs = load_refs()
    if from_stills:
        def one(c):
            path = os.path.join(ROOT, "images", c["id"] + ".jpg")
            if not os.path.exists(path):
                return None
            with open(path, "rb") as f:
                frames = gray_frames(f.read(), False)
            return frames[0] if frames else None
    else:
        one = capture_ref
    with cf.ThreadPoolExecutor(12) as ex:
        got = dict(zip([c["id"] for c in cams], ex.map(one, cams)))
    for cid, px in got.items():
        if px:
            refs[regime][cid] = base64.b64encode(px).decode()
    write_refs(refs)
    print(f"{regime} views: {sum(1 for v in got.values() if v)}/{len(cams)} captured")


def main():
    args = set(sys.argv[1:])
    if "--refs" in sys.argv:
        regime = (sys.argv[sys.argv.index("--refs") + 1:] or [None])[0]
        if regime not in ("day", "night"):
            sys.exit("--refs takes day or night")
        return update_refs(regime, load_cameras())
    if "--refs-from-stills" in args:
        return update_refs("day", load_cameras(), from_stills=True)
    if "--frames-only" in args:
        cams = load_cameras()
    else:
        if "--no-scan" in args:
            found = [(c["id"].split("-")[0], int(c["id"].rsplit("-", 1)[1])) for c in load_cameras()]
        else:
            print("scanning DOTD stream servers")
            found = scan()
        if not found:
            sys.exit("no cameras answered (offline?); cameras.js left unchanged")
        print("naming")
        manual_path = os.path.join(ROOT, "tools", "names.json")
        manual = {}
        if os.path.exists(manual_path):
            with open(manual_path) as f:
                manual = json.load(f)
        listed = open_data()
        cams = []
        for prefix, n in found:
            cid = f"{prefix}-cam-{n:03d}"
            region = REGIONS[prefix][0]
            name = manual.get(cid) or (listed.get(cid) or {}).get("name") or f"{region} camera {n}"
            cams.append({"id": cid, "name": name, "region": region, "url": stream_url(prefix, n)})
        print("locating")
        locate(cams, listed)
        write_cameras(cams)
        print(f"wrote cameras.js ({len(cams)} cameras)")
    if "--no-frames" in args or "--no-scan" in args:
        return
    os.makedirs(os.path.join(ROOT, "images"), exist_ok=True)
    if "--new-only" in args:
        cams = [c for c in cams if not os.path.exists(os.path.join(ROOT, "images", c["id"] + ".jpg"))]
    print(f"grabbing {len(cams)} frames")
    ok = 0
    with cf.ThreadPoolExecutor(6) as ex:
        for cam, got in zip(cams, ex.map(grab, cams)):
            ok += got
            if not got:
                print("  no frame:", cam["id"], flush=True)
    print(f"frames: {ok}/{len(cams)}")


if __name__ == "__main__":
    main()
