import assert from "node:assert/strict";
import { DISTRICTS, PLANTS } from "../src/data/city.js";
import { DISTRICT_ACTIONS, CITY_PROJECTS } from "../src/data/actions.js";
import { SIM, SEASONS } from "../src/data/sim-balance.js";
import { CARDS, REACTIONS } from "../src/data/cards.js";
import { SOURCES } from "../src/data/sources.js";
import {
  newCity, tick as rawTick, act, canAct, cityProject, canProject, cityPm25, districtPm25, aqiFromPm25, getAction, getProject, rating,
  districtEmission, netIncome, actStatus, projectStatus, resolveEvent, getCard, gameYear, districtStatus, REASONS, airChange, airHint,
  acceptDecree, ackForecast, ackReport, startNmu, nmuStatus, decreeStatus, synergyActive, actionCost, cityAqi, windLinks, unlockStatus,
  takeLoan, loanOptions, loanFor,
} from "../src/sim.js";

const t0 = Date.now();
// Отчёт, указ и прогноз подтверждаются сами.
const tick = s => rawTick(s.pendingReport || s.pendingDecree || s.pendingForecast ? { ...s, pendingReport: null, pendingDecree: null, pendingForecast: null } : s);
// Проверки механики без указов: задачи пустые (погода и преграды остаются). Боты указов — с настоящими.
const DECREE = structuredClone(SIM.decree);
const noDecrees = () => { for (const y of SIM.decree.years) y.tasks = []; SIM.decree.pool = [{ kind: "winter", aqi: 1e9, step: 0 }]; };
const realDecrees = () => Object.assign(SIM.decree, structuredClone(DECREE));

// --- данные ---
const OPP = { n: "s", s: "n", w: "e", e: "w" };
const ids = DISTRICTS.map(d => d.id);
assert.equal(new Set(ids).size, 8, "8 unique districts");
for (const d of DISTRICTS) {
  assert.ok(d.name && d.pop > 0 && d.stoves >= 0 && d.traffic >= 0, `${d.id}: bad fields`);
  for (const [dir, list] of Object.entries(d.neighbors)) {
    assert.ok(OPP[dir], `${d.id}: bad direction ${dir}`);
    for (const n of list) {
      const other = DISTRICTS.find(x => x.id === n);
      assert.ok(other, `${d.id}: unknown neighbor ${n}`);
      assert.ok(other.neighbors[OPP[dir]]?.includes(d.id), `${d.id}.${dir} = ${n}, but ${n}.${OPP[dir]} lacks ${d.id}`);
    }
  }
}
// горы на юге: у южных районов нет соседа на юге
for (const id of ["nauryzbay", "bostandyk", "medeu"]) assert.ok(!DISTRICTS.find(d => d.id === id).neighbors.s, `${id}: mountains in the south`);
for (const p of PLANTS) assert.ok(ids.includes(p.district) && p.emission > 0, `${p.id}: bad plant`);

for (const a of [...DISTRICT_ACTIONS, ...CITY_PROJECTS]) assert.ok(a.sideEffect?.length > 10, `${a.id}: needs a sideEffect for the card`);
const DISTRICT_KEYS = ["stoves", "traffic", "mood", "parkDaily", "ramp"];
const CITY_KEYS = ["plants", "traffic", "districts", "mood"];
for (const a of DISTRICT_ACTIONS) {
  assert.ok(a.name && a.cost >= 0 && Number.isInteger(a.days) && a.days >= 0 && a.upkeep >= 0, `${a.id}: bad action`);
  for (const k of Object.keys(a.effect)) assert.ok(DISTRICT_KEYS.includes(k), `${a.id}: unknown effect ${k}`);
}
for (const p of CITY_PROJECTS) {
  assert.ok(p.name && p.cost > 0 && p.days > 0 && p.upkeep >= 0, `${p.id}: bad project`);
  for (const k of Object.keys(p.effect)) assert.ok(CITY_KEYS.includes(k), `${p.id}: unknown effect ${k}`);
  for (const id of Object.keys(p.effect.plants ?? {})) assert.ok(PLANTS.some(pl => pl.id === id), `${p.id}: unknown plant ${id}`);
  for (const id of p.effect.districts ?? []) assert.ok(ids.includes(id), `${p.id}: unknown district ${id}`);
  assert.equal(p.effect.traffic !== undefined, p.effect.districts !== undefined, `${p.id}: traffic needs districts`);
}
// Путь мер: открыто с начала — как в спеке; requires ссылаются на настоящие меры, без циклов; года больше нет
const ALL = [...DISTRICT_ACTIONS, ...CITY_PROJECTS];
assert.deepEqual(ALL.filter(a => !a.requires).map(a => a.id).sort(), ["boiler", "bus", "filters", "listen", "park"]);
for (const a of ALL) {
  assert.equal(a.year, undefined, `${a.id}: unlocks go by the tree, not by year`);
  for (const r of a.requires ?? []) {
    assert.ok(ALL.some(x => x.id === r.action), `${a.id}: unknown prerequisite ${r.action}`);
    assert.ok(["any", "same", undefined].includes(r.where), `${a.id}: bad where`);
    assert.ok(!(r.count > 1) || r.label, `${a.id}: count > 1 needs a label`);
  }
  const seen = new Set();
  const walk = id => { assert.ok(!seen.has(id), `${a.id}: prerequisite cycle`); seen.add(id); for (const r of ALL.find(x => x.id === id).requires ?? []) walk(r.action); seen.delete(id); };
  walk(a.id);
}
for (const y of SIM.decree.years) for (const id of y.grants ?? []) assert.ok(ALL.some(x => x.id === id && x.requires), `decree grants ${id}: must be a locked measure`);
for (const k of ["heat", "plantHeat", "disperse"]) assert.deepEqual(Object.keys(SIM[k]).sort(), [...SEASONS].sort(), `${k}: every season`);
console.log(`city data ok: ${DISTRICTS.length} districts, ${PLANTS.length} plants, ${DISTRICT_ACTIONS.length} actions, ${CITY_PROJECTS.length} projects`);

