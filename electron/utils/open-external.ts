/**
 * Open URL in the user's default browser profile.
 *
 * On macOS, `shell.openExternal` delegates to `open(1)` which tells Chrome
 * to open the URL.  Chrome routes it to whichever profile window was last
 * focused — which is often OpenClaw's automation profile.
 *
 * This helper explicitly launches Chrome with `--profile-directory=Default`
 * so the URL always opens in the user's primary profile.  Falls back to
 * `shell.openExternal` for non-Chrome browsers or other platforms.
 */
import { shell } from 'electron';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';

const CHROME_PATHS_MAC = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
];

const CHROME_PATHS_WIN = [
  `${process.env['PROGRAMFILES'] || ''}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['PROGRAMFILES(X86)'] || ''}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['LOCALAPPDATA'] || ''}\\Google\\Chrome\\Application\\chrome.exe`,
];

function findChrome(): string | null {
  const paths = process.platform === 'darwin' ? CHROME_PATHS_MAC
    : process.platform === 'win32' ? CHROME_PATHS_WIN
    : [];
  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  return null;
}

export async function openExternalInDefaultProfile(url: string): Promise<void> {
  const chromePath = findChrome();

  if (chromePath) {
    return new Promise<void>((resolve) => {
      // --profile-directory=Default opens in the user's main Chrome profile
      execFile(chromePath, ['--profile-directory=Default', url], (err) => {
        if (err) {
          // Fallback to shell.openExternal if Chrome launch fails
          shell.openExternal(url).then(resolve, resolve);
        } else {
          resolve();
        }
      });
    });
  }

  // Non-Chrome or Linux: use standard shell.openExternal
  await shell.openExternal(url);
}
