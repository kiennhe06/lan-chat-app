import { memo, useMemo } from 'react';
import { MESSAGE_STATUS, MESSAGE_TYPE, MESSAGES_VI } from '../../app/config/constants.js';
import { formatTime, messageTime } from '../../utils/format.js';
import Avatar from '../../components/Avatar.jsx';
import FileMessage from './FileMessage.jsx';
import ImageMessage from './ImageMessage.jsx';
import MessageMenu from './MessageMenu.jsx';
import MessageStatus from './MessageStatus.jsx';
import ReplyQuote from './ReplyQuote.jsx';
import RichText from './RichText.jsx';

export const MESSAGE_ACTION = Object.freeze({
  COPY: 'copy',
  REPLY: 'reply',
  EDIT: 'edit',
  PIN: 'pin',
  UNPIN: 'unpin',
  RECALL: 'recall',
  RETRY: 'retry',
  CANCEL_UPLOAD: 'cancel_upload',
});

/** Danh sách mục menu theo quyền */
function buildMenuItems({ message, own, canPin, isPinned }) {
  if (message.recalled) return [];
  const items = [];
  const hasText = Boolean(message.content);
  if (hasText) items.push({ key: MESSAGE_ACTION.COPY, label: '📋 Copy' });
  items.push({ key: MESSAGE_ACTION.REPLY, label: '↩️ Trả lời' });
  if (own && message.type === MESSAGE_TYPE.TEXT) items.push({ key: MESSAGE_ACTION.EDIT, label: '✏️ Sửa' });
  if (canPin) items.push(isPinned ? { key: MESSAGE_ACTION.UNPIN, label: '📌 Bỏ ghim' } : { key: MESSAGE_ACTION.PIN, label: '📌 Ghim' });
  if (own) items.push({ key: MESSAGE_ACTION.RECALL, label: '↪️ Thu hồi', danger: true });
  return items;
}

/**
 * 1 dòng tin nhắn (memo — danh sách dài).
 * Cấu trúc: msg-row → msg-content-wrapper (align-items:flex-end) → [msg-bubble-line (menu + bubble, căn giữa dọc)] + [status ngoài bong bóng].
 */
function MessageBubble({
  message,
  own,
  isGroup,
  sender,
  showSender,
  status,
  syncState,
  readers,
  readerId,
  totalMembers,
  showStatus,
  replyTarget,
  replySenderName,
  highlighted,
  upload,
  mentionNames,
  canPin,
  isPinned,
  onAction,
  onJump,
  onOpenImage,
}) {
  const menuItems = useMemo(() => buildMenuItems({ message, own, canPin, isPinned }), [message, own, canPin, isPinned]);
  const handleMenu = (key) => onAction(key, message);

  if (message.type === MESSAGE_TYPE.SYSTEM) {
    return (
      <div data-mid={message.client_message_id} className="flex justify-center px-4 py-1">
        <span className="rounded-full bg-surface-2 px-3 py-0.5 text-center text-xs text-muted">{message.content}</span>
      </div>
    );
  }

  const bubbleColor = message.recalled
    ? 'border border-border bg-transparent italic text-muted'
    : own
      ? 'bg-bubble-own text-on-primary'
      : 'bg-bubble-other text-bubble-other-text';
  const isMedia = !message.recalled && message.type === MESSAGE_TYPE.IMAGE;

  return (
    <div data-mid={message.client_message_id} className={`msg-row flex px-4 py-0.5 ${own ? 'justify-end' : 'justify-start'} ${highlighted ? 'msg-highlight' : ''}`}>
      {!own && isGroup && (
        <div className="mr-2 w-8 shrink-0 self-end">{showSender && <Avatar user={sender} size={32} />}</div>
      )}
      <div className={`flex min-w-0 max-w-[72%] flex-col ${own ? 'items-end' : 'items-start'}`}>
        {showSender && <span className="mb-0.5 ml-1 text-xs font-medium text-muted">{(sender && sender.display_name) || 'Người dùng'}</span>}
        <div className="msg-content-wrapper max-w-full">
          <div className="msg-bubble-line">
            {own && <MessageMenu items={menuItems} onSelect={handleMenu} alignRight />}
            <div className={`msg-bubble rounded-2xl ${isMedia ? 'p-1.5' : 'px-3 py-2'} ${bubbleColor}`}>
              {message.recalled ? (
                <span>{MESSAGES_VI.RECALLED}</span>
              ) : (
                <>
                  {message.reply_to && (
                    <ReplyQuote target={replyTarget} senderName={replySenderName} own={own} onClick={() => onJump(message.reply_to)} />
                  )}
                  {message.type === MESSAGE_TYPE.IMAGE && (
                    <ImageMessage
                      message={message}
                      own={own}
                      upload={upload}
                      mentionNames={mentionNames}
                      onOpen={onOpenImage}
                      onCancelUpload={() => onAction(MESSAGE_ACTION.CANCEL_UPLOAD, message)}
                    />
                  )}
                  {message.type === MESSAGE_TYPE.FILE && (
                    <FileMessage message={message} own={own} upload={upload} onCancelUpload={() => onAction(MESSAGE_ACTION.CANCEL_UPLOAD, message)} />
                  )}
                  {message.type === MESSAGE_TYPE.TEXT && (
                    <div className="msg-text">
                      <RichText text={message.content} mentionNames={mentionNames} own={own} />
                    </div>
                  )}
                </>
              )}
              <div className={`mt-0.5 text-right text-[10px] leading-none ${own && !message.recalled ? 'text-white/70' : 'text-muted'} ${isMedia ? 'px-1 pb-0.5' : ''}`}>
                {isPinned && <span title="Đã ghim">📌 </span>}
                {formatTime(messageTime(message))}
                {message.edited && !message.recalled && <span> {MESSAGES_VI.EDITED_LABEL}</span>}
              </div>
            </div>
            {!own && <MessageMenu items={menuItems} onSelect={handleMenu} alignRight={false} />}
          </div>
          {own && (
            <div className="flex shrink-0 justify-end" style={{ minWidth: 16 }}>
              {showStatus && (
                <MessageStatus
                  status={status}
                  syncState={syncState}
                  readerId={readerId}
                  readers={readers}
                  totalMembers={totalMembers}
                  isGroup={isGroup}
                  onRetry={status === MESSAGE_STATUS.FAILED ? () => onAction(MESSAGE_ACTION.RETRY, message) : undefined}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(MessageBubble);
