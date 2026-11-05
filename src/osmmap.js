// Карта как у IQAir: светлая подложка OSM через Leaflet, реальные границы районов,
// кружки AQI по районам и «датчикам», ТЭЦ, стройки и постройки.
// Модуль не знает о симуляции: UI считает плоский `view` и отдаёт его в updateOsmMap.
// Leaflet берётся из глобального `L` (src/vendor/leaflet, 1.9.4) только внутри createOsmMap,
// поэтому чистые функции (aqiColor, aqiBand, геометрия) работают и в node для тестов.
// В innerHTML попадают только статичные строки, числа и названия из данных модуля — ввода игрока нет.
import { DISTRICTS_GEO, PLANT_COORDS, ATTRIBUTION } from "./data/districts.geo.js";
import { MOUNTAINS_GEO, MOUNTAIN_ATTRIBUTION, PEAKS } from "./data/mountains.geo.js";
import { icon } from "./icons.js";

// --- шкала US AQI (цвета близки к IQAir) ---
export const AQI_BANDS = [
  { key: "good", max: 50, color: "#a8e05f", ink: "#3b5a14", label: "Хорошо" },
  { key: "moderate", max: 100, color: "#fdd64b", ink: "#6b5300", label: "Умеренно" },
  { key: "usg", max: 150, color: "#ff9b57", ink: "#7a3300", label: "Вредно для чувствительных" },
  { key: "unhealthy", max: 200, color: "#fe6a69", ink: "#ffffff", label: "Вредно" },
  { key: "very-unhealthy", max: 300, color: "#a97abc", ink: "#ffffff", label: "Очень вредно" },
  { key: "hazardous", max: Infinity, color: "#a87383", ink: "#ffffff", label: "Опасно" },
];

// Полоса шкалы для значения AQI (округление как на табло: 50.4 → 50, «хорошо»).
export function aqiBand(aqi) {
  const a = Math.round(Number.isFinite(aqi) ? Math.max(0, aqi) : 0);
  return AQI_BANDS.find(b => a <= b.max);
}

export const aqiColor = aqi => aqiBand(aqi).color;

// Значки готовых построек и городских проектов: имена из icons.js (тот же значок на карте и на карточке)
export const OSM_ICONS = { gas: "flame", boiler: "factory", bus: "bus", park: "tree", parking: "parking", coalban: "ban", "gas-subsidy": "banknote", listen: "ear", tec2gas: "flame", filters: "filter", metro: "train" };
// Значок постройки на карте: тёмный кружок со светлой линией — читается и на светлой подложке, и на цветной заливке района
const badge = (name, cls = "") => `<span class="om-badge${cls ? ` ${cls}` : ""}">${icon(name, { size: 12 })}</span>`;

export const PLANT_NAMES = { tec1: "ТЭЦ-1", tec2: "ТЭЦ-2", tec3: "ТЭЦ-3" };

// --- детерминированный хеш (FNV-1a) → [0, 1) ---
export function hash01(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0) / 4294967296;
}

// --- геометрия (lon/lat в градусах; долгота сжата на cos широты) ---
const KX = Math.cos(43.25 * Math.PI / 180);

// Внешние кольца фичи: Polygon → [ring], MultiPolygon → [ring, ...]
export const outerRings = f => (f.geometry.type === "Polygon" ? [f.geometry.coordinates[0]] : f.geometry.coordinates.map(p => p[0]));

export function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const pointInFeature = (p, f) => outerRings(f).some(r => pointInRing(p, r));

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

// Расстояние от точки до границы (в «градусах широты»)
export function edgeDistance([x, y], rings) {
  let m = Infinity;
  for (const r of rings) for (let i = 0; i < r.length - 1; i++) {
    m = Math.min(m, segDist(x * KX, y, r[i][0] * KX, r[i][1], r[i + 1][0] * KX, r[i + 1][1]));
  }
  return m;
}

// Северная граница гор: кружки ставим в котловине, где живут люди, если такая часть района есть.
const BASIN_LAT = 43.17;
const GRID = 36;
// Кружок района не ставим вплотную к ТЭЦ: значок завода закрывал бы число.
const PLANT_CLEAR_KM = 3.5;
const plantClear = ([x, y]) => Object.values(PLANT_COORDS).every(([lat, lon]) => Math.hypot((lon - x) * KX, lat - y) * 111 >= PLANT_CLEAR_KM);
const gridCache = new Map();

