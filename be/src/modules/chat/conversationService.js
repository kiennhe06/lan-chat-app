/**
 * Nghiệp vụ conversation & nhóm (PROTOCOL §4).
 *
 * Quy tắc quyền (server enforce):
 *  - Đổi tên: mọi member. Thêm member: owner/admin trực tiếp, member → pending.
 *  - Duyệt/Từ chối pending, xóa member: owner/admin; không ai xóa được owner; không tự xóa mình.
 *  - Set/Hủy phó nhóm, xóa nhóm: chỉ owner.
 *  - Tin system khi: tạo nhóm, đổi tên, thêm/xóa member, set admin.
 * Đổi tên dùng LWW theo (updated_at, user_id) để hợp nhất thay đổi offline.
 */
'use strict';

const C = require('../../shared/constants');
const V = require('../../shared/validators');
const W = require('../../shared/wsEvents');
const { toWireConversation } = require('../../shared/serializer');
const { errors } = require('../../core/errors');
const { isManagerRole } = require('./conversationAccess');

const ROLE = C.GROUP_ROLE;
const CAT = C.LOG_CATEGORY.MESSAGE;
const TEMP_ID_MAX = 100;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/**
 * @param {{ repos: object, access: object, hub: object, logger: object, messageService: object }} deps
 */
