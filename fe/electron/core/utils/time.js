'use strict';

/** ISO 8601 UTC hiện tại */
const nowIso = () => new Date().toISOString();

/** Trì hoãn (dùng cho backoff) */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = { nowIso, delay };
