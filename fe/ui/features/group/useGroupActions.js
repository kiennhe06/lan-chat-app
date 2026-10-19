import { useMemo } from 'react';
import { getApi } from '../../app/api/apiClient.js';
import { localDb } from '../../app/api/localDb.js';
import { GROUP_ACTIONS } from '../../app/config/constants.js';

/**
 * Thao tác quản lý nhóm. Đổi tên chạy được offline (queue); còn lại chỉ online.
 * @param {string|null} conversationId
 */
export function useGroupActions(conversationId) {
  return useMemo(() => {
    const act = (action, data) => getApi().chat.groupAction(action, { conversation_id: conversationId, ...data });
    return {
      rename: (name) => getApi().chat.renameGroup(conversationId, name),
      /** @returns {Promise<{added:number[], pending:number[]}>} */
      addMembers: (userIds) => act(GROUP_ACTIONS.ADD_MEMBER, { user_ids: userIds }),
      approve: (userId) => act(GROUP_ACTIONS.APPROVE_MEMBER, { user_id: userId }),
      reject: (userId) => act(GROUP_ACTIONS.REJECT_MEMBER, { user_id: userId }),
      remove: (userId) => act(GROUP_ACTIONS.REMOVE_MEMBER, { user_id: userId }),
      setAdmin: (userId, isAdmin) => act(GROUP_ACTIONS.SET_ADMIN, { user_id: userId, is_admin: isAdmin }),
      deleteGroup: () => act(GROUP_ACTIONS.DELETE, {}),
      /** @returns {Promise<Array<{user_id, requested_by, created_at}>>} */
      requestPending: async () => {
        const res = await act(GROUP_ACTIONS.REQUEST_PENDING, {});
        if (Array.isArray(res)) return res;
        return (res && res.pending) || [];
      },
      /** @param {'images'|'files'|'links'} kind */
      getMedia: (kind) => localDb.getMedia(conversationId, kind),
    };
  }, [conversationId]);
}
