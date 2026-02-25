/**
 * Electron Main Process Entry
 * Manages window creation, system tray, and IPC handlers
 */
import { app, BrowserWindow, clipboard, Menu, nativeImage, session, shell } from 'electron';
import { join } from 'path';
import { GatewayManager } from '../gateway/manager';
import { registerIpcHandlers } from './ipc-handlers';
import { createTray } from './tray';
import { createMenu } from './menu';

import { appUpdater, registerUpdateHandlers } from './updater';
import { logger } from '../utils/logger';
import { warmupNetworkOptimization } from '../utils/uv-env';
import { getSetting } from '../utils/store';
import { setAutoStart } from '../utils/autostart';

import { ClawHubService } from '../gateway/clawhub';

// Disable GPU acceleration for better compatibility
app.disableHardwareAcceleration();

// Global references
let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
const gatewayManager = new GatewayManager();
const clawHubService = new ClawHubService();

/**
 * Resolve the icons directory path (works in both dev and packaged mode)
 */
function getIconsDir(): string {
  if (app.isPackaged) {
    // Packaged: icons are in extraResources → process.resourcesPath/resources/icons
    return join(process.resourcesPath, 'resources', 'icons');
  }
  // Development: relative to dist-electron/main/
  return join(__dirname, '../../resources/icons');
}

/**
 * Get the app icon for the current platform
 */
function getAppIcon(): Electron.NativeImage | undefined {
  if (process.platform === 'darwin') return undefined; // macOS uses the app bundle icon

  const iconsDir = getIconsDir();
  const iconPath =
    process.platform === 'win32'
      ? join(iconsDir, 'icon.ico')
      : join(iconsDir, 'icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  return icon.isEmpty() ? undefined : icon;
}

/**
 * Create the main application window
 */
function createWindow(startMinimized = false): BrowserWindow {
  const isMac = process.platform === 'darwin';

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    icon: getAppIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webviewTag: true, // Enable <webview> for embedding OpenClaw Control UI
    },
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: isMac ? { x: 16, y: 16 } : undefined,
    frame: isMac,
    show: false,
  });

  // Show window when ready (unless starting minimized to tray)
  win.once('ready-to-show', () => {
    if (!startMinimized) {
      win.show();
    }
  });

  // Handle external links
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Enable right-click context menu with standard editing actions
  win.webContents.on('context-menu', (_event, params) => {
    const menuItems: Electron.MenuItemConstructorOptions[] = [];

    // Spell-check suggestions
    if (params.misspelledWord && params.dictionarySuggestions.length > 0) {
      for (const suggestion of params.dictionarySuggestions) {
        menuItems.push({
          label: suggestion,
          click: () => win.webContents.replaceMisspelling(suggestion),
        });
      }
      menuItems.push({ type: 'separator' });
    }

    // Text editing actions (shown when right-clicking an editable field)
    if (params.isEditable) {
      menuItems.push(
        { label: 'Undo', role: 'undo', enabled: params.editFlags.canUndo },
        { label: 'Redo', role: 'redo', enabled: params.editFlags.canRedo },
        { type: 'separator' },
        { label: 'Cut', role: 'cut', enabled: params.editFlags.canCut },
        { label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy },
        { label: 'Paste', role: 'paste', enabled: params.editFlags.canPaste },
        { label: 'Select All', role: 'selectAll', enabled: params.editFlags.canSelectAll },
      );
    } else if (params.selectionText) {
      // Non-editable area with selected text
      menuItems.push(
        { label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy },
        { label: 'Select All', role: 'selectAll' },
      );
    }

    // Link actions
    if (params.linkURL) {
      if (menuItems.length > 0) menuItems.push({ type: 'separator' });
      menuItems.push(
        {
          label: 'Open Link in Browser',
          click: () => shell.openExternal(params.linkURL),
        },
        {
          label: 'Copy Link Address',
          click: () => clipboard.writeText(params.linkURL),
        },
      );
    }

    if (menuItems.length > 0) {
      Menu.buildFromTemplate(menuItems).popup();
    }
  });

  // Load the app
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools();
  } else {
    win.loadFile(join(__dirname, '../../dist/index.html'));
  }

  return win;
}

