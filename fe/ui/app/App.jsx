import { AUTH_STATUS, AuthProvider, useAuth } from './context/AuthContext.jsx';
import { ChatProvider } from './context/ChatContext.jsx';
import { ConfirmProvider } from './context/ConfirmContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import LoginPage from '../features/auth/LoginPage.jsx';
import MainLayout from './MainLayout.jsx';

function AppRoutes() {
  const { status } = useAuth();
  if (status === AUTH_STATUS.RESTORING) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <p>Đang khôi phục phiên đăng nhập…</p>
      </div>
    );
  }
  if (status === AUTH_STATUS.LOGGED_OUT) return <LoginPage />;
  return (
    <ChatProvider>
      <MainLayout />
    </ChatProvider>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <ConfirmProvider>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
