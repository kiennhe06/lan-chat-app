import { useState } from 'react';
import { USER_ROLE } from '../../app/config/constants.js';
import { useAuth } from '../../app/context/AuthContext.jsx';
import AdminIpManager from '../admin/AdminIpManager.jsx';
import Modal from '../../components/Modal.jsx';
import ProfileTab from './ProfileTab.jsx';

const TAB = Object.freeze({ PROFILE: 'profile', BLOCK: 'block' });

/**
 * Modal Cài đặt: Cá nhân (mọi người) + Chặn IP (chỉ manager).
 * Nhật ký hoạt động KHÔNG xem trong app — chỉ xem trên máy chủ tại http://localhost:<cổng>/admin.
 */
export default function Settings({ onClose }) {
  const { user } = useAuth();
  const isManager = user && user.role === USER_ROLE.MANAGER;
  const [tab, setTab] = useState(TAB.PROFILE);

  const tabs = [{ key: TAB.PROFILE, label: '👤 Cá nhân' }];
  if (isManager) tabs.push({ key: TAB.BLOCK, label: '⛔ Chặn IP' });

  return (
    <Modal title="Cài đặt" onClose={onClose} width={isManager && tab !== TAB.PROFILE ? 960 : 620}>
      <div className="flex h-[70vh] flex-col">
        {tabs.length > 1 && (
          <div className="flex gap-1 border-b border-border px-4" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === t.key ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-text'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === TAB.PROFILE && <ProfileTab />}
          {tab === TAB.BLOCK && isManager && <AdminIpManager />}
        </div>
        {isManager && (
          <p className="border-t border-border px-4 py-2 text-xs text-muted">
            📋 Nhật ký hoạt động của thành viên chỉ xem được trên máy chủ: mở trình duyệt trên máy chạy server và vào{' '}
            <span className="font-mono">http://localhost:5001/admin</span>
          </p>
        )}
      </div>
    </Modal>
  );
}
