// Проверки карты OSM: данные границ и чистые функции osmmap.js (без браузера и Leaflet).
import assert from "node:assert/strict";
import { DISTRICTS_GEO, PLANT_COORDS, ATTRIBUTION } from "../src/data/districts.geo.js";
import { DISTRICTS, PLANTS } from "../src/data/city.js";
import { DISTRICT_ACTIONS, CITY_PROJECTS } from "../src/data/actions.js";
import { MOUNTAINS_GEO, MOUNTAIN_ATTRIBUTION, PEAKS } from "../src/data/mountains.geo.js";
import { SIM } from "../src/data/sim-balance.js";
import { ICONS, icon, OBSTACLE_ICON, WINTER_ICON } from "../src/icons.js";
import { aqiBand, aqiColor, AQI_BANDS, cartoTiles, hash01, labelPoint, MOUNTAIN_STYLE, OSM_ICONS, OSM_TILES, outerRings, placeOptional, pointInFeature, pointInRing, rectsOverlap, smoothMountains, smoothRing, sensorAqi, sensorPoints, tileFilter } from "../src/osmmap.js";

const BBOX = { lon: [76.6, 77.25], lat: [43.0, 43.5] };
const features = DISTRICTS_GEO.features;
const byId = Object.fromEntries(features.map(f => [f.properties.id, f]));

// --- данные ---
assert.equal(DISTRICTS_GEO.type, "FeatureCollection");
assert.match(ATTRIBUTION, /OpenStreetMap/);
assert.deepEqual(features.map(f => f.properties.id).sort(), DISTRICTS.map(d => d.id).sort(), "те же 8 районов, что в city.js");
for (const d of DISTRICTS) assert.equal(byId[d.id].properties.name, d.name, `имя ${d.id}`);

for (const f of features) {
  const { id } = f.properties;
  const rings = outerRings(f);
  let total = 0;
  for (const r of rings) {
    assert.ok(r.length >= 4, `${id}: кольцо слишком короткое`);
    assert.deepEqual(r[0], r.at(-1), `${id}: кольцо не замкнуто`);
    for (const [x, y] of r) {
      assert.ok(x >= BBOX.lon[0] && x <= BBOX.lon[1] && y >= BBOX.lat[0] && y <= BBOX.lat[1], `${id}: точка вне Алматы ${x},${y}`);
      assert.equal(x, +x.toFixed(5));
      assert.equal(y, +y.toFixed(5));
    }
    total += r.length;
  }
  assert.ok(total >= 100 && total <= 400, `${id}: ${total} точек`);
}

assert.deepEqual(Object.keys(PLANT_COORDS).sort(), PLANTS.map(p => p.id).sort(), "ТЭЦ совпадают с city.js");
for (const [id, [lat, lon]] of Object.entries(PLANT_COORDS)) {
  assert.ok(lat >= BBOX.lat[0] && lat <= BBOX.lat[1] && lon >= BBOX.lon[0] && lon <= BBOX.lon[1], `${id}: вне области`);
}

// --- горы ---
const MTN_BOX = { lon: [75.8, 78.1], lat: [42.6, 43.55] };
assert.match(MOUNTAIN_ATTRIBUTION, /Open-Meteo/);
assert.match(MOUNTAIN_ATTRIBUTION, /Copernicus/);
assert.deepEqual(MOUNTAINS_GEO.features.map(f => f.properties.id), ["foothills", "mountains", "snow"], "слои снизу вверх");
const levels = MOUNTAINS_GEO.features.map(f => f.properties.minElevation);
assert.deepEqual(levels, [...levels].sort((x, y) => x - y), "высота порога растёт");
for (const f of MOUNTAINS_GEO.features) {
  assert.ok(MOUNTAIN_STYLE[f.properties.id], `нет стиля ${f.properties.id}`);
  assert.ok(f.geometry.coordinates.length > 0, `${f.properties.id}: пусто`);
  for (const poly of f.geometry.coordinates) for (const r of poly) {
    assert.ok(r.length >= 4, `${f.properties.id}: короткое кольцо`);
    assert.deepEqual(r[0], r.at(-1), `${f.properties.id}: кольцо не замкнуто`);
    for (const [x, y] of r) assert.ok(x >= MTN_BOX.lon[0] && x <= MTN_BOX.lon[1] && y >= MTN_BOX.lat[0] && y <= MTN_BOX.lat[1], `${f.properties.id}: точка вне области ${x},${y}`);
  }
}
// точка в многоугольнике с дырами
const inBand = (p, f) => f.geometry.coordinates.some(([outer, ...holes]) => pointInRing(p, outer) && !holes.some(h => pointInRing(p, h)));
const band = id => MOUNTAINS_GEO.features.find(f => f.properties.id === id);
const within = (inner, outer) => {
  const pts = inner.geometry.coordinates.flatMap(([o]) => o);
  return pts.filter(p => inBand(p, outer)).length / pts.length;
};
assert.ok(within(band("snow"), band("mountains")) > 0.97, `снег вне хребта: ${within(band("snow"), band("mountains"))}`);
assert.ok(within(band("mountains"), band("foothills")) > 0.97, `хребет вне предгорий: ${within(band("mountains"), band("foothills"))}`);
// горы на юге: центр города не в горах, а Талгар в снегах
assert.ok(!inBand([76.92, 43.25], band("foothills")), "центр Алматы не в предгорьях");
assert.ok(PEAKS.length >= 3 && PEAKS.length <= 5, "3–5 вершин");
for (const pk of PEAKS) assert.ok(pk.name && pk.lat > 42.9 && pk.lat < 43.3 && pk.lon > 76.6 && pk.lon < 77.5 && pk.ele > 500, `вершина ${pk.name}`);
const talgar = PEAKS.find(pk => pk.name.includes("Талгар"));
assert.ok(inBand([talgar.lon, talgar.lat], band("snow")), "пик Талгар в снегах");

