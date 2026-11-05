// Чистая симуляция градостроителя: один tick — один день. Без DOM.
// Каждая публичная функция возвращает новое состояние; вход не меняется.
// Ветер (state.wind: "n" | "s" | "w" | "e" | "calm") — направление, КУДА сносит смог: "n" уносит его на север.
// state.wind — ветер текущего дня: tick применяет его, а в конце выбирает ветер следующего дня.
//
// Аким работает, пока его не сняли или пока сам не ушёл. Каждый год (день 0, 360, 720…) — указ президента
// (s.decree): задачи года и преграды (SIM.decree, SIM.obstacles). Провал любой задачи — сразу конец партии.
// s.phase: "play" — время идёт; "ended" — s.ended: "fired" | "bankrupt" | "idle" | "critical" | "decree" | "retired"
// (текст — endingText(s); при "decree" s.decreeFail = { kind, value, target, text }).
// Пока что-то ждёт игрока, tick бросает ошибку:
//   s.pendingDecree = { year } — указ года, acceptDecree;
//   s.pendingForecast = { type } — прогноз зимы (SIM.winters), ackForecast;
//   s.pendingReport — годовой отчёт президенту, ackReport (или retire: уйти в отставку из отчёта);
//   s.pendingEvent = { cardId } — событие, resolveEvent.
// "fired" — президент снял из-за недовольства горожан, "idle" — за первые полгода не начато ни одной меры
// для воздуха (idleStatus), "critical" — средний AQI за 30 дней так и не опустился ниже порога за время отсчёта (airStatus).
// Доверие на грани (SIM.trust): бонусы настроения выветриваются (d.fade), с каждым годом растёт усталость,
// долгие забастовки расползаются к соседям; что съедает доверие сейчас — trustDrains(s).
// Удача видна: тип зимы (s.winter) выбирается осенью и меняет рассеивание и штили. Указы, преграды и погода берутся
// из отдельного rng судьбы (s.fate): один seed — один сценарий, что бы ни делал игрок.
// tick бросает ошибку и вне фазы "play": время останавливает интерфейс, молча стоять симуляция не должна.
import { DISTRICTS, PLANTS } from "./data/city.js";
import { DISTRICT_ACTIONS, CITY_PROJECTS } from "./data/actions.js";
import { SIM, SEASONS } from "./data/sim-balance.js";
import { CARDS } from "./data/cards.js";

// mulberry32: детерминированный rng, состояние хранится в s.rng
function rand(seed) {
  const t = (seed + 0x6d2b79f5) | 0;
  let r = Math.imul(t ^ (t >>> 15), 1 | t);
  r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
  return [((r ^ (r >>> 14)) >>> 0) / 4294967296, t];
}

function next(s) {
  const [r, t] = rand(s.rng);
  s.rng = t;
  return r;
}

// rng судьбы: указы, преграды и погода зимы. Отдельно от s.rng, чтобы решения игрока не меняли сценарий.
function fate(s) {
  const [r, t] = rand(s.fate);
  s.fate = t;
  return r;
}

// Соседи по индексам: NEIGHBORS[i][dir] — индексы районов, куда ветер dir уносит смог.
const INDEX = Object.fromEntries(DISTRICTS.map((d, i) => [d.id, i]));
const NEIGHBORS = DISTRICTS.map(d =>
  Object.fromEntries(["n", "s", "w", "e"].map(dir => [dir, (d.neighbors[dir] ?? []).map(id => INDEX[id])])),
);
// Кто кому приносит смог: WIND_LINKS[id][dir] = { from: районы, откуда ветер dir приносит смог в id, to: куда уносит }.
const WIND_LINKS = Object.fromEntries(DISTRICTS.map((d, i) => [d.id, Object.fromEntries(["n", "s", "w", "e"].map(dir => [dir, {
  from: DISTRICTS.filter((x, j) => NEIGHBORS[j][dir].includes(i)).map(x => x.id),
  to: NEIGHBORS[i][dir].map(j => DISTRICTS[j].id),
}]))]));
// География ветра для панели района: { n: { from, to }, s, w, e }. Только то, что делает wind(s), без новых правил.
export const windLinks = id => WIND_LINKS[id];
const WINDS = Object.entries(SIM.windWeights);
const WIND_SUM = WINDS.reduce((a, [, w]) => a + w, 0);
const YEAR = SIM.DAYS_PER_SEASON * 4;

// Причины отказа — только здесь. reason стабилен (интерфейс сравнивает его между кадрами), подробности — в detail.
export const REASONS = {
  over: "игра окончена",
  winterOnly: "только зимой",
  active: "уже действует",
  cooldown: days => `перерыв, ещё ${days} дн.`,
  done: "уже сделано",
  building: "строится",
  locked: needs => `откроется после: ${needs.join(", ")}`,
  noMoney: "не хватает денег",
  shortfall: (n, days) => `не хватает ${n} млрд, накопится примерно через ${days} дн.`,
  shortfallNever: n => `не хватает ${n} млрд, при нынешнем доходе не накопится`,
  loanLimit: n => (n > 0 ? `превышен лимит долга: можно ещё ${n} млрд` : "превышен лимит долга: сначала погасите часть"),
  loanAmount: "такого кредита нет",
};

// Районы с печами — по стартовым данным, чтобы цель года и события не менялись от газификации.
export const STOVE_DISTRICTS = DISTRICTS.filter(d => d.stoves >= SIM.stoveDistrictMin).map(d => d.id);

export const getAction = id => DISTRICT_ACTIONS.find(a => a.id === id);
export const getProject = id => CITY_PROJECTS.find(p => p.id === id);
export const getCard = id => CARDS.find(c => c.id === id);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const fmt = x => x.toFixed(1).replace(".", ",");
const nameOf = id => DISTRICTS[INDEX[id]].name;
const inRange = (s, [lo, hi]) => lo + next(s) * (hi - lo);

// Русское множественное: plural(21, "день", "дня", "дней") → "день".
function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a >= 11 && a <= 14) return many;
  return b === 1 ? one : b >= 2 && b <= 4 ? few : many;
}
// "1 день", "34 дня", "11 дней"
export const daysWord = n => `${n} ${plural(n, "день", "дня", "дней")}`;
const yearsWord = n => `${n} ${plural(n, "год", "года", "лет")}`;

export function season(s) {
  return SEASONS[Math.floor(s.day / SIM.DAYS_PER_SEASON) % 4];
}

// --- PM2.5 и AQI ---

// US AQI по брейкпоинтам EPA 2024: [PM от, PM до, AQI от, AQI до]. PM обрезается до 0,1, как у EPA;
// выше 325,4 AQI упирается в 500.
const AQI_BREAKS = [
  [0, 9, 0, 50], [9.1, 35.4, 51, 100], [35.5, 55.4, 101, 150],
  [55.5, 125.4, 151, 200], [125.5, 225.4, 201, 300], [225.5, 325.4, 301, 500],
];
export function aqiFromPm25(pm) {
  const c = Math.floor(Math.max(0, pm) * 10 + 1e-9) / 10;
  const b = AQI_BREAKS.find(x => c <= x[1]);
  if (!b) return 500;
  const [lo, hi, alo, ahi] = b;
  return Math.round(alo + (ahi - alo) * (c - lo) / (hi - lo));
}

// В штиль смог прижат к земле: та же масса даёт большую концентрацию.
const mix = s => (s.wind === "calm" ? SIM.calmMix[season(s)] : 1);
const pmOf = (s, d) => d.smog * SIM.pm25Scale * mix(s);
const totalPop = s => s.districts.reduce((a, d) => a + d.pop, 0);

export function districtPm25(s, id) {
  return pmOf(s, s.districts[INDEX[id]]);
}

// PM2.5 города: среднее по районам, взвешенное населением
export function cityPm25(s) {
  return s.districts.reduce((a, d) => a + pmOf(s, d) * d.pop, 0) / totalPop(s);
}

export function districtAqi(s, id) {
  return aqiFromPm25(districtPm25(s, id));
}

// AQI города — из среднего PM2.5 города (а не среднее AQI районов)
export function cityAqi(s) {
  return aqiFromPm25(cityPm25(s));
}

export function rating(s) {
  return s.districts.reduce((a, d) => a + d.mood * d.pop, 0) / totalPop(s);
}

// Запись ленты: { day, text, kind, district? }; kind: "built" | "action" | "wind" | "season" | "debt" | "loan" |
// "decree" | "forecast" | "unlock" | "growth" | "event" | "chain" | "warning" | "air" | "complaint" | "strike".
// day — тот день, который интерфейс покажет после этого изменения (s.day уже увеличен в tick).
// extra — поля записи для интерфейса (у "unlock" — id открытой меры).
function log(s, kind, text, district, extra) {
  s.log.push({ day: s.day, text, kind, ...(district ? { district } : {}), ...extra });
  if (s.log.length > SIM.logSize) s.log.shift();
}

// Погода держится: с вероятностью windStay ветер завтра тот же, иначе — заново по весам.
// Штилей за сезон не больше и не меньше квоты (SIM.calmSpread): меняется, когда они придут, а не сколько их.
function pickWind(s) {
  if (next(s) < SIM.windStay) return s.wind;
  // затяжной штиль: та же квота, но и ветер по весам чаще штиль
  if (season(s) === "winter" && winterType(s).calm > 1 && next(s) < SIM.windWeights.calm / WIND_SUM * (winterType(s).calm - 1)) return "calm";
  let r = next(s) * WIND_SUM;
  for (const [dir, w] of WINDS) if ((r -= w) < 0) return dir;
  return WINDS[WINDS.length - 1][0];
}

function rollWind(s) {
  const calmK = season(s) === "winter" ? winterType(s).calm : 1;
  const seasonCalm = SIM.DAYS_PER_SEASON * SIM.windWeights.calm / WIND_SUM * calmK;
  const left = SIM.DAYS_PER_SEASON - (s.day % SIM.DAYS_PER_SEASON);
  let w = pickWind(s);
  if (s.calmDays + left <= seasonCalm - SIM.calmSpread) w = "calm";
  else if (w === "calm" && s.calmDays >= seasonCalm + SIM.calmSpread) {
    let r = next(s) * (WIND_SUM - SIM.windWeights.calm);
    w = WINDS.filter(([d]) => d !== "calm").find(([, x]) => (r -= x) < 0)?.[0] ?? "n";
  }
  s.wind = w;
}

// Тип зимы этого года (SIM.winters): до прогноза — обычная.
const winterType = s => SIM.winters[s.winter ?? "normal"];
const nmuOn = s => s.nmuLeft > 0;
// Преграды: морозы — зимой; авария на ТЭЦ — в свои дни.
const frostK = (s, k) => (season(s) === "winter" ? s.mods.emit?.[k] ?? 1 : 1);
const burstK = s => (s.mods.burst && s.day >= s.mods.burst.start && s.day < s.mods.burst.end ? s.mods.burst.mult : 1);
const plantOut = (s, p) => p.emission * p.mult * SIM.plantHeat[season(s)] * SIM.emit.plant
  * frostK(s, "plant") * burstK(s) * (nmuOn(s) ? SIM.nmu.plant : 1);

// Выброс ТЭЦ за сегодня (весь, до разделения по районам)
export function plantEmission(s, plantId) {
  return plantOut(s, s.plants.find(p => p.id === plantId));
}

// Сегодняшний выброс района по частям — для эффектов на карте.
// ponytail: высокая труба ТЭЦ — доля plantLocal падает на свой район, остальное поровну на весь город;
// настоящий шлейф зависит от ветра и высоты трубы.
function emissionParts(s, i) {
  const d = s.districts[i];
  let plant = 0;
  for (const p of s.plants) {
    const out = plantOut(s, p);
    plant += out * (1 - SIM.plantLocal) / s.districts.length;
    if (p.district === d.id) plant += out * SIM.plantLocal;
  }
  const nmu = nmuOn(s);
  return {
    stoves: d.stoves * SIM.heat[season(s)] * SIM.emit.stove * frostK(s, "stove") * (nmu ? SIM.nmu.stoves : 1),
    traffic: d.traffic * SIM.emit.traffic * (nmu ? SIM.nmu.traffic : 1),
    plant,
  };
}

