/**
 * Logic thuần về tin nhắn cho UI: tính trạng thái (PROTOCOL §3.2), preview, mention.
 */
import C, {
  CONVERSATION_TYPE,
  GROUP_ROLE,
  MESSAGE_STATUS,
  MESSAGE_STATUS_RANK,
  MESSAGE_TYPE,
  MESSAGES_VI,
} from '../../app/config/constants.js';
import { previewText } from '../../utils/format.js';

/**
 * Tính trạng thái tin của MÌNH theo con trỏ member (PROTOCOL §3.2), chỉ tiến.
 * - Không có server_id: pending (icon theo sync_state) hoặc sent (đã tới peer).
 * - Có server_id: read nếu (1-1) người kia đã đọc / (group) ≥1 member khác đã đọc;
 *   delivered nếu có member khác đã nhận; còn lại sent.
 * - Kết quả lấy MAX với message.status (không bao giờ lùi trạng thái).
 * @returns {{status:string, syncState:string|null, readerIds:number[], totalMembers:number}}
 */
export function computeMessageStatus(message, conversation, myUserId) {
  const syncState = message.sync_state || null;
  if (message.status === MESSAGE_STATUS.FAILED) {
    return { status: MESSAGE_STATUS.FAILED, syncState, readerIds: [], totalMembers: 0 };
  }
  const others = ((conversation && conversation.members) || []).filter((m) => Number(m.user_id) !== Number(myUserId));
  if (message.server_id == null) {
    const status = message.status === MESSAGE_STATUS.SENT ? MESSAGE_STATUS.SENT : MESSAGE_STATUS.PENDING;
    return { status, syncState, readerIds: [], totalMembers: others.length };
  }
  const sid = Number(message.server_id);
  const readerIds = others.filter((m) => Number(m.last_read_message_id || 0) >= sid).map((m) => Number(m.user_id));
  const delivered = others.some(
    (m) => Math.max(Number(m.last_delivered_message_id || 0), Number(m.last_read_message_id || 0)) >= sid,
  );
  let computed = MESSAGE_STATUS.SENT;
  if (readerIds.length > 0) computed = MESSAGE_STATUS.READ;
  else if (delivered) computed = MESSAGE_STATUS.DELIVERED;
  const storedRank = MESSAGE_STATUS_RANK[message.status] ?? 0;
  const status = storedRank > MESSAGE_STATUS_RANK[computed] ? message.status : computed;
  return { status, syncState: null, readerIds, totalMembers: others.length };
}

/** Vai trò của tôi trong conversation */
export function getMyRole(conversation, myUserId) {
  if (!conversation) return GROUP_ROLE.MEMBER;
  if (conversation.my_role) return conversation.my_role;
  const me = (conversation.members || []).find((m) => Number(m.user_id) === Number(myUserId));
  return (me && me.role) || GROUP_ROLE.MEMBER;
}

export const isGroupConversation = (conversation) => Boolean(conversation && conversation.type === CONVERSATION_TYPE.GROUP);

export const isManagerRole = (role) => role === GROUP_ROLE.OWNER || role === GROUP_ROLE.ADMIN;

/** Ghim: owner/admin trong nhóm, ai cũng được trong 1-1 */
export function canPinIn(conversation, myUserId) {
  return !isGroupConversation(conversation) || isManagerRole(getMyRole(conversation, myUserId));
}

/** Preview 1 dòng của tin (danh sách hội thoại, reply, pin) */
export function messagePreview(message, max = 80) {
  if (!message) return '';
  if (message.recalled) return MESSAGES_VI.RECALLED;
  if (message.type === MESSAGE_TYPE.IMAGE) return message.content ? `🖼️ ${previewText(message.content, max)}` : '🖼️ Hình ảnh';
  if (message.type === MESSAGE_TYPE.FILE) return `📎 ${(message.file && message.file.name) || 'Tệp đính kèm'}`;
  return previewText(message.content, max);
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Tách text thành các đoạn thường / mention (@Tên) / link để render highlight.
 * @param {string} text
 * @param {string[]} mentionNames tên hiển thị của các user được mention
 * @returns {Array<{text:string, kind:'text'|'mention'|'link'}>}
 */
export function splitRichText(text, mentionNames) {
  const source = String(text || '');
  const patterns = [];
  const names = (mentionNames || []).filter(Boolean).sort((a, b) => b.length - a.length);
  if (names.length) patterns.push(`${escapeRegExp(C.MENTION_TRIGGER)}(?:${names.map(escapeRegExp).join('|')})`);
  if (C.URL_REGEX) patterns.push(C.URL_REGEX.source);
  if (!patterns.length) return [{ text: source, kind: 'text' }];
  const regex = new RegExp(patterns.map((p) => `(${p})`).join('|'), 'gi');
  const parts = [];
  let last = 0;
  let match;
  while ((match = regex.exec(source)) !== null) {
    if (match.index > last) parts.push({ text: source.slice(last, match.index), kind: 'text' });
    const isMention = names.length > 0 && match[1] !== undefined;
    parts.push({ text: match[0], kind: isMention ? 'mention' : 'link' });
    last = match.index + match[0].length;
    if (match[0].length === 0) regex.lastIndex += 1;
  }
  if (last < source.length) parts.push({ text: source.slice(last), kind: 'text' });
  return parts;
}
