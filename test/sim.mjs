import assert from "node:assert/strict";
import {
  newCity as startCity, tick as rawTick, act, canAct, cityProject, canProject, season, districtAqi, cityAqi, rating,
  actStatus, projectStatus, progress, netIncome, date, districtEmission, plantEmission, getAction, getProject,
  aqiFromPm25, districtPm25, cityPm25, gameYear, retire, resolveEvent, cardEligible, eventEffects,
  getCard, STOVE_DISTRICTS, REASONS, ackReport, endingText, cancelSubsidy, airHint, airStatus, idleStatus, actionCost, districtStatus, airChange, isPaused, gameSummary, daysWord,
  decreeStatus, acceptDecree, ackForecast, startNmu, nmuStatus, synergyActive, windLinks, decreeTaskText, getObstacle, trustDrains, unlockStatus,
  takeLoan, loanStatus, loanOptions, loanFor, loanRoom, debtLeft, loanPayment, grossIncome, winterForecast, measureImpact,
} from "../src/sim.js";
import { serialize, deserialize, readSave, restoreMode, loadSave, storageSet, SAVE_KEY, SAVE_VERSION } from "../src/save.js";
import { SIM } from "../src/data/sim-balance.js";
import { DISTRICT_ACTIONS, CITY_PROJECTS } from "../src/data/actions.js";
import { CARDS } from "../src/data/cards.js";
import { DISTRICTS } from "../src/data/city.js";
import { readFileSync } from "node:fs";

// Большинство блоков проверяет один механизм: без событий, со всем открытым, без указов и с обычной зимой.
// События, открытия, указы и погода проверяются в своих блоках внизу (startCity, realTree, realDecrees).
const DECREE = structuredClone(SIM.decree);
const WINTERS = structuredClone(SIM.winters);
function calmDecrees() {
  for (const y of SIM.decree.years) { y.tasks = []; y.obstacles = []; }
  SIM.decree.pool = [{ kind: "winter", aqi: 1e9, step: 0 }];
  SIM.decree.deck = [];
  for (const w of Object.values(SIM.winters)) Object.assign(w, { disperse: 1, calm: 1 });
}
function realDecrees() {
  Object.assign(SIM.decree, structuredClone(DECREE));
  for (const [k, w] of Object.entries(WINTERS)) Object.assign(SIM.winters[k], w);
}
calmDecrees();
const newCity = seed => ({ ...startCity(seed), pendingDecree: null, nextEventDay: Infinity, banEventDone: true, airMeasures: SIM.idle.needed });
// Годовой отчёт, указ и прогноз подтверждаются сами; они проверяются в своих блоках внизу (rawTick).
const waiting = s => s.pendingReport || s.pendingDecree || s.pendingForecast;
const tick = s => rawTick(waiting(s) ? { ...s, pendingReport: null, pendingDecree: null, pendingForecast: null } : s);
// Путь мер (requires) тоже отдельно: openAll открывает всё, realTree возвращает путь.
const UNLOCK_TREE = new Map([...DISTRICT_ACTIONS, ...CITY_PROJECTS].map(a => [a, a.requires]));
const openAll = () => { for (const a of UNLOCK_TREE.keys()) delete a.requires; };
const realTree = () => { for (const [a, r] of UNLOCK_TREE) if (r) a.requires = r; };
openAll();

// Критическое состояние тоже отдельно: длинные партии в этих блоках без игрока до него доходят.
const CRITICAL_THRESHOLD = SIM.critical.threshold;
SIM.critical.threshold = Infinity;
// Усталость от кризиса тоже отдельно: иначе настроение в каждом блоке плывёт само.
const FATIGUE = SIM.trust.fatigue;
SIM.trust.fatigue = 0;
const DISTRICTS_STOVES = Object.fromEntries(DISTRICTS.map(d => [d.id, d.stoves]));
const run = (s, n) => { for (let i = 0; i < n; i++) s = tick(s); return s; };
const dist = (s, id) => s.districts.find(d => d.id === id);
const action = id => DISTRICT_ACTIONS.find(a => a.id === id);
// Город без источников: всё обнулено, чтобы проверять один механизм.
function blank(seed = 1) {
  const s = newCity(seed);
  for (const d of s.districts) Object.assign(d, { stoves: 0, traffic: 0, smog: 0 });
  for (const p of s.plants) p.mult = 0;
  return s;
}

// --- детерминизм и неизменяемость ---
{
  assert.deepEqual(run(newCity(7), 100), run(newCity(7), 100), "same seed → same state");
  assert.notDeepEqual(run(newCity(7), 100).districts, run(newCity(8), 100).districts, "different seeds differ");
  const s = { ...newCity(3), budget: 1000 };
  const snap = structuredClone(s);
  tick(s);
  act(s, "alatau", "bus");
  cityProject(s, "filters");
  assert.deepEqual(s, snap, "tick/act/cityProject must not mutate input");
  // и в состоянии с идущими стройками, разгоном газификации и логом
  let busy = newCity(3);
  busy.budget = 1000;
  busy = cityProject(cityProject(act(act(busy, "turksib", "gas"), "almaly", "bus"), "filters"), "metro");
  for (let i = 0; i < 155; i++) busy = tick(busy);
  // tec2gas достраивается на этом тике: меняются plants, cityDone, upkeep
  busy = cityProject(busy, "tec2gas");
  Object.assign(busy.building.find(b => b.id === "tec2gas"), { left: 1, approval: 0 });
  assert.ok(busy.building.length > 1 && busy.districts.some(d => d.ramps.length) && busy.log.length, "busy state");
  assert.deepEqual(busy.cityDone, ["filters"], "a city project is already done");
  const busySnap = structuredClone(busy);
  const after = tick(busy);
  assert.ok(after.cityDone.includes("tec2gas") && after.plants[0].mult !== busySnap.plants[0].mult, "tick completed a city project");
  act(busy, "alatau", "coalban");
  act(busy, "alatau", "bus");
  assert.deepEqual(busy, busySnap, "nested state must not be mutated");
  // тик с последствиями: запрет угля срабатывает, цепочка пишется, метро копает, ТЭЦ ждёт согласования
  let chained = newCity(3);
  chained.budget = 2000;
  chained = cityProject(cityProject(act(act(chained, "alatau", "coalban"), "almaly", "parking"), "metro"), "tec2gas");
  chained = act(chained, "turksib", "listen");
  chained.districts.find(d => d.id === "alatau").delayed[0].at = chained.day + 1;
  dist(chained, "zhetysu").mood = 10; // забастовка начнётся на этом тике
  const chainedSnap = structuredClone(chained);
  const fired2 = tick(chained);
  assert.ok(fired2.chains.length > chained.chains.length, "this tick appends a chain");
  assert.equal(dist(fired2, "alatau").delayed.length, 0, "this tick fires the delayed effect");
  assert.ok(dist(fired2, "zhetysu").striking, "this tick starts a strike");
  assert.ok(fired2.building.find(b => b.id === "tec2gas").approval < chainedSnap.building.find(b => b.id === "tec2gas").approval);
  assert.deepEqual(chained, chainedSnap, "chains, delayed, since, strikes and approval must not be mutated");
  const acted = structuredClone(chained);
  act(chained, "almaly", "listen");
  act(chained, "auezov", "parking");
  assert.deepEqual(chained, acted, "act must not mutate since, listens or neighbours");
  // тик, на котором всплывает событие: меняется seenCards
  const eventful = { ...startCity(3), pendingDecree: null };
  eventful.nextEventDay = 1;
  eventful.building = [{ kind: "district", id: "bus", district: "turksib", left: 1, days: 20 }];
  const eventfulSnap = structuredClone(eventful);
  const fired = tick(eventful);
  assert.ok(fired.pendingEvent, "event raised on this tick");
  assert.deepEqual(eventful, eventfulSnap, "seenCards must not be mutated");
  // тик нового года и прогноза: указ, преграды и погода не меняют вход
  realDecrees();
  for (const day of [359, 239]) {
    const y = { ...startCity(5), pendingDecree: null, day, nextEventDay: Infinity, banEventDone: true };
    const ySnap = structuredClone(y);
    const after = rawTick(y);
    assert.ok(after.pendingDecree || after.pendingForecast || after.ended, `day ${day}: something happened`);
    assert.deepEqual(y, ySnap, `day ${day}: decree, obstacles and weather must not mutate the input`);
  }
  calmDecrees();
}

// --- сезоны ---
{
  assert.equal(season(newCity(1)), "spring");
  const at = d => season({ ...newCity(1), day: d });
  assert.deepEqual([at(89), at(90), at(180), at(270), at(359), at(360)], ["spring", "summer", "autumn", "winter", "winter", "spring"]);
  const s = newCity(1);
  const summer = run(s, 150);
  const winter = run(summer, 150); // день 300, 30 дней зимы
  const mass = x => x.districts.reduce((a, d) => a + d.smog, 0);
  assert.ok(mass(winter) > 2 * mass(summer), `winter smog ${mass(winter)} must exceed summer ${mass(summer)}`);
}

// --- выбросы по источникам ---
{
  let s = blank();
  s = run(s, 30);
  for (const d of s.districts) assert.equal(d.smog, 0, `${d.id}: no sources → no smog`);
  s = blank();
  dist(s, "almaly").traffic = 5;
  s = run(s, 5);
  assert.ok(dist(s, "almaly").smog > 0, "traffic emits");
  s = blank();
  s.plants.find(p => p.id === "tec2").mult = 1;
  s = tick(s);
  assert.ok(dist(s, "alatau").smog > 0, "plant emits in its district");
}

// --- рассеивание ---
{
  const once = (day, wind) => {
    const s = blank();
    s.day = day; s.wind = wind;
    dist(s, "almaly").smog = 100;
    return dist(tick(s), "almaly").smog;
  };
  assert.ok(once(300, "calm") > once(120, "calm"), "winter disperses less than summer");
  assert.ok(Math.abs(once(300, "calm") - 100 * (1 - SIM.disperse.winter * SIM.calmDisperse)) < 1e-9, "calm winter: slow dispersion only");
  assert.ok(once(300, "calm") > once(300, "s"), "calm disperses less than wind");
}

// --- ветер ---
{
  const blowFrom = (id, wind) => {
    const s = blank();
    s.wind = wind;
    dist(s, id).smog = 100;
    return tick(s);
  };
  let s = blowFrom("almaly", "n");
  assert.ok(dist(s, "zhetysu").smog > 0, "north wind carries almaly smog to zhetysu");
  assert.equal(dist(s, "bostandyk").smog, 0, "nothing goes upwind");
  s = blowFrom("almaly", "e");
  assert.ok(dist(s, "medeu").smog > 0, "east wind → medeu");
  const total = x => x.districts.reduce((a, d) => a + d.smog, 0);
  // южные районы упираются в горы: смог остаётся
  const kept = 100 * (1 - SIM.disperse.spring); // рассеивание в ветреный день, сам ветер смог не уносит
  assert.ok(Math.abs(total(blowFrom("bostandyk", "s")) - kept) < 1e-9, "smog can't leave through the mountains");
  assert.ok(Math.abs(dist(blowFrom("bostandyk", "s"), "bostandyk").smog - kept) < 1e-9, "south wind keeps smog in place");
  // северный край открыт: смог уходит из города
  assert.ok(total(blowFrom("turksib", "n")) < kept, "smog leaves the city across the north edge");
  // у Медеуского два западных соседа — делят поровну
  s = blowFrom("medeu", "w");
  assert.ok(dist(s, "almaly").smog > 0 && Math.abs(dist(s, "almaly").smog - dist(s, "bostandyk").smog) < 1e-9, "split between neighbors");
  // штилей за сезон — по квоте, в каждом сезоне партии
  let q = newCity(9);
  const share = SIM.windWeights.calm / Object.values(SIM.windWeights).reduce((a, b) => a + b, 0);
  for (let season = 0; season < 8; season++) {
    let calm = 0;
    for (let i = 0; i < SIM.DAYS_PER_SEASON; i++) {
      if (q.wind === "calm") calm++;
      for (const d of q.districts) d.mood = 70;
      q = tick(q);
    }
    assert.ok(Math.abs(calm - SIM.DAYS_PER_SEASON * share) <= SIM.calmSpread + 1, `season ${season}: ${calm} calm days`);
  }
  // ветер на следующий день выбирается из таблицы
  const winds = new Set();
  let w = newCity(5);
  for (let i = 0; i < 200; i++) { w = tick(w); winds.add(w.wind); }
  assert.deepEqual([...winds].sort(), Object.keys(SIM.windWeights).sort(), "all wind directions occur");
}

// --- стройки ---
{
  let s = newCity(2);
  const bus = action("bus");
  const before = s.budget;
  const traffic = dist(s, "auezov").traffic;
  assert.ok(canAct(s, "auezov", "bus"));
  s = act(s, "auezov", "bus");
  assert.equal(s.budget, before - bus.cost, "cost paid upfront");
  assert.deepEqual(s.building.map(b => [b.kind, b.id, b.district, b.left]), [["district", "bus", "auezov", bus.days]]);
  assert.ok(!canAct(s, "auezov", "bus"), "can't start twice");
  s = run(s, bus.days - 1);
  assert.equal(dist(s, "auezov").traffic, traffic, "no effect before completion");
  s = tick(s);
  assert.ok(Math.abs(dist(s, "auezov").traffic - traffic * bus.effect.traffic) < 1e-9, "effect applied on completion");
  assert.deepEqual(dist(s, "auezov").done, ["bus"]);
  assert.equal(s.building.length, 0);
  assert.ok(!canAct(s, "auezov", "bus"), "can't repeat");
  assert.throws(() => act(s, "auezov", "bus"));
  assert.ok(canAct(s, "almaly", "bus"), "other district still can");
  assert.ok(s.log.some(e => e.text.includes("Автобусный маршрут")), "completion logged");

  // газификация: эффект набирается постепенно
  const gas = action("gas");
  s = newCity(2);
  s.budget = 1000;
  const stoves = dist(s, "turksib").stoves;
  s = run(act(s, "turksib", "gas"), gas.days);
  const mid = dist(s, "turksib").stoves;
  assert.ok(mid < stoves, "gas ramps in");
  assert.ok(dist(s, "turksib").ramps.length === 1, "still ramping");
  s = run(s, gas.effect.ramp);
  const [lo, hi] = gas.adoption;
  const final = dist(s, "turksib").stoves / stoves;
  assert.ok(mid / stoves > final, "ramp keeps going down");
  assert.ok(final >= 1 - (1 - gas.effect.stoves) * hi - 1e-9 && final <= 1 - (1 - gas.effect.stoves) * lo + 1e-9, `gas effect is incomplete: ${final}`);
  assert.ok(final > gas.effect.stoves, "not everyone switches");

  // городской проект
  const f = CITY_PROJECTS.find(p => p.id === "filters");
  s = newCity(2);
  s.budget = 1000;
  s = cityProject(s, "filters");
  assert.ok(!canProject(s, "filters"));
  s = run(s, f.days);
  assert.equal(s.plants.find(p => p.id === "tec2").mult, f.effect.plants.tec2);
  assert.deepEqual(s.cityDone, ["filters"]);
  assert.throws(() => cityProject(s, "filters"));

  // деньги: нельзя уйти в минус глубже кредитного лимита
  s = newCity(2);
  s.budget = -SIM.creditLimit;
  assert.ok(!canAct(s, "alatau", "bus") && canAct(s, "alatau", "parking"), "credit limit");
  assert.throws(() => act(newCity(2), "nowhere", "bus"));
  assert.throws(() => act(newCity(2), "alatau", "nothing"));
}

// --- мгновенные действия ---
{
  let s = newCity(4);
  const st = dist(s, "turksib").stoves, mood = dist(s, "turksib").mood;
  s = act(s, "turksib", "coalban");
  assert.equal(dist(s, "turksib").stoves, st * action("coalban").effect.stoves);
  assert.equal(dist(s, "turksib").mood, mood + action("coalban").effect.mood);
  assert.deepEqual(dist(s, "turksib").done, ["coalban"]);
  assert.equal(s.building.length, 0);
}

// --- AQI по брейкпоинтам EPA 2024 ---
{
  const table = [
    [0, 0], [9, 50], [9.1, 51], [35.4, 100], [35.5, 101], [55.4, 150], [55.5, 151],
    [125.4, 200], [125.5, 201], [225.4, 300], [225.5, 301], [325.4, 500], [325.5, 500], [9999, 500],
  ];
  for (const [pm, aqi] of table) assert.equal(aqiFromPm25(pm), aqi, `PM ${pm} → AQI ${aqi}`);
  assert.equal(aqiFromPm25(9.09), 50, "PM truncated to 0.1, as EPA does");
  assert.equal(aqiFromPm25(-1), 0);
  assert.equal(aqiFromPm25(22.25), 75, "linear inside a band");
  let prev = -1;
  for (let pm = 0; pm < 400; pm += 0.1) {
    const a = aqiFromPm25(pm);
    assert.ok(a >= prev, `AQI must not drop at PM ${pm}`);
    prev = a;
  }
}