// --- карточки событий и источники ---
// Карточки из карточной версии: эффекты по старым показателям, условия по старым проектам.
// На город их переводит sim.js (eventEffects, cardEligible).
{
  const STATS = ["budget", "rating", "tec", "stoves", "traffic"];
  const WHEN_KEYS = ["season", "minTurn", "done", "notDone", "scripted"];
  const LEGACY_PROJECTS = ["tec-gas", "stove-gas", "buses", "metro", "stove-subsidy"];
  const TURNS = 16; // 4 года × 4 сезона
  const nums = o => Object.values(o).every(Number.isFinite);
  const seen = new Set();
  for (const c of CARDS) {
    assert.ok(!seen.has(c.id), `duplicate card id: ${c.id}`);
    seen.add(c.id);
    assert.ok(c.who && c.text, `${c.id}: who/text required`);
    assert.equal(c.options.length, 2, `${c.id}: needs exactly 2 options`);
    for (const o of c.options) {
      assert.ok(o.label, `${c.id}: option label required`);
      for (const k of Object.keys(o.effects)) assert.ok(STATS.includes(k), `${c.id}: unknown stat ${k}`);
      assert.ok(nums(o.effects), `${c.id}: non-numeric effect`);
    }
    const w = c.when ?? {};
    for (const k of Object.keys(w)) assert.ok(WHEN_KEYS.includes(k), `${c.id}: unknown condition ${k}`);
    if (w.season) assert.ok(SEASONS.includes(w.season), `${c.id}: bad season ${w.season}`);
    const from = w.minTurn ?? 0;
    assert.ok(Number.isInteger(from), `${c.id}: minTurn must be an integer`);
    let fires = false;
    for (let t = from; t < TURNS; t++) if (!w.season || SEASONS[t % 4] === w.season) fires = true;
    assert.ok(fires, `${c.id}: season/minTurn combination never fires`);
    assert.ok(!w.done || w.done !== w.notDone, `${c.id}: done and notDone on same project`);
    for (const k of ["done", "notDone"]) if (w[k]) assert.ok(LEGACY_PROJECTS.includes(w[k]), `${c.id}: unknown project ${w[k]}`);
  }
  // Игра про воздух: у каждого варианта каждой карточки и у каждого действия есть влияние на выбросы.
  const airKeys = ["tec", "stoves", "traffic"];
  for (const c of CARDS) for (const o of c.options) {
    const x = airKeys.reduce((a, k) => a + (o.effects[k] ?? 0), 0);
    assert.notEqual(x, 0, `${c.id}, "${o.label}": no net air effect`);
    assert.equal(airHint(o), x < 0 ? "better" : "worse", `${c.id}, "${o.label}": hint`);
    for (const k of airKeys) if (o.effects[k]) assert.equal(Math.sign(o.effects[k]), Math.sign(x), `${c.id}, "${o.label}": mixed air signs mislead the hint`);
  }
  for (const a of [...DISTRICT_ACTIONS, ...CITY_PROJECTS]) {
    const e = a.effect;
    const air = [e.stoves, e.traffic, e.parkDaily, ...Object.values(e.plants ?? {})].filter(m => m !== undefined && m !== 1);
    assert.ok(air.length > 0, `${a.id}: no air effect`);
    assert.equal(airHint(a), a.id === "listen" ? "worse" : "better", `${a.id}: hint`);
  }
  for (const band of ["clean", "meh", "smog"]) assert.ok(REACTIONS[band]?.length, `no reactions for ${band}`);
  for (const x of SOURCES) assert.ok(x.title && x.url.startsWith("https://"), `bad source: ${x.title}`);
  assert.ok(SOURCES.length >= 3, "need at least 3 sources for the final screen");
  console.log(`cards ok: ${CARDS.length} cards, ${SOURCES.length} sources`);
}

// --- общее ---
const lcg = seed => { let r = seed; return () => ((r = (Math.imul(r, 1664525) + 1013904223) >>> 0) / 4294967296); };
const pct = x => `${Math.round(x * 100)}%`;
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const median = a => [...a].sort((x, y) => x - y)[a.length >> 1];
const YEAR = SIM.DAYS_PER_SEASON * 4;
const SEASON_DAYS = SIM.DAYS_PER_SEASON;

// Партия целиком. decide — действия перед каждым днём, event — номер варианта для события.
// Указ, прогноз и отчёт принимаются сами. maxDay — потолок для проверок механики без указов.
// decrees — что выдавали по годам (для проверки детерминизма); trust — доверие горожан по дням.
function play(seed, { decide = x => x, event = () => 0, check, maxDay = Infinity } = {}) {
  let s = newCity(seed);
  const decrees = {}, trust = [];
  while (!s.ended && s.day < maxDay) {
    if (s.pendingDecree) {
      decrees[s.decree.year] = JSON.stringify({ tasks: s.decree.tasks, obstacles: s.decree.obstacles, where: s.decree.where });
      s = acceptDecree(s);
      continue;
    }
    if (s.pendingForecast) { s = ackForecast(s); continue; }
    if (s.pendingEvent) { s = resolveEvent(s, event(s)); continue; }
    if (s.pendingReport) { s = ackReport(s); continue; }
    s = decide(s);
    s = rawTick(s);
    trust.push(rating(s));
    check?.(s);
  }
  return { s, decrees, trust };
}

function invariants(s) {
  for (const d of s.districts) {
    assert.ok(d.mood >= 0 && d.mood <= 100, `mood out of range: ${d.mood}`);
    assert.ok(d.smog >= 0 && d.stoves >= 0 && d.traffic >= 0, `negative value in ${d.id}`);
  }
  assert.ok(Number.isFinite(s.budget));
  const st = decreeStatus(s);
  assert.ok(st && st.daysLeft >= 0 && st.daysLeft <= YEAR, `bad decree status on day ${s.day}`);
}

// Событие глазами разумного игрока: рейтинг и деньги против выбросов.
// Видит подсказку воздуха: две плохие подряд — дальше выбирает то, что воздух не портит.
function sensibleOption(s) {
  const options = getCard(s.pendingEvent.cardId).options;
  if (s.airStreak >= SIM.eventStreakFrom) {
    const better = options.findIndex(o => airHint(o) === "better");
    if (better >= 0) return better;
  }
  const score = o => {
    const e = o.effects;
    return (e.rating ?? 0) + (e.budget ?? 0) * 0.3 - ((e.tec ?? 0) + (e.stoves ?? 0) + (e.traffic ?? 0));
  };
  const [a, b] = options;
  return score(b) > score(a) ? 1 : 0;
}

