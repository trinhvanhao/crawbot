/**
 * after-pack.cjs
 *
 * electron-builder afterPack hook.
 *
 * Problem: electron-builder respects .gitignore when copying extraResources.
 * Since .gitignore contains "node_modules/", the openclaw bundle's
 * node_modules directory is silently skipped during the extraResources copy.
 *
 * Solution: This hook runs AFTER electron-builder finishes packing. It manually
 * copies build/openclaw/node_modules/ into the output resources directory,
 * bypassing electron-builder's glob filtering entirely.
 * 
 * Additionally, it removes unnecessary files (type definitions, source maps, docs)
 * to reduce the number of files that need to be code-signed on macOS.
 */

const { cpSync, existsSync, readdirSync, rmSync, statSync } = require('fs');
const { join } = require('path');

// Directories to remove entirely
const REMOVE_DIRS = new Set([
  'test', 'tests', '__tests__', '__mocks__', '__fixtures__',
  '.github', 'docs', 'doc', 'examples', 'example',
  'coverage', '.nyc_output', 'benchmark', 'benchmarks',
  'fixtures', 'man', '.vscode', '.idea', 'typings',
]);

// File extensions to remove
const REMOVE_EXTENSIONS = [
  '.d.ts', '.d.ts.map', '.d.mts', '.d.mts.map', '.d.cts', '.d.cts.map',
  '.js.map', '.mjs.map', '.cjs.map', '.ts.map',
  '.ts', '.tsx', '.mts', '.cts', // TypeScript source files
  '.md', '.markdown', '.rst', '.txt.bak',
  '.gyp', '.gypi', // node-gyp build files
  '.o', '.obj', '.a', '.lib', // compiled objects
  '.cc', '.cpp', '.c', '.h', '.hpp', // C/C++ source
  '.coffee', // CoffeeScript
  '.flow', // Flow types
  '.patch',
  '.tgz', // tarballs
];

// Files to remove by exact name
const REMOVE_FILES = new Set([
  '.DS_Store', '.npmignore', '.eslintrc', '.eslintrc.json', '.eslintrc.js',
  '.prettierrc', '.prettierrc.json', '.prettierrc.js',
  'tsconfig.json', 'tsconfig.build.json', 'tslint.json',
  '.editorconfig', '.travis.yml', '.babelrc', '.babelrc.js',
  'Makefile', 'Gruntfile.js', 'Gulpfile.js', 'rollup.config.js',
  'webpack.config.js', 'jest.config.js', 'karma.conf.js',
  'appveyor.yml', '.zuul.yml', 'binding.gyp',
  'HISTORY.md', 'CHANGES.md', 'AUTHORS', 'CONTRIBUTORS',
]);

/**
 * Recursively remove unnecessary files to reduce code signing overhead
 */
function cleanupUnnecessaryFiles(dir) {
  let removedCount = 0;

  function walk(currentDir) {
    let entries;
    try {
      entries = readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (REMOVE_DIRS.has(entry.name)) {
          try {
            rmSync(fullPath, { recursive: true, force: true });
            removedCount++;
          } catch {
            // Ignore errors
          }
        } else {
          walk(fullPath);
        }
      } else if (entry.isFile()) {
        const name = entry.name;
        const shouldRemove = REMOVE_FILES.has(name) ||
          REMOVE_EXTENSIONS.some(ext => name.endsWith(ext));
        if (shouldRemove) {
          try {
            rmSync(fullPath, { force: true });
            removedCount++;
          } catch {
            // Ignore errors
          }
        }
      }
    }
  }

  walk(dir);
  return removedCount;
}

exports.default = async function afterPack(context) {
  const appOutDir = context.appOutDir;
  const platform = context.electronPlatformName; // 'win32' | 'darwin' | 'linux'

  const src = join(__dirname, '..', 'build', 'openclaw', 'node_modules');

  // On macOS, resources live inside the .app bundle
  let resourcesDir;
  if (platform === 'darwin') {
    const appName = context.packager.appInfo.productFilename;
    resourcesDir = join(appOutDir, `${appName}.app`, 'Contents', 'Resources');
  } else {
    resourcesDir = join(appOutDir, 'resources');
  }

  const dest = join(resourcesDir, 'openclaw', 'node_modules');

  if (!existsSync(src)) {
    console.warn('[after-pack] ⚠️  build/openclaw/node_modules not found. Run "pnpm run bundle:openclaw" first.');
    return;
  }

  const depCount = readdirSync(src, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== '.bin')
    .length;

  console.log(`[after-pack] Copying ${depCount} openclaw dependencies to ${dest} ...`);
  cpSync(src, dest, { recursive: true });
  console.log('[after-pack] ✅ openclaw node_modules copied successfully.');
  
  // Clean up unnecessary files to reduce code signing overhead (especially on macOS)
  console.log('[after-pack] 🧹 Cleaning up unnecessary files (type definitions, source maps, docs)...');
  const removedCount = cleanupUnnecessaryFiles(dest);
  console.log(`[after-pack] ✅ Removed ${removedCount} unnecessary files/directories.`);
};
