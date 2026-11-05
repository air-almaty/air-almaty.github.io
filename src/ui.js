// Интерфейс градостроителя: HUD, игровой цикл, панели района и города, окна указа, прогноза зимы, событий,
// отчётов президенту и финала.
// В innerHTML попадают только статичные строки и числа из данных и состояния; ввода игрока нет.
import {
  newCity, tick, act, cityProject, actStatus, projectStatus, progress, netIncome, date,
  districtAqi, districtPm25, cityAqi, cityPm25, rating, districtEmission,
  resolveEvent, retire, getCard, eventEffects, getAction, getProject, ackReport, cancelSubsidy,
  daysWord, actionCost, isPaused, districtStatus, airChange, airStatus, airHint, idleStatus, gameSummary, endingText, aqiFromPm25,
  decreeStatus, acceptDecree, ackForecast, startNmu, nmuStatus, synergyActive, windLinks, trustDrains, decreeTaskText, REASONS,
  takeLoan, loanOptions, loanFor, loanRoom, debtLeft, loanPayment, measureImpact,
} from "./sim.js";
import { createFx } from "./fx.js";
import { serialize, loadSave, restoreMode, storageSet, storageRemove } from "./save.js";
import { createOsmMap, updateOsmMap, resizeOsmMap, flashOsmDistrict, aqiColor, aqiBand, AQI_BANDS, OSM_ICONS } from "./osmmap.js";
import { presidentOffice, decreeSeal, flagStripe } from "./art.js";
import { icon, SEASON_ICON, WINTER_ICON, TASK_ICON, OBSTACLE_ICON, FEED_ICON } from "./icons.js";
import { track } from "./track.js";
import { DISTRICTS, PLANTS } from "./data/city.js";
import { DISTRICT_ACTIONS, CITY_PROJECTS } from "./data/actions.js";
import { SIM } from "./data/sim-balance.js";

const DAY_MS = 667; // x1: день за 2/3 с, год (360 дней) ≈ 4 минуты
const MAX_TICKS = 5; // не больше тиков за кадр
const WHO_PM25 = 5; // годовая норма ВОЗ, µg/m³
const SEASON_RU = { spring: "весна", summer: "лето", autumn: "осень", winter: "зима" };
const WIND = { n: ["↑", "на север"], s: ["↓", "к горам"], w: ["←", "на запад"], e: ["→", "на восток"], calm: ["•", "штиль"] };
// Почему район вышел на митинг: districtStatus(...).cause простыми словами
const CAUSE_RU = {
  roadworks: "дороги перекопаны под метро",
  coalban: "запретили уголь, а на газ денег нет",
  tariff: "газ оказался дороже угля",
  parking: "платная парковка и машины во дворах",
  smog: "дышать нечем",
  "plant-works": "работы на ТЭЦ идут, а воздух тот же",
  "last-winter": "помнят прошлую зиму",
  neglect: "район чувствует себя забытым",
};
// Что съедает доверие: trustDrains(...).key простыми словами
const DRAIN_RU = {
  smog: "смог", fatigue: "усталость от кризиса", fade: "радость от строек проходит", works: "стройки мешают жить", strike: "недовольство перекинулось от соседей",
};
const DIR_RU = { n: "на север", s: "к горам", w: "на запад", e: "на восток" };
const luck = type => (type ? (SIM.winters[type].disperse < 1 || SIM.winters[type].calm > 1 ? "bad" : SIM.winters[type].disperse > 1 ? "good" : "normal") : "normal");
// Где на карте стоит кран городского проекта: id ТЭЦ или района
const CITY_SITE = { tec2gas: "tec2", filters: "tec2", metro: "almaly" };
const $ = id => document.getElementById(id);
const panel = $("panel-body");
const aside = $("panel");
const sheetHandle = $("sheet-handle");
const tabs = $("tabs");
const feed = $("feed");
const overlay = $("overlay");
const dialog = $("dialog");
const page = [$("hud"), $("game")]; // на время окна недоступны и для мыши, и для клавиатуры
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

let state = newCity(Date.now() | 0);
let selected = "turksib"; // id района или "city"
let speed = 0;
let lastSpeed = 1;
let started = false;
let dlg = null; // открытое окно: "intro" | "decree" | "forecast" | "event" | "report" | "warning" | "loan" | "end" | null

