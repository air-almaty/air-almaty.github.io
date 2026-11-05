// Автосохранение партии: Chrome («Экономия памяти») может выгрузить вкладку и загрузить её заново — партия не должна пропасть.
// Состояние sim — простые объекты и массивы; JSON теряет только -Infinity/Infinity/NaN, -0 и undefined,
// поэтому они пишутся метками и возвращаются как были. Set, Map, функции и классы — ошибка: их в состоянии быть не должно.
import { DISTRICTS } from "./data/city.js";

export const SAVE_VERSION = 1;
export const SAVE_KEY = "akim-almaty:save:v1";

const TAG_NUM = "$num";
const TAG_UNDEF = "$undef";

function encode(key, v) {
  if (v === undefined) return { [TAG_UNDEF]: 1 };
  if (typeof v === "number") {
    if (Object.is(v, -0)) return { [TAG_NUM]: "-0" };
    if (!Number.isFinite(v)) return { [TAG_NUM]: String(v) };
    return v;
  }
  if (typeof v === "function" || typeof v === "symbol" || typeof v === "bigint") throw new Error(`save: ${typeof v} at "${key}"`);
  if (v && typeof v === "object") {
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== Array.prototype && proto !== null) throw new Error(`save: ${v.constructor?.name ?? "object"} at "${key}"`);
  }
  return v;
}

function decode(v) {
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) v[i] = decode(v[i]);
    return v;
  }
  if (v && typeof v === "object") {
    const keys = Object.keys(v);
    if (keys.length === 1 && keys[0] === TAG_UNDEF) return undefined;
    if (keys.length === 1 && keys[0] === TAG_NUM) return Number(v[TAG_NUM]);
    for (const k of keys) v[k] = decode(v[k]);
  }
  return v;
}

// Снимок партии в строку: { v, state, ui }. ui — что стоит сохранить из интерфейса (вкладка, скорость, подсказки).
export function serialize(state, ui = null) {
  return JSON.stringify({ v: SAVE_VERSION, state, ui }, encode);
}

// Похоже ли это на состояние нашей игры: версия совпала, но файл мог быть испорчен руками или старой сборкой.
function looksLikeState(s) {
  return !!s && typeof s === "object" && Number.isInteger(s.day) && s.day >= 0 && typeof s.phase === "string"
    && Array.isArray(s.districts) && s.districts.length === DISTRICTS.length && s.districts.every((d, i) => d?.id === DISTRICTS[i].id)
    && Array.isArray(s.plants) && Array.isArray(s.building) && Array.isArray(s.log) && Array.isArray(s.loans) && typeof s.budget === "number";
}

// Снимок целиком: { state, ui }. Чужая версия или испорченная строка — ошибка.
export function readSave(json) {
  const o = decode(JSON.parse(json));
  if (!o || o.v !== SAVE_VERSION) throw new Error(`save: version ${o?.v}`);
  if (!looksLikeState(o.state)) throw new Error("save: not a game state");
  return { state: o.state, ui: o.ui && typeof o.ui === "object" ? o.ui : {} };
}

export const deserialize = json => readSave(json).state;

// Как начать страницу: "fresh" — вступление как обычно, "continue" — вступление с «Продолжить партию»,
// "auto" — сразу вернуть партию на паузе (вкладку выгрузил Chrome или игрок обновил страницу).
// Законченную партию не предлагаем.
export function restoreMode({ hasSave, ended, discarded, navType }) {
  if (!hasSave || ended) return "fresh";
  return discarded || navType === "reload" ? "auto" : "continue";
}

// Хранилище может отсутствовать или бросать (приватный режим, квота, запрет cookies): игра идёт и без него.
export function storageGet(store, key = SAVE_KEY) {
  try { return store?.getItem(key) ?? null; } catch { return null; }
}
export function storageSet(store, value, key = SAVE_KEY) {
  try { store?.setItem(key, value); return true; } catch { return false; }
}
export function storageRemove(store, key = SAVE_KEY) {
  try { store?.removeItem(key); } catch { /* нет хранилища — нечего и удалять */ }
}

// Прочитать сохранение из хранилища: { state, ui } или null. Испорченное или старое — удаляется молча.
export function loadSave(store, key = SAVE_KEY) {
  const json = storageGet(store, key);
  if (json === null) return null;
  try {
    return readSave(json);
  } catch {
    storageRemove(store, key);
    return null;
  }
}