function interiorGrid(f) {
  const id = f.properties.id;
  if (gridCache.has(id)) return gridCache.get(id);
  const rings = outerRings(f);
  const pts = rings.flat();
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const out = [];
  for (let i = 0; i <= GRID; i++) for (let j = 0; j <= GRID; j++) {
    const p = [x0 + ((x1 - x0) * (i + 0.5)) / (GRID + 1), y0 + ((y1 - y0) * (j + 0.5)) / (GRID + 1)];
    if (pointInFeature(p, f)) out.push({ p, d: edgeDistance(p, rings) });
  }
  const basin = out.filter(c => c.p[1] >= BASIN_LAT);
  const base = basin.length >= 6 ? basin : out;
  const clear = base.filter(c => plantClear(c.p));
  const res = { rings, cand: clear.length >= 6 ? clear : base, span: Math.max((x1 - x0) * KX, y1 - y0) };
  gridCache.set(id, res);
  return res;
}

// Точка «глубже всего внутри» района (полюс недоступности на сетке с двумя уточнениями), [lon, lat]
export function labelPoint(f) {
  const { rings, cand, span } = interiorGrid(f);
  let best = cand.reduce((a, b) => (b.d > a.d ? b : a));
  let step = span / GRID;
  for (let k = 0; k < 2; k++) {
    for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) {
      const p = [best.p[0] + (i * step) / 4 / KX, best.p[1] + (j * step) / 4];
      if (!pointInFeature(p, f) || !plantClear(p)) continue;
      const d = edgeDistance(p, rings);
      if (d > best.d) best = { p, d };
    }
    step /= 4;
  }
  return best.p;
}

// 2–3 точки «датчиков» внутри района: детерминированы от id, разнесены от центра и друг от друга.
export function sensorPoints(f, center = labelPoint(f)) {
  const id = f.properties.id;
  const { cand } = interiorGrid(f);
  const maxD = Math.max(...cand.map(c => c.d));
  const ok = cand.filter(c => c.d >= maxD * 0.3);
  const n = 2 + (hash01(id + ":n") < 0.5 ? 1 : 0);
  const chosen = [center];
  const dist = (a, b) => Math.hypot((a[0] - b[0]) * KX, a[1] - b[1]);
  const out = [];
  for (let k = 0; k < n && ok.length; k++) {
    // дальняя от выбранных точка, с небольшим детерминированным «дрожанием»
    let best = null, bestS = -1;
    for (const c of ok) {
      const s = Math.min(...chosen.map(q => dist(c.p, q))) * (0.8 + 0.4 * hash01(`${id}:${k}:${c.p}`));
      if (s > bestS) { bestS = s; best = c; }
    }
    chosen.push(best.p);
    out.push(best.p);
  }
  return out;
}

// Значение датчика: AQI района ±15%, детерминированно от района, номера датчика и дня.
export const sensorAqi = (aqi, id, i, day) => Math.max(0, Math.round(aqi * (1 + 0.3 * (hash01(`${id}#${i}@${day}`) - 0.5))));

// Прямоугольники { x, y, w, h } пересекаются (pad — зазор в пикселях)?
export const rectsOverlap = (a, b, pad = 0) =>
  a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

// Жадно расставить необязательные элементы: кто пересекает занятое, тот скрыт. Вернёт массив флагов «виден».
export function placeOptional(occupied, items, pad = 1) {
  const taken = [...occupied];
  return items.map(r => {
    if (taken.some(o => rectsOverlap(r, o, pad))) return false;
    taken.push(r);
    return true;
  });
}

