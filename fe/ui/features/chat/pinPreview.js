import C, { MESSAGE_TYPE } from '../../app/config/constants.js';
import { previewText } from '../../utils/format.js';

/** Nội dung hiển thị của 1 tin ghim (WirePin) */
export function pinPreviewText(pin) {
  if (pin.content_preview) return previewText(pin.content_preview, C.pinPreviewText_MAX_CHARS);
  if (pin.type === MESSAGE_TYPE.IMAGE) return '🖼️ Hình ảnh';
  if (pin.type === MESSAGE_TYPE.FILE) return '📎 Tệp đính kèm';
  return 'Tin nhắn';
}