// --- калибровка: без действий и событий, первый год ---
// Цели — раздел 1 дополнения к спеку (датчики Almaty Air Initiative, IQAir, сезонный ход Open-Meteo).
// Зимы разных типов (SIM.winters) входят в среднее с их вероятностями: база — средняя зима, а не обычная.
{
  noDecrees();
  const SEEDS = 60;
  const out = { spring: [], summer: [], autumn: [], winter: [], annual: [], peak: [] };
  const byDistrict = Object.fromEntries(ids.map(id => [id, { winter: [], summer: [] }]));
  for (let seed = 1; seed <= SEEDS; seed++) {
    let s = newCity(seed);
    s.nextEventDay = Infinity;
    s.banEventDone = true;
    s.airMeasures = SIM.idle.needed;
    const days = [];
    for (let i = 0; i < 360; i++) {
      s = tick(s);
      // смог конца дня i и сезон этого же дня (s.day уже следующий)
      const today = { ...s, day: i };
      days.push(cityPm25(today));
      for (const k of ["winter", "summer"]) {
        if (SEASONS[Math.floor(i / SEASON_DAYS)] === k) for (const id of ids) byDistrict[id][k].push(districtPm25(today, id));
      }
    }
    SEASONS.forEach((k, n) => out[k].push(mean(days.slice(n * SEASON_DAYS, (n + 1) * SEASON_DAYS))));
    out.annual.push(mean(days));
    out.peak.push(Math.max(...days.slice(3 * SEASON_DAYS)));
  }
  const m = Object.fromEntries(Object.entries(out).map(([k, v]) => [k, mean(v)]));
  const dist = Object.fromEntries(ids.map(id => [id, { w: mean(byDistrict[id].winter), s: mean(byDistrict[id].summer) }]));
  const inRange = out.peak.filter(p => p >= 100 && p <= 145).length / SEEDS;
  console.log(`calibration PM2.5: winter ${m.winter.toFixed(1)}, spring ${m.spring.toFixed(1)}, summer ${m.summer.toFixed(1)}, autumn ${m.autumn.toFixed(1)}, annual ${m.annual.toFixed(1)}, winter peak ${m.peak.toFixed(0)} (in 100–145: ${pct(inRange)})`);
  console.log("calibration districts (winter PM2.5/AQI):", ids.map(id => `${id} ${dist[id].w.toFixed(0)}/${aqiFromPm25(dist[id].w)}`).join(", "));
  assert.ok(m.winter >= 45 && m.winter <= 55, `winter PM2.5 ${m.winter} must be 45–55`);
  assert.ok(m.summer >= 10 && m.summer <= 15, `summer PM2.5 ${m.summer} must be 10–15`);
  assert.ok(m.annual >= 20 && m.annual <= 30, `annual PM2.5 ${m.annual} must be 20–30`);
  assert.ok(m.peak >= 100 && m.peak <= 145, `mean winter peak ${m.peak} must be 100–145`);
  assert.ok(inRange >= 0.6, `winter peak in 100–145 in most years, got ${pct(inRange)}`);
  assert.ok(Math.abs(m.winter - SIM.baselineWinterPm25) <= 1, `baseline ${SIM.baselineWinterPm25} must match the do-nothing winter ${m.winter}`);
  // сезонный ход: зима ≫ осень, весна > лето (Open-Meteo: минимум летом, максимум зимой)
  assert.ok(m.winter > 2 * m.autumn && m.autumn > m.summer && m.spring > m.summer, "seasonal shape");
  // районы: север грязнее среднего (Алатауский зимой до AQI 180+), у гор чище
  assert.ok(aqiFromPm25(Math.max(...byDistrict.alatau.winter)) >= 180, "alatau reaches AQI 180+ in winter");
  for (const id of ["alatau", "turksib", "zhetysu"]) assert.ok(dist[id].w > m.winter, `${id} must be dirtier than the city in winter`);
  for (const id of ["medeu", "bostandyk"]) assert.ok(dist[id].w < m.winter, `${id} must be cleaner than the city in winter`);
  realDecrees();
}

// --- погода зимы: видимая удача, но не всё решает ---
// При одних и тех же выбросах: малоснежная и затяжной штиль грязнее обычной, снежная чище; внутри типа зимы близки.
{
  noDecrees();
  const byType = {};
  const growth = { ...SIM.growth };
  Object.assign(SIM.growth, { traffic: 0, pop: 0, stoves: 0 });
  for (let seed = 1; seed <= 60; seed++) {
    let s = newCity(seed);
    s.nextEventDay = Infinity;
    s.banEventDone = true;
    s.airMeasures = SIM.idle.needed;
    s.mods = {};
    while (s.day < 4 * YEAR - 1) {
      for (const d of s.districts) d.mood = 70; // ни увольнений, ни забастовок
      s.criticalDays = null;
      s.budget = 1e6;
      s = tick(s);
      s.mods = {}; // преграды не в счёт: только погода
      if (s.day % YEAR === YEAR - 1) (byType[s.winter] ??= []).push(airChange(s));
    }
  }
  Object.assign(SIM.growth, growth);
  const m = Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, mean(v)]));
  const sd = Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, Math.sqrt(mean(v.map(x => (x - m[k]) ** 2)))]));
  console.log("weather only, winter PM2.5 vs baseline by winter type:", Object.entries(m).map(([k, v]) => `${k} ${v.toFixed(2)} ±${sd[k].toFixed(2)} (n ${byType[k].length})`).join(", "));
  assert.ok(m["low-snow"] > m.normal + 0.02 && m.calm > m.normal + 0.02, "a poor winter is visibly dirtier");
  assert.ok(m.snowy < m.normal - 0.02, "a snowy winter is visibly cleaner");
  // Удача заметная, но не решает всё: разница с обычной зимой не больше 12% PM2.5
  for (const k of ["low-snow", "calm", "snowy"]) assert.ok(Math.abs(m[k] - m.normal) <= 0.12, `${k}: weather alone moves the winter by ${pct(m[k] - m.normal)}`);
  for (const k of Object.keys(sd)) assert.ok(sd[k] <= 0.12, `${k}: winters of one type are close: SD ${sd[k]}`);
  realDecrees();
}

