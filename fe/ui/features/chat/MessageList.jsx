import { Fragment, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { SCROLL_BOTTOM_THRESHOLD, SCROLL_TOP_THRESHOLD } from '../../app/config/app.config.js';
import { dayKey, formatDayLabel, messageTime } from '../../utils/format.js';
import ScrollToBottomButton from './ScrollToBottomButton.jsx';

/**
 * Vùng cuộn danh sách tin.
 * - Cuộn lên đầu → onLoadOlder(), GIỮ vị trí màn hình (bù chênh lệch scrollHeight).
 * - Đang ở cuối → tin mới/ảnh tải xong vẫn dính đáy (ResizeObserver).
 * - Đang cuộn lên → nút ↓ (kèm số tin mới).
 * API qua `apiRef`: scrollToBottom(smooth), scrollToMessage(id) → boolean, isAtBottom().
 */
export default function MessageList({
  apiRef,
  messages,
  loading,
  loadingOlder,
  hasOlder,
  detached,
  unseenCount,
  onLoadOlder,
  onJumpToLatest,
  onReachBottom,
  renderMessage,
}) {
  const containerRef = useRef(null);
  const contentRef = useRef(null);
  const atBottomRef = useRef(true);
  const anchorRef = useRef(null); // {scrollHeight, scrollTop} trước khi prepend
  const pendingBottomRef = useRef(true); // cuộn xuống đáy ở lần render kế tiếp
  const lastIdRef = useRef(null);
  const [showDown, setShowDown] = useState(false);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = containerRef.current;
    if (!el) return;
    atBottomRef.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  const scrollToMessage = useCallback((clientMessageId) => {
    const el = containerRef.current;
    if (!el) return false;
    const node = el.querySelector(`[data-mid="${CSS.escape(clientMessageId)}"]`);
    if (!node) return false;
    atBottomRef.current = false;
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return true;
  }, []);

  useImperativeHandle(
    apiRef,
    () => ({
      scrollToBottom: (smooth) => {
        pendingBottomRef.current = true;
        scrollToBottom(smooth);
      },
      scrollToMessage,
      isAtBottom: () => atBottomRef.current,
    }),
    [scrollToBottom, scrollToMessage],
  );

  const requestOlder = useCallback(async () => {
    const el = containerRef.current;
    if (!el || loadingOlder || loading || !hasOlder) return;
    anchorRef.current = { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop };
    const added = await onLoadOlder();
    if (!added) anchorRef.current = null;
  }, [loadingOlder, loading, hasOlder, onLoadOlder]);

  // Sau mỗi lần danh sách đổi: giữ vị trí khi prepend / dính đáy khi append
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const lastId = messages.length ? messages[messages.length - 1].client_message_id : null;
    const appended = lastId !== lastIdRef.current;
    lastIdRef.current = lastId;

    if (anchorRef.current) {
      const { scrollHeight, scrollTop } = anchorRef.current;
      el.scrollTop = el.scrollHeight - scrollHeight + scrollTop;
      anchorRef.current = null;
      return;
    }
    if (pendingBottomRef.current && !loading) {
      pendingBottomRef.current = false;
      scrollToBottom(false);
      return;
    }
    if (appended && atBottomRef.current) scrollToBottom(false);
  }, [messages, loading, scrollToBottom]);

  // Ảnh tải xong làm nội dung cao lên → nếu đang ở đáy thì giữ ở đáy
  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      if (atBottomRef.current && !anchorRef.current) {
        const el = containerRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      }
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  // Nội dung chưa đủ cao để cuộn → tự tải thêm tin cũ
  useEffect(() => {
    const el = containerRef.current;
    if (!el || loading || loadingOlder || !hasOlder) return;
    if (el.scrollHeight <= el.clientHeight + SCROLL_TOP_THRESHOLD) requestOlder();
  }, [messages, loading, loadingOlder, hasOlder, requestOlder]);

  const onScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distance < SCROLL_BOTTOM_THRESHOLD;
    atBottomRef.current = atBottom;
    setShowDown(!atBottom);
    if (atBottom && !detached) onReachBottom();
    if (el.scrollTop < SCROLL_TOP_THRESHOLD) requestOlder();
  };

  const handleDownClick = () => {
    if (detached) {
      pendingBottomRef.current = true;
      onJumpToLatest();
    } else {
      scrollToBottom(true);
    }
  };

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={containerRef} onScroll={onScroll} className="h-full overflow-y-auto overflow-x-hidden" role="log" aria-live="polite">
        <div ref={contentRef} className="flex min-h-full flex-col justify-end py-2">
          {loadingOlder && <p className="py-2 text-center text-xs text-muted">Đang tải tin cũ…</p>}
          {!hasOlder && !loading && messages.length > 0 && <p className="py-2 text-center text-xs text-muted">— Đầu cuộc trò chuyện —</p>}
          {loading && messages.length === 0 && <p className="py-6 text-center text-sm text-muted">Đang tải tin nhắn…</p>}
          {!loading && messages.length === 0 && <p className="py-6 text-center text-sm text-muted">Chưa có tin nhắn. Hãy gửi lời chào 👋</p>}
          {messages.map((message, index) => {
            const prev = index > 0 ? messages[index - 1] : null;
            const key = dayKey(messageTime(message));
            const showDay = !prev || key !== dayKey(messageTime(prev));
            return (
              <Fragment key={message.client_message_id}>
                {showDay && key && (
                  <div className="my-2 flex items-center gap-3 px-6 text-[11px] text-muted">
                    <span className="h-px flex-1 bg-border" />
                    {formatDayLabel(messageTime(message))}
                    <span className="h-px flex-1 bg-border" />
                  </div>
                )}
                {renderMessage(message, prev)}
              </Fragment>
            );
          })}
        </div>
      </div>
      {(showDown || detached) && <ScrollToBottomButton count={unseenCount} onClick={handleDownClick} />}
    </div>
  );
}