/**
 * Initialize the application
 */
async function initialize(): Promise<void> {
  // Initialize logger first
  logger.init();
  logger.info('=== CrawBot Application Starting ===');
  logger.debug(
    `Runtime: platform=${process.platform}/${process.arch}, electron=${process.versions.electron}, node=${process.versions.node}, packaged=${app.isPackaged}`
  );

  // Warm up network optimization (non-blocking)
  void warmupNetworkOptimization();

  // Sync autostart with OS on every launch (ensures .desktop file matches setting)
  const launchAtStartup = await getSetting('launchAtStartup');
  setAutoStart(launchAtStartup);

  // Determine if window should start hidden
  const startMinimized =
    process.argv.includes('--minimized') || (await getSetting('startMinimized'));

  // Set application menu
  createMenu();

  // Create the main window
  mainWindow = createWindow(startMinimized);

  // Create system tray
  createTray(mainWindow);

  // Inject OpenRouter site headers (HTTP-Referer & X-Title) for rankings on openrouter.ai
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['https://openrouter.ai/*'] },
    (details, callback) => {
      details.requestHeaders['HTTP-Referer'] = 'https://crawbot.app';
      details.requestHeaders['X-Title'] = 'CrawBot';
      callback({ requestHeaders: details.requestHeaders });
    },
  );

  // Override security headers ONLY for the OpenClaw Gateway Control UI
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const isGatewayUrl = details.url.includes('127.0.0.1:18789') || details.url.includes('localhost:18789');

    if (!isGatewayUrl) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }

    const headers = { ...details.responseHeaders };
    delete headers['X-Frame-Options'];
    delete headers['x-frame-options'];
    if (headers['Content-Security-Policy']) {
      headers['Content-Security-Policy'] = headers['Content-Security-Policy'].map(
        (csp) => csp.replace(/frame-ancestors\s+'none'/g, "frame-ancestors 'self' *")
      );
    }
    if (headers['content-security-policy']) {
      headers['content-security-policy'] = headers['content-security-policy'].map(
        (csp) => csp.replace(/frame-ancestors\s+'none'/g, "frame-ancestors 'self' *")
      );
    }
    callback({ responseHeaders: headers });
  });

  // Register IPC handlers
  registerIpcHandlers(gatewayManager, clawHubService, mainWindow);

  // Register update handlers
  registerUpdateHandlers(appUpdater, mainWindow);

  // Note: Auto-check for updates is driven by the renderer (update store init)
  // so it respects the user's "Auto-check for updates" setting.

  // Minimize to tray on close instead of quitting (all platforms)
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Start Gateway automatically
  try {
    logger.debug('Auto-starting Gateway...');
    await gatewayManager.start();
    logger.info('Gateway auto-start succeeded');

    // Inject CrawBot context into AGENTS.md after workspace files settle
    setTimeout(async () => {
      try {
        const { injectCrawBotContext } = await import('../utils/agents-md-injection');
        await injectCrawBotContext();
      } catch (err) {
        logger.warn('Failed to inject CrawBot context:', err);
      }
    }, 5000);
  } catch (error) {
    logger.error('Gateway auto-start failed:', error);
    mainWindow?.webContents.send('gateway:error', String(error));
  }
}

// Force consistent app name so dev and prod use the same userData path
// (package.json name="crawbot" vs electron-builder productName="CrawBot")
app.setName('CrawBot');

// Application lifecycle
app.whenReady().then(() => {
  initialize();

  // Register activate handler AFTER app is ready to prevent
  // "Cannot create BrowserWindow before app is ready" on macOS.
  app.on('activate', () => {
    if (mainWindow) {
      mainWindow.show();
    } else if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  isQuitting = true;
  await gatewayManager.stop();
});

// Export for testing
export { mainWindow, gatewayManager };