// сглаживание: кольцо замкнуто, точек больше, форма та же
const sq = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
const smooth = smoothRing(sq, 2);
assert.deepEqual(smooth[0], smooth.at(-1), "сглаженное кольцо замкнуто");
assert.equal(smooth.length, (sq.length - 1) * 4 + 1);
assert.ok(pointInRing([0.5, 0.5], smooth) && !pointInRing([0.01, 0.01], smooth), "углы срезаны, центр внутри");
for (const f of smoothMountains(MOUNTAINS_GEO).features) for (const poly of f.geometry.coordinates) for (const r of poly) assert.deepEqual(r[0], r.at(-1));
assert.ok(MOUNTAINS_GEO.features[0].geometry.coordinates[0][0].length < smoothMountains(MOUNTAINS_GEO).features[0].geometry.coordinates[0][0].length, "исходные данные не меняются");

// у каждого действия и проекта есть значок
for (const a of [...DISTRICT_ACTIONS, ...CITY_PROJECTS]) assert.ok(OSM_ICONS[a.id], `нет значка ${a.id}`);
// значки — SVG из icons.js, а не эмодзи: имя должно существовать
for (const [id, name] of Object.entries(OSM_ICONS)) assert.ok(ICONS[name], `значок ${id}: нет «${name}» в icons.js`);
for (const id of Object.keys(SIM.obstacles)) assert.ok(ICONS[OBSTACLE_ICON[id]], `нет значка преграды ${id}`);
for (const id of Object.keys(SIM.winters)) assert.ok(ICONS[WINTER_ICON[id]], `нет значка зимы ${id}`);
assert.match(icon("bus"), /^<svg[^>]+aria-hidden="true"/, "значок рядом с текстом скрыт от чтения с экрана");
assert.match(icon("bus", { label: "Автобус" }), /role="img" aria-label="Автобус"/);

// --- шкала AQI ---
for (const [a, key] of [[0, "good"], [50, "good"], [51, "moderate"], [100, "moderate"], [101, "usg"], [150, "usg"], [151, "unhealthy"], [200, "unhealthy"], [201, "very-unhealthy"], [300, "very-unhealthy"], [301, "hazardous"], [999, "hazardous"]]) {
  assert.equal(aqiBand(a).key, key, `aqiBand(${a})`);
}
assert.equal(aqiBand(50.4).key, "good");
assert.equal(aqiBand(NaN).key, "good");
assert.equal(aqiBand(-5).key, "good");
assert.equal(aqiColor(120), "#ff9b57");
assert.equal(AQI_BANDS.length, 6);

