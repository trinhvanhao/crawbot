/**
 * Environment Polyfill Helper
 *
 * On macOS, the packaged Electron Helper binary disables process.env for
 * security (node_main.cc:148). This causes Node.js ESM internals to crash
 * when loading ESM-only dependencies from CJS (hasOwnProperty on null env).
 *
 * This module provides a helper to inject a --require polyfill that restores
 * process.env from a temp JSON file before the target script runs.
 */
import { app } from 'electron';
import path from 'path';
import { existsSync, writeFileSync, mkdirSync } from 'fs';

/**
 * Inline polyfill source (CJS). Written to a temp file and loaded via --require.
 */
const ENV_POLYFILL_SOURCE = `'use strict';
if (!process.env || typeof process.env !== 'object') {
  var envData = {};
  var envArgIdx = -1;
  for (var i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === '--crawbot-env' && i + 1 < process.argv.length) {
      envArgIdx = i;
      try {
        var fs = require('fs');
        var raw = fs.readFileSync(process.argv[i + 1], 'utf-8');
        var parsed = JSON.parse(raw);
        for (var key in parsed) {
          if (Object.prototype.hasOwnProperty.call(parsed, key)) {
            envData[key] = parsed[key];
          }
        }
        try { fs.unlinkSync(process.argv[i + 1]); } catch (_e) {}
      } catch (_err) {}
      break;
    }
  }
  Object.defineProperty(process, 'env', {
    value: envData, writable: true, configurable: true, enumerable: true
  });
  if (envArgIdx >= 0) { process.argv.splice(envArgIdx, 2); }
}
`;

/**
 * Prepare env polyfill args for a child process spawned with the Electron binary.
 *
 * In packaged mode, writes the spawn environment to a temp JSON file and returns
 * args to prepend (--require polyfill.cjs --crawbot-env env.json).
 *
 * In dev mode, returns an empty array (no polyfill needed).
 */
export function prepareEnvPolyfillForChild(
  spawnEnv: Record<string, string | undefined>,
): string[] {
  if (!app.isPackaged) return [];

  const tmpDir = path.join(app.getPath('temp'), 'crawbot');
  if (!existsSync(tmpDir)) {
    mkdirSync(tmpDir, { recursive: true });
  }

  // Write spawn environment to a temp file
  const envFilePath = path.join(tmpDir, `env-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
  const envObj: Record<string, string> = {};
  for (const [key, value] of Object.entries(spawnEnv)) {
    if (value !== undefined) {
      envObj[key] = value;
    }
  }
  writeFileSync(envFilePath, JSON.stringify(envObj), 'utf-8');

  // Write the polyfill script to a temp file
  const polyfillPath = path.join(tmpDir, 'env-polyfill.cjs');
  writeFileSync(polyfillPath, ENV_POLYFILL_SOURCE, 'utf-8');

  return ['--require', polyfillPath, '--crawbot-env', envFilePath];
}
