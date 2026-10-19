import { memo, useMemo } from 'react';
import { splitRichText } from './messageUtils.js';

/**
 * Hiển thị nội dung tin: highlight @mention (màu primary) và link (không mở trình duyệt — máy offline).
 * @param {{ text: string, mentionNames?: string[], own?: boolean }} props
 */
function RichText({ text, mentionNames = [], own = false }) {
  const parts = useMemo(() => splitRichText(text, mentionNames), [text, mentionNames]);
  return parts.map((part, i) => {
    if (part.kind === 'mention') {
      return (
        <span key={i} className={own ? 'font-semibold underline decoration-white/60' : 'font-semibold text-primary'}>
          {part.text}
        </span>
      );
    }
    if (part.kind === 'link') {
      return (
        <span key={i} className="underline" title={part.text}>
          {part.text}
        </span>
      );
    }
    return <span key={i}>{part.text}</span>;
  });
}

export default memo(RichText);
