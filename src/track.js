// Счётчик GoatCounter: только название события, без данных об игроке.
// Скрипта может не быть (блокировщик, нет сети, локальный запуск), игра от этого не зависит.
export function track(name) {
  try {
    globalThis.goatcounter?.count?.({ path: name, title: name, event: true });
  } catch { /* счётчик не должен мешать игре */ }
}
