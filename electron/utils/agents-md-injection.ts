/**
 * AGENTS.md CrawBot Context Injection
 * Appends/updates a <crawbot> block in every workspace's AGENTS.md
 * so agents know they're running inside CrawBot.
 */
import { app } from 'electron';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { platform, arch } from 'os';

import { getOpenClawConfigDir, getOpenClawStatus } from './paths';
import { getSetting, setSetting } from './store';
import { logger } from './logger';

const BLOCK_START = '<crawbot>';
const BLOCK_END = '</crawbot>';

/**
 * Build the CrawBot context block content
 */
function buildCrawBotBlock(): string {
  const crawBotVersion = app.getVersion();
  const openClawStatus = getOpenClawStatus();
  const openClawVersion = openClawStatus.version ?? 'unknown';
  const openClawDir = openClawStatus.dir;
  const plat = platform();
  const archt = arch();

  return `${BLOCK_START}
## CrawBot Runtime Context

You are running inside **CrawBot** (v${crawBotVersion}), an Electron desktop application that provides a graphical interface for OpenClaw AI agents.

### Environment
- **CrawBot version:** ${crawBotVersion}
- **OpenClaw version:** ${openClawVersion}
- **OpenClaw path:** ${openClawDir}
- **Platform:** ${plat}/${archt}

### Architecture
CrawBot is a dual-process Electron app:
- **Main process** manages the Gateway lifecycle, system tray, IPC, and secure storage
- **Renderer process** is a React UI that communicates with the Gateway over WebSocket (JSON-RPC)
- **OpenClaw Gateway** runs as a child process on port 18789

### Guidelines
- You are managed by CrawBot — do not attempt to start, stop, or reconfigure the Gateway process
- API keys and provider credentials are stored securely in the system keychain via CrawBot
- The user interacts with you through CrawBot's chat interface
- CrawBot handles auto-updates, workspace management, and skill configuration
${BLOCK_END}`;
}

/**
 * Find all AGENTS.md files across OpenClaw workspace directories
 */
function findAgentsMdFiles(): string[] {
  const configDir = getOpenClawConfigDir();
  if (!existsSync(configDir)) {
    return [];
  }

  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(configDir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    const entryPath = join(configDir, entry);
    try {
      if (!statSync(entryPath).isDirectory()) continue;
    } catch {
      continue;
    }
    const agentsMd = join(entryPath, 'AGENTS.md');
    if (existsSync(agentsMd)) {
      results.push(agentsMd);
    }
  }

  return results;
}

/**
 * Inject or replace the CrawBot block in a single AGENTS.md file
 * Returns true if the file was modified
 */
function injectIntoFile(filePath: string, block: string): boolean {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch (err) {
    logger.warn(`Failed to read ${filePath}:`, err);
    return false;
  }

  const startIdx = content.indexOf(BLOCK_START);
  const endIdx = content.indexOf(BLOCK_END);

  let newContent: string;
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    // Replace existing block (complete pair found)
    newContent = content.substring(0, startIdx) + block + content.substring(endIdx + BLOCK_END.length);
  } else if (startIdx !== -1) {
    // Opening tag without closing — truncate from the tag onward (old corrupted block)
    const cleaned = content.substring(0, startIdx).trimEnd();
    newContent = cleaned + '\n\n' + block + '\n';
  } else if (endIdx !== -1) {
    // Orphan closing tag only — strip it and append fresh
    const cleaned = (content.substring(0, endIdx) + content.substring(endIdx + BLOCK_END.length)).trimEnd();
    newContent = cleaned + '\n\n' + block + '\n';
  } else {
    // No existing block — append
    const separator = content.endsWith('\n') ? '\n' : '\n\n';
    newContent = content + separator + block + '\n';
  }

  try {
    writeFileSync(filePath, newContent, 'utf-8');
    return true;
  } catch (err) {
    logger.warn(`Failed to write ${filePath}:`, err);
    return false;
  }
}

/**
 * Main entry: inject CrawBot context into all workspace AGENTS.md files
 * Skips if the current version has already been injected.
 */
export async function injectCrawBotContext(): Promise<void> {
  const currentVersion = app.getVersion();
  const lastVersion = await getSetting('lastInjectedVersion');

  if (currentVersion === lastVersion) {
    logger.debug('AGENTS.md injection: already at current version, skipping');
    return;
  }

  const files = findAgentsMdFiles();
  if (files.length === 0) {
    logger.debug('AGENTS.md injection: no workspace AGENTS.md files found, will retry next startup');
    return;
  }

  const block = buildCrawBotBlock();
  let injectedCount = 0;

  for (const filePath of files) {
    try {
      if (injectIntoFile(filePath, block)) {
        injectedCount++;
        logger.info(`Injected CrawBot context into ${filePath}`);
      }
    } catch (err) {
      logger.warn(`Failed to inject into ${filePath}:`, err);
    }
  }

  if (injectedCount > 0) {
    await setSetting('lastInjectedVersion', currentVersion);
    logger.info(`AGENTS.md injection complete: ${injectedCount}/${files.length} files updated`);
  }
}
