/**
 * Browser Extension Management
 * Handles installing/configuring the CrawBot Browser Relay Chrome extension
 */

import { existsSync, mkdirSync, cpSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { app } from 'electron';
import { logger } from './logger';

const EXTENSION_INSTALL_DIR = join(homedir(), '.openclaw', 'chrome-extension');

function getExtensionSourceDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'assets', 'chrome-extension');
  }
  return join(app.getAppPath(), 'assets', 'chrome-extension');
}

export function getExtensionInstallDir(): string {
  return EXTENSION_INSTALL_DIR;
}

/**
 * Install extension files and write config with token + relay port
 */
export function installExtension(gatewayToken: string, gatewayPort: number): {
  success: boolean;
  path: string;
  error?: string;
} {
  try {
    const sourceDir = getExtensionSourceDir();
    if (!existsSync(sourceDir)) {
      return { success: false, path: '', error: `Extension source not found at ${sourceDir}` };
    }

    if (!existsSync(EXTENSION_INSTALL_DIR)) {
      mkdirSync(EXTENSION_INSTALL_DIR, { recursive: true });
    }

    // Copy extension files
    cpSync(sourceDir, EXTENSION_INSTALL_DIR, { recursive: true });

    // Write auto-discovery config file (read by extension's background.js)
    const relayPort = gatewayPort + 3;
    const config = { token: gatewayToken, relayPort, gatewayPort };
    writeFileSync(
      join(EXTENSION_INSTALL_DIR, 'crawbot-config.json'),
      JSON.stringify(config, null, 2),
    );

    logger.info(`[browser-extension] Installed to ${EXTENSION_INSTALL_DIR} (relay port ${relayPort})`);
    return { success: true, path: EXTENSION_INSTALL_DIR };
  } catch (error) {
    logger.error(`[browser-extension] Install failed: ${String(error)}`);
    return { success: false, path: '', error: String(error) };
  }
}

/**
 * Update just the config file (token/port changed)
 */
export function updateExtensionConfig(gatewayToken: string, gatewayPort: number): boolean {
  try {
    const configPath = join(EXTENSION_INSTALL_DIR, 'crawbot-config.json');
    const relayPort = gatewayPort + 3;
    writeFileSync(configPath, JSON.stringify({ token: gatewayToken, relayPort, gatewayPort }, null, 2));
    return true;
  } catch {
    return false;
  }
}

export function isExtensionInstalled(): boolean {
  return existsSync(join(EXTENSION_INSTALL_DIR, 'manifest.json'));
}

function findChromeExecutable(): string | null {
  const platform = process.platform;
  if (platform === 'darwin') {
    const paths = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      `${homedir()}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
    ];
    for (const p of paths) {
      if (existsSync(p)) return p;
    }
  } else if (platform === 'win32') {
    const paths = [
      join(process.env['PROGRAMFILES'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(process.env['LOCALAPPDATA'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];
    for (const p of paths) {
      if (existsSync(p)) return p;
    }
  } else {
    try {
      const path = execSync(
        'which google-chrome || which google-chrome-stable || which chromium-browser || which chromium',
        { encoding: 'utf-8', timeout: 3000 },
      ).trim();
      if (path) return path;
    } catch {
      // Not found
    }
  }
  return null;
}

export function getExtensionStatus(): {
  installed: boolean;
  path: string;
  chromeFound: boolean;
  chromePath: string | null;
} {
  const chromePath = findChromeExecutable();
  return {
    installed: isExtensionInstalled(),
    path: EXTENSION_INSTALL_DIR,
    chromeFound: chromePath !== null,
    chromePath,
  };
}
