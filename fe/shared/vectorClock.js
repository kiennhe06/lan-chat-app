/**
 * Vector clock + sắp xếp tin nhắn (Mức 3 offline-first). Pure function.
 *
 * Clock dạng { "<user_id>": counter }.
 * Sort tin: (1) server_id nếu cả 2 có → (2) quan hệ nhân quả (happened-before)
 *           → (3) đồng thời: (created_at_local, sender_id, client_message_id).
 *
 * ⚠️ DUPLICATE ở be/src/shared và fe/shared — sửa xong chạy `npm run sync:shared`.
 */
'use strict';

/** Tăng counter của userId, trả về clock MỚI (không mutate). */
function increment(clock, userId) {
  const next = { ...(clock || {}) };
  const key = String(userId);
  next[key] = (next[key] || 0) + 1;
  return next;
}

/** Merge: lấy max từng phần tử. */
function merge(a, b) {
  const out = { ...(a || {}) };
  for (const [key, value] of Object.entries(b || {})) {
    const n = Number(value) || 0;
    if (!out[key] || out[key] < n) out[key] = n;
  }
  return out;
}

/**
 * So sánh 2 clock.
 * @returns {-1|0|1|null} -1: a trước b; 1: a sau b; 0: bằng nhau; null: đồng thời (concurrent)
 */
function compareClocks(a, b) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  let aLess = false;
  let bLess = false;
  for (const key of keys) {
    const x = (a && a[key]) || 0;
    const y = (b && b[key]) || 0;
    if (x < y) aLess = true;
    if (y < x) bLess = true;
  }
  if (aLess && !bLess) return -1;
  if (bLess && !aLess) return 1;
  if (!aLess && !bLess) return 0;
  return null;
}

const cmpPrimitive = (x, y) => (x < y ? -1 : x > y ? 1 : 0);

/**
 * Comparator cho Array.prototype.sort (tăng dần theo thời gian).
 * @param {{server_id?:number|null, vector_clock?:object, created_at_local?:string, created_at?:string,
 *          sender_id:number, client_message_id:string}} a
 * @param {typeof a} b
 */
function compareMessages(a, b) {
  if (a.server_id != null && b.server_id != null) return a.server_id - b.server_id;
  const causal = compareClocks(a.vector_clock, b.vector_clock);
  if (causal === -1 || causal === 1) return causal;
  const ta = a.created_at_local || a.created_at || '';
  const tb = b.created_at_local || b.created_at || '';
  return (
    cmpPrimitive(ta, tb) ||
    cmpPrimitive(Number(a.sender_id) || 0, Number(b.sender_id) || 0) ||
    cmpPrimitive(String(a.client_message_id), String(b.client_message_id))
  );
}

module.exports = { increment, merge, compareClocks, compareMessages };
