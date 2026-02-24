/**
 * Rich tool output viewer — renders syntax-highlighted code, terminal output,
 * markdown, image previews, and file action cards based on tool type and file extension.
 */
import { useState, useEffect, useCallback } from 'react';
import { Highlight, themes } from 'prism-react-renderer';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FileText, File, ExternalLink, FolderOpen, Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { extractFilePath, detectFileCategory, extToLanguage } from '@/utils/file-type';
import type { FileCategory } from '@/utils/file-type';

const TRUNCATE_LIMIT = 5000;

interface ToolOutputViewerProps {
  toolName: string;
  input: unknown;
  output: string;
}

export function ToolOutputViewer({ toolName, input, output }: ToolOutputViewerProps) {
  const filePath = extractFilePath(input);
  const category = detectFileCategory(filePath, toolName);

  switch (category) {
    case 'terminal':
      return <TerminalPreview input={input} output={output} />;
    case 'code':
      return <CodePreview filePath={filePath!} output={output} />;
    case 'markdown':
      return <MarkdownPreview filePath={filePath} output={output} />;
    case 'image':
      return <ImagePreview filePath={filePath!} />;
    case 'pdf':
    case 'office':
      return <FileActionCard filePath={filePath!} category={category} />;
    default:
      return <RawOutput output={output} />;
  }
}

// ── Truncation hook ─────────────────────────────────────────────

function useTruncation(text: string) {
  const [showFull, setShowFull] = useState(false);
  const isTruncated = text.length > TRUNCATE_LIMIT;
  const display = isTruncated && !showFull ? text.slice(0, TRUNCATE_LIMIT) : text;
  const toggle = useCallback(() => setShowFull((v) => !v), []);
  return { display, isTruncated, showFull, toggle, totalLength: text.length };
}

// ── CodePreview ─────────────────────────────────────────────────

function CodePreview({ filePath, output }: { filePath: string; output: string }) {
  const { display, isTruncated, showFull, toggle, totalLength } = useTruncation(output);
  const language = extToLanguage(filePath) || 'text';
  const fileName = filePath.split(/[\\/]/).pop() || filePath;

  return (
    <div className="border-t border-border/30 pt-2">
      <div className="rounded-md overflow-hidden border border-border/40">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/60 border-b border-border/30">
          <span className="text-[10px] font-mono rounded bg-foreground/10 px-1.5 py-0.5 text-muted-foreground">
            {language}
          </span>
          <span className="text-[11px] text-muted-foreground truncate">{fileName}</span>
        </div>
        {/* Code */}
        <div className="max-h-64 overflow-y-auto">
          <Highlight theme={themes.nightOwl} code={display} language={language}>
            {({ tokens, getLineProps, getTokenProps }) => (
              <pre className="text-xs p-3 overflow-x-auto !m-0 !bg-[#011627]">
                {tokens.map((line, i) => (
                  <div key={i} {...getLineProps({ line })} className="table-row">
                    <span className="table-cell pr-4 text-right select-none opacity-40 text-[11px]">
                      {i + 1}
                    </span>
                    <span className="table-cell">
                      {line.map((token, key) => (
                        <span key={key} {...getTokenProps({ token })} />
                      ))}
                    </span>
                  </div>
                ))}
              </pre>
            )}
          </Highlight>
        </div>
      </div>
      {isTruncated && (
        <button className="text-xs text-primary hover:underline mt-1" onClick={toggle}>
          {showFull ? 'Show less' : `Show all (${totalLength.toLocaleString()} chars)`}
        </button>
      )}
    </div>
  );
}

// ── TerminalPreview ─────────────────────────────────────────────

function TerminalPreview({ input, output }: { input: unknown; output: string }) {
  const { display, isTruncated, showFull, toggle, totalLength } = useTruncation(output);
  const command =
    input && typeof input === 'object'
      ? (input as Record<string, unknown>).command ?? (input as Record<string, unknown>).cmd
      : undefined;

  return (
    <div className="border-t border-border/30 pt-2">
      <div className="rounded-md overflow-hidden bg-zinc-900 max-h-64 overflow-y-auto">
        <pre className="text-xs p-3 font-mono whitespace-pre-wrap break-words !m-0">
          {typeof command === 'string' && (
            <span className="text-green-400">$ {command}{'\n'}</span>
          )}
          <span className="text-zinc-300">{display}</span>
        </pre>
      </div>
      {isTruncated && (
        <button className="text-xs text-primary hover:underline mt-1" onClick={toggle}>
          {showFull ? 'Show less' : `Show all (${totalLength.toLocaleString()} chars)`}
        </button>
      )}
    </div>
  );
}

