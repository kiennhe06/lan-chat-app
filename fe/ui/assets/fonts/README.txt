FONT CHỮ (OFFLINE)
==================

Ứng dụng chạy trên máy KHÔNG có internet nên KHÔNG dùng Google Fonts hay bất kỳ font online nào.

Mặc định giao diện dùng font hệ thống:
  "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif
Segoe UI có sẵn trên Windows 10/11 và hiển thị tiếng Việt đầy đủ.

Muốn dùng font riêng (ví dụ Inter, Be Vietnam Pro):
  1. Copy file font (.woff2 khuyến nghị) vào thư mục này, ví dụ: Inter-Regular.woff2, Inter-Bold.woff2
     (kiểm tra giấy phép font cho phép đóng gói kèm ứng dụng).
  2. Thêm vào đầu ui/index.css:

       @font-face {
         font-family: 'Inter';
         src: url('./assets/fonts/Inter-Regular.woff2') format('woff2');
         font-weight: 400;
         font-display: swap;
       }

  3. Thêm 'Inter' vào đầu danh sách fontFamily.sans trong fe/tailwind.config.js.
  4. npm run build:renderer — Vite sẽ copy font vào dist/renderer/assets với đường dẫn tương đối.