export function districtEmission(s, id) {
  return emissionParts(s, INDEX[id]);
}

function emission(s, i) {
  const e = emissionParts(s, i);
  return e.stoves + e.traffic + e.plant;
}

// --- прогноз зимы ---
// Какой средний AQI зимы этого года дадут нынешние источники в обычную зиму. Не 90 дней симуляции, а средние:
// погода — цепь Маркова «штиль / ветер» с вероятностями из rollWind (windStay, доля штилей), для каждого состояния
// считается средний смог района при условии, что сегодня штиль или ветер (это точно для линейной схемы emit → disperse → wind).
// Ветер — средний по направлениям (матрица переноса), осень — разгон к зиме (смог на 1-й день зимы не нулевой и не зимний).
// ponytail: направление ветра между днями не коррелирует, квота штилей — только средняя, AQI считается от среднего PM2.5
// в штиль и в ветер отдельно. Тест сверяет с симуляцией: ±8% на 20 seed (test/sim.mjs).

// AQI без округления и без шага 0,1 PM: разница двух прогнозов не прыгает ступеньками.
function aqiSmooth(pm) {
  let lo = 0, alo = 0;
  for (const [, hi, , ahi] of AQI_BREAKS) {
    if (pm <= hi) return alo + (ahi - alo) * Math.max(0, pm - lo) / (hi - lo);
    lo = hi; alo = ahi;
  }
  return 500;
}

// Средний ветреный день, разреженно: [i, j, доля] — доля смога района i, которая к вечеру оказывается в j.
const WIND_MATRIX = new Map();
function windMatrix(share) {
  let m = WIND_MATRIX.get(share);
  if (m) return m;
  const n = DISTRICTS.length, dirs = WINDS.filter(([d]) => d !== "calm");
  const sum = dirs.reduce((a, [, w]) => a + w, 0);
  const dense = new Float64Array(n * n);
  for (const [dir, w] of dirs) {
    const p = w / sum;
    for (let i = 0; i < n; i++) {
      const to = NEIGHBORS[i][dir];
      if (!to.length && dir === "s") { dense[i * n + i] += p; continue; }
      dense[i * n + i] += p * (1 - share);
      for (const j of to) dense[i * n + j] += p * share / to.length;
    }
  }
  const from = [], to = [], w = [];
  dense.forEach((v, k) => { if (v) { from.push(Math.floor(k / n)); to.push(k % n); w.push(v); } });
  m = { from: Int32Array.from(from), to: Int32Array.from(to), w: Float64Array.from(w) };
  WIND_MATRIX.set(share, m);
  return m;
}

const mid = ([a, b]) => (a + b) / 2;

// Полный эффект меры на копии для прогноза: без случайности (доля перешедших домов — середина диапазона),
// без ленты и денег. Штрафы за уголь — сразу со средним возвратом (backfire), газ — без разгона.
function applyFull(x, kind, id, districtId, works) {
  if (kind === "district") {
    const a = getAction(id), e = a.effect, d = x.districts[INDEX[districtId]];
    const syn = synergyActive(x, districtId, id) ? a.synergy : null;
    let f = syn?.stoves ?? e.stoves;
    if (a.adoption) f = 1 - (1 - e.stoves) * (syn?.adoption ?? mid(a.adoption));
    const weak = syn ? undefined : x.mods.weaken?.[id];
    if (f !== undefined && weak) f = 1 - (1 - f) * weak;
    if (f !== undefined && a.backfire) f = 1 - (1 - f) * (1 - mid(a.backfire.share));
    if (f !== undefined) d.stoves *= f;
    if (e.traffic !== undefined) {
      const before = d.traffic;
      d.traffic *= syn?.traffic ?? e.traffic;
      if (a.spill && syn?.spill !== 0) {
        const near = [...new Set(Object.values(DISTRICTS[INDEX[d.id]].neighbors).flat())];
        for (const nid of near) x.districts[INDEX[nid]].traffic += (before - d.traffic) * a.spill / near.length;
      }
    }
    if (e.parkDaily !== undefined) d.park *= e.parkDaily;
    if (!a.repeat) d.done = [...d.done, id];
    return;
  }
  const p = getProject(id), e = p.effect;
  if (works && p.works?.traffic) for (const did of e.districts) x.districts[INDEX[did]].traffic /= p.works.traffic;
  for (const [pid, m] of Object.entries(e.plants ?? {})) x.plants.find(pl => pl.id === pid).mult *= m;
  if (e.traffic !== undefined) for (const did of e.districts) x.districts[INDEX[did]].traffic *= e.traffic;
  if (p.synergy) for (const did of e.districts ?? []) if (x.districts[INDEX[did]].done.includes(p.synergy.with)) x.districts[INDEX[did]].traffic *= p.synergy.traffic;
  x.cityDone = [...x.cityDone, id];
}

// Копия города для прогноза: разгон газа досчитан до конца, отложенный возврат печей (штрафы) уже вернулся.
// by — стройки, готовые к этому дню, считаются готовыми (Infinity — все); null — без строек.
function forecastCity(s, by) {
  const x = { ...s, districts: s.districts.map(d => ({ ...d })), plants: s.plants.map(p => ({ ...p })) };
  for (const d of x.districts) {
    for (const r of d.ramps) d[r.key] *= r.perDay ** r.left;
    for (const z of d.delayed) d.stoves += z.removed * z.share;
  }
  if (by !== null) {
    for (const b of s.building) if (s.day + (b.approval ?? 0) + b.left <= by) applyFull(x, b.kind, b.id, b.district, b.works);
  }
  return x;
}

// Выброс районов за день сезона se (как emissionParts, без НМУ). Зимой — морозы и средняя доля аварии на ТЭЦ за эту зиму.
function seasonEmission(x, se, out) {
  const n = x.districts.length, winter = se === "winter";
  let plantK = SIM.plantHeat[se] * SIM.emit.plant;
  if (winter) {
    plantK *= x.mods.emit?.plant ?? 1;
    const b = x.mods.burst;
    if (b) {
      const end = gameYear(x) * YEAR, start = end - SIM.DAYS_PER_SEASON;
      const days = Math.max(0, Math.min(b.end, end) - Math.max(b.start, start));
      plantK *= 1 + days / SIM.DAYS_PER_SEASON * (b.mult - 1);
    }
  }
  const stoveK = SIM.heat[se] * SIM.emit.stove * (winter ? x.mods.emit?.stove ?? 1 : 1);
  let shared = 0;
  for (let i = 0; i < n; i++) out[i] = x.districts[i].stoves * stoveK + x.districts[i].traffic * SIM.emit.traffic;
  for (const p of x.plants) {
    const v = p.emission * p.mult * plantK;
    shared += v * (1 - SIM.plantLocal) / n;
    out[INDEX[p.district]] += v * SIM.plantLocal;
  }
  for (let i = 0; i < n; i++) out[i] += shared;
}

const AUTUMN_DAYS = 40; // разгон осени: смог к началу зимы почти установился

function forecastOf(x) {
  const n = x.districts.length;
  const pc = SIM.windWeights.calm / WIND_SUM, pw = 1 - pc;
  const stayC = SIM.windStay + (1 - SIM.windStay) * pc; // вчера штиль, если сегодня штиль
  const stayW = SIM.windStay + (1 - SIM.windStay) * pw; // вчера ветер, если сегодня ветер
  const M = windMatrix(SIM.windShare * (x.mods.windShare ?? 1));
  const pk = x.mods.park ?? 1;
  const E = new Float64Array(n), kc = new Float64Array(n), kw = new Float64Array(n);
  const mc = new Float64Array(n), mw = new Float64Array(n), tc = new Float64Array(n), tw = new Float64Array(n);
  const pop = x.districts.map(d => d.pop), P = pop.reduce((a, b) => a + b, 0);
  let aqi = 0, pm = 0;
  const run = (se, days, tally) => {
    seasonEmission(x, se, E);
    const dis = SIM.disperse[se] * (se === "winter" ? SIM.winters.normal.disperse : 1);
    for (let i = 0; i < n; i++) {
      const park = 1 - (1 - x.districts[i].park) * pk;
      kc[i] = (1 - dis * SIM.calmDisperse) * park;
      kw[i] = (1 - dis) * park;
    }
    for (let t = 0; t < days; t++) {
      for (let i = 0; i < n; i++) {
        tc[i] = kc[i] * (E[i] + stayC * mc[i] + (1 - stayC) * mw[i]);
        tw[i] = kw[i] * (E[i] + (1 - stayW) * mc[i] + stayW * mw[i]);
      }
      mw.fill(0);
      for (let k = 0; k < M.w.length; k++) mw[M.to[k]] += M.w[k] * tw[M.from[k]];
      let sc = 0, sw = 0;
      for (let j = 0; j < n; j++) {
        mc[j] = tc[j];
        sc += pop[j] * mc[j];
        sw += pop[j] * mw[j];
      }
      if (tally) {
        const pmC = sc / P * SIM.pm25Scale * SIM.calmMix.winter, pmW = sw / P * SIM.pm25Scale;
        aqi += pc * aqiSmooth(pmC) + pw * aqiSmooth(pmW);
        pm += pc * pmC + pw * pmW;
      }
    }
  };
  // старт осени — без ветра, по средней доле рассеивания: дальше AUTUMN_DAYS дней доводят до установившегося
  seasonEmission(x, "autumn", E);
  const k0 = 1 - SIM.disperse.autumn * (pw + pc * SIM.calmDisperse);
  for (let i = 0; i < n; i++) mc[i] = mw[i] = E[i] * k0 / (1 - k0);
  run("autumn", AUTUMN_DAYS, false);
  run("winter", SIM.DAYS_PER_SEASON, true);
  return { aqi: aqi / SIM.DAYS_PER_SEASON, pm25: pm / SIM.DAYS_PER_SEASON };
}

// Прогноз зимы этого года: { aqi, pm25 } — средний AQI и PM2.5 города в обычную зиму при нынешних источниках.
// includeBuilding: true — стройки считаются готовыми (полный эффект); число — только те, что будут готовы к этому дню.
export function winterForecast(s, { includeBuilding = false } = {}) {
  const by = includeBuilding === true ? Infinity : includeBuilding === false ? null : includeBuilding;
  return forecastOf(forecastCity(s, by));
}

// На сколько изменится прогноз AQI зимы, если меру actionId доделать прямо сейчас (минус — чище).
// districtId null — городской проект. НМУ — null: мера на 5 дней, на среднее за зиму её не переложить.
// Прогноз без меры на одно и то же состояние нужен для каждой строки панели: он запоминается (состояние не меняют после tick).
const BASE = new WeakMap();
export function measureImpact(s, districtId, actionId) {
  if (actionId === "nmu") return null;
  let base = BASE.get(s);
  if (base === undefined) BASE.set(s, base = forecastOf(forecastCity(s, null)).aqi);
  const x = forecastCity(s, null);
  applyFull(x, districtId ? "district" : "city", actionId, districtId, false);
  return forecastOf(x).aqi - base;
}

// Год партии, считая с 1: от него зависят указ, открытия построек и рост.
export const gameYear = s => Math.floor(s.day / YEAR) + 1;

// Дата для интерфейса: год партии, сезон, день сезона и года, сколько дней до конца года (до проверки указа).
export function date(s) {
  const dayOfYear = s.day % YEAR;
  return {
    gameYear: gameYear(s),
    season: season(s),
    dayOfSeason: (s.day % SIM.DAYS_PER_SEASON) + 1,
    dayOfYear,
    yearDaysLeft: YEAR - dayOfYear,
  };
}

// Доля готовности стройки, 0..1
export function progress(s, b) {
  return 1 - b.left / b.days;
}

