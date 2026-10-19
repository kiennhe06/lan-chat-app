/**
 * Tạo toàn bộ repository từ 1 kết nối DB.
 */
'use strict';

const { createMessageRepo } = require('../../modules/chat/messageRepo');
const { createConversationCacheRepo } = require('../../modules/chat/conversationCacheRepo');
const { createUserCacheRepo } = require('../../modules/chat/userCacheRepo');
const { createSettingsRepo } = require('./settingsRepo');
const { createActionQueueRepo } = require('../../modules/sync/actionQueueRepo');
const { createPeersRepo } = require('../../modules/p2p/peersRepo');
const { createVectorClockRepo } = require('../../modules/chat/vectorClockRepo');
const { createP2pFilesRepo } = require('../../modules/p2p/p2pFilesRepo');
const { createDownloadsRepo } = require('../../modules/file/downloadsRepo');

/**
 * @param {import('better-sqlite3').Database} db
 */
function createRepositories(db) {
  return {
    db,
    messages: createMessageRepo(db),
    conversations: createConversationCacheRepo(db),
    users: createUserCacheRepo(db),
    settings: createSettingsRepo(db),
    actions: createActionQueueRepo(db),
    peers: createPeersRepo(db),
    vectorClock: createVectorClockRepo(db),
    p2pFiles: createP2pFilesRepo(db),
    downloads: createDownloadsRepo(db),
    /** Chạy fn trong 1 transaction */
    transaction: (fn) => db.transaction(fn)(),
  };
}

module.exports = { createRepositories };