// --- PM2.5, AQI и рейтинг ---
{
  const s = newCity(1);
  s.wind = "n";
  for (const d of s.districts) d.smog = 10;
  const pm = 10 * SIM.pm25Scale;
  assert.ok(Math.abs(districtPm25(s, "almaly") - pm) < 1e-9 && Math.abs(cityPm25(s) - pm) < 1e-9);
  assert.equal(districtAqi(s, "almaly"), aqiFromPm25(pm), "district AQI comes from PM2.5");
  assert.equal(cityAqi(s), aqiFromPm25(pm), "city AQI comes from PM2.5");
  // штиль поднимает концентрацию при той же массе смога; зимой сильнее
  const calm = { ...s, wind: "calm" };
  assert.ok(Math.abs(districtPm25(calm, "almaly") - pm * SIM.calmMix.spring) < 1e-9);
  assert.ok(SIM.calmMix.winter > SIM.calmMix.spring);
  // город взвешен населением
  const w = newCity(1);
  w.wind = "n";
  for (const d of w.districts) d.smog = 0;
  dist(w, "auezov").smog = 10;
  const popSum = w.districts.reduce((a, d) => a + d.pop, 0);
  assert.ok(Math.abs(cityPm25(w) - pm * dist(w, "auezov").pop / popSum) < 1e-9, "population-weighted");
  assert.equal(rating(s), SIM.moodStart);
}

// --- концовки ---
{
  let s = newCity(1);
  for (const d of s.districts) d.mood = 0;
  s = tick(s);
  assert.equal(s.ended, "fired");
  assert.throws(() => tick(s), "tick after end throws");
  assert.ok(!canAct(s, "alatau", "parking"));

  s = newCity(1);
  s.budget = -1e6;
  s = run(s, SIM.debtDaysLimit - 1);
  assert.equal(s.ended, null, "still in office one day before");
  s = tick(s);
  assert.equal(s.ended, "bankrupt", "bankrupt exactly after the debt limit");

}

// --- рост города ---
{
  let s = newCity(1);
  const traffic = dist(s, "almaly").traffic, pop = dist(s, "almaly").pop;
  s = run(s, 359);
  assert.equal(dist(s, "almaly").traffic, traffic, "no growth inside a year");
  s = tick(s);
  assert.ok(Math.abs(dist(s, "almaly").traffic - traffic * 1.04) < 1e-9, "traffic +4% a year");
  assert.ok(Math.abs(dist(s, "almaly").pop - pop * 1.015) < 1e-9, "population +1.5% a year");
  assert.ok(s.log.some(e => e.kind === "growth"), "growth logged");
  // сложность растёт по годам: с года growthFrom каждый год быстрее
  const yearStep = y => {
    let x = newCity(1);
    x.day = (y - 1) * 360 - 1;
    const t0 = dist(x, "almaly").traffic;
    x = tick(x);
    return dist(x, "almaly").traffic / t0 - 1;
  };
  assert.ok(Math.abs(yearStep(SIM.growthFrom) - 0.04) < 1e-9, "same pace up to growthFrom");
  assert.ok(Math.abs(yearStep(SIM.growthFrom + 1) - 0.04 * (1 + SIM.growthStep)) < 1e-9, "faster after it");
  assert.ok(yearStep(SIM.growthFrom + 4) > yearStep(SIM.growthFrom + 2), "and faster every year");
}

// --- путь мер: меры открываются тем, что уже готово, а не годом ---
{
  realTree();
  const s = newCity(1);
  s.budget = 1e4;
  const done = (x, id, d) => { const y = structuredClone(x); if (d) dist(y, d).done.push(id); else y.cityDone.push(id); return y; };
  // с начала: котельная, автобус, парк, выслушать, фильтры
  for (const id of ["bus", "park", "boiler", "listen"]) assert.ok(canAct(s, "alatau", id), `${id} from the start`);
  assert.ok(canProject(s, "filters"), "filters from the start");
  // закрыто, с причиной и прогрессом
  const gas = actStatus(s, "alatau", "gas");
  assert.equal(gas.ok, false);
  assert.equal(gas.locked, true);
  assert.equal(gas.reason, "откроется после: Котельная (в любом районе)");
  assert.deepEqual(gas.progress, { have: 0, count: 1 });
  assert.equal(actStatus(s, "alatau", "parking").reason, "откроется после: Автобусный маршрут (в любом районе)");
  assert.equal(actStatus(s, "alatau", "coalban").reason, "откроется после: Замена котлов на газ (в любом районе)");
  assert.equal(actStatus(s, "alatau", "gas-subsidy").reason, "откроется после: Замена котлов на газ в этом районе");
  assert.equal(projectStatus(s, "metro").reason, "откроется после: 2 автобусных маршрута (готово 0)");
  assert.equal(projectStatus(s, "tec2gas").reason, "откроется после: Фильтры на ТЭЦ");
  assert.throws(() => act(s, "alatau", "gas"));
  assert.throws(() => cityProject(s, "tec2gas"));
  // стройка ещё идёт — не считается
  const going = act(s, "turksib", "boiler");
  assert.ok(!canAct(going, "alatau", "gas"), "a boiler under construction does not open gas");
  // котельная где угодно → газ везде
  const b = done(s, "boiler", "turksib");
  assert.ok(canAct(b, "alatau", "gas") && canAct(b, "turksib", "gas"), "gas after any boiler");
  // газ в районе → субсидия только там, и штрафы за уголь — везде
  const g = done(b, "gas", "turksib");
  assert.ok(canAct(g, "turksib", "gas-subsidy"), "subsidy where gas is done");
  assert.ok(!canAct(g, "alatau", "gas-subsidy"), "but not in another district");
  assert.ok(unlockStatus(g, "gas-subsidy").ok && !unlockStatus(b, "gas-subsidy").ok, "without a district: open somewhere");
  assert.ok(canAct(g, "alatau", "coalban"), "fines after gas somewhere");
  // автобус → парковка; 2 автобуса → метро, прогресс 1/2
  const bus1 = done(s, "bus", "almaly");
  assert.ok(canAct(bus1, "auezov", "parking"));
  const m1 = projectStatus(bus1, "metro");
  assert.equal(m1.reason, "откроется после: 2 автобусных маршрута (готово 1)");
  assert.deepEqual(m1.progress, { have: 1, count: 2 });
  assert.ok(canProject(done(bus1, "bus", "auezov"), "metro"), "metro after 2 bus routes");
  // фильтры → ТЭЦ-2
  assert.ok(canProject(done(s, "filters"), "tec2gas"), "ТЭЦ-2 after filters");
  // нехватка денег — отдельная причина, не замок
  const poor = { ...b, budget: 0 };
  const np = actStatus(poor, "alatau", "gas");
  assert.equal(np.reason, REASONS.noMoney);
  assert.ok(!np.locked && /накопится примерно через \d+ дн\./.test(np.detail), np.detail);
  // готовая стройка пишет в ленту, что открылось; где "same" — с районом
  let x = act(s, "turksib", "boiler");
  x = run(x, getAction("boiler").days + 1);
  const opened = x.log.find(e => e.kind === "unlock");
  assert.ok(opened && opened.text === "Открыто: Замена котлов на газ" && opened.unlock === "gas", "unlock logged");
  let y = act({ ...b, budget: 1e4 }, "turksib", "gas");
  y = run(y, getAction("gas").days + 1);
  const sub = y.log.filter(e => e.kind === "unlock").map(e => e.text);
  assert.ok(sub.includes("Открыто: Субсидия на газ, Турксибский район") && sub.includes("Открыто: Штрафы за уголь"), sub.join("; "));
  // указ года 3 разрешает ТЭЦ-2 и без фильтров
  assert.ok(unlockStatus({ ...s, granted: ["tec2gas"] }, "tec2gas").ok, "a decree grant opens it early");
  // детерминизм не тронут: путь мер не берёт случайность
  assert.deepEqual(run(act(newCity(5), "turksib", "boiler"), 120), run(act(newCity(5), "turksib", "boiler"), 120));
  openAll();
}

// --- указ президента ---
{
  realDecrees();
  realTree();
  const fresh = seed => ({ ...startCity(seed), nextEventDay: Infinity, banEventDone: true });
  // Год 1: окно указа сразу, время стоит, пока не приняли
  let s = fresh(1);
  assert.deepEqual(s.pendingDecree, { year: 1 });
  assert.throws(() => rawTick(s), /decree pending/);
  assert.equal(s.decree.year, 1);
  assert.deepEqual(s.decree.obstacles, ["empty-treasury", "bureaucracy"]);
  assert.equal(s.budget, SIM.startBudget + getObstacle("empty-treasury").budget, "empty treasury: less money at the start");
  assert.deepEqual(s.decree.unlocks, [], "year 1 grants nothing: the start set is open anyway");
  assert.ok(Math.abs(netIncome(acceptDecree(s)) / netIncome({ ...acceptDecree(s), mods: {} }) - 0.85) < 1e-9, "empty treasury: debts eat 15% of income all year");
  const frozen = structuredClone(s);
  const a = acceptDecree(s);
  assert.deepEqual(s, frozen, "acceptDecree must not mutate");
  assert.equal(a.pendingDecree, null);
  assert.equal(rawTick(a).day, 1);
  assert.throws(() => acceptDecree(a), "nothing to accept");
  const st = decreeStatus(a);
  assert.equal(st.year, 1);
  assert.equal(st.daysLeft, 360);
  assert.equal(st.tasks[0].kind, "winter");
  assert.equal(st.tasks[0].text, `Зимой средний AQI города ниже ${SIM.decree.years[0].tasks[0].aqi}`);
  // до зимы — прогноз обычной зимы, состояние по нему
  const t0 = st.tasks[0], aim = SIM.decree.years[0].tasks[0].aqi;
  assert.equal(t0.value, null, "winter has not started");
  assert.ok(Math.abs(t0.forecast - winterForecast(a).aqi) < 1e-9, "forecast at current measures");
  assert.equal(t0.forecastBuilding, t0.forecast, "nothing is building yet");
  assert.equal(t0.state, t0.forecast < aim - 4 ? "ok" : t0.forecast < aim ? "risk" : "bad");
  assert.equal(st.obstacles[0].icon, getObstacle("empty-treasury").icon);
  assert.equal(st.risk, t0.state);
  const filt = decreeStatus({ ...cityProject({ ...a, budget: 1000, day: 40 }, "filters") }).tasks[0];
  assert.ok(filt.forecastBuilding < filt.forecast - 3, "filters ready before winter lower the forecast after builds");
  assert.ok(Math.abs(filt.forecast - t0.forecast) < 1e-9, "the current-measures forecast ignores what is still building");
  // Бюрократия: в первые 30 дней стройка сначала согласуется, мгновенные действия — нет
  let b = act(a, "turksib", "bus");
  assert.equal(b.building[0].approval, getObstacle("bureaucracy").approvalDays);
  b = run({ ...b, day: 40 }, 0);
  assert.equal(act(b, "alatau", "bus").building.at(-1).approval, undefined, "after the window: straight to work");

  // Проверка 1 января: зимняя задача
  const yearEnd = (year, winterAqi, setup) => {
    const x = { ...fresh(1), pendingDecree: null };
    x.day = year * 360 - 1;
    x.decree = { ...x.decree, year, tasks: SIM.decree.years[year - 1].tasks.map(t => ({ ...t })), startStoves: x.districts.reduce((q, d) => q + d.stoves, 0) };
    for (const d of x.districts) { d.mood = 70; d.smog = 0; }
    x.wind = "n";
    Object.assign(x, { winterSum: winterAqi * 89, winterPmSum: 30 * 89, winterDays: 89 });
    setup?.(x);
    return rawTick(x);
  };
  const t1 = SIM.decree.years[0].tasks[0].aqi;
  let ok = yearEnd(1, t1 - 3);
  assert.equal(ok.ended, null, "cleaner winter: decree done");
  assert.equal(ok.decreesDone, 1);
  assert.ok(ok.log.some(e => e.kind === "decree" && e.text.includes("выполнен")));
  assert.ok(ok.pendingReport && ok.pendingDecree, "report and the next decree");
  assert.equal(ok.pendingDecree.year, 2);
  assert.equal(ok.decree.year, 2);
  assert.deepEqual(ok.decree.obstacles, ["gas-price", "coal-lobby"]);
  assert.equal(ok.pendingReport.decree.tasks[0].value, ok.lastWinterAqi);
  assert.equal(ok.pendingReport.reward, SIM.decree.reward.budget);
  let bad = yearEnd(1, t1 + 9);
  assert.equal(bad.ended, "decree", "dirtier winter: instant end");
  assert.equal(bad.phase, "ended");
  assert.equal(bad.pendingReport, null, "no report, no warning");
  assert.equal(bad.decreeFail.kind, "winter");
  assert.equal(bad.decreeFail.target, t1);
  const v = Math.round(bad.lastWinterAqi);
  assert.equal(endingText(bad), `Указ не выполнен: зимой средний AQI ${v} при задаче ниже ${t1}. Президент освобождает вас от должности`);
  assert.throws(() => rawTick(bad));
  // Год 2: печи — от числа на 1 января
  const t2 = SIM.decree.years[1].tasks;
  const stoveYear = cut => yearEnd(2, t2[1].aqi - 5, x => { for (const d of x.districts) d.stoves *= 1 - cut; });
  assert.equal(stoveYear(t2[0].cut + 0.02).ended, null, "enough stoves removed");
  const few = stoveYear(t2[0].cut - 0.1);
  assert.equal(few.ended, "decree");
  assert.equal(few.decreeFail.kind, "stoves");
  assert.match(endingText(few), new RegExp(`печей на угле стало меньше на ${Math.round((t2[0].cut - 0.1) * 100)}% при задаче ${Math.round(t2[0].cut * 100)}%`));
  // from "start": задача года 2 считается от печей при назначении, а не от 1 января (газ первого года тоже в счёт)
  assert.equal(t2[0].from, "start");
  assert.match(decreeTaskText(t2[0]), /при вашем назначении/);
  {
    let z = { ...fresh(1), pendingDecree: null, day: 359 };
    for (const d of z.districts) d.mood = 70;
    for (const d of z.districts) d.stoves *= 0.8; // газ первого года
    z.lastWinterAqi = 0; z.winterDays = 0;
    z = rawTick({ ...z, decree: { ...z.decree, tasks: [] } });
    assert.equal(z.decree.year, 2);
    assert.equal(z.decree.startStoves, z.firstStoves, "year-2 base is the day of appointment");
    assert.ok(decreeStatus(z).tasks.find(x => x.kind === "stoves").value > 0.15, "first-year cuts count");
  }
  assert.equal(yearEnd(2, t2[1].aqi + 5, x => { for (const d of x.districts) d.stoves *= 0.5; }).decreeFail.kind, "winter", "both tasks count");
  // Год 3: ТЭЦ-2 до осени — провал в тот же день, не в конце года
  let y3 = { ...fresh(1), pendingDecree: null, day: 720 + 178 };
  y3.decree = { ...y3.decree, year: 3, tasks: SIM.decree.years[2].tasks.map(t => ({ ...t })) };
  for (const d of y3.districts) d.mood = 70;
  y3.granted = ["tec2gas"]; // указ года 3 разрешает ТЭЦ-2 без фильтров (проверка выдачи — ниже)
  y3 = rawTick(y3);
  assert.equal(y3.ended, null, "one day left");
  assert.equal(decreeStatus(y3).tasks[0].state, "bad");
  const late = rawTick(y3);
  assert.equal(late.ended, "decree");
  assert.equal(late.day, 900);
  assert.match(endingText(late), /ТЭЦ-2 на газ так и не начат до осени/);
  y3.budget = 1000;
  const started = rawTick(cityProject(y3, "tec2gas"));
  assert.equal(started.ended, null, "started in time: approval counts as started");
  assert.equal(decreeStatus(started).tasks[0].state, "done");
  {
    // настоящий указ года 3: «Указом разрешено: ТЭЦ-2 на газ» — в окне указа и в ленте, и мера открыта
    let z = { ...fresh(1), pendingDecree: null, day: 719 };
    z.decree = { ...z.decree, year: 2, tasks: [] };
    for (const d of z.districts) d.mood = 70;
    assert.ok(!projectStatus(z, "tec2gas").ok);
    z = rawTick(z);
    assert.equal(z.decree.year, 3);
    assert.deepEqual(z.decree.unlocks, ["tec2gas"]);
    assert.deepEqual(decreeStatus(z).unlocks, ["tec2gas"]);
    assert.ok(z.log.some(e => e.kind === "unlock" && e.text === "Указом разрешено: ТЭЦ-2 на газ" && e.unlock === "tec2gas"));
    z.budget = 1000;
    assert.ok(canProject(z, "tec2gas"), "granted without filters");
  }
  // Год 4: ни одного дня выше черты — провал в тот же день
  const line = SIM.decree.years[3].tasks[0].aqi;
  let y4 = { ...fresh(1), pendingDecree: null, day: 1080 + 280 };
  y4.decree = { ...y4.decree, year: 4, tasks: [{ kind: "peak", aqi: line }] };
  for (const d of y4.districts) { d.mood = 70; d.smog = 0; }
  y4.wind = "n";
  assert.equal(rawTick(y4).ended, null, "clean day");
  assert.equal(decreeStatus(rawTick(y4)).tasks[0].state, "ok");
  for (const d of y4.districts) d.smog = 2000;
  const peak = rawTick(y4);
  assert.equal(peak.ended, "decree", "one dirty day is enough");
  assert.ok(peak.decreeFail.value > line);
  assert.match(endingText(peak), new RegExp(`AQI города дошёл до ${peak.decreeFail.value} при задаче не выше ${line}`));
  // Годы 5+: случайная задача из пула, строже с каждым годом, 1–2 преграды из колоды; один seed — один сценарий
  const later = (seed, y) => { const x = { ...fresh(seed), pendingDecree: null, day: (y - 1) * 360 - 1 }; x.decree = { ...x.decree, year: y - 1, tasks: [] }; for (const d of x.districts) d.mood = 70; return rawTick(x).decree; };
  const d5 = later(4, 5), d6 = later(4, 6);
  assert.equal(d5.obstacles.length, 1);
  assert.equal(d6.obstacles.length, 2);
  for (const o of [...d5.obstacles, ...d6.obstacles]) assert.ok(SIM.decree.deck.includes(o), o);
  assert.deepEqual(later(4, 5), d5, "same seed, same decree");
  const strict = {};
  for (let seed = 1; seed <= 40; seed++) for (const y of [5, 9]) {
    const t = later(seed, y).tasks[0];
    (strict[t.kind] ??= {})[y] = t.kind === "stoves" ? t.cut : t.aqi;
  }
  for (const [k, by] of Object.entries(strict)) {
    if (by[5] === undefined || by[9] === undefined) continue;
    assert.ok(k === "stoves" ? by[9] > by[5] : by[9] < by[5], `${k}: stricter every year`);
  }
  // Тексты задач — с числами
  for (const y of SIM.decree.years) for (const t of y.tasks) assert.match(decreeTaskText(t), /\d/);
  openAll();
  calmDecrees();
}

