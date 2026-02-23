/**
 * Cross-platform autostart utility
 * Handles launch-at-login for macOS, Windows, and Linux
 */
import { app } from 'electron';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { logger } from './logger';

export function setAutoStart(enabled: boolean): void {
  if (process.platform === 'linux') {
    setAutoStartLinux(enabled);
  } else {
    // macOS + Windows: native Electron API
    app.setLoginItemSettings({
      openAtLogin: enabled,
      args: ['--minimized'],
    });
  }
  logger.info(`Auto-start ${enabled ? 'enabled' : 'disabled'} (${process.platform})`);
}

function setAutoStartLinux(enabled: boolean): void {
  const autostartDir = join(homedir(), '.config', 'autostart');
  const desktopFile = join(autostartDir, 'crawbot.desktop');

  if (enabled) {
    mkdirSync(autostartDir, { recursive: true });
    // APPIMAGE env var holds the real AppImage path (e.g. /home/pi/CrawBot.AppImage)
    // process.execPath resolves to the temp mount point which won't survive reboot
    const execPath = process.env.APPIMAGE || process.execPath;
    const content = [
      '[Desktop Entry]',
      'Type=Application',
      'Name=CrawBot',
      'Comment=AI Assistant powered by OpenClaw',
      `Exec="${execPath}" --minimized %U`,
      'Icon=crawbot',
      'Categories=Utility;Network;',
      'X-GNOME-Autostart-enabled=true',
      'StartupNotify=false',
      '',
    ].join('\n');
    writeFileSync(desktopFile, content);
  } else {
    if (existsSync(desktopFile)) unlinkSync(desktopFile);
  }
}
