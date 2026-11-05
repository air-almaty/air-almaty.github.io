// Город для градостроителя: 8 районов Алматы, соседство, ТЭЦ, стартовые значения. Границы на карте — districts.geo.js.
//
// Это упрощение. Числа — условные единицы, пропорции правдоподобные:
// - pop — население в десятках тысяч, приблизительно (порядок величин по citypopulation.de,
//   https://citypopulation.de/en/kazakhstan/admin/16__almaty/).
// - stoves — частный сектор на угле. Больше всего в Турксибском, Алатауском и Жетысуском
//   (ДЧС Алматы через Tengrinews: https://tengrinews.kz/article/nas-budut-shtrafovat-bednost-ne-s-zapretom-pechnogo-4091/).
//   Наурызбайский — много частных домов у предгорий, доля угля приблизительно.
//   Акимат пишет о газификации частного сектора 99,6% — но печи на угле всё равно топят; в игре это рычаг.
// - traffic — выше в центре (Алмалинский, Бостандыкский) и в крупном Ауэзовском.
// - Суммы зимних источников: печи 36, транспорт 28, ТЭЦ 37 — подобраны так, чтобы доли в зимнем AQI
//   были около 37/34/29, как в комментарии sim-balance.js (PMF, Baimatova et al., EGU 2026); проверяет test/city-balance.mjs.
//
// Расположение районов (север сверху), приблизительно:
//   Алатауский (СЗ)     Жетысуский (С)      Турксибский (СВ)
//   Ауэзовский (З)      Алмалинский (центр) Медеуский (В и ЮВ, горы)
//   Наурызбайский (ЮЗ)  Бостандыкский (Ю)
// Алатауский выделен из Ауэзовского к северу от пр. Рыскулова, Наурызбайский — на западной окраине
// у предгорий (https://en.wikipedia.org/wiki/Alatau_District, https://en.wikipedia.org/wiki/Nauryzbai_District).
// Медеуский — восток и юго-восток с горами (Медеу).
//
// neighbors: { n, s, w, e } — списки соседей в этом направлении: все 15 общих границ из полигонов OSM
// (districts.geo.js), направление — по преобладающей оси между центрами районов. Нет `s` у южных районов: там горы,
// смог туда не уходит. Нет соседа на других краях — смог уходит из города.

export const DISTRICTS = [
  {
    id: "alatau", name: "Алатауский", pop: 34, stoves: 9, traffic: 3,
    neighbors: { e: ["zhetysu"], s: ["auezov", "almaly", "nauryzbay"] },
  },
  {
    id: "zhetysu", name: "Жетысуский", pop: 19, stoves: 7, traffic: 3,
    neighbors: { w: ["alatau"], e: ["turksib"], s: ["almaly", "medeu"] },
  },
  {
    id: "turksib", name: "Турксибский", pop: 25, stoves: 10, traffic: 3,
    neighbors: { w: ["zhetysu"], s: ["medeu"] },
  },
  {
    id: "auezov", name: "Ауэзовский", pop: 42, stoves: 3, traffic: 4,
    neighbors: { n: ["alatau"], e: ["almaly"], s: ["nauryzbay", "bostandyk"] },
  },
  {
    id: "almaly", name: "Алмалинский", pop: 23, stoves: 1, traffic: 6,
    neighbors: { n: ["zhetysu", "alatau"], w: ["auezov"], e: ["medeu"], s: ["bostandyk"] },
  },
  {
    id: "medeu", name: "Медеуский", pop: 23, stoves: 2, traffic: 3,
    neighbors: { n: ["turksib", "zhetysu"], w: ["almaly", "bostandyk"] },
  },
  {
    id: "nauryzbay", name: "Наурызбайский", pop: 17, stoves: 3, traffic: 1,
    neighbors: { n: ["auezov", "alatau"], e: ["bostandyk"] },
  },
  {
    id: "bostandyk", name: "Бостандыкский", pop: 38, stoves: 1, traffic: 5,
    neighbors: { n: ["almaly", "auezov"], w: ["nauryzbay"], e: ["medeu"] },
  },
];

// ТЭЦ. emission — зимний выброс в день при mult = 1.
// - ТЭЦ-2: Алатауский район, северо-западная окраина; крупнейший теплоисточник (>60% зимней
//   тепловой нагрузки АлЭС), на угле, идёт перевод на газ
//   (https://tengrinews.kz/kazakhstan_news/glavnyi-zagriaznitel-vozduxa-cto-izvestno-o-tec-2-v-almaty-382856/,
//   https://bes.media/news/perevod-tets-2-na-prirodniy-gaz-sklyar-dal-porucheniya/).
// - ТЭЦ-1 им. Б. Оразбаева: в городе, Жетысуский район (уточнил автор игры), снабжает теплом центр;
//   переведена на газ в 2017 году, поэтому выброс мал
//   (https://kapital.kz/economic/91440/kak-gazifikatsiya-t-ets-1-povliyala-na-ekologiyu-almaty.html).
// - ТЭЦ-2 им. А. Жакутова: см. выше, крупнейшая станция энергокомплекса.
// - ТЭЦ-3: в Алматинской области, Илийский район, у посёлка Отеген Батыр. По словам министра экологии
//   влияет на Турксибский район (https://forbes.kz/news/newsid_227186); в игре привязана к нему как к
//   ближайшему району города. Топливо — уголь, приблизительно.
export const PLANTS = [
  { id: "tec2", name: "ТЭЦ-2", fullName: "ТЭЦ-2 им. А. Жакутова", district: "alatau", emission: 30 },
  { id: "tec1", name: "ТЭЦ-1", fullName: "ТЭЦ-1 им. Б. Оразбаева", district: "zhetysu", emission: 2 },
  { id: "tec3", name: "ТЭЦ-3", fullName: "ТЭЦ-3 (Илийский район, Отеген-Батыр)", district: "turksib", emission: 5 },
];