// Забастовка: настроение ниже порога и нет перемирия после «Выслушать людей».
// Преграда «Забастовки» поднимает порог.
const onStrike = (s, d) => d.mood < SIM.strikeMood + (s.mods.strikeMood ?? 0) && s.day >= d.truceUntil;

// Налоги за день, до содержания и платежей по кредитам. Район на забастовке платит вдвое меньше.
export function grossIncome(s) {
  const k = s.mods.income ?? 1;
  return s.districts.reduce((a, d) => a + d.pop * SIM.taxRate * d.mood / 100 * (onStrike(s, d) ? SIM.strikeTax : 1), 0) * k;
}

// Доход в день за вычетом содержания построек и сегодняшних платежей по кредитам.
export function netIncome(s) {
  return grossIncome(s) - s.upkeep - loanPayment(s);
}

// --- кредиты ---

// Сегодняшний платёж по кредиту: последний — ровно остаток, чтобы кредит закрылся за SIM.loan.days дней без хвоста.
const payOf = l => (l.left <= l.perDay + 1e-9 ? l.left : l.perDay);
// Сколько уходит в день на все кредиты.
export const loanPayment = s => s.loans.reduce((a, l) => a + payOf(l), 0);
// Сколько ещё вернуть по всем кредитам, с процентами.
export const debtLeft = s => s.loans.reduce((a, l) => a + l.left, 0);
const loanTotal = amount => amount * (1 + SIM.loan.rate);
// Сколько ещё можно занять (тело кредита, млрд, вниз до целого): долг с процентами не выше limitDays дней валового дохода.
export function loanRoom(s) {
  const free = SIM.loan.limitDays * grossIncome(s) - debtLeft(s);
  return Math.max(0, Math.floor(free / (1 + SIM.loan.rate) + 1e-9));
}

// { ok, reason }: можно ли сейчас взять кредит на amount млрд. В минусе брать можно — в пределах лимита.
export function loanStatus(s, amount) {
  if (s.ended) return { ok: false, reason: REASONS.over };
  if (!SIM.loan.amounts.includes(amount)) return { ok: false, reason: REASONS.loanAmount };
  const room = loanRoom(s);
  if (amount > room) return { ok: false, reason: REASONS.loanLimit(room) };
  return { ok: true, reason: null };
}

// Предложения банка: [{ amount, perDay, total, ok, reason }] по SIM.loan.amounts.
export function loanOptions(s) {
  return SIM.loan.amounts.map(amount => {
    const total = loanTotal(amount);
    return { amount, total, perDay: total / SIM.loan.days, ...loanStatus(s, amount) };
  });
}

// Самый маленький кредит, который покрывает нехватку shortfall и который сейчас дадут, — сумма или null.
export function loanFor(s, shortfall) {
  return loanOptions(s).find(o => o.ok && o.amount >= shortfall)?.amount ?? null;
}

const fmt2 = x => x.toFixed(2).replace(".", ",");

export function takeLoan(prev, amount) {
  const st = loanStatus(prev, amount);
  if (!st.ok) throw new Error(`cannot take loan ${amount}: ${st.reason}`);
  const s = copy(prev);
  const total = loanTotal(amount);
  const perDay = total / SIM.loan.days;
  s.budget += amount;
  s.loans.push({ amount, left: total, perDay });
  s.loanTaken += amount;
  log(s, "loan", `Взят кредит ${amount} млрд: ${fmt2(perDay)} млрд в день ${SIM.loan.days} дней`);
  return s;
}

// Списать дневные платежи (деньги уже ушли в income через netIncome): закрытые кредиты — в ленту.
// Вызывается после s.day++, чтобы запись была датирована новым днём.
function repayLoans(s) {
  if (!s.loans.length) return;
  for (const l of s.loans) {
    const pay = payOf(l);
    s.loanPaid += pay;
    l.left -= pay;
  }
  const open = s.loans.filter(l => l.left > 1e-9);
  for (const l of s.loans.filter(x => !open.includes(x))) log(s, "loan", `Кредит погашен: ${l.amount} млрд и ${String(+(l.amount * SIM.loan.rate).toFixed(1)).replace(".", ",")} млрд процентов`);
  s.loans = open;
}

const eventGap = s => SIM.eventGap[0] + Math.floor(next(s) * (SIM.eventGap[1] - SIM.eventGap[0] + 1));

export function newCity(seed) {
  const s = {
    day: 0, rng: seed | 0, fate: (seed ^ 0x5bd1e995) | 0, budget: SIM.startBudget, debtDays: 0, wind: "calm", upkeep: 0,
    districts: DISTRICTS.map(d => ({
      id: d.id, pop: d.pop, stoves: d.stoves, traffic: d.traffic, mood: SIM.moodStart,
      smog: 0, park: 1, done: [], ramps: [],
      // Люди: сколько раз выслушали, до какого дня перемирие, бастует ли, когда жаловались.
      // since — день последнего запрета, подключения газа или парковки; delayed — отложенные последствия.
      listens: 0, truceUntil: 0, striking: false, complainedDay: -Infinity, since: {}, delayed: [],
      // Сколько печей убрала замена котлов (из них часть вернётся, когда дорожает газ) и сколько сейчас держит субсидия.
      // gasLocked — котлы ставили вместе с субсидией: подорожание газа их не вернёт.
      gasCut: 0, subsidyCut: 0, gasLocked: false,
      // Доверие на грани: бонус настроения, который ещё не выветрился, и сколько дней район уже бастует.
      fade: 0, strikeDays: 0,
    })),
    plants: PLANTS.map(p => ({ id: p.id, district: p.district, emission: p.emission, mult: 1 })),
    building: [], cityDone: [], ended: null, phase: "play", log: [],
    granted: [], // меры, которые указ открыл раньше пути мер (SIM.decree.years[].grants)
    // Средний AQI (среднее дневных AQI города) и PM2.5 за первую и за последнюю (текущую) зиму.
    // Первая зима — только статистика: с чем сравнивают в финале, решает SIM.baselineWinterPm25.
    firstWinterAqi: null, lastWinterAqi: null, winterSum: 0, winterDays: 0,
    firstWinterPm25: null, lastWinterPm25: null, winterPmSum: 0,
    // Указ года, его преграды как модификаторы (s.mods, заменяется целиком), выполненные указы, итог провала.
    decree: null, mods: {}, pendingDecree: null, decreesDone: 0, decreeFail: null,
    // Самый грязный день этой зимы (AQI города) — для задачи «ни одного дня выше».
    peakAqi: 0,
    // Тип зимы этого года (null до прогноза), прогноз ждёт подтверждения, история зим для финала: [{ year, type }].
    winter: null, pendingForecast: null, winters: [],
    // Режим НМУ: сколько дней ещё действует и с какого дня можно снова.
    nmuLeft: 0, nmuReadyDay: 0,
    pendingEvent: null, nextEventDay: 0, seenCards: [],
    // Штили сезона; цепочки для финала; последняя жалоба.
    calmDays: 0, chains: [], complainedDay: -Infinity,
    // Вклад роста (множитель машин, доля новых домов на угле) и зимние выбросы по источникам — для итога партии.
    grownTraffic: 1, grownStoves: 0, emitted: {},
    // Отчёт президенту: ждёт подтверждения и последний сданный. Разовое событие о запрете твёрдого топлива.
    pendingReport: null, lastReport: null, banEventDone: false,
    // AQI города за последние дни и остаток обратного отсчёта критического состояния (null — тревоги нет).
    aqiDays: [], criticalDays: null,
    airStreak: 0, // сколько событий подряд игрок выбирал ухудшение воздуха
    airMeasures: 0, // сколько начато мер, улучшающих воздух
    // Кредиты: [{ amount, left, perDay }] — тело, сколько ещё вернуть с процентами, платёж в день.
    // loanTaken — сколько всего занято, loanPaid — сколько всего выплачено (для итога партии).
    loans: [], loanTaken: 0, loanPaid: 0,
  };
  // Старт с равновесного весеннего смога, чтобы карта не начиналась с нуля.
  for (let i = 0; i < s.districts.length; i++) s.districts[i].smog = emission(s, i) / SIM.disperse.spring;
  s.nextEventDay = eventGap(s);
  s.firstStoves = totalStoves(s); // печей при назначении: от них считается задача { kind: "stoves", from: "start" }
  issueDecree(s, 1);
  rollWind(s);
  return s;
}

// --- указ президента ---

const totalStoves = s => s.districts.reduce((a, d) => a + d.stoves, 0);
const pickFate = (s, list) => list[Math.floor(fate(s) * list.length)];

// Задачи и преграды года y: годы 1–4 по сценарию, дальше случайная задача из пула (строже с каждым годом)
// и 1–2 преграды из колоды. Только rng судьбы.
function decreeDef(s, y) {
  const D = SIM.decree;
  if (y <= D.years.length) {
    const d = D.years[y - 1];
    return { title: d.title, tasks: d.tasks.map(x => ({ ...x })), obstacles: [...d.obstacles], grants: [...(d.grants ?? [])] };
  }
  const k = y - D.years.length - 1;
  const { step, ...base } = pickFate(s, D.pool);
  const task = base.kind === "stoves" ? { ...base, cut: base.cut + step * k } : { ...base, aqi: base.aqi + step * k };
  const deck = [...D.deck], obstacles = [];
  const n = y >= D.twoObstaclesFrom ? 2 : 1;
  while (obstacles.length < n && deck.length) obstacles.push(deck.splice(Math.floor(fate(s) * deck.length), 1)[0]);
  return { title: `Год ${y}`, tasks: [task], obstacles, grants: [] };
}

// От скольких печей считается задача «печей меньше»: 1 января или (from "start") день назначения.
const stovesBase = (s, tasks) => (tasks.some(t => t.kind === "stoves" && t.from === "start") ? s.firstStoves : totalStoves(s));

// Новый указ: задачи, разовые преграды сразу, остальные — в s.mods до конца года. Окно ждёт acceptDecree.
function issueDecree(s, y) {
  const def = decreeDef(s, y);
  const mods = { emit: {}, weaken: {} };
  let where = null;
  for (const id of def.obstacles) {
    const o = SIM.obstacles[id];
    if (o.budget) s.budget += o.budget;
    if (o.traffic) for (const d of s.districts) d.traffic *= o.traffic;
    if (o.mood) for (const d of s.districts) d.mood = clamp(d.mood + o.mood, 0, 100);
    if (o.stoveMood) for (const d of s.districts) if (STOVE_DISTRICTS.includes(d.id) && !d.done.includes("gas-subsidy")) d.mood = clamp(d.mood + o.stoveMood, 0, 100);
    if (o.district) {
      const pool = o.district.stoves ? STOVE_DISTRICTS : DISTRICTS.map(d => d.id);
      where = pickFate(s, pool);
      const d = s.districts[INDEX[where]];
      if (o.district.stoves) d.stoves += DISTRICTS[INDEX[where]].stoves * o.district.stoves;
      if (o.district.pop) d.pop *= o.district.pop;
      if (o.district.traffic) d.traffic *= o.district.traffic;
    }
    for (const k of ["backslide", "windShare", "park", "tec2Approval", "income"]) if (o[k] !== undefined) mods[k] = (mods[k] ?? 1) * o[k];
    for (const k of ["strikeMood", "dust", "approvalWindow", "approvalDays"]) if (o[k] !== undefined) mods[k] = (mods[k] ?? 0) + o[k];
    for (const [k, v] of Object.entries(o.emit ?? {})) mods.emit[k] = (mods.emit[k] ?? 1) * v;
    for (const [k, v] of Object.entries(o.weaken ?? {})) mods.weaken[k] = v;
    if (o.burst) {
      const start = (y - 1) * YEAR + Math.round(o.burst.from[0] + fate(s) * (o.burst.from[1] - o.burst.from[0]));
      mods.burst = { start, end: start + o.burst.days, mult: o.burst.mult };
    }
  }
  s.mods = mods;
  s.decree = {
    year: y, title: def.title, tasks: def.tasks, obstacles: def.obstacles, where,
    unlocks: def.grants, // «Указом разрешено»: меры, открытые раньше пути мер
    startStoves: stovesBase(s, def.tasks),
  };
  s.pendingDecree = { year: y };
  log(s, "decree", `Указ президента на ${y}-й год: ${def.tasks.map(t => { const x = decreeTaskText(t); return x[0].toLowerCase() + x.slice(1); }).join("; ")}`);
  const fresh = def.grants.filter(id => !unlockStatus(s, id).ok);
  s.granted = [...new Set([...s.granted, ...def.grants])];
  for (const id of fresh) log(s, "unlock", `Указом разрешено: ${itemOf(id).name}`, null, { unlock: id });
}

