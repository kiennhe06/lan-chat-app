import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

/**
 * Khởi động renderer.
 * DEV + không có preload (chạy trong trình duyệt thường) → cài mock `window.api` trước khi nạp App.
 * Nhánh này bị loại bỏ hoàn toàn khi build production (import.meta.env.DEV = false).
 */
async function bootstrap() {
  if (import.meta.env.DEV && !window.api) {
    const { installMockApi } = await import('./dev/mockApi.js');
    installMockApi();
  }
  // App đọc window.api.constants lúc nạp module → import động SAU khi preload/mock sẵn sàng
  const { default: App } = await import('./app/App.jsx');
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

bootstrap().catch((err) => {
  console.error('[renderer] Khởi động thất bại', err);
  const root = document.getElementById('root');
  if (root) root.textContent = 'Không khởi động được giao diện. Vui lòng mở lại ứng dụng.';
});
