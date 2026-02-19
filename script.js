// =============================================
// CONFIG & STATE
// =============================================
const MAP_CONFIG = {
    AmbroseValley: { scale: 900, originX: -370, originZ: -473, img: 'minimaps/AmbroseValley_Minimap.png' },
    GrandRift:     { scale: 581, originX: -290, originZ: -290, img: 'minimaps/GrandRift_Minimap.png' },
    Lockdown:      { scale: 1000, originX: -500, originZ: -500, img: 'minimaps/Lockdown_Minimap.jpg' },
};

let allMatches = [];
let filteredMatches = [];
let currentMatchData = null;
let currentMatchInfo = null;
let currentView = 'journey';  // 'journey' or 'heatmap'
let heatmapMode = 'traffic';
let sortMode = 'events';

// Overlay-all state
let overlayMode = false;           // true when showing all-match overlay
let overlayData = null;            // { mapId, playerPaths: Map<uid, {color, points}> }
let overlayCancelled = false;

// Canvas state
const canvas = document.getElementById('mapCanvas');
const ctx = canvas.getContext('2d');
let mapImage = null;
let panX = 0, panY = 0, zoom = 1;
let isDragging = false, dragStartX = 0, dragStartY = 0, panStartX = 0, panStartY = 0;

// Playback state
let timelineMin = 0, timelineMax = 0;
let currentTime = 0;
let isPlaying = false;
let playbackSpeed = 1;
let animationFrameId = null;
let lastFrameTime = 0;

// Event filter state
let eventFilters = {
    paths: true, Kill: true, Killed: true, Loot: true, KilledByStorm: true, bots: true
};

// Player colors (persistent per-match)
const PLAYER_COLORS = [
    '#8b5cf6', '#ec4899', '#06b6d4', '#10b981', '#f59e0b',
    '#ef4444', '#6366f1', '#14b8a6', '#f97316', '#84cc16',
    '#e879f9', '#22d3ee', '#a3e635', '#fb923c', '#a78bfa',
    '#2dd4bf', '#facc15', '#fb7185', '#38bdf8', '#4ade80'
];

// =============================================
// DATA LOADING
// =============================================
async function loadMatchIndex() {
    const resp = await fetch('data/matches.json');
    allMatches = await resp.json();
    applyFilters();
}

function applyFilters() {
    const mapFilter = document.getElementById('filterMap').value;
    const dayFilter = document.getElementById('filterDay').value;

    filteredMatches = allMatches.filter(m => {
        if (mapFilter !== 'all' && m.map_id !== mapFilter) return false;
        if (dayFilter !== 'all' && m.day !== dayFilter) return false;
        return true;
    });

    if (sortMode === 'events') {
        filteredMatches.sort((a, b) => b.combat_events - a.combat_events);
    } else {
        filteredMatches.sort((a, b) => (b.humans + b.bots) - (a.humans + a.bots));
    }

    renderMatchList();
}

function setSortMode(mode) {
    sortMode = mode;
    document.getElementById('sortRecent').classList.toggle('active', mode === 'events');
    document.getElementById('sortPlayers').classList.toggle('active', mode === 'players');
    applyFilters();
}

function renderMatchList() {
    const list = document.getElementById('matchList');
    document.getElementById('matchCount').textContent = filteredMatches.length;

    if (filteredMatches.length === 0) {
        list.innerHTML = '<div class="p-4 text-center text-gray-500 text-sm">No matches found</div>';
        return;
    }

    const mapBadgeColors = {
        AmbroseValley: 'bg-emerald-900/50 text-emerald-400',
        GrandRift: 'bg-blue-900/50 text-blue-400',
        Lockdown: 'bg-orange-900/50 text-orange-400',
    };
    const mapShortNames = {
        AmbroseValley: 'Ambrose',
        GrandRift: 'Rift',
        Lockdown: 'Lock',
    };

    list.innerHTML = filteredMatches.map(m => {
        const active = currentMatchInfo && currentMatchInfo.file_id === m.file_id ? 'active' : '';
        const dayShort = m.day.replace('February_', 'Feb ');
        return `
        <div class="match-card ${active} px-4 py-3 border-b border-dark-700/50 cursor-pointer transition-colors" onclick="loadMatch('${m.file_id}')">
            <div class="flex items-center justify-between mb-1">
                <span class="badge ${mapBadgeColors[m.map_id]}">${mapShortNames[m.map_id]}</span>
                <span class="text-[10px] text-gray-500">${dayShort}</span>
            </div>
            <div class="flex items-center justify-between text-xs">
                <span class="text-gray-400">
                    <span class="text-human font-semibold">${m.humans}</span> human${m.humans !== 1 ? 's' : ''}
                    <span class="text-gray-600 mx-1">·</span>
                    <span class="text-bot font-semibold">${m.bots}</span> bot${m.bots !== 1 ? 's' : ''}
                </span>
                <span class="text-gray-500">
                    <span class="text-kill">${m.combat_events}</span> combat
                </span>
            </div>
        </div>`;
    }).join('');
}

