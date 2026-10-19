/** PostCSS cho renderer (Vite đọc file này qua css.postcss trong ui/vite.config.mjs). */
'use strict';

const path = require('path');

module.exports = {
  plugins: {
    tailwindcss: { config: path.join(__dirname, 'tailwind.config.js') },
    autoprefixer: {},
  },
};