// --- кружки ---
const kmDist = (a, b) => Math.hypot((a[0] - b[0]) * 81, (a[1] - b[1]) * 111);
for (const f of features) {
  const { id } = f.properties;
  const c = labelPoint(f);
  assert.ok(pointInFeature(c, f), `${id}: центр вне района`);
  assert.deepEqual(labelPoint(f), c, `${id}: центр детерминирован`);
  const ss = sensorPoints(f);
  assert.ok(ss.length >= 2 && ss.length <= 3, `${id}: ${ss.length} датчиков`);
  assert.deepEqual(sensorPoints(f), ss, `${id}: датчики детерминированы`);
  const all = [c, ...ss];
  for (const s of ss) assert.ok(pointInFeature(s, f), `${id}: датчик вне района`);
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    assert.ok(kmDist(all[i], all[j]) > 0.5, `${id}: кружки слиплись`);
  }
  for (let day = 0; day < 30; day++) for (let i = 0; i < ss.length; i++) {
    const v = sensorAqi(200, id, i, day);
    assert.ok(v >= 170 && v <= 230, `${id}: ±15% нарушено: ${v}`);
    assert.equal(v, sensorAqi(200, id, i, day));
  }
}
assert.notEqual(hash01("a"), hash01("b"));
const vals = new Set(Array.from({ length: 30 }, (_, day) => sensorAqi(200, "almaly", 0, day)));
assert.ok(vals.size > 5, "значение датчика меняется по дням");

// кружок района не под значком ТЭЦ
for (const f of features) {
  const [x, y] = labelPoint(f);
  for (const [id, [lat, lon]] of Object.entries(PLANT_COORDS)) assert.ok(kmDist([x, y], [lon, lat]) > 2, `${f.properties.id} рядом с ${id}`);
}

// --- раскладка без наложений ---
const R = (x, y, w = 10, h = 10) => ({ x, y, w, h });
assert.ok(rectsOverlap(R(0, 0), R(5, 5)));
assert.ok(!rectsOverlap(R(0, 0), R(11, 0)));
assert.ok(rectsOverlap(R(0, 0), R(11, 0), 2), "зазор учитывается");
assert.deepEqual(placeOptional([R(0, 0)], [R(5, 5), R(50, 50), R(55, 55), R(100, 0)]), [false, true, false, true]);

// --- подложка ---
assert.match(OSM_TILES.options.attribution, /OpenStreetMap/);
assert.match(cartoTiles("a b").url, /[?]key=a%20b/);
assert.match(cartoTiles("k").options.attribution, /CARTO/);
assert.equal(tileFilter("", false, 40), "");
assert.match(tileFilter("", true, 40), /saturate/);
assert.match(tileFilter("x", false, 260), /^x sepia\(0\.30\)/);
assert.equal(tileFilter("", false, 100), tileFilter("", false, 101), "шаг фильтра не дёргает стиль");

// --- соседство: граничат ли полигоны и совпадает ли это с neighbors в city.js (только отчёт) ---
const TOUCH_KM = 0.3;
const segKm = (p, a, b) => {
  const K = 81, M = 111;
  const [px, py, ax, ay, bx, by] = [p[0] * K, p[1] * M, a[0] * K, a[1] * M, b[0] * K, b[1] * M];
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
};
// длина общей границы, км: сумма рёбер A, средняя точка которых близка к границе B
function sharedKm(fa, fb) {
  let km = 0;
  for (const r of outerRings(fa)) for (let i = 0; i < r.length - 1; i++) {
    const mid = [(r[i][0] + r[i + 1][0]) / 2, (r[i][1] + r[i + 1][1]) / 2];
    const near = outerRings(fb).some(q => q.some((_, k) => k < q.length - 1 && segKm(mid, q[k], q[k + 1]) < TOUCH_KM));
    if (near) km += kmDist(r[i], r[i + 1]);
  }
  return km;
}
const pair = (a, b) => [a, b].sort().join("—");
const declared = new Set();
for (const d of DISTRICTS) for (const list of Object.values(d.neighbors)) for (const n of list) declared.add(pair(d.id, n));
const real = new Map();
for (let i = 0; i < features.length; i++) for (let j = i + 1; j < features.length; j++) {
  const [a, b] = [features[i], features[j]];
  const km = Math.max(sharedKm(a, b), sharedKm(b, a));
  if (km >= 0.5) real.set(pair(a.properties.id, b.properties.id), km);
}
const fmt = k => `${k} (${real.get(k)?.toFixed(1)} км)`;
const extra = [...real.keys()].filter(k => !declared.has(k));
const missing = [...declared].filter(k => !real.has(k));
console.log(`соседи: совпало ${[...real.keys()].filter(k => declared.has(k)).length}, в OSM есть, в city.js нет: ${extra.map(fmt).join(", ") || "—"}; в city.js есть, в OSM нет: ${missing.join(", ") || "—"}`);
for (const f of features) console.log(`  ${f.properties.id}: ${outerRings(f).reduce((s, r) => s + r.length, 0)} точек, колец ${outerRings(f).length}`);

console.log("osmmap OK");
