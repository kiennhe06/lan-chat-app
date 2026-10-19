/**
 * Khởi tạo toàn bộ repository từ 1 kết nối DB (dependency injection cho services).
 */
'use strict';

const { createUserRepo } = require('../../modules/auth/userRepo');
const { createSessionRepo } = require('../../modules/auth/sessionRepo');
const { createConversationRepo } = require('../../modules/chat/conversationRepo');
const { createMessageRepo } = require('../../modules/chat/messageRepo');
const { createFileRepo } = require('../../modules/file/fileRepo');
const { createBlockedIpRepo } = require('../../modules/admin/blockedIpRepo');
const { createAuditLogRepo } = require('../../modules/log/auditLogRepo');
const { createActionQueueRepo } = require('../../modules/sync/actionQueueRepo');
const { createVectorClockRepo } = require('../../modules/sync/vectorClockRepo');

/**
 * @param {import('better-sqlite3').Database} db
 */
function createRepositories(db) {
  return {
    users: createUserRepo(db),
    sessions: createSessionRepo(db),
    conversations: createConversationRepo(db),
    messages: createMessageRepo(db),
    files: createFileRepo(db),
    blockedIps: createBlockedIpRepo(db),
    auditLog: createAuditLogRepo(db),
    actionQueue: createActionQueueRepo(db),
    vectorClocks: createVectorClockRepo(db),
  };
}

module.exports = { createRepositories };
