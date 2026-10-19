/**
 * IPC: đọc dữ liệu local client.db (lịch sử chat hoạt động không cần server).
 */
'use strict';

const { IPC_INVOKE: I } = require('../../../ipc/channels');
const { MESSAGE_TYPE, SEARCH_RESULT_LIMIT, PAGE_SIZE, ERROR_CODE } = require('../../../shared/constants');
const { extractLinks } = require('../../../shared/validators');
const { AppError, validationError } = require('../../core/utils/errors');
const { toLocalMessage } = require('./mappers');
const { RESERVED_SETTING_PREFIXES } = require('../auth/sessionService');

const MEDIA_LIMIT = 300;
const MEDIA_KIND = Object.freeze({ images: MESSAGE_TYPE.IMAGE, files: MESSAGE_TYPE.FILE, links: 'links' });
const SETTING_KEY_REGEX = /^[a-zA-Z0-9_.:-]{1,64}$/;

function assertConvId(id) {
  if (id === undefined || id === null || String(id) === '') throw validationError('Thiếu conversation_id.');
  return String(id);
}

/** Key settings renderer được phép đọc/ghi (chặn key nội bộ chứa token/khóa) */
function assertPublicSettingKey(key) {
  if (typeof key !== 'string' || !SETTING_KEY_REGEX.test(key)) throw validationError('Tên cài đặt không hợp lệ.');
  if (RESERVED_SETTING_PREFIXES.some((p) => key.startsWith(p))) {
    throw new AppError(ERROR_CODE.FORBIDDEN, 'Không được truy cập cài đặt hệ thống.');
  }
}

/**
 * @param {{ repos: object, view: object }} ctx
 */
function createDbHandlers(ctx) {
  const { repos, view } = ctx;
  const mapPage = (page) => ({ ...page, messages: page.messages.map((m) => toLocalMessage(m)) });

  return {
    [I.DB_LIST_CONVERSATIONS]: () => view.listConversations(),
    [I.DB_GET_CONVERSATION]: (p) => view.conversation(assertConvId(p.conversation_id)),
    [I.DB_GET_MESSAGES]: (p) => mapPage(repos.messages.listPage(assertConvId(p.conversation_id), p.before || null, PAGE_SIZE)),
    [I.DB_GET_MESSAGES_AROUND]: (p) => {
      const page = repos.messages.listAround(assertConvId(p.conversation_id), String(p.client_message_id || ''), PAGE_SIZE);
      if (!page) throw new AppError(ERROR_CODE.NOT_FOUND, 'Không tìm thấy tin nhắn trong lịch sử trên máy.');
      return mapPage(page);
    },
    [I.DB_SEARCH_MESSAGES]: (p) => {
      const keyword = String(p.keyword || '').trim();
      if (!keyword) return [];
      return repos.messages.search(assertConvId(p.conversation_id), keyword, SEARCH_RESULT_LIMIT).map((m) => toLocalMessage(m));
    },
    [I.DB_GET_MEDIA]: (p) => {
      const convId = assertConvId(p.conversation_id);
      const kind = MEDIA_KIND[p.kind];
      if (!kind) throw validationError('Loại nội dung không hợp lệ.');
      if (kind !== 'links') return repos.messages.listMedia(convId, kind, MEDIA_LIMIT).map((m) => toLocalMessage(m));
      // Mỗi link 1 dòng, kèm thông tin tin gốc để click cuộn tới
      return repos.messages
        .listLinkCandidates(convId, MEDIA_LIMIT)
        .flatMap((m) => extractLinks(m.content).map((url) => ({ ...toLocalMessage(m), url })));
    },
    [I.DB_LIST_USERS]: () => view.listUsers(),
    [I.DB_GET_SETTING]: (p) => {
      assertPublicSettingKey(p.key);
      return repos.settings.get(p.key, null);
    },
    [I.DB_SET_SETTING]: (p) => {
      assertPublicSettingKey(p.key);
      repos.settings.set(p.key, p.value === undefined ? null : p.value);
      return { ok: true };
    },
  };
}

module.exports = { createDbHandlers };
