// Живой слой карты на canvas: смог по ветру, дым печей и ТЭЦ, снег (сколько — по типу зимы). Только вид: симуляцию не меняет,
// поэтому здесь можно Math.random. Пауза и reduced motion замораживают движение (speed = 0).
import { DISTRICTS_GEO, PLANT_COORDS } from "./data/districts.geo.js";
import { MOUNTAINS_GEO } from "./data/mountains.geo.js";
import { ROADS, METRO } from "./data/roads.geo.js";
import { outerRings, pointInFeature } from "./osmmap.js";
import { districtAqi, districtEmission, plantEmission, season } from "./sim.js";
import { SIM } from "./data/sim-balance.js";

// Куда ветер сносит смог: [lon, lat]
export const WIND = { n: [0, 1], s: [0, -1], w: [-1, 0], e: [1, 0], calm: [0, 0] };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Снежинок зимой: обычная зима — SNOW, малоснежная меньше, снежная больше (SIM.winters[тип].snow).
const SNOW = 70;

// Сколько частиц нужно по состоянию игры. Чистая функция, проверяется в test/fx.mjs.
export function fxTargets(s) {
  const snow = season(s) === "winter" ? Math.round(SNOW * (SIM.winters[s.winter ?? "normal"]?.snow ?? 1)) : 0;
  const out = { smog: {}, stove: {}, plant: {}, cars: {}, buses: {}, snow };
  out.metro = s.cityDone.includes("metro") ? "done" : s.building.some(b => b.kind === "city" && b.id === "metro") ? "building" : "none";
  for (const d of s.districts) {
    out.smog[d.id] = clamp(Math.round(districtAqi(s, d.id) / 9), 2, 24);
    out.cars[d.id] = clamp(Math.round(d.traffic * 2.5), 1, 14);
    out.buses[d.id] = d.done.includes("bus");
    out.stove[d.id] = clamp(Math.round(districtEmission(s, d.id).stoves * 1.5), 0, 14);
  }
  for (const p of s.plants) {
    out.plant[p.id] = { n: clamp(Math.round(plantEmission(s, p.id) / 2), 1, 14), tone: p.mult < 0.3 ? "steam" : p.mult < 1 ? "grey" : "coal" };
  }
  return out;
}

// Хребет: смог лежит в котловине, на горах его не рисуем (Медеуский в OSM захватывает горы).
const RIDGE = MOUNTAINS_GEO.features.find(f => f.properties.id === "mountains");
export const inBasin = p => !RIDGE || !pointInFeature(p, RIDGE);

