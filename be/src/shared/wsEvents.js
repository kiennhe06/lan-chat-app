/**
 * Danh sách TẤT CẢ tên event WebSocket (server ↔ client) và P2P (client ↔ client).
 * Nghiêm cấm gõ chuỗi event trực tiếp trong code — luôn import từ đây.
 *
 * Khung message trên dây (JSON):
 *   { type: string, data?: object, reqId?: string, error?: { code, message } }
 * - Client gửi request kèm reqId → server trả về event kết quả kèm CÙNG reqId.
 * - Có `error` ⇒ request thất bại.
 * Chi tiết payload: docs/PROTOCOL.md
 *
 * ⚠️ DUPLICATE ở be/src/shared và fe/shared — sửa xong chạy `npm run sync:shared`.
 */
'use strict';

const AUTH = Object.freeze({
  REGISTER: 'auth:register',
  REGISTER_OK: 'auth:register:ok',
  REGISTER_ERR: 'auth:register:err',
  LOGIN: 'auth:login',
  LOGIN_OK: 'auth:login:ok',
  LOGIN_ERR: 'auth:login:err',
  RECONNECT: 'auth:reconnect',
  RECONNECT_OK: 'auth:reconnect:ok',
  RECONNECT_ERR: 'auth:reconnect:err',
  LOGOUT: 'auth:logout',
  LOGOUT_OK: 'auth:logout:ok',
  DISCONNECT: 'auth:disconnect',
  KICKED: 'auth:kicked',
});

const USER = Object.freeze({
  CREATED: 'user:created',
  UPDATED: 'user:updated',
  LIST: 'user:list',
  LIST_RESULT: 'user:list:result',
  UPDATE_PROFILE: 'user:updateProfile',
  UPDATE_PROFILE_RESULT: 'user:updateProfile:result',
  CHANGE_PASSWORD: 'user:changePassword',
  CHANGE_PASSWORD_RESULT: 'user:changePassword:result',
  UPDATE_SETTINGS: 'user:updateSettings',
  UPDATE_SETTINGS_RESULT: 'user:updateSettings:result',
});

const MESSAGE = Object.freeze({
  SEND: 'message:send',
  SENT: 'message:sent', // ack cho người gửi (có reqId)
  NEW: 'message:new', // broadcast cho mọi member
  EDIT: 'message:edit',
  EDITED: 'message:edited',
  RECALL: 'message:recall',
  RECALLED: 'message:recalled',
  DELIVERED: 'message:delivered',
  READ: 'message:read',
  STATUS_UPDATE: 'message:status_update',
  PIN: 'message:pin',
  UNPIN: 'message:unpin',
  HISTORY: 'message:history',
  HISTORY_RESULT: 'message:history:result',
  RESULT: 'message:result', // ack chung cho edit/recall/pin/unpin/read
});

const CONV = Object.freeze({
  LIST: 'conv:list',
  LIST_RESULT: 'conv:list:result',
  CREATE: 'conv:create',
  CREATED: 'conv:created',
  UPDATED: 'conv:updated',
  DELETED: 'conv:deleted',
  RENAME: 'conv:rename',
  ADD_MEMBER: 'conv:addMember',
  ADD_MEMBER_RESULT: 'conv:addMemberResult',
  APPROVE_MEMBER: 'conv:approveMember',
  REJECT_MEMBER: 'conv:rejectMember',
  REMOVE_MEMBER: 'conv:removeMember',
  SET_ADMIN: 'conv:setAdmin',
  DELETE: 'conv:delete',
  REQUEST_PENDING: 'conv:requestPending',
  PENDING_LIST: 'conv:pendingList',
  MEMBER_PENDING: 'conv:memberPending',
  PINNED: 'conv:pinned',
  UNPINNED: 'conv:unpinned',
  RESULT: 'conv:result', // ack chung cho rename/approve/reject/remove/setAdmin/delete
});

const SYNC = Object.freeze({
  REQUEST: 'sync:request',
  RESPONSE: 'sync:response',
  ACK: 'sync:ack',
  STATUS: 'sync:status',
  MESSAGE_BATCH: 'sync:message-batch',
  MESSAGE_BATCH_ACK: 'sync:message-batch-ack',
  ACTION_BATCH: 'sync:action-batch',
  ACTION_BATCH_ACK: 'sync:action-batch-ack',
  FILE_BATCH: 'sync:file-batch',
  FILE_BATCH_ACK: 'sync:file-batch-ack',
});

const P2P = Object.freeze({
  HELLO: 'p2p:hello',
  HELLO_ACK: 'p2p:hello-ack',
  MESSAGE: 'p2p:message',
  MESSAGE_ACK: 'p2p:message-ack',
  MESSAGE_EDIT: 'p2p:message-edit',
  MESSAGE_RECALL: 'p2p:message-recall',
  FILE_START: 'p2p:file-start',
  FILE_CHUNK: 'p2p:file-chunk',
  FILE_COMPLETE: 'p2p:file-complete',
  FILE_ACK: 'p2p:file-ack',
  TYPING: 'p2p:typing',
  PRESENCE: 'p2p:presence',
  CONV_SYNC: 'p2p:conv-sync', // chia sẻ nhóm tạo/đổi tên offline cho peer
  ERROR: 'p2p:error',
});

const PRESENCE = Object.freeze({
  UPDATE: 'presence',
  LIST: 'presence:list',
});

const TYPING = Object.freeze({
  TYPING: 'typing',
});

const CALL = Object.freeze({
  OFFER: 'call:offer',
  ANSWER: 'call:answer',
  ICE_CANDIDATE: 'call:ice-candidate',
  END: 'call:end',
});

const LOG = Object.freeze({
  EVENT: 'log:event',
  BATCH: 'log:batch',
  ACK: 'log:ack',
});

const ADMIN = Object.freeze({
  LIST_BLOCKED: 'admin:listBlocked',
  BLOCKED_LIST: 'admin:blockedList',
  BLOCK_IP: 'admin:blockIp',
  BLOCK_IP_RESULT: 'admin:blockIpResult',
  UNBLOCK_IP: 'admin:unblockIp',
  UNBLOCK_IP_RESULT: 'admin:unblockIpResult',
});

const SYSTEM = Object.freeze({
  ERROR: 'error',
  PING: 'ping',
  PONG: 'pong',
});

/** Gói UDP discovery (không phải WS) */
const DISCOVERY = Object.freeze({
  SERVER_ANNOUNCE: 'server:announce', // server → broadcast :41234 và :5003
  CLIENT_PROBE: 'client:probe', // client → broadcast :41234, server trả unicast announce
  PEER_ANNOUNCE: 'peer:announce', // client → broadcast :5003
});

module.exports = {
  AUTH,
  USER,
  MESSAGE,
  CONV,
  SYNC,
  P2P,
  PRESENCE,
  TYPING,
  CALL,
  LOG,
  ADMIN,
  SYSTEM,
  DISCOVERY,
};
