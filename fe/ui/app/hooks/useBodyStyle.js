import { useEffect } from 'react';

/**
 * Đặt tạm style cho document.body khi component mount, LUÔN khôi phục khi unmount
 * (tránh "kẹt" overflow/pointer-events sau khi đóng modal hoặc đăng xuất).
 * @param {Partial<CSSStyleDeclaration>} style
 * @param {boolean} [active=true]
 */
export function useBodyStyle(style, active = true) {
  const serialized = JSON.stringify(style);
  useEffect(() => {
    if (!active) return undefined;
    const parsed = JSON.parse(serialized);
    const previous = {};
    Object.keys(parsed).forEach((key) => {
      previous[key] = document.body.style[key];
      document.body.style[key] = parsed[key];
    });
    return () => {
      Object.keys(previous).forEach((key) => {
        document.body.style[key] = previous[key];
      });
    };
  }, [serialized, active]);
}
