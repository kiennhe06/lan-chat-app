import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import C from '../../app/config/constants.js';
import { MENTION_MAX_ITEMS } from '../../app/config/app.config.js';
import { foldText } from '../../utils/format.js';
import EmojiPicker from './EmojiPicker.jsx';
import { IconSend } from '../../components/Icons.jsx';
import MentionDropdown from './MentionDropdown.jsx';
import PastePreview from './PastePreview.jsx';
import ReplyPreview from './ReplyPreview.jsx';

// "@query" ngay trước con trỏ (đầu dòng hoặc sau khoảng trắng)
const MENTION_QUERY_REGEX = new RegExp(`(^|\\s)${C.MENTION_TRIGGER}([^\\s${C.MENTION_TRIGGER}]*)$`);

/**
 * Ô soạn tin: textarea tự giãn (max 120px), Enter gửi / Shift+Enter xuống dòng, emoji, đính kèm,
 * dán ảnh (preview + X đỏ), @mention trong nhóm, trả lời / sửa tin.
 */
export default function Composer({
  isGroup,
  mentionCandidates,
  replyTo,
  replySenderName,
  editing,
  onCancelReply,
  onCancelEdit,
  onSendText,
  onSubmitEdit,
  onSendPasted,
  onAttach,
  onTyping,
}) {
  const [text, setText] = useState('');
  const [pasted, setPasted] = useState(null); // {file, url}
  const [showEmoji, setShowEmoji] = useState(false);
  const [mention, setMention] = useState(null); // {query, start}
  const [mentionIndex, setMentionIndex] = useState(0);
  const [error, setError] = useState('');
  const textareaRef = useRef(null);
  const mentionedRef = useRef(new Map()); // userId → display_name đã chèn

  // Tự giãn chiều cao, quá 120px thì cuộn dọc
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (!text) {
      // Ô trống: về 1 dòng (scrollHeight có tính cả placeholder dài)
      el.style.height = '';
      el.style.overflowY = 'hidden';
      return;
    }
    el.style.height = 'auto';
    const max = C.TEXTAREA_MAX_HEIGHT;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [text]);

  // Vào chế độ sửa → nạp nội dung cũ (layout effect: có ngay trước khi người dùng gõ tiếp)
  useLayoutEffect(() => {
    if (editing) {
      setText(editing.content || '');
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [editing]);

  useEffect(() => {
    if (replyTo) textareaRef.current?.focus();
  }, [replyTo]);

  // Giải phóng blob URL của ảnh dán
  useEffect(() => () => pasted && URL.revokeObjectURL(pasted.url), [pasted]);

  const mentionItems = useMemo(() => {
    if (!mention || !isGroup) return [];
    const q = foldText(mention.query);
    return mentionCandidates
      .filter((u) => !q || foldText(u.display_name).includes(q) || foldText(u.username).includes(q))
      .slice(0, MENTION_MAX_ITEMS);
  }, [mention, isGroup, mentionCandidates]);

  const detectMention = (value, caret) => {
    if (!isGroup) return;
    const match = value.slice(0, caret).match(MENTION_QUERY_REGEX);
    if (match) {
      setMention({ query: match[2], start: caret - match[2].length - 1 });
      setMentionIndex(0);
    } else {
      setMention(null);
    }
  };

  const handleChange = (e) => {
    const { value, selectionStart } = e.target;
    setText(value);
    setError('');
    detectMention(value, selectionStart);
    if (value.trim()) onTyping();
  };

  /** Chèn "@Tên " thay cho "@query" đang gõ */
  const pickMention = useCallback(
    (user) => {
      const el = textareaRef.current;
      if (!el || !mention) return;
      const caret = el.selectionStart;
      const insert = `${C.MENTION_TRIGGER}${user.display_name} `;
      const next = text.slice(0, mention.start) + insert + text.slice(caret);
      mentionedRef.current.set(Number(user.id), user.display_name);
      setText(next);
      setMention(null);
      const pos = mention.start + insert.length;
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(pos, pos);
      });
    },
    [mention, text],
  );

  const insertAtCaret = (value) => {
    const el = textareaRef.current;
    const start = el ? el.selectionStart : text.length;
    const end = el ? el.selectionEnd : text.length;
    const next = text.slice(0, start) + value + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(start + value.length, start + value.length);
    });
  };

  const clearPasted = () => setPasted(null);

  const resetComposer = () => {
    setText('');
    setPasted(null);
    setMention(null);
    mentionedRef.current = new Map();
  };

  /** Chỉ giữ mention có "@Tên" còn trong nội dung */
  const collectMentions = (content) =>
    Array.from(mentionedRef.current.entries())
      .filter(([, name]) => content.includes(`${C.MENTION_TRIGGER}${name}`))
      .map(([id]) => id);

  const submit = async () => {
    const content = text.trim();
    try {
      if (pasted) {
        const file = pasted.file;
        resetComposer();
        await onSendPasted({ file, content, mentions: collectMentions(content) });
        return;
      }
      if (!content) return;
      if (editing) {
        if (content !== editing.content) await onSubmitEdit(content);
        else onCancelEdit();
        resetComposer();
        return;
      }
      const mentions = collectMentions(content);
      resetComposer();
      await onSendText({ content, mentions });
    } catch (err) {
      setError((err && err.message) || 'Gửi tin thất bại');
    }
  };

  const handleKeyDown = (e) => {
    // Không chặn phím khi bộ gõ tiếng Việt (IME) đang soạn
    if (e.nativeEvent.isComposing) return;
    if (mentionItems.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionItems.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + mentionItems.length) % mentionItems.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pickMention(mentionItems[mentionIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMention(null);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === 'Escape') {
      if (editing) {
        resetComposer();
        onCancelEdit();
      } else if (replyTo) onCancelReply();
      else if (pasted) clearPasted();
    }
  };

  const handlePaste = (e) => {
    const items = Array.from(e.clipboardData ? e.clipboardData.items : []);
    const imageItem = items.find((item) => item.kind === 'file' && item.type.startsWith(C.IMAGE_MIME_PREFIX));
    if (!imageItem) return;
    const file = imageItem.getAsFile();
    if (!file) return;
    e.preventDefault();
    if (editing) {
      setError('Không thể dán ảnh khi đang sửa tin nhắn');
      return;
    }
    const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    const named = file.name && file.name !== 'image.png' ? file : new File([file], `anh-dan-${Date.now()}.${ext}`, { type: file.type });
    setPasted({ file: named, url: URL.createObjectURL(named) });
  };

  const canSend = Boolean(text.trim() || pasted);

  return (
    <div className="border-t border-border bg-surface">
      {editing && (
        <ReplyPreview
          mode="edit"
          message={editing}
          onCancel={() => {
            resetComposer();
            onCancelEdit();
          }}
        />
      )}
      {!editing && replyTo && <ReplyPreview mode="reply" message={replyTo} senderName={replySenderName} onCancel={onCancelReply} />}
      {pasted && <PastePreview url={pasted.url} name={pasted.file.name} onRemove={clearPasted} />}
      {error && <p className="px-4 pt-1 text-xs text-danger">{error}</p>}
      <div className="relative flex items-end gap-1 px-2 py-2">
        <MentionDropdown items={mentionItems} activeIndex={mentionIndex} onPick={pickMention} onHover={setMentionIndex} />
        <div className="relative">
          <button type="button" className="icon-btn" onClick={() => setShowEmoji((v) => !v)} title="Emoji" aria-label="Chèn emoji">
            😊
          </button>
          {showEmoji && <EmojiPicker onPick={(emoji) => insertAtCaret(emoji)} onClose={() => setShowEmoji(false)} />}
        </div>
        <button type="button" className="icon-btn" onClick={onAttach} title="Đính kèm file" aria-label="Đính kèm file" disabled={Boolean(editing)}>
          📎
        </button>
        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onClick={(e) => detectMention(e.target.value, e.target.selectionStart)}
          placeholder={pasted ? 'Thêm chú thích cho ảnh…' : isGroup ? 'Nhập tin nhắn… (@ để nhắc tên)' : 'Nhập tin nhắn…'}
          className="input h-10 min-h-[40px] flex-1 resize-none py-2 leading-5"
          style={{ wordBreak: 'break-word', maxHeight: C.TEXTAREA_MAX_HEIGHT }}
          maxLength={C.MESSAGE_MAX_LENGTH}
          aria-label="Nội dung tin nhắn"
        />
        <button type="button" className="btn-primary h-10 w-10 shrink-0 rounded-full p-0" onClick={submit} disabled={!canSend} title="Gửi (Enter)" aria-label="Gửi">
          <IconSend />
        </button>
      </div>
    </div>
  );
}