// --- случайный бот ---
// Раз в 10 дней с вероятностью 0.3 делает случайное доступное действие; на событиях выбирает наугад.
const RANDOM_GAMES = 200;
const endings = { fired: 0, bankrupt: 0, idle: 0, critical: 0, decree: 0, retired: 0 };
for (let seed = 1; seed <= RANDOM_GAMES; seed++) {
  const rnd = lcg(seed);
  const { s } = play(seed, {
    check: invariants,
    event: () => (rnd() < 0.5 ? 0 : 1),
    decide: x => {
      if (x.day % 10 || rnd() >= 0.3) return x;
      const moves = [];
      for (const d of DISTRICTS) for (const a of DISTRICT_ACTIONS) if (canAct(x, d.id, a.id)) moves.push(z => act(z, d.id, a.id));
      for (const p of CITY_PROJECTS) if (canProject(x, p.id)) moves.push(z => cityProject(z, p.id));
      if (nmuStatus(x).ok) moves.push(startNmu);
      return moves.length ? moves[Math.floor(rnd() * moves.length)](x) : x;
    },
  });
  endings[s.ended]++;
  if (s.ended === "decree") assert.ok(s.decreeFail?.text.startsWith("Указ не выполнен"), "decree ending explains itself");
  else assert.equal(s.decreeFail, null);
}
console.log(`random bot (${RANDOM_GAMES}):`, endings);
for (const k of ["decree", "idle"]) assert.ok(endings[k] > 0, `random bot never reached ending "${k}"`);
assert.equal(endings.retired, 0, "nobody retires by accident");

// --- боты указов ---
const RESERVE = 25;
const byStoves = [...DISTRICTS].sort((a, b) => b.stoves - a.stoves).filter(d => d.stoves >= 3);
const byTraffic = [...DISTRICTS].sort((a, b) => b.traffic - a.traffic).slice(0, 4);
const itemOf = ([id]) => DISTRICT_ACTIONS.find(a => a.id === id) ?? CITY_PROJECTS.find(p => p.id === id);
const started = (s, [id, d]) => s.building.some(b => b.id === id && b.district === d)
  || (d ? s.districts.find(x => x.id === d).done.includes(id) : s.cityDone.includes(id));
// Люди: забастовку снимает, пока «выслушать» не дороже 35 млрд (70, если забастовка держит стройку);
// когда доверие ниже 33 — выслушивает самый недовольный район, если это не дороже 30.
// Указ про ТЭЦ-2 важнее: пока она не начата и до снятия далеко, на людей денег не тратит.
function calmStrike(s) {
  if (s.decree.tasks.some(t => t.kind === "tec2") && !started(s, ["tec2gas"]) && rating(s) > 24) return s;
  for (const d of DISTRICTS) {
    if (!districtStatus(s, d.id).strike || !canAct(s, d.id, "listen")) continue;
    const c = actionCost(s, d.id, "listen");
    const blocked = s.building.some(b => b.district === d.id || (b.kind === "city" && (getProject(b.id).sites ?? []).includes(d.id)));
    if (c <= (blocked ? 70 : 35) && s.budget - c >= (blocked ? 0 : RESERVE)) return act(s, d.id, "listen");
  }
  if (rating(s) < 33) {
    const d = [...s.districts].filter(x => actionCost(s, x.id, "listen") <= 30).sort((a, b) => a.mood - b.mood)[0];
    if (d && s.budget - actionCost(s, d.id, "listen") >= RESERVE && canAct(s, d.id, "listen")) return act(s, d.id, "listen");
  }
  return s;
}
// НМУ в начале штиля, если зимний указ под угрозой (средний AQI зимы на грани или день близко к черте)
// и доверие выдержит ещё одну непопулярную меру.
function nmuWhenCalm(s) {
  if (!nmuStatus(s).ok || s.budget < SIM.nmu.cost + 10 || s.wind !== "calm" || rating(s) < 28) return s;
  const need = decreeStatus(s).tasks.some(t => (t.kind === "winter" && t.state !== "ok") || (t.kind === "peak" && cityAqi(s) > t.target - 20));
  return need ? startNmu(s) : s;
}
const TEC2_BY = 2 * YEAR + 180;
// Бот по плану: каждые 5 дней берёт первый открытый и не начатый пункт, держит запас бюджета.
// Указ читают все: если он про ТЭЦ-2, она идёт первой; если ТЭЦ-2 в плане, со второго года копит на неё к осени третьего.
// smart — ждёт, пока в районе готово то, с чем действие сильнее (синергия), nmu — режим НМУ в начале штиля.
// loans — пункты плана, на которые бот берёт кредит, если своих денег не хватает (самый маленький, который покрывает).
function planBot(PLAN, { nmu = false, smart = false, listen = true, loans = [], loanMargin = -Infinity } = {}) {
  const ready = (s, [id, d]) => {
    const syn = itemOf([id]).synergy;
    if (!smart || !d || !syn || syn.with === "metro") return true;
    const at = PLAN.findIndex(q => q[0] === id && q[1] === d);
    return synergyActive(s, d, id) || !PLAN.some((q, i) => q[0] === syn.with && q[1] === d && i < at);
  };
  const wantsTec2 = PLAN.some(p => p[0] === "tec2gas");
  return prev => {
    let s = listen ? calmStrike(prev) : prev;
    if (nmu) s = nmuWhenCalm(s);
    if (prev.day % 5) return s;
    const tec2Task = s.decree.tasks.some(t => t.kind === "tec2") && !started(s, ["tec2gas"]);
    const step = tec2Task ? ["tec2gas"] : PLAN.find(p => !started(s, p) && unlockStatus(s, p[0], p[1]).ok && ready(s, p));
    if (!step) return s;
    const cost = itemOf(step).cost;
    const floor = step[0] === "tec2gas" ? -SIM.creditLimit : RESERVE;
    if (s.budget - cost < floor && loans.includes(step[0])) {
      const amount = loanFor(s, Math.ceil(floor - (s.budget - cost)));
      // осторожно: только если и с платежом доход в плюсе хотя бы на loanMargin в день
      if (amount !== null && netIncome(s) - loanOptions(s).find(o => o.amount === amount).perDay >= loanMargin) s = takeLoan(s, amount);
    }
    if (s.budget - cost < floor) return s;
    const saving = wantsTec2 && step[0] !== "tec2gas" && !started(s, ["tec2gas"]) && s.day >= YEAR && s.day < TEC2_BY;
    if (saving && s.budget - cost + netIncome(s) * 0.6 * (TEC2_BY - 20 - s.day) < getProject("tec2gas").cost) return s;
    const [id, d] = step;
    if (d ? !canAct(s, d, id) : !canProject(s, id)) return s;
    return d ? act(s, d, id) : cityProject(s, id);
  };
}
// Разумный: маршруты и котельные в районах с печами, газ там же, фильтры и за ними ТЭЦ-2 (путь мер),
// автобусы в центре, газ в остальных районах с печами. Про синергии, ветер и НМУ не знает.
const reasonableBot = planBot([
  ...byStoves.slice(0, 2).map(d => ["bus", d.id]),
  ...byStoves.slice(0, 2).map(d => ["boiler", d.id]),
  ...byStoves.slice(0, 2).map(d => ["gas", d.id]),
  ["filters"],
  ["tec2gas"],
  ...byTraffic.map(d => ["bus", d.id]),
  ...byStoves.slice(2).map(d => ["gas", d.id]),
]);
// Умный: мало дешёвого — котельные в двух самых угольных районах и автобус в центре, откуда ветер «на север» несёт
// смог машин на соседей (windLinks); дальше копит на газ там же, а после него субсидия (синергия: сильнее
// и лобби не мешает); фильтры, за ними ТЭЦ-2; парковка только там, где уже ходит автобус; зимой — НМУ в начале штиля.
const ADAPTIVE_PLAN = [
  ["boiler", "turksib"], ["bus", "almaly"], ["boiler", "alatau"],
  ["gas", "turksib"], ["gas", "alatau"], ["gas-subsidy", "turksib"], ["gas-subsidy", "alatau"],
  ["filters"], ["tec2gas"],
  ["parking", "almaly"], ["bus", "bostandyk"], ["parking", "bostandyk"],
  ["boiler", "zhetysu"], ["gas", "zhetysu"], ["gas-subsidy", "zhetysu"],
  ["bus", "auezov"], ["parking", "auezov"],
];
// Центр — наветренный: ветер на север уносит смог Алмалинского и Бостандыкского в соседние районы.
assert.ok(windLinks("almaly").n.to.length >= 2 && windLinks("bostandyk").n.to.length >= 2, "the centre is upwind of the city");
const adaptiveBot = planBot(ADAPTIVE_PLAN, { nmu: true, smart: true });
const passiveBot = s => (s.day === 0 ? act(s, "almaly", "park") : s);
// Одна стратегия на всю партию: каждый год то же самое. Перед ней — только то, что требует путь мер.
const oneTrick = {
  "только автобусы": planBot([...byTraffic, ...DISTRICTS].map(d => ["bus", d.id]).filter((x, i, a) => a.findIndex(y => y[1] === x[1]) === i)),
  "только котельные": planBot(byStoves.map(d => ["boiler", d.id])),
  "только газ": planBot([["boiler", byStoves[0].id], ...byStoves.map(d => ["gas", d.id])]),
  "только парки": planBot(DISTRICTS.map(d => ["park", d.id])),
  "только ТЭЦ-2": planBot([["park", "almaly"], ["filters"], ["tec2gas"]]),
  "только запреты": planBot([["bus", "almaly"], ["boiler", byStoves[0].id], ["gas", byStoves[0].id], ...DISTRICTS.flatMap(d => [["parking", d.id], ["coalban", d.id]])]),
};

