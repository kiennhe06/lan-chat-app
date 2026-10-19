/**
 * Wrapper mỏng quanh `window.api.db` (client.db qua IPC). Chỉ hooks được dùng module này.
 */
import { getApi } from './apiClient.js';

const db = () => getApi().db;

/** Bỏ bọc nếu main trả {messages|items|...} thay vì mảng. */
function asArray(value, key) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value[key])) return value[key];
  return [];
}

export const localDb = {
  /** @returns {Promise<object[]>} LocalConversation[] */
  listConversations: async () => asArray(await db().listConversations(), 'conversations'),
  getConversation: (conversationId) => db().getConversation(conversationId),
  /**
   * @param {string} conversationId
   * @param {string|null} before sort_key tin cũ nhất đang hiển thị
   * @returns {Promise<{messages: object[], has_more: boolean, oldest_key: string|null}>}
   */
  getMessages: async (conversationId, before) => normalizePage(await db().getMessages(conversationId, before)),
  getMessagesAround: async (conversationId, clientMessageId) =>
    normalizePage(await db().getMessagesAround(conversationId, clientMessageId)),
  searchMessages: async (conversationId, keyword) =>
    asArray(await db().searchMessages(conversationId, keyword), 'messages'),
  /** @param {'images'|'files'|'links'} kind */
  getMedia: async (conversationId, kind) => asArray(await db().getMedia(conversationId, kind), 'items'),
  listUsers: async () => asArray(await db().listUsers(), 'users'),
  getSetting: (key) => db().getSetting(key),
  setSetting: (key, value) => db().setSetting(key, value),
};

/** Chuẩn hóa kết quả trang tin (getMessages / getMessagesAround). */
function normalizePage(result) {
  if (Array.isArray(result)) return { messages: result, has_more: false, oldest_key: null };
  return {
    messages: (result && result.messages) || [],
    has_more: Boolean(result && result.has_more),
    oldest_key: (result && result.oldest_key) || null,
  };
}