// --- преграды года: настоящие модификаторы симуляции ---
{
  realDecrees();
  const withObstacles = (ids, setup) => {
    SIM.decree.years[0].obstacles = ids;
    const s = { ...startCity(2), pendingDecree: null, nextEventDay: Infinity, banEventDone: true, airMeasures: 1 };
    setup?.(s);
    return s;
  };
  const plain = withObstacles([]);
  // Морозы: зимой ТЭЦ и печи ×1.15
  const frost = withObstacles(["frost"]);
  const w = x => ({ ...x, day: 300 });
  assert.ok(Math.abs(districtEmission(w(frost), "turksib").stoves / districtEmission(w(plain), "turksib").stoves - 1.15) < 1e-9);
  assert.ok(Math.abs(plantEmission(w(frost), "tec2") / plantEmission(w(plain), "tec2") - 1.15) < 1e-9);
  assert.equal(districtEmission(frost, "turksib").stoves, districtEmission(plain, "turksib").stoves, "not in spring");
  // Застройка предгорий: ветер уносит меньше
  const blow = ids => { const x = withObstacles(ids); x.wind = "n"; for (const d of x.districts) Object.assign(d, { smog: 0, stoves: 0, traffic: 0 }); for (const p of x.plants) p.mult = 0; dist(x, "almaly").smog = 100; return dist(tick(x), "zhetysu").smog; };
  assert.ok(Math.abs(blow(["foothills"]) / blow([]) - getObstacle("foothills").windShare) < 1e-9, "foothills: less wind");
  // Бум машин и тарифный бунт — сразу
  assert.ok(Math.abs(dist(withObstacles(["car-boom"]), "almaly").traffic / dist(plain, "almaly").traffic - 1.1) < 1e-9);
  assert.equal(rating(withObstacles(["tariff-riot"])), rating(plain) - 10);
  // Урезание трансфертов: доход −20%
  const inc = x => netIncome({ ...x, upkeep: 0 });
  assert.ok(Math.abs(inc(withObstacles(["transfers-cut"])) / inc(plain) - 0.8) < 1e-9);
  // Забастовки: порог выше
  const moody = ids => { const x = withObstacles(ids); dist(x, "almaly").mood = SIM.strikeMood + 2; return districtStatus(x, "almaly").strike; };
  assert.equal(moody([]), false);
  assert.equal(moody(["strikes"]), true, "strikes start earlier");
  // Угольное лобби: котельная вдвое слабее, а субсидия после замены котлов — в полную силу
  const boiler = ids => { let x = withObstacles(ids); x.budget = 1000; const s0 = dist(x, "turksib").stoves; x = run(act(x, "turksib", "boiler"), 80); return 1 - dist(x, "turksib").stoves / s0; };
  assert.ok(Math.abs(boiler(["coal-lobby"]) - boiler([]) / 2) < 0.02, "lobby halves the boiler");
  // Республика тянет: согласование ТЭЦ-2 вдвое дольше
  const appr = ids => { const x = withObstacles(ids); x.budget = 1000; x.day = 720; return cityProject(x, "tec2gas").building[0].approval; };
  assert.ok(appr(["slow-republic"]) >= getProject("tec2gas").approval[0] * 2, "slower approval");
  // Присоединение сёл: один район (из rng судьбы), печей больше
  const an = withObstacles(["annexation"]);
  assert.ok(STOVE_DISTRICTS.includes(an.decree.where));
  assert.ok(dist(an, an.decree.where).stoves > dist(plain, an.decree.where).stoves);
  // Авария на ТЭЦ: выбросы вдвое в свои дни
  const acc = withObstacles(["plant-accident"]);
  const { start } = acc.mods.burst;
  assert.ok(Math.abs(plantEmission({ ...acc, day: start }, "tec2") / plantEmission({ ...plain, day: start }, "tec2") - 2) < 1e-9);
  assert.equal(plantEmission({ ...acc, day: start + 30 }, "tec2"), plantEmission({ ...plain, day: start + 30 }, "tec2"));
  // У каждой преграды иконка, имя и эффект словами
  for (const [id, o] of Object.entries(SIM.obstacles)) assert.ok(o.icon && o.name && o.text.length > 10, id);
  for (const y of DECREE.years) for (const id of y.obstacles) assert.ok(SIM.obstacles[id], id);
  for (const id of DECREE.deck) assert.ok(SIM.obstacles[id], id);
  realDecrees();
  calmDecrees();
}

// --- погода зимы: видимая удача ---
{
  realDecrees();
  const p = Object.values(SIM.winters).reduce((a, w) => a + w.p, 0);
  assert.ok(Math.abs(p - 1) < 1e-9, "probabilities add up");
  // Прогноз на день 240 года: окно без выбора, строка в ленте, тип из rng судьбы
  let s = { ...startCity(3), pendingDecree: null, nextEventDay: Infinity, banEventDone: true, airMeasures: 1, day: 239 };
  for (const d of s.districts) d.mood = 70;
  s = rawTick(s);
  assert.ok(s.pendingForecast && SIM.winters[s.winter], "forecast");
  assert.equal(s.pendingForecast.type, s.winter);
  assert.deepEqual(s.winters, [{ year: 1, type: s.winter }]);
  assert.ok(s.log.some(e => e.kind === "forecast" && e.text.includes(SIM.winters[s.winter].name)));
  assert.throws(() => rawTick(s), /forecast/);
  assert.equal(ackForecast(s).pendingForecast, null);
  // Тип зимы меняет рассеивание зимой: малоснежная хуже, снежная лучше
  const keep = type => { const x = { ...newCity(1), day: 300, winter: type, wind: "n" }; for (const d of x.districts) Object.assign(d, { smog: 100, stoves: 0, traffic: 0 }); for (const pl of x.plants) pl.mult = 0; return dist(tick(x), "bostandyk").smog; };
  assert.ok(keep("low-snow") > keep("normal") && keep("normal") > keep("snowy"), "snow washes smog out");
  // Тип зимы не зависит от решений игрока
  const types = decide => { let x = { ...startCity(11), nextEventDay: Infinity, banEventDone: true, airMeasures: 1 }; while (x.day < 3 * 360 && !x.ended) { x = decide(tick(x)); for (const d of x.districts) d.mood = 70; x.decree = { ...x.decree, tasks: [] }; } return x.winters.map(w => w.type); };
  const lazy = types(x => x);
  const busy = types(x => (x.day === 10 ? act({ ...x, budget: 1000 }, "turksib", "boiler") : x));
  assert.equal(lazy.length, 3);
  assert.deepEqual(busy, lazy, "same seed, same winters, whatever the player does");
  // Частоты близки к заданным
  const count = {};
  for (let seed = 1; seed <= 400; seed++) {
    let x = { ...startCity(seed), pendingDecree: null, nextEventDay: Infinity, banEventDone: true, airMeasures: 1, day: 239 };
    for (const d of x.districts) d.mood = 70;
    x = rawTick(x);
    count[x.winter] = (count[x.winter] ?? 0) + 1;
  }
  for (const [k, w] of Object.entries(SIM.winters)) assert.ok(Math.abs(count[k] / 400 - w.p) < 0.07, `${k}: ${count[k]}/400 vs ${w.p}`);
  calmDecrees();
}

// --- режим НМУ ---
{
  let s = newCity(1);
  s.budget = 100;
  assert.equal(nmuStatus(s).ok, false);
  assert.equal(nmuStatus(s).reason, REASONS.winterOnly);
  assert.throws(() => startNmu(s));
  s.day = 280;
  assert.equal(nmuStatus(s).ok, true);
  const before = structuredClone(s);
  const n = startNmu(s);
  assert.deepEqual(s, before, "startNmu must not mutate");
  assert.equal(n.budget, 100 - SIM.nmu.cost);
  assert.equal(rating(n), rating(s) + SIM.nmu.mood);
  assert.equal(nmuStatus(n).reason, REASONS.active);
  const e0 = districtEmission(s, "turksib"), e1 = districtEmission(n, "turksib");
  assert.ok(Math.abs(e1.traffic / e0.traffic - SIM.nmu.traffic) < 1e-9 && Math.abs(e1.stoves / e0.stoves - SIM.nmu.stoves) < 1e-9);
  assert.ok(Math.abs(plantEmission(n, "tec2") / plantEmission(s, "tec2") - SIM.nmu.plant) < 1e-9);
  const after = run(n, SIM.nmu.days);
  assert.equal(after.nmuLeft, 0, "lasts its days");
  assert.equal(nmuStatus(after).reason, REASONS.cooldown(SIM.nmu.cooldown));
  assert.equal(nmuStatus(run(after, SIM.nmu.cooldown)).ok, true, "available again after the cooldown");
  assert.equal(startNmu({ ...newCity(1), day: 280, airMeasures: 0 }).airMeasures, 1, "counts as a measure");
}

// --- умные решения: синергии ---
{
  // Субсидия открывается только после готового газа (путь мер), поэтому у газа своей синергии нет:
  // «газ после субсидии» невозможен. Котлы фиксирует сама субсидия (gasLocked).
  assert.equal(action("gas").synergy, undefined);
  // Субсидия после замены котлов сильнее и не боится угольного лобби
  let g = run(act({ ...newCity(3), budget: 2000 }, "turksib", "gas"), action("gas").days + action("gas").effect.ramp + 1);
  const g0 = dist(g, "turksib").stoves;
  assert.ok(synergyActive(g, "turksib", "gas-subsidy"));
  g = { ...g, mods: { ...g.mods, weaken: { "gas-subsidy": 0.5 } } };
  assert.ok(Math.abs(dist(act(g, "turksib", "gas-subsidy"), "turksib").stoves / g0 - action("gas-subsidy").synergy.stoves) < 1e-9);
  assert.ok(dist(act(g, "turksib", "gas-subsidy"), "turksib").gasLocked, "the subsidy keeps the new boilers on gas");
  // Парковка с автобусом: к соседям машины не уезжают
  const spill = withBus => {
    let s = newCity(1);
    s.budget = 1000;
    if (withBus) s = run(act(s, "almaly", "bus"), action("bus").days);
    const n0 = dist(s, "zhetysu").traffic;
    s = act(s, "almaly", "parking");
    return dist(s, "zhetysu").traffic - n0;
  };
  assert.ok(spill(false) > 0);
  assert.equal(spill(true), 0, "bus + parking: no spill");
  // Автобус на линии готового метро и метро там, где уже ходят автобусы
  let m = { ...newCity(1), budget: 2000, cityDone: ["metro"] };
  assert.ok(synergyActive(m, "almaly", "bus") && !synergyActive(m, "turksib", "bus"));
  const t0 = dist(m, "almaly").traffic;
  m = run(act(m, "almaly", "bus"), action("bus").days);
  assert.ok(Math.abs(dist(m, "almaly").traffic / t0 - action("bus").synergy.traffic) < 1e-9);
  let mb = { ...newCity(1), budget: 2000 };
  mb = run(act(mb, "almaly", "bus"), action("bus").days);
  const tb = dist(mb, "almaly").traffic, ta = dist(mb, "auezov").traffic;
  mb = cityProject(mb, "metro");
  Object.assign(mb.building[0], { left: 1 });
  mb = tick(mb);
  assert.ok(Math.abs(dist(mb, "almaly").traffic / tb - getProject("metro").effect.traffic * getProject("metro").synergy.traffic) < 1e-9);
  assert.ok(Math.abs(dist(mb, "auezov").traffic / ta - getProject("metro").effect.traffic) < 1e-9, "no bus, no bonus");
  for (const a of [...DISTRICT_ACTIONS, ...CITY_PROJECTS]) if (a.synergy) assert.ok(a.synergy.text.length > 20, a.id);
}

// --- география ветра: кто кому приносит смог ---
{
  // Только то, что делает wind(s): north уносит из Алмалинского в Жетысуский и Алатауский
  assert.deepEqual(windLinks("almaly").n.to.sort(), ["alatau", "zhetysu"]);
  assert.ok(windLinks("zhetysu").n.from.includes("almaly"));
  assert.ok(windLinks("alatau").n.from.includes("almaly") && windLinks("alatau").n.from.includes("auezov"));
  assert.deepEqual(windLinks("bostandyk").s.to, [], "mountains in the south");
  for (const d of DISTRICTS) for (const dir of ["n", "s", "w", "e"]) for (const id of windLinks(d.id)[dir].to) assert.ok(windLinks(id)[dir].from.includes(d.id));
}

// --- события ---
{
  // Появляются через 45–70 дней, время стоит, пока не ответишь
  const gaps = [];
  let s = startCity(11);
  s.banEventDone = true;
  s.airMeasures = SIM.idle.needed;
  let lastDay = 0;
  assert.equal(s.pendingEvent, null);
  assert.ok(s.nextEventDay >= SIM.eventGap[0] && s.nextEventDay <= SIM.eventGap[1], "first event scheduled");
  const seen = [];
  for (let n = 0; n < 12; n++) {
    while (!s.pendingEvent) { s = tick(s); for (const d of s.districts) d.mood = 60; }
    gaps.push(s.day - lastDay);
    lastDay = s.day;
    const c = getCard(s.pendingEvent.cardId);
    seen.push(c.id);
    assert.ok(c, "pending card exists");
    assert.ok(cardEligible(s, c), `${c.id} eligible on day ${s.day}`);
    assert.throws(() => tick(s), /event pending/, "tick stops while an event is pending");
    const frozen = structuredClone(s);
    assert.throws(() => resolveEvent(s, 2), "bad option");
    const after = resolveEvent(s, 0);
    assert.deepEqual(s, frozen, "resolveEvent must not mutate");
    assert.equal(after.pendingEvent, null);
    assert.equal(after.log.at(-1).kind, "event");
    assert.equal(after.day, s.day, "resolving takes no time");
    s = after;
  }
  for (const g of gaps) assert.ok(g >= SIM.eventGap[0] && g <= SIM.eventGap[1], `gap ${g}`);
  assert.equal(new Set(seen).size, seen.length, "no repeats within a period");
  assert.throws(() => resolveEvent(s, 0), "nothing to resolve");

  // Условия карточек
  const base = startCity(1);
  const card = id => CARDS.find(c => c.id === id);
  const on = (patch, id) => cardEligible({ ...base, ...patch }, card(id));
  const winter = { day: 300 };
  assert.ok(on(winter, "blogger-mask") && !on({ day: 100 }, "blogger-mask"), "season respected");
  assert.ok(!on({ day: 300 - 90 * 4 + 90 * 3 - 90 * 3 }, "trash-burning"), "before minTurn");
  assert.ok(!on({ day: 280 - 90 }, "trash-burning") && on({ day: 280 }, "trash-burning"), "minTurn 3 = day 270");
  const withDone = id => ({ ...winter, districts: base.districts.map((d, i) => (i === 3 ? { ...d, done: [id] } : d)) });
  assert.ok(on(winter, "grandma-coal") && !on(withDone("gas"), "grandma-coal"), "notDone stove-gas → gas in any district");
  assert.ok(!on({ day: 10 }, "bus-lane") && on({ ...withDone("bus"), day: 10 }, "bus-lane"), "done buses → bus in any district");
  assert.ok(!on({ day: 10 }, "briquette-resale") && on({ ...withDone("boiler"), day: 10 }, "briquette-resale"), "done stove-subsidy → boiler");
  assert.ok(!on({ day: 10 }, "metro-opened") && on({ day: 10, cityDone: ["metro"] }, "metro-opened"), "done metro → metro");
  assert.ok(!on(winter, "tec-sneaky-coal") && on({ ...winter, cityDone: ["tec2gas"] }, "tec-sneaky-coal"), "done tec-gas → tec2gas");

  // Эффекты: перевод на город
  assert.deepEqual(eventEffects({ budget: -20, rating: 7 }), { budget: -20 * SIM.eventBudget, mood: 7 });
  const pending = (effects) => {
    const x = newCity(1);
    x.budget = 500;
    x.pendingEvent = { cardId: "taxi-ban" };
    const real = getCard("taxi-ban").options[0].effects;
    const saved = { ...real };
    for (const k of Object.keys(real)) delete real[k];
    Object.assign(real, effects);
    const out = resolveEvent(x, 0);
    for (const k of Object.keys(real)) delete real[k];
    Object.assign(real, saved);
    return [x, out];
  };
  let [x, y] = pending({ budget: -20, rating: 5 });
  assert.equal(y.budget, x.budget - 20 * SIM.eventBudget);
  for (const d of x.districts) assert.equal(dist(y, d.id).mood, d.mood + 5, "rating → every district's mood");
  [x, y] = pending({ tec: 4 });
  for (const p of x.plants) assert.ok(Math.abs(y.plants.find(q => q.id === p.id).mult - (1 + 4 / SIM.eventBase.tec)) < 1e-12, "tec → all plants");
  [x, y] = pending({ traffic: -3 });
  for (const d of x.districts) assert.ok(Math.abs(dist(y, d.id).traffic - d.traffic * (1 - 3 / SIM.eventBase.traffic)) < 1e-12, "traffic → all districts");
  [x, y] = pending({ stoves: 2 });
  for (const d of x.districts) {
    const want = STOVE_DISTRICTS.includes(d.id) ? d.stoves * (1 + 2 / SIM.eventBase.stoves) : d.stoves;
    assert.ok(Math.abs(dist(y, d.id).stoves - want) < 1e-12, `stoves only where stoves are: ${d.id}`);
  }
  // настроение не вылетает за 0–100
  [x, y] = pending({ rating: 500 });
  assert.ok(y.districts.every(d => d.mood === 100));
}

