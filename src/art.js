// Иллюстрации окон: рисованные вручную inline-SVG, без внешних картинок.
// Президент здесь — должность, а не человек: силуэт со спины, без лица и примет.
// Печать указа — стилизация (шанырак с уыками на голубом круге), не государственный герб.
// Флаг Казахстана — готовый рисунок из src/assets/flag-kz.svg, в кабинете с лёгкими складками.
// Модуль чистый: строки без DOM, работает и в node.

let seq = 0;
const uid = p => `art-${p}-${++seq}`;

const SKY = "#00ABC2"; // цвет поля из файла флага
const GOLD = "#FEC50C";
const FLAG_GOLD = "#FFEC2D";
const FLAG_SRC = "src/assets/flag-kz.svg"; // путь от index.html

// Флаг в локальных координатах 100×50, чуть колышется; складки лёгкие, чтобы не приглушать цвет поля.
function flag(transform) {
  const clip = uid("flag"), folds = uid("folds");
  const outline = "M0 0C22-2 46 2.5 70 .5 82-.6 92 .2 100 1L100 51C92 50.2 82 49.4 70 50.5 46 52.5 22 48 0 50Z";
  return `<g transform="${transform}">
    <defs><clipPath id="${clip}"><path d="${outline}"/></clipPath>
      <linearGradient id="${folds}" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stop-color="#000" stop-opacity=".05"/><stop offset=".25" stop-color="#fff" stop-opacity=".07"/>
        <stop offset=".5" stop-color="#000" stop-opacity=".06"/><stop offset=".75" stop-color="#fff" stop-opacity=".06"/>
        <stop offset="1" stop-color="#000" stop-opacity=".08"/></linearGradient></defs>
    <g clip-path="url(#${clip})">
      <rect x="-2" y="-4" width="104" height="58" fill="${SKY}"/>
      <image href="${FLAG_SRC}" x="0" y="0" width="100" height="50"/>
      <rect x="-2" y="-4" width="104" height="58" fill="url(#${folds})"/>
    </g></g>`;
}