// Сколько партий прошли указ года 1, 2, … (доля от всех), чем кончились, длина партии, год 1 при каждой зиме,
// доверие горожан: медиана за все дни всех партий, доля дней в 20–45 и выше 65.
function decreeRun(decide, games, event = sensibleOption) {
  const pass = [0, 0, 0, 0, 0], ends = {}, fails = {}, firstWinter = {}, days = [], scenarios = [], trust = [];
  const firedBy = [];
  for (let seed = 1; seed <= games; seed++) {
    const { s, decrees, trust: t } = play(seed, { decide, event, check: invariants });
    ends[s.ended] = (ends[s.ended] ?? 0) + 1;
    for (let y = 1; y <= 5; y++) if (s.decreesDone >= y) pass[y - 1]++;
    if (s.ended === "decree") { const k = `y${s.decree.year} ${s.decreeFail.kind}`; fails[k] = (fails[k] ?? 0) + 1; }
    if (s.ended === "fired") firedBy.push(s.day);
    const w = s.winters[0]?.type;
    if (w) { firstWinter[w] ??= { n: 0, passed: 0 }; firstWinter[w].n++; if (s.decreesDone >= 1) firstWinter[w].passed++; }
    days.push(s.day);
    scenarios.push({ winters: s.winters, decrees });
    trust.push(...t);
  }
  return {
    pass: pass.map(x => x / games), ends, fails, firstWinter, medianYears: median(days) / YEAR, scenarios, firedBy,
    trust: { median: median(trust), edge: trust.filter(x => x >= 20 && x <= 45).length / trust.length, high: trust.filter(x => x > 65).length / trust.length },
  };
}
const show = (name, r) => console.log(`${name}: decree passed y1–y5 ${r.pass.map(pct).join(" / ")}, median ${r.medianYears.toFixed(1)} years, trust median ${Math.round(r.trust.median)}, days at 20–45 ${pct(r.trust.edge)}, above 65 ${pct(r.trust.high)},`, r.ends, "failed on", r.fails);

// --- ничего не делать: снимают через полгода, всегда ---
{
  for (let seed = 1; seed <= 30; seed++) {
    const { s } = play(seed, { event: sensibleOption });
    assert.equal(s.ended, "idle", `do-nothing, seed ${seed}`);
    assert.equal(s.day, SIM.idle.deadlineDay, `do-nothing day, seed ${seed}`);
  }
  console.log(`do-nothing (30): idle on day ${SIM.idle.deadlineDay} in every game`);
}

// --- пассивный после минимума: проваливает указ года 1 или 2 ---
const passive = decreeRun(passiveBot, 60);
show("passive after minimum (60)", passive);
assert.equal(passive.pass[1], 0, "passive play never passes the year-2 decree");