// --- долг ---
{
  let s = newCity(1);
  s.budget = -0.01;
  s = tick(s);
  assert.equal(s.debtDays, 0, "income lifts the budget back above 0 → counter resets");
  s = newCity(1);
  s.budget = -1e6;
  s = run(s, 5);
  assert.equal(s.debtDays, 5);
  assert.equal(s.log.filter(e => e.kind === "debt").length, 1, "debt start logged once");
  s.budget = 100;
  s = tick(s);
  assert.equal(s.debtDays, 0, "debt counter resets when budget returns ≥ 0");

  // уволен и банкрот в один день → уволен
  s = newCity(1);
  s.budget = -1e6;
  s.debtDays = SIM.debtDaysLimit - 1;
  for (const d of s.districts) d.mood = 0;
  assert.equal(tick(s).ended, "fired", "fired wins over bankrupt");
}

// --- ветер: сохранение смога ---
{
  const total = x => x.districts.reduce((a, d) => a + d.smog, 0);
  const one = (id, wind) => {
    const s = blank();
    s.wind = wind;
    dist(s, id).smog = 100;
    return total(tick(s));
  };
  const kept = 100 * (1 - SIM.disperse.spring); // только рассеивание ветреного дня
  for (const w of ["n", "s", "w", "e"]) assert.ok(Math.abs(one("almaly", w) - kept) < 1e-9, `interior move (${w}) keeps total`);
  assert.ok(Math.abs(one("auezov", "s") - kept) < 1e-9, "south wind from a non-edge district keeps total");
}

// --- доход и содержание ---
{
  const s = blank();
  for (const d of s.districts) d.mood = SIM.moodCeiling; // на потолке и в чистом воздухе настроение не меняется
  const gross = s.districts.reduce((a, d) => a + d.pop * SIM.taxRate * d.mood / 100, 0);
  assert.ok(Math.abs(netIncome(s) - gross) < 1e-12, "income = Σ pop × rate × mood/100");
  assert.ok(Math.abs(tick(s).budget - (s.budget + gross)) < 1e-9, "tick adds the day's income");

  let b = act(s, "almaly", "bus");
  b = run(b, action("bus").days);
  assert.ok(Math.abs(b.upkeep - action("bus").upkeep) < 1e-12, "upkeep accumulates on completion");
  b = act(b, "auezov", "park");
  b = run(b, action("park").days);
  assert.ok(Math.abs(b.upkeep - action("bus").upkeep - action("park").upkeep) < 1e-12);
  for (const d of b.districts) d.fade = 0; // бонусы строек выветриваются, а здесь проверяется только доход
  const before = b.budget;
  assert.ok(Math.abs(netIncome(b) - (b.districts.reduce((a, d) => a + d.pop * SIM.taxRate * d.mood / 100, 0) - b.upkeep)) < 1e-12);
  const nb = tick(b);
  assert.ok(Math.abs(nb.budget - before - netIncome(b)) < 1e-9, "upkeep reduces the day's income");
}

// --- эффекты построек ---
{
  // достроить на следующем тике
  const finish = (s, entry) => tick({ ...s, building: [{ ...entry, left: 1, days: 10 }] });
  let s = blank();
  for (const d of s.districts) d.mood = SIM.moodCeiling;
  for (const p of s.plants) p.mult = 1;
  const tec = getProject("tec2gas");
  let t2 = finish(s, { kind: "city", id: "tec2gas" });
  assert.equal(t2.plants.find(p => p.id === "tec2").mult, tec.effect.plants.tec2, "tec2gas cuts ТЭЦ-2");
  assert.equal(t2.plants.find(p => p.id === "tec1").mult, 1, "other plants untouched");
  for (const d of t2.districts) assert.ok(Math.abs(d.mood - (SIM.moodCeiling + tec.effect.mood - tec.works.moodPerDay)) < 1e-9, "tec2gas mood bonus everywhere, minus its last day of works");

  s = newCity(1);
  for (const d of s.districts) d.mood = SIM.moodCeiling;
  const metro = getProject("metro");
  const m = finish(s, { kind: "city", id: "metro" });
  for (const d of s.districts) {
    const want = metro.effect.districts.includes(d.id) ? d.traffic * metro.effect.traffic : d.traffic;
    assert.ok(Math.abs(dist(m, d.id).traffic - want) < 1e-12, `metro traffic in ${d.id}`);
  }
  assert.ok(m.districts.every(d => d.mood >= SIM.moodCeiling + metro.effect.mood - 1), "metro mood bonus");

  s = newCity(1);
  const st = dist(s, "turksib").stoves;
  const bo = finish(s, { kind: "district", id: "boiler", district: "turksib" });
  assert.ok(Math.abs(dist(bo, "turksib").stoves - st * action("boiler").effect.stoves) < 1e-12, "boiler cuts stoves");

  s = blank();
  s.day = 300; s.wind = "calm";
  const pk = finish(s, { kind: "district", id: "park", district: "almaly" });
  assert.equal(dist(pk, "almaly").park, action("park").effect.parkDaily);
  dist(pk, "almaly").smog = 100;
  dist(pk, "auezov").smog = 100;
  pk.wind = "calm";
  const pk2 = tick(pk);
  const calmKeep = 1 - SIM.disperse.winter * SIM.calmDisperse;
  assert.ok(Math.abs(dist(pk2, "almaly").smog - 100 * calmKeep * action("park").effect.parkDaily) < 1e-9, "park clears smog daily");
  assert.ok(Math.abs(dist(pk2, "auezov").smog - 100 * calmKeep) < 1e-9);
  assert.equal(getAction("gas").effect.ramp, SIM.rampDays, "ramp length from sim-balance");
}

// --- бесплатные действия и статусы ---
{
  let s = newCity(1);
  s.budget = -1e6;
  assert.ok(canAct(s, "alatau", "coalban") && canAct(s, "alatau", "parking"), "free actions work in debt");
  assert.equal(actStatus(s, "alatau", "bus").reason, "не хватает денег");
  assert.equal(projectStatus(s, "metro").reason, "не хватает денег");
  s = newCity(1);
  s.budget = 1000;
  assert.deepEqual(actStatus(s, "alatau", "bus"), { ok: true, reason: null });
  s = cityProject(act(s, "alatau", "bus"), "filters");
  assert.deepEqual(actStatus(s, "alatau", "bus"), { ok: false, reason: "строится" });
  assert.deepEqual(projectStatus(s, "filters"), { ok: false, reason: "строится" });
  s = act(s, "alatau", "parking");
  assert.deepEqual(actStatus(s, "alatau", "parking"), { ok: false, reason: "уже сделано" });
  s.ended = "fired";
  assert.deepEqual(actStatus(s, "alatau", "boiler"), { ok: false, reason: "игра окончена" });
  assert.deepEqual(projectStatus(s, "metro"), { ok: false, reason: "игра окончена" });
  assert.throws(() => actStatus(s, "alatau", "nothing"));
  assert.throws(() => projectStatus(s, "nothing"));
}

// --- помощники интерфейса ---
{
  let s = newCity(1);
  s = act(s, "alatau", "bus");
  const b0 = s.building[0];
  assert.equal(b0.days, action("bus").days, "building keeps total days");
  assert.equal(progress(s, b0), 0);
  s = run(s, 5);
  assert.equal(progress(s, s.building[0]), 5 / action("bus").days);

  const at = day => date({ ...newCity(1), day });
  const full = (gy, sn, dos, doy) => ({ gameYear: gy, season: sn, dayOfSeason: dos, dayOfYear: doy, yearDaysLeft: 360 - doy });
  assert.deepEqual(at(0), full(1, "spring", 1, 0));
  assert.deepEqual(at(359), full(1, "winter", 90, 359));
  assert.deepEqual(at(360), full(2, "spring", 1, 0));
  assert.deepEqual(at(1800), full(6, "spring", 1, 0));
  assert.equal(date({ day: 90 }).season, "summer", "the feed calls date with a bare day");

  s = blank();
  s.day = 300;
  dist(s, "almaly").traffic = 5;
  dist(s, "almaly").stoves = 2;
  assert.deepEqual(districtEmission(s, "almaly"), { stoves: 2 * SIM.heat.winter, traffic: 5, plant: 0 });
  s.plants.find(p => p.id === "tec2").mult = 1;
  const tec2 = s.plants.find(p => p.id === "tec2");
  assert.equal(plantEmission(s, "tec2"), tec2.emission * SIM.plantHeat.winter);
  const local = districtEmission(s, "alatau").plant, far = districtEmission(s, "almaly").plant;
  assert.ok(local > far && far > 0, "plant plume: most in its district, some citywide");
  const totalPlant = s.districts.reduce((a, d) => a + districtEmission(s, d.id).plant, 0);
  assert.ok(Math.abs(totalPlant - plantEmission(s, "tec2")) < 1e-9, "plume parts add up to the plant");
  s.wind = "calm";
  const before = dist(s, "alatau").smog;
  const e = districtEmission(s, "alatau");
  assert.ok(Math.abs(dist(tick(s), "alatau").smog - (before + e.stoves + e.traffic + e.plant) * (1 - SIM.disperse.winter * SIM.calmDisperse)) < 1e-9);
}

// --- лента ---
{
  let s = newCity(1);
  s = run(s, 90);
  const ss = s.log.find(e => e.kind === "season");
  assert.deepEqual(ss, { day: 90, text: SIM.seasonNews.summer, kind: "season" }, "season change logged with the new day");
  s = act(s, "turksib", "coalban");
  assert.deepEqual(s.log.at(-1), { day: 90, text: "Штрафы за уголь: Турксибский", kind: "action", district: "turksib" });
  s = act(s, "turksib", "bus");
  s = run(s, action("bus").days);
  assert.deepEqual(s.log.at(-1), { day: s.day, text: "Автобусный маршрут: Турксибский", kind: "built", district: "turksib" }, "completion stamped with the day the UI shows");
  for (const e of run(newCity(2), 400).log) assert.ok(["built", "action", "wind", "season", "debt", "decree", "forecast", "unlock", "growth", "event", "chain", "warning", "air", "complaint", "strike"].includes(e.kind));
  assert.ok(run(newCity(2), 360).log.some(e => e.kind === "wind"), "winter calm shows up in the feed");
}

// --- средний AQI и PM2.5 первой и последней зимы ---
{
  // winterStats считает до s.day++ и с ветром этого дня; население растёт в первый день года — допуск на округление AQI.
  const day = s => {
    const wind = s.wind;
    const after = tick(s);
    const today = { ...after, day: s.day, wind, districts: after.districts.map((d, i) => ({ ...d, pop: s.districts[i].pop })) };
    return [after, cityAqi(today), cityPm25(today)];
  };
  let s = newCity(5);
  assert.equal(s.firstWinterAqi, null);
  s = run(s, 270);
  assert.equal(s.lastWinterAqi, null, "до зимы — пусто");
  let sum = 0, pm = 0;
  for (let i = 0; i < 90; i++) { const [n, a, p] = day(s); s = n; sum += a; pm += p; }
  assert.ok(Math.abs(s.firstWinterAqi - sum / 90) < 1e-9, "первая зима — среднее за 90 дней");
  assert.ok(Math.abs(s.firstWinterPm25 - pm / 90) < 1e-9, "и PM2.5 тоже");
  assert.equal(s.lastWinterAqi, s.firstWinterAqi);
  s = run(s, 270); // день 630 — начало второй зимы
  const first = s.firstWinterAqi;
  sum = 0;
  for (let i = 0; i < 10; i++) { const [n, a] = day(s); s = n; sum += a; }
  assert.equal(s.firstWinterAqi, first, "первая зима не меняется");
  assert.ok(Math.abs(s.lastWinterAqi - sum / 10) < 1e-9, "текущая зима считается заново");
}

// --- деньги: сколько не хватает и когда накопится ---
{
  const s = newCity(1);
  s.budget = 10;
  const inc = netIncome(s);
  const need = action("gas").cost; // открыто всё в этих блоках
  const st = actStatus(s, "alatau", "gas");
  const shortfall = Math.ceil(need - SIM.creditLimit - 10);
  assert.equal(st.ok, false);
  assert.equal(st.reason, REASONS.noMoney);
  assert.equal(st.shortfall, shortfall);
  assert.equal(st.daysUntil, Math.ceil(shortfall / inc));
  assert.equal(st.detail, REASONS.shortfall(shortfall, st.daysUntil));
  assert.ok(/не хватает \d+ млрд, накопится примерно через \d+ дн\./.test(st.detail), st.detail);
  const pr = projectStatus(s, "tec2gas");
  assert.equal(pr.shortfall, Math.ceil(getProject("tec2gas").cost - SIM.creditLimit - 10));
  assert.ok(pr.daysUntil > st.daysUntil);
  // прогноз честный: столько дней и правда хватает
  let wait = newCity(1);
  wait.budget = 10;
  const promised = actStatus(wait, "alatau", "bus");
  if (promised.daysUntil) {
    wait = run(wait, promised.daysUntil + 2);
    assert.ok(canAct(wait, "alatau", "bus"), "affordable by the promised day");
  }
  // дохода нет — daysUntil нет
  const poor = newCity(1);
  poor.budget = 0;
  poor.upkeep = 1e3;
  const none = actStatus(poor, "alatau", "gas");
  assert.ok(netIncome(poor) <= 0);
  assert.equal(none.shortfall, Math.ceil(need - SIM.creditLimit));
  assert.ok(!("daysUntil" in none), "no estimate without income");
  assert.equal(none.detail, REASONS.shortfallNever(none.shortfall));
  assert.ok(!("shortfall" in actStatus(newCity(1), "alatau", "bus")), "no shortfall when affordable");
}

