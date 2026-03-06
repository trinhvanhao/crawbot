/**
 * Node.js Detection, Installation & CLI Tools Management
 * Handles checking/installing system Node.js and CLI tools (Claude Code, Gemini CLI, Codex CLI)
 */
import { app } from 'electron';
import { spawn } from 'child_process';
import { existsSync, mkdirSync, unlinkSync, createWriteStream, chmodSync, symlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import https from 'https';
import http from 'http';
import { logger } from './logger';

const NODE_VERSION = 'v22.22.1';
const IS_WIN = process.platform === 'win32';
const NPM_INSTALL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes per tool
const SPAWN_CHECK_TIMEOUT_MS = 15 * 1000; // 15 seconds for which/where checks

// ─── Types ───────────────────────────────────────────────────────────

export interface NodeStatus {
  installed: boolean;
  version?: string;
  path?: string;
  source?: 'system' | 'managed';
}

export interface CliToolInfo {
  name: string;
  npmPackage: string;
  command: string;
}

export interface CliToolStatus {
  name: string;
  command: string;
  installed: boolean;
  version?: string;
}

// CLI tools to install — these support OAuth login for their respective providers
export const CLI_TOOLS: CliToolInfo[] = [
  { name: 'Claude Code', npmPackage: '@anthropic-ai/claude-code', command: 'claude' },
  { name: 'Gemini CLI', npmPackage: '@google/gemini-cli', command: 'gemini' },
  { name: 'Codex CLI', npmPackage: '@openai/codex', command: 'codex' },
];

// ─── Path Helpers ────────────────────────────────────────────────────

function getManagedNodeDir(): string {
  return join(app.getPath('userData'), 'nodejs');
}

function getManagedBinDir(): string {
  return IS_WIN ? getManagedNodeDir() : join(getManagedNodeDir(), 'bin');
}

function getNodeBinPath(binDir: string): string {
  return IS_WIN ? join(binDir, 'node.exe') : join(binDir, 'node');
}

function getNpmBinPath(binDir: string): string {
  return IS_WIN ? join(binDir, 'npm.cmd') : join(binDir, 'npm');
}

function getCliToolBinPath(command: string): string {
  const binDir = getManagedBinDir();
  return IS_WIN ? join(binDir, `${command}.cmd`) : join(binDir, command);
}

// ─── Spawn with timeout ─────────────────────────────────────────────

/** Spawn a process with a timeout — resolves with code=null on timeout */
function spawnWithTimeout(
  cmd: string,
  args: string[],
  timeoutMs: number,
  options?: { shell?: boolean; env?: NodeJS.ProcessEnv },
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(cmd, args, {
      shell: options?.shell ?? IS_WIN,
      env: options?.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => { stdout += d; });
    child.stderr?.on('data', (d) => { stderr += d; });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { child.kill(); } catch { /* ignore */ }
        resolve({ code: null, stdout, stderr });
      }
    }, timeoutMs);

    child.on('close', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      }
    });

    child.on('error', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ code: null, stdout, stderr });
      }
    });
  });
}

// ─── Node.js Detection ──────────────────────────────────────────────

/** Check if Node.js is available in system PATH */
export async function checkSystemNode(): Promise<NodeStatus> {
  const cmd = IS_WIN ? 'where.exe' : 'which';
  const result = await spawnWithTimeout(cmd, ['node'], SPAWN_CHECK_TIMEOUT_MS);

  if (result.code === 0 && result.stdout.trim()) {
    const nodePath = result.stdout.trim().split('\n')[0].trim();
    const verResult = await spawnWithTimeout(nodePath, ['--version'], SPAWN_CHECK_TIMEOUT_MS, { shell: false });
    return {
      installed: true,
      version: verResult.stdout.trim() || undefined,
      path: nodePath,
      source: 'system',
    };
  }

  return { installed: false };
}

