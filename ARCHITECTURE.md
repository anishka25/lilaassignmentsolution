# Architecture 

---

## Tech Stack & Why

| Layer | Choice | Reason |
|---|---|---|
| **Frontend** | Vanilla JS + HTML5 Canvas | Zero build tooling, runs from a static file server. Canvas gives pixel-level control needed for the Gaussian heatmap kernel. |
| **Styling** | Tailwind CSS (CDN) | Utility-first classes kept all layout inside the HTML so there's no separate component system to maintain. |
| **Data format** | JSON (converted from Parquet) | Browsers can't read Parquet natively. `convert_data.py` (pandas + pyarrow) runs once offline and outputs ~800 small per-match files. `fetch()` calls are used to retrieve them in the frontend instead of a dedicated backend. |
| **Coordinate math** | Inline JS, no library | The mapping is `u = (x - originX) / scale`, one line per axis. Pulling in a geo mapping library would be overkill. |


---

## Data Flow

```
N × .parquet  ──(convert_data.py)──>  data/matches.json   (index)
                                       >  data/match_*.json    (per match events)
                                       >  minimaps/*.png/jpg   (static, served as-is)

Browser load
  └─ fetch matches.json          → populate sidebar, filters
  └─ user clicks match
       └─ fetch match_<id>.json  → currentMatchData (array of {uid, e, x, z, ts, bot})
       └─ load minimap image     → mapImage (Image element)
  └─ renderMap()
       Journey view: group events by uid → draw poly-lines + event markers on Canvas
       Heatmap view: project (x,z) → pixel, splat Gaussian kernel into Float32 density
                     buffer, normalise, colour-map, composite onto map
       Aggregate:    repeat fetch for every match on the same map(batched), union all events
```

The app never holds more than one match in memory in single-match mode (plus the aggregate buffer when enabled).

---

## Trade-offs Made

**Flat JSON files instead of a server/DB** — simple to deploy anywhere (GitHub Pages, `python -m http.server`), but aggregate mode has to fetch up to ~800 files batched. That's slow (~5 s on a warm cache) and can't be cached as a single pre-computed blob.

**Canvas 2D instead of Shader** — easier to read and debug, sufficient for fast 60 fps rendering. The heatmap kernel is the bottleneck as it takes around 200 ms for large match sets. A shader can drop that to <10 ms.

**No reactive framework** — Kept it simple and minimal. The trade-off is that UI state is scattered across many small functions rather than reactive state.

**Per-match JSON granularity** — lets the browser load only what's needed. The downside is that `matches.json` has no event level index, so filtering (e.g. "show only kill-heavy matches") has to be pre computed during conversion.

---

## What I'd Do Differently With More Time

1. **Pre aggregate heatmaps server-side** — run `convert_data.py` to save heatmaps per mode per map. Cuts aggregate load time from seconds to a single fetch and makes it fast for level designers.

2. **Shader based heatmap** — move the Gaussian kernel accumulation to a shader. It will further reduce time to process.

3. **Shareable and reproducible URLs** — add `?match=<id>&view=heatmap&t=850` in the address bar so level designers can share a specific moment directly.
