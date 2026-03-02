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

/**
 * View mode for the workspace file panel.
 * - 'editor': text-editable files (code, markdown, json, config, etc.)
 * - 'image': image files rendered inline
 * - 'pdf': PDF rendered inline
 * - 'audio': audio files with player
 * - 'video': video files with player
 * - 'office': office docs (open externally)
 */
export type FileViewMode = 'editor' | 'image' | 'pdf' | 'audio' | 'video' | 'office';

const IMAGE_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg', 'ico', 'tiff', 'tif',
]);

const AUDIO_EXTS = new Set([
  'mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'opus', 'aiff', 'aif',
]);

const VIDEO_EXTS = new Set([
  'mp4', 'webm', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'ogv', 'm4v', '3gp',
]);

const OFFICE_EXTS = new Set([
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp',
  'rtf', 'csv',
]);

const SPREADSHEET_EXTS = new Set([
  'xls', 'xlsx', 'ods', 'csv',
]);

const PRESENTATION_EXTS = new Set([
  'ppt', 'pptx', 'odp',
]);

const DOCUMENT_EXTS = new Set([
  'doc', 'docx', 'odt', 'rtf',
]);

/** MIME type mapping for common file extensions. */
const MIME_MAP: Record<string, string> = {
  // Images
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif', svg: 'image/svg+xml',
  ico: 'image/x-icon', tiff: 'image/tiff', tif: 'image/tiff',
  // Audio
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac',
  aac: 'audio/aac', m4a: 'audio/mp4', wma: 'audio/x-ms-wma', opus: 'audio/opus',
  aiff: 'audio/aiff', aif: 'audio/aiff',
  // Video
  mp4: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
  mov: 'video/quicktime', wmv: 'video/x-ms-wmv', flv: 'video/x-flv', ogv: 'video/ogg',
  m4v: 'video/mp4', '3gp': 'video/3gpp',
  // PDF
  pdf: 'application/pdf',
};

/** Get MIME type for a file path. Returns undefined if unknown. */
export function getMimeType(filePath: string): string | undefined {
  const ext = getExtension(filePath);
  return MIME_MAP[ext];
}

/** Determine the workspace view mode for a file. */
export function getFileViewMode(filePath: string): FileViewMode {
  const ext = getExtension(filePath);
  if (!ext) return 'editor'; // no extension = likely text
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (OFFICE_EXTS.has(ext)) return 'office';
  return 'editor';
}

/** Get a human-readable file type label. */
export function getFileTypeLabel(filePath: string): string {
  const ext = getExtension(filePath);
  if (!ext) return 'Text File';
  if (IMAGE_EXTS.has(ext)) return 'Image';
  if (ext === 'pdf') return 'PDF Document';
  if (AUDIO_EXTS.has(ext)) return 'Audio';
  if (VIDEO_EXTS.has(ext)) return 'Video';
  if (SPREADSHEET_EXTS.has(ext)) return 'Spreadsheet';
  if (PRESENTATION_EXTS.has(ext)) return 'Presentation';
  if (DOCUMENT_EXTS.has(ext)) return 'Document';
  return 'File';
}

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