// --- люди: митинг, забастовка, «Выслушать людей» ---
{
  const moodIn = (id, m, seed = 1) => {
    const s = newCity(seed);
    dist(s, id).mood = m;
    return s;
  };
  assert.deepEqual(districtStatus(newCity(1), "almaly"), { protest: false, strike: false, cause: null });
  let st = districtStatus(moodIn("almaly", SIM.protestMood - 1), "almaly");
  assert.ok(st.protest && !st.strike && st.cause, "protest below 40");
  assert.equal(districtStatus(moodIn("almaly", SIM.protestMood), "almaly").protest, false, "exactly 40 is no protest");
  st = districtStatus(moodIn("almaly", SIM.strikeMood - 1), "almaly");
  assert.ok(st.protest && st.strike, "strike below 25");
  assert.equal(districtStatus(moodIn("almaly", SIM.strikeMood), "almaly").strike, false, "exactly 25 is no strike");

  // забастовка: налог района вдвое меньше
  const tax = s => netIncome(s);
  const calm = moodIn("auezov", SIM.strikeMood);
  const striking = moodIn("auezov", SIM.strikeMood - 1e-9);
  const full = dist(calm, "auezov").pop * SIM.taxRate * SIM.strikeMood / 100;
  assert.ok(Math.abs(tax(calm) - tax(striking) - full * (1 - SIM.strikeTax)) < 1e-6, "district pays half");

  // забастовка: стройка района стоит, в соседнем идёт; после снятия продолжается
  let s = newCity(1);
  s = act(act(s, "turksib", "bus"), "almaly", "bus");
  dist(s, "turksib").mood = 10;
  dist(s, "turksib").stoves = 0; dist(s, "turksib").smog = 0;
  const leftBefore = s.building.find(b => b.district === "turksib").left;
  s.wind = "s";
  s = tick(s);
  assert.ok(isPaused(s, s.building.find(b => b.district === "turksib")), "isPaused");
  assert.equal(s.building.find(b => b.district === "turksib").left, leftBefore, "paused while on strike");
  assert.equal(s.building.find(b => b.district === "almaly").left, leftBefore - 1, "the neighbour keeps building");
  assert.ok(s.log.some(e => e.kind === "strike" && e.district === "turksib"), "strike logged");
  assert.ok(s.chains.some(c => c.actionId === "strike" && c.district === "turksib"), "strike recorded for the final screen");
  const logged = s.log.filter(e => e.kind === "strike").length;
  s = tick(s);
  assert.equal(s.log.filter(e => e.kind === "strike").length, logged, "strike logged once");

  // городской проект стоит, если бастует район стройки
  let cp = newCity(1);
  cp.budget = 1000;
  cp = cityProject(cp, "filters");
  const f = cp.building[0].left;
  dist(cp, "alatau").mood = 10;
  cp = tick(cp);
  assert.equal(cp.building[0].left, f, "project pauses on a strike at its site");
  dist(cp, "alatau").mood = 60;
  dist(cp, "turksib").mood = 10;
  cp = tick(cp);
  assert.equal(cp.building[0].left, f - 1, "a strike elsewhere doesn't stop it");

  // «Выслушать людей»: цена растёт, можно повторять, снимает забастовку даже при очень низком настроении
  const listen = action("listen");
  let l = newCity(1);
  l.budget = 1000;
  dist(l, "turksib").mood = 3;
  assert.ok(districtStatus(l, "turksib").strike);
  assert.equal(actionCost(l, "turksib", "listen"), listen.cost);
  const b0 = l.budget;
  l = act(l, "turksib", "listen");
  assert.equal(l.budget, b0 - listen.cost, "first time at base price");
  assert.equal(dist(l, "turksib").mood, SIM.strikeMood, "lifted out of the strike");
  assert.equal(districtStatus(l, "turksib").strike, false, "strike over");
  assert.deepEqual(dist(l, "turksib").done, [], "repeatable: not marked done");
  const c2 = actionCost(l, "turksib", "listen");
  assert.ok(c2 > listen.cost, "second time costs more");
  assert.equal(actionCost(l, "almaly", "listen"), listen.cost, "price is per district");
  assert.ok(canAct(l, "turksib", "listen"), "can repeat");
  const b1 = l.budget, m1 = dist(l, "turksib").mood;
  l = act(l, "turksib", "listen");
  assert.equal(l.budget, b1 - c2, "pays the risen price");
  assert.equal(dist(l, "turksib").mood, m1 + listen.effect.mood, "and lifts the mood");
  assert.ok(actionCost(l, "turksib", "listen") > c2, "keeps rising");
  // перемирие: настроение опять ниже порога, но забастовки ещё нет; потом начнётся снова
  dist(l, "turksib").mood = 10;
  assert.equal(districtStatus(l, "turksib").strike, false, "truce holds");
  l.day += SIM.truceDays;
  assert.equal(districtStatus(l, "turksib").strike, true, "truce ends");
  // дорого: нельзя купить без денег
  const broke = newCity(1);
  broke.budget = -SIM.creditLimit;
  assert.equal(actStatus(broke, "alatau", "listen").reason, REASONS.noMoney);
}

// --- жалобы: по причине, без спама ---
{
  const unhappy = (id, setup) => {
    let s = newCity(1);
    for (const d of s.districts) d.mood = 70;
    dist(s, id).mood = 30;
    s.wind = "n";
    setup?.(s);
    return s;
  };
  const clean = s => { for (const d of s.districts) d.smog = 0; };
  const causeOf = (id, setup) => districtStatus(unhappy(id, s => { clean(s); setup?.(s); }), id).cause;
  assert.equal(causeOf("turksib"), "neglect", "nothing going on");
  assert.equal(causeOf("turksib", s => { dist(s, "turksib").smog = 500; }), "smog");
  assert.equal(causeOf("turksib", s => { s.lastWinterAqi = 150; }), "last-winter");
  assert.equal(causeOf("turksib", s => { dist(s, "turksib").since.gas = s.day; }), "tariff");
  assert.equal(causeOf("turksib", s => { dist(s, "turksib").since.coalban = s.day; }), "coalban");
  assert.equal(causeOf("turksib", s => { dist(s, "turksib").since.parking = s.day; }), "parking");
  assert.equal(causeOf("turksib", s => { s.day = 400; dist(s, "turksib").since.gas = 400 - SIM.causeWindow - 1; }), "neglect", "old news");
  const site = id => ({ kind: "city", id, left: 10, days: 100 });
  assert.equal(causeOf("almaly", s => { s.building.push(site("metro")); }), "roadworks", "metro on the line");
  assert.equal(causeOf("turksib", s => { s.building.push(site("metro")); }), "neglect", "metro is not here");
  assert.equal(causeOf("turksib", s => { s.building.push(site("tec2gas")); }), "plant-works");
  assert.equal(causeOf("turksib", s => { s.building.push({ ...site("tec2gas"), approval: 5 }); }), "neglect", "no works while waiting");

  // Текст зависит от причины и несёт числа района
  const said = (id, setup) => {
    const s = tick(unhappy(id, s => { clean(s); setup?.(s); }));
    return s.log.filter(e => e.kind === "complaint");
  };
  const texts = [
    said("turksib", s => { dist(s, "turksib").since.gas = s.day; })[0],
    said("turksib", s => { dist(s, "turksib").since.coalban = s.day; })[0],
    said("almaly", s => { s.building.push(site("metro")); })[0],
    said("turksib", s => { dist(s, "turksib").since.parking = s.day; })[0],
    said("turksib")[0],
  ];
  for (const e of texts) assert.ok(e, "a complaint is logged");
  assert.equal(new Set(texts.map(e => e.text)).size, texts.length, "each cause has its own words");
  assert.ok(texts[0].text.includes("Котёл") && texts[0].district === "turksib");
  assert.ok(texts[1].text.includes("уголь"));
  assert.ok(texts[2].text.includes("метро") && texts[2].text.startsWith("Алмалинский"));
  const smogTick = tick(unhappy("turksib", x => { clean(x); dist(x, "turksib").smog = 500; }));
  const smogSaid = smogTick.log.find(e => e.kind === "complaint");
  assert.ok(smogSaid.text.includes(`AQI ${districtAqi({ ...smogTick, wind: "n" }, "turksib")}`), `smog complaint quotes the real AQI: ${smogSaid.text}`);
  assert.equal(said("turksib", s => { dist(s, "turksib").mood = 60; }).length, 0, "happy districts don't complain");

  // Частота: один район не чаще паузы, город не чаще своей
  let s = newCity(1);
  const days = [], byDistrict = {};
  for (let i = 0; i < 200; i++) {
    for (const d of s.districts) { d.mood = 30; d.truceUntil = Infinity; }
    const before = s.log.filter(e => e.kind === "complaint").at(-1);
    s = tick(s);
    const last = s.log.filter(e => e.kind === "complaint").at(-1);
    if (last && last !== before && last.day === s.day) {
      days.push(s.day);
      (byDistrict[last.district] ??= []).push(s.day);
    }
  }
  assert.ok(days.length >= 8, `complaints do appear: ${days.length}`);
  for (let i = 1; i < days.length; i++) assert.ok(days[i] - days[i - 1] >= SIM.complaintGapCity, "city rate limit");
  for (const list of Object.values(byDistrict)) for (let i = 1; i < list.length; i++) assert.ok(list[i] - list[i - 1] >= SIM.complaintGapDistrict, "district rate limit");
}

// --- воздух к зиме до назначения ---
{
  const base = SIM.baselineWinterPm25;
  assert.equal(airChange(newCity(1)), null, "no winters yet");
  assert.ok(Math.abs(airChange({ ...newCity(1), lastWinterPm25: base / 2 }) - 0.5) < 1e-9);
  assert.ok(Math.abs(airChange({ ...newCity(1), firstWinterPm25: 1, lastWinterPm25: base * 0.8 }) - 0.8) < 1e-9, "the first winter of the game is not the baseline");
}

// --- цепочки последствий ---
{
  const lastChain = (s, id) => s.chains.filter(c => c.actionId === id).at(-1);

  // Запрет угля: сразу печи вниз, через 30–60 дней часть возвращается
  const delays = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    let s = newCity(seed);
    const was = dist(s, "turksib").stoves;
    s = act(s, "turksib", "coalban");
    const banned = dist(s, "turksib").stoves;
    assert.ok(Math.abs(banned - was * action("coalban").effect.stoves) < 1e-9);
    assert.equal(s.chains.length, 0, "nothing fired yet");
    const { at, day } = dist(s, "turksib").delayed[0];
    const wait = at - day;
    assert.ok(wait >= 30 && wait <= 60, `backfire delay ${wait}`);
    delays.add(wait);
    s = run(s, wait - 1);
    assert.equal(dist(s, "turksib").stoves, banned, "no backfire before the delay");
    s = tick(s);
    const back = dist(s, "turksib").stoves - banned;
    const removed = was - banned;
    assert.ok(back >= removed * 0.3 - 1e-9 && back <= removed * 0.5 + 1e-9, `returns part of the cut: ${back / removed}`);
    assert.ok(dist(s, "turksib").stoves < was, "the ban still helps");
    const c = lastChain(s, "coalban");
    assert.equal(c.district, "turksib");
    assert.equal(c.day, s.day);
    assert.ok(c.text.includes(`через ${daysWord(wait)}`), c.text);
    assert.ok(c.text.includes(`${Math.round(back / removed * 100)}%`), c.text);
    assert.ok(c.text.includes("Турксибском") || c.text.includes("Турксибский"), c.text);
    assert.equal(s.log.at(-1).kind === "chain" || s.log.some(e => e.kind === "chain" && e.district === "turksib"), true, "shown in the feed");
  }
  assert.ok(delays.size > 5, "delay varies from game to game");

  // Газ: настроение падает при подключении, доля домов из этой партии
  let g = newCity(4);
  g.budget = 500;
  g = act(g, "alatau", "gas");
  const moodBefore = dist(g, "alatau").mood;
  g = run(g, action("gas").days - 1);
  dist(g, "alatau").mood = 70;
  for (const d of g.districts) d.smog = 0;
  const m0 = dist(g, "alatau").mood;
  g = tick(g);
  assert.ok(dist(g, "alatau").mood < m0 - 4, "mood falls on connection");
  assert.ok(action("gas").effect.mood < 0 && moodBefore > 0);
  const gc = lastChain(g, "gas");
  const ramp = dist(g, "alatau").ramps[0];
  const factor = ramp.perDay ** action("gas").effect.ramp;
  const adopted = (1 - factor) / (1 - action("gas").effect.stoves);
  assert.ok(gc.text.includes(`в ${Math.round(adopted * 100)}% домов`), gc.text);
  assert.ok(adopted < 1 && adopted >= 0.75, `not everyone: ${adopted}`);

  // Парковка: половина снижения уходит к соседям поровну, город в целом всё же теряет машины
  let p = newCity(1);
  const near = ["zhetysu", "auezov", "medeu", "bostandyk", "alatau"];
  const was = Object.fromEntries(p.districts.map(d => [d.id, d.traffic]));
  p = act(p, "almaly", "parking");
  const cut = was.almaly * (1 - action("parking").effect.traffic);
  assert.ok(Math.abs(dist(p, "almaly").traffic - (was.almaly - cut)) < 1e-9);
  for (const id of near) assert.ok(Math.abs(dist(p, id).traffic - was[id] - cut * action("parking").spill / near.length) < 1e-9, `${id} takes its share`);
  for (const id of ["turksib", "nauryzbay"]) assert.equal(dist(p, id).traffic, was[id], `${id} is not a neighbour`);
  const sum = x => x.districts.reduce((a, d) => a + d.traffic, 0);
  assert.ok(Math.abs(sum(p) - (Object.values(was).reduce((a, b) => a + b, 0) - cut * (1 - action("parking").spill))) < 1e-9, "city total falls by the rest");
  assert.equal(lastChain(p, "parking").district, "almaly");
  assert.equal(districtStatus({ ...p, districts: p.districts.map(d => (d.id === "medeu" ? { ...d, mood: 20, smog: 0 } : d)) }, "medeu").cause, "parking", "neighbours are angry too");

  // Метро: на время работ трафик на линии выше и настроение падает, потом — снимается и даёт эффект
  const metro = getProject("metro");
  let m = newCity(1);
  m.budget = 500;
  const line = metro.effect.districts;
  const t0 = Object.fromEntries(line.map(id => [id, dist(m, id).traffic]));
  const off = dist(m, "turksib").traffic;
  m = cityProject(m, "metro");
  for (const id of line) assert.ok(Math.abs(dist(m, id).traffic - t0[id] * metro.works.traffic) < 1e-9, `${id}: roads dug up`);
  assert.equal(dist(m, "turksib").traffic, off, "off the line: no change");
  assert.ok(lastChain(m, "metro").text.includes("+15%"), lastChain(m, "metro").text);
  for (const d of m.districts) { d.mood = SIM.moodCeiling; d.smog = 0; }
  m.wind = "n";
  m = tick(m);
  assert.ok(dist(m, "almaly").mood <= SIM.moodCeiling - metro.works.moodPerDay + 1e-9, "mood falls on the line");
  assert.ok(dist(m, "turksib").mood >= SIM.moodCeiling, "off the line: untouched");
  m.building[0].left = 1;
  for (const d of m.districts) d.mood = SIM.moodCeiling;
  m = tick(m);
  for (const id of line) assert.ok(Math.abs(dist(m, id).traffic - t0[id] * metro.effect.traffic) < 1e-9, `${id}: works undone, metro effect applied`);
  assert.ok(m.chains.some(c => c.actionId === "metro" && c.text.includes("настроение на линии")), "works chain"); // последняя — про содержание

  // ТЭЦ-2: сначала ждём согласования, стройка не идёт и настроение не падает, потом работы
  const tec = getProject("tec2gas");
  const waits = new Set();
  for (let seed = 1; seed <= 20; seed++) {
    let t = newCity(seed);
    t.budget = 1000;
    t = cityProject(t, "tec2gas");
    const b = t.building[0];
    assert.ok(b.approval >= tec.approval[0] && b.approval <= tec.approval[1], `wait ${b.approval}`);
    waits.add(b.approval);
    assert.equal(b.left, tec.days);
    assert.equal(progress(t, b), 0);
  }
  assert.ok(waits.size > 5, "the wait varies");
  let t = newCity(2);
  t.budget = 1000;
  t = cityProject(t, "tec2gas");
  const wait = t.building[0].approval;
  for (const d of t.districts) d.mood = SIM.moodCeiling;
  const tickCalm = x => { for (const d of x.districts) { d.mood = SIM.moodCeiling; d.smog = 0; } return tick(x); };
  for (let i = 0; i < wait - 1; i++) t = tickCalm(t);
  assert.equal(t.building[0].left, tec.days, "no construction while waiting");
  assert.equal(t.building[0].moodLost ?? 0, 0, "no works, no anger");
  assert.ok(dist(t, "turksib").mood >= SIM.moodCeiling, "the city is calm while waiting");
  assert.equal(t.chains.filter(c => c.actionId === "tec2gas").length, 0);
  t = tickCalm(t);
  assert.ok(lastChain(t, "tec2gas").text.includes(`заняло ${daysWord(wait)}`), lastChain(t, "tec2gas").text);
  assert.ok(lastChain(t, "tec2gas").text.includes("согласование с республикой"));
  assert.equal(t.building[0].left, tec.days, "construction starts the next day");
  t = tickCalm(t);
  assert.equal(t.building[0].left, tec.days - 1, "now it runs");
  assert.ok(dist(t, "turksib").mood <= SIM.moodCeiling - tec.works.moodPerDay + 1e-9, "city mood falls during works");
  assert.ok(Math.abs(t.building[0].moodLost - tec.works.moodPerDay) < 1e-9);

  // Фильтры: дорогое содержание попадает в цепочки
  let fl = newCity(1);
  fl.budget = 500;
  fl = cityProject(fl, "filters");
  assert.ok(getProject("filters").upkeep > action("bus").upkeep, "upkeep is the most expensive of the small builds");
  fl = run(fl, getProject("filters").days);
  assert.ok(lastChain(fl, "filters").text.includes("млн в день"), "upkeep recorded");

  // Рост: новые дома на угле только в районах с печами, и после газа тоже
  let gr = newCity(1);
  const stoveBase = dist(gr, "turksib").stoves, cleanBase = dist(gr, "almaly").stoves;
  gr = run(gr, 360);
  assert.ok(Math.abs(dist(gr, "turksib").stoves - stoveBase * (1 + SIM.growth.stoves)) < 1e-9, "stove homes grow");
  assert.equal(dist(gr, "almaly").stoves, cleanBase, "no new stoves where there are none");
  assert.ok(lastChain(gr, "growth").text.includes("за 1 год"), lastChain(gr, "growth").text);
  // прибавка от старта, а не от текущего: после газа новые дома весят столько же
  let gg = newCity(1);
  dist(gg, "turksib").stoves = 1;
  gg = run(gg, 360);
  assert.ok(Math.abs(dist(gg, "turksib").stoves - (1 + stoveBase * SIM.growth.stoves)) < 1e-9, "new homes don't shrink after gas");
  // Рост показывает свой вклад: даже если игрок убрал машин больше, чем добавил рост, строка не уходит в минус
  let fewer = newCity(1);
  for (const d of fewer.districts) d.traffic *= 0.5;
  fewer = run(fewer, 360);
  assert.ok(lastChain(fewer, "growth").text.includes("добавил 4% машин"), lastChain(fewer, "growth").text);
  assert.ok(lastChain(fewer, "growth").text.includes("2% домов"), lastChain(fewer, "growth").text);
  let fewer2 = fewer;
  for (let i = 0; i < 360; i++) { for (const d of fewer2.districts) d.mood = 70; fewer2 = tick(fewer2); }
  assert.ok(lastChain(fewer2, "growth").text.includes("за 2 года") && lastChain(fewer2, "growth").text.includes("добавил 8% машин"), lastChain(fewer2, "growth").text);
  // Повторное «Выслушать людей» — тоже цепочка, с настоящей ценой
  let li = newCity(1);
  li.budget = 500;
  li = act(li, "turksib", "listen");
  assert.equal(li.chains.length, 0, "the first time is just a meeting");
  li = act(li, "turksib", "listen");
  assert.ok(lastChain(li, "listen").text.includes("2-й раз") && lastChain(li, "listen").text.includes(`${actionCost(li, "turksib", "listen")} млрд`), lastChain(li, "listen").text);
  // Автобусы: запись появляется при первом росте после маршрута, одна на район
  let bu = newCity(1);
  bu = run(act(bu, "almaly", "bus"), 360);
  assert.equal(bu.chains.filter(c => c.actionId === "bus").length, 1);
  bu = run(bu, 360);
  assert.equal(bu.chains.filter(c => c.actionId === "bus").length, 1, "once per district");

  // Карточка показывает побочную причину заранее, и в ней нет имён людей и организаций
  for (const a of [...DISTRICT_ACTIONS, ...CITY_PROJECTS]) assert.ok(a.sideEffect.length > 10, a.id);
  assert.ok(action("coalban").sideEffect.includes(`${action("coalban").backfire.days[0]}–${action("coalban").backfire.days[1]}`), "numbers in text match the data");
  assert.ok(getProject("tec2gas").sideEffect.includes("согласование с республикой"));
}

