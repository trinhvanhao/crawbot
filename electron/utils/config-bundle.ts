/**
 * Config Bundle Export/Import
 * Creates and restores ZIP bundles of CrawBot + OpenClaw configuration
 */
import AdmZip from 'adm-zip';
import { app } from 'electron';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, normalize } from 'node:path';
import { getOpenClawConfigDir, getDataDir, ensureDir } from './paths';
import { importSettings } from './store';
import { logger } from './logger';

const BUNDLE_SCHEMA_VERSION = 1;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

/** Directories to skip when walking ~/.openclaw/ */
const EXCLUDED_DIRS = new Set([
  'logs',
  'cron',
  'devices',
  'canvas',
  'node_modules',
  '.git',
]);

/** App data files to include */
const APP_DATA_FILES = [
  'settings.json',
  'crawbot-providers.json',
  'crawbot-device-identity.json',
];

interface BundleMeta {
  schemaVersion: number;
  appVersion: string;
  timestamp: string;
  includesApiKeys: boolean;
  fileCount: number;
}

export interface ExportOptions {
  includeApiKeys: boolean;
}

export interface ExportResult {
  success: boolean;
  filePath?: string;
  fileCount?: number;
  error?: string;
}

export interface ImportResult {
  success: boolean;
  fileCount?: number;
  error?: string;
}

export interface ValidateResult {
  valid: boolean;
  meta?: BundleMeta;
  error?: string;
}

/**
 * Recursively walk a directory and collect file paths,
 * skipping excluded directories and files over MAX_FILE_SIZE.
 */
function walkDir(dir: string, baseDir: string): string[] {
  const files: string[] = [];
  if (!existsSync(dir)) return files;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;

    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDir(fullPath, baseDir));
    } else if (entry.isFile()) {
      try {
        const stat = statSync(fullPath);
        if (stat.size <= MAX_FILE_SIZE) {
          files.push(fullPath);
        } else {
          logger.warn(`Skipping large file: ${fullPath} (${stat.size} bytes)`);
        }
      } catch {
        // Skip files we can't stat
      }
    }
  }
  return files;
}

/**
 * Strip API keys from crawbot-providers.json content
 */
function stripApiKeys(json: string): string {
  try {
    const data = JSON.parse(json);
    if (data && typeof data === 'object') {
      // Clear the apiKeys map if present
      if (data.apiKeys) {
        data.apiKeys = {};
      }
      // Clear individual provider apiKey fields
      if (Array.isArray(data.providers)) {
        for (const provider of data.providers) {
          if (provider.apiKey) {
            provider.apiKey = '';
          }
        }
      }
    }
    return JSON.stringify(data, null, 2);
  } catch {
    return json;
  }
}

/**
 * Export configuration to a ZIP bundle.
 */
export function exportConfigBundle(
  outputPath: string,
  options: ExportOptions
): ExportResult {
  try {
    const zip = new AdmZip();
    let fileCount = 0;

    // Add files from ~/.openclaw/
    const openclawDir = getOpenClawConfigDir();
    if (existsSync(openclawDir)) {
      const openclawFiles = walkDir(openclawDir, openclawDir);
      for (const filePath of openclawFiles) {
        const relativePath = relative(openclawDir, filePath);

        // Skip auth-profiles if not including API keys
        if (!options.includeApiKeys && relativePath.includes('auth-profiles')) {
          continue;
        }

        const zipPath = join('openclaw', relativePath);
        zip.addFile(zipPath, readFileSync(filePath));
        fileCount++;
      }
    }

    // Add app data files from userData
    const dataDir = getDataDir();
    for (const fileName of APP_DATA_FILES) {
      const filePath = join(dataDir, fileName);
      if (!existsSync(filePath)) continue;

      let content = readFileSync(filePath);

      // Strip API keys from providers file if requested
      if (!options.includeApiKeys && fileName === 'crawbot-providers.json') {
        content = Buffer.from(stripApiKeys(content.toString('utf-8')));
      }

      zip.addFile(join('appdata', fileName), content);
      fileCount++;
    }

    // Add bundle metadata
    const meta: BundleMeta = {
      schemaVersion: BUNDLE_SCHEMA_VERSION,
      appVersion: app.getVersion(),
      timestamp: new Date().toISOString(),
      includesApiKeys: options.includeApiKeys,
      fileCount,
    };
    zip.addFile('bundle-meta.json', Buffer.from(JSON.stringify(meta, null, 2)));

    zip.writeZip(outputPath);
    logger.info(`Config bundle exported: ${outputPath} (${fileCount} files)`);

    return { success: true, filePath: outputPath, fileCount };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Config bundle export failed:', message);
    return { success: false, error: message };
  }
}

/**
 * Validate a ZIP bundle has correct structure.
 */
export function validateConfigBundle(zipPath: string): ValidateResult {
  try {
    const zip = new AdmZip(zipPath);
    const metaEntry = zip.getEntry('bundle-meta.json');
    if (!metaEntry) {
      return { valid: false, error: 'Missing bundle-meta.json — not a valid CrawBot config bundle' };
    }

    const meta: BundleMeta = JSON.parse(metaEntry.getData().toString('utf-8'));
    if (!meta.schemaVersion || !meta.appVersion || !meta.timestamp) {
      return { valid: false, error: 'Invalid bundle metadata' };
    }

    return { valid: true, meta };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, error: message };
  }
}

/**
 * Prevent zip-slip by ensuring the resolved path stays within the target dir.
 */
function isSafePath(targetDir: string, entryName: string): boolean {
  const resolved = resolve(targetDir, entryName);
  const normalizedTarget = normalize(targetDir + '/');
  return resolved.startsWith(normalizedTarget);
}

/**
 * Import a ZIP bundle, restoring config files.
 */
export async function importConfigBundle(zipPath: string): Promise<ImportResult> {
  try {
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();
    let fileCount = 0;

    const openclawDir = getOpenClawConfigDir();
    const dataDir = getDataDir();

    for (const entry of entries) {
      if (entry.isDirectory || entry.entryName === 'bundle-meta.json') continue;

      const entryName = entry.entryName;

      if (entryName.startsWith('openclaw/')) {
        // Restore to ~/.openclaw/
        const relativePath = entryName.slice('openclaw/'.length);
        if (!isSafePath(openclawDir, relativePath)) {
          logger.warn(`Skipping unsafe path: ${entryName}`);
          continue;
        }
        const targetPath = join(openclawDir, relativePath);
        ensureDir(join(targetPath, '..'));
        writeFileSync(targetPath, entry.getData());
        fileCount++;
      } else if (entryName.startsWith('appdata/')) {
        // Restore to userData
        const fileName = entryName.slice('appdata/'.length);
        if (!isSafePath(dataDir, fileName)) {
          logger.warn(`Skipping unsafe path: ${entryName}`);
          continue;
        }

        if (fileName === 'settings.json') {
          // Use the settings store import for proper merge
          await importSettings(entry.getData().toString('utf-8'));
        } else {
          const targetPath = join(dataDir, fileName);
          writeFileSync(targetPath, entry.getData());
        }
        fileCount++;
      }
    }

    logger.info(`Config bundle imported: ${zipPath} (${fileCount} files restored)`);
    return { success: true, fileCount };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Config bundle import failed:', message);
    return { success: false, error: message };
  }
}
