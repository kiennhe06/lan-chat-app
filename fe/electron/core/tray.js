/**
 * Icon khay hệ thống: menu "Mở LAN Chat" / "Thoát", click → mở cửa sổ, tooltip số tin chưa đọc.
 */
'use strict';

const fs = require('fs');
const { Tray, Menu, nativeImage } = require('electron');

/**
 * @param {{ iconPath: string, onOpen: () => void, onQuit: () => void, logger: object }} opts
 * @returns {{ setUnread: (n: number) => void, destroy: () => void } | null}
 */
function createTray(opts) {
  let image = fs.existsSync(opts.iconPath) ? nativeImage.createFromPath(opts.iconPath) : nativeImage.createEmpty();
  if (process.platform === 'darwin' && !image.isEmpty()) image = image.resize({ width: 18, height: 18 });
  let tray;
  try {
    tray = new Tray(image);
  } catch (err) {
    opts.logger.warn('app', 'tray_create_failed', { message: err.message });
    return null;
  }
  tray.setToolTip('LAN Chat');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Mở LAN Chat', click: opts.onOpen },
      { type: 'separator' },
      { label: 'Thoát', click: opts.onQuit },
    ]),
  );
  tray.on('click', opts.onOpen);
  tray.on('double-click', opts.onOpen);

  return {
    setUnread(n) {
      if (tray.isDestroyed()) return;
      tray.setToolTip(n > 0 ? `LAN Chat — ${n} tin chưa đọc` : 'LAN Chat');
    },
    destroy() {
      if (!tray.isDestroyed()) tray.destroy();
    },
  };
}

module.exports = { createTray };