async function loadMatch(fileId) {
    const info = allMatches.find(m => m.file_id === fileId);
    if (!info) return;

    // Exit overlay mode when a specific match is selected
    overlayMode = false;
    overlayData = null;

    currentMatchInfo = info;
    document.getElementById('emptyState').classList.add('hidden');
    document.getElementById('eventFilters').classList.remove('hidden');
    document.getElementById('timelineBar').classList.remove('hidden');
    document.getElementById('topBarInfo').innerHTML = `
        <span class="text-white font-medium">${info.map_id}</span>
        <span class="text-gray-600 mx-2">·</span>
        <span>${info.day.replace('February_', 'Feb ')}</span>
        <span class="text-gray-600 mx-2">·</span>
        <span class="text-human">${info.humans} humans</span> + <span class="text-bot">${info.bots} bots</span>
    `;

    // Load match data
    const resp = await fetch(`data/match_${fileId}.json`);
    currentMatchData = await resp.json();

    // Set timeline bounds
    timelineMin = currentMatchData[0].ts;
    timelineMax = currentMatchData[currentMatchData.length - 1].ts;
    currentTime = timelineMax; // Show full match by default

    const slider = document.getElementById('timeSlider');
    slider.max = 1000;
    slider.value = 1000;

    updateTimeDisplay();
    placeTimelineMarkers();

    // Load map image
    const mapCfg = MAP_CONFIG[info.map_id];
    const img = new Image();
    img.onload = () => {
        mapImage = img;
        resetView();
        // If in heatmap view with aggregate enabled for a different map, reload aggregate
        if (currentView === 'heatmap' && document.getElementById('heatmapAllMatches').checked) {
            if (aggregateLoadingMap !== info.map_id) {
                aggregatedHeatmapData = null;
                aggregateLoadingMap = null;
                onHeatmapScopeChange();
                return; // onHeatmapScopeChange will call resetView()+renderMap() when done
            }
        }
        renderMap();
    };
    img.src = mapCfg.img;

    // Stop any playback
    stopPlayback();

    // Re-render sidebar to show active
    renderMatchList();
}

// =============================================
// COORDINATE CONVERSION
// =============================================
function worldToPixel(x, z, mapId) {
    const cfg = MAP_CONFIG[mapId];
    const u = (x - cfg.originX) / cfg.scale;
    const v = (z - cfg.originZ) / cfg.scale;
    return {
        px: u * 1024,
        py: (1 - v) * 1024
    };
}

// =============================================
// CANVAS RENDERING
// =============================================
function resizeCanvas() {
    const container = document.getElementById('canvasContainer');
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    renderMap();
}

function resetView() {
    const container = document.getElementById('canvasContainer');
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const mapSize = 1024;
    zoom = Math.min(cw, ch) / mapSize * 0.9;
    panX = (cw - mapSize * zoom) / 2;
    panY = (ch - mapSize * zoom) / 2;
    renderMap();
}

function zoomIn() {
    const container = document.getElementById('canvasContainer');
    zoomAt(container.clientWidth / 2, container.clientHeight / 2, 1.3);
}

function zoomOut() {
    const container = document.getElementById('canvasContainer');
    zoomAt(container.clientWidth / 2, container.clientHeight / 2, 1 / 1.3);
}

function zoomAt(cx, cy, factor) {
    const newZoom = Math.max(0.2, Math.min(10, zoom * factor));
    panX = cx - (cx - panX) * (newZoom / zoom);
    panY = cy - (cy - panY) * (newZoom / zoom);
    zoom = newZoom;
    renderMap();
}

function renderMap() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Allow rendering if overlay is active (doesn't need currentMatchData/currentMatchInfo)
    if (!mapImage) return;
    if (!overlayMode && (!currentMatchData || !currentMatchInfo)) return;

    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    // Draw map image
    ctx.drawImage(mapImage, 0, 0, 1024, 1024);

    if (overlayMode && overlayData) {
        renderOverlay();
    } else if (currentView === 'journey') {
        renderJourneys();
    } else {
        renderHeatmap();
    }

    ctx.restore();
}