// Полилиния с накопленной длиной: точка и направление на расстоянии t.
function track(line) {
  const acc = [0];
  for (let i = 1; i < line.length; i++) acc.push(acc[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  return { line, acc, len: acc.at(-1) };
}
// out — массив [lon, lat, угол], который переиспользуется: кадр не создаёт мусора на каждую машину.
function along(tr, t, out = [0, 0, 0]) {
  let i = 1;
  while (i < tr.acc.length - 1 && tr.acc[i] < t) i++;
  const a = tr.line[i - 1], b = tr.line[i];
  const k = (t - tr.acc[i - 1]) / ((tr.acc[i] - tr.acc[i - 1]) || 1);
  out[0] = a[0] + (b[0] - a[0]) * k;
  out[1] = a[1] + (b[1] - a[1]) * k;
  out[2] = Math.atan2(b[1] - a[1], b[0] - a[0]);
  return out;
}

// Плотность пикселей холста: на большом экране хватает 1 (дым и смог размыты и так), на телефоне — до 1,5.
// Холст во всю карту при dpr 2 — это 4 пикселя вместо одного: память и заливка каждого кадра.
export const fxDpr = (dpr, width) => Math.min(dpr || 1, width > 1100 ? 1 : 1.5);
// Станции по порядку линии: от «Райымбек батыр» к ближайшей следующей.
export function metroPath(stations = METRO.stations) {
  const left = [...stations];
  const start = left.findIndex(s => /Райымбек/.test(s.name));
  const path = left.splice(start < 0 ? 0 : start, 1);
  while (left.length) {
    const last = path.at(-1);
    let best = 0;
    left.forEach((s, i) => { if (Math.hypot(s.lon - last.lon, s.lat - last.lat) < Math.hypot(left[best].lon - last.lon, left[best].lat - last.lat)) best = i; });
    path.push(...left.splice(best, 1));
  }
  return path;
}

function randomPoint(f, basin = false) {
  const pts = outerRings(f).flat();
  const lons = pts.map(p => p[0]), lats = pts.map(p => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
  for (let i = 0; i < 20; i++) {
    const p = [x0 + Math.random() * (x1 - x0), y0 + Math.random() * (y1 - y0)];
    if (pointInFeature(p, f) && (!basin || inBasin(p))) return p;
  }
  return pts[0];
}

function sprite(rgb) {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, `rgba(${rgb},1)`);
  r.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return c;
}

export function createFx(h) {
  const { map, L } = h;
  const canvas = L.DomUtil.create("canvas", "om-fx", map.createPane("om-fx"));
  map.getPane("om-fx").style.zIndex = 450; // над районами, под кружками с числами
  map.getPane("om-fx").style.pointerEvents = "none";
  const g = canvas.getContext("2d");
  const sprites = { smog: sprite("110,92,60"), stove: sprite("70,64,58"), coal: sprite("45,42,40"), grey: sprite("150,150,150"), steam: sprite("245,245,245") };
  const features = Object.fromEntries(DISTRICTS_GEO.features.map(f => [f.properties.id, f]));
  let parts = [], flakes = [], lastDay = null, zooming = false;
  // Дороги по районам (по середине отрезка); машины ездят по своему району.
  const roads = {};
  for (const r of ROADS) {
    const m = r.line[Math.floor(r.line.length / 2)];
    const id = Object.keys(features).find(k => pointInFeature(m, features[k]));
    if (id) (roads[id] ??= []).push(track(r.line));
  }
  const metroTrack = track(metroPath().map(s => [s.lon, s.lat]));
  let cars = [], metro = "none";
  const trains = [0, 0.5].map(k => ({ t: k * metroTrack.len, dir: 1 }));
  const CAR_COLORS = ["#ef4444", "#f8fafc", "#111827", "#9ca3af", "#2563eb", "#f59e0b"];
  const newCar = (district, bus) => {
    const list = roads[district];
    const tr = list[Math.floor(Math.random() * list.length)];
    return { district, bus, tr, t: Math.random() * tr.len, dir: Math.random() < 0.5 ? 1 : -1, v: bus ? 0.0035 : 0.004 + Math.random() * 0.004, color: bus ? "#1d4ed8" : CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)] };
  };
  map.on("zoomstart", () => { zooming = true; canvas.style.display = "none"; });
  map.on("zoomend", () => { zooming = false; canvas.style.display = ""; });

  const spawn = (key, kind, at, tone) => {
    const smog = kind === "smog";
    const life = smog ? 7 + Math.random() * 5 : 2.5 + Math.random() * 2;
    return { key, kind, tone, at, x: at[0] + (smog ? 0 : (Math.random() - 0.5) * 0.004), y: at[1], age: Math.random() * life, life, size: smog ? 0.026 + Math.random() * 0.018 : kind === "plant" ? 0.009 : 0.007 };
  };

  function sync(s) {
    const t = fxTargets(s);
    const want = {};
    for (const [id, n] of Object.entries(t.smog)) want[`smog:${id}`] = { n, kind: "smog", point: () => randomPoint(features[id], true) };
    for (const [id, n] of Object.entries(t.stove)) want[`stove:${id}`] = { n, kind: "stove", point: () => randomPoint(features[id], true) };
    for (const [id, v] of Object.entries(t.plant)) want[`plant:${id}`] = { n: v.n, kind: "plant", tone: v.tone, point: () => [PLANT_COORDS[id][1], PLANT_COORDS[id][0]] };
    const counts = {};
    parts = parts.filter(p => { counts[p.key] = (counts[p.key] ?? 0) + 1; return counts[p.key] <= (want[p.key]?.n ?? 0); });
    for (const [key, w] of Object.entries(want)) for (let i = counts[key] ?? 0; i < w.n; i++) parts.push(spawn(key, w.kind, w.point(), w.tone));
    for (const p of parts) if (p.tone !== undefined) p.tone = want[p.key].tone;
    metro = t.metro;
    for (const [id, n] of Object.entries(t.cars)) {
      if (!roads[id]) continue;
      const nb = t.buses[id] ? Math.max(1, Math.round(n * 0.3)) : 0;
      const mine = cars.filter(c => c.district === id);
      const keep = [...mine.filter(c => c.bus).slice(0, nb), ...mine.filter(c => !c.bus).slice(0, n - nb)];
      cars = cars.filter(c => c.district !== id).concat(keep);
      for (let i = keep.filter(c => c.bus).length; i < nb; i++) cars.push(newCar(id, true));
      for (let i = keep.filter(c => !c.bus).length; i < n - nb; i++) cars.push(newCar(id, false));
    }
    while (flakes.length < t.snow) flakes.push({ x: Math.random(), y: Math.random(), v: 0.04 + Math.random() * 0.05, r: 1.8 + Math.random() * 1.6 });
    flakes.length = t.snow;
    return want;
  }
  let want = {};
  const at = [0, 0, 0]; // along() пишет сюда
  // Стоп-кадр: что было нарисовано в последний раз. На паузе тот же кадр второй раз не рисуем.
  const still = { s: null, w: 0, h: 0, x: NaN, y: NaN, lat: NaN, lng: NaN, zoom: NaN, dpr: 0 };

  return {
    // speed: 0 — стоп-кадр (пауза, окно, reduced motion), 1 и 3 — скорость игры.
    // Вернёт true, если кадр нарисован; false — нечего рисовать (стоп-кадр уже на месте или идёт зум).
    frame(s, speed, dtMs) {
      if (zooming) return false;
      const size = map.getSize();
      const dpr = fxDpr(devicePixelRatio, innerWidth);
      const pos = map.containerPointToLayerPoint([0, 0]);
      const c = map.getCenter(), zoom = map.getZoom();
      if (!speed && still.s === s && still.w === size.x && still.h === size.y && still.x === pos.x && still.y === pos.y
        && still.lat === c.lat && still.lng === c.lng && still.zoom === zoom && still.dpr === dpr) return false;
      Object.assign(still, { s, w: size.x, h: size.y, x: pos.x, y: pos.y, lat: c.lat, lng: c.lng, zoom, dpr });
      if (s.day !== lastDay) { lastDay = s.day; want = sync(s); }
      if (canvas.width !== Math.round(size.x * dpr) || canvas.height !== Math.round(size.y * dpr)) {
        canvas.width = Math.round(size.x * dpr); canvas.height = Math.round(size.y * dpr);
        canvas.style.width = `${size.x}px`; canvas.style.height = `${size.y}px`;
      }
      L.DomUtil.setPosition(canvas, pos);
      const o = map.latLngToContainerPoint(c), q = map.latLngToContainerPoint([c.lat + 0.01, c.lng + 0.01]);
      const kx = (q.x - o.x) / 0.01, ky = (q.y - o.y) / 0.01;
      const dt = speed ? (dtMs / 1000) * (speed > 1 ? 1.6 : 1) : 0;
      const [wx, wy] = WIND[s.wind] ?? WIND.calm;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, size.x, size.y);
      const pxX = lon => o.x + (lon - c.lng) * kx, pxY = lat => o.y + (lat - c.lat) * ky;
      // метро: пунктир, пока строится; красная линия, станции и поезда — когда готово
      if (metro !== "none") {
        g.globalAlpha = 0.9;
        g.lineWidth = metro === "done" ? 3.5 : 2.5;
        g.strokeStyle = metro === "done" ? "#d9232e" : "#f59e0b";
        g.setLineDash(metro === "done" ? [] : [6, 5]);
        g.beginPath();
        metroTrack.line.forEach(([lon, lat], i) => { i ? g.lineTo(pxX(lon), pxY(lat)) : g.moveTo(pxX(lon), pxY(lat)); });
        g.stroke();
        g.setLineDash([]);
        if (metro === "done") {
          g.fillStyle = "#fff";
          for (const [lon, lat] of metroTrack.line) { g.beginPath(); g.arc(pxX(lon), pxY(lat), 3.2, 0, 7); g.fill(); g.stroke(); }
          for (const tr of trains) {
            if (dt) { tr.t += tr.dir * 0.006 * dt; if (tr.t > metroTrack.len || tr.t < 0) { tr.dir *= -1; tr.t = clamp(tr.t, 0, metroTrack.len); } }
            along(metroTrack, tr.t, at);
            g.save(); g.translate(pxX(at[0]), pxY(at[1])); g.rotate(-at[2]); g.fillStyle = "#b91c1c"; g.fillRect(-7, -2.5, 14, 5); g.restore();
          }
        }
      }
      // машины и автобусы
      g.globalAlpha = 0.95;
      for (const car of cars) {
        if (dt) {
          car.t += car.dir * car.v * dt;
          if (car.t > car.tr.len || car.t < 0) {
            Object.assign(car, newCar(car.district, car.bus)); // доехал до конца — въезжает новая машина с края дороги
            car.t = car.dir > 0 ? 0 : car.tr.len;
          }
        }
        along(car.tr, car.t, at);
        const w = car.bus ? 8 : 5, h = car.bus ? 3.4 : 2.6;
        g.save(); g.translate(pxX(at[0]), pxY(at[1])); g.rotate(-at[2]);
        g.fillStyle = car.color; g.strokeStyle = "rgba(0,0,0,.45)"; g.lineWidth = 0.6;
        g.fillRect(-w / 2, -h / 2, w, h); g.strokeRect(-w / 2, -h / 2, w, h);
        g.restore();
      }
      for (const p of parts) {
        if (dt) {
          p.age += dt;
          const smog = p.kind === "smog";
          p.x += (wx * (smog ? 0.0012 : 0.0016) + (smog ? 0 : 0.0002)) * dt;
          p.y += (wy * (smog ? 0.0012 : 0.0016) + (smog ? 0.00008 : 0.0012)) * dt;
          // горы: в хребет смог не заходит — частица гаснет и рождается заново в котловине
          if (p.age > p.life || (smog && !inBasin([p.x, p.y]))) {
            const w = want[p.key];
            Object.assign(p, spawn(p.key, p.kind, w ? w.point() : p.at, p.tone), { age: 0 });
          }
        }
        const fade = Math.sin(Math.PI * clamp(p.age / p.life, 0, 1));
        const grow = p.kind === "smog" ? 1 : 1 + 2.5 * p.age / p.life;
        const r = p.size * grow * kx;
        const img = p.kind === "smog" ? sprites.smog : p.kind === "stove" ? sprites.stove : sprites[p.tone];
        g.globalAlpha = fade * (p.kind === "smog" ? 0.3 : 0.85);
        g.drawImage(img, o.x + (p.x - c.lng) * kx - r, o.y + (p.y - c.lat) * ky - r, r * 2, r * 2);
      }
      g.globalAlpha = 0.9;
      g.fillStyle = "#fff";
      g.strokeStyle = "rgba(90,110,130,.55)";
      g.lineWidth = 0.6;
      for (const f of flakes) {
        if (dt) { f.y = (f.y + f.v * dt) % 1; f.x = (f.x + wx * 0.015 * dt + 1) % 1; }
        g.beginPath();
        g.arc(f.x * size.x, f.y * size.y, f.r, 0, 7);
        g.fill();
        g.stroke();
      }
      g.globalAlpha = 1;
      return true;
    },
  };
}
