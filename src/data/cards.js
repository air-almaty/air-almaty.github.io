// Каждый вариант меняет выбросы (tec, stoves или traffic), хотя бы чуть-чуть: игра про воздух.
// why — понятная связь с воздухом там, где на поверхности её не видно.
export const CARDS = [
  // Разовое событие первой зимы (SIM.banEventCard), не из общей колоды. Текст — по решению маслихата Алматы:
  // твёрдое топливо запрещено там, где есть доступ к газу; физлицам предупреждение или 10 МРП (см. sources.js).
  {
    id: "solid-fuel-ban", who: "Помощник акима", when: { scripted: true },
    text: "Маслихат запретил топить углём и дровами там, где есть доступ к газу. Физлицу грозит предупреждение или штраф 10 МРП. Как будем применять?",
    options: [
      { label: "Строго штрафовать", effects: { stoves: -12, rating: -6, budget: 3 } },
      { label: "Мягкий переход", effects: { stoves: 1, budget: -8, rating: 1 }, why: "Пока идёт переход, многие топят как топили" },
    ],
  },
  {
    id: "tec-tariff", who: "Директор ТЭЦ", when: { season: "autumn", notDone: "tec-gas" },
    text: "Газ подорожал. Либо тариф вверх, либо топим углём ещё сезон.",
    options: [
      { label: "Поднять тариф", effects: { rating: -8, tec: -2 } },
      { label: "Пусть топят углём", effects: { budget: 5, tec: 4 } },
    ],
  },
  {
    id: "grandma-coal", who: "Бабушка из частного сектора", when: { season: "winter", notDone: "stove-gas" },
    text: "Уголь подорожал. Газ у забора, а котёл и трубы мне не по карману. Чем топить, мебелью?",
    options: [
      { label: "Раздать уголь бесплатно", effects: { budget: -20, rating: 7, stoves: 3 } },
      { label: "Копите на котёл", effects: { stoves: 1, rating: -6 }, why: "Пока копят, топят чем есть" },
    ],
  },
  {
    id: "blogger-mask", who: "Блогер", when: { season: "winter" },
    text: "Снял видео в противогазе на Аль-Фараби — два миллиона просмотров. Комментарий будет?",
    options: [
      { label: "Признать проблему", effects: { stoves: -1, rating: 3, budget: -2 }, why: "Люди начинают следить за своими печами" },
      { label: "Это просто туман", effects: { stoves: 1, rating: -7 }, why: "Раз смога нет, зачем менять печь" },
    ],
  },
  {
    id: "taxi-ban", who: "Таксист",
    text: "Говорят, старые машины в центр пускать не будут. Моя Камри 2003 года — член семьи!",
    options: [
      { label: "Ввести экокласс", effects: { traffic: -3, rating: -7 } },
      { label: "Пусть ездит", effects: { traffic: 1, rating: 3 } },
    ],
  },
  {
    id: "minister-coal", who: "Советник из угольной компании", when: { minTurn: 2, notDone: "tec-gas" },
    text: "Уголь у нас свой, газ — импортный. Топить углём патриотичнее.",
    options: [
      { label: "Настоять на газе", effects: { budget: -5, tec: -2 } },
      { label: "Согласиться", effects: { budget: 10, tec: 3 } },
    ],
  },
  {
    id: "bao-snow", who: "Коммунальщик", when: { season: "winter" },
    text: "На БАО снег, чистить нечем. Водители стоят в пробке с работающими моторами.",
    options: [
      { label: "Купить технику", effects: { budget: -14, traffic: -2, rating: 3 } },
      { label: "Само растает", effects: { traffic: 2, rating: -4 } },
    ],
  },
  {
    id: "summer-cut", who: "Советник", when: { season: "summer" },
    text: "Воздух чистый, все на Медеу. Может, урежем экологический бюджет?",
    options: [
      { label: "Урезать", effects: { budget: 10, stoves: 2 } },
      { label: "Нет, зима близко", effects: { stoves: -1, rating: -2 }, why: "Деньги остались на замену печей" },
    ],
  },
  {
    id: "developer-park", who: "Застройщик", when: { season: "spring" },
    text: "Предлагаю на месте сквера ЖК «Чистый воздух». Название уже экологичное!",
    options: [
      { label: "Продать сквер", effects: { budget: 15, rating: -6, traffic: 3 } },
      { label: "Оставить сквер", effects: { traffic: -1, rating: 3 }, why: "Нет нового ЖК, нет и новых машин" },
    ],
  },
  {
    id: "parents-school", who: "Родительский чат", when: { season: "autumn" },
    text: "Детям нельзя гулять. Требуем очистители воздуха в каждую школу!",
    options: [
      { label: "Купить очистители", effects: { traffic: 1, budget: -12, rating: 6 }, why: "Деньги ушли на очистители, на чистку дорог не хватило" },
      { label: "Пусть проветривают", effects: { traffic: -1, rating: -5 }, why: "Деньги остались на чистку дорог" },
    ],
  },
  {
    id: "trash-burning", who: "Участковый", when: { season: "winter", minTurn: 3 },
    text: "Ловим тех, кто жжёт в печках покрышки и мусор. Штрафовать?",
    options: [
      { label: "Штрафовать", effects: { stoves: -2, rating: -4 } },
      { label: "Не трогать людей", effects: { stoves: 1, rating: 1 } },
    ],
  },
  {
    id: "tec-sneaky-coal", who: "Директор ТЭЦ", when: { done: "tec-gas", season: "winter" },
    text: "Газ дорогой. Давайте зимой немножко подтапливать углём, никто не заметит.",
    options: [
      { label: "Запретить", effects: { tec: -1, budget: -6 } },
      { label: "Немножко можно", effects: { tec: 6, budget: 6 } },
    ],
  },
  {
    id: "car-free-day", who: "Активисты", when: { season: "spring" },
    text: "Давайте раз в месяц закрывать проспект Абая для машин!",
    options: [
      { label: "Поддержать", effects: { budget: -3, traffic: -1, rating: 2 } },
      { label: "Отказать", effects: { traffic: 1, rating: -2 } },
    ],
  },
  {
    id: "bus-lane", who: "Водитель автобуса", when: { done: "buses" },
    text: "Выделенку занимают частники. Камеры поставим?",
    options: [
      { label: "Поставить камеры", effects: { budget: -5, traffic: -2, rating: -3 } },
      { label: "Не надо", effects: { traffic: 1 }, why: "Автобусы стоят в пробке, люди пересаживаются на машины" },
    ],
  },
  {
    id: "tourism-ad", who: "Туроператор", when: { season: "summer" },
    text: "Туристы фотографируют горы. Запустим кампанию «Алматы — чистый воздух»?",
    options: [
      { label: "Запустить", effects: { traffic: 1, budget: 8, rating: -1 }, why: "Туристы едут на машинах" },
      { label: "Скромно промолчать", effects: { traffic: -1 }, why: "Меньше туристов на машинах" },
    ],
  },
  {
    id: "metro-opened", who: "Горожанин", when: { done: "metro" },
    text: "Новая ветка открылась! Думаю продать машину.",
    options: [
      { label: "Скидка на проездной", effects: { budget: -10, traffic: -3, rating: 4 } },
      { label: "Поздравить и всё", effects: { traffic: -1 } },
    ],
  },
  // --- погода и география ---
  {
    id: "inversion", who: "Синоптик", when: { season: "winter" },
    text: "Инверсия: тёплый воздух накрыл котловину крышкой, смог никуда не уходит. Ветра не будет неделю.",
    options: [
      { label: "Ограничить въезд", effects: { traffic: -1, rating: -3 } },
      { label: "Ждать ветра", effects: { traffic: 1, rating: -1 }, why: "Никто ничего не ограничил, пробки стоят под инверсией" },
    ],
  },
  {
    id: "air-corridor", who: "Застройщик", when: { season: "spring", minTurn: 4 },
    text: "Хотим тридцать этажей в предгорьях. Горный ветер всё равно дует куда попало.",
    options: [
      { label: "Согласовать", effects: { budget: 12, rating: -2, stoves: 1, traffic: 2 } },
      { label: "Беречь продуваемость", effects: { traffic: -1, rating: 1 }, why: "Нет новых домов, нет и новых машин" },
    ],
  },
  {
    id: "shymbulak", who: "Горнолыжник", when: { season: "winter" },
    text: "На Шымбулаке солнце и минус пять, а внизу серая каша. Расширим парковку у канатки?",
    options: [
      { label: "Расширить парковку", effects: { budget: 6, traffic: 2 } },
      { label: "Шаттлы из города", effects: { budget: -10, traffic: -1, rating: 2 } },
    ],
  },
  {
    id: "medeu-jam", who: "Инспектор дорожной полиции", when: { season: "summer" },
    text: "Каждые выходные к Медеу стоит тысяча машин с работающими моторами. Едут подышать горным воздухом.",
    options: [
      { label: "Только шаттлы", effects: { budget: -6, traffic: -1, rating: -2 } },
      { label: "Пусть дышат", effects: { traffic: 2, rating: 2 } },
    ],
  },
  // --- транспорт ---
  {
    id: "marshrutka", who: "Водитель маршрутки",
    text: "На Аль-Фараби встали все полосы, едем по обочине. Конкуренты подрезают, план горит!",
    options: [
      { label: "Укрупнить маршруты", effects: { traffic: -1, rating: -3 } },
      { label: "Пусть возят", effects: { traffic: 2, rating: 2 } },
    ],
  },
  {
    id: "couriers", who: "Курьер", when: { minTurn: 5 },
    text: "Нас тысячи на старых мопедах, и все спешат. Дайте электроскутеры в рассрочку!",
    options: [
      { label: "Субсидировать электро", effects: { budget: -14, traffic: -1, rating: 2 } },
      { label: "Крутите педали", effects: { traffic: 1, rating: -1 }, why: "Старые мопеды остаются на дорогах" },
    ],
  },
  {
    id: "paid-parking", who: "Оператор парковок", when: { minTurn: 6 },
    text: "Предлагаем расширить платную зону парковки за пределы центра. Деньги городу, машин меньше, водители в ярости.",
    options: [
      { label: "Расширить платную зону", effects: { budget: 10, traffic: -1, rating: -4 } },
      { label: "Парковка — святое", effects: { traffic: 2, rating: 3 } },
    ],
  },
  {
    id: "cold-snap", who: "Энергетик", when: { season: "winter", minTurn: 4 },
    text: "Мороз минус двадцать пять. Либо ТЭЦ на полную, либо отключения — и весь частный сектор затопит печки.",
    options: [
      { label: "ТЭЦ на полную", effects: { tec: 2, budget: -5 } },
      { label: "Веерные отключения", effects: { stoves: 2, rating: -5 } },
    ],
  },
  // --- топливо и печи ---
  {
    id: "coal-supplier", who: "Поставщик угля", when: { season: "autumn", notDone: "stove-gas" },
    text: "Есть уголь вдвое дешевле. Горит чёрным, но зато горит!",
    options: [
      { label: "Взять дешёвый", effects: { budget: 8, stoves: 3 } },
      { label: "Только сортовой", effects: { stoves: -1, budget: -6 } },
    ],
  },
  {
    id: "leaf-burning", who: "Дворник", when: { season: "autumn" },
    text: "Листья во дворах жжём, как всегда. Или вывозить будем, за деньги?",
    options: [
      { label: "Вывозить листья", effects: { stoves: -1, budget: -6 } },
      { label: "Жгите, красиво", effects: { stoves: 2, rating: 1 } },
    ],
  },
  {
    id: "shashlik", who: "Владелец кафе", when: { season: "summer" },
    text: "Мангалы дымят на весь Кок-Тобе. Но без шашлыка туристы не едут.",
    options: [
      { label: "Требовать фильтры", effects: { stoves: -1, rating: -3 } },
      { label: "Шашлык — святое", effects: { stoves: 1, rating: 3 } },
    ],
  },
  // --- деньги и политика ---
  {
    id: "republic-budget", who: "Чиновник из министерства", when: { minTurn: 10 },
    text: "Республика даст денег на экологию, если город вложит столько же. Решайте до пятницы.",
    options: [
      { label: "Софинансировать", effects: { budget: -20, tec: -1, stoves: -1, rating: 2 } },
      { label: "Не потянем", effects: { stoves: 1, rating: -2 }, why: "Программа замены печей откладывается" },
    ],
  },
  {
    id: "neighbor-power", who: "Соседняя область", when: { season: "autumn", notDone: "tec-gas" },
    text: "У нас дефицит, продайте электричество. ТЭЦ-2 придётся топить на полную.",
    options: [
      { label: "Продать", effects: { budget: 8, tec: 3 } },
      { label: "Самим мало", effects: { tec: -1, rating: -2 } },
    ],
  },
  {
    id: "maslikhat", who: "Помощник депутата", when: { minTurn: 12 },
    text: "Скоро выборы в маслихат. Давайте до весны не трогать печки и тарифы, а лучше раздадим подарки.",
    options: [
      { label: "Подарки и тишина", effects: { budget: -15, rating: 8, stoves: 2, tec: 1 } },
      { label: "Реформы важнее", effects: { stoves: -1, rating: -3 } },
    ],
  },
  {
    id: "cheap-purifiers", who: "Поставщик очистителей",
    text: "Очистители оптом, со скидкой для акимата! Фильтр внутри, честно говоря, из салфеток, зато коробка красивая.",
    options: [
      { label: "Не брать", effects: { traffic: -1, rating: -2 }, why: "Деньги остались на чистку дорог" },
      { label: "Закупить партию", effects: { traffic: 1, budget: -30, rating: 8 }, why: "Деньги ушли на салфетки, а не на дороги" },
    ],
  },
  // --- данные и общество ---
  {
    id: "eco-sensors", who: "Экологи-волонтёры", when: { season: "summer" },
    text: "За лето расставили по городу двести датчиков. Цифры выше официальных — город поможет?",
    options: [
      { label: "Купить ещё датчиков", effects: { stoves: -1, budget: -10, rating: 3 }, why: "Датчики показывают, где дымят" },
      { label: "Датчики врут", effects: { stoves: 1, rating: -3 }, why: "Раз датчики врут, штрафовать не за что" },
    ],
  },
  {
    id: "smog-app", who: "IT-стартап", when: { minTurn: 8 },
    text: "Сделали приложение: карта смога и кто дымит. Встроим в городской портал?",
    options: [
      { label: "Встроить", effects: { budget: -6, tec: -1, rating: -1 } },
      { label: "Не нагнетать", effects: { tec: 1, rating: 1 } },
    ],
  },
  {
    id: "school-holidays", who: "Директор школы", when: { season: "autumn", minTurn: 6 },
    text: "Отопление включили — и город снова в дымке, дети кашляют на линейке. Объявить внеплановые каникулы?",
    options: [
      { label: "Каникулы", effects: { traffic: -1, rating: -2, budget: -8 }, why: "Меньше машин у школ" },
      { label: "Учиться в масках", effects: { traffic: 1, rating: -5 }, why: "Родители везут детей на машинах, а не пешком" },
    ],
  },
  {
    id: "heat-tariff", who: "Энергосбыт", when: { season: "autumn", minTurn: 8 },
    text: "Тариф на тепло не менялся годами, котлы ТЭЦ латают на честном слове. Поднимем на модернизацию?",
    options: [
      { label: "Поднять тариф", effects: { rating: -5, tec: -1 } },
      { label: "Заморозить тариф", effects: { rating: 3, tec: 1 } },
    ],
  },
  {
    id: "carsharing", who: "Стартап каршеринга", when: { minTurn: 8 },
    text: "Хотим запустить тысячу машин поминутно. Одна заменяет пять личных — или становится шестой.",
    options: [
      { label: "Дать парковки", effects: { budget: -6, traffic: -1 } },
      { label: "Не сейчас", effects: { traffic: 1, rating: -1 } },
    ],
  },
  {
    id: "dacha-burning", who: "Дачник", when: { season: "summer", minTurn: 9 },
    text: "На дачах под городом жгут сухую траву и мусор, дым тянет прямо в город. Традиция!",
    options: [
      { label: "Штрафовать", effects: { stoves: -1, rating: -2 } },
      { label: "Дача — святое", effects: { stoves: 2, rating: 2 } },
    ],
  },
  // --- последствия проектов ---
  {
    id: "tec-gas-bills", who: "Сосед ТЭЦ-2", when: { done: "tec-gas" },
    text: "Над ТЭЦ впервые нет чёрного шлейфа. А почему счета за тепло выросли?",
    options: [
      { label: "Газ стоит денег", effects: { tec: -1, rating: -4 }, why: "Тариф покрывает работу станции на газе" },
      { label: "Дотировать тариф", effects: { tec: 1, budget: -20, rating: 6 }, why: "Дотация съела деньги на обслуживание станции" },
    ],
  },
  {
    id: "ebus-frost", who: "Водитель электробуса", when: { done: "buses", season: "winter" },
    text: "На морозе батареи садятся к обеду. Нужны ещё зарядки.",
    options: [
      { label: "Построить зарядки", effects: { traffic: -1, budget: -15, rating: 2 } },
      { label: "Вернуть дизели", effects: { traffic: 3, budget: 4 } },
    ],
  },
  {
    id: "metro-extend", who: "Метростроевец", when: { done: "metro" },
    text: "Ветку открыли, все довольны. Продлеваем до окраин, пока бригада не разъехалась?",
    options: [
      { label: "Продлить", effects: { budget: -30, traffic: -2, rating: 3 } },
      { label: "Хватит пока", effects: { traffic: 1, rating: -2 }, why: "Окраины остаются на машинах" },
    ],
  },
  {
    id: "gas-but-coal", who: "Газовик", when: { done: "stove-gas" },
    text: "Газ подвели, а многие на улице топят углём: котёл и установка не всем по карману.",
    options: [
      { label: "Помочь с котлами", effects: { budget: -10, stoves: -1 } },
      { label: "Их выбор", effects: { stoves: 2, rating: 1 } },
    ],
  },
  {
    id: "fireplaces", who: "Риелтор", when: { done: "stove-gas" },
    text: "С газом частный сектор подорожал, строят особняки с каминами. Камин — это статус!",
    options: [
      { label: "Запретить камины", effects: { stoves: -1, rating: -3 } },
      { label: "Камин — это уют", effects: { stoves: 2, budget: 5 } },
    ],
  },
  {
    id: "briquette-resale", who: "Участковый", when: { done: "stove-subsidy" },
    text: "Субсидированные брикеты перепродают соседям, а дома топят старым углём.",
    options: [
      { label: "Усилить контроль", effects: { budget: -5, stoves: -1, rating: -1 } },
      { label: "Махнуть рукой", effects: { stoves: 2 } },
    ],
  },
  {
    id: "subsidy-queue", who: "Бабушка из частного сектора", when: { done: "stove-subsidy" },
    text: "Брикеты хорошие, но очередь за субсидией с ночи. Ещё раз выделите?",
    options: [
      { label: "Продлить субсидию", effects: { budget: -12, stoves: -1, rating: 3 } },
      { label: "Хватит", effects: { stoves: 1, rating: -3 }, why: "Кто не получил брикеты, топит старым углём" },
    ],
  },
];

export const REACTIONS = {
  clean: ["Видно горы! Все фотографируют горы.", "Бабушки вышли на лавочки.", "Курьер снял маску впервые за год.", "Горы вернулись в сторис."],
  meh: ["Горы видно через раз.", "Чат дома спорит, туман это или нет.", "Кто-то купил второй очиститель.", "На Шымбулаке солнце, в городе — версии."],
  smog: ["Кок-Тобе исчез. Туристы требуют деньги назад.", "Аптеки продали все маски.", "Птицы ходят пешком.", "Навигатор строит маршрут на ощупь."],
};
