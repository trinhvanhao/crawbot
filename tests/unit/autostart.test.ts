/**
 * Autostart Utility Tests
 * Tests cross-platform autostart logic (Linux .desktop file path)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoist mock functions so they're available when vi.mock factories execute
const {
  mockSetLoginItemSettings,
  mockMkdirSync,
  mockWriteFileSync,
  mockExistsSync,
  mockUnlinkSync,
} = vi.hoisted(() => ({
  mockSetLoginItemSettings: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockExistsSync: vi.fn<(path: string) => boolean>(),
  mockUnlinkSync: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    setLoginItemSettings: mockSetLoginItemSettings,
  },
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const mocked = {
    ...actual,
    existsSync: mockExistsSync,
    mkdirSync: mockMkdirSync,
    writeFileSync: mockWriteFileSync,
    unlinkSync: mockUnlinkSync,
  };
  return { ...mocked, default: mocked };
});

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { setAutoStart } from '@electron/utils/autostart';

const originalPlatform = process.platform;

function setPlatform(platform: string) {
  Object.defineProperty(process, 'platform', { value: platform, writable: true });
}

describe('setAutoStart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
  });

  it('should use native Electron API on macOS', () => {
    setPlatform('darwin');
    setAutoStart(true);
    expect(mockSetLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
      args: ['--minimized'],
    });
  });

  it('should use native Electron API on Windows', () => {
    setPlatform('win32');
    setAutoStart(false);
    expect(mockSetLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: false,
      args: ['--minimized'],
    });
  });

  it('should create .desktop file on Linux when enabled', () => {
    setPlatform('linux');
    setAutoStart(true);

    expect(mockMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('.config/autostart'),
      { recursive: true },
    );
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('crawbot.desktop'),
      expect.stringContaining('[Desktop Entry]'),
    );
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('crawbot.desktop'),
      expect.stringContaining('--minimized'),
    );
    expect(mockSetLoginItemSettings).not.toHaveBeenCalled();
  });

  it('should remove .desktop file on Linux when disabled and file exists', () => {
    setPlatform('linux');
    mockExistsSync.mockReturnValue(true);
    setAutoStart(false);

    expect(mockUnlinkSync).toHaveBeenCalledWith(
      expect.stringContaining('crawbot.desktop'),
    );
    expect(mockSetLoginItemSettings).not.toHaveBeenCalled();
  });

  it('should not throw on Linux when disabling and file does not exist', () => {
    setPlatform('linux');
    mockExistsSync.mockReturnValue(false);
    expect(() => setAutoStart(false)).not.toThrow();
    expect(mockUnlinkSync).not.toHaveBeenCalled();
  });
});
