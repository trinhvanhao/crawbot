/**
 * File type detection and language mapping utilities for tool output rendering.
 */

/** Extract file path from tool input args (checks common argument names). */
export function extractFilePath(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const args = input as Record<string, unknown>;
  const fp = args.file_path ?? args.filePath ?? args.path ?? args.file;
  if (typeof fp === 'string') return fp;
  return undefined;
}

export type FileCategory = 'image' | 'pdf' | 'office' | 'code' | 'markdown' | 'terminal' | 'text';

const IMAGE_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg', 'ico', 'tiff', 'tif',
]);

const OFFICE_EXTS = new Set([
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp',
]);

const TERMINAL_TOOLS = /^(execute|bash|shell|run_command|terminal|exec|run)$/i;

const CODE_EXT_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
  py: 'python', rb: 'ruby', rs: 'rust', go: 'go',
  java: 'java', kt: 'kotlin', scala: 'scala',
  c: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', h: 'c', hpp: 'cpp',
  cs: 'csharp', swift: 'swift', m: 'objectivec',
  php: 'php', lua: 'lua', r: 'r', pl: 'perl',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash',
  sql: 'sql', graphql: 'graphql', gql: 'graphql',
  html: 'markup', htm: 'markup', xml: 'markup', svg: 'markup',
  css: 'css', scss: 'css', sass: 'css', less: 'css',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'yaml',
  dockerfile: 'docker', makefile: 'makefile',
  dart: 'dart', ex: 'elixir', exs: 'elixir', erl: 'erlang',
  hs: 'haskell', clj: 'clojure', lisp: 'lisp',
  vue: 'markup', svelte: 'markup',
  proto: 'protobuf', tf: 'hcl',
};

function getExtension(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() || '';
  // Handle dotfiles like .gitignore → ''
  const dot = base.lastIndexOf('.');
  if (dot <= 0) {
    // Special filenames
    const lower = base.toLowerCase();
    if (lower === 'dockerfile') return 'dockerfile';
    if (lower === 'makefile') return 'makefile';
    return '';
  }
  return base.slice(dot + 1).toLowerCase();
}

/** Detect the category of file based on path and tool name. */
export function detectFileCategory(filePath: string | undefined, toolName: string): FileCategory {
  if (TERMINAL_TOOLS.test(toolName)) return 'terminal';

  if (!filePath) return 'text';

  const ext = getExtension(filePath);
  if (!ext) return 'text';

  if (ext === 'md' || ext === 'mdx') return 'markdown';
  if (ext === 'pdf') return 'pdf';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (OFFICE_EXTS.has(ext)) return 'office';
  if (ext in CODE_EXT_MAP) return 'code';

  return 'text';
}

/** Map file extension to Prism language identifier. */
export function extToLanguage(filePath: string): string {
  const ext = getExtension(filePath);
  return CODE_EXT_MAP[ext] || '';
}