function renderJourneys() {
    const mapId = currentMatchInfo.map_id;
    const data = currentMatchData;
    const showBots = eventFilters.bots;
    const showPaths = eventFilters.paths;
    const timeThreshold = currentTime;

    // Group by player
    const players = {};
    for (const evt of data) {
        if (evt.ts > timeThreshold) continue;
        if (evt.bot && !showBots) continue;
        if (!players[evt.uid]) players[evt.uid] = [];
        players[evt.uid].push(evt);
    }

    // Assign colors to human players
    const playerColorMap = {};
    let colorIdx = 0;
    const humanIds = Object.keys(players).filter(uid => {
        const evts = players[uid];
        return evts.length > 0 && !evts[0].bot;
    });
    for (const uid of humanIds) {
        playerColorMap[uid] = PLAYER_COLORS[colorIdx % PLAYER_COLORS.length];
        colorIdx++;
    }

    // Draw paths
    if (showPaths) {
        for (const uid of Object.keys(players)) {
            const evts = players[uid];
            const isBot = evts[0]?.bot;
            const posEvents = evts.filter(e => e.e === 'Position' || e.e === 'BotPosition');
            if (posEvents.length < 1) continue;
            // Need at least 2 points to draw a path; single points still show as head dots below
            if (posEvents.length < 2) {
                // Just draw the head dot for single-position players
                const solo = worldToPixel(posEvents[0].x, posEvents[0].z, mapId);
                const soloColor = isBot ? '#94a3b8' : (playerColorMap[uid] || '#8b5cf6');
                ctx.globalAlpha = 0.75;
                ctx.fillStyle = soloColor;
                ctx.beginPath();
                ctx.arc(solo.px, solo.py, (isBot ? 3.5 : 5) / zoom, 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = 1;
                continue;
            }

            const color = isBot ? '#94a3b8' : (playerColorMap[uid] || '#8b5cf6');
            const pathAlpha = isBot ? 0.45 : 0.65;

            ctx.strokeStyle = color;
            ctx.globalAlpha = pathAlpha;
            ctx.lineWidth = isBot ? 1.2 / zoom : 2 / zoom;
            // Dashed line for bots to distinguish from humans
            if (isBot) ctx.setLineDash([4 / zoom, 4 / zoom]);
            else ctx.setLineDash([]);
            ctx.beginPath();
            const first = worldToPixel(posEvents[0].x, posEvents[0].z, mapId);
            ctx.moveTo(first.px, first.py);
            for (let i = 1; i < posEvents.length; i++) {
                const p = worldToPixel(posEvents[i].x, posEvents[i].z, mapId);
                ctx.lineTo(p.px, p.py);
            }
            ctx.stroke();
            ctx.setLineDash([]);

            // Draw player head dot at last known position
            const lastPos = posEvents[posEvents.length - 1];
            const headP = worldToPixel(lastPos.x, lastPos.z, mapId);
            const headSize = isBot ? 3.5 / zoom : 5 / zoom;
            ctx.globalAlpha = isBot ? 0.75 : 0.95;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(headP.px, headP.py, headSize, 0, Math.PI * 2);
            ctx.fill();
            // Border on all dots
            ctx.strokeStyle = isBot ? '#475569' : '#ffffff';
            ctx.lineWidth = 1 / zoom;
            ctx.globalAlpha = isBot ? 0.6 : 0.7;
            ctx.stroke();
        }
    }

    ctx.globalAlpha = 1;

    // Draw event markers
    for (const uid of Object.keys(players)) {
        const evts = players[uid];
        for (const evt of evts) {
            const evtType = evt.e;
            if (evtType === 'Position' || evtType === 'BotPosition') continue;

            // Check filters
            if (evtType === 'Kill' || evtType === 'BotKill') {
                if (!eventFilters.Kill) continue;
            }
            if (evtType === 'Killed' || evtType === 'BotKilled') {
                if (!eventFilters.Killed) continue;
            }
            if (evtType === 'Loot' && !eventFilters.Loot) continue;
            if (evtType === 'KilledByStorm' && !eventFilters.KilledByStorm) continue;

            const p = worldToPixel(evt.x, evt.z, mapId);
            drawEventMarker(p.px, p.py, evtType);
        }
    }
}

function drawEventMarker(px, py, eventType) {
    const s = 6 / zoom; // Scale marker size with zoom

    ctx.save();
    ctx.translate(px, py);

    switch (eventType) {
        case 'Kill':
        case 'BotKill':
            // Crosshair icon
            ctx.strokeStyle = '#ef4444';
            ctx.fillStyle = '#ef4444';
            ctx.lineWidth = 1.5 / zoom;
            ctx.beginPath();
            ctx.arc(0, 0, s * 0.6, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 0.4;
            ctx.beginPath();
            ctx.arc(0, 0, s * 1.2, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
            break;

        case 'Killed':
        case 'BotKilled':
            // Skull/X icon
            ctx.strokeStyle = '#f97316';
            ctx.fillStyle = '#f97316';
            ctx.lineWidth = 2 / zoom;
            ctx.beginPath();
            ctx.moveTo(-s * 0.6, -s * 0.6);
            ctx.lineTo(s * 0.6, s * 0.6);
            ctx.moveTo(s * 0.6, -s * 0.6);
            ctx.lineTo(-s * 0.6, s * 0.6);
            ctx.stroke();
            ctx.globalAlpha = 0.3;
            ctx.beginPath();
            ctx.arc(0, 0, s, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
            break;

        case 'KilledByStorm':
            // Lightning bolt shape
            ctx.fillStyle = '#06b6d4';
            ctx.strokeStyle = '#06b6d4';
            ctx.lineWidth = 1.5 / zoom;
            ctx.beginPath();
            ctx.moveTo(-s * 0.3, -s);
            ctx.lineTo(s * 0.3, -s * 0.1);
            ctx.lineTo(-s * 0.1, -s * 0.1);
            ctx.lineTo(s * 0.3, s);
            ctx.lineTo(-s * 0.3, s * 0.1);
            ctx.lineTo(s * 0.1, s * 0.1);
            ctx.closePath();
            ctx.fill();
            ctx.globalAlpha = 0.3;
            ctx.beginPath();
            ctx.arc(0, 0, s * 1.2, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
            break;

        case 'Loot':
            // Diamond shape
            ctx.fillStyle = '#22c55e';
            ctx.beginPath();
            ctx.moveTo(0, -s * 0.7);
            ctx.lineTo(s * 0.5, 0);
            ctx.lineTo(0, s * 0.7);
            ctx.lineTo(-s * 0.5, 0);
            ctx.closePath();
            ctx.fill();
            ctx.globalAlpha = 0.25;
            ctx.beginPath();
            ctx.arc(0, 0, s, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
            break;
    }

    ctx.restore();
}

function renderHeatmap() {
    const mapId = currentMatchInfo.map_id;
    const useAggregate = document.getElementById('heatmapAllMatches').checked && aggregatedHeatmapData;
    const data = useAggregate ? aggregatedHeatmapData : currentMatchData;
    const radius = parseInt(document.getElementById('heatRadius').value);
    const intensity = parseInt(document.getElementById('heatIntensity').value) / 10;

    // Filter events based on heatmap mode
    let filteredEvents;
    switch (heatmapMode) {
        case 'traffic':
            filteredEvents = data.filter(e => e.e === 'Position' || e.e === 'BotPosition');
            break;
        case 'kills':
            filteredEvents = data.filter(e => e.e === 'Kill' || e.e === 'BotKill');
            break;
        case 'deaths':
            filteredEvents = data.filter(e => e.e === 'Killed' || e.e === 'BotKilled' || e.e === 'KilledByStorm');
            break;
        case 'loot':
            filteredEvents = data.filter(e => e.e === 'Loot');
            break;
        default:
            filteredEvents = data;
    }

    // Filter by time only for single-match mode
    if (!useAggregate) {
        filteredEvents = filteredEvents.filter(e => e.ts <= currentTime);
    }

    if (filteredEvents.length === 0) return;

    // Convert to pixel coordinates
    const points = filteredEvents.map(e => worldToPixel(e.x, e.z, mapId));

    // --- Proper density accumulation in float32 ---
    // Each point contributes a Gaussian kernel; we accumulate into a float array
    // so overlapping points sum rather than clamp, giving true density contrast.
    const W = 1024, H = 1024;
    const density = new Float32Array(W * H);
    const sigma = radius / 2.5;  // Gaussian sigma relative to radius
    const sigma2 = sigma * sigma;
    const kernelR = Math.ceil(radius);

    for (const p of points) {
        const cx = Math.round(p.px);
        const cy = Math.round(p.py);
        const x0 = Math.max(0, cx - kernelR);
        const x1 = Math.min(W - 1, cx + kernelR);
        const y0 = Math.max(0, cy - kernelR);
        const y1 = Math.min(H - 1, cy + kernelR);
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const dx = x - cx, dy = y - cy;
                const d2 = dx * dx + dy * dy;
                if (d2 > kernelR * kernelR) continue;
                density[y * W + x] += Math.exp(-d2 / (2 * sigma2));
            }
        }
    }

    // Find max density to normalize
    let maxVal = 0;
    for (let i = 0; i < density.length; i++) if (density[i] > maxVal) maxVal = density[i];
    if (maxVal === 0) return;

    // Apply intensity as a contrast curve: compress the top range so sparse
    // areas remain visible but dense areas are clearly dominant.
    // intensity slider: 0.1 (low contrast) to 1.0 (high contrast / aggressive)
    const gamma = 1.0 - intensity * 0.6;  // 0.4 to 1.0; lower = more contrast to dense areas

    // Build output image
    const heatCanvas = document.createElement('canvas');
    heatCanvas.width = W;
    heatCanvas.height = H;
    const heatCtx = heatCanvas.getContext('2d');
    const imageData = heatCtx.createImageData(W, H);
    const pixels = imageData.data;

    const colorMap = getHeatmapColorMap();
    // Threshold: only show pixels with at least 1% of max density
    const threshold = maxVal * 0.01;

    for (let i = 0; i < density.length; i++) {
        const d = density[i];
        if (d < threshold) continue;
        const t = Math.pow(d / maxVal, gamma); // gamma < 1 boosts mid-range visibility
        const color = sampleColorMap(colorMap, t);
        const pi = i * 4;
        pixels[pi]     = color[0];
        pixels[pi + 1] = color[1];
        pixels[pi + 2] = color[2];
        pixels[pi + 3] = Math.floor(Math.min(t * 220 + 20, 235));
    }

    heatCtx.putImageData(imageData, 0, 0);

    // Clip heatmap to map boundaries using the map's alpha channel as a mask
    // First, draw the map image to get its alpha channel
    heatCtx.globalCompositeOperation = 'destination-in';
    heatCtx.drawImage(mapImage, 0, 0, W, H);
    heatCtx.globalCompositeOperation = 'source-over';

    // Draw heatmap onto main canvas
    ctx.drawImage(heatCanvas, 0, 0, W, H);
}

function getHeatmapColorMap() {
    switch (heatmapMode) {
        case 'traffic': return [[30, 0, 80], [80, 40, 180], [140, 80, 220], [200, 150, 255]];
        case 'kills': return [[80, 0, 0], [180, 30, 30], [240, 80, 40], [255, 200, 60]];
        case 'deaths': return [[80, 30, 0], [200, 80, 20], [240, 150, 40], [255, 220, 100]];
        case 'loot': return [[0, 40, 20], [20, 120, 60], [40, 200, 100], [120, 255, 160]];
        default: return [[0, 0, 60], [40, 40, 180], [100, 100, 240], [200, 200, 255]];
    }
}

function sampleColorMap(colors, t) {
    const n = colors.length - 1;
    const idx = t * n;
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, n);
    const frac = idx - lo;
    return [
        Math.floor(colors[lo][0] + (colors[hi][0] - colors[lo][0]) * frac),
        Math.floor(colors[lo][1] + (colors[hi][1] - colors[lo][1]) * frac),
        Math.floor(colors[lo][2] + (colors[hi][2] - colors[lo][2]) * frac),
    ];
}

// =============================================
// VIEW SWITCHING
// =============================================
// =============================================
// OVERLAY ALL MATCHES
// =============================================
function randomHSL(seed) {
    // deterministic color from uid string
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) & 0xfffffff;
    return `hsl(${h % 360}, 70%, 60%)`;
}

async function loadOverlayAll() {
    // Determine which map to use — require a map filter or use the current match's map
    const mapFilter = document.getElementById('filterMap').value;
    const mapId = mapFilter !== 'all' ? mapFilter : (currentMatchInfo ? currentMatchInfo.map_id : null);
    if (!mapId) {
        alert('Please select a specific map from the filter first, or load a match.');
        return;
    }

    overlayCancelled = false;
    overlayMode = false;
    overlayData = null;

    // Show progress
    document.getElementById('overlayProgress').classList.remove('hidden');
    document.getElementById('overlayAllBtn').disabled = true;
    document.getElementById('overlayAllBtn').classList.add('opacity-50');

    const matchesForMap = allMatches.filter(m => {
        const dayFilter = document.getElementById('filterDay').value;
        if (m.map_id !== mapId) return false;
        if (dayFilter !== 'all' && m.day !== dayFilter) return false;
        return true;
    });

    // Per-uid color and path accumulator
    const playerPaths = new Map(); // uid -> { color, isBot, points: [{x,z}] }

    for (let i = 0; i < matchesForMap.length; i++) {
        if (overlayCancelled) break;

        const pct = Math.round((i / matchesForMap.length) * 100);
        document.getElementById('overlayProgressBar').style.width = pct + '%';
        document.getElementById('overlayProgressText').textContent =
            `Loading ${i + 1} / ${matchesForMap.length} matches…`;

        try {
            const resp = await fetch(`data/match_${matchesForMap[i].file_id}.json`);
            const data = await resp.json();

            for (const evt of data) {
                if (evt.e !== 'Position' && evt.e !== 'BotPosition') continue;
                if (!playerPaths.has(evt.uid)) {
                    playerPaths.set(evt.uid, {
                        color: randomHSL(evt.uid),
                        isBot: evt.bot,
                        points: []
                    });
                }
                playerPaths.get(evt.uid).points.push({ x: evt.x, z: evt.z });
            }
        } catch (e) {}

        // Yield to browser to keep UI responsive
        if (i % 20 === 0) await new Promise(r => setTimeout(r, 0));
    }

    document.getElementById('overlayProgress').classList.add('hidden');
    document.getElementById('overlayAllBtn').disabled = false;
    document.getElementById('overlayAllBtn').classList.remove('opacity-50');

    if (overlayCancelled) return;

    overlayData = { mapId, playerPaths };
    overlayMode = true;

    // Update UI immediately
    const humanCount = [...playerPaths.values()].filter(p => !p.isBot).length;
    const botCount = [...playerPaths.values()].filter(p => p.isBot).length;
    document.getElementById('topBarInfo').innerHTML =
        `<span class="text-accent font-medium">Overlay: All ${mapId} matches</span>
         <span class="text-gray-600 mx-2">·</span>
         <span class="text-human">${humanCount} unique humans</span>
         <span class="text-gray-600 mx-2">·</span>
         <span class="text-bot">${botCount} bots</span>
         <button onclick="clearOverlay()" class="ml-3 text-xs text-gray-500 hover:text-red-400 border border-dark-500 hover:border-red-400/40 rounded px-2 py-0.5 transition-colors">✕ Clear</button>`;
    document.getElementById('emptyState').classList.add('hidden');
    document.getElementById('timelineBar').classList.add('hidden');
    document.getElementById('eventFilters').classList.remove('hidden');

    // Load map image and render
    const currentMapId = overlayData.mapId;
    const needNewImage = !mapImage || (currentMatchInfo?.map_id !== currentMapId && overlayData.mapId !== currentMapId);
    // Always load fresh to be safe
    const img = new Image();
    img.onload = () => { mapImage = img; resetView(); renderMap(); };
    img.src = MAP_CONFIG[mapId].img;
}

function cancelOverlay() {
    overlayCancelled = true;
    document.getElementById('overlayProgress').classList.add('hidden');
    document.getElementById('overlayAllBtn').disabled = false;
    document.getElementById('overlayAllBtn').classList.remove('opacity-50');
}

function clearOverlay() {
    overlayMode = false;
    overlayData = null;
    document.getElementById('topBarInfo').textContent = 'Select a match from the sidebar to begin';
    if (!currentMatchData) {
        document.getElementById('emptyState').classList.remove('hidden');
        document.getElementById('eventFilters').classList.add('hidden');
    }
    renderMap();
}

function renderOverlay() {
    if (!overlayData || !mapImage) return;
    const { mapId, playerPaths } = overlayData;
    const showBots = eventFilters.bots;

    // Draw bots first (under humans)
    for (const [uid, player] of playerPaths) {
        if (player.isBot && !showBots) continue;
        if (player.points.length < 2) continue;

        ctx.globalAlpha = player.isBot ? 0.18 : 0.55;
        ctx.strokeStyle = player.color;
        ctx.lineWidth = player.isBot ? 0.8 / zoom : 1.5 / zoom;
        if (player.isBot) ctx.setLineDash([3 / zoom, 4 / zoom]);
        else ctx.setLineDash([]);

        ctx.beginPath();
        const first = worldToPixel(player.points[0].x, player.points[0].z, mapId);
        ctx.moveTo(first.px, first.py);
        for (let i = 1; i < player.points.length; i++) {
            const p = worldToPixel(player.points[i].x, player.points[i].z, mapId);
            ctx.lineTo(p.px, p.py);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // Head dot at last position
        if (!player.isBot) {
            const last = worldToPixel(
                player.points[player.points.length - 1].x,
                player.points[player.points.length - 1].z, mapId
            );
            ctx.globalAlpha = 0.85;
            ctx.fillStyle = player.color;
            ctx.beginPath();
            ctx.arc(last.px, last.py, 4 / zoom, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    ctx.globalAlpha = 1;
}

function setView(view) {
    if (view === 'heatmap' && currentView === 'journey') {
        // Clear all journey event filters back to defaults
        Object.keys(eventFilters).forEach(k => eventFilters[k] = true);
        document.querySelectorAll('[data-event-filter]').forEach(cb => cb.checked = true);
        // Clear overlay-all if active or loading
        if (overlayMode || overlayData) {
            clearOverlay();
        }
        overlayCancelled = true;
        document.getElementById('overlayProgress').classList.add('hidden');
        document.getElementById('overlayAllBtn').disabled = false;
        document.getElementById('overlayAllBtn').classList.remove('opacity-50');
    }
    currentView = view;
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === view);
    });
    const hasData = currentMatchData || overlayMode;
    document.getElementById('eventFilters').classList.toggle('hidden', view !== 'journey' || !hasData);
    document.getElementById('heatmapControls').classList.toggle('hidden', view !== 'heatmap' || !currentMatchData);
    document.getElementById('mapLegend').classList.toggle('hidden', view !== 'journey');
    renderMap();
}

function setHeatmapMode(mode) {
    heatmapMode = mode;
    document.querySelectorAll('.heatmap-mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
        btn.classList.toggle('bg-dark-600', btn.dataset.mode === mode);
        btn.classList.toggle('text-white', btn.dataset.mode === mode);
    });
    renderMap();
}

let aggregatedHeatmapData = null;
let aggregateLoadingMap = null;

async function onHeatmapScopeChange() {
    const checked = document.getElementById('heatmapAllMatches').checked;
    if (checked && currentMatchInfo) {
        const mapId = currentMatchInfo.map_id;
        if (aggregateLoadingMap !== mapId) {
            aggregatedHeatmapData = null;
            aggregateLoadingMap = mapId;

            // Show progress bar
            const progressEl = document.getElementById('heatmapProgress');
            const progressBar = document.getElementById('heatmapProgressBar');
            const progressText = document.getElementById('heatmapProgressText');
            progressEl.classList.remove('hidden');
            progressBar.style.width = '0%';
            progressText.textContent = 'Loading matches…';

            // Load all matches for this map
            const matchesForMap = allMatches.filter(m => m.map_id === mapId);
            const allEvents = [];
            for (let i = 0; i < matchesForMap.length; i++) {
                // Abort if map changed mid-load
                if (aggregateLoadingMap !== mapId) break;
                try {
                    const resp = await fetch(`data/match_${matchesForMap[i].file_id}.json`);
                    const data = await resp.json();
                    allEvents.push(...data);
                } catch (e) {}
                const pct = Math.round(((i + 1) / matchesForMap.length) * 100);
                progressBar.style.width = pct + '%';
                progressText.textContent = `Loading ${i + 1} / ${matchesForMap.length} matches…`;
                if (i % 20 === 0) await new Promise(r => setTimeout(r, 0));
            }

            // Only commit if we're still loading for the same map
            if (aggregateLoadingMap === mapId) {
                aggregatedHeatmapData = allEvents;
            }
            progressEl.classList.add('hidden');

            // Rescale to fit the (possibly new) map
            resetView();
        }
    } else {
        // Just hide the progress bar; keep cache intact so re-checking is instant
        document.getElementById('heatmapProgress').classList.add('hidden');
    }
    renderMap();
}

// =============================================
// TIMELINE / PLAYBACK
// =============================================
function onTimeSliderInput() {
    const slider = document.getElementById('timeSlider');
    const t = parseInt(slider.value) / 1000;
    currentTime = timelineMin + t * (timelineMax - timelineMin);
    updateTimeDisplay();
    renderMap();
}

function updateTimeDisplay() {
    const elapsed = currentTime - timelineMin;
    const total = timelineMax - timelineMin;
    const pct = total > 0 ? Math.round((elapsed / total) * 100) : 0;
    document.getElementById('timeDisplay').textContent = `${pct}%`;
    document.getElementById('timeDuration').textContent = `${totalEventsUpToTime()} events`;
}

function totalEventsUpToTime() {
    if (!currentMatchData) return 0;
    let count = 0;
    for (const evt of currentMatchData) {
        if (evt.ts <= currentTime) count++;
        else break;
    }
    return count;
}

function togglePlayback() {
    if (isPlaying) {
        stopPlayback();
    } else {
        startPlayback();
    }
}

function startPlayback() {
    if (currentTime >= timelineMax) {
        currentTime = timelineMin;
    }
    isPlaying = true;
    document.getElementById('playIcon').classList.add('hidden');
    document.getElementById('pauseIcon').classList.remove('hidden');
    lastFrameTime = performance.now();
    animationFrameId = requestAnimationFrame(playbackLoop);
}

function stopPlayback() {
    isPlaying = false;
    document.getElementById('playIcon').classList.remove('hidden');
    document.getElementById('pauseIcon').classList.add('hidden');
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
}

function playbackLoop(timestamp) {
    if (!isPlaying) return;

    const dt = timestamp - lastFrameTime;
    lastFrameTime = timestamp;

    // Advance time: spread the match over ~15 seconds of real time at 1x
    const matchDuration = timelineMax - timelineMin;
    const playbackDuration = 15000; // 15 seconds real time at 1x
    const timePerFrame = (matchDuration / playbackDuration) * dt * playbackSpeed;
    currentTime = Math.min(currentTime + timePerFrame, timelineMax);

    // Update slider
    const t = (currentTime - timelineMin) / (timelineMax - timelineMin);
    document.getElementById('timeSlider').value = Math.floor(t * 1000);
    updateTimeDisplay();
    renderMap();

    if (currentTime >= timelineMax) {
        stopPlayback();
        return;
    }

    animationFrameId = requestAnimationFrame(playbackLoop);
}

function updatePlaybackSpeed() {
    playbackSpeed = parseFloat(document.getElementById('playbackSpeed').value);
}

function placeTimelineMarkers() {
    const container = document.getElementById('timelineMarkers');
    container.innerHTML = '';
    if (!currentMatchData) return;

    const duration = timelineMax - timelineMin;
    if (duration === 0) return;

    // Only show combat events as markers
    const combatEvents = currentMatchData.filter(e =>
        ['Kill', 'Killed', 'BotKill', 'BotKilled', 'KilledByStorm'].includes(e.e)
    );

    for (const evt of combatEvents) {
        const t = (evt.ts - timelineMin) / duration;
        const dot = document.createElement('div');
        dot.className = 'absolute w-1.5 h-1.5 rounded-full -mt-0.5';
        dot.style.left = `${t * 100}%`;

        if (evt.e === 'Kill' || evt.e === 'BotKill') dot.style.background = '#ef4444';
        else if (evt.e === 'KilledByStorm') dot.style.background = '#06b6d4';
        else dot.style.background = '#f97316';

        container.appendChild(dot);
    }
}

// =============================================
// HOVER TOOLTIP
// =============================================
function handleHover(e) {
    const tooltip = document.getElementById('tooltip');
    if (!currentMatchData || !currentMatchInfo || currentView !== 'journey') {
        tooltip.classList.add('hidden');
        return;
    }

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Convert mouse position to map coordinates
    const mapX = (mouseX - panX) / zoom;
    const mapY = (mouseY - panY) / zoom;

    const mapId = currentMatchInfo.map_id;
    const hitRadius = 10 / zoom;
    let closest = null;
    let closestDist = Infinity;

    for (const evt of currentMatchData) {
        if (evt.ts > currentTime) continue;
        if (evt.e === 'Position' || evt.e === 'BotPosition') continue;
        if (evt.bot && !eventFilters.bots) continue;

        const p = worldToPixel(evt.x, evt.z, mapId);
        const dx = p.px - mapX;
        const dy = p.py - mapY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < hitRadius && dist < closestDist) {
            closestDist = dist;
            closest = evt;
        }
    }

    if (closest) {
        const eventLabels = {
            Kill: 'Player Kill', BotKill: 'Bot Kill',
            Killed: 'Player Death', BotKilled: 'Killed by Bot',
            KilledByStorm: 'Storm Death', Loot: 'Loot Pickup'
        };
        const isBot = closest.bot;
        const label = eventLabels[closest.e] || closest.e;
        tooltip.innerHTML = `
            <div class="font-medium text-white mb-1">${label}</div>
            <div class="text-gray-400">
                ${isBot ? '<span class="text-bot">Bot</span>' : '<span class="text-human">Human</span>'}
                <span class="text-gray-600 mx-1">·</span>
                ${closest.uid.substring(0, 8)}...
            </div>
            <div class="text-gray-500 mt-1">x: ${closest.x.toFixed(1)}, z: ${closest.z.toFixed(1)}</div>
        `;
        tooltip.style.left = (e.clientX - rect.left + 15) + 'px';
        tooltip.style.top = (e.clientY - rect.top - 10) + 'px';
        tooltip.classList.remove('hidden');
        canvas.style.cursor = 'pointer';
    } else {
        tooltip.classList.add('hidden');
        canvas.style.cursor = isDragging ? 'grabbing' : 'grab';
    }
}

// =============================================
// MOUSE / TOUCH INTERACTION (Pan & Zoom)
// =============================================
canvas.addEventListener('mousedown', (e) => {
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    panStartX = panX;
    panStartY = panY;
});

canvas.addEventListener('mousemove', (e) => {
    if (isDragging) {
        panX = panStartX + (e.clientX - dragStartX);
        panY = panStartY + (e.clientY - dragStartY);
        renderMap();
        return;
    }
    // Hover tooltip
    handleHover(e);
});

canvas.addEventListener('mouseup', () => { isDragging = false; });
canvas.addEventListener('mouseleave', () => { isDragging = false; });

canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    zoomAt(cx, cy, factor);
}, { passive: false });

