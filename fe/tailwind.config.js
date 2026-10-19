/**
 * Tailwind config cho renderer. Màu lấy từ CSS variables (ui/index.css)
 * để đổi theme sáng/tối chỉ bằng class `dark` trên <html>.
 */
'use strict';

/** Màu dạng "r g b" trong CSS var → hỗ trợ opacity modifier của Tailwind (bg-primary/20). */
const withVar = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: {
    relative: true,
    files: ['./ui/index.html', './ui/**/*.{js,jsx}'],
  },
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: withVar('primary'),
        'primary-hover': withVar('primary-hover'),
        'on-primary': withVar('on-primary'),
        bg: withVar('bg'),
        surface: withVar('surface'),
        'surface-2': withVar('surface-2'),
        text: withVar('text'),
        muted: withVar('muted'),
        border: withVar('border'),
        'bubble-own': withVar('bubble-own'),
        'bubble-other': withVar('bubble-other'),
        'bubble-other-text': withVar('bubble-other-text'),
        danger: withVar('danger'),
        warning: withVar('warning'),
        success: withVar('success'),
        'pin-yellow': withVar('pin-yellow'),
        'highlight-yellow': withVar('highlight-yellow'),
      },
      fontFamily: {
        sans: ['"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
