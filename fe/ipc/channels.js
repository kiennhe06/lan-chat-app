/**
 * Tên kênh IPC giữa Electron main ↔ preload. Chỉ dùng trong client (không sync sang server).
 * INVOKE: renderer gọi qua ipcRenderer.invoke → main xử lý bằng ipcMain.handle (trả Promise).
 * EVENTS: main đẩy xuống renderer qua webContents.send.
 * Payload chi tiết: docs/PROTOCOL.md mục 12.
 */
'use strict';

const IPC_INVOKE = Object.freeze({
  // app / hệ thống
  APP_GET_INFO: 'app:getInfo',
  APP_QUIT: 'app:quit',
  APP_GET_AUTOSTART: 'app:getAutoStart',
  APP_SET_AUTOSTART: 'app:setAutoStart',
  WINDOW_FOCUS: 'window:focus',

  // discovery server
  DISCOVERY_GET_SERVERS: 'discovery:getServers',
  DISCOVERY_PROBE: 'discovery:probe',

  // auth
  AUTH_LOGIN: 'auth:login',
  AUTH_REGISTER: 'auth:register',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_RESTORE: 'auth:restore',
  AUTH_GET_STATE: 'auth:getState',
  AUTH_CHANGE_PASSWORD: 'auth:changePassword',

  // socket thô tới server (chỉ online)
  SOCKET_REQUEST: 'socket:request',
  SOCKET_SEND: 'socket:send',
  SOCKET_GET_STATUS: 'socket:getStatus',

  // dữ liệu local (client.db)
  DB_LIST_CONVERSATIONS: 'db:listConversations',
  DB_GET_CONVERSATION: 'db:getConversation',
  DB_GET_MESSAGES: 'db:getMessages',
  DB_GET_MESSAGES_AROUND: 'db:getMessagesAround',
  DB_SEARCH_MESSAGES: 'db:searchMessages',
  DB_GET_MEDIA: 'db:getMedia',
  DB_LIST_USERS: 'db:listUsers',
  DB_GET_SETTING: 'db:getSetting',
  DB_SET_SETTING: 'db:setSetting',

  // chat (main tự chọn đường server / P2P / queue)
  CHAT_SEND_TEXT: 'chat:sendText',
  CHAT_SEND_FILE: 'chat:sendFile',
  CHAT_CANCEL_UPLOAD: 'chat:cancelUpload',
  CHAT_RETRY: 'chat:retry',
  CHAT_EDIT: 'chat:edit',
  CHAT_RECALL: 'chat:recall',
  CHAT_PIN: 'chat:pin',
  CHAT_UNPIN: 'chat:unpin',
  CHAT_MARK_READ: 'chat:markRead',
  CHAT_TYPING: 'chat:typing',
  CHAT_OPEN_DIRECT: 'chat:openDirect',
  CHAT_CREATE_GROUP: 'chat:createGroup',
  CHAT_RENAME_GROUP: 'chat:renameGroup',
  CHAT_GROUP_ACTION: 'chat:groupAction',
  CHAT_LOAD_OLDER_FROM_SERVER: 'chat:loadOlderFromServer',

  // profile
  PROFILE_UPDATE: 'profile:update',
  PROFILE_UPLOAD_AVATAR: 'profile:uploadAvatar',
  PROFILE_SET_THEME: 'profile:setTheme',

  // file
  FILE_PICK: 'file:pick',
  FILE_PICK_IMAGE: 'file:pickImage',
  FILE_DOWNLOAD: 'file:download',
  FILE_CANCEL_DOWNLOAD: 'file:cancelDownload',
  FILE_OPEN: 'file:open',
  FILE_SHOW_IN_FOLDER: 'file:showInFolder',
  FILE_EXISTS: 'file:exists',
  FILE_SAVE_IMAGE: 'file:saveImage',

  // log
  LOG_WRITE: 'log:write',

  // admin
  ADMIN_LIST_BLOCKED: 'admin:listBlocked',
  ADMIN_BLOCK_IP: 'admin:blockIp',
  ADMIN_UNBLOCK_IP: 'admin:unblockIp',

  // dialog native (không gây focus trap như window.confirm)
  DIALOG_CONFIRM: 'dialog:confirm',
  DIALOG_ALERT: 'dialog:alert',

  // call (tạm tắt)
  CALL_SIGNAL: 'call:signal',
});

const IPC_EVENTS = Object.freeze({
  CONNECTION: 'evt:connection',
  AUTH: 'evt:auth',
  SERVERS: 'evt:servers',
  PEERS: 'evt:peers',
  MESSAGE: 'evt:message',
  MESSAGE_REMOVED: 'evt:message-removed',
  CONVERSATION: 'evt:conversation',
  CONVERSATION_REMOVED: 'evt:conversation-removed',
  CONVERSATION_ID_CHANGED: 'evt:conversation-id-changed',
  USERS: 'evt:users',
  PRESENCE: 'evt:presence',
  TYPING: 'evt:typing',
  STATUS: 'evt:status',
  PINNED: 'evt:pinned',
  PENDING: 'evt:pending',
  SYNC_PROGRESS: 'evt:sync-progress',
  SYNC_DONE: 'evt:sync-done',
  UPLOAD_PROGRESS: 'evt:upload-progress',
  DOWNLOAD_PROGRESS: 'evt:download-progress',
  CALL: 'evt:call',
  NOTIFICATION_CLICK: 'evt:notification-click',
  TOAST: 'evt:toast',
});

/** Hành động nhóm đi qua CHAT_GROUP_ACTION (chỉ online) */
const GROUP_ACTION = Object.freeze({
  ADD_MEMBER: 'addMember',
  APPROVE_MEMBER: 'approveMember',
  REJECT_MEMBER: 'rejectMember',
  REMOVE_MEMBER: 'removeMember',
  SET_ADMIN: 'setAdmin',
  DELETE: 'delete',
  REQUEST_PENDING: 'requestPending',
});

/** Custom protocol phục vụ ảnh/avatar (offline-cached) */
const FILE_PROTOCOL = 'lcfile';

module.exports = { IPC_INVOKE, IPC_EVENTS, GROUP_ACTION, FILE_PROTOCOL };