// Touch support
let lastTouchDist = 0;
canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
        isDragging = true;
        dragStartX = e.touches[0].clientX;
        dragStartY = e.touches[0].clientY;
        panStartX = panX;
        panStartY = panY;
    } else if (e.touches.length === 2) {
        lastTouchDist = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
        );
    }
    e.preventDefault();
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1 && isDragging) {
        panX = panStartX + (e.touches[0].clientX - dragStartX);
        panY = panStartY + (e.touches[0].clientY - dragStartY);
        renderMap();
    } else if (e.touches.length === 2) {
        const dist = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
        );
        if (lastTouchDist > 0) {
            const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            const rect = canvas.getBoundingClientRect();
            zoomAt(cx - rect.left, cy - rect.top, dist / lastTouchDist);
        }
        lastTouchDist = dist;
    }
    e.preventDefault();
}, { passive: false });

canvas.addEventListener('touchend', () => { isDragging = false; lastTouchDist = 0; });

// =============================================
// EVENT FILTER CHECKBOXES
// =============================================
document.querySelectorAll('[data-event-filter]').forEach(cb => {
    cb.addEventListener('change', () => {
        eventFilters[cb.dataset.eventFilter] = cb.checked;
        renderMap();
    });
});

// =============================================
// FILTER DROPDOWNS
// =============================================
document.getElementById('filterMap').addEventListener('change', applyFilters);
document.getElementById('filterDay').addEventListener('change', applyFilters);

// =============================================
// RESIZE
// =============================================
window.addEventListener('resize', resizeCanvas);

// =============================================
// INIT
// =============================================
resizeCanvas();
loadMatchIndex();