// ── MarkdownPreview ─────────────────────────────────────────────

function MarkdownPreview({ filePath, output }: { filePath?: string; output: string }) {
  const { display, isTruncated, showFull, toggle, totalLength } = useTruncation(output);
  const fileName = filePath?.split(/[\\/]/).pop();

  return (
    <div className="border-t border-border/30 pt-2">
      {fileName && (
        <span className="text-[11px] text-muted-foreground mb-1 block">{fileName}</span>
      )}
      <div className="prose prose-sm dark:prose-invert max-w-none max-h-64 overflow-y-auto px-1">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{display}</ReactMarkdown>
      </div>
      {isTruncated && (
        <button className="text-xs text-primary hover:underline mt-1" onClick={toggle}>
          {showFull ? 'Show less' : `Show all (${totalLength.toLocaleString()} chars)`}
        </button>
      )}
    </div>
  );
}

// ── ImagePreview ────────────────────────────────────────────────

function ImagePreview({ filePath }: { filePath: string }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fileName = filePath.split(/[\\/]/).pop() || filePath;

  // Infer mime type from extension
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const mimeMap: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
    avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon',
  };
  const mimeType = mimeMap[ext] || 'image/png';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await window.electron.ipcRenderer.invoke('media:getThumbnails', [
          { filePath, mimeType },
        ]) as Record<string, { preview: string | null; fileSize: number }>;
        if (!cancelled) {
          const entry = result[filePath];
          setPreview(entry?.preview ?? null);
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [filePath, mimeType]);

  const handleOpen = useCallback(() => {
    window.electron.ipcRenderer.invoke('shell:openPath', filePath);
  }, [filePath]);

  const handleShowFolder = useCallback(() => {
    window.electron.ipcRenderer.invoke('shell:showItemInFolder', filePath);
  }, [filePath]);

  if (loading) {
    return (
      <div className="border-t border-border/30 pt-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ImageIcon className="h-4 w-4" />
          <span>Loading preview...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-border/30 pt-2">
      {preview ? (
        <div className="space-y-2">
          <img
            src={preview}
            alt={fileName}
            className="max-w-xs max-h-48 rounded-md border border-border/40 object-contain cursor-pointer"
            onClick={handleOpen}
          />
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground truncate">{fileName}</span>
            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={handleOpen} title="Open">
              <ExternalLink className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={handleShowFolder} title="Show in Folder">
              <FolderOpen className="h-3 w-3" />
            </Button>
          </div>
        </div>
      ) : (
        <FileActionCard filePath={filePath} category="image" />
      )}
    </div>
  );
}

// ── FileActionCard ──────────────────────────────────────────────

function FileActionCard({ filePath, category }: { filePath: string; category: FileCategory }) {
  const fileName = filePath.split(/[\\/]/).pop() || filePath;

  const labelMap: Record<string, string> = {
    pdf: 'PDF Document',
    office: 'Office Document',
    image: 'Image File',
  };
  const label = labelMap[category] || 'File';

  const IconComponent = category === 'pdf' || category === 'office' ? FileText : File;

  const handleOpen = useCallback(() => {
    window.electron.ipcRenderer.invoke('shell:openPath', filePath);
  }, [filePath]);

  const handleShowFolder = useCallback(() => {
    window.electron.ipcRenderer.invoke('shell:showItemInFolder', filePath);
  }, [filePath]);

  return (
    <div className="border-t border-border/30 pt-2">
      <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 bg-muted/30 max-w-xs">
        <IconComponent className="h-8 w-8 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium truncate">{fileName}</p>
          <p className="text-[10px] text-muted-foreground">{label}</p>
        </div>
        <div className="flex gap-1 shrink-0">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleOpen} title="Open">
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleShowFolder} title="Show in Folder">
            <FolderOpen className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── RawOutput (fallback) ────────────────────────────────────────

function RawOutput({ output }: { output: string }) {
  const { display, isTruncated, showFull, toggle, totalLength } = useTruncation(output);

  return (
    <div className="border-t border-border/30 pt-2">
      <pre className="text-xs text-muted-foreground/80 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap break-words">
        {display}
      </pre>
      {isTruncated && (
        <button className="text-xs text-primary hover:underline mt-1" onClick={toggle}>
          {showFull ? 'Show less' : `Show all (${totalLength.toLocaleString()} chars)`}
        </button>
      )}
    </div>
  );
}