// --- разумный ---
const REASONABLE_GAMES = 150;
const wise = decreeRun(reasonableBot, REASONABLE_GAMES);
show(`reasonable (${REASONABLE_GAMES})`, wise);
console.log("  reasonable, year 1 by winter type:", Object.entries(wise.firstWinter).map(([k, v]) => `${k} ${v.passed}/${v.n}`).join(", "));
assert.equal(wise.ends.idle ?? 0, 0, "reasonable play must not be caught by the idle rule");
// v6 (деньги в дефиците): цели года 2–4 чуть ниже, чем в v5 (55/35/15–35), — мер к каждой зиме меньше, это и есть выбор.
assert.ok(wise.pass[0] >= 0.8, `reasonable passes year 1 in ≥ 80%: ${pct(wise.pass[0])}`);
assert.ok(wise.pass[1] >= 0.5, `reasonable passes year 2 in ≥ 50%: ${pct(wise.pass[1])}`);
assert.ok(wise.pass[2] >= 0.3, `reasonable passes year 3 in ≥ 30%: ${pct(wise.pass[2])}`);
assert.ok(wise.pass[3] >= 0.1 && wise.pass[3] <= 0.35, `reasonable passes year 4 in 10–35%: ${pct(wise.pass[3])}`);
assert.ok(wise.medianYears >= 2 && wise.medianYears <= 4, `median game 2–4 years: ${wise.medianYears}`);
// Погода не всё: при малоснежной зиме разумный проходит год 1 хотя бы в половине партий, при снежной — почти всегда
const lowSnow = wise.firstWinter["low-snow"], snowy = wise.firstWinter.snowy;
assert.ok(lowSnow.passed / lowSnow.n >= 0.5, `low-snow winter: year 1 passed ${lowSnow.passed}/${lowSnow.n}`);
assert.ok(snowy.passed / snowy.n >= 0.9, `snowy winter: year 1 passed ${snowy.passed}/${snowy.n}`);
assert.ok((wise.ends.critical ?? 0) <= 3, `reasonable play should rarely reach the critical state, got ${wise.ends.critical ?? 0}`);

// --- умный: синергии, наветренные районы, НМУ вовремя ---
const ADAPTIVE_GAMES = 100;
const smart = decreeRun(adaptiveBot, ADAPTIVE_GAMES);
show(`adaptive (${ADAPTIVE_GAMES})`, smart);
assert.ok(smart.pass[3] >= wise.pass[3] + 0.2, `smart play must pay: year 4 ${pct(smart.pass[3])} vs reasonable ${pct(wise.pass[3])}`);
assert.ok(smart.pass[4] < 0.9, "even smart play loses eventually");
// Кредиты: умный берёт кредит на фильтры и ТЭЦ-2, когда своих денег не хватает. Инструмент настоящий, но дорогой:
// без оглядки на платежи (reckless) он разоряет, осторожно (только если и с платежом доход в плюсе на 0,6 в день) — помогает,
// но ценой риска банкротства и не становится выигрышем на всю партию.
const LOAN_ITEMS = ["filters", "tec2gas"];
const smartLoans = decreeRun(planBot(ADAPTIVE_PLAN, { nmu: true, smart: true, loans: LOAN_ITEMS }), ADAPTIVE_GAMES);
show(`adaptive + reckless loans for filters and ТЭЦ-2 (${ADAPTIVE_GAMES})`, smartLoans);
const smartCareful = decreeRun(planBot(ADAPTIVE_PLAN, { nmu: true, smart: true, loans: LOAN_ITEMS, loanMargin: 0.6 }), ADAPTIVE_GAMES);
show(`adaptive + careful loans for filters and ТЭЦ-2 (${ADAPTIVE_GAMES})`, smartCareful);
const broke = r => (r.ends.bankrupt ?? 0) / ADAPTIVE_GAMES;
assert.ok(smartLoans.pass[1] <= smart.pass[1] - 0.2 && broke(smartLoans) >= broke(smart) + 0.2, `reckless loans must hurt: year 2 ${pct(smartLoans.pass[1])} vs ${pct(smart.pass[1])}, bankrupt ${pct(broke(smartLoans))}`);
assert.ok(broke(smartCareful) > broke(smart), "even careful loans add a risk of bankruptcy");
for (let y = 0; y < 5; y++) assert.ok(smartCareful.pass[y] <= smart.pass[y] + 0.25, `careful loans must not dominate: year ${y + 1} ${pct(smartCareful.pass[y])} vs ${pct(smart.pass[y])} without`);
assert.ok(smartCareful.pass[4] < 0.9, "even with loans smart play loses eventually");
// Что даёт каждое умное решение: тот же план без НМУ и без синергий — только печатается
show("  adaptive without НМУ (60)", decreeRun(planBot(ADAPTIVE_PLAN, { smart: true }), 60));
show("  adaptive without synergies (60)", decreeRun(planBot(ADAPTIVE_PLAN.filter(p => !["gas-subsidy", "parking"].includes(p[0])), { nmu: true }), 60));

// --- доверие на грани ---
// Разумная и умная игра большую часть времени у края: доверие 20–45, медиана не выше 45, выше 65 — редкость.
for (const [name, r] of [["reasonable", wise], ["adaptive", smart]]) {
  assert.ok(r.trust.edge >= 0.4, `${name}: trust at 20–45 on ≥ 40% of days, got ${pct(r.trust.edge)}`);
  assert.ok(r.trust.median <= 45, `${name}: median trust ≤ 45, got ${Math.round(r.trust.median)}`);
  assert.ok(r.trust.high < 0.1, `${name}: trust above 65 on < 10% of days, got ${pct(r.trust.high)}`);
}
// «Плевать на людей»: никого не выслушивает, вводит всё непопулярное, что открыто, — снимают за недоверие ко второму году.
{
  const ignore = planBot([
    ["bus", "almaly"], ["boiler", byStoves[0].id], ...byStoves.map(d => ["gas", d.id]),
    ...DISTRICTS.flatMap(d => [["parking", d.id], ["coalban", d.id]]),
  ], { nmu: true, listen: false });
  const unpopular = s => { const x = ignore(s); return nmuStatus(x).ok && x.budget > 20 ? startNmu(x) : x; };
  const r = decreeRun(unpopular, 60);
  show("ignore people (60)", r);
  const early = r.firedBy.filter(d => d <= 2 * YEAR).length / 60;
  assert.ok(early >= 0.5, `ignoring people gets you fired by the end of year 2 in most games: ${pct(early)}`);
  assert.ok(r.trust.high < 0.1, "nobody sits at high trust");
}
for (const [name, r] of [["passive", passive]]) assert.ok(r.trust.high < 0.1, `${name}: trust above 65 is rare`);