/** Check if CrawBot's managed Node.js is available */
export async function checkManagedNode(): Promise<NodeStatus> {
  const binDir = getManagedBinDir();
  const nodeBin = getNodeBinPath(binDir);

  if (!existsSync(nodeBin)) {
    return { installed: false };
  }

  const result = await spawnWithTimeout(nodeBin, ['--version'], SPAWN_CHECK_TIMEOUT_MS, { shell: false });
  return {
    installed: result.code === 0,
    version: result.stdout.trim() || undefined,
    path: nodeBin,
    source: 'managed',
  };
}

/** Get overall Node.js status (system first, then managed) */
export async function getNodeStatus(): Promise<NodeStatus> {
  const sys = await checkSystemNode();
  if (sys.installed) return sys;
  return checkManagedNode();
}

// ─── Node.js Installation ────────────────────────────────────────────

/** Download a file from URL to local path, following redirects */
function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    const proto = url.startsWith('https') ? https : http;

    const request = proto.get(url, (response) => {
      if ((response.statusCode === 301 || response.statusCode === 302) && response.headers.location) {
        file.close();
        try { unlinkSync(dest); } catch { /* ignore */ }
        downloadFile(response.headers.location, dest).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        file.close();
        reject(new Error(`Download failed: HTTP ${response.statusCode}`));
        return;
      }

      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    });

    request.on('error', (err) => { file.close(); reject(err); });
    file.on('error', (err) => { file.close(); reject(err); });
  });
}

/** Run a shell command and return stdout */
function runCommand(cmd: string, args: string[], options?: { env?: NodeJS.ProcessEnv; cwd?: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      shell: IS_WIN,
      env: options?.env || process.env,
      cwd: options?.cwd,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => { stdout += d; });
    child.stderr?.on('data', (d) => { stderr += d; });
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`Exit ${code}: ${stderr.slice(-500) || stdout.slice(-500)}`));
    });
    child.on('error', reject);
  });
}

/** Install Node.js by downloading the official binary distribution. No sudo/admin required. */
export async function installManagedNode(): Promise<{ success: boolean; version?: string; error?: string }> {
  try {
    const platform = process.platform;
    const arch = process.arch;

    const platformMap: Record<string, string> = { darwin: 'darwin', linux: 'linux', win32: 'win' };
    const pStr = platformMap[platform];
    if (!pStr) return { success: false, error: `Unsupported platform: ${platform}` };

    const ext = IS_WIN ? 'zip' : 'tar.gz';
    const dirName = `node-${NODE_VERSION}-${pStr}-${arch}`;
    const url = `https://nodejs.org/dist/${NODE_VERSION}/${dirName}.${ext}`;

    const managedDir = getManagedNodeDir();
    const tempFile = join(app.getPath('temp'), `${dirName}.${ext}`);

    logger.info(`[nodejs-setup] Downloading Node.js ${NODE_VERSION} from ${url}`);
    await downloadFile(url, tempFile);

    if (!existsSync(managedDir)) {
      mkdirSync(managedDir, { recursive: true });
    }

    logger.info(`[nodejs-setup] Extracting to ${managedDir}`);
    if (IS_WIN) {
      await runCommand('tar', ['-xf', tempFile, '-C', managedDir, '--strip-components=1']);
    } else {
      await runCommand('tar', ['-xzf', tempFile, '-C', managedDir, '--strip-components=1']);
    }

    try { unlinkSync(tempFile); } catch { /* ignore */ }

    const binDir = getManagedBinDir();
    const nodeBin = getNodeBinPath(binDir);
    if (!existsSync(nodeBin)) {
      return { success: false, error: 'Node.js binary not found after extraction' };
    }

    if (!IS_WIN) {
      try { chmodSync(nodeBin, 0o755); } catch { /* ignore */ }
      try { chmodSync(getNpmBinPath(binDir), 0o755); } catch { /* ignore */ }
    }

    logger.info(`[nodejs-setup] Node.js ${NODE_VERSION} installed to ${managedDir}`);
    // Ensure managed bin dir is in process PATH immediately
    ensureManagedBinInProcessPath();
    return { success: true, version: NODE_VERSION };
  } catch (error) {
    logger.error('[nodejs-setup] Failed to install Node.js:', error);
    return { success: false, error: String(error) };
  }
}

