import { useMemo, useState } from 'react';
import { useChat } from '../../app/context/ChatContext.jsx';
import { useToast } from '../../app/context/ToastContext.jsx';
import { useGroupActions } from './useGroupActions.js';
import { getMyRole, isManagerRole } from '../chat/messageUtils.js';
import Modal from '../../components/Modal.jsx';
import UserPicker from '../conversations/UserPicker.jsx';

/**
 * Thêm thành viên: owner/admin thêm trực tiếp; thành viên thường → yêu cầu chờ duyệt.
 */
export default function AddMemberModal({ conversation, onClose }) {
  const { me, users } = useChat();
  const toast = useToast();
  const actions = useGroupActions(conversation.id);
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canAddDirectly = isManagerRole(getMyRole(conversation, me.id));

  const candidates = useMemo(() => {
    const memberIds = new Set((conversation.members || []).map((m) => Number(m.user_id)));
    return Object.values(users).filter((u) => !memberIds.has(Number(u.id)));
  }, [users, conversation.members]);

  const toggle = (id) => setSelected((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  const submit = async () => {
    if (!selected.length) {
      setError('Vui lòng chọn ít nhất 1 người');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = (await actions.addMembers(selected)) || {};
      const added = (res.added || []).length;
      const pendingCount = (res.pending || []).length;
      if (added) toast.success(`Đã thêm ${added} thành viên`);
      if (pendingCount) toast.info(`Đã gửi ${pendingCount} yêu cầu — chờ trưởng/phó nhóm duyệt`);
      onClose();
    } catch (err) {
      setError((err && err.message) || 'Không thêm được thành viên');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Thêm thành viên"
      onClose={onClose}
      width={460}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Hủy
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={busy}>
            {canAddDirectly ? `Thêm (${selected.length})` : `Gửi yêu cầu (${selected.length})`}
          </button>
        </div>
      }
    >
      <div className="p-4">
        {!canAddDirectly && <p className="mb-2 rounded-md bg-warning/15 px-3 py-2 text-xs">Bạn là thành viên — người được thêm sẽ chờ trưởng/phó nhóm duyệt.</p>}
        <UserPicker users={candidates} selected={selected} onToggle={toggle} />
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
