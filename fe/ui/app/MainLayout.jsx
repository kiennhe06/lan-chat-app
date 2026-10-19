import { useState } from 'react';
import { useChat } from './context/ChatContext.jsx';
import ChatWindow from '../features/chat/ChatWindow.jsx';
import ConnectionBanner from '../features/connection/ConnectionBanner.jsx';
import CreateConversation from '../features/conversations/CreateConversation.jsx';
import Settings from '../features/settings/Settings.jsx';
import Sidebar from '../features/conversations/Sidebar.jsx';
import SyncProgressBar from '../features/connection/SyncProgressBar.jsx';

/** Bố cục chính sau đăng nhập: banner kết nối + thanh đồng bộ + sidebar + khung chat. */
export default function MainLayout() {
  const { activeConversation, connection, peers, syncProgress } = useChat();
  const [showSettings, setShowSettings] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <ConnectionBanner state={connection.state} peerCount={peers.length} />
      <SyncProgressBar progress={syncProgress} />
      <div className="flex min-h-0 flex-1">
        <Sidebar onOpenSettings={() => setShowSettings(true)} onCreate={() => setShowCreate(true)} />
        <main className="flex min-w-0 flex-1">
          {activeConversation ? (
            <ChatWindow key={activeConversation.id} conversation={activeConversation} />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 bg-bg text-center text-muted">
              <span className="text-5xl" aria-hidden="true">
                💬
              </span>
              <p className="text-lg font-semibold text-text">Chào mừng tới LAN Chat</p>
              <p className="text-sm">Chọn một cuộc trò chuyện bên trái hoặc nhấn "+ Tạo" để bắt đầu.</p>
            </div>
          )}
        </main>
      </div>
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      {showCreate && <CreateConversation onClose={() => setShowCreate(false)} />}
    </div>
  );
}
