/**
 * Presence (online/offline), typing relay và relay tín hiệu cuộc gọi (call:* — UI đang tạm tắt nhưng server vẫn hỗ trợ).
 */
'use strict';

const C = require('../../shared/constants');
const W = require('../../shared/wsEvents');
const { errors } = require('../../core/errors');

/**
 * @param {{ hub: object, access: object, repos: object, logger: object }} deps
 */
function createPresenceService(deps) {
  const { hub, access, repos, logger } = deps;

  const displayName = (userId) => {
    const user = repos.users.findById(userId);
    return user ? user.display_name : '';
  };

  /** Gọi sau khi socket đầu tiên của user được gắn vào hub. */
  function userCameOnline(userId) {
    hub.toAll(W.PRESENCE.UPDATE, { user_id: userId, online: true });
  }

  /** Gọi khi socket cuối cùng của user đóng. */
  function userWentOffline(userId) {
    hub.toAll(W.PRESENCE.UPDATE, { user_id: userId, online: false });
  }

  /** Snapshot cho presence:list. */
  const snapshot = () => ({ online_user_ids: hub.onlineUserIds() });

  /**
   * Relay typing tới các member khác của conversation.
   * @param {number} userId
   * @param {{ conversation_id: string }} input
   */
  function relayTyping(userId, input) {
    const { conv } = access.requireMember(input && input.conversation_id, userId);
    const others = access.memberIds(conv.id).filter((id) => id !== userId);
    hub.toUsers(others, W.TYPING.TYPING, {
      conversation_id: String(conv.id),
      user_id: userId,
      display_name: displayName(userId),
    });
  }

  /**
   * Relay call:offer/answer/ice-candidate/end tới to_user_id, kèm from_user_id + from_name.
   * @param {number} userId
   * @param {string} type một giá trị trong CALL
   * @param {object} input
   */
  function relayCall(userId, type, input) {
    const src = input || {};
    const target = Number(src.to_user_id);
    if (!Number.isSafeInteger(target) || target <= 0) throw errors.validation('to_user_id không hợp lệ');
    if (!hub.isOnline(target)) throw errors.notFound('Người nhận không trực tuyến');
    hub.toUsers([target], type, { ...src, from_user_id: userId, from_name: displayName(userId) });
    logger.info(C.LOG_CATEGORY.CALL, type, { to_user_id: target }, { userId });
    return { ok: true };
  }

  return { userCameOnline, userWentOffline, snapshot, relayTyping, relayCall };
}

module.exports = { createPresenceService };
