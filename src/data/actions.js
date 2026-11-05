import { SIM } from "./sim-balance.js";

// Действия игрока. cost — из бюджета при запуске, days — срок стройки (0 — сразу),
// upkeep — расход в день после завершения.
// requires — путь мер: что должно быть готово, чтобы мера открылась (без requires — открыта с начала).
//   [{ action, count = 1, where: "any" | "same", label? }]: action — id действия района или городского проекта;
//   where "any" — готово в стольких районах, "same" — готово в этом же районе; у проекта — просто готов.
//   label — подпись для count > 1 («2 автобусных маршрута»). Указ года может открыть меру раньше (SIM.decree.years[].grants).
// Эффект района: stoves/traffic — множитель, mood — прибавка настроения района,
// parkDaily — множитель смога района каждый день, ramp — за сколько дней набирается эффект на печи.
// sideEffect — побочная причина для карточки: игрок видит её до решения.
// Что срабатывает в симуляции сверх effect (числа — здесь же, тексты строятся из них):
//   adoption [от, до] — доля домов, которые перейдут: печи × 1 − (1 − effect.stoves) × доля;
//   backfire { days, share } — через days дней вернётся доля share от снижения печей;
//   spill — доля снижения трафика, которая уходит к соседним районам;
//   repeat, costGrowth — можно повторять, цена × costGrowth за каждый раз в этом районе;
//   truce — действие снимает забастовку;
//   approval [от, до] — дней ожидания до начала стройки;
//   works { traffic?, moodPerDay } — пока строится: множитель трафика и потеря настроения в день
//     (в районах линии, если есть effect.districts, иначе во всём городе);
//   subsidy — держится на постоянных расходах, отмена возвращает печи (cancelSubsidy), cancelMood — удар по настроению;
//   sites — районы проекта: забастовка в любом из них останавливает стройку;
//   synergy { with, text, … } — «умное решение»: вместе с with в том же районе действие сильнее (текст — на карточке):
//     adoption — доля перешедших домов вместо случайной; stoves/traffic — множитель вместо effect;
//     spill — доля, уезжающая к соседям. with — id действия в районе или "metro" (район на готовой линии метро).
//     У городского проекта synergy действует в районах effect.districts, где уже есть with.
const backfire = { days: [30, 60], share: [0.3, 0.5] };
const approval = [90, 180];