// --- одна стратегия всю игру: каждый год новые преграды, повторение не проходит год 4 ---
for (const [name, bot] of Object.entries(oneTrick)) {
  const r = decreeRun(bot, 60);
  show(`one trick "${name}" (60)`, r);
  // v6: газ открывается после первой котельной уже в первый год, и «котельная + газ везде» — почти план: до 10%.
  assert.ok(r.pass[3] < (name === "только газ" ? 0.1 : 0.05), `"${name}" must not pass the year-4 decree: ${pct(r.pass[3])}`);
  assert.ok(r.trust.high < 0.1, `"${name}": trust above 65 is rare`);
}

// --- строит всё подряд (жалоба игрока): каждый день покупает всё открытое, на что хватает, дешёвое первым, не копит ---
// Деньги в дефиците: содержание дешёвых мер съедает доход, и такой аким не доживает до конца первого года.
// «Выслушать» и бесплатные запреты не берёт: проверяется экономика, а не настроение.
function buildEverything(s) {
  for (;;) {
    const options = [];
    for (const d of DISTRICTS) for (const a of DISTRICT_ACTIONS) if (a.cost > 0 && !a.repeat && canAct(s, d.id, a.id)) options.push({ cost: a.cost, go: z => act(z, d.id, a.id) });
    for (const p of CITY_PROJECTS) if (canProject(s, p.id)) options.push({ cost: p.cost, go: z => cityProject(z, p.id) });
    if (!options.length) return s;
    s = options.sort((a, b) => a.cost - b.cost)[0].go(s);
  }
}
const everything = decreeRun(buildEverything, 60);
show("build-everything (60)", everything);
const everythingY1 = 1 - everything.pass[0];
assert.ok(everythingY1 >= 0.8, `building everything affordable must fail year 1 in ≥ 80%: ${pct(everythingY1)}`);
// То же, но в кредит: когда открытое не по карману, берёт самый большой кредит, какой дадут, и строит дальше.
// Кредит не спасает: платежи плюс содержание — и банкротство в первый год.
function buildEverythingLoans(s) {
  s = buildEverything(s);
  const wants = DISTRICTS.some(d => DISTRICT_ACTIONS.some(a => a.cost > 0 && !a.repeat && actStatus(s, d.id, a.id).reason === REASONS.noMoney))
    || CITY_PROJECTS.some(p => projectStatus(s, p.id).reason === REASONS.noMoney);
  const loan = wants && loanOptions(s).filter(o => o.ok).at(-1);
  return loan ? buildEverything(takeLoan(s, loan.amount)) : s;
}
const everythingLoans = decreeRun(buildEverythingLoans, 60);
show("build-everything with loans (60)", everythingLoans);
const everythingLoansY1 = 1 - everythingLoans.pass[0];
assert.ok(everythingLoansY1 >= 0.8, `building everything on loans must fail year 1 in ≥ 80%: ${pct(everythingLoansY1)}`);
assert.ok((everythingLoans.ends.bankrupt ?? 0) / 60 >= 0.5, "building everything on loans mostly ends in bankruptcy");

// --- копит по пути мер: пара точных дешёвых мер, дальше копит на газ, фильтры и ТЭЦ-2 ---
// Без синергий и НМУ: этим от умного и отличается.
const SAVER_PLAN = [
  ["boiler", "turksib"], ["bus", "almaly"], ["gas", "turksib"], ["boiler", "alatau"], ["gas", "alatau"],
  ["filters"], ["tec2gas"], ["boiler", "zhetysu"], ["gas", "zhetysu"], ["bus", "bostandyk"],
];
const saver = decreeRun(planBot(SAVER_PLAN), 60);
show("saver (60)", saver);
assert.ok(saver.pass[0] >= 0.8, `saver passes year 1 in ≥ 80%: ${pct(saver.pass[0])}`);
assert.ok(saver.pass[0] >= everything.pass[0] + 0.5 && saver.pass[1] >= everything.pass[1] + 0.3, "saving beats building everything clearly");

// --- детерминизм: один seed — один сценарий указов, преград и погоды, что бы ни делал игрок ---
{
  const runs = [passive, wise, smart, everything, everythingLoans, smartLoans, smartCareful, saver];
  for (let i = 0; i < 60; i++) {
    const [a, ...rest] = runs.map(r => r.scenarios[i]);
    for (const b of rest) {
      const n = Math.min(a.winters.length, b.winters.length);
      assert.deepEqual(b.winters.slice(0, n), a.winters.slice(0, n), `seed ${i + 1}: same winters`);
      for (const y of Object.keys(a.decrees)) if (b.decrees[y]) assert.equal(b.decrees[y], a.decrees[y], `seed ${i + 1}, year ${y}: same decree`);
    }
  }
  assert.notDeepEqual(smart.scenarios.slice(0, 20).map(x => x.winters), smart.scenarios.slice(20, 40).map(x => x.winters), "seeds differ");
  console.log("determinism: one seed, one scenario of decrees, obstacles and winters for every bot");
}

