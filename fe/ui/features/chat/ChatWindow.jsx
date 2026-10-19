import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import C, { MESSAGE_STATUS, MESSAGE_TYPE } from '../../app/config/constants.js';
import { MARK_READ_DEBOUNCE_MS } from '../../app/config/app.config.js';
import { useChat } from '../../app/context/ChatContext.jsx';
import { useConfirm } from '../../app/context/ConfirmContext.jsx';
import { useToast } from '../../app/context/ToastContext.jsx';
import { useChatHistory } from './useChatHistory.js';
import { useMessageActions } from './useMessageActions.js';
import { useTyping } from './useTyping.js';
import { useUploadProgress } from './useUploadProgress.js';
import { canPinIn, computeMessageStatus, isGroupConversation } from './messageUtils.js';
import ChatHeader from './ChatHeader.jsx';
import Composer from './Composer.jsx';
import GroupInfoPanel from '../group/GroupInfoPanel.jsx';
import { IconInfo, IconSearch } from '../../components/Icons.jsx';
import Lightbox from './Lightbox.jsx';
import MessageBubble, { MESSAGE_ACTION } from './MessageBubble.jsx';
import MessageList from './MessageList.jsx';
import PinnedBanner from './PinnedBanner.jsx';
import SearchPanel from './SearchPanel.jsx';
import TypingIndicator from './TypingIndicator.jsx';
// [CALL-DISABLED 1/6] import hook — bỏ comment để bật lại gọi thoại
// import { useWebRTC } from '../call/useWebRTC.js';
// [CALL-DISABLED 2/6] import overlay — bỏ comment để bật lại gọi thoại
// import CallOverlay from '../call/CallOverlay.jsx';

const PANEL = Object.freeze({ SEARCH: 'search', INFO: 'info' });
const EMPTY_LIST = Object.freeze([]);
const JUMP_RETRY_FRAMES = 20;

/**
 * Khung chat của 1 conversation: header, banner ghim, danh sách tin, typing, ô soạn,
 * panel tìm kiếm / thông tin nhóm, lightbox, kéo-thả file.
 */
