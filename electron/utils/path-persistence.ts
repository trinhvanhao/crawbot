/**
 * Cross-platform system PATH persistence
 * Adds a bin directory to the user's shell PATH so it survives reboots.
 */
import { homedir } from 'os';
import { existsSync, readFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
import { logger } from './logger';

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const MARKER = '# Added by CrawBot';

// ─── Types ───────────────────────────────────────────────────────────

export interface PathPersistenceResult {
  success: boolean;
  method: string;
  requiresRestart: boolean;
  error?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function isPathInFile(filePath: string, binDir: string): boolean {
  if (!existsSync(filePath)) return false;
  const content = readFileSync(filePath, 'utf-8');
  return content.includes(binDir);
}

function appendPathToFile(filePath: string, binDir: string): void {
  if (isPathInFile(filePath, binDir)) return;
  const block = `\n${MARKER}\nexport PATH="${binDir}:$PATH"\n`;
  appendFileSync(filePath, block, 'utf-8');
  logger.info(`[path-persistence] Appended PATH entry to ${filePath}`);
}

// ─── macOS ───────────────────────────────────────────────────────────

async function persistPathMacOS(binDir: string): Promise<PathPersistenceResult> {
  const home = homedir();
  const files = [
    join(home, '.zprofile'),
    join(home, '.bash_profile'),
  ];

  try {
    for (const file of files) {
      appendPathToFile(file, binDir);
    }
    return { success: true, method: '.zprofile + .bash_profile', requiresRestart: true };
  } catch (error) {
    return { success: false, method: 'shell-config', requiresRestart: true, error: String(error) };
  }
}

// ─── Linux ───────────────────────────────────────────────────────────

async function persistPathLinux(binDir: string): Promise<PathPersistenceResult> {
  const home = homedir();
  const files = [
    join(home, '.profile'),
    join(home, '.bashrc'),
  ];

  const loginShell = process.env.SHELL || '';
  if (loginShell.includes('zsh')) {
    files.push(join(home, '.zprofile'));
  }

  try {
    for (const file of files) {
      appendPathToFile(file, binDir);
    }
    return {
      success: true,
      method: files.map((f) => f.split('/').pop()).join(' + '),
      requiresRestart: true,
    };
  } catch (error) {
    return { success: false, method: 'shell-config', requiresRestart: true, error: String(error) };
  }
}

// ─── Windows ─────────────────────────────────────────────────────────

async function persistPathWindows(binDir: string): Promise<PathPersistenceResult> {
  const escapedDir = binDir.replace(/\\/g, '\\\\');
  const psScript = `
    $currentPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
    if ($currentPath -and $currentPath.Contains('${escapedDir}')) {
      Write-Output 'ALREADY_SET'
    } else {
      $newPath = if ($currentPath) { '${escapedDir};' + $currentPath } else { '${escapedDir}' }
      [Environment]::SetEnvironmentVariable('PATH', $newPath, 'User')
      Write-Output 'UPDATED'
    }
  `;

  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', psScript], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => { stdout += d; });
    child.stderr?.on('data', (d: Buffer) => { stderr += d; });

    child.on('close', (code) => {
      if (code === 0) {
        const alreadySet = stdout.trim() === 'ALREADY_SET';
        logger.info(`[path-persistence] Windows PATH ${alreadySet ? 'already set' : 'updated'}`);
        resolve({ success: true, method: 'User PATH (registry)', requiresRestart: !alreadySet });
      } else {
        resolve({
          success: false,
          method: 'registry',
          requiresRestart: true,
          error: stderr.trim() || `PowerShell exit ${code}`,
        });
      }
    });

    child.on('error', (err) => {
      resolve({ success: false, method: 'registry', requiresRestart: true, error: String(err) });
    });
  });
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Persist a bin directory to the system PATH so it survives reboots
 * and is available in new shell sessions.
 */
export async function persistToSystemPath(binDir: string): Promise<PathPersistenceResult> {
  logger.info(`[path-persistence] Persisting ${binDir} to system PATH (platform=${process.platform})`);

  if (IS_MAC) return persistPathMacOS(binDir);
  if (IS_WIN) return persistPathWindows(binDir);
  return persistPathLinux(binDir);
}

/**
 * Check if a bin directory is already in persistent PATH config files.
 */
export function isPathPersisted(binDir: string): boolean {
  const home = homedir();

  if (IS_WIN) {
    // Would require a spawn to check registry; rely on idempotency of persistToSystemPath
    return false;
  }

  const filesToCheck = IS_MAC
    ? [join(home, '.zprofile'), join(home, '.bash_profile')]
    : [join(home, '.profile'), join(home, '.bashrc')];

  return filesToCheck.some((f) => isPathInFile(f, binDir));
}