// --- русские числа ---
{
  const table = { 0: "0 дней", 1: "1 день", 2: "2 дня", 4: "4 дня", 5: "5 дней", 11: "11 дней", 12: "12 дней", 14: "14 дней", 21: "21 день", 22: "22 дня", 34: "34 дня", 45: "45 дней", 101: "101 день", 111: "111 дней", 112: "112 дней" };
  for (const [n, want] of Object.entries(table)) assert.equal(daysWord(Number(n)), want);
}

// --- итог партии: не упрекать деньгами за то, что ещё не открылось ---
{
  realTree();
  const at = (day, budget) => ({ ...newCity(1), day, budget });
  // ТЭЦ-2 закрыта, пока не готовы фильтры: упрекнуть можно только фильтрами
  assert.equal(gameSummary(at(100, 0)).unaffordable.id, "filters", "filters are open from the start, ТЭЦ-2 is not");
  assert.equal(gameSummary({ ...at(400, 0), cityDone: ["filters"] }).unaffordable.id, "tec2gas", "after filters ТЭЦ-2 is open");
  assert.equal(gameSummary({ ...at(800, 0), granted: ["tec2gas"] }).unaffordable.id, "tec2gas", "or granted by the year-3 decree");
  assert.equal(gameSummary(at(800, 1e4)).unaffordable, null, "money was not the problem");
  openAll();
}

// --- итог партии: что игрок оставил нетронутым ---
{
  const winter = (s, n = 90) => {
    s.day = 270;
    for (let i = 0; i < n; i++) { for (const d of s.districts) d.mood = 70; s = tick(s); }
    return s;
  };
  assert.deepEqual(gameSummary(newCity(1)).untouched, [], "no winter yet, no shares to quote");
  // Партия только с «Выслушать людей»: итог всё равно рассказывает, что произошло
  let quiet = newCity(1);
  quiet.budget = 500;
  quiet = act(act(act(quiet, "turksib", "listen"), "turksib", "listen"), "alatau", "listen");
  quiet = winter(quiet);
  const u = gameSummary(quiet).untouched;
  assert.ok(u.length >= 1 && u.length <= SIM.untouchedMax, `1–3 entries: ${u.length}`);
  assert.equal(u[0].kind, "plant");
  assert.equal(u[0].id, "tec2", "ТЭЦ-2 is the biggest source");
  // Доля — настоящая, из выбросов этой партии: считаем сами по дням
  let check = newCity(1);
  check = winter(check);
  const total = Object.values(check.emitted).reduce((a, b) => a + b, 0);
  const tec2 = gameSummary(check).untouched.find(x => x.id === "tec2");
  assert.ok(Math.abs(tec2.share - check.emitted["plant:tec2"] / total) < 1e-12);
  assert.ok(tec2.share > 0.2 && tec2.share < 0.45, `plausible share ${tec2.share}`);
  assert.ok(tec2.text.includes(`${Math.round(tec2.share * 100)}%`) && tec2.text.includes("ТЭЦ-2") && tec2.text.includes("не подступились"), tec2.text);
  assert.deepEqual(u.map(x => x.share), [...u.map(x => x.share)].sort((a, b) => b - a), "biggest first");
  assert.ok(u.every(x => x.share >= SIM.untouchedMinShare), "no trivial sources");
  assert.ok(gameSummary(quiet).chains.some(c => c.actionId === "listen"), "the listening itself is in the story");
  const stove = u.find(x => x.kind === "stoves");
  assert.ok(stove && stove.text.startsWith("Печи,") && stove.text.includes("ничего не сделано"), JSON.stringify(u));
  // Только когда правда: тронул — исчезло из списка
  const touched = setup => {
    let s = newCity(1);
    s.budget = 5000;
    s = setup(s);
    return gameSummary(winter(s)).untouched;
  };
  assert.ok(!touched(s => cityProject(s, "filters")).some(x => x.id === "tec2"), "filters count as acting on ТЭЦ-2");
  assert.ok(!touched(s => cityProject(s, "tec2gas")).some(x => x.id === "tec2"), "started ТЭЦ-2 counts, even unfinished");
  assert.ok(!touched(s => act(s, "turksib", "boiler")).some(x => x.kind === "stoves" && x.id === "turksib"), "a boiler counts");
  assert.ok(!touched(s => act(s, "turksib", "coalban")).some(x => x.kind === "stoves" && x.id === "turksib"), "a ban counts");
  assert.ok(touched(s => act(s, "almaly", "boiler")).some(x => x.kind === "stoves" && x.id === "turksib"), "acting elsewhere doesn't count");
  assert.ok(touched(s => act(s, "turksib", "listen")).some(x => x.kind === "stoves" && x.id === "turksib"), "listening is not acting on stoves");
  // Источник без рычага не упоминается, сколько бы ни дымил
  const onlyTec1 = newCity(1);
  for (const p of onlyTec1.plants) p.emission = p.id === "tec1" ? 1000 : 0;
  assert.ok(!gameSummary(winter(onlyTec1)).untouched.some(x => x.id === "tec1"), "ТЭЦ-1 has no lever");
  // Упрекают только открытым рычагом. В пути мер у каждого источника рычаг открыт с начала
  // (фильтры, котельная, автобус), поэтому закрытый рычаг проверяем, убрав фильтры из открытых.
  realTree();
  const early = newCity(1);
  early.emitted = { "plant:tec2": 90, "stoves:turksib": 10, "traffic:almaly": 1 };
  const list0 = gameSummary(early).untouched;
  assert.ok(list0.some(x => x.id === "tec2"), "filters are open from the start");
  assert.ok(list0.some(x => x.kind === "stoves"), "a boiler is open from the start");
  assert.ok(!list0.some(x => x.kind === "traffic"), "a 1% source is not worth a line");
  getProject("filters").requires = [{ action: "boiler", where: "any" }];
  assert.ok(!gameSummary(early).untouched.some(x => x.id === "tec2"), "every ТЭЦ-2 lever locked: no reproach");
  delete getProject("filters").requires;
  openAll();
  // Неизменяемость: зимний тик копит выбросы только в новом состоянии
  const w = newCity(1);
  w.day = 300;
  const wSnap = structuredClone(w);
  const w2 = tick(w);
  assert.ok(Object.keys(w2.emitted).length > 0, "winter tick tallies");
  assert.deepEqual(tick(newCity(1)).emitted, {}, "only winter counts");
  assert.deepEqual(w, wSnap, "emitted must not be mutated");
}

// --- итог партии для финала ---
{
  const empty = gameSummary(newCity(1));
  assert.deepEqual(empty.chains, []);
  assert.deepEqual(empty.unfinished, []);
  assert.equal(empty.unaffordable.id, "tec2gas", "the most expensive project out of reach");
  assert.equal(empty.unaffordable.shortfall, Math.ceil(getProject("tec2gas").cost - SIM.creditLimit - SIM.startBudget));
  assert.equal(empty.yearDaysLeft, 360);

  let s = newCity(1);
  s.budget = 5000;
  assert.equal(gameSummary(s).unaffordable, null, "money is not what stopped you");
  s = cityProject(cityProject(act(s, "turksib", "gas"), "tec2gas"), "metro");
  s = act(act(act(s, "alatau", "coalban"), "turksib", "coalban"), "almaly", "parking");
  s = act(s, "auezov", "bus");
  for (let i = 0; i < 400; i++) {
    for (const d of s.districts) d.mood = 70;
    s = tick(s);
  }
  const snap = structuredClone(s);
  const sum = gameSummary(s);
  assert.deepEqual(s, snap, "gameSummary is pure");
  assert.ok(sum.chains.length >= 3 && sum.chains.length <= 5, `3–5 chains: ${sum.chains.length}`);
  const ids = sum.chains.map(c => c.actionId);
  assert.equal(new Set(ids).size, ids.length, "one per action");
  for (const c of sum.chains) {
    assert.ok(Number.isInteger(c.day) && c.actionId && c.text, "structured");
    assert.ok(!("weight" in c), "internal weight is not exposed");
  }
  assert.deepEqual(sum.chains.map(c => c.day), [...sum.chains].map(c => c.day).sort((a, b) => a - b), "in order of days");
  assert.ok(s.chains.length > sum.chains.length, "the summary dedupes the full record");
  // два запрета: в итог попал более заметный (в Турксибском печей больше, чем в Алатауском)
  const bans = s.chains.filter(c => c.actionId === "coalban");
  assert.equal(bans.length, 2);
  const heavier = [...bans].sort((x, y) => y.weight - x.weight)[0];
  assert.equal(sum.chains.find(c => c.actionId === "coalban").district, heavier.district, "the heavier of the two");
  assert.notEqual(bans[0].weight, bans[1].weight);
  // недостроенное: ТЭЦ-2 ещё идёт, сверху то, что дольше всего
  const tec = sum.unfinished.find(u => u.id === "tec2gas");
  assert.ok(tec, "TEC-2 is unfinished after 400 days");
  assert.equal(tec.days, getProject("tec2gas").days);
  assert.ok(tec.left > 0 && tec.left <= tec.days);
  assert.equal(tec.waiting, s.building.find(b => b.id === "tec2gas").approval ?? 0);
  assert.ok(!sum.unfinished.some(u => u.id === "gas"), "finished builds are not listed");
  assert.ok(!sum.unfinished.some(u => u.id === "metro"), "the metro finished in 360 days");
  // district сохраняется у стройки района
  let d = newCity(1);
  d.budget = 500;
  d = act(d, "turksib", "gas");
  assert.deepEqual(gameSummary(d).unfinished, [{ id: "gas", name: "Замена котлов на газ", kind: "district", days: 150, left: 150, waiting: 0, district: "turksib" }]);
  // рост копится: в итоге последняя, самая полная запись
  let g = newCity(1);
  for (let i = 0; i < 720; i++) { for (const x of g.districts) x.mood = 70; g = tick(g); }
  const grown = gameSummary(g).chains.find(c => c.actionId === "growth");
  assert.ok(grown.text.includes("за 2 года"), grown.text);
}

// --- годовой отчёт президенту ---
{
  const yearEnd = setup => {
    const x = newCity(1);
    x.day = 359;
    for (const d of x.districts) { d.mood = 70; d.smog = 0; }
    x.wind = "n";
    setup?.(x);
    return x;
  };
  let s = rawTick(yearEnd());
  const r = s.pendingReport;
  assert.ok(r, "report at the end of the year");
  assert.equal(r.year, 1);
  assert.equal(r.decree.title, SIM.decree.years[0].title);
  assert.equal(r.winterAqi, s.lastWinterAqi);
  assert.equal(r.winterPm25, s.lastWinterPm25);
  assert.equal(r.airChange, airChange(s));
  assert.equal(r.trust, rating(s));
  assert.equal(r.budget, s.budget);
  assert.equal(typeof r.remark, "string");
  assert.deepEqual(s.lastReport, r);
  assert.throws(() => rawTick({ ...s, pendingDecree: null }), /report pending/, "time stops until acknowledged");
  const frozen = structuredClone(s);
  const a = ackReport(s);
  assert.deepEqual(s, frozen, "ackReport must not mutate");
  assert.equal(a.pendingReport, null);
  assert.deepEqual(a.lastReport, r, "the last report stays readable");
  assert.equal(rawTick(acceptDecree(a)).day, 361, "time goes on after the new decree");
  assert.throws(() => ackReport(a), "nothing to acknowledge");
  assert.equal(rawTick(newCity(1)).pendingReport, null, "no report mid-year");
  // Уйти в отставку — только из годового отчёта
  assert.throws(() => retire(newCity(1)), "no retiring mid-year");
  const gone = retire(s);
  assert.equal(gone.ended, "retired");
  assert.equal(gone.phase, "ended");
  assert.equal(gone.pendingReport, null);
  assert.equal(gone.pendingDecree, null);
  assert.deepEqual(s, frozen, "retire must not mutate");
  // Событие ждёт отчёта
  const both = yearEnd(x => { x.nextEventDay = 360; });
  const b = rawTick(both);
  assert.ok(b.pendingReport && !b.pendingEvent, "report first");
  assert.ok(rawTick(acceptDecree(ackReport(b))).pendingEvent, "the event comes after");
  // Реплика — по тому, что случилось, и из списка своей причины
  const remarkOf = setup => rawTick(yearEnd(setup)).pendingReport.remark;
  const inList = (text, key) => SIM.remarks[key].includes(text);
  assert.ok(inList(remarkOf(x => { x.budget = -SIM.decree.reward.budget - 60; }), "debt"), "debt");
  assert.ok(inList(remarkOf(x => { for (const d of x.districts) d.mood = 27; }), "people"), "low trust");
  assert.ok(inList(remarkOf(x => { x.districts[0].mood = 10; x.districts[0].striking = true; }), "strike"), "strike");
  assert.ok(inList(remarkOf(x => { Object.assign(x, { winterPmSum: 0, winterDays: 89 }); }), "air-good"), "good year");
  assert.ok(inList(remarkOf(x => { x.building.push({ kind: "city", id: "tec2gas", left: 100, days: 450 }); Object.assign(x, { winterPmSum: SIM.baselineWinterPm25 * 90, winterDays: 89 }); }), "tec2"), "TEC-2 under way");
  assert.ok(inList(remarkOf(x => { Object.assign(x, { winterPmSum: SIM.baselineWinterPm25 * 90, winterDays: 89 }); }), "steady"), "decree done, air the same");
  // Варианты меняются от года к году, и в них нет имён: только должность
  for (const list of Object.values(SIM.remarks)) {
    assert.ok(list.length >= 2 && new Set(list).size === list.length, "varied remarks");
    for (const t of list) assert.ok(t.length <= 80, `short: ${t}`);
  }
}

