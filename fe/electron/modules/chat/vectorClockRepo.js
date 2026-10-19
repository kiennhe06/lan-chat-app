/**
 * Repository bảng `vector_clock` ({user_id: counter}) của client.
 */
'use strict';

/**
 * @param {import('better-sqlite3').Database} db
 */
function createVectorClockRepo(db) {
  const stmt = {
    all: db.prepare('SELECT user_id, counter FROM vector_clock'),
    upsertMax: db.prepare(`INSERT INTO vector_clock (user_id, counter) VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET counter = MAX(vector_clock.counter, excluded.counter)`),
  };

  /** @returns {Object<string, number>} */
  function getClock() {
    const clock = {};
    for (const r of stmt.all.all()) clock[String(r.user_id)] = r.counter;
    return clock;
  }

  /** Lưu clock (merge max từng phần tử — không bao giờ lùi) */
  const saveClock = db.transaction((clock) => {
    for (const [uid, counter] of Object.entries(clock || {})) {
      const id = Number(uid);
      if (Number.isInteger(id)) stmt.upsertMax.run(id, Number(counter) || 0);
    }
  });

  return { getClock, saveClock };
}

module.exports = { createVectorClockRepo };