// --- форматирование ---
const fmtMoney = v => `${v < 0 ? "−" : ""}${Math.abs(Math.round(v))}`;
const fmtCost = c => (c === 0 ? "бесплатно" : `${c} млрд`);
const fmtDays = d => (d === 0 ? "сразу" : `${d} дн.`);
const comma = v => String(v).replace(".", ",");
const num1 = v => comma(+v.toFixed(1)); // «0,6», «15», «7,5»
const num2 = v => comma(v.toFixed(2)); // «0,64»
// Игра идёт и ничего не ждёт игрока. Окна предупреждения и кредита ставят время на паузу.
const canPlay = () => started && state.phase === "play" && !state.pendingEvent && !state.pendingReport && !state.pendingDecree && !state.pendingForecast;
const playing = () => canPlay() && dlg !== "warning" && dlg !== "loan";
// Русское множественное: plural(5, "мера", "меры", "мер") → "мер".
const plural = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many);
const signed = v => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}`;
const pctDown = m => `↓${Math.round((1 - m) * 100)}%`;
const moodFx = m => `<span class="${m > 0 ? "good" : "bad"}">настроение ${m > 0 ? "↑" : "↓"}${Math.abs(m)}</span>`;
// Откуда доход: в игре нет налоговой ставки, только поступления от районов, зависящие от настроения.
const INCOME_NOTE = "Доход — поступления в бюджет от районов: чем ниже настроение района, тем меньше. Это условность игры.";
const upkeepFx = u => (u ? `<span class="upkeep">содержание −${Math.round(u * 1000)} млн/дн.</span>` : "");

// Куда сдвинется воздух, без чисел: главное на каждой карточке.
const airTag = item => (airHint(item) === "better" ? `<span class="air-tag better">воздух чище</span>` : `<span class="air-tag worse">воздух грязнее</span>`);

// Вклад меры в прогноз зимы (measureImpact) — на день: прогноз меняется за день мало, а считать его каждый кадр
// для каждой строки дорого. Ключ — день, район, мера и что уже построено и строится.
let impactMemo = { key: null, map: new Map() };
const builtSig = s => `${s.day}|${s.cityDone.join()}|${s.districts.map(d => d.done.join()).join(";")}|${s.building.map(b => `${b.kind}${b.district ?? ""}${b.id}`).join()}`;
function impactOf(districtId, actionId) {
  const key = builtSig(state);
  if (impactMemo.key !== key) impactMemo = { key, map: new Map() };
  const k = `${districtId ?? "city"}:${actionId}`;
  if (!impactMemo.map.has(k)) impactMemo.map.set(k, measureImpact(state, districtId, actionId));
  return impactMemo.map.get(k);
}
const IMPACT_TIP = "Прогноз AQI обычной зимы, если мера будет готова сейчас";
// Чип строки меры: «зима −6» / «зима −0,9» зелёным, «зима +2» красным, меньше 0,1 — «почти не влияет». Текст, а не только цвет.
// Районная мера двигает среднюю по городу зиму меньше чем на пункт — десятые нужны, иначе дешёвые меры выглядят бесполезными.
function impactTag(x) {
  if (x.done && !x.repeat) return ""; // уже действует: вклад сидит в прогнозе
  if (x.kind === "n") return `<span class="air-tag calm" title="Мера на ${x.lasts} дн.: на среднюю зиму не влияет, помогает в дни штиля">только в штиль</span>`;
  const v = x.impact;
  if (v === null || v === undefined) return `<span class="air-tag ${x.better ? "better" : "worse"}">воздух ${x.better ? "чище" : "грязнее"}</span>`;
  const r = Math.abs(v) < 10 ? Math.round(v * 10) / 10 : Math.round(v);
  if (r === 0) return `<span class="air-tag flat" title="${IMPACT_TIP}: меньше 0,1 пункта">почти не влияет</span>`;
  const txt = signed(r).replace(".", ",");
  return `<span class="air-tag ${r < 0 ? "better" : "worse"}" title="${IMPACT_TIP}: ${txt} AQI">зима ${txt}</span>`;
}

// Подробности меры (раскрытая строка): «воздух чище/грязнее» уже есть в самой строке.
function actionFx(a) {
  const e = a.effect, out = [];
  // adoption: перейдут не все дома, поэтому снижение — верхняя граница
  if (e.stoves > 1) out.push(`<span class="bad">печи ↑${Math.round((e.stoves - 1) * 100)}%</span>`);
  else if (e.stoves !== undefined) out.push(`<span class="good">печи ${a.adoption ? `↓ до ${Math.round((1 - e.stoves) * 100)}%` : pctDown(e.stoves)}${e.ramp ? ` за ${e.ramp} дн.` : ""}</span>`);
  if (e.traffic !== undefined) out.push(`<span class="good">машины ${pctDown(e.traffic)}</span>`);
  if (e.parkDaily !== undefined) out.push(`<span class="good">смог ${pctDown(e.parkDaily)} в день</span>`);
  if (e.mood) out.push(moodFx(e.mood));
  if (a.upkeep) out.push(upkeepFx(a.upkeep));
  return out.join(" ");
}

function projectFx(p) {
  const e = p.effect, out = [];
  for (const [id, m] of Object.entries(e.plants ?? {})) out.push(`<span class="good">${PLANTS.find(x => x.id === id).name} ${pctDown(m)}</span>`);
  if (e.traffic !== undefined) out.push(`<span class="good">машины ${pctDown(e.traffic)} в ${e.districts.length} районах</span>`);
  if (e.mood) out.push(moodFx(e.mood));
  if (p.upkeep) out.push(upkeepFx(p.upkeep));
  return out.join(" ");
}

// --- HUD ---
const hud = {
  date: $("h-date"), day: $("h-day"), seasonBar: $("h-season"), seasonIco: $("h-season-ico"),
  aqi: $("h-aqi"), aqiDot: $("h-aqi-dot"), air: $("h-air"),
  gauge: $("h-gauge"), avg: $("h-avg"), mark: $("h-mark"), gaugeMsg: $("h-gauge-msg"),
  money: $("h-money"), budget: $("h-budget"), income: $("h-income"),
  rating: $("h-rating"), ratingFill: $("h-rating-fill"), ratingBox: $("h-rating-box"), ratingNote: $("h-rating-note"),
  wind: $("h-wind"), windArrow: $("h-wind-arrow"),
  weather: $("h-weather"), weatherShort: $("h-weather-short"), weatherPop: $("h-weather-pop"), weatherIco: $("h-weather-ico"), idle: $("h-idle"), idleText: $("h-idle-text"),
  task: $("h-task"),
  decree: $("h-decree"), decreeTitle: $("h-decree-title"), decreeDays: $("h-decree-days"), decreeTasks: $("h-decree-tasks"),
};
const shown = new WeakMap();
function put(el, v) {
  if (!el || shown.get(el) === v) return;
  shown.set(el, v);
  el.textContent = v;
}
// Значок по имени из icons.js: перерисовывается, только когда имя меняется
function putIcon(el, name, size = 16) {
  if (!el || shown.get(el) === name) return;
  shown.set(el, name);
  el.innerHTML = icon(name, { size });
}

export function airLine(pm) {
  const k = pm / WHO_PM25;
  return `PM2.5 ${Math.round(pm)} µg/m³ · ${k > 1 ? `в ${comma(k.toFixed(1))} раз выше нормы ВОЗ` : "в пределах нормы ВОЗ"}`;
}

// Задача указа в HUD: текущее значение против цели, коротко. «AQI зимы: сейчас 128 / нужно < 120».
// До зимы — прогноз обычной зимы при нынешних мерах и, если стройки его меняют, после строек.
function taskLine(t) {
  if (t.kind === "winter") {
    if (t.value !== null) return `AQI зимы: сейчас ${Math.round(t.value)} / нужно < ${t.target}`;
    const now = Math.round(t.forecast), built = Math.round(t.forecastBuilding);
    return `Прогноз зимы при текущих мерах: ≈ ${now} / нужно < ${t.target}${built !== now ? ` · после строек ≈ ${built}` : ""}`;
  }
  if (t.kind === "stoves") return `Печей меньше: ${Math.round(t.value * 100)}% / нужно ${Math.round(t.target * 100)}%`;
  if (t.kind === "tec2") return t.state === "done" ? "ТЭЦ-2: перевод начат ✓" : `ТЭЦ-2: начать до осени, ${daysWord(t.daysLeft)}`;
  return t.value === null ? `Дней выше ${t.target}: ни одного, зима впереди` : `Худший день зимы: ${Math.round(t.value)} / черта ${t.target}`;
}

const FORECAST_TIP = "Обычная зима; малоснежная или штиль будет хуже, снежная — лучше";
// Состояние указа на одно состояние игры: прогноз зимы в нём считается лениво и запоминается, кадры его не пересчитывают.
const decreeMemo = new WeakMap();
function decreeNow() {
  if (!decreeMemo.has(state)) decreeMemo.set(state, decreeStatus(state));
  return decreeMemo.get(state);
}

function drawDecree() {
  const d = decreeNow();
  if (!d) return;
  put(hud.decreeTitle, `Указ · год ${d.year}`);
  put(hud.decreeDays, `до проверки ${daysWord(d.daysLeft)}`);
  const key = d.tasks.map(t => `${t.state}|${taskLine(t)}`).join("||");
  if (shown.get(hud.decreeTasks) !== key) {
    shown.set(hud.decreeTasks, key);
    hud.decreeTasks.replaceChildren(...d.tasks.map(t => {
      const sp = document.createElement("span");
      sp.dataset.state = t.state;
      sp.innerHTML = icon(TASK_ICON[t.kind], { size: 14 });
      sp.append(taskLine(t));
      sp.title = t.kind === "winter" && t.value === null ? `${taskLine(t)}. ${FORECAST_TIP}` : taskLine(t);
      return sp;
    }));
  }
  hud.decree.dataset.risk = d.risk;
}

// Прогноз зимы: до осени — когда будет, после — тип зимы на весь год.
// В HUD — значок и одно слово; полный текст — в подсказке и по нажатию (на телефоне подсказок нет).
function drawWeather() {
  const w = state.winter ? SIM.winters[state.winter] : null;
  const full = w ? `Зима: ${w.name}. ${w.text}` : "Прогноз на зиму — осенью. Снег вымывает смог, малоснежная зима грязнее";
  put(hud.weatherShort, w ? w.name : "прогноз осенью");
  put(hud.weatherPop, full);
  if (hud.weather.title !== full) { hud.weather.title = full; hud.weather.setAttribute("aria-label", full); }
  putIcon(hud.weatherIco, WINTER_ICON[state.winter] ?? "cloud-snow");
  hud.weather.dataset.luck = luck(state.winter);
}

// Шкала «Воздух»: средний AQI за 30 дней на полосах US AQI, черта — критическое состояние.
const GAUGE_MAX = 260;
const gaugePct = v => `${Math.min(100, Math.max(0, v / GAUGE_MAX * 100))}%`;

function initGauge() {
  let from = 0;
  const stops = AQI_BANDS.map(b => {
    const to = Math.min(b.max, GAUGE_MAX);
    const seg = `${b.color} ${gaugePct(from)} ${gaugePct(to)}`;
    from = to;
    return seg;
  });
  $("h-bar").style.background = `linear-gradient(90deg, ${stops.join(", ")})`;
  $("h-threshold").style.left = gaugePct(SIM.critical.threshold);
}

function gaugeMessage(a) {
  if (a.level === "critical") return `Критическое состояние: до отставки ${daysWord(a.countdown)}. Нужно ниже ${a.threshold - SIM.critical.clearBelow}`;
  const left = Math.ceil(a.threshold - a.avg30);
  if (left <= 0) return "первый год президент ждёт";
  return `до критической черты ${left}`;
}

function drawGauge() {
  const a = airStatus(state);
  put(hud.avg, Math.round(a.avg30));
  hud.mark.style.left = gaugePct(a.avg30);
  hud.gauge.dataset.level = a.level;
  put(hud.gaugeMsg, gaugeMessage(a));
  document.body.classList.toggle("critical", a.level === "critical");
}

function drawHud() {
  const d = date(state);
  put(hud.date, `Год ${d.gameYear} · ${SEASON_RU[d.season]}`);
  putIcon(hud.seasonIco, SEASON_ICON[d.season], 18);
  put(hud.day, `до конца года: ${d.yearDaysLeft} дн.`);
  hud.seasonBar.style.width = `${(d.dayOfSeason / SIM.DAYS_PER_SEASON) * 100}%`;
  const a = Math.round(cityAqi(state));
  put(hud.aqi, a);
  hud.aqiDot.style.background = aqiColor(a);
  drawGauge();
  put(hud.air, airLine(cityPm25(state)));
  put(hud.budget, fmtMoney(state.budget));
  const inc = netIncome(state);
  // Кредит: остаток долга рядом с доходом (доход уже за вычетом платежа). Красным, когда за день бюджет тает.
  const owe = debtLeft(state);
  const net = `${inc >= 0 ? "+" : "−"}${comma(Math.abs(inc).toFixed(1))}`;
  put(hud.income, state.debtDays ? `в минусе ${state.debtDays}/${SIM.debtDaysLimit} дн.${owe ? ` · долг ${Math.round(owe)}` : ""}`
    : owe ? `${net} · долг ${Math.round(owe)}` : `${net} в день`);
  hud.income.classList.toggle("neg", inc < 0);
  hud.money.classList.toggle("debt", state.budget < 0);
  const moneyTip = `Бюджет ${fmtMoney(state.budget)} млрд ₸, ${net} в день${owe ? `. Долг по кредитам ${num1(owe)} млрд, платёж −${num2(loanPayment(state))} в день` : ""}. ${INCOME_NOTE} Нажмите, чтобы взять кредит`;
  if (hud.money.title !== moneyTip) { hud.money.title = moneyTip; hud.money.setAttribute("aria-label", moneyTip); }
  const r = Math.round(rating(state));
  put(hud.rating, r);
  hud.ratingFill.style.width = `${r}%`;
  // Доверие на грани: в 10 от черты снятия — красным, и видно, что его съедает
  hud.ratingBox.classList.toggle("danger", r < SIM.firedRating + 10);
  hud.ratingBox.classList.toggle("warn", r < SIM.firedRating + 20);
  const drains = trustDrains(state).slice(0, 2).map(x => DRAIN_RU[x.key]);
  put(hud.ratingNote, r < SIM.firedRating + 10 ? `снимут ниже ${SIM.firedRating}` : "доверие горожан");
  const tip = `Доверие горожан. Ниже ${SIM.firedRating} — вас снимут.${drains.length ? ` Сейчас его съедает: ${drains.join(", ")}.` : ""} Поднимают «Выслушать людей» и чистый воздух.`;
  if (hud.ratingBox.title !== tip) hud.ratingBox.title = tip;
  const [arrow, word] = WIND[state.wind];
  put(hud.windArrow, arrow);
  put(hud.wind, word);
  drawDecree();
  drawWeather();
  // Единственное предупреждение: полгода, чтобы начать первую меру. Чем ближе срок, тем заметнее.
  const idle = idleStatus(state);
  hud.idle.hidden = !idle || idle.done >= idle.needed;
  document.body.classList.toggle("idle-task", !hud.idle.hidden);
  if (!hud.idle.hidden) {
    const left = idle.deadlineDay - state.day;
    put(hud.idleText, `Президент ждёт действий: ${left} дн.`);
    hud.idle.dataset.urgency = left <= 30 ? "last" : left <= 75 ? "soon" : "calm";
  }
  // ожидание президента — часть задачи года: та же плашка, только срочнее
  hud.task.dataset.idle = hud.idle.hidden ? "" : hud.idle.dataset.urgency;
}

function setSpeed(v) {
  if (v > 0) lastSpeed = v;
  speed = v;
  for (const b of document.querySelectorAll("[data-speed]")) b.setAttribute("aria-pressed", String(Number(b.dataset.speed) === v));
  document.body.classList.toggle("paused", v === 0 && started && !state.ended);
  invalidate();
}

// Всплывающая дельта бюджета
function floatDelta(el, text, good) {
  if (reducedMotion()) return;
  const s = document.createElement("span");
  s.className = `delta ${good ? "good" : "bad"}`;
  s.textContent = text;
  s.setAttribute("aria-hidden", "true");
  el.append(s);
  setTimeout(() => s.remove(), 1300);
}

// --- панели ---
// Порядок панели: короткая шапка района → стройки → меры (сначала то, что можно начать) → «О районе» свёрнуто.
const TAB_IDS = [...DISTRICTS.map(d => d.id), "city"];
const isMobile = () => matchMedia("(max-width: 899px)").matches;

function tabsHtml() {
  const chip = (id, label, dot) => `<button class="chip" data-tab="${id}" aria-pressed="${selected === id}">${dot}${label}</button>`;
  return DISTRICTS.map(d => chip(d.id, d.name, `<span class="dot" data-dot="${d.id}"></span>`)).join("") + chip("city", "Город", icon("city"));
}

// Подпись структуры панели: меняется, когда меняется доступность кнопок, — тогда панель пересобирается.
function panelKey() {
  const sites = sitesHere().map(b => `${b.id}${b.approval > 0 ? "a" : ""}`).join(",");
  const sub = selected !== "city" && state.districts.find(x => x.id === selected).done.includes("gas-subsidy") ? "s" : "";
  // кнопка «В кредит» появляется и пропадает вместе с подходящим кредитом
  const loans = (selected === "city" ? [...CITY_PROJECTS.map(p => projectStatus(state, p.id)), nmuStatus(state)] : DISTRICT_ACTIONS.map(a => actStatus(state, selected, a.id)))
    .map(loanOffer).join(",");
  const imp = impactsKey();
  if (selected === "city") return "city|" + imp + "|" + sites + "|" + loans + "|" + CITY_PROJECTS.map(p => projectStatus(state, p.id).reason).join(",") + "|" + nmuStatus(state).reason + nmuStatus(state).active;
  // цена «Выслушать» растёт после каждого раза; detail обновляется на месте и в подпись не входит
  const costs = DISTRICT_ACTIONS.filter(a => a.repeat).map(a => actionCost(state, selected, a.id)).join(",");
  const syn = DISTRICT_ACTIONS.map(a => (synergyActive(state, selected, a.id) ? 1 : 0)).join("");
  return selected + "|" + imp + "|" + sites + "|" + sub + "|" + loans + "|" + costs + "|" + syn + "|" + state.wind + "|" + DISTRICT_ACTIONS.map(a => actStatus(state, selected, a.id).reason).join(",");
}

// Чипы «зима −6» и ссылка на лучший городской проект меняются с прогнозом: их округлённые числа — в подписи панели.
function impactsKey() {
  const list = selected === "city" ? CITY_PROJECTS.map(p => impactOf(null, p.id)) : DISTRICT_ACTIONS.map(a => impactOf(selected, a.id));
  const r = v => (v === null ? "n" : Math.abs(v) < 1 ? "0" : Math.round(v));
  const best = selected === "city" ? null : bestCityProject();
  return list.map(r).join(",") + (best ? `>${best.id}${r(best.impact)}` : "");
}

// Кредит, который покроет нехватку денег на меру: сумма или null (денег хватает, нехватка не в деньгах или банк не даст).
const loanOffer = st => (!st.ok && st.reason === REASONS.noMoney && st.shortfall > 0 ? loanFor(state, st.shortfall) : null);

// Стройки выбранного района или города. На карте кран может быть скрыт, поэтому они есть и в панели.
const sitesHere = () => state.building.filter(b => (selected === "city" ? b.kind === "city" : b.kind === "district" && b.district === selected));
const siteKey = b => `${b.kind === "city" ? "c" : "d"}:${b.id}`;
const siteName = b => (b.kind === "city" ? getProject(b.id) : getAction(b.id)).name;
// "approval" | "paused" | "work": согласование важнее забастовки, стройка ещё не началась
const siteState = b => (b.approval > 0 ? "approval" : isPaused(state, b) ? "paused" : "work");
const siteLabel = b => {
  const st = siteState(b);
  if (st === "approval") return `согласование, ещё ${b.approval} дн.`;
  if (st === "paused") return "стоит: люди против";
  return `${Math.round(progress(state, b) * 100)}%, ещё ${b.left} дн.`;
};

// Компактная полоса строек под шапкой: название, срок, прогресс.
function sitesHtml() {
  const list = sitesHere();
  if (!list.length) return "";
  return `<ul class="sites" aria-label="Идёт стройка">${list.map(b => `<li data-site="${siteKey(b)}">${icon("crane", { size: 14 })}<b>${siteName(b)}</b>
    <small data-left="${siteKey(b)}"></small>
    <span class="prog"><i data-prog="${siteKey(b)}" style="width:${progress(state, b) * 100}%"></i></span></li>`).join("")}</ul>`;
}

// Топливо ТЭЦ для карты и панели. ТЭЦ-1 на газе с 2017 года; множитель тут не подходит: его меняют и события.
export function plantFuel(s, id) {
  if (id === "tec1" || (id === "tec2" && s.cityDone.includes("tec2gas"))) return "gas";
  if (id !== "tec1" && s.cityDone.includes("filters")) return "filters";
  return "coal";
}
const FUEL_RU = { coal: "уголь", filters: "уголь с фильтрами", gas: "газ" };

// Умное решение в подробностях меры: с чем действие сильнее, и работает ли это прямо сейчас.
function synergyHtml(item, on) {
  if (!item.synergy) return "";
  return `<span class="synergy${on ? " on" : ""}">${icon("lightbulb", { size: 14 })}<span>${on ? "Сейчас работает: " : ""}${item.synergy.text}</span></span>`;
}

// Только что открытые путём мер строки ("d:gas", "c:tec2gas"): короткая подсветка при следующей сборке панели.
const justOpened = new Set();
// Раскрытая строка меры (одна на панель) и раскрытые группы — переживают пересборку панели.
let expanded = null;
const groupsOpen = { locked: false, done: false, about: false };

// Нехватка денег коротко: «не хватает 12 · через 8 дн.». Полный текст — в подробностях и подсказке.
function shortNo(st) {
  if (st.reason !== REASONS.noMoney) return st.detail ?? st.reason ?? "";
  return st.daysUntil ? `не хватает ${st.shortfall} · через ${st.daysUntil} дн.` : `не хватает ${st.shortfall} · доход не покрывает`;
}
const nmuWhy = st => (st.active ? `действует, ещё ${daysWord(st.left)}` : st.detail ?? st.reason);

// Мера как данные для строки: { kind, id, glyph, name, cost, days, fx, side, syn, st, b, done, repeat, better }
function districtItems(id) {
  const sd = state.districts.find(x => x.id === id);
  return DISTRICT_ACTIONS.map(a => ({
    kind: "d", id: a.id, glyph: OSM_ICONS[a.id], name: a.name, cost: actionCost(state, id, a.id), days: a.days, fx: actionFx(a), side: a.sideEffect, repeat: a.repeat,
    syn: synergyHtml(a, synergyActive(state, id, a.id)), better: airHint(a) === "better", impact: impactOf(id, a.id),
    st: actStatus(state, id, a.id),
    b: state.building.find(b => b.kind === "district" && b.district === id && b.id === a.id),
    done: sd.done.includes(a.id),
  }));
}

function cityItems() {
  const n = SIM.nmu, nst = nmuStatus(state);
  const nmu = {
    kind: "n", id: "nmu", glyph: "traffic", name: "Режим НМУ", cost: n.cost, days: 0, lasts: n.days, better: true, syn: "",
    fx: `<span class="good">машины −${Math.round((1 - n.traffic) * 100)}%, ТЭЦ −${Math.round((1 - n.plant) * 100)}%, печи −${Math.round((1 - n.stoves) * 100)}% на ${n.days} дн.</span> ${moodFx(n.mood)}`,
    side: `Потом перерыв ${n.cooldown} дн. Лучше всего — в начале зимнего штиля.`,
    st: nst.ok ? { ok: true } : { ok: false, reason: nmuWhy(nst), active: nst.active },
  };
  return [...CITY_PROJECTS.map(p => ({
    kind: "c", id: p.id, glyph: OSM_ICONS[p.id] ?? "crane", name: p.name, cost: p.cost, days: p.days, fx: projectFx(p), side: p.sideEffect, better: airHint(p) === "better", impact: impactOf(null, p.id),
    syn: synergyHtml(p, false),
    st: projectStatus(state, p.id),
    b: state.building.find(b => b.kind === "city" && b.id === p.id),
    done: state.cityDone.includes(p.id),
  })), nmu];
}

// Правая часть строки: кнопка, нехватка денег, замок пути мер, стройка или «готово».
function rowSide(x, key) {
  const st = x.st;
  if (x.done && !x.repeat) return `<span class="state ok">${icon("check-circle", { size: 14 })}готово</span>`;
  if (x.b) return `<span class="state work" data-pct="${key}">${siteLabel(x.b)}</span>`;
  if (st.ok) {
    const label = x.kind === "n" ? "Объявить" : x.repeat ? "Выслушать" : x.days ? "Построить" : "Ввести";
    return `<button class="go" data-build="${key}" data-fid="b:${key}" aria-label="${label}: ${x.name}">${label}</button>`;
  }
  if (st.locked) {
    const n = st.progress?.count > 1 ? `<b class="need" aria-label="готово ${st.progress.have} из ${st.progress.count}">${st.progress.have}/${st.progress.count}</b>` : "";
    return `<span class="state lock">${icon("lock", { size: 14 })}<span>${st.reason.replace("откроется после: ", "после: ").replace(/ \(готово \d+\)/, "")}</span>${n}</span>`;
  }
  if (st.active) return `<span class="state work">${st.reason}</span>`;
  const money = st.reason === REASONS.noMoney;
  const side = `<span class="state ${money ? "money" : "no"}">${icon(money ? "wallet" : "clock", { size: 14 })}<span data-no="${key}">${shortNo(st)}</span></span>`;
  const loan = money && loanOffer(st);
  if (!loan) return side;
  const o = loanOptions(state).find(x => x.amount === loan);
  const tip = `Взять кредит ${loan} млрд и сразу начать: ${x.name}. Возврат ${num1(o.total)} млрд, −${num2(o.perDay)} в день ${SIM.loan.days} дн.`;
  return `${side}<button class="loan-go" data-loanbuild="${key}" data-fid="l:${key}" aria-label="${tip}" title="${tip}">В кредит<small>+${loan} млрд</small></button>`;
}

function rowHtml(x) {
  const key = `${x.kind}:${x.id}`, rid = `more-${x.kind}-${x.id}`, open = expanded === key;
  const cls = x.done && !x.repeat ? "done" : x.b ? "building" : x.st.ok ? "ready" : x.st.locked ? "locked" : "wait";
  const fresh = justOpened.has(key) && !x.st.locked ? " just-opened" : "";
  const days = x.kind === "n" ? `${x.lasts} дн. действует` : fmtDays(x.days);
  const why = !x.st.ok && x.st.detail && x.st.detail !== shortNo(x.st) ? `<p class="why-no">${x.st.detail}</p>` : "";
  return `<li class="mrow ${cls}${open ? " open" : ""}${fresh}" data-key="${key}">
    <button class="mrow-main" data-fid="m:${key}" aria-expanded="${open}" aria-controls="${rid}">
      <span class="ico">${icon(x.glyph, { size: 20 })}</span>
      <span class="nm">${x.name}</span>
      <span class="meta"><span class="cost">${fmtCost(x.cost)}</span><span>${days}</span>${impactTag(x)}</span>
    </button>
    <div class="mrow-side">${rowSide(x, key)}</div>
    <div class="mrow-more" id="${rid}"${open ? "" : " hidden"}>
      <p class="fx">${x.fx}</p>
      ${x.side ? `<p class="side">${icon("alert", { size: 14 })}<span>${x.side}</span></p>` : ""}
      ${x.syn}
      ${why}
    </div>
  </li>`;
}

// Меры по группам: можно начать → не хватает денег (раньше накопится — выше) → откроются позже (свёрнуто) → готово.
// Порядок «можно начать»: больше пользы для зимы, потом «воздух чище». Выбор — за игроком: ничего не подсвечиваем.
const impactRank = x => (x.impact === null || x.impact === undefined ? (x.better ? 0 : 1) : x.impact);
const lockedLabel = n => `Ещё ${n} ${plural(n, "мера откроется", "меры откроются", "мер откроется")} позже`;

// Городской проект, который сильнее всего снизит прогноз зимы: ещё не готов и не строится. { id, name, impact } или null.
function bestCityProject() {
  let best = null;
  for (const p of CITY_PROJECTS) {
    if (state.cityDone.includes(p.id) || state.building.some(b => b.kind === "city" && b.id === p.id)) continue;
    const v = impactOf(null, p.id);
    if (v !== null && v <= -1 && (!best || v < best.impact)) best = { id: p.id, name: p.name, impact: v };
  }
  return best;
}
// Строка в мерах района: что даст город. Переключает на вкладку «Город».
function cityLinkHtml() {
  const p = bestCityProject();
  if (!p) return "";
  return `<button class="city-link" data-goto="city">${icon("city", { size: 14 })}<span>Проекты города: ${p.name} — зима ${signed(Math.round(p.impact))}</span><span aria-hidden="true">→</span></button>`;
}

function measuresHtml(list, title, extra = "") {
  const free = x => !(x.done && !x.repeat) && !x.b;
  const ready = list.filter(x => free(x) && x.st.ok)
    .sort((a, b) => impactRank(a) - impactRank(b));
  const wait = list.filter(x => free(x) && !x.st.ok && !x.st.locked)
    .sort((a, b) => (a.st.daysUntil ?? 1e9) - (b.st.daysUntil ?? 1e9));
  const locked = list.filter(x => free(x) && x.st.locked);
  const finished = list.filter(x => !free(x));
  const group = (id, label, items, ico) => (items.length ? `<details class="mgroup" data-group="${id}"${groupsOpen[id] ? " open" : ""}>
      <summary>${icon(ico, { size: 14 })}${typeof label === "function" ? label(items.length) : `${label} (${items.length})`}</summary><ul class="mlist">${items.map(rowHtml).join("")}</ul></details>` : "");
  const main = [...ready, ...wait];
  return `<section class="measures" aria-labelledby="m-title">
    <h3 class="section-title" id="m-title" tabindex="-1">${title}<small>${ready.length ? `можно начать: ${ready.length}` : "сейчас начать нечего"}</small></h3>
    ${main.length ? `<ul class="mlist">${main.map(rowHtml).join("")}</ul>` : ""}
    ${group("locked", lockedLabel, locked, "lock")}
    ${extra}
    ${group("done", "Готово и строится", finished, "check-circle")}
  </section>`;
}

function districtPanel(id) {
  const d = DISTRICTS.find(x => x.id === id);
  const sd = state.districts.find(x => x.id === id);
  return `<div class="phead"><h2>${d.name} район</h2><span class="pill" data-f="aqi">AQI</span>
      <span class="mood-chip" data-f="moodchip" title="Настроение района">${icon("smile", { size: 14 })}<b data-f="mood"></b></span></div>
    <p class="pmini"><span title="Печи на угле">${icon("flame", { size: 14 })}печи <b data-f="stoves"></b></span><span title="Трафик">${icon("car", { size: 14 })}машины <b data-f="traffic"></b></span><span title="Население">${icon("users", { size: 14 })}<b data-f="pop"></b> тыс.</span></p>
    ${sitesHtml()}
    ${sd.done.includes("gas-subsidy") ? `<p class="subsidy">${icon(OSM_ICONS["gas-subsidy"], { size: 14 })}Субсидия на газ действует <button class="cancel" data-cancel>Отменить субсидию</button></p>` : ""}
    ${measuresHtml(districtItems(id), "Меры района", cityLinkHtml())}
    <details class="about" data-group="about"${groupsOpen.about ? " open" : ""}><summary>${icon("map", { size: 14 })}О районе: откуда смог, ветер, люди</summary>
      <p class="status" hidden><span class="st-ico"></span><span data-f="status"></span></p>
      <p class="sources"><span data-f="air"></span><br>Откуда смог сегодня: <b data-f="src"></b></p>
      <p class="wind-geo">${icon("wind")}<span>${windGeo(id)}</span></p>
    </details>`;
}

// Ветер: откуда к району приносит смог и куда уносит его собственный. Сегодня — по ветру дня, иначе — чаще всего (на север).
const names = list => list.map(x => DISTRICTS.find(d => d.id === x).name).join(", ");
function windGeo(id) {
  const w = windLinks(id);
  const today = state.wind === "calm" ? null : w[state.wind];
  const usual = w.n;
  const part = (l, dir) => `${l.from.length ? `приносит смог из: ${names(l.from)}` : "сюда смог не приносит"}; ${l.to.length ? `уносит в: ${names(l.to)}` : dir === "s" ? "к горам не уходит" : "уходит из города"}`;
  const tip = "Чистить тех, кто выше по ветру, выгоднее.";
  if (state.wind === "n") return `Ветер на север, как чаще всего: ${part(usual, "n")}. ${tip}`;
  const now = today ? `Сегодня ветер ${DIR_RU[state.wind]}: ${part(today, state.wind)}.` : "Сегодня штиль: смог стоит на месте.";
  return `${now} Чаще всего ветер на север: ${part(usual, "n")}. ${tip}`;
}

function cityPanel() {
  return `<div class="phead"><h2>Город</h2><span class="pill" data-f="aqi">AQI</span></div>
    ${sitesHtml()}
    ${measuresHtml(cityItems(), "Городские проекты")}
    <details class="about" data-group="about"${groupsOpen.about ? " open" : ""}><summary>${icon("factory", { size: 14 })}О городе: ТЭЦ и путь мер</summary>
      <p class="sources" data-f="air"></p>
      <ul class="plants">${PLANTS.map(p => `<li>${icon("factory")}<span>${p.fullName}: <b data-plant="${p.id}"></b></span></li>`).join("")}</ul>
      <p class="hint">Большие проекты строятся годами. Начните рано — и следите, чтобы бюджет не ушёл в минус.</p>
      <p class="hint path">${icon("unlock", { size: 14 })}<span>Путь мер: котельная → газ → субсидия на газ в том же районе, газ → штрафы за уголь; автобус → парковка, 2 автобуса → метро; фильтры → ТЭЦ-2. Содержание дешёвых мер съедает доход — копите на большое.</span></p>
    </details>`;
}

let panelShown = null;

function drawPanel() {
  const key = panelKey();
  if (key !== panelShown) {
    const fid = document.activeElement?.closest?.("#panel-body [data-fid]")?.dataset.fid;
    panel.innerHTML = selected === "city" ? cityPanel() : districtPanel(selected);
    panelShown = key;
    if (fid) panel.querySelector(`[data-fid="${fid}"]`)?.focus({ preventScroll: true });
  }
  // значения, которые меняются каждый день, — на месте
  const aqi = Math.round(selected === "city" ? cityAqi(state) : districtAqi(state, selected));
  const band = aqiBand(aqi);
  for (const pill of [panel.querySelector('[data-f="aqi"]'), $("sheet-aqi")]) {
    put(pill, `AQI ${aqi}`);
    pill.style.background = band.color;
    pill.style.color = band.ink;
  }
  put($("sheet-title"), selected === "city" ? "Город" : `${DISTRICTS.find(d => d.id === selected).name} район`);
  put(panel.querySelector('[data-f="air"]'), airLine(selected === "city" ? cityPm25(state) : districtPm25(state, selected)));
  if (selected === "city") {
    for (const p of PLANTS) put(panel.querySelector(`[data-plant="${p.id}"]`), FUEL_RU[plantFuel(state, p.id)]);
  } else {
    const sd = state.districts.find(x => x.id === selected);
    put(panel.querySelector('[data-f="mood"]'), Math.round(sd.mood));
    put(panel.querySelector('[data-f="stoves"]'), sd.stoves.toFixed(1));
    put(panel.querySelector('[data-f="traffic"]'), sd.traffic.toFixed(1));
    put(panel.querySelector('[data-f="pop"]'), Math.round(sd.pop * 10));
    const stEl = panel.querySelector('[data-f="status"]');
    const stBox = stEl.closest(".status");
    const dst = districtStatus(state, selected);
    const text = statusText(dst);
    stBox.hidden = !text;
    stBox.classList.toggle("strike", dst.strike);
    putIcon(stBox.querySelector(".st-ico"), dst.strike ? "fist" : "frown");
    put(stEl, text);
    // недовольство видно и в свёрнутом виде: настроение красным, причина — в подсказке
    const chip = panel.querySelector('[data-f="moodchip"]');
    chip.classList.toggle("bad", dst.protest || dst.strike);
    const tip = text || "Настроение района";
    if (chip.title !== tip) chip.title = tip;
    const e = districtEmission(state, selected);
    const sum = e.stoves + e.traffic + e.plant || 1;
    const pc = v => Math.round((v / sum) * 100);
    put(panel.querySelector('[data-f="src"]'), `печи ${pc(e.stoves)}% · машины ${pc(e.traffic)}% · ТЭЦ ${pc(e.plant)}%`);
  }
  for (const b of sitesHere()) {
    const k = siteKey(b);
    const p = progress(state, b);
    const label = siteLabel(b);
    put(panel.querySelector(`[data-pct="${k}"]`), label);
    put(panel.querySelector(`[data-left="${k}"]`), label);
    const row = panel.querySelector(`[data-site="${k}"]`);
    if (row) row.dataset.state = siteState(b);
    for (const bar of panel.querySelectorAll(`[data-prog="${k}"]`)) bar.style.width = `${p * 100}%`;
  }
  // сколько не хватает и когда накопится — меняется каждый день, панель из-за этого не пересобираем
  for (const el of panel.querySelectorAll("[data-no]")) {
    const [kind, id] = el.dataset.no.split(":");
    const st = kind === "n" ? nmuStatus(state) : kind === "c" ? projectStatus(state, id) : actStatus(state, selected, id);
    put(el, kind === "n" ? nmuWhy(st) : shortNo(st));
  }
}

function statusText(st) {
  if (st.strike) return `Люди на пределе: доход от района в бюджет вдвое меньше, стройки стоят. Причина: ${CAUSE_RU[st.cause] ?? "район недоволен"}.`;
  if (st.protest) return `Люди недовольны: ${CAUSE_RU[st.cause] ?? "район недоволен"}.`;
  return "";
}

// Раскрыть одну строку (остальные свернуть) без пересборки панели.
function toggleRow(key) {
  expanded = expanded === key ? null : key;
  for (const r of panel.querySelectorAll(".mrow")) {
    const on = r.dataset.key === expanded;
    r.classList.toggle("open", on);
    r.querySelector(".mrow-main").setAttribute("aria-expanded", String(on));
    r.querySelector(".mrow-more").hidden = !on;
  }
}

function drawTabs() {
  for (const d of DISTRICTS) tabs.querySelector(`[data-dot="${d.id}"]`).style.background = aqiColor(districtAqi(state, d.id));
}

// --- нижняя шторка (телефон) ---
function setSheet(open) {
  document.body.classList.toggle("sheet-open", open);
  sheetHandle.setAttribute("aria-expanded", String(open));
  put($("sheet-more"), open ? "Свернуть" : "Все меры");
  if (!open) panel.scrollTop = 0;
}
const sheetOpen = () => document.body.classList.contains("sheet-open");

// Выбрать вкладку. from: "map" | "tab" | "key" — после выбора меры видны сразу: панель — к началу, шторка — к мерам.
function select(id, from) {
  const changed = id !== selected;
  selected = id;
  if (changed) expanded = null;
  for (const c of tabs.querySelectorAll(".chip")) c.setAttribute("aria-pressed", String(c.dataset.tab === id));
  panelShown = null;
  drawPanel();
  const chip = tabs.querySelector(`[data-tab="${id}"]`);
  if (chip && (chip.offsetLeft < tabs.scrollLeft || chip.offsetLeft + chip.offsetWidth > tabs.scrollLeft + tabs.clientWidth)) {
    tabs.scrollTo({ left: chip.offsetLeft - 8, behavior: reducedMotion() ? "auto" : "smooth" });
  }
  if (from) {
    aside.scrollTop = 0;
    panel.scrollTop = 0;
    if (isMobile()) {
      sheetHandle.classList.remove("pulse");
      void sheetHandle.offsetWidth;
      sheetHandle.classList.add("pulse");
    }
    coach.selected();
  }
}

// Фокус на первую меру, которую можно начать. Для «К мерам» и клавиши B.
function focusFirstMeasure() {
  const btn = panel.querySelector("[data-build]");
  const target = btn ?? $("m-title");
  if (!target) return;
  aside.scrollTop = 0;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
  const row = target.closest(".mrow");
  if (row) { row.classList.remove("pulse"); void row.offsetWidth; row.classList.add("pulse"); }
}

// --- лента ---
let feedShown = null;
let feedQuiet = false; // после «Отменить»: ленту перерисовать без вспышек и подсветок
function drawFeed() {
  const last = state.log.at(-1) ?? null;
  if (last === feedShown) return;
  const prev = feedShown ? state.log.indexOf(feedShown) : -1;
  const fresh = !feedQuiet && (feedShown !== null || state.day > 0);
  feedQuiet = false;
  feedShown = last;
  if (fresh) for (const e of state.log.slice(prev + 1)) {
    if (e.kind === "built" && e.district) flashOsmDistrict(osm, e.district);
    // открылась мера пути: подсветить её карточку (в районе — только в своём, если "same")
    if (e.kind === "unlock" && e.unlock) {
      const key = `${getProject(e.unlock) ? "c" : "d"}:${e.unlock}`;
      justOpened.add(key);
      setTimeout(() => justOpened.delete(key), 2500);
      panelShown = null;
    }
  }
  // одинаковые записи (штиль за штилем, даже вперемешку с другими) — одной строкой с «×N»
  const rows = [];
  const byText = new Map();
  for (const e of [...state.log].reverse()) {
    if (e.kind === "warning") continue; // предупреждение президента — отдельным окном, не строкой
    const row = byText.get(e.text);
    if (row) row.n++;
    else { const r = { e, n: 1 }; byText.set(e.text, r); rows.push(r); }
  }
  rows.length = Math.min(rows.length, 4);
  feed.replaceChildren(...rows.map(({ e, n }, i) => {
    const li = document.createElement("li");
    li.className = [`k-${e.kind}`, i === 0 && fresh ? "new" : ""].join(" ");
    const glyph = e.kind === "season" ? SEASON_ICON[date({ day: e.day }).season] : FEED_ICON[e.kind] ?? "dot";
    li.innerHTML = icon(glyph, { size: 14 });
    const text = document.createElement("span");
    text.textContent = `${e.text}${n > 1 ? ` ×${n}` : ""}`;
    li.append(text);
    return li;
  }));
}

// --- оверлеи ---
function showDialog(kind, html) {
  dlg = kind;
  dialog.innerHTML = html;
  overlay.hidden = false;
  for (const el of page) el.inert = true;
  document.body.classList.add("modal");
  dialog.scrollTop = 0;
  // В событии, тревоге и итоговом отчёте фокус на самом окне: случайный пробел не должен выбрать вариант.
  if (kind === "event" || kind === "report" || kind === "warning") dialog.focus();
  // Во вводном окне и указе сверху иллюстрация: фокус на кнопке, но окно не прокручиваем к ней — читают сверху.
  else dialog.querySelector("button:not(:disabled)")?.focus({ preventScroll: kind === "intro" || kind === "decree" });
}
function hideDialog() {
  const was = dlg;
  dlg = null;
  dialog.replaceChildren();
  overlay.hidden = true;
  for (const el of page) el.inert = false;
  document.body.classList.remove("modal");
  if (was === "loan") hud.money.focus(); // фокус — туда, откуда открыли
}

// Кредит: долг сейчас, три предложения банка и предупреждение про минус. Время стоит, пока окно открыто.
function loanDialog() {
  const owe = debtLeft(state), pay = loanPayment(state), inc = netIncome(state), L = SIM.loan;
  const sign = v => `${v >= 0 ? "+" : "−"}${num1(Math.abs(v))}`;
  const now = owe ? `Долг: <b>${num1(owe)} млрд</b>, платёж <b>−${num2(pay)}</b> в день.` : "Долгов нет.";
  const options = loanOptions(state).map(o => `<button class="option" data-loan="${o.amount}"${o.ok ? "" : " disabled"}>
      <b>+${o.amount} млрд сейчас</b>
      <small><span>−${num2(o.perDay)} в день ${L.days} дн.</span><span>переплата ${num1(o.total - o.amount)}</span><span class="${inc - o.perDay < 0 ? "bad" : ""}">доход станет ${sign(inc - o.perDay)} в день</span></small>
      ${o.ok ? "" : `<em class="why">${o.reason}</em>`}</button>`).join("");
  return `<p class="who">${icon("landmark", { size: 14 })}Бюджет города</p>
    <h2 id="dlg-title">Кредит</h2>
    <p class="loan-now">${now} Доход сейчас ${sign(inc)} в день. Можно занять ещё ${loanRoom(state)} млрд: долг не больше ${L.limitDays} дней дохода.</p>
    <p class="loan-note">${INCOME_NOTE}</p>
    <div class="options">${options}</div>
    <p class="loan-warn">${icon("alert")}<span>Деньги сразу, а платежи — каждый день ${L.days} дней, и они могут увести бюджет в минус. ${SIM.debtDaysLimit} дней в минусе — внешнее управление.</span></p>
    <button class="secondary" data-act="close-loan">Закрыть</button>`;
}

function openLoan() {
  if (!canPlay() || dlg) return;
  showDialog("loan", loanDialog());
}

const whenText = s => { const d = date(s); return `год ${d.gameYear}, ${SEASON_RU[d.season]}`; };

// saved — незаконченная партия из автосохранения: тогда главная кнопка — продолжить её.
function intro(saved = null) {
  return `<div class="art-scene">${presidentOffice()}</div>
    <h1 id="dlg-title">Аким Алматы</h1>
    <p class="intro-lead">${SIM.introText}.</p>
    <ul class="howto intro-points">
      <li>${icon("scroll")}<span><b>Каждый год — указ президента.</b> Не выполнили — снимут.</span></li>
      <li>${icon("wallet")}<span><b>Денег мало, доверие на грани.</b> Ниже ${SIM.firedRating} — отставка.</span></li>
      <li>${icon("map")}<span><b>Нажмите на район и выберите меру.</b> Время идёт само.</span></li>
    </ul>
    <details class="intro-more"><summary>Все правила</summary>
    <ul class="rules">
      <li><b>Каждый год президент даёт указ: задачу с числами и срок. Не выполнили — снимут сразу, без предупреждения.</b></li>
      <li>Каждый год новые преграды: пустая казна, угольное лобби, морозы. Что сработало в прошлом году, в этом может не хватить.</li>
      <li>Погода — тоже удача. Осенью придёт прогноз: малоснежная зима грязнее, снежная чище.</li>
      <li>Если за полгода не начнёте ни одной меры для воздуха, президент снимет вас сразу.</li>
      <li>Снимут, если воздух в критическом состоянии: средний AQI за ${SIM.critical.windowDays} дней выше ${SIM.critical.threshold}. Начнётся обратный отсчёт.</li>
      <li>Доверие горожан всегда на грани: ниже ${SIM.firedRating} — отставка. Бюджет в минусе дольше ${SIM.debtDaysLimit} дней: город передадут внешнему управлению.</li>
      <li>Не хватает денег — можно взять кредит (нажмите на бюджет). Деньги сразу, платежи каждый день полгода, с переплатой ${Math.round(SIM.loan.rate * 100)}%.</li>
    </ul>
    <ul class="howto">
      <li>${icon("map")}<span>Нажмите на район: появятся его меры (на телефоне — в шторке снизу). У каждой меры — цена, срок и сколько она даст зимой.</span></li>
      <li>${icon("city")}<span>Вкладка «Город»: ТЭЦ, метро и режим НМУ на дни штиля.</span></li>
      <li>${icon("lightbulb")}<span>Нажмите на строку меры — эффект, побочная причина и с чем она сильнее.</span></li>
      <li>${icon("play")}<span>Кнопки наверху — скорость времени, пробел — пауза. Остальные клавиши — под «?».</span></li>
    </ul>
    </details>
    ${saved ? `<button class="primary" data-act="continue">Продолжить партию (${whenText(saved.state)})</button>
    <button class="secondary" data-act="start">Новая партия</button>` : `<button class="primary" data-act="start">Принять дела</button>`}`;
}

const itemName = id => { const n = (getAction(id) ?? getProject(id)).name; return /^[А-Я][а-я]/.test(n) && !/^ТЭЦ/.test(n) ? n[0].toLowerCase() + n.slice(1) : n; };

// Указ президента: задача крупно, под ней преграды года с эффектами, разрешения. Одна кнопка.
function decreeDialog(s) {
  const d = decreeStatus(s);
  const where = d.where ? ` (${DISTRICTS.find(x => x.id === d.where).name} район)` : "";
  const obstacles = d.obstacles.map(o => `<li><span>${icon(OBSTACLE_ICON[o.id] ?? "alert", { size: 20 })}</span><b>${o.name}</b><small>${o.text}${o.district ? where : ""}</small></li>`).join("");
  return `<div class="decree-card"><div class="decree-band">${flagStripe()}</div>
    <span class="decree-seal">${decreeSeal(64)}</span><p class="who">${icon("scroll", { size: 14 })}Указ президента · год ${d.year}${d.title ? ` · ${d.title}` : ""}</p>
    ${d.tasks.map((t, i) => `<p class="decree-task"${i ? "" : ' id="dlg-title"'}>${icon(TASK_ICON[t.kind], { size: 22 })}<span>${t.text}</span></p>`).join("")}
    <p>Срок — до 1 января. Не выполните — президент освободит вас от должности.</p></div>
    <h3>Преграды года</h3>
    <ul class="obstacles">${obstacles}</ul>
    ${d.unlocks.length ? `<p class="unlocks">${icon("unlock")}<span>Указом разрешено: ${d.unlocks.map(itemName).join(", ")}.</span></p>` : ""}
    <button class="primary" data-act="decree">Принять к исполнению</button>`;
}

// Прогноз на зиму: без выбора, только «Понятно».
function forecastDialog(s) {
  const w = SIM.winters[s.pendingForecast.type];
  const l = luck(s.pendingForecast.type);
  const note = l === "bad" ? "Указ от погоды не зависит. Нужны срочные меры: режим НМУ в штиль, то, что успеет достроиться до зимы, и люди, которым тоже тяжело."
    : l === "good" ? "Повезло. Но снег не отменяет указ: зима всё равно зима." : "Без сюрпризов: зима как в прошлые годы.";
  return `<div class="forecast-card" data-luck="${l}"><p class="big">${icon(WINTER_ICON[s.pendingForecast.type] ?? "cloud-snow", { size: 36 })}</p>
    <p class="who">Прогноз на зиму</p>
    <h2 id="dlg-title">Зима будет ${w.was}</h2>
    <p>${w.text}.</p></div>
    <p>${note}</p>
    <button class="primary" data-act="forecast">Понятно</button>`;
}

// Подсказка к варианту события: что он сделает с городом.
function effectHints(effects) {
  const e = eventEffects(effects, state.airStreak), out = [];
  const tag = (good, text) => out.push(`<span class="${good ? "good" : "bad"}">${text}</span>`);
  if (e.budget) tag(e.budget > 0, `бюджет ${e.budget > 0 ? "+" : "−"}${Math.abs(Math.round(e.budget))} млрд`);
  if (e.mood) tag(e.mood > 0, `настроение ${e.mood > 0 ? "↑" : "↓"}${Math.abs(e.mood)}`);
  for (const [k, name] of [["tec", "ТЭЦ"], ["stoves", "печи"], ["traffic", "машины"]]) {
    if (e[k] === undefined) continue;
    const pc = Math.round((e[k] - 1) * 100);
    tag(pc < 0, `${name} ${pc < 0 ? "↓" : "↑"}${Math.abs(pc)}%`);
  }
  return out.join(" ");
}

function eventDialog(s) {
  const c = getCard(s.pendingEvent.cardId);
  const streak = s.airStreak >= 2
    ? `<p class="streak">${icon("alert")}<span>Уже ${s.airStreak} решения подряд сделали воздух грязнее. Контроль слабеет: следующее такое ударит сильнее.</span></p>`
    : "";
  return `<p class="who">${icon("megaphone", { size: 14 })}Событие</p><h2 id="dlg-title">${c.who}</h2>
    <p>${c.text}</p>
    ${streak}
    <div class="options">${c.options.map((o, i) => `<button class="option" data-opt="${i}"><b>${o.label}</b>
      <small>${airTag(o)} ${effectHints(o.effects)}</small>
      ${o.why ? `<em class="why">${o.why}</em>` : ""}</button>`).join("")}</div>`;
}

// Отчёт президенту: указ года выполнен (иначе отчёта нет), итоги в три строки, реплика, бонус. Отсюда можно уйти.
function reportTask(t) {
  if (t.kind === "winter") return `зимой средний AQI ${Math.round(t.value)} при задаче ниже ${t.target}`;
  if (t.kind === "stoves") return `печей на угле меньше на ${Math.round(t.value * 100)}% при задаче ${Math.round(t.target * 100)}%`;
  if (t.kind === "tec2") return "перевод ТЭЦ-2 на газ начат вовремя";
  return `худший день зимы — AQI ${Math.round(t.value)} при черте ${t.target}`;
}
function reportDialog(r) {
  const change = r.airChange === null ? "" : `, смог ${signed(Math.round((r.airChange - 1) * 100))}% к зиме до вас`;
  const winter = r.winterAqi === null ? "зимы ещё не было" : `зимой AQI ${Math.round(r.winterAqi)}${change}`;
  const w = r.winter ? SIM.winters[r.winter] : null;
  return `<div class="report-card"><p class="who">${icon("landmark", { size: 14 })}Президент · итоги ${r.year}-го года</p>
    <h2 id="dlg-title">«${r.remark}»</h2></div>
    <ul class="report">
      ${r.decree.tasks.map(t => `<li class="ok">${icon("check-circle")}<span>Указ: ${reportTask(t)}</span></li>`).join("")}
      <li>${icon("snowflake")}<span>${winter}${w ? ` · зима была ${w.was}` : ""}</span></li>
      <li>${icon("handshake")}<span>Доверие горожан: ${Math.round(r.trust)}</span></li>
      <li>${icon("wallet")}<span>За указ: +${r.reward} млрд</span></li>
    </ul>
    <p>Дальше — новый указ, строже, и новые преграды.</p>
    <button class="primary" data-act="report">Работаем дальше</button>
    <button class="secondary" data-act="retire">Уйти в отставку по собственному желанию</button>`;
}

// Сравнение всегда с зимой до назначения игрока, а не с первой зимой партии.
function wintersHtml(s) {
  const pm = s.lastWinterPm25;
  if (pm === null) return "<p class=\"change\">До первой зимы вы не дотянули.</p>";
  const base = SIM.baselineWinterPm25;
  // оба AQI из среднего PM2.5: иначе цифры спорили бы с процентами (средний дневной AQI другой, он нелинеен)
  const before = aqiFromPm25(base), now = aqiFromPm25(pm);
  const change = Math.round((1 - airChange(s)) * 100);
  return `<div class="winters">
      <div><small>Зима до вашего назначения</small><b style="color:${aqiColor(before)}">${before}</b><small>AQI · PM2.5 ${base}</small></div>
      <div class="arrow">${icon("arrow-right", { size: 28 })}</div>
      <div><small>Последняя зима</small><b style="color:${aqiColor(now)}">${now}</b><small>AQI · PM2.5 ${Math.round(pm)}</small></div>
    </div>
    <p class="change">${change > 0 ? `Смог снижен на <b>${change}%</b>.` : change < 0 ? `Смог вырос на <b>${-change}%</b>.` : "Смог не изменился."}</p>`;
}

function warningDialog(text) {
  const c = SIM.critical;
  const note = `Средний AQI за ${c.windowDays} дней выше ${c.threshold}. Опустите его ниже ${c.threshold - c.clearBelow} за ${daysWord(c.days)}, иначе вас снимут. Отсчёт виден наверху.`;
  return `<div class="warning-card"><p class="who">${icon("landmark", { size: 14 })}Президент</p>
    <h2 id="dlg-title">«${text}»</h2>
    <p>${note}</p></div>
    <button class="primary" data-act="ack">Понятно</button>`;
}

// Провал указа: какая задача и с какими числами, и какая была зима.
function decreeLossHtml(s) {
  const f = s.decreeFail;
  const w = s.winters.find(x => x.year === s.decree.year);
  const weather = w ? ` Зима была ${SIM.winters[w.type].was}${luck(w.type) === "bad" ? ": не повезло, но указ от погоды не зависит" : luck(w.type) === "good" ? ": даже снег не помог" : ""}.` : "";
  const obstacles = s.decree.obstacles.map(id => SIM.obstacles[id].name.toLowerCase()).join(", ");
  const task = s.decree.tasks.find(x => x.kind === f.kind);
  return `<p class="loss air"><b>Причина — указ ${s.decree.year}-го года:</b> «${task ? decreeTaskText(task) : f.text}».${weather}${obstacles ? ` Преграды года: ${obstacles}.` : ""}</p>`;
}

// Главный блок финала: история именно этой партии. Текст цепочек целиком из симуляции.
function summaryHtml(s) {
  const t = gameSummary(s);
  const when = day => `год ${date({ day }).gameYear}, ${SEASON_RU[date({ day }).season]}`;
  const chains = t.chains.map(c => `<li><small>${when(c.day)}</small>${c.text}</li>`).join("");
  const longest = t.unfinished[0];
  const late = longest && `<li>${icon("hourglass")}<span><b>Не успели:</b> ${longest.name}${longest.district ? `, ${DISTRICTS.find(x => x.id === longest.district).name} район` : ""}: оставалось ${longest.left} дн. стройки${longest.waiting ? ` и ${longest.waiting} дн. согласования` : ""}. Указ даёт на всё один год.</span></li>`;
  const money = t.unaffordable && `<li>${icon("banknote")}<span><b>Не хватило денег:</b> ${t.unaffordable.name} стоит ${t.unaffordable.cost} млрд, не хватало ${t.unaffordable.shortfall} млрд.</span></li>`;
  const debt = t.loans && `<li>${icon("landmark")}<span><b>Кредиты:</b> занято ${t.loans.taken} млрд, на проценты ушло ${num1(t.loans.interest)} млрд${t.loans.left > 0.5 ? `, остался долг ${Math.round(t.loans.left)} млрд` : ""}.</span></li>`;
  const facts = [money, late, debt].filter(Boolean).join("");
  const untouched = t.untouched.map(u => `<li>${u.text}</li>`).join("");
  if (s.ended === "idle") return `<section class="summary"><h3>Что произошло за это время</h3><p>Полгода город жил как раньше: ни одной меры для воздуха. В следующий раз начните с любой карточки с пометкой «воздух чище». Автобусный маршрут стоит ${getAction("bus").cost} млрд, парк ${getAction("park").cost} млрд.</p></section>`;
  if (!chains && !facts && !untouched) return `<section class="summary"><h3>Что произошло за это время</h3><p>Вы не успели ни запустить большие проекты, ни столкнуться с их последствиями. Смог всё это время делал своё дело.</p></section>`;
  return `<section class="summary"><h3>Что произошло за это время</h3>
    ${chains ? `<ol class="chains">${chains}</ol>` : ""}
    ${facts ? `<ul class="facts">${facts}</ul>` : ""}
    ${untouched ? `<h4>Что вы не тронули</h4><ul class="facts">${untouched}</ul>` : ""}</section>`;
}

// Титул: по PM2.5, потому что AQI не линеен и его отношение ничего не значит.
function title(s) {
  const a = airChange(s);
  if (a !== null && a <= 0.5) return "Аким, который увидел горы";
  if (s.cityDone.includes("tec2gas")) return "Газовый реформатор";
  if (rating(s) >= 60) return "Народный любимец, все кашляют";
  return "Аким-угольщик";
}

function final(s) {
  const titled = s.ended === "retired" || s.decreesDone >= 4;
  const a = airStatus(s);
  return `<h2 id="dlg-title">${endingText(s)}.</h2>
    ${s.ended === "decree" ? decreeLossHtml(s) : ""}
    ${s.ended === "critical" ? `<p class="loss air"><b>Причина — воздух.</b> Средний AQI за ${SIM.critical.windowDays} дней: ${Math.round(a.avg30)}, порог ${a.threshold}. Время вышло.</p>` : ""}
    ${wintersHtml(s)}
    ${titled ? `<p class="titleline">Титул: <b>${title(s)}</b></p>` : ""}
    ${summaryHtml(s)}
    <p class="stats-line">На посту: ${daysWord(s.day)}. Доверие горожан ${Math.round(rating(s))}, указов выполнено: ${s.decreesDone}.</p>
    <button class="primary" data-act="restart">Начать заново</button>`;
}

// --- цикл ---
let last = performance.now();
let acc = 0;
let warningSeen = null; // последнее показанное предупреждение президента
let mapShown = null; // { state, selected }: карта перерисовывается, только если что-то из этого изменилось

// Предупреждение президента — редкое и единственное в своём роде: игра встаёт, пока игрок его не прочтёт.
function checkWarning() {
  const w = state.log.findLast(e => e.kind === "warning");
  if (!w || w === warningSeen) return;
  warningSeen = w;
  // та же реплика пришла в годовом отчёте: второго окна подряд не нужно
  if (!state.ended && state.pendingReport?.remark !== w.text) showDialog("warning", warningDialog(w.text));
}

// Кадр работает, только когда есть что делать: идёт время, что-то изменилось (состояние, ввод, размер окна)
// или живой слой карты ещё не нарисовал стоп-кадр. На паузе и под окном цикл засыпает до следующего ввода;
// в скрытой вкладке не работает вовсе. Так вкладка меньше грузит машину и реже попадает под выгрузку Chrome.
let rafId = 0;
let dirty = true; // интерфейс надо перерисовать, даже если состояние то же (ввод, размер, выбор)
let drawnState = null;
const loopStats = { frames: 0, busy: 0, draws: 0 }; // для замеров в браузере (debug.loopStats)

function wake() {
  if (rafId || document.hidden) return;
  last = performance.now(); // цикл спал: время сна в игру не засчитывается
  rafId = requestAnimationFrame(frame);
}
function invalidate() { dirty = true; wake(); }

function frame(now) {
  rafId = 0;
  if (document.hidden) return; // вернёмся по visibilitychange
  const dt = Math.max(0, Math.min(250, now - last));
  last = now;
  const run = playing() && speed > 0;
  if (run) {
    acc += dt * speed;
    let n = 0;
    while (acc >= DAY_MS && n < MAX_TICKS && playing()) {
      state = tick(state);
      checkWarning();
      acc -= DAY_MS;
      n++;
    }
    if (!playing()) acc = 0;
    else if (n === MAX_TICKS) acc = Math.min(acc, DAY_MS);
    saveSoon(now);
  }
  let worked = run;
  if (dirty || state !== drawnState) {
    dirty = false;
    drawnState = state;
    draw();
    loopStats.draws++;
    worked = true;
  }
  if (fx.frame(state, run && playing() && !reducedMotion() ? speed : 0, dt)) worked = true;
  loopStats.frames++;
  if (worked) loopStats.busy++;
  if ((worked || dirty) && !rafId) rafId = requestAnimationFrame(frame);
}

const flags = id => { const st = districtStatus(state, id); return { protest: st.protest, strike: st.strike }; };

function osmView() {
  const sites = kind => state.building.filter(b => b.kind === kind);
  return {
    districts: state.districts.map(d => ({
      id: d.id,
      aqi: districtAqi(state, d.id),
      pm25: districtPm25(state, d.id),
      building: sites("district").filter(b => b.district === d.id).map(b => ({ actionId: b.id, progress: progress(state, b), state: siteState(b) })),
      ...flags(d.id),
      built: d.id === CITY_SITE.metro && state.cityDone.includes("metro") ? [...d.done, "metro"] : d.done,
    })),
    plants: PLANTS.map(p => ({ id: p.id, fuel: plantFuel(state, p.id) })),
    cityBuilding: sites("city").map(b => ({ actionId: b.id, progress: progress(state, b), state: siteState(b), at: CITY_SITE[b.id] })),
    selectedId: selected === "city" ? null : selected,
    day: state.day,
    winter: date(state).season === "winter",
  };
}

function drawMap() {
  if (mapShown?.state === state && mapShown.selected === selected) return;
  mapShown = { state, selected };
  updateOsmMap(osm, osmView());
  document.body.classList.toggle("winter", date(state).season === "winter");
}

function draw() {
  drawMap();
  drawHud();
  drawTabs();
  drawPanel();
  drawFeed();
  drawToast();
  coach.frame();
  // окно по состоянию; пока открыто вступление, ни событий, ни отчётов ещё нет
  if (state.ended) {
    if (dlg !== "end") { setSpeed(0); showDialog("end", final(state)); storageRemove(store); track(`end/${state.ended}/year-${date(state).year}`); }
  } else if (dlg === "warning") {
    // ждём «Понятно»; отчёт или событие откроются следом
  } else if (state.pendingReport) {
    if (dlg !== "report") showDialog("report", reportDialog(state.pendingReport));
  } else if (state.pendingDecree) {
    if (dlg !== "decree" && dlg !== "intro") showDialog("decree", decreeDialog(state));
  } else if (state.pendingForecast) {
    if (dlg !== "forecast") showDialog("forecast", forecastDialog(state));
  } else if (state.pendingEvent) {
    if (dlg !== "event") showDialog("event", eventDialog(state));
  }
}

function newGame() {
  state = newCity(Date.now() | 0);
  feedShown = null;
  warningSeen = null;
  panelShown = null;
  mapShown = null;
  expanded = null;
  hideToast();
  acc = 0;
  started = true;
  hideDialog();
  setSpeed(1);
  window.scrollTo(0, 0);
  storageRemove(store);
  saveNow();
}

// --- автосохранение ---
// Снимок партии в localStorage: при смене игрового дня не чаще раза в SAVE_EVERY_MS, сразу — после решений игрока
// (стройка, кредит, указ, событие, отчёт, отмена), при уходе со вкладки и закрытии страницы.
// Хранилища может не быть (приватный режим, квота): тогда игра просто идёт без сохранения.
const store = (() => { try { return globalThis.localStorage ?? null; } catch { return null; } })();
const SAVE_EVERY_MS = 2000;
let savedAt = -Infinity;
let savedDay = -1;
let offered = null; // незаконченная партия, которую вступление предлагает продолжить

function uiSnapshot() {
  return {
    selected,
    speed: speed || lastSpeed,
    coach: { off: coach.off, step: coach.step },
    warning: warningSeen ? { day: warningSeen.day, text: warningSeen.text } : null,
  };
}
function saveNow() {
  if (!started) return;
  savedAt = performance.now();
  savedDay = state.day;
  if (state.ended) { storageRemove(store); return; } // законченную партию не продолжают
  let json;
  try { json = serialize(state, uiSnapshot()); } catch (e) { console.warn("[akim] не удалось сохранить партию", e); return; }
  storageSet(store, json);
}
function saveSoon(now) {
  if (state.day !== savedDay && now - savedAt >= SAVE_EVERY_MS) saveNow();
}

// Вернуть партию из снимка: на паузе, с той же вкладкой и подсказками; прежнее предупреждение президента повторно не всплывёт.
function restoreGame(saved) {
  const ui = saved.ui;
  state = saved.state;
  started = true;
  offered = null;
  feedShown = null;
  feedQuiet = true;
  panelShown = null;
  mapShown = null;
  expanded = null;
  acc = 0;
  hideToast();
  const warnings = state.log.filter(e => e.kind === "warning");
  warningSeen = (ui.warning && warnings.findLast(e => e.day === ui.warning.day && e.text === ui.warning.text)) ?? warnings.at(-1) ?? null;
  if (ui.speed === 1 || ui.speed === 3) lastSpeed = ui.speed;
  if (ui.coach?.off) coach.stop();
  else if (Number.isInteger(ui.coach?.step) && ui.coach.step >= 0) coach.show(Math.min(ui.coach.step, COACH.length - 1));
  hideDialog();
  select(TAB_IDS.includes(ui.selected) ? ui.selected : selected);
  setSpeed(0);
  draw();
  saveNow();
}

// --- ввод ---
// Тост после стройки. «Отменить» — только пока после стройки ничего не произошло (игра на паузе и не прошло ни дня):
// тогда отмена — это просто возврат к состоянию до нажатия, а не новое правило с возвратом денег.
const toastEl = $("toast");
const toastText = $("toast-text");
const undoBtn = $("toast-undo");
let toastTimer = 0;
let undo = null; // { prev, after, key, spent }

function showToast(text, u = null) {
  undo = u;
  undoBtn.hidden = !u;
  if (u) undoBtn.textContent = u.spent ? `Отменить (вернётся ${u.spent} млрд)` : "Отменить";
  toastText.textContent = text;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 6000);
}
function hideToast() {
  toastEl.classList.remove("show");
  undo = null;
  undoBtn.hidden = true;
  // пустой текст: следующий такой же тост экранный диктор снова прочтёт
  setTimeout(() => { if (!toastEl.classList.contains("show")) toastText.textContent = ""; }, 400);
}
function drawToast() {
  if (undo && undo.after !== state) { undo = null; undoBtn.hidden = true; }
}

function buildText(kind, id, district, after) {
  if (kind === "n") return `Режим НМУ объявлен на ${daysWord(SIM.nmu.days)}`;
  const item = kind === "c" ? getProject(id) : getAction(id);
  const where = kind === "d" ? ` · ${DISTRICTS.find(d => d.id === district).name}` : "";
  const site = after.building.find(b => b.id === id && (kind === "c" ? b.kind === "city" : b.kind === "district" && b.district === district));
  if (!site) return `${item.name}${where}: ${item.repeat ? "сделано" : "введено сразу"}`;
  return `${item.name}${where}: ${site.approval > 0 ? `согласование ${site.approval} дн., потом стройка` : "стройка началась"}, ${site.left} дн.`;
}

const statusOf = (s, kind, id) => (kind === "n" ? nmuStatus(s) : kind === "c" ? projectStatus(s, id) : actStatus(s, selected, id));

// Начать меру. withLoan — «В кредит»: сначала самый маленький кредит, который покрывает нехватку, потом стройка.
function build(key, withLoan = false) {
  if (!playing()) return;
  const [kind, id] = key.split(":");
  const prev = state;
  let s = state, loan = null;
  if (withLoan) {
    loan = loanOffer(statusOf(s, kind, id));
    if (!loan) return;
    s = takeLoan(s, loan);
  }
  if (!statusOf(s, kind, id).ok) return;
  state = kind === "n" ? startNmu(s) : kind === "c" ? cityProject(s, id) : act(s, selected, id);
  if (loan) track(`loan/${loan}`);
  track(`build/${kind === "n" ? "nmu" : id}`);
  const spent = prev.budget - state.budget;
  if (spent) floatDelta(hud.money, `${spent > 0 ? "−" : "+"}${Math.abs(spent)}`, spent < 0);
  const where = kind === "d" ? selected : CITY_SITE[id];
  if (where && DISTRICTS.some(d => d.id === where)) flashOsmDistrict(osm, where);
  const text = buildText(kind, id, selected, state);
  const begun = state.building.length > s.building.length;
  const msg = loan ? `Взят кредит ${loan} млрд${begun ? " и начата стройка" : ""}: ${text}` : text;
  // после кредита «Отменить» вернёт и кредит: состояние до нажатия целиком
  showToast(msg, speed === 0 ? { prev, after: state, key, spent: loan ? 0 : spent } : null);
  coach.built();
  draw();
  saveNow();
  // кнопка ушла вместе со строкой: фокус — на следующую меру, которую можно начать, иначе на заголовок мер
  if (!panel.contains(document.activeElement)) (panel.querySelector(`[data-fid="b:${key}"]`) ?? panel.querySelector("[data-build]") ?? $("m-title"))?.focus({ preventScroll: true });
}

undoBtn.addEventListener("click", () => {
  if (!undo || undo.after !== state || !playing()) return;
  const { prev, key, spent } = undo;
  state = prev;
  feedQuiet = true;
  panelShown = null;
  if (spent) floatDelta(hud.money, `+${spent}`, true);
  showToast(spent ? `Отменено, ${spent} млрд вернулись` : "Отменено");
  draw();
  saveNow();
  panel.querySelector(`[data-fid="b:${key}"]`)?.focus({ preventScroll: true });
});

panel.addEventListener("click", e => {
  if (e.target.closest("[data-cancel]")) {
    if (playing()) { state = cancelSubsidy(state, selected); draw(); saveNow(); }
    return;
  }
  const to = e.target.closest("[data-goto]");
  if (to) { select(to.dataset.goto, "tab"); return; }
  const go = e.target.closest("[data-build]");
  if (go) { build(go.dataset.build); return; }
  const lg = e.target.closest("[data-loanbuild]");
  if (lg) { build(lg.dataset.loanbuild, true); return; }
  const main = e.target.closest(".mrow-main");
  if (main) toggleRow(main.closest(".mrow").dataset.key);
});
// группы «Откроются позже», «Готово», «О районе» помнят, раскрыты ли они (toggle не всплывает — ловим на погружении)
panel.addEventListener("toggle", e => {
  const g = e.target.dataset?.group;
  if (g) groupsOpen[g] = e.target.open;
}, true);
tabs.addEventListener("click", e => {
  const c = e.target.closest(".chip");
  if (c) select(c.dataset.tab, "tab");
});
// «К мерам»: к мерам выбранного района (на телефоне — раскрыть шторку). Какую начать, решает игрок.
$("h-idle-go").addEventListener("click", () => {
  if (isMobile()) setSheet(true);
  focusFirstMeasure();
});
document.querySelector(".speed").addEventListener("click", e => {
  const b = e.target.closest("[data-speed]");
  if (b && playing()) { setSpeed(Number(b.dataset.speed)); coach.speed(); }
});

dialog.addEventListener("click", e => {
  const opt = e.target.closest("[data-opt]");
  if (opt) {
    state = resolveEvent(state, Number(opt.dataset.opt));
    hideDialog();
    draw();
    saveNow();
    return;
  }
  const loan = e.target.closest("[data-loan]");
  if (loan) {
    if (dlg !== "loan" || !canPlay() || loan.disabled) return;
    const amount = Number(loan.dataset.loan);
    state = takeLoan(state, amount);
    track(`loan/${amount}`);
    hideDialog();
    floatDelta(hud.money, `+${amount}`, true);
    const l = state.loans.at(-1);
    showToast(`Взят кредит ${amount} млрд: −${num2(l.perDay)} в день ${SIM.loan.days} дн., переплата ${num1(l.left - amount)}`);
    draw();
    saveNow();
    return;
  }
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const a = b.dataset.act;
  if (a === "close-loan") { hideDialog(); draw(); }
  if (a === "ack") { hideDialog(); draw(); }
  if (a === "start") { track("start"); started = true; offered = null; storageRemove(store); hideDialog(); setSpeed(1); draw(); saveNow(); }
  if (a === "continue" && offered) { track("continue"); restoreGame(offered); showToast(`Партия продолжена: ${whenText(state)}. Время на паузе`); }
  if (a === "restart") newGame();
  if (a === "report") { state = ackReport(state); hideDialog(); draw(); }
  if (a === "decree") { track(`decree/year-${state.pendingDecree.year}`); state = acceptDecree(state); hideDialog(); draw(); }
  if (a === "forecast") { state = ackForecast(state); hideDialog(); draw(); }
  if (a === "retire") { state = retire(state); hideDialog(); draw(); }
  if (a === "report" || a === "decree" || a === "forecast" || a === "retire" || a === "ack") saveNow();
});

// Шторка: нажатие переключает, движение вверх/вниз по ручке — раскрывает/сворачивает.
let dragY = null;
let dragged = false;
sheetHandle.addEventListener("pointerdown", e => { dragY = e.clientY; dragged = false; });
sheetHandle.addEventListener("pointermove", e => { if (dragY !== null && Math.abs(e.clientY - dragY) > 24) dragged = true; });
sheetHandle.addEventListener("pointerup", e => { if (dragY !== null && dragged) setSheet(e.clientY < dragY); dragY = null; });
sheetHandle.addEventListener("pointercancel", () => { dragY = null; });
sheetHandle.addEventListener("click", () => {
  if (dragged) { dragged = false; return; }
  setSheet(!sheetOpen());
});

// Всплывашки HUD: клавиши и прогноз зимы. Одна открыта, клик мимо или Esc закрывает.
const pops = [[$("h-help"), $("hotkeys")], [hud.weather, hud.weatherPop]];
function togglePop(btn, pop, open = pop.hidden) {
  for (const [b, p] of pops) { p.hidden = true; b.setAttribute("aria-expanded", "false"); }
  pop.hidden = !open;
  btn.setAttribute("aria-expanded", String(open));
}
for (const [b, p] of pops) b.addEventListener("click", () => togglePop(b, p));
hud.money.addEventListener("click", openLoan);
// Кредит закрывается и кликом мимо окна; остальные окна — только выбором.
overlay.addEventListener("click", e => { if (e.target === overlay && dlg === "loan") { hideDialog(); draw(); } });
document.addEventListener("click", e => {
  for (const [b, p] of pops) if (!p.hidden && !b.contains(e.target) && !p.contains(e.target)) togglePop(b, p, false);
});

// Первые шаги: три подсказки до первой стройки и после неё. Только на эту сессию, «Скрыть» — насовсем.
const coachEl = $("coach");
const COACH = [
  { text: "1/3 · Выберите район: нажмите на него на карте или на вкладку с названием.", anchor: () => $("map"), inside: true },
  { text: "2/3 · Постройте меру: у каждой цена, срок и вклад в зиму; нажмите на строку, чтобы увидеть подробности.", anchor: () => panel.querySelector(".mrow.ready") ?? $("m-title"), side: true },
  { text: "3/3 · Время идёт само: ▶ и ▶▶ — скорость, пробел — пауза. На паузе только что начатую стройку можно отменить.", anchor: () => document.querySelector(".speed") },
];
const coach = {
  step: -1, off: false, target: null,
  show(i) {
    if (i >= COACH.length) { this.stop(); return; }
    this.step = i;
    put($("coach-text"), COACH[i].text);
    put($("coach-next"), i === COACH.length - 1 ? "Понятно" : "Далее");
  },
  stop() {
    this.off = true;
    coachEl.hidden = true;
    this.target?.classList.remove("coach-target");
    this.target = null;
  },
  selected() { if (this.step === 0) this.show(1); },
  built() { if (!this.off && this.step < 2) this.show(2); },
  speed() { if (this.step === 2) this.stop(); },
  frame() {
    if (this.off) return;
    if (!started || dlg || !overlay.hidden || state.ended) { coachEl.hidden = true; return; }
    if (this.step < 0) this.show(0);
    const el = COACH[this.step].anchor();
    if (this.target !== el) { this.target?.classList.remove("coach-target"); el?.classList.add("coach-target"); this.target = el; }
    if (!el) { coachEl.hidden = true; return; }
    coachEl.hidden = false;
    // где встать: внутри карты снизу, слева от строки меры (если есть место), иначе под целью или над ней
    const step = COACH[this.step];
    const r = el.getBoundingClientRect(), w = coachEl.offsetWidth, h = coachEl.offsetHeight;
    const floor = innerHeight - 8 - (isMobile() ? aside.getBoundingClientRect().height : 0);
    let top, left;
    if (step.inside) {
      top = Math.min(r.bottom, floor) - h - 12;
      left = r.left + 12;
    } else if (step.side && !isMobile() && r.left - w - 12 > 8) {
      top = r.top;
      left = r.left - w - 12;
    } else {
      top = r.bottom + 10;
      if (top + h > floor) top = r.top - h - 10;
      left = r.left + r.width / 2 - w / 2;
    }
    top = Math.max(8, Math.min(top, floor - h));
    left = Math.max(8, Math.min(left, innerWidth - w - 8));
    coachEl.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  },
};
$("coach-next").addEventListener("click", () => coach.show(coach.step + 1));
$("coach-skip").addEventListener("click", () => coach.stop());

function cycleTab(dir) {
  const i = TAB_IDS.indexOf(selected);
  select(TAB_IDS[(i + dir + TAB_IDS.length) % TAB_IDS.length], "key");
}

// Клавиши: пробел — пауза, 1/2 — скорость, Q/E — районы, B — к первой мере, ? — список клавиш, Esc — закрыть.
// Пока открыто окно, клавиши молчат: выйти из него можно только выбором. В полях ввода тоже.
document.addEventListener("keydown", e => {
  if (dlg === "loan" && e.key === "Escape") { e.preventDefault(); hideDialog(); draw(); return; }
  if (!overlay.hidden || !started || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest?.("input, textarea, select, [contenteditable]")) return;
  if (e.key === "Escape") {
    for (const [b, p] of pops) if (!p.hidden) togglePop(b, p, false);
    if (sheetOpen()) setSheet(false);
    return;
  }
  if (e.repeat) return;
  if (e.key === " ") {
    // на кнопках действий, вкладках и районах пробел нажимает их; на кнопках скорости — пауза
    if (!playing() || e.target.closest?.("button:not([data-speed]), [role=button], a, summary")) return;
    e.preventDefault();
    setSpeed(speed ? 0 : lastSpeed);
    coach.speed();
    return;
  }
  if (e.key === "?") { togglePop($("h-help"), $("hotkeys")); return; }
  const code = { Digit1: "x1", Numpad1: "x1", Digit2: "x3", Numpad2: "x3", KeyQ: "prev", KeyE: "next", KeyB: "build" }[e.code];
  if (!code) return;
  e.preventDefault();
  if (code === "x1" || code === "x3") { if (playing()) { setSpeed(code === "x1" ? 1 : 3); coach.speed(); } }
  else if (code === "prev" || code === "next") cycleTab(code === "prev" ? -1 : 1);
  else focusFirstMeasure();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (speed) setSpeed(0);
    saveNow();
  } else invalidate();
});
addEventListener("pagehide", saveNow);
// Любой ввод может что-то поменять в интерфейсе: будим цикл (на погружении — до обработчиков, кадр всё равно позже).
for (const t of ["pointerdown", "click", "keydown", "change", "toggle", "focusin"]) document.addEventListener(t, invalidate, true);
document.addEventListener("scroll", invalidate, { capture: true, passive: true });
addEventListener("resize", invalidate);

// Карта: контейнер уже имеет высоту из CSS. Размер следим сами, Leaflet видит только окно.
const mapEl = $("map");
const osm = createOsmMap(mapEl, { onSelect: id => { if (playing()) select(id, "map"); } });
const fx = createFx(osm);
osm.map.on("move zoomend resize viewreset", wake); // карту двигают — живой слой перерисует стоп-кадр
new ResizeObserver(() => resizeOsmMap(osm)).observe(mapEl);

// Высота HUD зависит от ширины и от тревоги; под неё подстраиваются карта и панель.
// --hud-peek: на телефоне при прокрутке верх HUD уезжает, а скорость, задача президента и шкала воздуха остаются.
new ResizeObserver(() => {
  const root = document.documentElement.style;
  root.setProperty("--hud-h", `${$("hud").offsetHeight}px`);
  // по прямоугольникам: offsetTop у прилипшего HUD включает прокрутку, и HUD уезжал за экран
  const peek = document.querySelector(".hud-date").getBoundingClientRect().top - $("hud").getBoundingClientRect().top - 6;
  root.setProperty("--hud-peek", `${Math.max(0, Math.round(peek))}px`);
  invalidate();
}).observe($("hud"));
for (const el of document.querySelectorAll("[data-icon]")) el.innerHTML = icon(el.dataset.icon);
initGauge();
tabs.innerHTML = tabsHtml();
// Старт страницы. Chrome («Экономия памяти») может выгрузить вкладку и загрузить её заново, игрок может нажать
// «Обновить»: тогда партия возвращается сама, на паузе. Просто зашли снова — вступление предлагает продолжить.
const saved = loadSave(store);
const navType = performance.getEntriesByType?.("navigation")?.[0]?.type ?? null;
const mode = restoreMode({ hasSave: !!saved, ended: !!saved?.state.ended, discarded: !!document.wasDiscarded, navType });
if (saved?.state.ended) storageRemove(store);
if (document.wasDiscarded) console.info(`[akim] Chrome выгрузил вкладку из памяти и загрузил её заново; партия ${saved ? "восстановлена" : "не сохранялась"}`);
let restored = false;
if (mode === "auto") {
  try {
    restoreGame(saved);
    showToast(`Партия восстановлена: ${whenText(state)}. Время на паузе`);
    restored = true;
  } catch (e) {
    // снимок прочитался, но играть по нему нельзя: начинаем заново, а снимок убираем
    console.warn("[akim] не удалось восстановить партию", e);
    storageRemove(store);
    state = newCity(Date.now() | 0);
    started = false;
    warningSeen = null;
    feedShown = null;
    panelShown = null;
    mapShown = null;
  }
}
if (!restored) {
  offered = mode === "continue" ? saved : null;
  showDialog("intro", intro(offered));
  draw();
}
wake();

// Для сценарных проверок в браузере; интерфейс этим не пользуется.
export const debug = {
  get state() { return state; },
  set state(s) { state = s; invalidate(); },
  redraw() { dlg = null; draw(); },
  loopStats,
  saveNow,
  // Дни на максимальной скорости до события, отчёта или финала.
  advance(days) {
    for (let i = 0; i < days && playing(); i++) { state = tick(state); checkWarning(); }
    draw();
    invalidate();
    return state;
  },
};