export const decreeTaskText = t => SIM.decreeTasks[t.kind](t);
export const getObstacle = id => SIM.obstacles[id];

// Принять указ к исполнению: время идёт дальше.
export function acceptDecree(prev) {
  if (!prev.pendingDecree) throw new Error("no pending decree");
  return { ...copy(prev), pendingDecree: null };
}

// Подтвердить прогноз зимы.
export function ackForecast(prev) {
  if (!prev.pendingForecast) throw new Error("no pending forecast");
  return { ...copy(prev), pendingForecast: null };
}

const tec2Started = s => s.cityDone.includes("tec2gas") || s.building.some(b => b.id === "tec2gas");
const tec2Deadline = (s, t) => (s.decree.year - 1) * YEAR + t.by;

// Задача провалена? Возвращает { value, target, text } провала или null. final — проверка 1 января.
function taskFail(s, t, final) {
  if (t.kind === "winter") {
    if (!final || s.lastWinterAqi < t.aqi) return null;
    const v = Math.round(s.lastWinterAqi);
    return { value: v, target: t.aqi, text: `Указ не выполнен: зимой средний AQI ${v} при задаче ниже ${t.aqi}` };
  }
  if (t.kind === "stoves") {
    const done = 1 - totalStoves(s) / s.decree.startStoves;
    if (!final || done >= t.cut - 1e-9) return null;
    const p = Math.round(done * 100), need = Math.round(t.cut * 100);
    const was = p >= 0 ? `стало меньше на ${p}%` : `стало больше на ${-p}%`;
    return { value: done, target: t.cut, text: `Указ не выполнен: печей на угле ${was} при задаче ${need}%` };
  }
  if (t.kind === "tec2") {
    if (tec2Started(s) || s.day < tec2Deadline(s, t)) return null;
    return { value: null, target: t.by, text: "Указ не выполнен: перевод ТЭЦ-2 на газ так и не начат до осени" };
  }
  if (t.kind === "peak") {
    if (s.peakAqi <= t.aqi) return null;
    const v = Math.round(s.peakAqi);
    return { value: v, target: t.aqi, text: `Указ не выполнен: зимой AQI города дошёл до ${v} при задаче не выше ${t.aqi}` };
  }
  return null;
}

// Проверка указа: каждый день (tec2, peak) и 1 января (final, всё). Провал — сразу конец партии.
function checkDecree(s, final) {
  if (!s.decree || s.ended) return false;
  for (const t of s.decree.tasks) {
    const f = taskFail(s, t, final);
    if (f) {
      s.decreeFail = { kind: t.kind, ...f };
      log(s, "decree", f.text);
      end(s, "decree");
      return false;
    }
  }
  return true;
}