export const DISTRICT_ACTIONS = [
  {
    id: "gas", name: "Замена котлов на газ", cost: 120, days: 150, upkeep: 0, requires: [{ action: "boiler", where: "any" }], adoption: [0.75, 0.95],
    effect: { stoves: 0.41, mood: -6, ramp: SIM.rampDays },
    sideEffect: "Газ в районе есть, а на котёл и трубы денег не у всех: перейдут не все дома, настроение упадёт из-за счетов. Когда газ дорожает, часть домов вернётся на уголь.",
  },
  {
    id: "boiler", name: "Котельная", cost: 45, days: 75, upkeep: 0.11, effect: { stoves: 0.76, mood: 1 },
    sideEffect: "Закрывает только часть домов: остальные топят углём.",
  },
  {
    id: "bus", name: "Автобусный маршрут", cost: 35, days: 20, upkeep: 0.13, effect: { traffic: 0.88, mood: 3 },
    synergy: { with: "metro", traffic: 0.8, text: "На линии готового метро: автобусы подвозят к станциям, машин −20% вместо −12%" },
    sideEffect: "Часть эффекта съест рост города: машин с каждым годом больше.",
  },
  {
    id: "park", name: "Парк", cost: 30, days: 30, upkeep: 0.11, effect: { parkDaily: 0.985, mood: 3 },
    sideEffect: "Источник смога никуда не денется: парк только немного чистит воздух района.",
  },
  {
    id: "parking", name: "Платная парковка", requires: [{ action: "bus", where: "any" }], cost: 0, days: 0, upkeep: 0, spill: 0.5, effect: { traffic: 0.8, mood: -7 },
    synergy: { with: "bus", spill: 0, text: "Если в районе уже ходит автобус: люди пересаживаются, к соседям машины не уезжают" },
    sideEffect: "Машины уйдут к соседям: там трафик вырастет на часть снижения.",
  },
  {
    id: "coalban", name: "Штрафы за уголь", requires: [{ action: "gas", where: "any" }], cost: 0, days: 0, upkeep: 0, backfire, effect: { stoves: 0.7, mood: -18 },
    sideEffect: `Настроение упадёт сразу. Кому котёл не по карману, начнут прятаться и жечь мусор: через ${backfire.days[0]}–${backfire.days[1]} дней часть выбросов вернётся.`,
  },
  // Субсидия постоянная, пока её не отменят (cancelSubsidy): печи вернутся, район обидится.
  {
    id: "gas-subsidy", name: "Субсидия на газ", requires: [{ action: "gas", where: "same" }], cost: 20, days: 0, upkeep: 0.12, subsidy: true, cancelMood: -6,
    effect: { stoves: 0.72, mood: 3 },
    synergy: { with: "gas", stoves: 0.6, text: "После замены котлов в районе: печей −40% вместо −28%, угольное лобби не мешает" },
    sideEffect: "Большие расходы каждый день. Дома с котлами не вернутся на уголь, когда газ подорожает. Отмените, и печи вернутся.",
  },
  {
    id: "listen", name: "Выслушать людей", cost: 8, days: 0, upkeep: 0, repeat: true, costGrowth: 1.6, truce: true, effect: { stoves: 1.02, mood: 8 },
    sideEffect: "Успокаивает район, но причину не убирает. Уступка ослабляет контроль: часть печей возвращается. Каждый следующий раз в этом районе дороже.",
  },
];

// Городские проекты. plants — множители выброса ТЭЦ; traffic + districts — множитель трафика по линии;
// mood — прибавка настроения всем районам.
export const CITY_PROJECTS = [
  // «Перевод ТЭЦ-2 на газ позволит снизить выбросы в 17 раз» (Сагинтаев, informburo.kz) — в игре ×0.15
  {
    id: "tec2gas", name: "ТЭЦ-2 на газ", requires: [{ action: "filters" }], cost: 340, days: 450, upkeep: 0, approval, // без sites: станцию переводят энергетики, забастовка жителей Алатауского её не останавливает
    works: { moodPerDay: 0.012 }, effect: { plants: { tec2: 0.15 }, mood: 3 },
    sideEffect: `Решение не только за акимом: сначала согласование с республикой, ${approval[0]}–${approval[1]} дней ожидания. Пока идут работы, настроение города падает.`,
  },
  {
    id: "filters", name: "Фильтры на ТЭЦ", cost: 180, days: 120, upkeep: 0.14, sites: ["alatau"], effect: { plants: { tec2: 0.75, tec3: 0.75 } },
    sideEffect: "Содержание дорогое: бюджет платит за фильтры каждый день.",
  },
  // Первая линия метро идёт через Алмалинский, Бостандыкский и Ауэзовский районы
  {
    id: "metro", name: "Ветка метро", requires: [{ action: "bus", count: 2, where: "any", label: "2 автобусных маршрута" }], cost: 320, days: 360, upkeep: 0.08, sites: ["almaly", "bostandyk", "auezov"],
    works: { traffic: 1.15, moodPerDay: 0.02 }, effect: { traffic: 0.75, districts: ["almaly", "bostandyk", "auezov"], mood: 2 },
    synergy: { with: "bus", traffic: 0.9, text: "Где на линии уже ходят автобусы, они подвозят к станциям: там машин ещё −10%" },
    sideEffect: "Пока строится, дороги перекопаны: на линии трафик вырастет, настроение упадёт.",
  },
];
