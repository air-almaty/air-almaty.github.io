import assert from "node:assert/strict";
import { track } from "../src/track.js";

track("no-counter"); // без счётчика не падает

const seen = [];
globalThis.goatcounter = { count: v => seen.push(v) };
track("end/fired/year-2");
assert.deepEqual(seen, [{ path: "end/fired/year-2", title: "end/fired/year-2", event: true }]);

globalThis.goatcounter = { count: () => { throw new Error("blocked"); } };
track("start"); // ошибка счётчика не доходит до игры

globalThis.goatcounter = {}; // скрипт ещё не готов
track("start");
delete globalThis.goatcounter;
console.log("track ok");