// --- бездействие: снятие через полгода ---
{
  const start = () => ({ ...startCity(1), pendingDecree: null, nextEventDay: Infinity, banEventDone: true, budget: 2000 });
  const to = (s, day) => { while (s.day < day && !s.ended) { for (const d of s.districts) d.mood = 70; s = rawTick(s); } return s; };
  const deadline = SIM.idle.deadlineDay;
  assert.equal(deadline, 180);
  assert.deepEqual(idleStatus(start()), { needed: 1, done: 0, deadlineDay: 180 });
  // Ни одной меры: день 179 ещё идёт, в день 180 снятие сразу, без предупреждения и без окна отчёта
  let s = to(start(), deadline - 1);
  assert.equal(s.ended, null);
  assert.ok(idleStatus(s));
  s = to(s, deadline);
  assert.equal(s.ended, "idle");
  assert.equal(s.day, deadline);
  assert.equal(s.phase, "ended");
  assert.equal(s.pendingReport, null);
  assert.equal(s.log.filter(e => e.kind === "warning").length, 0, "no warning first");
  assert.equal(endingText(s), "Вас назначили решить вопрос воздуха, а вы за полгода ничего не сделали. Президент освобождает вас от должности");
  assert.throws(() => rawTick(s));
  // Одна мера, начатая на день 179 и ещё не готовая, спасает
  let last = to(start(), deadline - 1);
  last = act(last, "almaly", "boiler");
  assert.equal(idleStatus(last), null, "satisfied");
  last = to(last, deadline + 1);
  assert.equal(last.ended, null, "a measure started on day 179 survives");
  assert.equal(last.building.length, 1, "still under construction");
  // Городской проект — тоже мера
  assert.equal(idleStatus(cityProject(start(), "filters")), null);
  // «Выслушать» сколько угодно раз не считается
  let talk = start();
  for (let i = 0; i < 8; i++) talk = act(talk, "almaly", "listen");
  assert.equal(idleStatus(talk).done, 0, "listening doesn't count");
  assert.equal(to(talk, deadline).ended, "idle");
  // Ответы на события не считаются, даже хорошие для воздуха
  let ev = { ...start(), pendingEvent: { cardId: "metro-opened" } };
  ev = resolveEvent(ev, 0);
  assert.equal(idleStatus(ev).done, 0, "event choices don't count");
  ev.nextEventDay = Infinity; // ответ назначил следующее событие, здесь оно не нужно
  assert.equal(to(ev, deadline).ended, "idle");
  // Счётчик не меняет вход
  const frozen = start();
  const snap = structuredClone(frozen);
  act(frozen, "almaly", "park");
  assert.deepEqual(frozen, snap, "airMeasures must not be mutated");
  // Только начало партии: дальше правило молчит, копить на ТЭЦ-2 можно
  let saver = { ...start(), airMeasures: 0, day: deadline + 1 };
  assert.equal(idleStatus(saver), null, "past the deadline");
  while (saver.day < 400) { for (const d of saver.districts) d.mood = 70; saver = tick(saver); }
  assert.equal(saver.ended, null, "saving up later is legitimate");
}

// --- концовки и ни слова о выборах акима ---
{
  const end = ended => endingText({ ended });
  assert.equal(end("critical"), "Воздух в критическом состоянии. Президент освобождает вас от должности");
  assert.ok(end("fired").includes("Президент") && end("fired").includes("горожан"));
  assert.equal(endingText({ ended: "decree", decreeFail: { text: "Указ не выполнен: x" } }), "Указ не выполнен: x. Президент освобождает вас от должности");
  assert.ok(end("retired").includes("отставку"));
  assert.equal(end(null), null);
  assert.ok(SIM.introText.includes("Президент назначает"));
  const code = ["src/sim.js", "src/data/sim-balance.js", "src/data/actions.js"].map(f => readFileSync(new URL(`../${f}`, import.meta.url), "utf8")).join("\n");
  assert.ok(!/election|lost-|выбор(ы|ов|ах)|[зЗ]а вас/.test(code), "no elections left in the sim");
  // Единственные выборы в карточках — в маслихат
  const voted = CARDS.filter(c => /выбор(ы|ов|ах)/i.test(c.text));
  assert.deepEqual(voted.map(c => c.id), ["maslikhat"]);
  assert.ok(!CARDS.some(c => /так и не подвели|газ дороже/i.test(c.text)), "cards that contradict the facts are rewritten");
  assert.deepEqual(Object.keys(date(newCity(1))).sort(), ["dayOfSeason", "dayOfYear", "gameYear", "season", "yearDaysLeft"]);
  assert.ok(!/reviewCheck|continueWork|yearGoal|winterFails|ended, "smog"|failed-review/.test(readFileSync(new URL("../src/sim.js", import.meta.url), "utf8")), "goals, the 4-year review and the smog ending are gone");
}

// --- субсидия на газ ---
{
  const sub = action("gas-subsidy");
  let s = newCity(1);
  s.budget = 500;
  const stoves = dist(s, "turksib").stoves, mood = dist(s, "turksib").mood, up = s.upkeep;
  s = act(s, "turksib", "gas-subsidy");
  assert.ok(Math.abs(dist(s, "turksib").stoves - stoves * sub.effect.stoves) < 1e-9, "stoves fall");
  assert.equal(dist(s, "turksib").mood, mood + sub.effect.mood, "mood rises");
  assert.ok(sub.upkeep > action("boiler").upkeep && sub.upkeep > action("park").upkeep, "heavy daily cost: more than a boiler or a park");
  assert.ok(Math.abs(s.upkeep - up - sub.upkeep) < 1e-12);
  assert.equal(actStatus(s, "turksib", "gas-subsidy").reason, REASONS.done);
  const frozen = structuredClone(s);
  const c = cancelSubsidy(s, "turksib");
  assert.deepEqual(s, frozen, "cancelSubsidy must not mutate");
  assert.ok(Math.abs(dist(c, "turksib").stoves - stoves) < 1e-9, "cancelling brings the stoves back");
  assert.ok(Math.abs(c.upkeep - up) < 1e-12, "and stops the cost");
  assert.equal(dist(c, "turksib").mood, dist(s, "turksib").mood + sub.cancelMood, "and hurts");
  assert.ok(!dist(c, "turksib").done.includes("gas-subsidy"));
  assert.ok(c.chains.at(-1).actionId === "gas-subsidy" && c.chains.at(-1).text.includes("отменили"));
  assert.ok(canAct(c, "turksib", "gas-subsidy"), "can be started again");
  assert.throws(() => cancelSubsidy(c, "turksib"), "nothing to cancel");
  assert.throws(() => cancelSubsidy({ ...s, phase: "review" }, "turksib"), "not during a review");
}

// --- цена газа: без субсидии часть домов возвращается на уголь ---
{
  const yearAfterGas = subsidised => {
    let s = newCity(3);
    s.budget = 2000;
    s = act(s, "turksib", "gas");
    if (subsidised) s = act(s, "turksib", "gas-subsidy");
    s = run(s, action("gas").days + action("gas").effect.ramp + 1);
    assert.ok(dist(s, "turksib").gasCut > 0, "gas removed some stoves");
    return s;
  };
  let s = yearAfterGas(false);
  const cut = dist(s, "turksib").gasCut, before = dist(s, "turksib").stoves;
  const added = dist(s, "turksib").stoves * 0 + DISTRICTS_STOVES.turksib * SIM.growth.stoves;
  s = run(s, 360 - s.day);
  const back = cut * SIM.gasPrice.backslide;
  assert.ok(Math.abs(dist(s, "turksib").stoves - (before + back + added)) < 1e-9, "stoves return by the backslide share");
  assert.ok(Math.abs(dist(s, "turksib").gasCut - (cut - back)) < 1e-9, "fewer left to return");
  const c = s.chains.find(x => x.actionId === "gas-price" && x.district === "turksib");
  assert.ok(c && c.text.includes("подорожал на 8%") && c.text.includes("вернулись на уголь"), c?.text);
  // С субсидией не возвращаются, в районе без котлов возвращаться некому
  let t = yearAfterGas(true);
  const tc = dist(t, "turksib").gasCut;
  t = run(t, 360 - t.day);
  assert.equal(dist(t, "turksib").gasCut, tc, "the subsidy holds them");
  assert.ok(!t.chains.some(x => x.actionId === "gas-price"), "no chain with the subsidy");
  assert.ok(!run(newCity(1), 360).chains.some(x => x.actionId === "gas-price"), "nobody switched, nobody returns");
}

// --- разовое событие о запрете твёрдого топлива ---
{
  const c = getCard(SIM.banEventCard);
  assert.ok(c.text.includes("10 МРП") && c.text.includes("доступ к газу"), "only confirmed facts");
  assert.ok(!cardEligible({ ...newCity(1), day: 300 }, c), "not in the deck");
  let s = startCity(5);
  s.nextEventDay = Infinity;
  s.airMeasures = SIM.idle.needed;
  while (s.day < SIM.banEventDay - 1) s = tick(s);
  assert.equal(s.pendingEvent, null, "not before its day");
  s = tick(s);
  assert.equal(season(s), "winter", "first winter");
  assert.deepEqual(s.pendingEvent, { cardId: c.id });
  const hard = resolveEvent(s, 0), soft = resolveEvent(s, 1);
  assert.equal(c.options[0].label, "Строго штрафовать");
  assert.ok(dist(hard, "turksib").stoves < dist(soft, "turksib").stoves, "strict enforcement cuts more stoves");
  assert.ok(dist(hard, "turksib").mood < dist(soft, "turksib").mood, "and costs more trust");
  assert.equal(airHint(c.options[0]), "better");
  assert.equal(airHint(c.options[1]), "worse");
  assert.ok(hard.chains.at(-1).text.includes("Строго штрафовать"));
  hard.nextEventDay = Infinity;
  let later = hard;
  for (let i = 0; i < 400; i++) { for (const d of later.districts) d.mood = 70; later = tick(later); assert.equal(later.pendingEvent, null, "once only"); }
}

// --- каждое решение влияет на воздух: подсказка и плохие решения подряд ---
{
  assert.equal(airHint({ effects: { traffic: -1, rating: 5 } }), "better");
  assert.equal(airHint({ effects: { stoves: 2, budget: 5 } }), "worse");
  assert.equal(airHint(action("listen")), "worse", "a concession loosens enforcement");
  assert.equal(airHint(action("gas")), "better");
  assert.equal(airHint(getProject("tec2gas")), "better");
  // Выслушать людей: часть печей возвращается
  let l = newCity(1);
  l.budget = 100;
  const st = dist(l, "turksib").stoves;
  l = act(l, "turksib", "listen");
  assert.ok(Math.abs(dist(l, "turksib").stoves - st * action("listen").effect.stoves) < 1e-9);
  assert.ok(dist(l, "turksib").stoves > st);
  // Плохие решения подряд бьют сильнее, хорошее сбрасывает счёт
  const from = SIM.eventStreakFrom;
  const one = eventEffects({ traffic: 2 }), late = eventEffects({ traffic: 2 }, from), later = eventEffects({ traffic: 2 }, from + 1);
  assert.equal(one.traffic, late.traffic, "ordinary play is untouched");
  assert.ok(later.traffic > one.traffic);
  assert.equal(eventEffects({ traffic: -2 }, 50).traffic, eventEffects({ traffic: -2 }).traffic, "a good choice isn't scaled");
  assert.ok(eventEffects({ traffic: 2 }, 500).traffic <= 1 + 2 * SIM.eventStreakMax / SIM.eventBase.traffic + 1e-12, "capped");
  let x = newCity(1);
  const asPending = (y, id) => ({ ...y, pendingEvent: { cardId: id } });
  x = resolveEvent(asPending(x, "taxi-ban"), 1);
  assert.equal(x.airStreak, 1, "worse");
  x = resolveEvent(asPending(x, "car-free-day"), 1);
  assert.equal(x.airStreak, 2, "worse again");
  x = resolveEvent(asPending(x, "car-free-day"), 0);
  assert.equal(x.airStreak, 0, "a better choice resets it");
}

// --- критическое состояние воздуха ---
{
  SIM.critical.threshold = CRITICAL_THRESHOLD;
  const c = SIM.critical;
  const state = (avg, day = 700) => {
    const s = newCity(1);
    s.day = day;
    s.aqiDays = new Array(c.windowDays).fill(avg);
    for (const d of s.districts) { d.mood = 70; d.smog = 0; d.stoves = 0; d.traffic = 0; }
    for (const p of s.plants) p.mult = 0;
    s.wind = "n";
    return s;
  };
  const hot = c.threshold + 40;
  // Каждый день шкала пересчитывается: держим среднее вручную, сегодняшний день чистый
  const hold = (s, avg) => { s.aqiDays = new Array(c.windowDays).fill(avg * c.windowDays / (c.windowDays - 1)); return tick(s); };
  assert.deepEqual(airStatus(state(100)), { level: "ok", avg30: 100, threshold: c.threshold });
  assert.equal(airStatus(state(c.threshold - 1)).level, "high", "close to the line");
  assert.equal(airStatus(state(c.threshold - c.highBelow - 1)).level, "ok");
  // Тревога: warning один раз, отсчёт виден
  let s = hold(state(hot), hot);
  assert.equal(s.criticalDays, c.days);
  assert.equal(s.log.filter(e => e.kind === "warning").length, 1);
  assert.equal(s.log.at(-1).kind === "warning" || s.log.some(e => e.text === SIM.criticalAlarm(c.days)), true);
  assert.deepEqual(airStatus(s), { level: "critical", avg30: airStatus(s).avg30, threshold: c.threshold, countdown: c.days });
  s = hold(s, hot);
  assert.equal(s.criticalDays, c.days - 1, "counting down");
  assert.equal(s.log.filter(e => e.kind === "warning").length, 1, "one alarm per episode");
  // Между порогом и порогом минус clearBelow отсчёт идёт
  const left = s.criticalDays;
  s = hold(s, c.threshold - c.clearBelow + 1);
  assert.equal(s.criticalDays, left - 1, "not over yet");
  // Опустили — эпизод окончен, новая тревога возможна
  s = hold(s, c.threshold - c.clearBelow - 1);
  assert.equal(s.criticalDays, null);
  assert.equal(s.log.at(-1).kind === "air" || s.log.some(e => e.kind === "air"), true);
  s = hold(s, hot);
  assert.equal(s.criticalDays, c.days, "a new episode");
  assert.equal(s.log.filter(e => e.kind === "warning").length, 2);
  // Отсчёт кончился — концовка; ТЭЦ-2 не спасает
  let f = state(hot);
  f.building = [{ kind: "city", id: "tec2gas", left: 400, days: 450 }];
  for (let i = 0; i <= c.days && !f.ended; i++) f = hold(f, hot);
  assert.equal(f.ended, "critical", "no grace for TEC-2");
  assert.equal(f.phase, "ended");
  assert.throws(() => tick(f));
  assert.equal(endingText(f), SIM.endingText.critical);
  // Не в первый год и не по зиме первого года в начале второго
  assert.equal(hold(state(hot, 300), hot).criticalDays, null, "year 1: no alarm");
  assert.equal(hold(state(hot, 361), hot).criticalDays, null, "the window still covers year 1");
  assert.equal(hold(state(hot, 360 + c.windowDays), hot).criticalDays, c.days, "from year 2");
  // Неполное окно не тревожит и шкала не падает
  const fresh = newCity(1);
  assert.equal(typeof airStatus(fresh).avg30, "number");
  const snap = structuredClone(state(hot));
  const input = state(hot);
  tick(input);
  assert.deepEqual(input, snap, "aqiDays must not be mutated");
  SIM.critical.threshold = Infinity;
}