// Акорда: массивный белый корпус на несколько этажей с голубыми окнами, полукруглый вход с высокими колоннами,
// террасы с балюстрадой, широкий голубой купол с золотыми меридианами, длинный золотой шпиль с шаром.
// Низ по центру в (cx, base); ширина около 168, высота около 122.
function akorda(cx, base) {
  const dome = uid("dome"), wall = uid("wall"), glass = uid("glass"), spire = uid("spire");
  const X = v => (cx + v).toFixed(1);
  const Y = v => (base - v).toFixed(1);
  const rect = (x, y, w, h, fill, extra = "") => `<rect x="${X(x)}" y="${Y(y + h)}" width="${w}" height="${h}" fill="${fill}"${extra}/>`;
  // окна крыла, симметрично; часть светится: вечер
  const windows = (y, h, w, lit) => {
    let out = "";
    [36, 43, 50, 57, 64, 71].forEach((v, i) => {
      for (const side of [-1, 1]) {
        const warm = lit.includes((i + (side > 0 ? 2 : 0)) % 6);
        out += rect(side * v - w / 2, y, w, h, warm ? "#F6CF8E" : `url(#${glass})`);
      }
    });
    return out;
  };
  const line = (x1, x2, y, c, sw) => `<path d="M${X(x1)} ${Y(y)}H${X(x2)}" stroke="${c}" stroke-width="${sw}"/>`;
  // балюстрада: столбики на террасе
  const baluster = (from, to, y) => {
    let d = "";
    for (let v = from; v <= to; v += 1.8) d += `M${X(v)} ${Y(y)}V${Y(y + 2.4)}M${X(-v)} ${Y(y)}V${Y(y + 2.4)}`;
    return `<path d="${d}" stroke="#C9D0DD" stroke-width=".5"/>`;
  };
  // колонны полукруглого входа: к краям теснее, как на изгибе
  const columns = [-25.5, -21.5, -16, -9, 0, 9, 16, 21.5, 25.5].map((v, i) => {
    const w = 2.6 - Math.abs(i - 4) * .2;
    return rect(v - w / 2, 2, w, 37, "#FBFCFE");
  }).join("");
  const meridian = (k) => `M${X(0)} ${Y(91)}C${X(k * 11)} ${Y(90)} ${X(k * 25)} ${Y(82)} ${X(k * 26)} ${Y(68.5)}`;
  const domeLines = [.28, .68, 1].flatMap(k => [meridian(k), meridian(-k)]).join("") + `M${X(0)} ${Y(91)}V${Y(68.5)}`;
  return `<g>
    <defs>
      <linearGradient id="${dome}" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#1B5FA8"/><stop offset=".4" stop-color="#4D9BE0"/><stop offset="1" stop-color="#174E8F"/></linearGradient>
      <linearGradient id="${wall}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#F3F1EC"/><stop offset="1" stop-color="#C6CAD3"/></linearGradient>
      <linearGradient id="${glass}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#4F8FB3"/><stop offset="1" stop-color="#2B5A7C"/></linearGradient>
      <linearGradient id="${spire}" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#9C7420"/><stop offset=".5" stop-color="#F2C94C"/><stop offset="1" stop-color="#A67C22"/></linearGradient>
    </defs>
    <!-- шпиль и купол -->
    <path d="M${X(-2.2)} ${Y(95)}L${X(-.7)} ${Y(118)}H${X(.7)}L${X(2.2)} ${Y(95)}Z" fill="url(#${spire})"/>
    <circle cx="${X(0)}" cy="${Y(120)}" r="1.9" fill="#F2C94C"/>
    ${rect(-4.5, 90.5, 9, 4.5, "#EEF0F4")}
    <path d="M${X(-26)} ${Y(68.5)}C${X(-25)} ${Y(82)} ${X(-11)} ${Y(91)} ${X(0)} ${Y(91)}C${X(11)} ${Y(91)} ${X(25)} ${Y(82)} ${X(26)} ${Y(68.5)}Z" fill="url(#${dome})"/>
    <path d="${domeLines}" fill="none" stroke="#E7B94A" stroke-width=".7"/>
    ${rect(-29, 66, 58, 3, "#F6F7F9")}
    <!-- верхний ярус с лентой окон -->
    ${rect(-33, 58, 66, 8, `url(#${wall})`)}
    ${rect(-30, 60, 24, 3.6, `url(#${glass})`)}${rect(6, 60, 24, 3.6, `url(#${glass})`)}
    <circle cx="${X(0)}" cy="${Y(61.8)}" r="2.3" fill="#D9A93A"/>
    <!-- терраса с балюстрадой -->
    ${rect(-60, 52, 120, 6, `url(#${wall})`)}
    ${rect(-84, 50.4, 168, 2.2, "#FBFCFE")}
    ${baluster(62, 83, 52.6)}
    ${line(-83.5, -61, 55, "#DDE2EA", .8)}${line(61, 83.5, 55, "#DDE2EA", .8)}
    <!-- корпус -->
    ${rect(-81, 0, 162, 50.4, `url(#${wall})`)}
    ${windows(38, 9, 3.6, [1, 4])}
    ${line(-81, 81, 35.2, "#FBFCFE", 1.3)}
    ${windows(20, 12.5, 3.8, [3])}
    ${line(-81, 81, 17.6, "#FBFCFE", 1.3)}
    ${windows(2.5, 12.5, 3.8, [0, 5])}
    <!-- полукруглый вход: стекло за колоннами -->
    ${rect(-31, 0, 62, 50.4, `url(#${wall})`)}
    ${rect(-28, 2, 56, 36, `url(#${glass})`)}
    ${line(-28, 28, 14, "#88AFC8", .5)}${line(-28, 28, 26, "#88AFC8", .5)}
    ${rect(-3.2, 2, 6.4, 12, "#6B3F25")}
    <path d="M${X(-3.2)} ${Y(14)}A3.2 3.2 0 0 1 ${X(3.2)} ${Y(14)}Z" fill="#6B3F25"/>
    ${columns}
    <path d="M${X(-31)} ${Y(39)}Q${X(0)} ${Y(37)} ${X(31)} ${Y(39)}V${Y(43)}Q${X(0)} ${Y(41)} ${X(-31)} ${Y(43)}Z" fill="#FBFCFE"/>
    ${[-24, -16, -8, 0, 8, 16, 24].map(v => rect(v - 2.2, 44.2, 4.4, 4, `url(#${glass})`)).join("")}
    ${rect(-33, 0, 66, 2, "#E2E5EB")}
  </g>`;
}

// Шапка вводного окна: вечерний кабинет. Слева флаг на стойке, в окне — Акорда над ровной степью Астаны (гор там нет),
// за столом силуэт в кресле со спины. 560×190; растягивается по ширине окна.
export function presidentOffice() {
  const sky = uid("sky"), room = uid("room"), glow = uid("glow"), lamp = uid("lamp"), vign = uid("vign"), pane = uid("pane");
  const win = { x: 186, y: 16, w: 300, h: 134 };
  return `<svg class="art" viewBox="0 0 560 190" width="560" height="190" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Кабинет президента: флаг и Акорда за окном" focusable="false">
  <defs>
    <linearGradient id="${sky}" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#141B36"/><stop offset=".45" stop-color="#2C2F5C"/><stop offset=".78" stop-color="#7A4E6E"/><stop offset="1" stop-color="#D58A5C"/></linearGradient>
    <linearGradient id="${room}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#0E1528"/><stop offset="1" stop-color="#0A1020"/></linearGradient>
    <radialGradient id="${glow}" cx=".55" cy="1" r=".8"><stop offset="0" stop-color="#D58A5C" stop-opacity=".22"/><stop offset="1" stop-color="#D58A5C" stop-opacity="0"/></radialGradient>
    <radialGradient id="${lamp}" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#FBBF24" stop-opacity=".35"/><stop offset="1" stop-color="#FBBF24" stop-opacity="0"/></radialGradient>
    <radialGradient id="${vign}" cx=".5" cy=".45" r=".75"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></radialGradient>
    <clipPath id="${pane}"><rect x="${win.x}" y="${win.y}" width="${win.w}" height="${win.h}"/></clipPath>
  </defs>
  <rect width="560" height="190" fill="url(#${room})"/>
  <path d="M0 150H560" stroke="#18223A" stroke-width="1"/>
  <path d="M40 0V150M520 0V150" stroke="#131C33" stroke-width="1"/>
  <g clip-path="url(#${pane})">
    <rect x="${win.x}" y="${win.y}" width="${win.w}" height="${win.h}" fill="url(#${sky})"/>
    <circle cx="436" cy="34" r="1" fill="#CBD5E1" opacity=".7"/><circle cx="214" cy="28" r=".8" fill="#CBD5E1" opacity=".5"/><circle cx="300" cy="22" r=".7" fill="#CBD5E1" opacity=".5"/>
    <path d="M186 124H196V116H204V124H214V110H222V124H240V119H250V124H262V113H270V124H420V116H430V124H442V108H450V124H462V118H472V124H486V150H186Z" fill="#2A3150"/>
    <path d="M186 124H486V150H186Z" fill="#232B4A"/>
    <path d="M200 120h1.6M218 115h1.6M265 118h1.6M445 113h1.6M445 118h1.6M466 121h1.6" stroke="#F4C77A" stroke-width="1.4" opacity=".55"/>
    <rect x="186" y="136" width="300" height="14" fill="#171E36"/>
    ${akorda(336, 140)}
    <path d="M186 140H486" stroke="#2B3557" stroke-width="1"/>
  </g>
  <rect x="${win.x}" y="${win.y}" width="${win.w}" height="${win.h}" fill="none" stroke="#2A3550" stroke-width="3"/>
  <path d="M270 ${win.y}V${win.y + win.h}M402 ${win.y}V${win.y + win.h}M${win.x} 46H270M402 46H486" stroke="#2A3550" stroke-width="2.4"/>
  <rect x="${win.x - 6}" y="${win.y + win.h}" width="${win.w + 12}" height="4" fill="#26314B"/>
  <path d="M170 8C176 50 172 110 178 160H160C164 110 160 50 164 8Z" fill="#121A30"/>
  <path d="M502 8C496 50 500 110 494 160H512C508 110 512 50 508 8Z" fill="#121A30"/>
  <path d="M160 6H512" stroke="#2A3550" stroke-width="3" stroke-linecap="round"/>
  <rect x="0" y="100" width="560" height="90" fill="url(#${glow})"/>
  <path d="M150 152H530L540 162H140Z" fill="#1D263D"/>
  <path d="M150 152H530" stroke="#3A4766" stroke-width="1"/>
  <rect x="140" y="162" width="400" height="28" fill="#141B2E"/>
  <path d="M140 162H540" stroke="#0A0F1C" stroke-width="1.5"/>
  <circle cx="452" cy="134" r="34" fill="url(#${lamp})"/>
  <path d="M446 152h14l-3-3h-8Z" fill="#2F3A55"/><path d="M453 149V136" stroke="#3E4A68" stroke-width="1.5"/>
  <path d="M442 136h22l-4-9h-14Z" fill="#1F6B4F"/><path d="M444 136h18" stroke="#FCD38A" stroke-width="1" opacity=".8"/>
  <path d="M470 151l18-2 4 2-18 2Z" fill="#CBD5E1" opacity=".35"/>
  <path d="M368 151l20-1.5 3 1.5-20 1.5Z" fill="#CBD5E1" opacity=".25"/>
  <g transform="translate(-66 0)">
    <path d="M232 160C232 146 240 134 250 130 256 128 262 124 266 117H278C282 124 288 128 294 130 304 134 312 146 312 160Z" fill="#05080F"/>
    <ellipse cx="272" cy="106" rx="11.5" ry="13.5" fill="#05080F"/>
    <path d="M261.5 101C262.5 94 266.5 92.6 272 92.6 277.5 92.6 281.5 94 282.5 101" fill="none" stroke="#E7A27A" stroke-width="1" opacity=".55"/>
    <path d="M236 142C238 136 243 131 250 130M308 142C306 136 301 131 294 130" fill="none" stroke="#E7A27A" stroke-width=".9" opacity=".35"/>
    <path d="M244 190V128C244 122 249 118 256 118H288C295 118 300 122 300 128V190Z" fill="#0B111F"/>
    <path d="M244 128C244 122 249 118 256 118H288C295 118 300 122 300 128" fill="none" stroke="#2A3550" stroke-width="1.2"/>
    <path d="M252 126V190M292 126V190" stroke="#121A2C" stroke-width="1"/>
  </g>
  <path d="M104 186l-14 4M104 186l14 4M104 186V190" stroke="#3A4766" stroke-width="2" stroke-linecap="round"/>
  <path d="M104 14V187" stroke="#8A97B3" stroke-width="2"/>
  <path d="M104 4l3 6-3 4-3-4Z" fill="#E7B94A"/>
  <circle cx="104" cy="14.5" r="2" fill="#E7B94A"/>
  ${flag("translate(105 20) scale(.78)")}
  <rect width="560" height="190" fill="url(#${vign})"/>
</svg>`;
}

// Печать указа: стилизация. Голубой круг, золотой ободок с насечкой, шанырак с расходящимися уыками.
export function decreeSeal(size = 56) {
  const disc = uid("disc");
  const uyks = [], notches = [];
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    const p = r => `${(32 + r * Math.cos(a)).toFixed(2)} ${(32 + r * Math.sin(a)).toFixed(2)}`;
    uyks.push(`M${p(10.5)}L${p(21.5)}`);
  }
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    notches.push(`<circle cx="${(32 + 28.2 * Math.cos(a)).toFixed(2)}" cy="${(32 + 28.2 * Math.sin(a)).toFixed(2)}" r=".7"/>`);
  }
  return `<svg class="art-seal" viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true" focusable="false">
  <defs><radialGradient id="${disc}" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#2CC3DD"/><stop offset="1" stop-color="#007E99"/></radialGradient></defs>
  <circle cx="32" cy="32" r="31" fill="#C8921E"/>
  <circle cx="32" cy="32" r="29.6" fill="none" stroke="#FCD34D" stroke-width="1.2"/>
  <g fill="#7A5410">${notches.join("")}</g>
  <circle cx="32" cy="32" r="25.5" fill="url(#${disc})" stroke="#FCD34D" stroke-width="1"/>
  <path d="${uyks.join("")}" stroke="${GOLD}" stroke-width="1.5" stroke-linecap="round"/>
  <circle cx="32" cy="32" r="22.5" fill="none" stroke="${GOLD}" stroke-width=".8" opacity=".7"/>
  <circle cx="32" cy="32" r="9.5" fill="#00708A" stroke="${GOLD}" stroke-width="1.8"/>
  <path d="M28.6 23.4C26.6 28.6 26.6 35.4 28.6 40.6M35.4 23.4C37.4 28.6 37.4 35.4 35.4 40.6M23.4 28.6C28.6 26.6 35.4 26.6 40.6 28.6M23.4 35.4C28.6 37.4 35.4 37.4 40.6 35.4" fill="none" stroke="${GOLD}" stroke-width="1.3"/>
</svg>`;
}

// Полоса бланка указа: голубое поле, орнамент, солнце и беркут слева, золотая нить снизу.
// Обрезается справа на узком экране (xMinYMid slice), содержимое слева остаётся целым.
export function flagStripe() {
  return `<svg class="art-band" viewBox="0 0 720 48" preserveAspectRatio="xMinYMid slice" aria-hidden="true" focusable="false">
  <rect width="720" height="48" fill="${SKY}"/>
  <image href="${FLAG_SRC}" x="0" y="0" width="92" height="46"/>
  <path d="M0 47H720" stroke="${FLAG_GOLD}" stroke-width="2"/>
</svg>`;
}