function createConversationService(deps) {
  const { repos, access, hub, logger, messageService } = deps;
  const nowIso = () => new Date().toISOString();

  const displayName = (userId) => {
    const u = repos.users.findById(userId);
    return u ? u.display_name : `#${userId}`;
  };
  const names = (ids) => ids.map(displayName).join(', ');

  /**
   * WireConversation theo góc nhìn của viewer (pending_count chỉ hiện với owner/admin).
   */
  function toWire(conv, viewerId) {
    const members = repos.conversations.listMembers(conv.id);
    const viewer = members.find((m) => m.user_id === viewerId);
    const showPending = conv.type === C.CONVERSATION_TYPE.GROUP && viewer && isManagerRole(viewer.role);
    return toWireConversation(conv, {
      members,
      pending_count: showPending ? repos.conversations.countPending(conv.id) : 0,
      pinned: messageService.listPins(conv.id),
      last_message: messageService.lastMessage(conv.id),
    });
  }

  /** Gửi conversation (serialize riêng từng người nhận) tới danh sách user. */
  function emitConversation(convId, type, userIds, extra) {
    const conv = repos.conversations.findById(convId);
    if (!conv) return;
    for (const userId of userIds) {
      hub.toUsers([userId], type, { conversation: toWire(conv, userId), ...(extra || {}) });
    }
  }

  function emitPendingCount(convId) {
    hub.toUsers(access.managerIds(convId), W.CONV.MEMBER_PENDING, {
      conversation_id: String(convId),
      pending_count: repos.conversations.countPending(convId),
    });
  }

  /** Danh sách conversation của user. */
  function listForUser(userId) {
    return repos.conversations.listForUser(userId).map((conv) => toWire(conv, userId));
  }

  /** Lấy WireConversation (yêu cầu là member). */
  function getForUser(rawId, userId) {
    const { conv } = access.requireMember(rawId, userId);
    return toWire(conv, userId);
  }

  /** Lọc danh sách user id: số nguyên, tồn tại, không trùng, bỏ chính mình. */
  function normalizeUserIds(raw, selfId) {
    if (!Array.isArray(raw)) throw errors.validation('Danh sách thành viên không hợp lệ');
    const ids = Array.from(new Set(raw.map(Number))).filter((id) => Number.isSafeInteger(id) && id > 0 && id !== selfId);
    const existing = new Set(repos.users.listByIds(ids).map((u) => u.id));
    const missing = ids.filter((id) => !existing.has(id));
    if (missing.length) throw errors.validation('Có thành viên không tồn tại');
    return ids;
  }

  /**
   * Find-or-create hội thoại 1-1 theo cặp user (key "minId:maxId").
   * @returns {{ conversation: object, created: boolean }}
   */
  function createDirect(userId, input) {
    const ids = normalizeUserIds(input.member_ids, userId);
    if (ids.length !== 1) throw errors.validation('Hội thoại 1-1 cần đúng 1 người khác');
    const otherId = ids[0];
    const directKey = [userId, otherId].sort((a, b) => a - b).join(':');
    let conv = repos.conversations.findByDirectKey(directKey);
    let created = false;
    if (!conv) {
      const now = nowIso();
      try {
        repos.conversations.transaction(() => {
          const id = repos.conversations.insert({
            type: C.CONVERSATION_TYPE.DIRECT,
            name: null,
            owner_id: null,
            direct_key: directKey,
            created_by: userId,
            client_temp_id: null,
            now,
          });
          repos.conversations.addMember(id, userId, ROLE.MEMBER, now);
          repos.conversations.addMember(id, otherId, ROLE.MEMBER, now);
        });
        created = true;
      } catch (err) {
        if (!(err && err.code === 'SQLITE_CONSTRAINT_UNIQUE')) throw err; // race: bên kia vừa tạo
      }
      conv = repos.conversations.findByDirectKey(directKey);
    }
    if (created) {
      logger.info(CAT, 'conversation_created', { conversation_id: String(conv.id), type: conv.type }, { userId });
      emitConversation(conv.id, W.CONV.CREATED, [userId, otherId]);
    }
    return { conversation: toWire(conv, userId), created };
  }

  /** Tìm nhóm đã tạo từ client_temp_id (idempotent cho conv_create offline). */
  function findByTempId(tempId, userId) {
    const existing = repos.conversations.findByClientTempId(tempId);
    if (!existing) return null;
    if (!repos.conversations.getMember(existing.id, userId)) throw errors.conflict('client_temp_id đã được dùng');
    return { conversation: toWire(existing, userId), created: false };
  }

  /** Mốc LWW hợp lệ từ client: ISO, không vượt quá giờ server. */
  const clampClientTime = (value, now) => (typeof value === 'string' && ISO_DATE_RE.test(value) && value < now ? value : now);

  /**
   * Tạo nhóm: cần ≥ MIN_GROUP_OTHER_MEMBERS người khác; người tạo = owner.
   * @param {{ createdAt?: string }} [opts] createdAt: thời điểm tạo offline (sync) — làm mốc LWW cho tên nhóm,
   *   để lần đổi tên offline sau đó (updated_at > createdAt) không bị coi là cũ.
   * @returns {{ conversation: object, created: boolean }}
   */
  function createGroup(userId, input, opts) {
    const tempId = input.client_temp_id == null || input.client_temp_id === '' ? null : String(input.client_temp_id);
    if (tempId && tempId.length > TEMP_ID_MAX) throw errors.validation('client_temp_id không hợp lệ');
    if (tempId) {
      const found = findByTempId(tempId, userId);
      if (found) return found;
    }
    const name = V.normalizeGroupName(input.name);
    if (!name.ok) throw errors.validation(name.error);
    const ids = normalizeUserIds(input.member_ids, userId);
    if (ids.length < C.MIN_GROUP_OTHER_MEMBERS) {
      throw errors.validation(`Nhóm cần ít nhất ${C.MIN_GROUP_OTHER_MEMBERS} thành viên khác ngoài bạn`);
    }
    const now = nowIso();
    let convId;
    let systemMsg;
    repos.conversations.transaction(() => {
      convId = repos.conversations.insert({
        type: C.CONVERSATION_TYPE.GROUP,
        name: name.value,
        owner_id: userId,
        direct_key: null,
        created_by: userId,
        client_temp_id: tempId,
        name_updated_at: opts && opts.createdAt ? clampClientTime(opts.createdAt, now) : now,
        now,
      });
      repos.conversations.addMember(convId, userId, ROLE.OWNER, now);
      for (const id of ids) repos.conversations.addMember(convId, id, ROLE.MEMBER, now);
      systemMsg = messageService.insertSystem(convId, userId, `${displayName(userId)} đã tạo nhóm "${name.value}"`);
    });
    logger.logAudit(C.LOG_LEVEL.AUDIT, CAT, 'group_created', userId, { conversation_id: String(convId), members: ids.length + 1, client_temp_id: tempId });
    emitConversation(convId, W.CONV.CREATED, [userId, ...ids]);
    messageService.broadcastNew([systemMsg]);
    return { conversation: toWire(repos.conversations.findById(convId), userId), created: true };
  }

  /** conv:create — điều hướng theo type. */
  function create(userId, input) {
    const src = input || {};
    if (src.type === C.CONVERSATION_TYPE.DIRECT) return createDirect(userId, src);
    if (src.type === C.CONVERSATION_TYPE.GROUP) return createGroup(userId, src);
    throw errors.validation('Loại cuộc trò chuyện không hợp lệ');
  }

  /** (updated_at, user_id) của a mới hơn b? */
  // Cùng mốc thời gian + cùng người → thao tác sau thắng (đổi tên ngay sau khi tạo offline trong cùng 1 ms)
  const isNewer = (aAt, aUser, bAt, bUser) => (aAt !== bAt ? aAt > bAt : Number(aUser) >= Number(bUser || 0));

  /**
   * Đổi tên nhóm, LWW theo (updated_at, user_id).
   * Online: updated_at = giờ server. Sync: dùng updated_at của client nhưng không vượt quá giờ server.
   * @param {{ fromSync?: boolean }} [opts]
   * @returns {{ applied: boolean, conflict: boolean, conversation: object }}
   */
  function rename(userId, input, opts) {
    const src = input || {};
    const { conv } = access.requireGroup(src.conversation_id, userId);
    const name = V.normalizeGroupName(src.name);
    if (!name.ok) throw errors.validation(name.error);
    const now = nowIso();
    const at = opts && opts.fromSync ? clampClientTime(src.updated_at, now) : now;
    const currentAt = conv.name_updated_at || conv.created_at;
    if (!isNewer(at, userId, currentAt, conv.name_updated_by)) {
      logger.warn(CAT, 'rename_conflict', { conversation_id: String(conv.id), incoming_at: at, current_at: currentAt }, { userId });
      return { applied: false, conflict: true, conversation: toWire(conv, userId) };
    }
    let systemMsg;
    repos.conversations.transaction(() => {
      repos.conversations.updateName({ id: conv.id, name: name.value, name_updated_at: at, name_updated_by: userId, now });
      systemMsg = messageService.insertSystem(conv.id, userId, `${displayName(userId)} đã đổi tên nhóm thành "${name.value}"`);
    });
    logger.logAudit(C.LOG_LEVEL.AUDIT, CAT, 'group_renamed', userId, { conversation_id: String(conv.id) });
    emitConversation(conv.id, W.CONV.UPDATED, access.memberIds(conv.id));
    messageService.broadcastNew([systemMsg]);
    return { applied: true, conflict: false, conversation: toWire(repos.conversations.findById(conv.id), userId) };
  }

  /**
   * Thêm member trực tiếp (đã kiểm tra quyền). Gửi conv:updated cho member cũ, conv:created cho member mới.
   */
  function addMembersDirectly(conv, actorId, ids, verb) {
    const now = nowIso();
    const before = access.memberIds(conv.id);
    let systemMsg;
    repos.conversations.transaction(() => {
      for (const id of ids) {
        repos.conversations.removePending(conv.id, id);
        repos.conversations.addMember(conv.id, id, ROLE.MEMBER, now);
      }
      repos.conversations.touch(conv.id, now);
      systemMsg = messageService.insertSystem(conv.id, actorId, `${displayName(actorId)} đã ${verb} ${names(ids)}`);
    });
    emitConversation(conv.id, W.CONV.UPDATED, before);
    emitConversation(conv.id, W.CONV.CREATED, ids);
    messageService.broadcastNew([systemMsg]);
  }

  /**
   * conv:addMember — owner/admin thêm trực tiếp; member → pending chờ duyệt.
   * @returns {{ added: number[], pending: number[] }}
   */
  function addMembers(userId, input) {
    const src = input || {};
    const { conv, member } = access.requireGroup(src.conversation_id, userId);
    const ids = normalizeUserIds(src.user_ids, userId).filter((id) => !repos.conversations.getMember(conv.id, id));
    if (!ids.length) return { added: [], pending: [] };
    if (isManagerRole(member.role)) {
      addMembersDirectly(conv, userId, ids, 'thêm');
      logger.logAudit(C.LOG_LEVEL.AUDIT, CAT, 'group_member_added', userId, { conversation_id: String(conv.id), user_ids: ids });
      return { added: ids, pending: [] };
    }
    const now = nowIso();
    repos.conversations.transaction(() => {
      for (const id of ids) repos.conversations.addPending(conv.id, id, userId, now);
    });
    logger.logAudit(C.LOG_LEVEL.AUDIT, CAT, 'group_member_requested', userId, { conversation_id: String(conv.id), user_ids: ids });
    emitPendingCount(conv.id);
    return { added: [], pending: ids };
  }

  const requireTargetUserId = (raw) => {
    const id = Number(raw);
    if (!Number.isSafeInteger(id) || id <= 0) throw errors.validation('user_id không hợp lệ');
    return id;
  };

  /** Duyệt yêu cầu thêm member. */
  function approveMember(userId, input) {
    const src = input || {};
    const { conv } = access.requireGroupManager(src.conversation_id, userId);
    const targetId = requireTargetUserId(src.user_id);
    if (!repos.conversations.getPending(conv.id, targetId)) throw errors.notFound('Không có yêu cầu chờ duyệt');
    addMembersDirectly(conv, userId, [targetId], 'duyệt thêm');
    logger.logAudit(C.LOG_LEVEL.AUDIT, CAT, 'group_member_approved', userId, { conversation_id: String(conv.id), user_id: targetId });
    emitPendingCount(conv.id);
    return { ok: true };
  }

  /** Từ chối yêu cầu thêm member. */
  function rejectMember(userId, input) {
    const src = input || {};
    const { conv } = access.requireGroupManager(src.conversation_id, userId);
    const targetId = requireTargetUserId(src.user_id);
    if (!repos.conversations.removePending(conv.id, targetId)) throw errors.notFound('Không có yêu cầu chờ duyệt');
    logger.logAudit(C.LOG_LEVEL.AUDIT, CAT, 'group_member_rejected', userId, { conversation_id: String(conv.id), user_id: targetId });
    emitPendingCount(conv.id);
    return { ok: true };
  }

  /** Xóa member (owner/admin; không xóa owner; không tự xóa mình). */
  function removeMember(userId, input) {
    const src = input || {};
    const { conv } = access.requireGroupManager(src.conversation_id, userId);
    const targetId = requireTargetUserId(src.user_id);
    if (targetId === userId) throw errors.validation('Không thể tự xóa chính mình khỏi nhóm');
    const target = repos.conversations.getMember(conv.id, targetId);
    if (!target) throw errors.notFound('Người này không phải thành viên nhóm');
    if (target.role === ROLE.OWNER) throw errors.forbidden('Không thể xóa trưởng nhóm');
    let systemMsg;
    repos.conversations.transaction(() => {
      repos.conversations.removeMember(conv.id, targetId);
      repos.conversations.touch(conv.id, nowIso());
      systemMsg = messageService.insertSystem(conv.id, userId, `${displayName(userId)} đã xóa ${displayName(targetId)} khỏi nhóm`);
    });
    logger.logAudit(C.LOG_LEVEL.AUDIT, CAT, 'group_member_removed', userId, { conversation_id: String(conv.id), user_id: targetId });
    hub.toUsers([targetId], W.CONV.DELETED, { conversation_id: String(conv.id) });
    emitConversation(conv.id, W.CONV.UPDATED, access.memberIds(conv.id));
    messageService.broadcastNew([systemMsg]);
    return { ok: true };
  }

  /** Set/Hủy phó nhóm — chỉ owner. */
  function setAdmin(userId, input) {
    const src = input || {};
    const { conv, member } = access.requireGroup(src.conversation_id, userId);
    if (member.role !== ROLE.OWNER) throw errors.forbidden('Chỉ trưởng nhóm được đặt phó nhóm');
    const targetId = requireTargetUserId(src.user_id);
    const target = repos.conversations.getMember(conv.id, targetId);
    if (!target) throw errors.notFound('Người này không phải thành viên nhóm');
    if (target.role === ROLE.OWNER) throw errors.validation('Không thể đổi vai trò của trưởng nhóm');
    const role = src.is_admin ? ROLE.ADMIN : ROLE.MEMBER;
    if (target.role === role) return { ok: true };
    const text = src.is_admin
      ? `${displayName(userId)} đã đặt ${displayName(targetId)} làm phó nhóm`
      : `${displayName(userId)} đã hủy quyền phó nhóm của ${displayName(targetId)}`;
    let systemMsg;
    repos.conversations.transaction(() => {
      repos.conversations.setRole(conv.id, targetId, role);
      repos.conversations.touch(conv.id, nowIso());
      systemMsg = messageService.insertSystem(conv.id, userId, text);
    });
    logger.logAudit(C.LOG_LEVEL.AUDIT, CAT, 'group_admin_set', userId, { conversation_id: String(conv.id), user_id: targetId, is_admin: !!src.is_admin });
    emitConversation(conv.id, W.CONV.UPDATED, access.memberIds(conv.id));
    messageService.broadcastNew([systemMsg]);
    return { ok: true };
  }

  /** Xóa nhóm — chỉ owner. Gửi conv:deleted tới mọi member. */
  function remove(userId, input) {
    const src = input || {};
    const { conv, member } = access.requireGroup(src.conversation_id, userId);
    if (member.role !== ROLE.OWNER) throw errors.forbidden('Chỉ trưởng nhóm được xóa nhóm');
    const memberIds = access.memberIds(conv.id);
    repos.conversations.remove(conv.id);
    logger.logAudit(C.LOG_LEVEL.AUDIT, CAT, 'group_deleted', userId, { conversation_id: String(conv.id), name: conv.name });
    hub.toUsers(memberIds, W.CONV.DELETED, { conversation_id: String(conv.id) });
    return { ok: true };
  }

  /** Danh sách pending (owner/admin). */
  function listPending(userId, input) {
    const src = input || {};
    const { conv } = access.requireGroupManager(src.conversation_id, userId);
    const pending = repos.conversations.listPending(conv.id).map((p) => ({
      user_id: p.user_id,
      requested_by: p.requested_by,
      created_at: p.created_at,
    }));
    return { conversation_id: String(conv.id), pending };
  }

  return {
    toWire,
    listForUser,
    getForUser,
    create,
    createGroup,
    rename,
    addMembers,
    approveMember,
    rejectMember,
    removeMember,
    setAdmin,
    remove,
    listPending,
  };
}

module.exports = { createConversationService };