// ─── CLI Tools ───────────────────────────────────────────────────────

/** Check if a single CLI tool is installed (system PATH or managed bin) — with timeout */
export async function checkCliTool(tool: CliToolInfo): Promise<CliToolStatus> {
  const result: CliToolStatus = { name: tool.name, command: tool.command, installed: false };

  const cmd = IS_WIN ? 'where.exe' : 'which';
  const pathResult = await spawnWithTimeout(cmd, [tool.command], SPAWN_CHECK_TIMEOUT_MS);

  if (pathResult.code === 0) {
    result.installed = true;
    return result;
  }

  // Check managed bin dir
  const managedBin = getCliToolBinPath(tool.command);
  if (existsSync(managedBin)) {
    result.installed = true;
    return result;
  }

  return result;
}

/** Check all CLI tools status */
export async function checkAllCliTools(): Promise<CliToolStatus[]> {
  return Promise.all(CLI_TOOLS.map((t) => checkCliTool(t)));
}

/** Find a CLI tool by command name */
export function findCliTool(command: string): CliToolInfo | undefined {
  return CLI_TOOLS.find((t) => t.command === command);
}

/** Install a single CLI tool using npm — with timeout and non-interactive flags */
export async function installCliTool(tool: CliToolInfo): Promise<{ success: boolean; error?: string }> {
  try {
    const nodeStatus = await getNodeStatus();
    if (!nodeStatus.installed) {
      return { success: false, error: 'Node.js is not available' };
    }

    let npmBin: string;
    const env = { ...process.env };
    const managedDir = getManagedNodeDir();
    const managedBinDir = getManagedBinDir();

    if (nodeStatus.source === 'managed') {
      npmBin = getNpmBinPath(managedBinDir);
      env.PATH = `${managedBinDir}${IS_WIN ? ';' : ':'}${env.PATH || ''}`;
    } else {
      npmBin = 'npm';
      if (!existsSync(managedDir)) {
        mkdirSync(managedDir, { recursive: true });
      }
    }

    logger.info(`[nodejs-setup] Installing ${tool.name} (${tool.npmPackage})...`);

    const args = [
      'install', '-g', tool.npmPackage,
      '--no-progress',
      '--no-fund',
      '--no-audit',
      '--loglevel=warn',
    ];

    if (nodeStatus.source === 'system') {
      args.push('--prefix', managedDir);
    }

    const result = await spawnWithTimeout(npmBin, args, NPM_INSTALL_TIMEOUT_MS, {
      shell: IS_WIN,
      env,
    });

    if (result.code === 0) {
      logger.info(`[nodejs-setup] ${tool.name} installed successfully`);
      // Ensure managed bin dir is in process PATH so OAuth flows can find the tool immediately
      ensureManagedBinInProcessPath();
      return { success: true };
    } else if (result.code === null) {
      logger.error(`[nodejs-setup] ${tool.name} install timed out`);
      return { success: false, error: `Installation timed out (${NPM_INSTALL_TIMEOUT_MS / 1000}s)` };
    } else {
      return { success: false, error: `npm install failed (exit ${result.code}): ${result.stderr.slice(-300)}` };
    }
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/** Install a single CLI tool by command name (for per-tool IPC calls) */
export async function installSingleCliTool(command: string): Promise<{ success: boolean; error?: string }> {
  const tool = findCliTool(command);
  if (!tool) {
    return { success: false, error: `Unknown CLI tool: ${command}` };
  }

  const status = await checkCliTool(tool);
  if (status.installed) {
    logger.info(`[nodejs-setup] ${tool.name} already installed, skipping`);
    return { success: true };
  }

  return installCliTool(tool);
}

/** Install all CLI tools, skipping already-installed ones */
export async function installAllCliTools(): Promise<Record<string, { success: boolean; error?: string }>> {
  const results: Record<string, { success: boolean; error?: string }> = {};

  for (const tool of CLI_TOOLS) {
    const status = await checkCliTool(tool);
    if (status.installed) {
      results[tool.command] = { success: true };
      logger.info(`[nodejs-setup] ${tool.name} already installed, skipping`);
      continue;
    }
    results[tool.command] = await installCliTool(tool);
  }

  return results;
}

/** Get the path to a CLI tool binary (for spawning from CrawBot) */
export function getCliToolPath(command: string): string | null {
  const managedBin = getCliToolBinPath(command);
  if (existsSync(managedBin)) return managedBin;
  return null;
}

// ─── PATH Persistence & Python Symlinks ─────────────────────────────

import { persistToSystemPath, isPathPersisted, type PathPersistenceResult } from './path-persistence';
import { getPythonBinDir } from './uv-setup';

/** Get the managed bin dir path (public export for gateway manager and IPC) */
export function getManagedBinDirPath(): string {
  return getManagedBinDir();
}

/**
 * Ensure the managed bin dir is in the current process.env.PATH.
 * Call this at app startup AND after installing CLI tools so that
 * OAuth flows, provider lookups, etc. can find gemini/claude/codex
 * without restarting the app.
 */
export function ensureManagedBinInProcessPath(): void {
  try {
    const managedBin = getManagedBinDir();
    if (!managedBin || !existsSync(managedBin)) return;
    const sep = IS_WIN ? ';' : ':';
    const currentPath = process.env.PATH || '';
    if (!currentPath.split(sep).includes(managedBin)) {
      process.env.PATH = `${managedBin}${sep}${currentPath}`;
      logger.info(`[nodejs-setup] Prepended managed bin dir to process PATH: ${managedBin}`);
    }
  } catch {
    // ignore — app may not be ready yet
  }
}

/** Check if the managed bin dir is already persisted in system PATH */
export function isManagedBinInPath(): boolean {
  return isPathPersisted(getManagedBinDir());
}

/** Persist the managed bin directory to the system PATH */
export async function persistManagedBinToPath(): Promise<PathPersistenceResult> {
  return persistToSystemPath(getManagedBinDir());
}

/**
 * Create symlinks (Unix) or .cmd wrappers (Windows) for Python
 * in the managed Node.js bin dir, so a single PATH entry covers everything.
 */
export async function symlinkPythonToManagedBin(): Promise<{ success: boolean; error?: string }> {
  try {
    const pythonBinDir = await getPythonBinDir();
    if (!pythonBinDir) {
      return { success: false, error: 'Python bin directory not found' };
    }

    const managedBinDir = getManagedBinDir();
    if (!existsSync(managedBinDir)) {
      mkdirSync(managedBinDir, { recursive: true });
    }

    if (IS_WIN) {
      // Windows: create .cmd wrapper scripts (symlinks require Developer Mode)
      const bins = ['python.exe', 'python3.exe'];
      for (const bin of bins) {
        const source = join(pythonBinDir, bin);
        if (!existsSync(source)) continue;
        const target = join(managedBinDir, bin.replace('.exe', '.cmd'));
        const content = `@"${source}" %*\r\n`;
        writeFileSync(target, content, 'utf-8');
        logger.info(`[nodejs-setup] Created wrapper ${target} -> ${source}`);
      }
    } else {
      // macOS/Linux: create symlinks
      const bins = ['python3', 'python'];
      for (const bin of bins) {
        const source = join(pythonBinDir, bin);
        if (!existsSync(source)) continue;
        const target = join(managedBinDir, bin);
        try { unlinkSync(target); } catch { /* ignore */ }
        symlinkSync(source, target);
        logger.info(`[nodejs-setup] Symlinked ${target} -> ${source}`);
      }
    }

    return { success: true };
  } catch (error) {
    logger.error('[nodejs-setup] Failed to symlink Python:', error);
    return { success: false, error: String(error) };
  }
}