// --- доверие на грани ---
{
  SIM.trust.fatigue = FATIGUE;
  const T = SIM.trust;
  const clean = s => { for (const d of s.districts) Object.assign(d, { smog: 0, stoves: 0, traffic: 0 }); for (const p of s.plants) p.mult = 0; s.wind = "n"; return s; };
  // Старт в кризис: ниже середины, сам по себе почти не растёт
  assert.equal(rating(startCity(1)), SIM.moodStart);
  assert.ok(SIM.moodStart <= 50 && SIM.moodCeiling <= 55);
  // Бонус стройки выветривается
  let s = clean(newCity(1));
  for (const d of s.districts) d.mood = 30;
  s.budget = 500;
  s = run(act(s, "almaly", "bus"), action("bus").days);
  const fade0 = dist(s, "almaly").fade;
  assert.ok(fade0 > 0, "the bonus is temporary");
  s = run(s, T.fadeDays);
  assert.ok(dist(s, "almaly").fade < fade0 / 2, "and mostly gone after fadeDays");
  // Минус не выветривается
  let p = clean(newCity(1));
  for (const d of p.districts) d.mood = 30;
  p = act(p, "almaly", "parking");
  assert.equal(dist(p, "almaly").fade, 0);
  // Усталость: с каждым годом сильнее
  const tired = y => { const x = clean({ ...newCity(1), day: (y - 1) * 360 + 10 }); for (const d of x.districts) d.mood = 30; return 30 - rating(tick(x)); };
  assert.ok(tired(4) > tired(2), "fatigue grows with the year");
  // Зимой смог бьёт сильнее
  const smogHit = day => { const x = { ...newCity(1), day }; x.wind = "n"; for (const d of x.districts) { d.mood = 40; d.smog = 300; } return 40 - dist(tick(x), "alatau").mood; };
  assert.ok(smogHit(300) > smogHit(100), "winter smog hurts more");
  // Долгая забастовка расползается к соседям
  let st = clean(newCity(1));
  for (const d of st.districts) d.mood = SIM.moodCeiling; // на потолке чистый воздух не добавляет
  dist(st, "turksib").mood = 5;
  dist(st, "turksib").strikeDays = T.strikeSpreadAfter;
  st = tick(st);
  assert.ok(dist(st, "zhetysu").mood < SIM.moodCeiling && dist(st, "medeu").mood < SIM.moodCeiling, "neighbours lose patience");
  assert.ok(dist(st, "almaly").mood > dist(st, "zhetysu").mood, "not the neighbours: only fatigue");
  assert.ok(trustDrains(st).some(d => d.key === "strike"));
  // Плохой прогноз — минус всем
  realDecrees();
  let bad = null;
  for (let seed = 1; seed <= 40 && !bad; seed++) {
    let x = { ...startCity(seed), pendingDecree: null, nextEventDay: Infinity, banEventDone: true, airMeasures: 1, day: 239 };
    clean(x);
    for (const d of x.districts) d.mood = 40;
    const m0 = rating({ ...x, day: 240 });
    x = rawTick(x);
    if (x.winter === "low-snow") bad = { before: m0, after: rating(x) };
  }
  assert.ok(bad && bad.after < bad.before + T.badForecastMood + 0.5, "a bad forecast costs trust");
  calmDecrees();
  // Что съедает доверие: по убыванию, с понятными ключами
  const dr = trustDrains({ ...newCity(1), day: 300 });
  assert.ok(dr.length && dr.every((d, i) => i === 0 || dr[i - 1].perDay >= d.perDay));
  for (const d of dr) assert.ok(["smog", "fatigue", "fade", "works", "strike"].includes(d.key));
  SIM.trust.fatigue = 0;
}

// --- кредиты ---
{
  const L = SIM.loan;
  const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
  // деньги сразу, долг с процентами, запись в ленте
  const s0 = blank(1);
  assert.equal(s0.loans.length, 0);
  assert.ok(loanStatus(s0, 100).ok, "a fresh city can borrow 100");
  const s1 = takeLoan(s0, 100);
  assert.equal(s1.budget, s0.budget + 100, "money arrives immediately");
  assert.equal(s1.loans.length, 1);
  assert.ok(near(debtLeft(s1), 100 * (1 + L.rate)), "debt includes interest");
  assert.ok(near(s1.loans[0].perDay, 100 * (1 + L.rate) / L.days));
  assert.equal(s1.log.at(-1).kind, "loan");
  assert.equal(s1.log.at(-1).text, `Взят кредит 100 млрд: 0,64 млрд в день ${L.days} дней`);
  // платёж — часть дневного дохода, точно
  assert.ok(near(netIncome(s0) - netIncome(s1), s1.loans[0].perDay), "repayment is in net income");
  const s2 = tick(s1);
  assert.ok(near(s2.budget - tick(s0).budget, 100 - s1.loans[0].perDay), "one day later: the loan minus exactly one payment");
  assert.ok(near(s2.loans[0].left, s1.loans[0].left - s1.loans[0].perDay));
  // через days дней кредит закрыт, выплачено amount × (1 + rate)
  let s = s1, paid = 0;
  for (let i = 0; i < L.days; i++) { paid += loanPayment(s); s = tick(s); }
  assert.equal(s.loans.length, 0, `the loan is gone after ${L.days} days`);
  assert.ok(near(paid, 100 * (1 + L.rate)) && near(s.loanPaid, 100 * (1 + L.rate)), `total paid ${paid}`);
  assert.ok(s.log.some(e => e.kind === "loan" && e.text.startsWith("Кредит погашен")), "repaid loan is in the feed");
  assert.ok(near(loanPayment(s), 0) && near(debtLeft(s), 0));
  const day179 = run(s1, L.days - 1);
  assert.equal(day179.loans.length, 1, "still paying on the last day");
  // несколько кредитов сразу
  const two = takeLoan(takeLoan(s0, 50), 50);
  assert.equal(two.loans.length, 2);
  assert.ok(near(loanPayment(two), 2 * 50 * (1 + L.rate) / L.days));
  // лимит: долг с процентами не больше limitDays дней валового дохода
  const room = loanRoom(s0);
  assert.ok(room > 0 && room * (1 + L.rate) <= L.limitDays * grossIncome(s0) + 1e-9);
  const poor = blank(1);
  for (const d of poor.districts) d.mood = 15; // доход меньше: и лимит меньше
  assert.ok(loanRoom(poor) < room);
  const tooBig = L.amounts.find(a => a > loanRoom(poor));
  assert.ok(tooBig, "some offer is over the limit for a poor city");
  const no = loanStatus(poor, tooBig);
  assert.equal(no.ok, false);
  assert.equal(no.reason, REASONS.loanLimit(loanRoom(poor)));
  assert.match(no.reason, /^превышен лимит долга/);
  assert.throws(() => takeLoan(poor, tooBig), /cannot take loan/);
  // долг занимает лимит: брать снова и снова нельзя
  let greedy = s0;
  while (loanFor(greedy, 1) !== null) greedy = takeLoan(greedy, loanFor(greedy, 1));
  assert.ok(debtLeft(greedy) <= L.limitDays * grossIncome(greedy) + 1e-9, "outstanding debt stays within the limit");
  assert.ok(loanOptions(greedy).every(o => !o.ok && o.reason.startsWith("превышен лимит долга")));
  // в минусе брать можно, после конца — нет; сумм вне списка нет
  assert.ok(loanStatus({ ...s0, budget: -10 }, 50).ok, "a loan in the red is allowed within the limit");
  assert.deepEqual(loanStatus({ ...s0, ended: "fired", phase: "ended" }, 50), { ok: false, reason: REASONS.over });
  assert.equal(loanStatus(s0, 70).ok, false);
  // loanOptions и loanFor
  const opts = loanOptions(s0);
  assert.deepEqual(opts.map(o => o.amount), L.amounts);
  for (const o of opts) assert.ok(near(o.total, o.amount * (1 + L.rate)) && near(o.perDay, o.total / L.days));
  assert.equal(loanFor(s0, 30), 50, "the smallest loan that covers the shortfall");
  assert.equal(loanFor(s0, 51), 100);
  assert.equal(loanFor(s0, 1e6), null, "no loan covers a huge shortfall");
  // детерминизм и неизменяемость
  assert.deepEqual(run(takeLoan(newCity(7), 50), 60), run(takeLoan(newCity(7), 50), 60), "same seed, same loan → same state");
  const snap = structuredClone(s2);
  tick(s2);
  takeLoan(s2, 50);
  act({ ...s2 }, "alatau", "bus");
  assert.deepEqual(s2, snap, "loans must not be mutated by tick or takeLoan");
  // банкротство через платежи: без кредита город в плюсе, с кредитом и урезанным доходом — внешнее управление
  const broke = x => { x.mods = { income: 0.3 }; x.budget = 0; return x; };
  let free = broke(blank(2));
  for (let i = 0; i < 60 && !free.ended; i++) free = tick(free);
  assert.equal(free.ended, null, "no loan, positive income: no bankruptcy");
  let indebted = broke(takeLoan(blank(2), 100));
  assert.ok(netIncome(indebted) < 0, "repayment pushes the daily balance below zero");
  for (let i = 0; i < 60 && !indebted.ended; i++) indebted = tick(indebted);
  assert.equal(indebted.ended, "bankrupt", "repayments can bankrupt the city");
  assert.equal(indebted.day, SIM.debtDaysLimit, "the usual debt rule");
  // итог партии: занято и переплачено
  assert.equal(gameSummary(s0).loans, null);
  const sum = gameSummary(s);
  assert.equal(sum.loans.taken, 100);
  assert.ok(near(sum.loans.interest, 100 * L.rate) && near(sum.loans.left, 0));
  // отчёт президенту: большой долг — своя реплика
  const yearEnd = x => rawTick({ ...x, day: 359 });
  const withDebt = takeLoan(blank(1), 100);
  assert.ok(debtLeft(withDebt) > L.reportDays * grossIncome(withDebt), "a 100 loan is a lot of debt for a new city");
  assert.ok(SIM.remarks.loans.includes(yearEnd(withDebt).lastReport.remark), "the president notices the debt");
  assert.ok(!SIM.remarks.loans.includes(yearEnd(blank(1)).lastReport.remark));
  assert.ok(SIM.remarks.loans.length >= 2);
  console.log(`loans ok: room ${room} млрд on a fresh city, 100 → ${(100 * (1 + L.rate) / L.days).toFixed(2)} a day`);
}

// Прогноз зимы: дёшево и близко к настоящей обычной зиме (calmDecrees: погода обычная, указов и событий нет).
{
  const rich = seed => ({ ...newCity(seed), budget: 2000 });
  const builds = s => {
    for (const [d, id] of [["turksib", "boiler"], ["alatau", "boiler"], ["zhetysu", "boiler"], ["almaly", "bus"], ["zhetysu", "park"]]) s = act(s, d, id);
    return cityProject(s, "filters");
  };
  const errs = { none: [], builds: [], early: [] };
  for (let seed = 1; seed <= 20; seed++) {
    for (const mode of ["none", "builds"]) {
      let s = rich(seed);
      if (mode === "builds") {
        s = builds(s);
        s = run(s, 80);
        s = act(s, "turksib", "gas"); // разгон печей и случайная доля домов
      }
      const early = winterForecast(s, { includeBuilding: true }).aqi;
      s = run(s, 265 - s.day);
      const f = winterForecast(s).aqi;
      s = run(s, 360 - s.day);
      errs[mode].push(f / s.lastWinterAqi - 1);
      if (mode === "builds") errs.early.push(early / s.lastWinterAqi - 1);
    }
  }
  for (const [mode, e] of Object.entries(errs)) {
    const mean = e.reduce((a, b) => a + b) / e.length, worst = Math.max(...e.map(Math.abs));
    assert.ok(Math.abs(mean) < 0.02, `${mode}: forecast is unbiased (${(mean * 100).toFixed(1)}%)`);
    assert.ok(e.filter(x => Math.abs(x) <= 0.08).length >= 18, `${mode}: 90% of seeds within ±8%`);
    assert.ok(worst < 0.1, `${mode}: every seed within ±10% (${(worst * 100).toFixed(1)}%)`);
    console.log(`winter forecast ${mode}: mean error ${(mean * 100).toFixed(1)}%, worst ${(worst * 100).toFixed(1)}%`);
  }

  // Вклад мер: знак и порядок величин
  const s = rich(1);
  const frozen = structuredClone(s);
  const imp = id => measureImpact(s, "turksib", id);
  const city = id => measureImpact(s, null, id);
  assert.ok(city("tec2gas") < city("filters") && city("filters") < 0, "ТЭЦ-2 на газ — больше всех");
  for (const a of DISTRICT_ACTIONS) assert.ok(city("tec2gas") < imp(a.id), `tec2gas beats ${a.id}`);
  assert.ok(imp("park") < 0 && imp("park") > -2, "a park helps a little");
  assert.ok(imp("listen") >= 0, "listening does not clean the air");
  assert.ok(imp("gas") < imp("boiler") && imp("boiler") < 0, "gas cuts more than a boiler");
  assert.ok(city("metro") < 0);
  assert.equal(measureImpact(s, null, "nmu"), null, "НМУ is temporary: no winter impact");
  assert.equal(imp("gas"), measureImpact(rich(1), "turksib", "gas"), "deterministic");
  assert.equal(winterForecast(s).aqi, winterForecast(rich(1)).aqi, "deterministic");
  assert.deepEqual(s, frozen, "forecast and impact do not mutate");
  // готовая мера сдвигает прогноз примерно на свой вклад
  const done = run(act(s, "turksib", "boiler"), 76);
  assert.ok(Math.abs(winterForecast(done).aqi - winterForecast(s).aqi - imp("boiler")) < 0.3, "impact = forecast change after the build");

  // Быстро: UI зовёт прогноз каждый кадр, вклад — для каждой строки панели
  for (let i = 0; i < 200; i++) winterForecast(s);
  let t0 = performance.now();
  for (let i = 0; i < 1000; i++) winterForecast(s);
  const per = (performance.now() - t0) / 1000;
  t0 = performance.now();
  const fresh2 = { ...s };
  for (const a of DISTRICT_ACTIONS) measureImpact(fresh2, "turksib", a.id);
  const all = performance.now() - t0;
  assert.ok(per < 0.1, `winterForecast ${per.toFixed(3)} ms per call`);
  assert.ok(all < 5, `measureImpact for a district ${all.toFixed(2)} ms`);
  console.log(`forecast perf: ${per.toFixed(3)} ms per forecast, ${all.toFixed(2)} ms for all district actions; turksib: ${DISTRICT_ACTIONS.map(a => `${a.id} ${imp(a.id).toFixed(1)}`).join(", ")}; city: ${CITY_PROJECTS.map(p => `${p.id} ${city(p.id).toFixed(1)}`).join(", ")}`);
}

// --- автосохранение: снимок и обратно, тот же город и тот же rng ---
{
  // Полная партия: указы, события, отчёты, кредит и стройки — всё, что встречается в состоянии.
  const play = (s, days) => {
    for (let i = 0; i < days && s.phase === "play"; i++) {
      if (s.pendingDecree) s = acceptDecree(s);
      if (s.pendingForecast) s = ackForecast(s);
      if (s.pendingReport) s = ackReport(s);
      if (s.pendingEvent) s = resolveEvent(s, 0);
      s = rawTick(s);
    }
    return s;
  };
  let s = acceptDecree(startCity(20251105));
  s = play(s, 40);
  s = takeLoan(s, loanOptions(s).find(o => o.ok).amount);
  for (const id of ["boiler", "listen", "bus"]) if (canAct(s, "turksib", id)) s = act(s, "turksib", id);
  if (canProject(s, "filters")) s = cityProject(s, "filters");
  s = play(s, 250);
  assert.ok(s.loans.length + s.loanPaid > 0 && s.day > 100, "the game ran with a loan");
  assert.ok(s.districts.some(d => d.complainedDay === -Infinity), "state has -Infinity to keep");

  const json = serialize(s, { selected: "turksib", speed: 3 });
  const back = deserialize(json);
  assert.deepStrictEqual(back, s, "deserialize(serialize(s)) is the same state");
  assert.deepStrictEqual(readSave(json).ui, { selected: "turksib", speed: 3 });
  // дальше обе партии идут одинаково: rng и судьба сохранены
  const a = play(s, 200), b = play(back, 200);
  assert.deepStrictEqual(b, a, "restored game continues identically");
  console.log(`save size: ${(json.length / 1024).toFixed(1)} KB at day ${s.day}`);
  assert.ok(json.length < 200 * 1024, "save stays small");

  // специальные числа и undefined не теряются
  const odd = { ...s, nmuReadyDay: -0, extra: { a: undefined, b: [undefined, NaN, Infinity] } };
  assert.deepStrictEqual(deserialize(serialize(odd)), odd);
  // в состоянии нет Set, Map, функций и классов
  assert.throws(() => serialize({ ...s, x: new Set() }), /Set/);
  assert.throws(() => serialize({ ...s, x: () => 1 }), /function/);
  assert.throws(() => serialize({ ...s, x: decreeStatus(s) ?? new Map() }), /save:/);
  // чужая версия и мусор — ошибка; loadSave их молча удаляет
  assert.throws(() => deserialize(JSON.stringify({ v: 999, state: s })), /version/);
  assert.throws(() => deserialize("{"));
  assert.throws(() => deserialize(JSON.stringify({ v: SAVE_VERSION, state: { day: 1 } })), /not a game state/);
  const store = new Map([[SAVE_KEY, "{broken"]]);
  const mem = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
  assert.equal(loadSave(mem), null);
  assert.equal(store.has(SAVE_KEY), false, "corrupt save removed");
  storageSet(mem, json);
  assert.deepStrictEqual(loadSave(mem).state, s);
  // хранилище бросает (приватный режим, квота) — игра не падает
  const bad = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("quota"); }, removeItem() { throw new Error("denied"); } };
  assert.equal(loadSave(bad), null);
  assert.equal(storageSet(bad, json), false);
  assert.equal(loadSave(undefined), null);

  // режим старта страницы
  const mode = (o = {}) => restoreMode({ hasSave: true, ended: false, discarded: false, navType: "navigate", ...o });
  assert.equal(mode({ hasSave: false }), "fresh");
  assert.equal(mode({ hasSave: false, discarded: true, navType: "reload" }), "fresh");
  assert.equal(mode({ ended: true, discarded: true }), "fresh", "finished games are not restored");
  assert.equal(mode({ ended: true }), "fresh");
  assert.equal(mode(), "continue");
  assert.equal(mode({ navType: "back_forward" }), "continue");
  assert.equal(mode({ discarded: true }), "auto");
  assert.equal(mode({ navType: "reload" }), "auto");
}

console.log("sim ok");
