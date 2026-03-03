/**
 * LibreOffice Headless Utilities
 * Detect LibreOffice installation and convert office documents to PDF.
 */
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

// Cached detection result (undefined = not yet checked)
let cachedSofficePath: string | null | undefined = undefined;

/**
 * Find the LibreOffice `soffice` binary on this system.
 * Returns the absolute path or null if not found. Result is cached.
 */
export function findLibreOffice(): string | null {
  if (cachedSofficePath !== undefined) return cachedSofficePath;

  const platform = process.platform;

  if (platform === 'darwin') {
    const macPath = '/Applications/LibreOffice.app/Contents/MacOS/soffice';
    if (existsSync(macPath)) {
      cachedSofficePath = macPath;
      return macPath;
    }
  } else if (platform === 'win32') {
    const programFiles = [
      process.env['ProgramFiles'],
      process.env['ProgramFiles(x86)'],
      'C:\\Program Files',
      'C:\\Program Files (x86)',
    ].filter(Boolean) as string[];

    for (const pf of programFiles) {
      const winPath = join(pf, 'LibreOffice', 'program', 'soffice.exe');
      if (existsSync(winPath)) {
        cachedSofficePath = winPath;
        return winPath;
      }
    }
  } else {
    // Linux: check common paths
    const linuxPaths = ['/usr/bin/soffice', '/usr/local/bin/soffice'];
    for (const p of linuxPaths) {
      if (existsSync(p)) {
        cachedSofficePath = p;
        return p;
      }
    }
  }

  cachedSofficePath = null;
  return null;
}

/**
 * Convert an office file to PDF using LibreOffice headless mode.
 * Returns the path to the generated PDF file.
 *
 * Uses an isolated user-installation profile per invocation to avoid
 * lock-file conflicts when LibreOffice is already running.
 */
export function convertToPdf(
  sofficePath: string,
  inputPath: string,
  outDir: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Isolated profile to avoid lock conflicts with running LibreOffice instances
    const userInstall = `file://${join(outDir, 'lo-profile')}`;

    const child = spawn(
      sofficePath,
      [
        '--headless',
        `-env:UserInstallation=${userInstall}`,
        '--convert-to',
        'pdf',
        '--outdir',
        outDir,
        inputPath,
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 60_000, // 60s timeout
      },
    );

    let stderr = '';
    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`LibreOffice conversion failed (code ${code}): ${stderr}`));
        return;
      }
      // LibreOffice outputs <basename>.pdf in outDir
      const inputBasename = inputPath.split(/[\\/]/).pop()!;
      const pdfName = inputBasename.replace(/\.[^.]+$/, '.pdf');
      const pdfPath = join(outDir, pdfName);

      if (!existsSync(pdfPath)) {
        reject(new Error('LibreOffice conversion produced no output file'));
        return;
      }
      resolve(pdfPath);
    });
  });
}

/* ── Temp directory cleanup ── */

const pendingTempDirs = new Set<string>();

export function trackTempDir(dir: string): void {
  pendingTempDirs.add(dir);
}

export function cleanupTempDirs(): void {
  for (const dir of pendingTempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup errors */
    }
  }
  pendingTempDirs.clear();
}