// Состояние указа для HUD: { year, title, tasks, obstacles, unlocks, daysLeft, risk }.
// Прогноз и состояние зимней задачи до зимы — ленивые геттеры: боты зовут decreeStatus каждый день ради daysLeft,
// прогноз им не нужен. Геттеры на прототипе: при { ...task } forecast, forecastBuilding и state теряются.
const winterGrade = (v, aqi) => (v < aqi - 4 ? "ok" : v < aqi ? "risk" : "bad");
class WinterForecastTask {
  #s; #by; #f = null;
  constructor(base, s, by) { Object.assign(this, base); this.value = null; this.#s = s; this.#by = by; }
  #calc() {
    return this.#f ?? (this.#f = { now: winterForecast(this.#s).aqi, built: winterForecast(this.#s, { includeBuilding: this.#by }).aqi });
  }
  get forecast() { return this.#calc().now; }
  get forecastBuilding() { return this.#calc().built; }
  get state() { return winterGrade(this.forecastBuilding, this.target); }
}
const RISK_ORDER = ["bad", "risk", "ok", "wait", "done"];
class DecreeStatus {
  constructor(fields) { Object.assign(this, fields); }
  get risk() { return this.tasks.map(t => t.state).sort((a, b) => RISK_ORDER.indexOf(a) - RISK_ORDER.indexOf(b))[0]; }
}

// Задача: { kind, text, target, value, state } — value: AQI зимы, AQI самого грязного дня, доля убранных печей
// или null; state: "done" (выполнена), "ok" (идёт к выполнению), "risk" (на грани), "bad" (к сроку не выйдет),
// "wait" (зима ещё не началась). risk — худшее из задач.
// Зимняя задача до зимы: forecast — прогноз AQI обычной зимы при нынешних мерах (winterForecast), forecastBuilding —
// со стройками, готовыми к середине зимы; state — по forecastBuilding. Зимой — value, средний AQI этой зимы.
export function decreeStatus(s) {
  if (!s.decree) return null;
  const y = s.decree.year;
  const end = y * YEAR, winterStart = end - SIM.DAYS_PER_SEASON;
  const daysLeft = Math.max(0, end - s.day);
  const inWinter = s.day >= winterStart && s.day < end;
  const tasks = s.decree.tasks.map(t => {
    const base = { kind: t.kind, text: decreeTaskText(t), target: t.kind === "stoves" ? t.cut : t.kind === "tec2" ? t.by : t.aqi };
    if (t.kind === "winter") {
      if (inWinter && s.lastWinterAqi !== null) return { ...base, value: s.lastWinterAqi, state: winterGrade(s.lastWinterAqi, t.aqi) };
      // До зимы — прогноз обычной зимы: при нынешних мерах и со стройками, которые будут готовы к середине зимы.
      return new WinterForecastTask(base, s, winterStart + SIM.DAYS_PER_SEASON / 2);
    }
    if (t.kind === "stoves") {
      const v = 1 - totalStoves(s) / s.decree.startStoves;
      const share = daysLeft / YEAR; // сколько года осталось: в конце года отставание уже не наверстать
      return { ...base, value: v, state: v >= t.cut ? "done" : v >= t.cut * (1 - share) - 0.02 ? "ok" : v >= t.cut * (0.6 - share) ? "risk" : "bad" };
    }
    if (t.kind === "tec2") {
      if (tec2Started(s)) return { ...base, value: null, state: "done", daysLeft: 0 };
      const left = tec2Deadline(s, t) - s.day;
      return { ...base, value: null, daysLeft: left, state: left > 60 ? "ok" : left > 20 ? "risk" : "bad" };
    }
    if (!inWinter) return { ...base, value: null, state: "wait" };
    const v = s.peakAqi;
    return { ...base, value: v, today: cityAqi(s), state: v > t.aqi ? "bad" : v > t.aqi - 12 ? "risk" : "ok" };
  });
  return new DecreeStatus({
    year: y, title: s.decree.title, tasks, daysLeft, where: s.decree.where,
    obstacles: s.decree.obstacles.map(id => ({ id, ...SIM.obstacles[id] })),
    unlocks: s.decree.unlocks,
  });
}

// Прогноз зимы: тип из rng судьбы, окно ждёт ackForecast, в ленте — строка.
function forecast(s) {
  let r = fate(s), type = "normal";
  for (const [k, w] of Object.entries(SIM.winters)) if ((r -= w.p) < 0) { type = k; break; }
  s.winter = type;
  s.winters.push({ year: gameYear(s), type });
  s.pendingForecast = { type };
  if (SIM.winters[type].disperse < 1 || SIM.winters[type].calm > 1) for (const d of s.districts) d.mood = clamp(d.mood + SIM.trust.badForecastMood, 0, 100);
  log(s, "forecast", `Прогноз на зиму: ${SIM.winters[type].name}. ${SIM.winters[type].text}`);
}

// --- режим НМУ ---

// { ok, reason, detail?, active, left, readyIn }: можно ли объявить режим НМУ сейчас.
export function nmuStatus(s) {
  const n = SIM.nmu;
  const out = { active: nmuOn(s), left: s.nmuLeft, readyIn: Math.max(0, s.nmuReadyDay - s.day) };
  if (s.ended) return { ...out, ok: false, reason: REASONS.over };
  if (out.active) return { ...out, ok: false, reason: REASONS.active };
  if (season(s) !== "winter") return { ...out, ok: false, reason: REASONS.winterOnly };
  if (out.readyIn > 0) return { ...out, ok: false, reason: REASONS.cooldown(out.readyIn) };
  if (!affordable(s, n.cost)) return { ...out, ...noMoney(s, n.cost) };
  return { ...out, ok: true, reason: null };
}

export function startNmu(prev) {
  if (!nmuStatus(prev).ok) throw new Error("cannot start НМУ");
  const s = copy(prev);
  const n = SIM.nmu;
  s.budget -= n.cost;
  s.nmuLeft = n.days;
  s.nmuReadyDay = s.day + n.days + n.cooldown;
  for (const d of s.districts) d.mood = clamp(d.mood + n.mood, 0, 100);
  s.airMeasures++;
  log(s, "action", `Режим НМУ на ${daysWord(n.days)}: меньше машин, ТЭЦ и печи на щадящем режиме`);
  return s;
}

// --- синергии ---

// Синергия действия a в районе d сейчас работает: в районе уже есть with (или район на готовой линии метро).
export function synergyActive(s, districtId, actionId) {
  const a = getAction(actionId);
  if (!a?.synergy) return false;
  const w = a.synergy.with;
  if (w === "metro") return s.cityDone.includes("metro") && getProject("metro").effect.districts.includes(districtId);
  return s.districts[INDEX[districtId]].done.includes(w);
}

// --- шаги дня ---

function emit(s) {
  // Преграда «пожар в степи»: летом пыль и дым в каждый район.
  const dust = season(s) === "summer" ? s.mods.dust ?? 0 : 0;
  for (let i = 0; i < s.districts.length; i++) s.districts[i].smog += emission(s, i) + dust;
  if (season(s) === "winter") tallyWinter(s);
}

// Сколько выбросил каждый источник зимой этой партии: ключи "plant:tec2", "stoves:turksib", "traffic:almaly".
function tallyWinter(s) {
  const add = (key, x) => { s.emitted[key] = (s.emitted[key] ?? 0) + x; };
  for (const p of s.plants) add(`plant:${p.id}`, plantOut(s, p));
  for (let i = 0; i < s.districts.length; i++) {
    const d = s.districts[i], e = emissionParts(s, i);
    add(`stoves:${d.id}`, e.stoves);
    add(`traffic:${d.id}`, e.traffic);
  }
}

// Зимой рассеивание зависит от типа зимы: снег вымывает частицы. Преграда «застройка предгорий» ослабляет парки.
function disperse(s) {
  const w = season(s) === "winter" ? winterType(s).disperse : 1;
  const keep = 1 - SIM.disperse[season(s)] * w * (s.wind === "calm" ? SIM.calmDisperse : 1);
  const pk = s.mods.park ?? 1;
  for (const d of s.districts) d.smog *= keep * (1 - (1 - d.park) * pk);
}

// Доля смога уходит соседям по ветру. Нет соседа: на юге горы — смог остаётся, на других краях уходит.
// ponytail: один ветер на весь город и на весь день; без скорости и без смешивания по диагонали.
function wind(s) {
  if (s.wind === "calm") return;
  const moved = new Array(s.districts.length).fill(0);
  s.districts.forEach((d, i) => {
    const to = NEIGHBORS[i][s.wind];
    if (!to.length && s.wind === "s") return;
    const out = d.smog * SIM.windShare * (s.mods.windShare ?? 1);
    moved[i] -= out;
    for (const j of to) moved[j] += out / to.length;
  });
  s.districts.forEach((d, i) => { d.smog = Math.max(0, d.smog + moved[i]); });
}

// Смог выше порога злит (зимой сильнее); чистый воздух понемногу успокаивает, но не выше потолка.
// Бонусы строек выветриваются, а с каждым годом люди всё больше устают от кризиса (SIM.trust).
function mood(s) {
  const T = SIM.trust, winter = T.smog[season(s)];
  const fatigue = T.fatigue * gameYear(s);
  for (const d of s.districts) {
    const over = aqiFromPm25(pmOf(s, d)) - SIM.aqiThreshold;
    if (over > 0) d.mood -= over * SIM.aqiMoodPerPoint * winter;
    else if (d.mood < SIM.moodCeiling) d.mood = Math.min(SIM.moodCeiling, d.mood + SIM.moodRecover);
    const f = d.fade / T.fadeDays;
    d.mood -= f + fatigue;
    d.fade -= f;
    d.mood = clamp(d.mood, 0, 100);
  }
}

// Радость временная: бонус настроения уходит в d.fade и выветривается (mood). Минусы остаются.
function cheer(d, x) {
  const before = d.mood;
  d.mood = clamp(d.mood + x, 0, 100);
  if (x > 0) d.fade += d.mood - before;
}

// Что сейчас тянет доверие вниз, в пунктах в день по городу (взвешено населением), сильнее сначала:
// [{ key: "smog" | "fatigue" | "fade" | "works" | "strike", perDay }]. Для подсказки в HUD: «что съедает доверие».
export function trustDrains(s) {
  const T = SIM.trust, pop = totalPop(s), winter = T.smog[season(s)];
  const out = { smog: 0, fatigue: T.fatigue * gameYear(s), fade: 0, works: 0, strike: 0 };
  for (const d of s.districts) {
    const w = d.pop / pop;
    out.smog += Math.max(0, aqiFromPm25(pmOf(s, d)) - SIM.aqiThreshold) * SIM.aqiMoodPerPoint * winter * w;
    out.fade += d.fade / T.fadeDays * w;
    if (d.strikeDays > T.strikeSpreadAfter) out.strike += T.strikeSpread * Object.values(DISTRICTS[INDEX[d.id]].neighbors).flat().length * w;
  }
  for (const b of s.building) {
    const p = b.kind === "city" && !(b.approval > 0) && !isPaused(s, b) ? getProject(b.id) : null;
    if (p?.works?.moodPerDay) out.works += p.works.moodPerDay * (p.effect.districts ? p.effect.districts.reduce((a, id) => a + s.districts[INDEX[id]].pop, 0) / pop : 1);
  }
  return Object.entries(out).filter(([, v]) => v > 0.001).map(([key, perDay]) => ({ key, perDay })).sort((a, b) => b.perDay - a.perDay);
}

// Копит средний AQI и PM2.5 зимы. Вызывается до s.day++, поэтому s.day — сегодняшний день.
function winterStats(s) {
  if (season(s) !== "winter") return;
  if (s.day % SIM.DAYS_PER_SEASON === 0) { s.winterSum = 0; s.winterPmSum = 0; s.winterDays = 0; s.peakAqi = 0; }
  s.winterSum += cityAqi(s);
  s.winterPmSum += cityPm25(s);
  s.winterDays++;
  s.lastWinterAqi = s.winterSum / s.winterDays;
  s.lastWinterPm25 = s.winterPmSum / s.winterDays;
  if (s.day < YEAR) { s.firstWinterAqi = s.lastWinterAqi; s.firstWinterPm25 = s.lastWinterPm25; }
}

function income(s) {
  s.budget += netIncome(s);
}

const pct = x => `${Math.round(x * 100)}%`;

// Сработавшая побочная причина: запись для финала и строка в ленте. weight — насколько это было заметно, для gameSummary.
function addChain(s, actionId, text, weight, district) {
  s.chains.push(district ? { day: s.day, district, actionId, text, weight } : { day: s.day, actionId, text, weight });
  log(s, "chain", text, district);
}

// Побочные причины, которые срабатывают при завершении действия в районе.
function sideEffects(s, a, d, before, factor, syn) {
  const name = nameOf(d.id);
  if (a.adoption) {
    d.since.gas = s.day;
    const adopted = (1 - factor) / (1 - a.effect.stoves);
    addChain(s, a.id, `${a.name}, ${name} район → котлы поставили в ${pct(adopted)} домов, печи −${pct(1 - factor)}, но установка и счета бьют по карману: настроение −${Math.abs(a.effect.mood)}`, before.stoves * (1 - adopted), d.id);
  }
  if (a.backfire) {
    d.since.coalban = s.day;
    const removed = before.stoves - d.stoves;
    d.delayed.push({ kind: "burn", day: s.day, at: s.day + Math.round(inRange(s, a.backfire.days)), share: inRange(s, a.backfire.share), removed });
  }
  if (a.repeat && d.listens > 1) {
    addChain(s, a.id, `Выслушать людей, ${name} район → уже ${d.listens}-й раз, причина недовольства никуда не делась, а следующий раз будет стоить ${actionCost(s, d.id, a.id)} млрд`, d.listens, d.id);
  }
  if (a.spill && syn?.spill === 0) d.since.parking = s.day;
  else if (a.spill) {
    d.since.parking = s.day;
    const removed = before.traffic - d.traffic;
    const near = [...new Set(Object.values(DISTRICTS[INDEX[d.id]].neighbors).flat())];
    for (const id of near) {
      const n = s.districts[INDEX[id]];
      n.traffic += removed * a.spill / near.length;
      n.since.parking = s.day;
    }
    addChain(s, a.id, `Платная парковка, ${name} район → машин там −${pct(1 - a.effect.traffic)}, но ${pct(a.spill)} снижения уехало к ${near.length} соседним районам`, removed * a.spill, d.id);
  }
}

// Отложенные последствия: запрет угля → через N дней люди жгут мусор.
function delayed(s) {
  for (const d of s.districts) {
    if (!d.delayed.length) continue;
    for (const x of d.delayed.filter(x => s.day >= x.at)) {
      const back = x.removed * x.share;
      d.stoves += back;
      d.since.coalban = s.day;
      addChain(s, "coalban", `${getAction("coalban").name}, ${nameOf(d.id)} район → через ${daysWord(s.day - x.day)} часть людей спряталась и начала жечь мусор → вернулось ${pct(x.share)} снижения выбросов`, back, d.id);
    }
    d.delayed = d.delayed.filter(x => s.day < x.at);
  }
}

// Готовая стройка может открыть следующие меры пути: в ленте «Открыто: …».
function complete(s, b) {
  const before = openedKeys(s);
  completeItem(s, b);
  for (const key of openedKeys(s)) {
    if (before.has(key)) continue;
    const [id, district] = key.split("@");
    log(s, "unlock", `Открыто: ${itemOf(id).name}${district ? `, ${nameOf(district)} район` : ""}`, district, { unlock: id });
  }
}

function completeItem(s, b) {
  if (b.kind === "district") {
    const a = getAction(b.id);
    const d = s.districts[INDEX[b.district]];
    const e = a.effect;
    const before = { stoves: d.stoves, traffic: d.traffic };
    // Синергия — «умное решение»: вместе с with в районе действие сильнее; преграда «угольное лобби» — слабее,
    // но не там, где синергия уже работает.
    const syn = synergyActive(s, d.id, a.id) ? a.synergy : null;
    let factor = syn?.stoves ?? e.stoves;
    if (a.adoption) factor = 1 - (1 - e.stoves) * (syn?.adoption ?? inRange(s, a.adoption));
    const weak = syn ? undefined : s.mods.weaken?.[a.id];
    if (factor !== undefined && weak) factor = 1 - (1 - factor) * weak;
    if (factor !== undefined) {
      if (e.ramp) d.ramps.push({ key: "stoves", perDay: factor ** (1 / e.ramp), left: e.ramp });
      else d.stoves *= factor;
    }
    if (e.traffic !== undefined) d.traffic *= syn?.traffic ?? e.traffic;
    if (e.parkDaily !== undefined) d.park *= e.parkDaily;
    if (a.adoption && syn) d.gasLocked = true;
    if (a.subsidy && d.done.includes("gas")) d.gasLocked = true;
    if (e.mood) cheer(d, e.mood);
    if (a.repeat) d.listens++;
    else d.done.push(a.id);
    if (a.adoption) d.gasCut += before.stoves * (1 - factor);
    if (a.subsidy) d.subsidyCut = before.stoves - d.stoves;
    if (a.truce) {
      d.mood = Math.max(d.mood, SIM.strikeMood); // до порога забастовки — без выветривания, сверх — бонус
      d.truceUntil = s.day + SIM.truceDays;
      d.striking = false;
    }
    s.upkeep += a.upkeep;
    log(s, a.days ? "built" : "action", `${a.name}: ${nameOf(b.district)}`, b.district);
    if (syn) addChain(s, `synergy:${a.id}`, `${a.name}, ${nameOf(d.id)} район → умное решение: ${syn.text.charAt(0).toLowerCase()}${syn.text.slice(1)}`, 4, d.id);
    if (weak) addChain(s, `weak:${a.id}`, `${a.name}, ${nameOf(d.id)} район → угольное лобби: печей убрали вдвое меньше, чем могли бы`, 2, d.id);
    sideEffects(s, a, d, before, factor, syn);
  } else {
    const p = getProject(b.id);
    const e = p.effect;
    if (b.works && p.works.traffic) for (const id of e.districts) s.districts[INDEX[id]].traffic /= p.works.traffic;
    if (b.moodLost) {
      const where = e.districts ? "на линии" : "в городе";
      addChain(s, p.id, `${p.name} → ${daysWord(b.days)} работ${p.works.traffic ? `, трафик на линии был +${pct(p.works.traffic - 1)}` : ""}, настроение ${where} −${fmt(b.moodLost)}`, b.moodLost);
    }
    if (p.upkeep >= 0.05) addChain(s, p.id, `${p.name} → содержание ${Math.round(p.upkeep * 1000)} млн в день, ${Math.round(p.upkeep * 360)} млрд в год`, p.upkeep * 100);
    for (const [id, m] of Object.entries(e.plants ?? {})) s.plants.find(pl => pl.id === id).mult *= m;
    if (e.traffic !== undefined) for (const id of e.districts) s.districts[INDEX[id]].traffic *= e.traffic;
    // синергия проекта: в районах проекта, где уже есть with, эффект сильнее
    const syn = p.synergy && (e.districts ?? []).filter(id => s.districts[INDEX[id]].done.includes(p.synergy.with));
    if (syn?.length) {
      for (const id of syn) s.districts[INDEX[id]].traffic *= p.synergy.traffic;
      addChain(s, `synergy:${p.id}`, `${p.name} → умное решение: автобусы подвозят к станциям, ${syn.map(nameOf).join(", ")}: машин ещё −${pct(1 - p.synergy.traffic)}`, 4);
    }
    if (e.mood) for (const d of s.districts) cheer(d, e.mood);
    s.cityDone.push(p.id);
    s.upkeep += p.upkeep;
    log(s, "built", `${p.name}: готово`);
  }
}

// Стройка стоит, если в её районе (или в районе проекта) забастовка.
export function isPaused(s, b) {
  const sites = b.kind === "district" ? [b.district] : getProject(b.id).sites ?? [];
  return sites.some(id => onStrike(s, s.districts[INDEX[id]]));
}

// Работы идут: настроение падает. Согласование и остановленная стройка настроение не трогают.
function worksDay(s, b) {
  const p = getProject(b.id);
  if (!p.works?.moodPerDay) return;
  const list = p.effect.districts ? p.effect.districts.map(id => s.districts[INDEX[id]]) : s.districts;
  for (const d of list) d.mood = clamp(d.mood - p.works.moodPerDay, 0, 100);
  b.moodLost = (b.moodLost ?? 0) + p.works.moodPerDay;
}

function build(s) {
  for (const b of s.building) {
    if (b.approval > 0) {
      if (--b.approval === 0) {
        if (b.kind === "city") {
          const p = getProject(b.id);
          addChain(s, b.id, `${p.name} → согласование с республикой заняло ${daysWord(b.waited)}, только потом началась стройка`, b.waited / 30);
        } else addChain(s, "bureaucracy", `${getAction(b.id).name}, ${nameOf(b.district)} район → бюрократия: ${daysWord(b.waited)} согласования до начала стройки`, 1, b.district);
      }
      continue;
    }
    if (isPaused(s, b)) continue;
    b.left--;
    if (b.kind === "city") worksDay(s, b);
  }
  for (const b of s.building.filter(b => b.left <= 0)) complete(s, b);
  s.building = s.building.filter(b => b.left > 0);
  for (const d of s.districts) {
    for (const r of d.ramps) { d[r.key] *= r.perDay; r.left--; }
    d.ramps = d.ramps.filter(r => r.left > 0);
  }
}

// Рост города: машин и людей больше с каждым годом; с года SIM.growthFrom каждый следующий год растёт быстрее.
function grow(s) {
  const k = 1 + SIM.growthStep * Math.max(0, gameYear(s) - SIM.growthFrom);
  for (const d of s.districts) {
    d.traffic *= 1 + SIM.growth.traffic * k;
    d.pop *= 1 + SIM.growth.pop * k;
    if (STOVE_DISTRICTS.includes(d.id)) d.stoves += DISTRICTS[INDEX[d.id]].stoves * SIM.growth.stoves * k;
  }
  // Вклад самого роста, без действий игрока: и в городе, где машин стало меньше, рост всё равно идёт.
  s.grownTraffic *= 1 + SIM.growth.traffic * k;
  s.grownStoves += SIM.growth.stoves * k;
  log(s, "growth", `Город растёт: машин +${+(SIM.growth.traffic * k * 100).toFixed(1)}%, жителей +${+(SIM.growth.pop * k * 100).toFixed(1)}%, новых домов на угле +${+(SIM.growth.stoves * k * 100).toFixed(1)}%`);
  // Автобусы: рост съедает часть эффекта. Запись одна на район: первый рост после маршрута.
  const bus = getAction("bus");
  for (const d of s.districts) {
    if (!d.done.includes("bus") || d.since.busGrowth !== undefined) continue;
    d.since.busGrowth = s.day;
    addChain(s, "bus", `Автобусы, ${nameOf(d.id)} район → убрали ${pct(1 - bus.effect.traffic)} машин, но за год рост вернул ${+(SIM.growth.traffic * k * 100).toFixed(1)}%`, d.traffic * SIM.growth.traffic * k, d.id);
  }
  const yearsGrown = gameYear(s) - 1;
  addChain(s, "growth", `Рост города → за ${yearsWord(yearsGrown)} сам по себе добавил ${pct(s.grownTraffic - 1)} машин и ${pct(s.grownStoves)} домов на угле в районах с печами`, yearsGrown);
}

// Начало нового года партии: проверка указа прошлого года, новый указ с преградами, цена газа, рост.
// Возвращает итог указа для отчёта или null, если указ провален (партия кончилась).
function newYear(s) {
  const y = gameYear(s);
  if (!checkDecree(s, true)) return null;
  const done = { decree: s.decree, endStoves: totalStoves(s), peak: s.peakAqi };
  s.decreesDone++;
  s.budget += SIM.decree.reward.budget;
  log(s, "decree", `Указ ${y - 1}-го года выполнен: бюджет +${SIM.decree.reward.budget} млрд`);
  s.winter = null;
  s.peakAqi = 0;
  issueDecree(s, y);
  gasPriceRise(s);
  grow(s);
  s.decree.startStoves = stovesBase(s, s.decree.tasks); // от 1 января, уже с новыми домами (или от назначения)
  return done;
}

// Раз в год газ дорожает: без субсидии часть тех, кто перешёл на котлы, возвращается на уголь.
function gasPriceRise(s) {
  const { rise } = SIM.gasPrice;
  const backslide = SIM.gasPrice.backslide * (s.mods.backslide ?? 1);
  for (const d of s.districts) {
    if (!d.gasCut || d.gasLocked || d.done.includes("gas-subsidy")) continue;
    const back = d.gasCut * backslide;
    d.gasCut -= back;
    d.stoves += back;
    d.mood = clamp(d.mood + SIM.trust.gasPriceMood, 0, 100);
    addChain(s, "gas-price", `Цена газа → подорожал на ${pct(rise)}, и в районе ${nameOf(d.id)} ${pct(backslide)} домов с новыми котлами вернулись на уголь`, back, d.id);
  }
}

// Реплика президента из отчёта: указ выполнен (иначе отчёта нет), выбор — по тому, что случилось за год.
function remark(s) {
  let key = "steady";
  if (s.budget < 0) key = "debt";
  else if (debtLeft(s) > SIM.loan.reportDays * grossIncome(s)) key = "loans";
  else if (rating(s) < SIM.reportLowTrust) key = "people";
  else if (s.districts.some(d => d.striking)) key = "strike";
  else if (airCleaner(s)) key = "air-good";
  else if (s.building.some(b => b.id === "tec2gas")) key = "tec2";
  const list = SIM.remarks[key];
  return list[(gameYear(s) - 2) % list.length];
}

// Итоги прошедшего года: { year, decree: { title, tasks: [{ text, kind, value, target }] }, reward, winter (тип зимы),
// winterAqi, winterPm25, airChange, trust, budget, remark }.
function yearReport(s, info) {
  const y = gameYear(s) - 1, d = info.decree;
  const tasks = d.tasks.map(t => ({
    kind: t.kind, text: decreeTaskText(t),
    value: t.kind === "winter" ? s.lastWinterAqi : t.kind === "stoves" ? 1 - info.endStoves / d.startStoves : t.kind === "peak" ? info.peak : null,
    target: t.kind === "stoves" ? t.cut : t.aqi ?? t.by,
  }));
  return {
    year: y, decree: { title: d.title, tasks }, reward: SIM.decree.reward.budget,
    winter: s.winters.find(w => w.year === y)?.type ?? null,
    winterAqi: s.lastWinterAqi, winterPm25: s.lastWinterPm25, airChange: airChange(s), trust: rating(s), budget: s.budget,
    remark: remark(s),
  };
}

// Подтвердить годовой отчёт: игра идёт дальше.
export function ackReport(prev) {
  if (!prev.pendingReport) throw new Error("no pending report");
  return { ...copy(prev), pendingReport: null };
}

function news(s, prevWind) {
  if (s.day % SIM.DAYS_PER_SEASON === 0) log(s, "season", SIM.seasonNews[season(s)]);
  // ponytail: в ленту попадает только зимний штиль — остальные смены ветра забили бы ленту
  if (s.wind === "calm" && prevWind !== "calm" && season(s) === "winter") log(s, "wind", "Штиль: смог повис над городом");
}

function end(s, why) {
  s.ended = why;
  s.phase = "ended";
  s.pendingEvent = null;
}

// PM2.5 последней (текущей) зимы к зиме до назначения: 0.8 — смог снижен на 20%. null, пока зим не было.
export function airChange(s) {
  return s.lastWinterPm25 === null ? null : s.lastWinterPm25 / SIM.baselineWinterPm25;
}

// Воздух стал заметно чище, чем до назначения (реплика отчёта).
function airCleaner(s) {
  const r = airChange(s);
  return r !== null && r <= 1 - SIM.airDrop;
}

const avg30 = s => (s.aqiDays.length ? s.aqiDays.reduce((a, b) => a + b, 0) / s.aqiDays.length : cityAqi(s));

// Шкала «Воздух»: { level: "ok" | "high" | "critical", avg30, threshold, countdown? }.
// critical — идёт обратный отсчёт; high — до порога осталось меньше highBelow.
export function airStatus(s) {
  const avg = avg30(s), c = SIM.critical;
  const out = { level: "ok", avg30: avg, threshold: c.threshold };
  if (s.criticalDays !== null) return { ...out, level: "critical", countdown: s.criticalDays };
  if (avg >= c.threshold - c.highBelow) out.level = "high";
  return out;
}

// Тревога одна на эпизод: началась выше порога, кончается ниже порога на clearBelow. Между ними отсчёт идёт.
function airWatch(s) {
  const c = SIM.critical, avg = avg30(s);
  if (s.criticalDays === null) {
    // Окно целиком после первого года: зима, которую аким не успел изменить, не считается.
    if (s.day < (c.fromYear - 1) * YEAR + c.windowDays || avg <= c.threshold) return;
    s.criticalDays = c.days;
    log(s, "warning", SIM.criticalAlarm(c.days));
    return;
  }
  if (avg <= c.threshold - c.clearBelow) {
    s.criticalDays = null;
    log(s, "air", SIM.criticalClear);
    return;
  }
  s.criticalDays--;
  if (s.criticalDays <= 0) end(s, "critical");
}

function endings(s) {
  if (s.ended) return;
  airWatch(s);
  if (s.ended) return;
  if (!checkDecree(s, false)) return;
  s.debtDays = s.budget < 0 ? s.debtDays + 1 : 0;
  if (s.debtDays === 1) log(s, "debt", `Бюджет в минусе: ${daysWord(SIM.debtDaysLimit)}, чтобы выбраться`);
  if (rating(s) < SIM.firedRating) end(s, "fired");
  else if (s.debtDays >= SIM.debtDaysLimit) end(s, "bankrupt");
}

// --- люди ---

// Почему район недоволен: по тому, что в нём происходит прямо сейчас, от самого свежего и прямого к общему.
function cause(s, d) {
  const recent = key => d.since[key] !== undefined && s.day - d.since[key] <= SIM.causeWindow;
  const works = id => s.building.some(b => b.kind === "city" && b.id === id && !(b.approval > 0));
  if (works("metro") && getProject("metro").effect.districts.includes(d.id)) return "roadworks";
  if (recent("coalban")) return "coalban";
  if (recent("gas")) return "tariff";
  if (recent("parking")) return "parking";
  if (aqiFromPm25(pmOf(s, d)) > SIM.aqiThreshold) return "smog";
  if (works("tec2gas")) return "plant-works";
  if (s.lastWinterAqi > SIM.aqiThreshold) return "last-winter";
  return "neglect";
}

// { protest, strike, cause }: cause — "roadworks" | "coalban" | "tariff" | "parking" | "smog" | "plant-works" |
// "last-winter" | "neglect", или null, если района ничего не злит настолько, чтобы выйти на митинг.
export function districtStatus(s, id) {
  const d = s.districts[INDEX[id]];
  const protest = d.mood < SIM.protestMood;
  return { protest, strike: onStrike(s, d), cause: protest ? cause(s, d) : null };
}

// Жители вымышленные; текст зависит только от причины и чисел этого района.
const COMPLAINTS = {
  roadworks: () => "Дорогу перекопали под метро, до работы теперь час",
  coalban: () => "За уголь штрафуют, а котёл нам не по карману. Соседи уже жгут мусор",
  tariff: () => "Котёл и новые трубы встали в копеечку, а теперь ещё и счета",
  parking: () => "С парковкой машин в наших дворах только прибавилось",
  smog: (s, d) => `На улице AQI ${aqiFromPm25(pmOf(s, d))}, дети кашляют. Когда это кончится?`,
  "plant-works": () => "Стройка на ТЭЦ идёт который месяц, а воздух пока тот же",
  "last-winter": s => `Прошлая зима была со средним AQI ${Math.round(s.lastWinterAqi)}. Мы всё помним`,
  neglect: () => "Про наш район будто забыли: ни стройки, ни ответа",
};

// Забастовки начинаются и кончаются, митингующие районы жалуются — не чаще, чем позволяют паузы.
function people(s) {
  const T = SIM.trust;
  const cool = s.day % SIM.listenCool === 0;
  for (const d of s.districts) {
    if (cool && d.listens > 0) d.listens--;
    const strike = onStrike(s, d);
    d.strikeDays = strike ? d.strikeDays + 1 : 0;
    // долгая забастовка расползается: соседи тоже теряют терпение
    if (d.strikeDays > T.strikeSpreadAfter) for (const id of Object.values(DISTRICTS[INDEX[d.id]].neighbors).flat()) {
      const n = s.districts[INDEX[id]];
      n.mood = clamp(n.mood - T.strikeSpread, 0, 100);
    }
    if (strike && !d.striking) {
      log(s, "strike", `${nameOf(d.id)}: люди на пределе. Доход от района в бюджет вдвое меньше, стройки стоят`, d.id);
      addChain(s, "strike", `${nameOf(d.id)} район: люди на пределе → настроение упало до ${Math.round(d.mood)}, доход от района в бюджет вдвое меньше, стройки там встали`, 3, d.id);
    }
    d.striking = strike;
  }
  if (s.day - s.complainedDay < SIM.complaintGapCity) return;
  const d = s.districts
    .filter(x => x.mood < SIM.protestMood && s.day - x.complainedDay >= SIM.complaintGapDistrict)
    .sort((a, b) => a.mood - b.mood)[0];
  if (!d) return;
  d.complainedDay = s.complainedDay = s.day;
  log(s, "complaint", `${nameOf(d.id)}: «${COMPLAINTS[cause(s, d)](s, d)}»`, d.id);
}

// --- события ---

// Условия done/notDone карточек из карточной версии переводятся на новые постройки.
const anyDone = id => s => s.districts.some(d => d.done.includes(id));
const LEGACY = {
  "tec-gas": s => s.cityDone.includes("tec2gas"),
  "stove-gas": anyDone("gas"),
  buses: anyDone("bus"),
  metro: s => s.cityDone.includes("metro"),
  "stove-subsidy": anyDone("boiler"),
};

// Карточка подходит: сезон совпадает; minTurn (ход = сезон в карточной версии) — не раньше дня minTurn × 90.
export function cardEligible(s, c) {
  const w = c.when ?? {};
  if (w.scripted) return false; // такие карточки не из общей колоды
  if (w.season && w.season !== season(s)) return false;
  if (w.minTurn && s.day < w.minTurn * SIM.DAYS_PER_SEASON) return false;
  if (w.done && !LEGACY[w.done](s)) return false;
  if (w.notDone && LEGACY[w.notDone](s)) return false;
  return true;
}

// Пора — выбрать карточку, не повторяя уже бывшие; если все подходящие уже были — любую подходящую.
function maybeEvent(s) {
  if (s.pendingReport || s.pendingDecree || s.pendingForecast) return; // сначала отчёт, указ и прогноз, событие подождёт
  if (!s.banEventDone && s.day >= SIM.banEventDay) {
    s.banEventDone = true;
    s.pendingEvent = { cardId: SIM.banEventCard };
    return;
  }
  if (s.day < s.nextEventDay) return;
  const ok = CARDS.filter(c => cardEligible(s, c));
  const fresh = ok.filter(c => !s.seenCards.includes(c.id));
  const pool = fresh.length ? fresh : ok;
  if (!pool.length) { s.nextEventDay = s.day + 1; return; }
  const c = pool[Math.floor(next(s) * pool.length)];
  s.seenCards.push(c.id);
  s.pendingEvent = { cardId: c.id };
}

// Эффект варианта карточки на город:
//   budget  → бюджет × SIM.eventBudget;
//   rating  → настроение каждого района (с обрезкой 0–100);
//   tec     → множитель выброса всех ТЭЦ × (1 + v / eventBase.tec);
//   stoves  → печи районов с печами (STOVE_DISTRICTS) × (1 + v / eventBase.stoves);
//   traffic → трафик всех районов × (1 + v / eventBase.traffic).
// Возвращает { budget?, mood?, tec?, stoves?, traffic? }: прибавки и множители — для подписи варианта в интерфейсе.
// streak — сколько раз подряд игрок выбирал ухудшение воздуха: контроль слабеет, каждое следующее бьёт сильнее.
export function eventEffects(effects, streak = 0) {
  const out = {};
  if (effects.budget) out.budget = effects.budget * SIM.eventBudget;
  if (effects.rating) out.mood = effects.rating;
  for (const k of ["tec", "stoves", "traffic"]) {
    const worse = Math.min(SIM.eventStreakMax, 1 + SIM.eventStreak * Math.max(0, streak - SIM.eventStreakFrom));
    if (effects[k]) out[k] = Math.max(0, 1 + effects[k] * (effects[k] > 0 ? worse : 1) / SIM.eventBase[k]);
  }
  return out;
}

// Сколько мер для воздуха нужно успеть начать в начале партии: { needed, done, deadlineDay };
// null, когда условие выполнено или день прошёл.
export function idleStatus(s) {
  if (s.airMeasures >= SIM.idle.needed || s.day > SIM.idle.deadlineDay) return null;
  return { needed: SIM.idle.needed, done: s.airMeasures, deadlineDay: SIM.idle.deadlineDay };
}

// Куда сдвинется воздух: "better" | "worse", без чисел. Вариант карточки ({ effects }), действие или проект ({ effect }).
export function airHint(item) {
  let x = 0;
  if (item.effects) {
    const e = item.effects;
    x = (e.tec ?? 0) + (e.stoves ?? 0) + (e.traffic ?? 0);
  } else {
    const e = item.effect;
    for (const m of [e.stoves, e.traffic, e.parkDaily, ...Object.values(e.plants ?? {})]) if (m !== undefined) x += m - 1;
  }
  return x < 0 ? "better" : "worse";
}

export function resolveEvent(prev, optionIndex) {
  if (!prev.pendingEvent) throw new Error("no pending event");
  const c = getCard(prev.pendingEvent.cardId);
  const o = c.options[optionIndex];
  if (!o) throw new Error(`bad option ${optionIndex} for ${c.id}`);
  const s = copy(prev);
  const e = eventEffects(o.effects, s.airStreak);
  s.airStreak = airHint(o) === "worse" ? s.airStreak + 1 : 0;
  if (e.budget) s.budget += e.budget;
  for (const d of s.districts) {
    if (e.mood) cheer(d, e.mood);
    if (e.traffic) d.traffic *= e.traffic;
    if (e.stoves && STOVE_DISTRICTS.includes(d.id)) d.stoves *= e.stoves;
  }
  if (e.tec) for (const p of s.plants) p.mult *= e.tec;
  if (c.when?.scripted) addChain(s, c.id, `Запрет твёрдого топлива → вы выбрали: «${o.label}»`, 2);
  s.pendingEvent = null;
  s.nextEventDay = s.day + eventGap(s);
  log(s, "event", `${c.who}: ${o.label}`);
  return s;
}

// Текст концовки для финала. Президент здесь только должность.
export function endingText(s) {
  if (s.ended === "decree") return `${s.decreeFail.text}. ${SIM.decreeTail}`;
  return SIM.endingText[s.ended] ?? null;
}

// Отменить субсидию: бюджет вздохнёт, но печи вернутся, а район обидится.
export function cancelSubsidy(prev, districtId) {
  const d0 = prev.districts[INDEX[districtId]];
  if (!d0 || !d0.done.includes("gas-subsidy")) throw new Error(`no subsidy in ${districtId}`);
  if (prev.phase !== "play") throw new Error("cannot cancel now");
  const s = copy(prev);
  const d = s.districts[INDEX[districtId]];
  const a = getAction("gas-subsidy");
  const back = d.subsidyCut;
  d.stoves += back;
  d.subsidyCut = 0;
  d.done = d.done.filter(id => id !== "gas-subsidy");
  d.mood = clamp(d.mood + a.cancelMood, 0, 100);
  s.upkeep -= a.upkeep;
  addChain(s, a.id, `${a.name}, ${nameOf(d.id)} район → отменили: бюджет сэкономил ${Math.round(a.upkeep * 360)} млрд в год, а печи вернулись, настроение −${Math.abs(a.cancelMood)}`, back, d.id);
  return s;
}

// Уйти в отставку можно только из годового отчёта.
export function retire(prev) {
  if (!prev.pendingReport || prev.phase !== "play") throw new Error("retire only from the annual report");
  const s = copy(prev);
  s.pendingReport = null;
  s.pendingDecree = null;
  end(s, "retired");
  return s;
}

// Явная копия вместо structuredClone: тик в 3 раза дешевле, а боты гоняют сотни партий.
// Новое поле состояния со вложенными объектами нужно добавить и сюда; тест неизменяемости
// в test/sim.mjs проверяет tick, act и cityProject на состоянии со стройками, разгоном и готовым проектом.
// pendingEvent не копируется: его только заменяют целиком.
function copy(s) {
  return {
    ...s,
    districts: s.districts.map(d => ({
      ...d, done: [...d.done], ramps: d.ramps.map(r => ({ ...r })), since: { ...d.since }, delayed: d.delayed.map(x => ({ ...x })),
    })),
    plants: s.plants.map(p => ({ ...p })),
    building: s.building.map(b => ({ ...b })),
    cityDone: [...s.cityDone],
    seenCards: [...s.seenCards],
    winters: [...s.winters], // записи не меняются
    // decree и mods не меняются после выдачи указа: их заменяют целиком
    aqiDays: [...s.aqiDays],
    emitted: { ...s.emitted },
    chains: [...s.chains], // записи цепочек не меняются
    log: [...s.log], // записи лога не меняются
    loans: s.loans.map(l => ({ ...l })),
  };
}

export function tick(prev) {
  if (prev.phase !== "play") throw new Error(`not playing: ${prev.ended ?? prev.phase}`);
  if (prev.pendingEvent) throw new Error(`event pending: ${prev.pendingEvent.cardId}`);
  if (prev.pendingReport) throw new Error(`report pending: year ${prev.pendingReport.year}`);
  if (prev.pendingDecree) throw new Error(`decree pending: year ${prev.pendingDecree.year}`);
  if (prev.pendingForecast) throw new Error("forecast pending");
  const s = copy(prev);
  emit(s);
  disperse(s);
  wind(s);
  winterStats(s);
  const aqiToday = cityAqi(s);
  if (season(s) === "winter") s.peakAqi = Math.max(s.peakAqi, aqiToday);
  if (s.nmuLeft > 0) s.nmuLeft--;
  s.aqiDays.push(aqiToday);
  if (s.aqiDays.length > SIM.critical.windowDays) s.aqiDays.shift();
  mood(s);
  income(s);
  if (s.wind === "calm") s.calmDays++;
  s.day++; // дальше всё, что попадёт в ленту, датировано новым днём
  repayLoans(s);
  if (s.day % SIM.DAYS_PER_SEASON === 0) s.calmDays = 0;
  if (s.day === SIM.idle.deadlineDay && s.airMeasures < SIM.idle.needed) end(s, "idle");
  // До строек: указ прошлого года проверяется по состоянию на конец года
  const yearInfo = s.phase === "play" && s.day % YEAR === 0 ? newYear(s) : null;
  if (s.phase === "play" && s.day % YEAR === SIM.forecastDay) forecast(s);
  if (s.phase === "play") {
    build(s);
    delayed(s);
    people(s);
  }
  endings(s);
  // Год закончился, указ выполнен: итоги записаны, а окно ждёт подтверждения, только если игра идёт дальше.
  if (yearInfo) {
    s.lastReport = yearReport(s, yearInfo);
    if (s.phase === "play") s.pendingReport = s.lastReport;
  }
  const prevWind = s.wind;
  rollWind(s); // ветер следующего дня — его и показывает интерфейс
  news(s, prevWind);
  if (s.phase === "play") maybeEvent(s);
  return s;
}

// --- действия игрока ---

// Бесплатные действия доступны всегда, даже в долг.
const affordable = (s, cost) => cost === 0 || s.budget - cost >= -SIM.creditLimit;

// Текущая цена: у повторяемых растёт с каждым разом в этом районе.
export function actionCost(s, districtId, actionId) {
  const a = getAction(actionId);
  if (!a?.repeat) return a?.cost;
  return Math.round(a.cost * a.costGrowth ** s.districts[INDEX[districtId]].listens);
}

function noMoney(s, cost) {
  const shortfall = Math.ceil(cost - SIM.creditLimit - s.budget);
  const income = netIncome(s);
  if (income <= 0) return { ok: false, reason: REASONS.noMoney, shortfall, detail: REASONS.shortfallNever(shortfall) };
  const daysUntil = Math.ceil(shortfall / income);
  return { ok: false, reason: REASONS.noMoney, shortfall, daysUntil, detail: REASONS.shortfall(shortfall, daysUntil) };
}

// --- путь мер ---

const itemOf = id => getAction(id) ?? getProject(id);

// Сколько раз готово: проект — 0 или 1, мера района — в этом районе (where "same") или во скольких районах.
function doneCount(s, id, where, districtId) {
  if (getProject(id)) return s.cityDone.includes(id) ? 1 : 0;
  if (where === "same") return s.districts[INDEX[districtId]].done.includes(id) ? 1 : 0;
  return s.districts.filter(d => d.done.includes(id)).length;
}

function needText(r, districtId) {
  const name = itemOf(r.action).name;
  if (r.count > 1) return `${r.label ?? `${name} ×${r.count}`} (готово ${r.have})`;
  if (getProject(r.action)) return name;
  return r.where === "same" ? `${name}${districtId ? " в этом районе" : " в районе"}` : `${name} (в любом районе)`;
}

// Открыта ли мера: { ok, needs, text?, progress? }. needs — чего не хватает: [{ action, count, have, where, label? }];
// text — «откроется после: …»; progress — { have, count } первой нехватки (для «1/2» на карточке).
// Мера с where "same" без districtId — открыта ли хоть в одном районе.
export function unlockStatus(s, id, districtId) {
  const item = itemOf(id);
  if (!item) throw new Error(`unknown action ${id}`);
  if (!item.requires?.length || s.granted?.includes(id)) return { ok: true, needs: [] };
  if (!districtId && item.requires.some(r => r.where === "same")) {
    const open = s.districts.find(d => unlockStatus(s, id, d.id).ok);
    if (open) return { ok: true, needs: [] };
  }
  const needs = item.requires
    .map(r => ({ ...r, count: r.count ?? 1 }))
    .map(r => ({ ...r, have: Math.min(r.count, districtId || r.where !== "same" ? doneCount(s, r.action, r.where, districtId) : 0) }))
    .filter(r => r.have < r.count);
  if (!needs.length) return { ok: true, needs: [] };
  return { ok: false, needs, text: REASONS.locked(needs.map(r => needText(r, districtId))), progress: { have: needs[0].have, count: needs[0].count } };
}

// Ключи открытых мер с requires: "gas", "metro", "gas-subsidy@turksib" (where "same" — по районам).
function openedKeys(s) {
  const keys = new Set();
  for (const a of [...DISTRICT_ACTIONS, ...CITY_PROJECTS]) {
    if (!a.requires?.length) continue;
    if (a.requires.some(r => r.where === "same")) { for (const d of s.districts) if (unlockStatus(s, a.id, d.id).ok) keys.add(`${a.id}@${d.id}`); }
    else if (unlockStatus(s, a.id).ok) keys.add(a.id);
  }
  return keys;
}

// { ok, reason, shortfall?, daysUntil?, detail?, locked?, needs?, progress? }. reason — короткая, detail — с числами для подписи.
// Закрытая путём мера: locked true, reason «откроется после: …», needs и progress — из unlockStatus.
function status(s, item, cost, done, building, districtId) {
  if (s.ended) return { ok: false, reason: REASONS.over };
  if (done) return { ok: false, reason: REASONS.done };
  if (building) return { ok: false, reason: REASONS.building };
  const lock = unlockStatus(s, item.id, districtId);
  if (!lock.ok) return { ok: false, reason: lock.text, locked: true, needs: lock.needs, progress: lock.progress };
  if (!affordable(s, cost)) return noMoney(s, cost);
  return { ok: true, reason: null };
}

// { ok, reason } — можно ли сейчас сделать действие в районе и почему нет. Неизвестный id — ошибка.
export function actStatus(s, districtId, actionId) {
  const a = getAction(actionId);
  const d = s.districts[INDEX[districtId]];
  if (!a || !d) throw new Error(`unknown action ${actionId} or district ${districtId}`);
  const building = s.building.some(b => b.kind === "district" && b.district === districtId && b.id === actionId);
  return status(s, a, actionCost(s, districtId, actionId), d.done.includes(actionId), building, districtId);
}

export function canAct(s, districtId, actionId) {
  return actStatus(s, districtId, actionId).ok;
}

function start(prev, b, cost, days) {
  const s = copy(prev);
  s.budget -= cost;
  if (airHint(b.kind === "city" ? getProject(b.id) : getAction(b.id)) === "better") s.airMeasures++;
  if (days === 0) complete(s, b);
  else {
    const site = b.kind === "city" ? startProject(s, b, days) : { ...b, left: days, days };
    // Преграда «бюрократия»: в первые дни года любая стройка сначала согласуется
    if (s.mods.approvalDays && s.day % YEAR < s.mods.approvalWindow) {
      site.approval = (site.approval ?? 0) + s.mods.approvalDays;
      site.waited = (site.waited ?? 0) + s.mods.approvalDays;
    }
    s.building.push(site);
  }
  return s;
}

// Проект: ждёт согласования или сразу открывает работы.
function startProject(s, b, days) {
  const p = getProject(b.id);
  const site = { ...b, left: days, days };
  if (p.approval) site.waited = site.approval = Math.round(inRange(s, p.approval) * (p.id === "tec2gas" ? s.mods.tec2Approval ?? 1 : 1));
  if (p.works?.traffic) {
    site.works = true;
    for (const id of p.effect.districts) s.districts[INDEX[id]].traffic *= p.works.traffic;
    addChain(s, p.id, `${p.name} → дороги перекопаны на ${daysWord(days)}, трафик на линии +${pct(p.works.traffic - 1)}`, days / 30);
  }
  return site;
}

export function act(prev, districtId, actionId) {
  if (!canAct(prev, districtId, actionId)) throw new Error(`cannot act: ${actionId} in ${districtId}`);
  const a = getAction(actionId);
  return start(prev, { kind: "district", id: actionId, district: districtId }, actionCost(prev, districtId, actionId), a.days);
}

export function projectStatus(s, projectId) {
  const p = getProject(projectId);
  if (!p) throw new Error(`unknown project ${projectId}`);
  return status(s, p, p.cost, s.cityDone.includes(projectId), s.building.some(b => b.kind === "city" && b.id === projectId));
}

export function canProject(s, projectId) {
  return projectStatus(s, projectId).ok;
}

export function cityProject(prev, projectId) {
  if (!canProject(prev, projectId)) throw new Error(`cannot start project: ${projectId}`);
  const p = getProject(projectId);
  return start(prev, { kind: "city", id: projectId }, p.cost, p.days);
}

// --- итог для финала ---

const SUMMARY_CHAINS = 5;

// Что могло снизить источник. Источник без рычагов (ТЭЦ-1 уже на газе) в итог не попадает: тут не в чем упрекать.
function levers(kind, id) {
  if (kind === "plant") return CITY_PROJECTS.filter(p => p.effect.plants?.[id] !== undefined);
  if (kind === "stoves") return DISTRICT_ACTIONS.filter(a => a.effect.stoves < 1); // «выслушать» печи не снижает
  return [
    ...DISTRICT_ACTIONS.filter(a => a.effect.traffic !== undefined),
    ...CITY_PROJECTS.filter(p => p.effect.districts?.includes(id)),
  ];
}

const isCityProject = item => CITY_PROJECTS.includes(item);

// Игрок пробовал этот рычаг: достроил или начал. Город — один на всех, район — только свой.
function tried(s, item, id) {
  if (isCityProject(item)) return s.cityDone.includes(item.id) || s.building.some(b => b.kind === "city" && b.id === item.id);
  const d = s.districts[INDEX[id]];
  return d.done.includes(item.id) || s.building.some(b => b.kind === "district" && b.district === id && b.id === item.id);
}

function untouchedText(kind, id, share) {
  if (kind === "plant") return `${PLANTS.find(p => p.id === id).name} давала ${pct(share)} зимних выбросов, вы к ней не подступились`;
  const what = kind === "stoves" ? "Печи" : "Машины";
  return `${what}, ${nameOf(id)} район: ${pct(share)} зимних выбросов, ничего не сделано`;
}

// До трёх самых больших источников, которых игрок не коснулся: доля — от зимних выбросов этой партии.
// Только если рычаг уже был открыт, а источник не меньше SIM.untouchedMinShare. До первой зимы долей ещё нет.
function untouched(s) {
  const total = Object.values(s.emitted).reduce((a, b) => a + b, 0);
  if (!total) return [];
  return Object.entries(s.emitted)
    .map(([key, x]) => {
      const [kind, id] = key.split(":");
      return { kind, id, share: x / total };
    })
    .filter(({ kind, id, share }) => {
      const list = levers(kind, id);
      return share >= SIM.untouchedMinShare && list.some(a => unlockStatus(s, a.id).ok) && !list.some(a => tried(s, a, id));
    })
    .sort((a, b) => b.share - a.share)
    .slice(0, SIM.untouchedMax)
    .map(({ kind, id, share }) => ({ kind, id, share, text: untouchedText(kind, id, share) }));
}

// { chains, unaffordable, unfinished, untouched, yearDaysLeft, loans }:
// loans — { taken, interest, left }: сколько занято, сколько из выплаченного ушло на проценты, сколько ещё должны; null, если кредитов не было.
// untouched — до 3 источников без единого действия игрока: { kind: "plant" | "stoves" | "traffic", id, share 0..1, text };
//   id — ТЭЦ для plant и район для остальных.
// chains — до 5 самых заметных сработавших цепочек, по одной на действие, в порядке дней: { day, district?, actionId, text };
// unaffordable — самое дорогое из открытого, что не начато и на что сейчас нет денег: { id, name, cost, shortfall } или null;
// unfinished — что не успели достроить, дольше всего оставшееся сначала:
//   { id, name, kind, district?, days, left, waiting }; waiting — дней до конца согласования.
export function gameSummary(s) {
  const best = new Map();
  for (const c of s.chains) if (!best.has(c.actionId) || c.weight > best.get(c.actionId).weight) best.set(c.actionId, c);
  // Рост копится: берём последнюю, самую полную запись
  const growth = s.chains.filter(c => c.actionId === "growth").at(-1);
  if (growth) best.set("growth", growth);
  const chains = [...best.values()]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, SUMMARY_CHAINS)
    .sort((a, b) => a.day - b.day)
    .map(({ weight, ...c }) => c);
  const unaffordable = CITY_PROJECTS
    .filter(p => unlockStatus(s, p.id).ok && !s.cityDone.includes(p.id) && !s.building.some(b => b.kind === "city" && b.id === p.id) && s.budget - p.cost < -SIM.creditLimit)
    .sort((a, b) => b.cost - a.cost)
    .map(p => ({ id: p.id, name: p.name, cost: p.cost, shortfall: Math.ceil(p.cost - SIM.creditLimit - s.budget) }))[0] ?? null;
  const unfinished = s.building
    .map(b => {
      const item = b.kind === "city" ? getProject(b.id) : getAction(b.id);
      const base = { id: b.id, name: item.name, kind: b.kind, days: b.days, left: b.left, waiting: b.approval ?? 0 };
      return b.district ? { ...base, district: b.district } : base;
    })
    .sort((a, b) => b.left + b.waiting - a.left - a.waiting);
  const loans = s.loanTaken ? { taken: s.loanTaken, interest: s.loanPaid * SIM.loan.rate / (1 + SIM.loan.rate), left: debtLeft(s) } : null;
  return { chains, unaffordable, unfinished, untouched: untouched(s), yearDaysLeft: YEAR - (s.day % YEAR), loans };
}
