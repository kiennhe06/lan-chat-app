/**
 * Vector clock của client (persist trong bảng vector_clock).
 * Gửi tin: tăng counter của mình, đính kèm snapshot. Nhận: merge max từng phần tử.
 */
'use strict';

const vectorClock = require('../../../shared/vectorClock');

/**
 * @param {{ getClock: () => object, saveClock: (clock: object) => void }} repo
 */
function createClockService(repo) {
  return {
    current: () => repo.getClock(),
    /** Tăng counter của userId, lưu và trả snapshot mới */
    tick(userId) {
      const next = vectorClock.increment(repo.getClock(), userId);
      repo.saveClock(next);
      return next;
    },
    /** Merge clock nhận được, lưu và trả snapshot mới */
    merge(remote) {
      const next = vectorClock.merge(repo.getClock(), remote || {});
      repo.saveClock(next);
      return next;
    },
  };
}

module.exports = { createClockService };
