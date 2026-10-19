import { useState } from 'react';
import { GROUP_ROLE } from '../../app/config/constants.js';
import { useChat } from '../../app/context/ChatContext.jsx';
import { useConfirm } from '../../app/context/ConfirmContext.jsx';
import { useToast } from '../../app/context/ToastContext.jsx';
import { useGroupActions } from './useGroupActions.js';
import { useValidators } from '../../app/hooks/useValidators.js';
import { getMyRole, isManagerRole } from '../chat/messageUtils.js';
import AddMemberModal from './AddMemberModal.jsx';
import Avatar from '../../components/Avatar.jsx';
import GroupMediaTabs from './GroupMediaTabs.jsx';
import { IconClose } from '../../components/Icons.jsx';
import MembersModal from './MembersModal.jsx';
import RoleBadge from './RoleBadge.jsx';

/** Tên nhóm + ✏️ sửa inline (Enter lưu, Esc hủy). */
function GroupNameEditor({ name, onSave }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const start = () => {
    setValue(name);
    setError('');
    setEditing(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      await onSave(value);
      setEditing(false);
    } catch (err) {
      setError((err && err.message) || 'Không đổi được tên nhóm');
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <div className="flex items-center justify-center gap-1">
        <h3 className="truncate text-lg font-semibold" title={name}>
          {name}
        </h3>
        <button type="button" className="rounded p-1 text-sm hover:bg-surface-2" onClick={start} title="Đổi tên nhóm" aria-label="Đổi tên nhóm">
          ✏️
        </button>
      </div>
    );
  }

  return (
    <div className="w-full">
      <input
        className="input text-center"
        value={value}
        autoFocus
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            save();
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            setEditing(false);
          }
        }}
        aria-label="Tên nhóm mới"
      />
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      <div className="mt-2 flex justify-center gap-2">
        <button type="button" className="btn-primary px-3 py-1" onClick={save} disabled={busy}>
          Lưu
        </button>
        <button type="button" className="btn-secondary px-3 py-1" onClick={() => setEditing(false)} disabled={busy}>
          Hủy
        </button>
      </div>
    </div>
  );
}

/**
 * Panel "Thông tin nhóm" bên phải khung chat (spec 2.3).
 */
export default function GroupInfoPanel({ conversation, onClose, onJump }) {
  const { me } = useChat();
  const toast = useToast();
  const confirm = useConfirm();
  const validators = useValidators();
  const actions = useGroupActions(conversation.id);
  const [showMembers, setShowMembers] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  const myRole = getMyRole(conversation, me.id);
  const canManage = isManagerRole(myRole);
  const memberCount = (conversation.members || []).length;
  const pendingCount = canManage ? Number(conversation.pending_count) || 0 : 0;

  const rename = async (raw) => {
    const result = validators.normalizeGroupName(raw);
    if (!result.ok) throw { message: result.error };
    if (result.value === conversation.name) return;
    await actions.rename(result.value);
    toast.success('Đã đổi tên nhóm');
  };

  const deleteGroup = async () => {
    const ok = await confirm({
      title: 'Xóa nhóm',
      message: `Xóa nhóm "${conversation.name}"? Toàn bộ thành viên sẽ không thể truy cập nhóm này nữa.`,
      confirmText: 'Xóa nhóm',
      danger: true,
    });
    if (!ok) return;
    try {
      await actions.deleteGroup();
    } catch (err) {
      toast.error((err && err.message) || 'Không xóa được nhóm');
    }
  };

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="font-semibold">Thông tin nhóm</h3>
        <button type="button" className="icon-btn h-8 w-8" onClick={onClose} aria-label="Đóng thông tin nhóm">
          <IconClose />
        </button>
      </div>

      <div className="flex flex-col items-center gap-2 px-4 pb-3 pt-4 text-center">
        <Avatar name={conversation.name} label="#" size={72} />
        <GroupNameEditor key={conversation.name} name={conversation.name || 'Nhóm'} onSave={rename} />
        <RoleBadge role={myRole} />
      </div>

      <div className="flex gap-2 px-4">
        <button type="button" className="btn-secondary relative flex-1 px-2" onClick={() => setShowMembers(true)}>
          👥 Xem thành viên ({memberCount})
          {pendingCount > 0 && <span className="badge absolute -right-1 -top-2 bg-danger text-[10px] text-white">{pendingCount} chờ</span>}
        </button>
        <button type="button" className="btn-primary px-3" onClick={() => setShowAdd(true)}>
          + Thêm
        </button>
      </div>

      {pendingCount > 0 && (
        <button type="button" className="mx-4 mt-2 rounded-md bg-danger/10 px-2 py-1 text-left text-xs font-medium text-danger hover:bg-danger/15" onClick={() => setShowMembers(true)}>
          📥 Có {pendingCount} yêu cầu tham gia đang chờ duyệt
        </button>
      )}

      <div className="mt-3 flex min-h-0 flex-1 flex-col">
        <GroupMediaTabs conversationId={conversation.id} refreshKey={conversation.last_message && conversation.last_message.client_message_id} onJump={onJump} />
      </div>

      {myRole === GROUP_ROLE.OWNER && (
        <div className="border-t border-border px-4 py-2 text-center">
          <button type="button" className="btn-link-danger" onClick={deleteGroup}>
            🗑️ Xóa nhóm
          </button>
        </div>
      )}

      {showMembers && <MembersModal conversation={conversation} onClose={() => setShowMembers(false)} />}
      {showAdd && <AddMemberModal conversation={conversation} onClose={() => setShowAdd(false)} />}
    </aside>
  );
}
