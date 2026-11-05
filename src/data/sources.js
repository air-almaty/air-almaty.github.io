// Прямо на экране источников: что в игре условность, а что настоящее.
export const GAME_NOTE = "Деньги, время строек и сила построек здесь условность игры, как и отчёт президенту раз в 4 года. Настоящие: уровни смога, география Алматы и логика источников.";

// Источники для финального экрана. Каждая ссылка открыта и сверена с тем, что написано в note.
export const SOURCES = [
  {
    title: "Baimatova et al. — The Health and Economic Cost of PM2.5 in Kazakhstan (EGU 2026, тезисы)",
    url: "https://meetingorganizer.copernicus.org/EGU26/EGU26-1958.html",
    note: "Разложение PM2.5 методом PMF за 2022–2023 гг.: в Алматы электростанции дают 18%, отопление домов 16%, выхлопы 14%, «городской фон» 20%; котловина усиливает накопление смога.",
  },
  {
    title: "Kerimray et al. — Assessing air quality changes in large cities during COVID-19 lockdowns (Science of the Total Environment, 2020)",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC7198157",
    note: "Когда в карантин 2020 года машины почти исчезли, PM2.5 упал лишь на 21%, и норму ВОЗ всё равно превышали 18 дней из 27: главные источники — угольные ТЭЦ и печи частного сектора (авторы допускают, что сыграла роль и погода).",
  },
  {
    title: "Kerimray et al. — Spatiotemporal Variations and Contributing Factors of Air Pollutants in Almaty (Aerosol and Air Quality Research, 2020)",
    url: "https://nur.nu.edu.kz/items/41bbfd8f-82f0-4653-8bd7-ef0f703a8cfd",
    note: "Среднегодовой PM2.5 в 5,3 раза выше нормы ВОЗ, пик зимой из-за сжигания угля на ТЭЦ и в печах, а слабый ветер и, вероятно, температурные инверсии запирают дым в котловине.",
  },
  {
    title: "Tengrinews — PM identifies main source of air pollution in Almaty (2025)",
    url: "https://en.tengrinews.kz/kazakhstan_news/pm-identifies-main-source-of-air-pollution-in-almaty-266964",
    note: "По расчётам, приведённым премьер-министром, в выбросах города транспорт даёт 60%, предприятия 27,5%, частные дома и бани 11%; это доли выбросов, а не замеры частиц PM2.5.",
  },
  {
    title: "Primeminister.kz — Conversion of Almaty CHP-2 to gas to reduce pollutant emissions by 80% (2022)",
    url: "https://primeminister.kz/en/news/conversion-of-almaty-chp-2-to-gas-to-reduce-pollutant-emissions-by-80-by-2025-serikkali-brekeshev-3175218",
    note: "ТЭЦ-2 планируется перевести на газ; правительство обещает, что это сократит выбросы загрязняющих веществ на 80% к 2025 году.",
  },
  {
    title: "Almaty Air Initiative — Air quality report for Almaty: what we breathed in 2024",
    url: "https://air.org.kz/en/air-quality-report-for-almaty-what-we-breathed-in-2024/",
    note: "По датчикам Clarity: зимой (декабрь–февраль) 2024 года в среднем 49,9 µg/m³ PM2.5, летом 11,5; худшие дни — 6 февраля (114), 25 и 26 декабря (106 и 102). По этим замерам настроены уровни PM2.5 в игре.",
  },
  {
    title: "Almaty Air Initiative — 26 пачек сигарет в год: отчёт о качестве воздуха в Алматы за 2025 год (28 января 2026)",
    url: "https://air.org.kz/en/26-packs-of-cigarettes-a-year-unintentionally-almaty-air-initiative-publishes-an-air-quality-report-on-almaty-for-2025/",
    note: "По данным фонда: среднегодовой PM2.5 в 2025 году — 31,2 µg/m³, в шесть раз выше рекомендации ВОЗ и почти на 30% хуже 2024 года; в декабре в среднем 62,4; самый грязный день — 7 декабря, 145.",
  },
  {
    title: "Almaty Air Initiative — обзор отчёта IQAir за 2025 год",
    url: "https://air.org.kz/en/kazakhstan-ranks-27th-in-the-world-for-air-pollution-where-does-almaty-stand-almaty-air-initiative-reviewed-the-2025-iqair-report/",
    note: "По IQAir среднегодовой PM2.5 в Алматы: 20,3 µg/m³ в 2024 году и 22,8 в 2025-м. Цифры IQAir и датчиков фонда расходятся; в обзоре причина не объясняется.",
  },
  {
    title: "BES.media — Алматы занял второе место в мире по загрязнению воздуха (17 сентября 2025)",
    url: "https://bes.media/news/almati-zanyal-vtoroe-mesto-v-mire-po-zagryazneniyu-vozduha-cfbbad/",
    note: "Издание пишет со ссылкой на IQAir: средний PM2.5 в Алматы в 2024 году — 20,3 µg/m³, это примерно вчетверо выше годового ориентира ВОЗ (5 µg/m³).",
  },
  {
    title: "IQAir — качество воздуха в Алматы",
    url: "https://www.iqair.com/ru/air-quality/kazakhstan/almaty-oblysy/almaty",
    note: "Текущие US AQI и концентрация PM2.5 в городе и сравнение с рекомендованным ВОЗ среднегодовым значением; значения на странице меняются в реальном времени.",
  },
  {
    title: "Open-Meteo — Air Quality API",
    url: "https://open-meteo.com/en/docs/air-quality-api",
    note: "Прогноз на основе моделей CAMS, глобальные данные с августа 2022 года. По выгрузке PM2.5 для Алматы за 2022–2026 годы в игре взят сезонный ход: максимум в январе, минимум летом; уровни взяты с наземных датчиков.",
  },
  {
    title: "Tengrinews — Опубликован текст новой Конституции Казахстана (18 марта 2026)",
    url: "https://tengrinews.kz/kazakhstan_news/opublikovan-tekst-novoy-konstitutsii-kazahstana-595079/",
    note: "Статья 89: акимы городов республиканского значения назначаются Президентом с согласия депутатов маслихата; Президент предлагает не менее двух кандидатур и вправе освобождать акимов по своему усмотрению. Фиксированный срок не назван; полномочия прекращаются при вступлении в должность вновь избранного Президента.",
  },
  {
    title: "Tengrinews — «Нас будут штрафовать за бедность». Что не так с запретом печного отопления в Алматы (12 июня 2026)",
    url: "https://tengrinews.kz/article/nas-budut-shtrafovat-bednost-ne-s-zapretom-pechnogo-4091/",
    note: "С 30 декабря 2026 года в газифицированных районах запрещены уголь, дрова, мазут и солярка; исключение — чрезвычайные ситуации. Жители говорят о цене перехода: котёл от 400 тысяч тенге, установка более миллиона, кредиты пенсионерам не дают.",
  },
  {
    title: "NUR.KZ — Как будут штрафовать за топку углем в Алматы (11 сентября 2026)",
    url: "https://www.nur.kz/nurfin/fines-and-taxes/2426142-kak-budut-shtrafovat-za-topku-uglem-v-almaty/",
    note: "Физлицам — предупреждение или штраф 10 МРП (43 250 тенге в 2026 году), статья 324 КоАП. Сначала запрет вводится в пилотном режиме в ограниченной зоне.",
  },
  {
    title: "Finratings — Частный сектор Алматы ждут новые правила: за привычное отопление штраф (11 февраля 2026)",
    url: "https://finratings.kz/news/11624-chastnyi-sektor-almaty-zhdut-novye-pravila-za-privychnoe-otoplenie-shtraf/",
    note: "По данным акимата, уровень газификации частного сектора Алматы достиг 99,6%. Запрет касается частных домов, бань и отдельных котельных с доступом к газу.",
  },
  {
    title: "Tengrinews — Алматинцы продолжают жечь уголь и резину для растопки домов и бань - Департамент экологии (17 января 2023)",
    url: "https://tengrinews.kz/kazakhstan_news/almatintsyi-prodoljayut-jech-ugol-rezinu-rastopki-domov-ban-488773/",
    note: "Управление экологии города сообщает, что твёрдым топливом, в том числе пластмассой и резиной, топят по всему городу, хотя по данным акимата газифицировано 99 процентов частного сектора.",
  },
];