// --- «полной победы нет»: бот с максимальным усилием, без указов ---
// Каждые 5 дней берёт самое сильное по зимнему выбросу действие (с тем же запасом бюджета).
// Даже так четвёртая зима не чище 40% от зимы до назначения.
function impact(s, kind, id, districtId) {
  if (kind === "city") {
    const e = getProject(id).effect;
    let x = 0;
    for (const [pid, m] of Object.entries(e.plants ?? {})) { const p = s.plants.find(q => q.id === pid); x += p.emission * p.mult * (1 - m); }
    for (const d of e.districts ?? []) x += s.districts.find(q => q.id === d).traffic * (1 - e.traffic);
    return x;
  }
  const e = getAction(id).effect;
  const d = s.districts.find(q => q.id === districtId);
  let x = d.stoves * (1 - (e.stoves ?? 1)) + d.traffic * (1 - (e.traffic ?? 1));
  if (e.parkDaily) {
    const w = { ...districtEmission({ ...s, day: 3 * SEASON_DAYS }, districtId) };
    x += (w.stoves + w.traffic + w.plant) * (1 - e.parkDaily) / (SIM.disperse.winter + 1 - e.parkDaily);
  }
  return x;
}
function maxEffortBot(s) {
  if (s.day % 5) return s;
  const options = [];
  for (const d of DISTRICTS) for (const a of DISTRICT_ACTIONS) {
    const st = actStatus(s, d.id, a.id);
    if (st.ok || st.reason === REASONS.noMoney) options.push({ cost: a.cost, x: impact(s, "district", a.id, d.id), go: z => act(z, d.id, a.id) });
  }
  for (const p of CITY_PROJECTS) {
    const st = projectStatus(s, p.id);
    if (st.ok || st.reason === REASONS.noMoney) options.push({ cost: p.cost, x: impact(s, "city", p.id), go: z => cityProject(z, p.id) });
  }
  const free = options.find(o => o.cost === 0 && o.x > 0);
  if (free) return free.go(s);
  const best = options.filter(o => o.x > 0).sort((a, b) => b.x - a.x)[0];
  return best && s.budget - best.cost >= RESERVE ? best.go(s) : s;
}
function cleanestOption(s) {
  const dirt = o => (o.effects.tec ?? 0) + (o.effects.stoves ?? 0) + (o.effects.traffic ?? 0);
  const [a, b] = getCard(s.pendingEvent.cardId).options;
  return dirt(b) < dirt(a) ? 1 : 0;
}
// Здесь проверяется физика воздуха: люди не мешают (настроение держим), указов нет.
const keepPeople = bot => s => { for (const d of s.districts) d.mood = Math.max(d.mood, 45); return bot(s); };
{
  noDecrees();
  const ratios = [];
  const ends = {};
  for (let seed = 1; seed <= 30; seed++) {
    const { s } = play(seed, { decide: keepPeople(maxEffortBot), event: cleanestOption, maxDay: 4 * YEAR });
    ends[s.ended ?? "4 years"] = (ends[s.ended ?? "4 years"] ?? 0) + 1;
    if (s.day >= 4 * YEAR) ratios.push(airChange(s));
  }
  console.log("max-effort bot, no decrees, people held (30):", ends, `best 4th winter vs baseline ${pct(Math.min(...ratios))}`);
  assert.ok(ratios.length > 0, "max-effort bot should survive 4 years at least sometimes");
  // v6: путь мер открывает ТЭЦ-2 после фильтров уже в первый год, и к 4-й зиме она бывает готова: порог 35%, а не 40%.
  assert.ok(Math.min(...ratios) >= 0.35, `no full victory: the 4th winter must stay ≥ 35% of the baseline, got ${pct(Math.min(...ratios))}`);
  // Стройки перевешивают рост: разумная игра без указов снижает зимний PM2.5 к четвёртой зиме
  const wiseAir = [];
  for (let seed = 1; seed <= 30; seed++) {
    const { s } = play(seed, { decide: keepPeople(reasonableBot), event: sensibleOption, maxDay: 4 * YEAR });
    if (s.day >= 4 * YEAR) wiseAir.push(airChange(s));
  }
  const rose = wiseAir.filter(r => r >= 1).length / wiseAir.length;
  console.log(`reasonable, no decrees, people held: 4th winter vs baseline mean ${pct(mean(wiseAir))} over ${wiseAir.length}, smog rose in ${pct(rose)}`);
  assert.ok(mean(wiseAir) <= 0.9, "reasonable play must cut winter PM2.5");
  assert.ok(rose <= 0.1, "reasonable play must rarely leave the winter dirtier than the baseline");
  realDecrees();
}

// --- критическое состояние воздуха: плохие решения доводят, бездействие в первый год — нет ---
{
  noDecrees();
  const worse = s => {
    const [a, b] = getCard(s.pendingEvent.cardId).options;
    const dirt = o => (o.effects.tec ?? 0) + (o.effects.stoves ?? 0) + (o.effects.traffic ?? 0);
    return dirt(b) > dirt(a) ? 1 : 0;
  };
  // Люди здесь ни при чём: настроение держим, чтобы дошло до воздуха
  const calmPeople = s => { for (const d of s.districts) d.mood = Math.max(d.mood, 50); return passiveBot(s); };
  const ends = {};
  const days = [];
  for (let seed = 1; seed <= 60; seed++) {
    const { s } = play(seed, { decide: calmPeople, event: worse, maxDay: 4 * YEAR });
    ends[s.ended] = (ends[s.ended] ?? 0) + 1;
    if (s.ended === "critical") days.push(s.day);
  }
  days.sort((a, b) => a - b);
  console.log("bad-decision bot, no decrees (60):", ends, `critical from day ${days[0]}, median ${days[days.length >> 1]}`);
  assert.ok((ends.critical ?? 0) / 60 >= 0.15, `bad decisions must reach the critical state in a meaningful share, got ${ends.critical ?? 0}/60`);
  assert.ok(days[0] > 360, "not in the first year even with bad decisions");
  assert.ok(days[0] <= 720, `reachable from year 2, first on day ${days[0]}`);
  // Бездействие: в первый год тревоги нет ни при какой погоде
  for (let seed = 1; seed <= 60; seed++) {
    let s = newCity(seed);
    s.nextEventDay = Infinity;
    s.banEventDone = true;
    s.airMeasures = SIM.idle.needed;
    while (s.day < 359) { s = tick(s); assert.equal(s.criticalDays, null, `do-nothing alarm in year 1, seed ${seed}, day ${s.day}`); }
  }
  realDecrees();
}

// --- доли источников в зимнем смоге при старте ---
// Отключаем источники по одному; PM2.5 линеен по источникам, поэтому вклады складываются. Зима обычная.
function winterPm(mute) {
  noDecrees();
  let s = newCity(1);
  s.nextEventDay = Infinity;
  s.banEventDone = true;
  s.airMeasures = SIM.idle.needed;
  mute(s);
  while (s.day < 359) { s = tick(s); s.winter = "normal"; s.mods = {}; }
  realDecrees();
  return s.lastWinterPm25;
}
const full = winterPm(() => {});
const contrib = {
  tec: full - winterPm(s => s.plants.forEach(p => { p.mult = 0; })),
  stoves: full - winterPm(s => s.districts.forEach(d => { d.stoves = 0; })),
  traffic: full - winterPm(s => s.districts.forEach(d => { d.traffic = 0; })),
};
const total = contrib.tec + contrib.stoves + contrib.traffic;
const shares = Object.fromEntries(Object.entries(contrib).map(([k, v]) => [k, v / total]));
console.log(`winter source shares: ТЭЦ ${pct(shares.tec)}, печи ${pct(shares.stoves)}, транспорт ${pct(shares.traffic)}`);
for (const [k, target] of [["tec", 0.37], ["stoves", 0.34], ["traffic", 0.29]]) {
  assert.ok(Math.abs(shares[k] - target) <= 0.05, `${k} share ${pct(shares[k])} should be ${pct(target)} ±5`);
}

console.log(`city balance ok in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