export default function ChatWindow({ conversation }) {
  const { me, users, connection, getConversationTitle, getDirectPeer, markRead } = useChat();
  const toast = useToast();
  const confirm = useConfirm();
  const conversationId = String(conversation.id);
  const isGroup = isGroupConversation(conversation);
  const peer = getDirectPeer(conversation);
  const title = getConversationTitle(conversation);

  const listApiRef = useRef(null);
  const markReadTimer = useRef(null);
  const highlightTimer = useRef(null);
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [panel, setPanel] = useState(null);
  const [lightboxFile, setLightboxFile] = useState(null);
  const [highlightId, setHighlightId] = useState(null);
  const [unseenCount, setUnseenCount] = useState(0);
  const [dragOver, setDragOver] = useState(false);

  const { typers, notifyTyping, clearTyper } = useTyping(conversationId, me.id);
  const uploads = useUploadProgress();
  const actions = useMessageActions(conversationId);

  // [CALL-DISABLED 3/6] hook call — bỏ comment để bật lại
  // const webrtc = useWebRTC({ myUser: me, onError: toast.error });

  // [CALL-DISABLED 4/6] useEffect listener tín hiệu cuộc gọi — bỏ comment để bật lại
  // useEffect(() => webrtc.subscribeCallEvents(webrtc.handleCallEvent), [webrtc.subscribeCallEvents, webrtc.handleCallEvent]);

  /** Đánh dấu đã đọc (gộp nhiều lần gọi liên tiếp, chỉ khi cửa sổ đang focus). */
  const scheduleMarkRead = useCallback(() => {
    clearTimeout(markReadTimer.current);
    markReadTimer.current = setTimeout(() => {
      if (document.hasFocus()) markRead(conversationId);
    }, MARK_READ_DEBOUNCE_MS);
  }, [markRead, conversationId]);

  useEffect(() => {
    markRead(conversationId);
    const onFocus = () => listApiRef.current && listApiRef.current.isAtBottom() && scheduleMarkRead();
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      clearTimeout(markReadTimer.current);
      clearTimeout(highlightTimer.current);
    };
  }, [conversationId, markRead, scheduleMarkRead]);

  const onIncoming = useCallback(
    (message, info) => {
      if (!info.isNew || Number(message.sender_id) === Number(me.id)) return;
      clearTyper(Number(message.sender_id));
      const atBottom = listApiRef.current ? listApiRef.current.isAtBottom() : true;
      if (atBottom && info.appended) scheduleMarkRead();
      else setUnseenCount((n) => n + 1);
    },
    [me.id, clearTyper, scheduleMarkRead],
  );

  const history = useChatHistory(conversationId, { isOnline: connection.isOnline, onIncoming });

  // ===== Trạng thái tin của mình (PROTOCOL §3.2) =====
  const statusData = useMemo(() => {
    const map = new Map();
    let lastReadOwnId = null;
    history.messages.forEach((m) => {
      if (Number(m.sender_id) !== Number(me.id) || m.type === MESSAGE_TYPE.SYSTEM) return;
      const s = computeMessageStatus(m, { members: conversation.members }, me.id);
      map.set(m.client_message_id, s);
      if (s.status === MESSAGE_STATUS.READ) lastReadOwnId = m.client_message_id;
    });
    return { map, lastReadOwnId };
    // Chỉ phụ thuộc members (con trỏ đã nhận/đã đọc) thay vì cả object conversation để tránh tính lại thừa
  }, [history.messages, conversation.members, me.id]);

  // Tên được mention trong từng tin (để highlight)
  const mentionNamesById = useMemo(() => {
    const map = new Map();
    history.messages.forEach((m) => {
      if (m.mentions && m.mentions.length) {
        map.set(
          m.client_message_id,
          m.mentions.map((id) => users[id] && users[id].display_name).filter(Boolean),
        );
      }
    });
    return map;
  }, [history.messages, users]);

  const pinnedIds = useMemo(() => new Set((conversation.pinned || []).map((p) => p.client_message_id)), [conversation.pinned]);
  const canPin = canPinIn(conversation, me.id);

  const mentionCandidates = useMemo(
    () =>
      (conversation.members || [])
        .filter((m) => Number(m.user_id) !== Number(me.id))
        .map((m) => users[m.user_id])
        .filter(Boolean),
    [conversation.members, users, me.id],
  );

  const senderName = useCallback(
    (id) => (Number(id) === Number(me.id) ? 'Bạn' : (users[id] && users[id].display_name) || 'Người dùng'),
    [users, me.id],
  );

  // ===== Điều hướng tới tin (reply / search / pin / media) =====
  const jumpTo = useCallback(
    async (clientMessageId) => {
      const found = await history.loadAround(clientMessageId);
      if (!found) {
        toast.info('Không tìm thấy tin nhắn gốc (có thể chưa được đồng bộ về máy này)');
        return;
      }
      let frames = JUMP_RETRY_FRAMES;
      const attempt = () => {
        if (listApiRef.current && listApiRef.current.scrollToMessage(clientMessageId)) {
          setHighlightId(null);
          requestAnimationFrame(() => setHighlightId(clientMessageId));
          clearTimeout(highlightTimer.current);
          highlightTimer.current = setTimeout(() => setHighlightId(null), C.HIGHLIGHT_DURATION_MS);
        } else if (frames > 0) {
          frames -= 1;
          requestAnimationFrame(attempt);
        }
      };
      attempt();
    },
    [history, toast],
  );

  const afterSend = useCallback(
    (message) => {
      if (message) history.upsertMessage(message);
      if (history.detached) history.jumpToLatest();
      setUnseenCount(0);
      requestAnimationFrame(() => listApiRef.current && listApiRef.current.scrollToBottom(false));
    },
    [history],
  );

  // ===== Gửi =====
  const sendText = async ({ content, mentions }) => {
    const replyId = replyTo ? replyTo.client_message_id : null;
    setReplyTo(null);
    afterSend(await actions.sendText({ content, reply_to: replyId, mentions }));
  };

  const submitEdit = async (content) => {
    const target = editing;
    setEditing(null);
    await actions.edit(target.client_message_id, content);
  };

  const sendPasted = async ({ file, content }) => {
    const replyId = replyTo ? replyTo.client_message_id : null;
    setReplyTo(null);
    afterSend(await actions.sendBlob({ file, content, reply_to: replyId, asImage: true }));
  };

  /** Gửi danh sách file (từ dialog chọn hoặc kéo thả) */
  const sendFiles = async (files) => {
    for (const f of files) {
      if (f.size > C.MAX_FILE_SIZE) {
        toast.error(`"${f.name}" vượt quá giới hạn ${Math.round(C.MAX_FILE_SIZE / 1024 / 1024)}MB`);
        continue;
      }
      try {
        afterSend(await f.send());
      } catch (err) {
        toast.error((err && err.message) || `Không gửi được "${f.name}"`);
      }
    }
  };

  const attachFiles = async () => {
    try {
      const picked = await actions.pickFiles();
      await sendFiles(picked.map((p) => ({ name: p.name, size: p.size, send: () => actions.sendFilePath(p) })));
    } catch (err) {
      toast.error((err && err.message) || 'Không chọn được file');
    }
  };

  const onDrop = async (e) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer ? e.dataTransfer.files : []);
    if (!files.length) return;
    await sendFiles(
      files.map((file) => {
        const path = actions.pathForFile(file);
        const isImage = file.type.startsWith(C.IMAGE_MIME_PREFIX);
        return {
          name: file.name,
          size: file.size,
          send: () => (path ? actions.sendFilePath({ path, name: file.name, mime_type: file.type }) : actions.sendBlob({ file, asImage: isImage })),
        };
      }),
    );
  };

  // ===== Menu tin nhắn (ref ổn định cho MessageBubble memo) =====
  const actionHandlerRef = useRef(null);
  actionHandlerRef.current = async (key, message) => {
    try {
      switch (key) {
        case MESSAGE_ACTION.COPY:
          await actions.copyText(message.content);
          break;
        case MESSAGE_ACTION.REPLY:
          setEditing(null);
          setReplyTo(message);
          break;
        case MESSAGE_ACTION.EDIT:
          setReplyTo(null);
          setEditing(message);
          break;
        case MESSAGE_ACTION.PIN:
          await actions.pin(message.client_message_id);
          break;
        case MESSAGE_ACTION.UNPIN:
          await actions.unpin(message.client_message_id);
          break;
        case MESSAGE_ACTION.RECALL:
          if (
            await confirm({
              title: 'Thu hồi tin nhắn',
              message: 'Thu hồi tin nhắn này với mọi người?',
              confirmText: 'Thu hồi',
              danger: true,
            })
          ) {
            await actions.recall(message.client_message_id);
          }
          break;
        case MESSAGE_ACTION.RETRY:
          await actions.retry(message.client_message_id);
          break;
        case MESSAGE_ACTION.CANCEL_UPLOAD:
          await actions.cancelUpload(message.client_message_id);
          break;
        default:
          break;
      }
    } catch (err) {
      toast.error((err && err.message) || 'Thao tác thất bại');
    }
  };
  const onAction = useCallback((key, message) => actionHandlerRef.current(key, message), []);
  const jumpRef = useRef(jumpTo);
  jumpRef.current = jumpTo;
  const onJump = useCallback((id) => jumpRef.current(id), []);
  const onOpenImage = useCallback((file) => setLightboxFile(file), []);

  const renderMessage = (message, prev) => {
    const own = Number(message.sender_id) === Number(me.id);
    const status = statusData.map.get(message.client_message_id);
    const isLastRead = status && status.status === MESSAGE_STATUS.READ && statusData.lastReadOwnId === message.client_message_id;
    // Avatar "đã đọc" chỉ hiện ở tin đã đọc mới nhất; các tin đã đọc cũ hơn không lặp lại
    const showStatus = Boolean(status) && (status.status !== MESSAGE_STATUS.READ || isLastRead);
    const showSender = isGroup && !own && (!prev || prev.sender_id !== message.sender_id || prev.type === MESSAGE_TYPE.SYSTEM);
    const replyTarget = message.reply_to ? history.messagesById.get(message.reply_to) || null : null;
    return (
      <MessageBubble
        message={message}
        own={own}
        isGroup={isGroup}
        sender={users[message.sender_id]}
        showSender={showSender}
        status={status ? status.status : null}
        syncState={status ? status.syncState : null}
        readers={isLastRead ? status.readerIds.map((id) => users[id] || { id, display_name: '?' }) : EMPTY_LIST}
        readerId={isLastRead && !isGroup ? status.readerIds[0] : null}
        totalMembers={status ? status.totalMembers : 0}
        showStatus={showStatus}
        replyTarget={replyTarget}
        replySenderName={replyTarget ? senderName(replyTarget.sender_id) : ''}
        highlighted={highlightId === message.client_message_id}
        upload={uploads[message.client_message_id] || null}
        mentionNames={mentionNamesById.get(message.client_message_id) || EMPTY_LIST}
        canPin={canPin}
        isPinned={pinnedIds.has(message.client_message_id)}
        onAction={onAction}
        onJump={onJump}
        onOpenImage={onOpenImage}
      />
    );
  };

  const subtitle = isGroup
    ? `${(conversation.members || []).length} thành viên`
    : peer && peer.online
      ? `Đang hoạt động${connection.isOfflineP2P ? ' · P2P' : ''}`
      : 'Ngoại tuyến';

  const togglePanel = (name) => setPanel((p) => (p === name ? null : name));

  return (
    <div className="flex h-full min-w-0 flex-1">
      <section
        className="relative flex min-w-0 flex-1 flex-col bg-bg"
        onDragOver={(e) => {
          if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
            e.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false);
        }}
        onDrop={onDrop}
      >
        <ChatHeader title={title} subtitle={subtitle} isGroup={isGroup} peer={peer}>
          {/* [CALL-DISABLED 5/6] nút 📞 Gọi — bỏ comment để bật lại
          {!isGroup && peer && (
            <button type="button" className="icon-btn" title="Gọi thoại" aria-label="Gọi thoại" onClick={() => webrtc.startCall(peer.id, peer.display_name)}>
              📞
            </button>
          )}
          */}
          <button type="button" className={`icon-btn ${panel === PANEL.SEARCH ? 'bg-surface-2 text-primary' : ''}`} onClick={() => togglePanel(PANEL.SEARCH)} title="Tìm trong cuộc trò chuyện" aria-label="Tìm trong cuộc trò chuyện">
            <IconSearch />
          </button>
          {isGroup && (
            <button type="button" className={`icon-btn ${panel === PANEL.INFO ? 'bg-surface-2 text-primary' : ''}`} onClick={() => togglePanel(PANEL.INFO)} title="Thông tin nhóm" aria-label="Thông tin nhóm">
              <IconInfo />
            </button>
          )}
        </ChatHeader>

        <PinnedBanner pinned={conversation.pinned} canUnpin={canPin} onView={onJump} onUnpin={(id) => onAction(MESSAGE_ACTION.UNPIN, { client_message_id: id })} />

        {history.error && <p className="bg-danger/10 px-4 py-1 text-xs text-danger">{history.error}</p>}

        <MessageList
          apiRef={listApiRef}
          messages={history.messages}
          loading={history.loading}
          loadingOlder={history.loadingOlder}
          hasOlder={history.hasOlder}
          detached={history.detached}
          unseenCount={unseenCount}
          onLoadOlder={history.loadOlder}
          onJumpToLatest={() => {
            setUnseenCount(0);
            history.jumpToLatest();
          }}
          onReachBottom={() => {
            setUnseenCount(0);
            if (conversation.unread_count > 0) scheduleMarkRead();
          }}
          renderMessage={renderMessage}
        />

        <TypingIndicator typers={typers} />

        <Composer
          key={conversationId}
          isGroup={isGroup}
          mentionCandidates={mentionCandidates}
          replyTo={replyTo}
          replySenderName={replyTo ? senderName(replyTo.sender_id) : ''}
          editing={editing}
          onCancelReply={() => setReplyTo(null)}
          onCancelEdit={() => setEditing(null)}
          onSendText={sendText}
          onSubmitEdit={submitEdit}
          onSendPasted={sendPasted}
          onAttach={attachFiles}
          onTyping={notifyTyping}
        />

        {dragOver && (
          <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center border-4 border-dashed border-primary bg-primary/10">
            <p className="rounded-lg bg-surface px-4 py-2 font-semibold text-primary shadow">📎 Thả file vào đây để gửi</p>
          </div>
        )}
      </section>

      {panel === PANEL.SEARCH && <SearchPanel onSearch={actions.search} getSenderName={senderName} onPick={onJump} onClose={() => setPanel(null)} />}
      {panel === PANEL.INFO && isGroup && <GroupInfoPanel conversation={conversation} onClose={() => setPanel(null)} onJump={onJump} />}
      {lightboxFile && <Lightbox file={lightboxFile} onClose={() => setLightboxFile(null)} onError={toast.error} />}

      {/* [CALL-DISABLED 6/6] <CallOverlay> — bỏ comment để bật lại
      <CallOverlay call={webrtc.call} remoteStream={webrtc.remoteStream} peerUser={peer} onHangup={webrtc.hangup} onToggleMute={webrtc.toggleMute} />
      */}
    </div>
  );
}
