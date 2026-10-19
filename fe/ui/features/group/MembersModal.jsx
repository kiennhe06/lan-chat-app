import { useCallback, useEffect, useMemo, useState } from 'react';
import { GROUP_ROLE } from '../../app/config/constants.js';
import { useChat } from '../../app/context/ChatContext.jsx';
import { useConfirm } from '../../app/context/ConfirmContext.jsx';
import { useToast } from '../../app/context/ToastContext.jsx';
import { useGroupActions } from './useGroupActions.js';
import { getMyRole, isManagerRole } from '../chat/messageUtils.js';
import Avatar from '../../components/Avatar.jsx';
import Modal from '../../components/Modal.jsx';
import RoleBadge from './RoleBadge.jsx';

const ROLE_ORDER = { [GROUP_ROLE.OWNER]: 0, [GROUP_ROLE.ADMIN]: 1, [GROUP_ROLE.MEMBER]: 2 };

/**
 * Modal "Xem thành viên": danh sách + thăng/hạ phó nhóm (owner) + xóa (owner/admin)
 * + mục yêu cầu chờ duyệt (owner/admin). Click nền để đóng.
 */
export default function MembersModal({ conversation, onClose }) {
  const { me, users } = useChat();
  const toast = useToast();
  const confirm = useConfirm();
  const actions = useGroupActions(conversation.id);
  const myRole = getMyRole(conversation, me.id);
  const isOwner = myRole === GROUP_ROLE.OWNER;
  const canManage = isManagerRole(myRole);
  const [pending, setPending] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const members = useMemo(
    () =>
      [...(conversation.members || [])].sort(
        (a, b) =>
          (ROLE_ORDER[a.role] ?? 3) - (ROLE_ORDER[b.role] ?? 3) ||
          String(users[a.user_id]?.display_name || '').localeCompare(String(users[b.user_id]?.display_name || ''), 'vi'),
      ),
    [conversation.members, users],
  );

  const loadPending = useCallback(async () => {
    if (!canManage) return;
    try {
      setPending(await actions.requestPending());
    } catch (err) {
      toast.error((err && err.message) || 'Không tải được danh sách chờ duyệt');
    }
  }, [actions, canManage, toast]);

  useEffect(() => {
    loadPending();
  }, [loadPending, conversation.pending_count]);

  /** Chạy 1 thao tác nhóm với trạng thái bận + báo lỗi */
  const run = async (userId, fn, successText) => {
    setBusyId(userId);
    try {
      await fn();
      if (successText) toast.success(successText);
    } catch (err) {
      toast.error((err && err.message) || 'Thao tác thất bại');
    } finally {
      setBusyId(null);
    }
  };

  const nameOf = (id) => (users[id] && users[id].display_name) || `Người dùng #${id}`;

  const removeMember = async (userId) => {
    const ok = await confirm({
      title: 'Xóa thành viên',
      message: `Xóa ${nameOf(userId)} khỏi nhóm?`,
      confirmText: 'Xóa',
      danger: true,
    });
    if (ok) await run(userId, () => actions.remove(userId), `Đã xóa ${nameOf(userId)} khỏi nhóm`);
  };

  const smallBtn = 'rounded-md px-2 py-1 text-xs font-medium disabled:opacity-50';

  return (
    <Modal title={`Thành viên (${members.length})`} onClose={onClose} width={520}>
      <ul className="divide-y divide-border px-2">
        {members.map((m) => {
          const u = users[m.user_id] || { id: m.user_id, display_name: nameOf(m.user_id) };
          const isSelf = Number(m.user_id) === Number(me.id);
          const targetIsOwner = m.role === GROUP_ROLE.OWNER;
          const busy = busyId === m.user_id;
          return (
            <li key={m.user_id} className="flex items-center gap-3 px-2 py-2">
              <Avatar user={u} size={36} online={Boolean(u.online)} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {u.display_name} {isSelf && <span className="text-xs text-muted">(Bạn)</span>}
                </p>
                <p className="truncate text-xs text-muted">{u.employee_id || ''}</p>
              </div>
              <RoleBadge role={m.role} />
              {isOwner && !targetIsOwner && (
                <button
                  type="button"
                  className={`${smallBtn} bg-surface-2 text-text hover:bg-border`}
                  disabled={busy}
                  onClick={() =>
                    m.role === GROUP_ROLE.ADMIN
                      ? run(m.user_id, () => actions.setAdmin(m.user_id, false), `Đã hạ cấp ${u.display_name}`)
                      : run(m.user_id, () => actions.setAdmin(m.user_id, true), `${u.display_name} đã là phó nhóm`)
                  }
                >
                  {m.role === GROUP_ROLE.ADMIN ? 'Hạ cấp' : 'Thăng phó nhóm'}
                </button>
              )}
              {canManage && !targetIsOwner && !isSelf && (
                <button
                  type="button"
                  className={`${smallBtn} text-danger hover:bg-danger/10`}
                  disabled={busy}
                  onClick={() => removeMember(m.user_id)}
                  title="Xóa khỏi nhóm"
                  aria-label={`Xóa ${u.display_name} khỏi nhóm`}
                >
                  ✕
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {canManage && pending.length > 0 && (
        <div className="mx-4 mb-3 mt-2 border-t-2 border-dashed border-border pt-3">
          <p className="mb-2 text-sm font-semibold">📥 Yêu cầu chờ duyệt ({pending.length})</p>
          <ul className="space-y-1">
            {pending.map((p) => {
              const u = users[p.user_id] || { id: p.user_id, display_name: nameOf(p.user_id) };
              const busy = busyId === p.user_id;
              return (
                <li key={p.user_id} className="flex items-center gap-3 rounded-lg bg-surface-2 px-2 py-2">
                  <Avatar user={u} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{u.display_name}</p>
                    <p className="truncate text-xs text-muted">
                      {u.employee_id || ''}
                      {p.requested_by ? ` · đề xuất bởi ${nameOf(p.requested_by)}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={`${smallBtn} bg-success text-white hover:opacity-90`}
                    disabled={busy}
                    onClick={() => run(p.user_id, async () => {
                      await actions.approve(p.user_id);
                      setPending((list) => list.filter((x) => x.user_id !== p.user_id));
                    }, `Đã duyệt ${u.display_name}`)}
                  >
                    Duyệt
                  </button>
                  <button
                    type="button"
                    className={`${smallBtn} bg-surface text-danger hover:bg-danger/10`}
                    disabled={busy}
                    onClick={() => run(p.user_id, async () => {
                      await actions.reject(p.user_id);
                      setPending((list) => list.filter((x) => x.user_id !== p.user_id));
                    }, `Đã từ chối ${u.display_name}`)}
                  >
                    Từ chối
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Modal>
  );
}
