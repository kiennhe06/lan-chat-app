import { useMemo } from 'react';
import { getApi } from '../../app/api/apiClient.js';
import { localDb } from '../../app/api/localDb.js';
import C from '../../app/config/constants.js';

/**
 * Thao tác trên tin nhắn của 1 conversation (gửi, sửa, thu hồi, ghim, file...).
 * Tất cả trả Promise; lỗi reject dạng {code, message}.
 * @param {string|null} conversationId
 */
export function useMessageActions(conversationId) {
  return useMemo(() => {
    const chat = () => getApi().chat;
    return {
      /** @param {{content:string, reply_to?:string|null, mentions?:number[]}} input */
      sendText: (input) => chat().sendText({ conversation_id: conversationId, ...input }),
      /**
       * Gửi file từ đĩa (đường dẫn thật). Ảnh → as_image để hiển thị dạng ảnh.
       * @param {{path:string, name?:string, mime_type?:string, reply_to?:string|null}} file
       */
      sendFilePath: (file) =>
        chat().sendFile({
          conversation_id: conversationId,
          path: file.path,
          name: file.name,
          mime_type: file.mime_type,
          reply_to: file.reply_to || null,
          as_image: Boolean(file.mime_type && file.mime_type.startsWith(C.IMAGE_MIME_PREFIX)),
        }),
      /**
       * Gửi dữ liệu nhị phân (ảnh paste / file kéo thả không có đường dẫn).
       * @param {{file: File, content?: string, reply_to?: string|null, asImage?: boolean}} input
       */
      sendBlob: async ({ file, content, reply_to: replyTo, asImage }) => {
        const data = await file.arrayBuffer();
        return chat().sendFile({
          conversation_id: conversationId,
          data,
          name: file.name || `image-${Date.now()}.png`,
          mime_type: file.type || 'application/octet-stream',
          content: content || '',
          reply_to: replyTo || null,
          as_image: Boolean(asImage),
        });
      },
      cancelUpload: (clientMessageId) => chat().cancelUpload(clientMessageId),
      retry: (clientMessageId) => chat().retry(clientMessageId),
      edit: (clientMessageId, content) => chat().edit(conversationId, clientMessageId, content),
      recall: (clientMessageId) => chat().recall(conversationId, clientMessageId),
      pin: (clientMessageId) => chat().pin(conversationId, clientMessageId),
      unpin: (clientMessageId) => chat().unpin(conversationId, clientMessageId),
      /** @returns {Promise<Array<{path,name,size,mime_type}>>} */
      pickFiles: async () => {
        const files = await getApi().file.pick();
        return Array.isArray(files) ? files : [];
      },
      /** Đường dẫn thật của File kéo thả ('' nếu không có) */
      pathForFile: (file) => {
        try {
          return getApi().file.getPathForFile(file) || '';
        } catch (err) {
          console.warn('[useMessageActions] getPathForFile lỗi', err);
          return '';
        }
      },
      /** Tìm trong conversation (client.db) */
      search: (keyword) => localDb.searchMessages(conversationId, keyword),
      /** Copy âm thầm vào clipboard */
      copyText: (text) => navigator.clipboard.writeText(text || ''),
    };
  }, [conversationId]);
}
