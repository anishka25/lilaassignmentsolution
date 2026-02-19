# LILA BLACK - Player Journey Visualizer

A web-based visualization tool for exploring player behavior and movement patterns in LILA BLACK gameplay data.

## Features

### Core Functionality
- **Match Browser** - Filter by map (Ambrose Valley, Grand Rift, Lockdown) and date (Feb 10-14)
- **Interactive Map Visualization** - Displays player journeys on accurate minimap overlays
- **Player Movement Trails** - Color-coded paths showing human players (unique colors) vs bots (gray)
- **Event Markers** - Distinct visual indicators for:
  - **Kills** (red crosshair)
  - **Deaths** (orange X)
  - **Storm Deaths** (cyan lightning)
  - **Loot Pickups** (green diamond)
- **Timeline Playback** - Scrub through match progression or use auto-play with adjustable speed
- **Zoom & Pan** - Mouse wheel zoom, click-drag pan, touch gestures supported
- **Hover Tooltips** - Mouse over events to see player ID, coordinates, and event type

### Advanced Features
- **Journey View** - Watch individual player paths unfold over time
- **Heatmap Mode** - Visualize density patterns:
  - High-traffic areas
  - Kill zones
  - Death zones
  - Loot hotspots
- **Aggregate Analysis** - Combine data from ALL matches on a map for global patterns
- **Event Filtering** - Toggle visibility of specific event types and bot activity
- **Player Head Indicators** - Shows current player position at timeline cursor

## Quick Start

### Running Locally
```bash
cd solution
python -m http.server 8080
# Open http://localhost:8080 in your browser
```

### Usage
1. **Select a match** from the sidebar (sorted by combat events or player count)
2. **Use the timeline slider** at the bottom to scrub through the match
3. **Switch views** using the Journey/Heatmap tabs
4. **Filter events** using the panel in the top-right
5. **Zoom/pan** to focus on specific map areas
6. **Hover over markers** to see event details

## Technical Details

### Data Pipeline
- **Input**: 1,243 parquet files (5 days of gameplay data)
- **Processing**: `convert_data.py` groups events by match and converts to JSON
- **Output**:
  - `data/matches.json` - Match index with metadata
  - `data/match_*.json` - Per-match event data (797 files)
  - `minimaps/` - Map images (Ambrose Valley, Grand Rift, Lockdown)

### Coordinate System
The tool correctly maps 3D world coordinates (x, y, z) to 2D minimap pixels using:
- Map-specific scale factors and origin points
- UV normalization (0-1 range)
- Y-axis flip for top-left image origin
- Uses only X and Z coordinates (Y is elevation)

### Tech Stack
- **Frontend**: Vanilla JavaScript + HTML5 Canvas
- **Styling**: Tailwind CSS (CDN)
- **Data Format**: JSON (converted from Parquet)
- **No dependencies** - runs entirely in the browser


---


