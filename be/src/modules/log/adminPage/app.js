/**
 * Script trang "Nhật ký hoạt động" (chạy trong trình duyệt trên máy chủ, không thư viện ngoài).
 * Gọi API cùng origin: /admin/api/users, /admin/api/logs, /admin/api/export.
 */
'use strict';

(function adminLogPage() {
  const AUTO_REFRESH_MS = 30000;
  const CSV_BOM = '﻿'; // để Excel đọc đúng tiếng Việt

  /** Tên hoạt động dễ hiểu (action trong log → tiếng Việt). */
  const ACTION_LABELS = {
    login_success: 'Đăng nhập',
    login_failed: 'Đăng nhập thất bại',
    logout: 'Đăng xuất',
    register: 'Đăng ký tài khoản',
    reconnect: 'Tự đăng nhập lại',
    reconnect_failed: 'Tự đăng nhập lại thất bại',
    password_changed: 'Đổi mật khẩu',
    password_change_failed: 'Đổi mật khẩu thất bại',
    wrong_old_password: 'Nhập sai mật khẩu cũ',
    profile_updated: 'Đổi tên hiển thị',
    avatar_updated: 'Đổi ảnh đại diện',
    settings_updated: 'Đổi cài đặt',
    message_sent: 'Gửi tin nhắn',
    message_edited: 'Sửa tin nhắn',
    message_recalled: 'Thu hồi tin nhắn',
    message_pinned: 'Ghim tin nhắn',
    message_unpinned: 'Bỏ ghim tin nhắn',
    file_uploaded: 'Gửi file',
    file_downloaded: 'Tải file về',
    conversation_created: 'Mở chat 1-1',
    group_created: 'Tạo nhóm',
    group_renamed: 'Đổi tên nhóm',
    group_member_added: 'Thêm thành viên vào nhóm',
    group_member_requested: 'Đề xuất thêm thành viên',
    group_member_approved: 'Duyệt thành viên',
    group_member_rejected: 'Từ chối thành viên',
    group_member_removed: 'Xóa thành viên khỏi nhóm',
    group_admin_set: 'Đổi phó nhóm',
    group_deleted: 'Xóa nhóm',
    ip_blocked: 'Chặn IP',
    ip_unblocked: 'Bỏ chặn IP',
    blocked_ip_rejected: 'IP bị chặn cố kết nối',
    blocked_ip_http_rejected: 'IP bị chặn cố kết nối',
    ws_authenticated: 'Vào ứng dụng',
    ws_open: 'Mở kết nối',
    ws_close: 'Ngắt kết nối',
    sync_message_batch: 'Đồng bộ tin gửi lúc máy chủ tắt',
    sync_action_batch: 'Đồng bộ thao tác lúc máy chủ tắt',
    server_started: 'Khởi động máy chủ',
    server_stopping: 'Tắt máy chủ',
    admin_logs_exported: 'Xuất nhật ký',
    admin_page_denied: 'Máy khác cố mở trang nhật ký',
  };
  const MESSAGE_TYPE_LABELS = { text: 'văn bản', image: 'ảnh', file: 'file', system: 'hệ thống' };
  const REASON_LABELS = { bad_credentials: 'sai tên đăng nhập hoặc mật khẩu', invalid_input: 'dữ liệu nhập không hợp lệ' };
  const LEVEL_LABELS = { debug: 'debug', info: 'info', warn: 'cảnh báo', error: 'lỗi', audit: 'audit' };
  const SOURCE_LABELS = { client: 'Ghi từ máy nhân viên', server: 'Ghi tại máy chủ' };

  const $ = (id) => document.getElementById(id);
  const form = $('filters');
  const rowsEl = $('rows');
  const statusEl = $('status');
  const bannerEl = $('banner');
  let currentLogs = [];
  let refreshTimer = null;
  let loading = false;

  const dateTimeFmt = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'medium' });

  function showBanner(kind, text) {
    bannerEl.className = `banner ${kind}`;
    bannerEl.textContent = text;
  }
  const hideBanner = () => { bannerEl.className = 'banner'; };

  /** Tạo element nhanh (luôn dùng textContent → không bị chèn HTML từ dữ liệu log). */
  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) Object.assign(node, props);
    for (const child of children || []) if (child != null) node.append(child);
    return node;
  }

  /** Ngày ở ô date (giờ máy) → ISO đầu ngày / cuối ngày. */
  function dayBoundary(value, endOfDay) {
    if (!value) return '';
    const [y, m, d] = value.split('-').map(Number);
    const date = endOfDay ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d, 0, 0, 0, 0);
    return date.toISOString();
  }

  function buildQuery() {
    const data = new FormData(form);
    const params = new URLSearchParams();
    for (const key of ['user_id', 'category', 'min_level', 'q', 'limit']) {
      const value = String(data.get(key) || '').trim();
      if (value) params.set(key, value);
    }
    const from = dayBoundary(String(data.get('from') || ''), false);
    const to = dayBoundary(String(data.get('to') || ''), true);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if ($('f-users-only').checked) params.set('users_only', 'true');
    return params.toString();
  }

  async function getJson(url) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      const text = await res.text();
      let message = text;
      try { message = JSON.parse(text).error.message; } catch (_err) { /* giữ nguyên text */ }
      throw new Error(message || `Lỗi ${res.status}`);
    }
    return res.json();
  }

  function describeDetails(entry) {
    const meta = entry.meta || {};
    const parts = [];
    if (entry.conversation_label) parts.push(entry.conversation_label);
    if (entry.action === 'message_sent' && meta.type) parts.push(`Loại: ${MESSAGE_TYPE_LABELS[meta.type] || meta.type}`);
    if (meta.relayed_by) parts.push('(gửi lúc máy chủ tắt, đồng bộ sau)');
    if (entry.file_name) parts.push(`File: ${entry.file_name}${meta.size ? ` (${formatBytes(meta.size)})` : ''}`);
    if (entry.target_names) parts.push(`Người liên quan: ${entry.target_names}`);
    if (meta.target_ip) parts.push(`IP bị tác động: ${meta.target_ip}`);
    if (meta.reason) parts.push(`Lý do: ${REASON_LABELS[meta.reason] || meta.reason}`);
    if (meta.kicked) parts.push(`Đã ngắt ${meta.kicked} kết nối`);
    if (meta.identifier) parts.push(`Tài khoản nhập: ${meta.identifier}`);
    if (meta.count != null && entry.action.startsWith('sync_')) parts.push(`${meta.count} mục`);
    return parts;
  }

  function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  function userCell(entry) {
    if (!entry.user_id) return el('td', { className: 'sub', textContent: '—' });
    const name = entry.display_name || `#${entry.user_id}`;
    const sub = [entry.username, entry.employee_id].filter(Boolean).join(' · ');
    return el('td', null, [el('div', { textContent: name }), el('div', { className: 'sub', textContent: sub })]);
  }

  function renderRow(entry) {
    const details = describeDetails(entry);
    const detailCell = el('td', null, [
      ...details.map((text) => el('div', { textContent: text })),
      entry.meta ? el('details', null, [el('summary', { textContent: 'Dữ liệu gốc' }), el('pre', { textContent: JSON.stringify(entry.meta, null, 2) })]) : null,
    ]);
    const level = entry.level || 'info';
    return el('tr', null, [
      el('td', { className: 'time', textContent: dateTimeFmt.format(new Date(entry.ts)) }),
      userCell(entry),
      el('td', null, [
        el('div', { textContent: ACTION_LABELS[entry.action] || entry.action }),
        el('div', { className: 'sub', textContent: `${entry.action} · ${SOURCE_LABELS[entry.source] || SOURCE_LABELS.server}` }),
      ]),
      detailCell,
      el('td', { className: 'ip', textContent: entry.ip || '—' }),
      el('td', null, [el('span', { className: `badge lv-${level}`, textContent: LEVEL_LABELS[level] || level })]),
    ]);
  }

  function render(logs, truncated) {
    rowsEl.replaceChildren();
    if (!logs.length) {
      rowsEl.append(el('tr', null, [el('td', { colSpan: 6, className: 'empty', textContent: 'Không có hoạt động nào khớp bộ lọc.' })]));
    } else {
      const fragment = document.createDocumentFragment();
      for (const entry of logs) fragment.append(renderRow(entry));
      rowsEl.append(fragment);
    }
    const time = new Date().toLocaleTimeString('vi-VN');
    statusEl.textContent = `${logs.length} dòng${truncated ? ' (còn nữa — tăng "Số dòng tối đa" hoặc thu hẹp bộ lọc)' : ''} · cập nhật ${time}`;
  }

  async function loadLogs() {
    if (loading) return;
    loading = true;
    $('btn-search').disabled = true;
    statusEl.textContent = 'Đang tải…';
    try {
      const result = await getJson(`/admin/api/logs?${buildQuery()}`);
      currentLogs = result.logs || [];
      render(currentLogs, result.truncated);
      hideBanner();
    } catch (err) {
      showBanner('error', `Không tải được nhật ký: ${err.message}`);
      statusEl.textContent = '';
    } finally {
      loading = false;
      $('btn-search').disabled = false;
    }
  }

  async function loadUsers() {
    try {
      const { users } = await getJson('/admin/api/users');
      const select = $('f-user');
      for (const u of users || []) {
        select.append(el('option', { value: String(u.id), textContent: `${u.display_name} (${u.username} · ${u.employee_id})` }));
      }
    } catch (err) {
      showBanner('error', `Không tải được danh sách thành viên: ${err.message}`);
    }
  }

  function downloadText(fileName, mime, text) {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const link = el('a', { href: url, download: fileName });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const csvCell = (value) => `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;

  /** Xuất đúng các dòng đang hiển thị ra CSV (mở bằng Excel). */
  function exportCsv() {
    if (!currentLogs.length) {
      showBanner('error', 'Không có dòng nào để xuất.');
      return;
    }
    const header = ['Thời gian', 'Tên hiển thị', 'Tên đăng nhập', 'Mã nhân viên', 'Hoạt động', 'Mã hoạt động', 'Chi tiết', 'IP', 'Mức'];
    const lines = currentLogs.map((e) => [
      dateTimeFmt.format(new Date(e.ts)), e.display_name, e.username, e.employee_id,
      ACTION_LABELS[e.action] || e.action, e.action, describeDetails(e).join(' | '), e.ip, e.level,
    ].map(csvCell).join(','));
    downloadText(`lanchat-nhat-ky-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8', CSV_BOM + [header.map(csvCell).join(','), ...lines].join('\r\n'));
    showBanner('ok', `Đã xuất ${currentLogs.length} dòng ra file CSV.`);
  }

  function exportJsonl() {
    window.location.href = `/admin/api/export?${buildQuery()}`;
  }

  function setAutoRefresh(enabled) {
    clearInterval(refreshTimer);
    refreshTimer = enabled ? setInterval(loadLogs, AUTO_REFRESH_MS) : null;
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    loadLogs();
  });
  $('btn-reset').addEventListener('click', () => {
    form.reset();
    loadLogs();
  });
  $('btn-csv').addEventListener('click', exportCsv);
  $('btn-jsonl').addEventListener('click', exportJsonl);
  $('auto-refresh').addEventListener('change', (event) => setAutoRefresh(event.target.checked));
  for (const id of ['f-user', 'f-category', 'f-level', 'f-limit', 'f-users-only', 'f-from', 'f-to']) {
    $(id).addEventListener('change', loadLogs);
  }

  loadUsers().then(loadLogs);
})();