// Сглаживание замкнутого кольца [lon, lat] методом Чайкина: углы срезаются, форма остаётся. Кольцо остаётся замкнутым.
export function smoothRing(ring, rounds = 3) {
  let r = ring;
  for (let k = 0; k < rounds; k++) {
    const out = [];
    for (let i = 0; i < r.length - 1; i++) {
      const [ax, ay] = r[i], [bx, by] = r[i + 1];
      out.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    out.push(out[0]);
    r = out;
  }
  return r;
}

export const smoothMountains = geo => ({
  ...geo,
  features: geo.features.map(f => ({
    ...f,
    geometry: { ...f.geometry, coordinates: f.geometry.coordinates.map(poly => poly.map(r => smoothRing(r))) },
  })),
});

// --- подложка ---
// CARTO без ключа отдаёт плитки с водяным знаком «API KEY REQUIRED» (проверено 2026-11-04),
// поэтому по умолчанию берём плитки OSM и осветляем их фильтром. С ключом CARTO: createOsmMap(el, { tiles: cartoTiles(key) }).
export const OSM_TILES = {
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  filter: "grayscale(1) contrast(.72) brightness(1.25)",
  options: {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
};
export const cartoTiles = apiKey => ({
  url: `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(apiKey)}`,
  filter: "",
  options: {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd", maxZoom: 18,
  },
});

// Фильтр подложки: база провайдера, зима холоднее, смог желтит и темнит (шаг 0.05, чтобы не дёргать стиль каждый кадр).
export function tileFilter(base, winter, avgAqi) {
  const smog = Math.round(Math.min(0.5, Math.max(0, (avgAqi - 60) / 400)) * 20) / 20;
  return [base, winter && "saturate(.75) hue-rotate(-8deg)", smog > 0 && `sepia(${(smog * 0.6).toFixed(2)}) brightness(${(1 - smog * 0.2).toFixed(2)})`].filter(Boolean).join(" ");
}

// --- разметка ---
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const pct = v => `${Math.round(Math.max(0, Math.min(1, v ?? 0)) * 1000) / 10}%`;

const CRANE = `<svg class="om-crane" viewBox="-8 -18 24 20" width="22" height="18" aria-hidden="true">
  <path d="M0 0 V-15 M-2.5 0 H2.5 M-5 -15 H13 M11 -15 V-10" /><rect x="-6.5" y="-16.5" width="3" height="3"/></svg>`;

const FACTORY = `<svg viewBox="-12 -20 24 26" width="26" height="28" aria-hidden="true">
  <g class="om-smoke"><circle cx="5" cy="-15" r="3"/><circle cx="7" cy="-15" r="3"/><circle cx="9" cy="-15" r="3"/></g>
  <rect x="-10" y="-4" width="20" height="10" rx="1" class="om-pbody"/>
  <path d="M-10 -4 l5 -4 v4 l5 -4 v4 l5 -4 v4" class="om-pbody"/>
  <rect x="4" y="-16" width="4" height="13" class="om-stack"/></svg>`;

const extrasKey = d => (d.built ?? []).join("+") + "|" + (d.building ?? []).map(b => `${b.actionId}:${b.state ?? "work"}`).join("+");

// Подпись стройки на карте: согласование и забастовка видны сразу, без открытия панели.
const SITE_NOTE = { approval: "согласование", paused: "люди против" };
const siteBar = b => {
  const st = b.state ?? "work";
  const note = SITE_NOTE[st];
  return `<div class="om-bar ${st}"><i data-a="${esc(b.actionId)}" style="width:${pct(b.progress)}"></i></div>${note ? `<small class="om-note ${st}">${note}</small>` : ""}`;
};

function extrasHtml(name, d) {
  const icons = (d.built ?? []).filter(a => OSM_ICONS[a]).map(a => badge(OSM_ICONS[a])).join("");
  const builds = d.building ?? [];
  let s = `<div class="om-name">${esc(name)}</div>`;
  if (icons) s += `<div class="om-icons">${icons}</div>`;
  if (builds.length) {
    s += `<div class="om-site">${CRANE}<div class="om-bars">${builds.map(siteBar).join("")}</div></div>`;
  }
  return s;
}

const CSS = `
.om-root,.om-root.leaflet-container{background:#e9ecef;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.om-root path.om-district{transition:fill .6s,fill-opacity .6s;cursor:pointer}
.om-root path.om-flash{animation:om-flash 1.4s ease-out}
@keyframes om-flash{0%,40%{stroke:#ffd23f;stroke-width:5}}
.om-bub{display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:100%;height:100%;border-radius:50%;
  font-weight:700;letter-spacing:-.02em;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.28);cursor:pointer;
  transition:background-color .6s,color .6s,transform .15s;font-variant-numeric:tabular-nums}
.om-bub.main{font-size:14px}
.om-bub.sensor{font-size:10.5px;border-width:1.5px;opacity:.95}
.om-bub:hover{transform:scale(1.1)}
.om-bub.sel{box-shadow:0 0 0 3px #1f2937,0 2px 6px rgba(0,0,0,.35)}
.om-ex{pointer-events:none;display:flex;flex-direction:column;align-items:center;gap:1px;width:120px;text-align:center}
.om-name{font-size:11px;font-weight:600;color:#1f2937;text-shadow:0 0 3px #fff,0 0 3px #fff,0 0 2px #fff;white-space:nowrap}
.om-icons{display:flex;flex-wrap:wrap;justify-content:center;gap:2px;max-width:110px}
.om-badge{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:#0F172A;color:#FBBF24;box-shadow:0 0 0 1.5px #fff,0 1px 3px rgba(0,0,0,.35)}
.om-badge svg{display:block}
.om-badge.alarm{width:24px;height:24px;background:#B91C1C;color:#fff}
.om-small .om-badge{width:18px;height:18px}.om-small .om-badge.alarm{width:22px;height:22px}
.om-site{display:flex;align-items:center;gap:3px}
.om-crane path{stroke:#d97706;stroke-width:1.6;fill:none;stroke-linecap:round}.om-crane rect{fill:#92400e}
.om-bars{display:flex;flex-direction:column;gap:2px}
.om-bar{width:38px;height:4px;border-radius:2px;background:rgba(31,41,55,.25);overflow:hidden;box-shadow:0 0 0 1px #fff}
.om-bar i{display:block;height:100%;background:#d97706;transition:width .4s}
.om-bar.approval{background:repeating-linear-gradient(45deg,#9ca3af 0 4px,#e5e7eb 4px 8px)}
.om-bar.paused i{background:#dc2626}
.om-note{display:block;font-size:9px;font-weight:700;line-height:1.1;text-shadow:0 0 3px #fff,0 0 3px #fff}
.om-note.approval{color:#374151}.om-note.paused{color:#b91c1c}
.om-flag{line-height:0}
.om-bub.angry{border-color:#b91c1c}
.om-plant{display:flex;flex-direction:column;align-items:center;cursor:default}
.om-plant .om-pbody{fill:#57534e}.om-plant .om-stack{fill:#44403c}
.om-plant[data-fuel=filters] .om-pbody{fill:#6b7280}
.om-plant[data-fuel=gas] .om-pbody,.om-plant[data-fuel=gas] .om-stack{fill:#0e7490}
.om-plant .om-smoke circle{fill:#6b6b6b;opacity:.55;transform-box:fill-box;transform-origin:center;animation:om-puff 3s infinite ease-out}
.om-plant .om-smoke circle:nth-child(2){animation-delay:-1s}.om-plant .om-smoke circle:nth-child(3){animation-delay:-2s}
.om-plant[data-fuel=filters] .om-smoke circle{fill:#9ca3af;opacity:.4}
.om-plant[data-fuel=gas] .om-smoke circle{fill:#e5e7eb;opacity:.35}
@keyframes om-puff{0%{transform:translate(0,0) scale(.6);opacity:.6}100%{transform:translate(4px,-10px) scale(1.6);opacity:0}}
.om-plant b{font-size:10px;font-weight:700;color:#292524;text-shadow:0 0 3px #fff,0 0 3px #fff;white-space:nowrap;margin-top:1px}
.om-range{font:italic 600 22px Georgia,"Times New Roman",serif;letter-spacing:.06em;color:#3b3024;white-space:nowrap;text-shadow:0 0 4px #fff,0 0 4px #fff,0 0 2px #fff;width:max-content;transform:translateX(-50%) rotate(var(--a,0deg))}
.om-small .om-range{font-size:15px}
.om-peak{display:flex;align-items:center;gap:2px;width:max-content;font-size:10px;font-weight:600;color:#2b2218;text-shadow:0 0 3px #fff,0 0 3px #fff,0 0 2px #fff;white-space:nowrap}
.om-peak i{font-style:normal;font-size:10px;color:#3b3024}
.om-legend .sws{display:flex;flex:none;gap:1px}.om-legend .sws .sw{border-radius:2px;width:9px}
.om-legend{background:rgba(15,23,42,.92);padding:8px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.14);box-shadow:0 4px 14px rgba(0,0,0,.3);font-size:12px;line-height:1.4;color:#F1F5F9;max-width:210px}
.om-legend .row{display:flex;align-items:center;gap:6px}
.om-legend .sw{width:12px;height:12px;border-radius:50%;flex:none;border:1px solid rgba(255,255,255,.2)}
.om-legend .note{margin-top:4px;color:#94A3B8;font-style:italic}
.om-legend summary{cursor:pointer;font-weight:700;min-height:24px;display:flex;align-items:center;gap:4px}
.om-small .om-legend{font-size:12px;padding:5px 8px}.om-small .om-bub.main{font-size:12px}.om-small .om-bub.sensor{font-size:9.5px}.om-small .om-name{font-size:10px}
@media (prefers-reduced-motion:reduce){
  .om-root path.om-district,.om-bub,.om-bar i{transition:none!important}
  .om-plant .om-smoke circle,.om-root path.om-flash{animation:none}.om-bub:hover{transform:none}
}`;

function injectCss() {
  if (typeof document === "undefined" || document.getElementById("osmmap-css")) return;
  const st = document.createElement("style");
  st.id = "osmmap-css";
  st.textContent = CSS;
  document.head.appendChild(st);
}

// Горы: слои вложены и лежат друг на друге, поэтому цвет густеет к хребту, а снег белый.
export const MOUNTAIN_STYLE = {
  foothills: { fillColor: "#b9a98c", fillOpacity: 0.42, stroke: false },
  mountains: { fillColor: "#75644f", fillOpacity: 0.5, stroke: false },
  snow: { fillColor: "#eef0f2", fillOpacity: 0.5, stroke: false },
};
// Подпись хребта: на самих горах, южнее районов; лёгкий наклон — вдоль оси хребта.
const RANGE_LABEL = { wide: [43.09, 76.72], small: [43.07, 77.0], angle: -3, text: "Заилийский Алатау" };

const BUBBLE_PX = { wide: [38, 26], small: [30, 21] }; // [район, датчик]
const SMALL_WIDTH = 480; // уже этого — телефон: кружки мельче, город крупнее, легенда свёрнута
const CORE_LAT = 43.12; // на телефоне южные горы за кадром, чтобы центр не слипался

const districtStyle = (aqi, selected) => ({
  fillColor: aqiColor(aqi), fillOpacity: selected ? 0.45 : 0.35,
  color: selected ? "#1f2937" : "#ffffff", weight: selected ? 3 : 1.2, opacity: selected ? 0.95 : 0.9,
  className: "om-district",
});

// Создать карту в контейнере. onSelect(id) — клик по району, его кружку или датчику.
export function createOsmMap(container, { onSelect, tiles: tileSource = OSM_TILES } = {}) {
  const L = globalThis.L;
  if (!L) throw new Error("osmmap: Leaflet (глобальный L) не загружен");
  injectCss();
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const small = container.clientWidth < SMALL_WIDTH;
  const [mainPx, sensorPx] = small ? BUBBLE_PX.small : BUBBLE_PX.wide;
  container.classList.add("om-root");
  container.classList.toggle("om-small", small);

  const cityBounds = L.geoJSON(DISTRICTS_GEO).getBounds();
  const outer = cityBounds.pad(0.35);
  for (const p of Object.values(PLANT_COORDS)) outer.extend(p);

  const map = L.map(container, {
    center: [43.24, 76.92], zoom: 11, minZoom: 9.5, maxZoom: 16,
    maxBounds: outer, maxBoundsViscosity: 0.8,
    zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 90,
    zoomAnimation: !reduce, fadeAnimation: !reduce, markerZoomAnimation: !reduce,
  });
  map.attributionControl.setPrefix(false);
  const tiles = L.tileLayer(tileSource.url, tileSource.options).addTo(map);
  map.attributionControl.addAttribution(MOUNTAIN_ATTRIBUTION);
  // На телефоне строка атрибуции и так в две строки: OSM уже назван в подписи плиток, а ссылка ведёт на условия ODbL.
  if (!small) map.attributionControl.addAttribution(`Границы районов ${esc(ATTRIBUTION)}`);
  // Без сети плитки просто не приходят: фон контейнера нейтральный, районы и кружки остаются.
  let tileErrors = 0;
  tiles.on("tileerror", () => { if (++tileErrors === 4) container.classList.add("om-offline"); });
  tiles.on("tileload", () => { if (tileErrors) { tileErrors = 0; container.classList.remove("om-offline"); } });

  const select = id => onSelect && onSelect(id);
  const h = { map, L, d: {}, plants: {}, sites: {}, day: undefined, tileBase: tileSource.filter, tileCss: null, placed: false, mainPx, sensorPx };

  const paneLabels = map.createPane("om-labels");
  paneLabels.style.zIndex = 620;
  paneLabels.style.pointerEvents = "none";
  const panePlants = map.createPane("om-plants");
  panePlants.style.zIndex = 590; // под кружками: число важнее значка

  // горы: ниже заливок районов, выше плиток; клики проходят насквозь. Показываются и без плиток.
  const paneMountains = map.createPane("om-mountains");
  paneMountains.style.zIndex = 300;
  paneMountains.style.pointerEvents = "none";
  paneMountains.style.filter = "blur(1.5px)"; // мягкий край: изолинии построены по сетке в 2,5 км
  L.geoJSON(smoothMountains(MOUNTAINS_GEO), { pane: "om-mountains", interactive: false, smoothFactor: 0.5, style: f => MOUNTAIN_STYLE[f.properties.id] }).addTo(map);
  h.range = L.marker(small ? RANGE_LABEL.small : RANGE_LABEL.wide, {
    icon: L.divIcon({ className: "om-range-icon", html: `<div class="om-range" style="--a:${RANGE_LABEL.angle}deg">${RANGE_LABEL.text}</div>`, iconSize: [0, 0] }),
    interactive: false, keyboard: false, pane: "om-labels",
  }).addTo(map);
  h.peaks = PEAKS.map(pk => L.marker([pk.lat, pk.lon], {
    icon: L.divIcon({ className: "om-peak-icon", html: `<div class="om-peak"><i aria-hidden="true">▲</i>${esc(pk.name)}</div>`, iconSize: [0, 0], iconAnchor: [5, 7] }),
    interactive: false, keyboard: false, pane: "om-labels",
  }).addTo(map));

  // районы, кружки, подписи
  for (const f of DISTRICTS_GEO.features) {
    const { id, name } = f.properties;
    const layer = L.geoJSON(f, { style: () => districtStyle(0, false) }).addTo(map);
    layer.on("click", () => select(id));
    const [lon, lat] = labelPoint(f);
    const center = [lat, lon];
    const bubIcon = (cls, px) => L.divIcon({ className: `om-${cls}-icon`, html: `<div class="om-bub ${cls}">–</div>`, iconSize: [px, px], iconAnchor: [px / 2, px / 2] });
    const main = L.marker(center, { icon: bubIcon("main", mainPx), title: name, alt: name, zIndexOffset: 1000, riseOnHover: true }).addTo(map);
    main.on("click", () => select(id));
    main.on("keypress", e => { if (e.originalEvent.key === "Enter" || e.originalEvent.key === " ") select(id); });
    const sensors = sensorPoints(f, [lon, lat]).map(([x, y]) => {
      const m = L.marker([y, x], { icon: bubIcon("sensor", sensorPx), keyboard: false, title: `${name}: датчик (модель)` }).addTo(map);
      m.on("click", () => select(id));
      return m;
    });
    const ex = L.marker(center, {
      icon: L.divIcon({ className: "om-ex-icon", html: `<div class="om-ex">${extrasHtml(name, {})}</div>`, iconSize: [120, 0], iconAnchor: [60, -mainPx / 2 - 2] }),
      interactive: false, keyboard: false, pane: "om-labels",
    }).addTo(map);
    // Митинг и забастовка видны всегда: этого значка нет в расстановке declutter
    const flag = L.marker(center, {
      icon: L.divIcon({ className: "om-flag-icon", html: `<div class="om-flag"></div>`, iconSize: [0, 0], iconAnchor: [-mainPx / 2 + 8, mainPx / 2 + 4] }),
      interactive: false, keyboard: false, pane: "om-labels",
    }).addTo(map);
    h.d[id] = { id, name, layer, main, sensors, ex, flag, flagNow: "", aqi: null, sAqi: [], key: null, selected: false };
  }

  // ТЭЦ
  for (const [id, ll] of Object.entries(PLANT_COORDS)) {
    const m = L.marker(ll, {
      icon: L.divIcon({ className: "om-plant-icon", html: `<div class="om-plant" data-fuel="coal">${FACTORY}<b>${PLANT_NAMES[id] ?? id}</b></div>`, iconSize: [60, 42], iconAnchor: [30, 24] }),
      keyboard: false, interactive: false, pane: "om-plants",
    }).addTo(map);
    h.plants[id] = { m, fuel: "coal" };
  }

  // легенда (на узком экране свёрнута)
  const legend = L.control({ position: "topright" });
  legend.onAdd = () => {
    const div = L.DomUtil.create("div", "om-legend");
    const open = small ? "" : "open";
    div.innerHTML = `<details ${open}><summary>US AQI</summary>${AQI_BANDS.map((b, i) =>
      `<div class="row"><span class="sw" style="background:${b.color}"></span>${i ? AQI_BANDS[i - 1].max + 1 : 0}${b.max === Infinity ? "+" : "–" + b.max} ${b.label}</div>`).join("")}
      <div class="row"><span class="sws">${Object.values(MOUNTAIN_STYLE).map(m => `<span class="sw" style="background:${m.fillColor}"></span>`).join("")}</span>Горы: предгорья, хребет, снега</div>
      <div class="note">значения моделируются игрой</div></details>`;
    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.disableScrollPropagation(div);
    return div;
  };
  legend.addTo(map);

  const fit = small
    ? L.latLngBounds([CORE_LAT, cityBounds.getWest()], [cityBounds.getNorth(), cityBounds.getEast()])
    : L.latLngBounds(cityBounds.getSouthWest(), cityBounds.getNorthEast());
  for (const p of Object.values(PLANT_COORDS)) fit.extend(p); // ТЭЦ-3 за городом, но на карте нужна
  map.fitBounds(fit, { paddingTopLeft: [6, 34], paddingBottomRight: [6, 6], animate: false });
  if (small) {
    // Узкая карта упирается в ширину: прижимаем город к верху, чтобы снизу в кадр вошли горы.
    const z = map.getZoom();
    const top = map.project([fit.getNorth(), fit.getCenter().lng], z).y - 34;
    const x = map.project(map.getCenter(), z).x;
    map.setView(map.unproject(L.point(x, top + map.getSize().y / 2), z), z, { animate: false });
  }
  map.on("zoomend", () => declutter(h));
  declutter(h);
  return h;
}

// Как у IQAir при отдалении: числа районов и значки ТЭЦ видны всегда, остальное — если есть место.
// Приоритет: стройки и постройки, подписи ТЭЦ, названия районов, датчики; выбранный район первым.
// Зовётся при смене масштаба и состава построек, не каждый кадр.
function declutter(h) {
  const box = el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  const origin = h.map.getContainer().getBoundingClientRect();
  const atMarker = (m, px) => {
    const p = h.map.latLngToContainerPoint(m.getLatLng());
    return { x: origin.left + p.x - px / 2, y: origin.top + p.y - px / 2, w: px, h: px };
  };
  const ds = Object.values(h.d).sort((a, b) => b.selected - a.selected);
  const occupied = ds.map(d => atMarker(d.main, h.mainPx));
  const plantLabels = [];
  for (const { m } of Object.values(h.plants)) {
    const el = m.getElement()?.firstElementChild;
    if (!el) continue;
    occupied.push(box(el.querySelector("svg")));
    plantLabels.push(el.querySelector("b"));
  }
  for (const { m } of Object.values(h.sites)) { const el = m.getElement()?.querySelector(".om-site"); if (el) occupied.push(box(el)); }
  const names = [], extras = [];
  for (const d of ds) {
    for (const c of d.ex.getElement()?.firstElementChild?.children ?? []) (c.classList.contains("om-name") ? names : extras).push(c);
  }
  const place = (els, pad, show) => {
    const boxes = els.map(box);
    els.forEach((el, i) => {
      const ok = placeOptional(occupied, [boxes[i]], pad)[0];
      show(el, ok);
      if (ok) occupied.push(boxes[i]);
    });
  };
  const byVisibility = (el, ok) => { el.style.visibility = ok ? "" : "hidden"; };
  place(extras, 1, byVisibility);
  const rangeEl = h.range.getElement()?.firstElementChild;
  if (rangeEl) place([rangeEl], 1, byVisibility);
  place(plantLabels, 0, byVisibility); // без зазора: подпись стоит вплотную к своему значку
  place(names, 1, byVisibility);
  // вершина с подписью, обрезанной краем карты, только мешает
  const fitsMap = (el, ok) => { const r = el.getBoundingClientRect(); byVisibility(el, ok && r.right <= origin.right && r.left >= origin.left); };
  place(h.peaks.map(m => m.getElement()?.firstElementChild).filter(Boolean), 1, fitsMap);
  // датчики считаем по координатам: у скрытого через display нет размеров
  for (const m of ds.flatMap(d => d.sensors)) {
    const r = atMarker(m, h.sensorPx);
    const ok = placeOptional(occupied, [r], 2)[0];
    const el = m.getElement();
    if (el) el.style.display = ok ? "" : "none";
    if (ok) occupied.push(r);
  }
}

function setBubble(marker, aqi, label) {
  const el = marker.getElement()?.firstElementChild;
  if (!el) return;
  const b = aqiBand(aqi);
  el.textContent = Math.round(aqi);
  el.style.backgroundColor = b.color;
  el.style.color = b.ink;
  if (label) marker.getElement().setAttribute("aria-label", label);
}

const CSS_ESC = s => (globalThis.CSS?.escape ? globalThis.CSS.escape(s) : String(s).replace(/["\\]/g, "\\$&"));

// Обновить карту по плоским данным UI. Трогает только то, что изменилось, — можно звать каждый кадр.
// view = {
//   districts: [{ id, aqi, pm25?, building: [{ actionId, progress 0..1 }], built: [actionId] }],
//   plants: [{ id, fuel: "coal" | "filters" | "gas" }],
//   selectedId, day, winter,
//   cityBuilding?: [{ actionId, progress 0..1, at }]   // at — id ТЭЦ (кран у ТЭЦ) или района
// }
export function updateOsmMap(h, view) {
  const day = view.day ?? 0;
  const dayChanged = h.day !== day;
  h.day = day;
  let sum = 0, cnt = 0;
  const cityBuild = view.cityBuilding ?? [];
  let layoutChanged = !h.placed;

  for (const v of view.districts ?? []) {
    const d = h.d[v.id];
    if (!d) continue;
    const aqi = Math.round(v.aqi ?? 0);
    sum += aqi; cnt++;
    const sel = v.id === view.selectedId;
    if (d.aqi !== aqi || d.selected !== sel) {
      d.layer.setStyle(districtStyle(aqi, sel));
      if (sel) d.layer.bringToFront();
    }
    if (d.aqi !== aqi) setBubble(d.main, aqi, `${d.name}, AQI ${aqi}`);
    if (d.aqi !== aqi || dayChanged) {
      d.sensors.forEach((m, i) => {
        const s = sensorAqi(aqi, v.id, i, day);
        if (d.sAqi[i] !== s) { setBubble(m, s); d.sAqi[i] = s; }
      });
    }
    if (d.selected !== sel) { d.main.getElement()?.firstElementChild?.classList.toggle("sel", sel); layoutChanged = true; }
    d.aqi = aqi;
    d.selected = sel;
    const flagNow = v.strike ? "fist" : v.protest ? "frown" : "";
    if (d.flagNow !== flagNow) {
      d.flagNow = flagNow;
      const el = d.flag.getElement()?.firstElementChild;
      if (el) el.innerHTML = flagNow ? badge(flagNow, "alarm") : "";
      d.main.getElement()?.firstElementChild?.classList.toggle("angry", !!flagNow);
      d.main.getElement()?.setAttribute("aria-label", `${d.name}, AQI ${aqi}${v.strike ? ", люди на пределе" : v.protest ? ", люди недовольны" : ""}`);
    }

    // стройки района + городские проекты, привязанные к району
    const building = [...(v.building ?? []), ...cityBuild.filter(b => b.at === v.id)];
    const ev = { built: v.built ?? [], building };
    const key = extrasKey(ev);
    const root = d.ex.getElement()?.firstElementChild;
    if (!root) continue;
    if (d.key !== key) { d.key = key; root.innerHTML = extrasHtml(d.name, ev); layoutChanged = true; }
    else for (const b of building) {
      const bar = root.querySelector(`i[data-a="${CSS_ESC(b.actionId)}"]`);
      const w = pct(b.progress);
      if (bar && bar.style.width !== w) bar.style.width = w;
    }
  }

  for (const p of view.plants ?? []) {
    const pl = h.plants[p.id];
    if (!pl || pl.fuel === p.fuel) continue;
    pl.fuel = p.fuel;
    const el = pl.m.getElement()?.firstElementChild;
    if (el) el.dataset.fuel = p.fuel;
  }
  if (updatePlantSites(h, cityBuild.filter(b => PLANT_COORDS[b.at]))) layoutChanged = true;

  const css = tileFilter(h.tileBase, !!view.winter, cnt ? sum / cnt : 0);
  if (h.tileCss !== css) { h.tileCss = css; h.map.getPane("tilePane").style.filter = css; }
  if (layoutChanged) { h.placed = true; declutter(h); }
}

// Краны городских проектов у ТЭЦ (фильтры, перевод на газ)
function updatePlantSites(h, list) {
  const L = h.L;
  const want = new Set(list.map(b => b.at + ":" + b.actionId));
  let changed = false;
  for (const [k, s] of Object.entries(h.sites)) if (!want.has(k)) { s.m.remove(); delete h.sites[k]; changed = true; }
  for (const b of list) {
    const k = b.at + ":" + b.actionId;
    const w = pct(b.progress);
    let s = h.sites[k];
    if (s && s.st !== (b.state ?? "work")) { s.m.remove(); delete h.sites[k]; s = null; changed = true; }
    if (!s) {
      changed = true;
      const n = Object.keys(h.sites).filter(x => x.startsWith(b.at + ":")).length;
      s = h.sites[k] = {
        m: L.marker(PLANT_COORDS[b.at], {
          icon: L.divIcon({ className: "om-ex-icon", html: `<div class="om-ex"><div class="om-site">${CRANE}<div class="om-bars">${siteBar(b)}</div></div></div>`, iconSize: [120, 0], iconAnchor: [60, -20 - n * 20] }),
          interactive: false, keyboard: false, pane: "om-labels",
        }).addTo(h.map),
        w,
        st: b.state ?? "work",
      };
    } else if (s.w !== w) {
      s.w = w;
      const bar = s.m.getElement()?.querySelector("i");
      if (bar) bar.style.width = w;
    }
  }
  return changed;
}

// Короткая вспышка границы района: стройка завершена.
export function flashOsmDistrict(h, id) {
  h.d[id]?.layer.eachLayer(l => {
    const el = l.getElement?.();
    if (!el) return;
    el.classList.remove("om-flash");
    void el.getBoundingClientRect();
    el.classList.add("om-flash");
  });
}

// Пересчитать размер (после смены раскладки) и убрать карту
export const resizeOsmMap = h => h.map.invalidateSize();
export const destroyOsmMap = h => h.map.remove();
