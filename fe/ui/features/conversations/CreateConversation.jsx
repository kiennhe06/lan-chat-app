import { useMemo, useState } from 'react';
import C from '../../app/config/constants.js';
import { useChat } from '../../app/context/ChatContext.jsx';
import { useToast } from '../../app/context/ToastContext.jsx';
import { useValidators } from '../../app/hooks/useValidators.js';
import Modal from '../../components/Modal.jsx';
import UserPicker from './UserPicker.jsx';

const TAB = Object.freeze({ DIRECT: 'direct', GROUP: 'group' });

/**
 * Modal tạo cuộc trò chuyện: 1-1 (chọn 1 người) hoặc nhóm (tên + ≥ 2 người khác).
 */
export default function CreateConversation({ onClose }) {
  const { me, users, openDirect, createGroup, setActiveId } = useChat();
  const toast = useToast();
  const validators = useValidators();
  const [tab, setTab] = useState(TAB.DIRECT);
  const [selected, setSelected] = useState([]);
  const [groupName, setGroupName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const others = useMemo(() => Object.values(users).filter((u) => Number(u.id) !== Number(me.id)), [users, me.id]);

  const switchTab = (next) => {
    setTab(next);
    setSelected([]);
    setError('');
  };

  const toggle = (id) => {
    setError('');
    if (tab === TAB.DIRECT) setSelected([id]);
    else setSelected((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  };

  const submit = async () => {
    setError('');
    try {
      setBusy(true);
      let conversation;
      if (tab === TAB.DIRECT) {
        if (selected.length !== 1) throw { message: 'Vui lòng chọn 1 người để nhắn tin' };
        conversation = await openDirect(selected[0]);
      } else {
        const name = validators.normalizeGroupName(groupName);
        if (!name.ok) throw { message: name.error };
        if (selected.length < C.MIN_GROUP_OTHER_MEMBERS) {
          throw { message: `Nhóm cần ít nhất ${C.MIN_GROUP_OTHER_MEMBERS} thành viên khác ngoài bạn` };
        }
        conversation = await createGroup(name.value, selected);
        toast.success(`Đã tạo nhóm "${name.value}"`);
      }
      if (conversation) setActiveId(String(conversation.id));
      onClose();
    } catch (err) {
      setError((err && err.message) || 'Không tạo được cuộc trò chuyện');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Tạo cuộc trò chuyện"
      onClose={onClose}
      width={460}
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted">{tab === TAB.GROUP ? `Đã chọn ${selected.length} người` : ''}</span>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Hủy
            </button>
            <button type="button" className="btn-primary" onClick={submit} disabled={busy}>
              {tab === TAB.DIRECT ? 'Nhắn tin' : 'Tạo nhóm'}
            </button>
          </div>
        </div>
      }
    >
      <div className="p-4">
        <div className="mb-3 grid grid-cols-2 rounded-lg bg-surface-2 p-1 text-sm font-medium">
          <button type="button" onClick={() => switchTab(TAB.DIRECT)} className={`rounded-md py-1.5 ${tab === TAB.DIRECT ? 'bg-surface text-primary shadow' : 'text-muted'}`}>
            💬 Chat 1-1
          </button>
          <button type="button" onClick={() => switchTab(TAB.GROUP)} className={`rounded-md py-1.5 ${tab === TAB.GROUP ? 'bg-surface text-primary shadow' : 'text-muted'}`}>
            👥 Nhóm
          </button>
        </div>
        {tab === TAB.GROUP && (
          <div className="mb-3">
            <label htmlFor="group-name" className="label">
              Tên nhóm
            </label>
            <input id="group-name" className="input" value={groupName} maxLength={C.GROUP_NAME_MAX} onChange={(e) => setGroupName(e.target.value)} placeholder="Ví dụ: Phòng Kế toán" />
          </div>
        )}
        <p className="label">{tab === TAB.GROUP ? `Chọn thành viên (ít nhất ${C.MIN_GROUP_OTHER_MEMBERS} người)` : 'Chọn người nhắn tin'}</p>
        <UserPicker users={others} selected={selected} onToggle={toggle} multiple={tab === TAB.GROUP} />
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
