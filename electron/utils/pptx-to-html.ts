/**
 * Custom PPTX-to-HTML converter
 *
 * Parses .pptx files (ZIP/OOXML) and renders each slide as positioned HTML
 * with embedded images (base64 data-URIs), text, and basic shapes.
 *
 * Supports placeholder shapes by looking up positions from slide layouts.
 * Uses only `adm-zip` (already a project dependency) — no external apps needed.
 */

/* ── Constants ── */

/** Pixels per inch for conversion */
const PPI = 96;
/** 1 EMU in pixels (1 inch = 914400 EMU) */
const EMU_TO_PX = PPI / 914_400;

/* ── Helpers ── */

function emu(val: string | null | undefined): number {
  return val ? parseInt(val, 10) * EMU_TO_PX : 0;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getAttr(xml: string, attr: string): string | null {
  const re = new RegExp(`\\b${attr}="([^"]*)"`, 'i');
  const m = xml.match(re);
  return m ? m[1] : null;
}

/** Normalize relative path segments: "ppt/slides/../media/img.png" → "ppt/media/img.png" */
function normalizePath(p: string): string {
  const parts = p.split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '..') resolved.pop();
    else if (part !== '.') resolved.push(part);
  }
  return resolved.join('/');
}

/* ── Relationship parser ── */

interface Rel {
  id: string;
  target: string;
  type: string;
}

function parseRels(xml: string): Map<string, Rel> {
  const map = new Map<string, Rel>();
  const re = /<Relationship\s+[^>]*?\/>/g;
  let match;
  while ((match = re.exec(xml)) !== null) {
    const tag = match[0];
    const id = getAttr(tag, 'Id');
    const target = getAttr(tag, 'Target');
    const type = getAttr(tag, 'Type');
    if (id && target) {
      map.set(id, { id, target, type: type ?? '' });
    }
  }
  return map;
}

/* ── Rect type ── */

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/* ── Element parsers ── */

/** Extract position and size from <a:xfrm> */
function parseXfrm(xml: string): Rect | null {
  const xfrmMatch = xml.match(/<a:xfrm[^>]*>([\s\S]*?)<\/a:xfrm>/);
  if (!xfrmMatch) return null;
  const xfrm = xfrmMatch[0];
  const offMatch = xfrm.match(/<a:off[^/]*?x="([^"]*)"[^/]*?y="([^"]*)"/);
  const extMatch = xfrm.match(/<a:ext[^/]*?cx="([^"]*)"[^/]*?cy="([^"]*)"/);
  if (!offMatch || !extMatch) return null;
  return {
    x: emu(offMatch[1]),
    y: emu(offMatch[2]),
    w: emu(extMatch[1]),
    h: emu(extMatch[2]),
  };
}

/** Get placeholder type and idx from a <p:sp> element */
function getPlaceholder(spXml: string): { type: string; idx: string } | null {
  const phMatch = spXml.match(/<p:ph([^/]*)\/?>/);
  if (!phMatch) return null;
  const type = getAttr(phMatch[1], 'type') ?? '';
  const idx = getAttr(phMatch[1], 'idx') ?? '';
  return { type, idx };
}

/** Extract text runs from a shape element */
function parseTextRuns(spXml: string): { html: string; hasText: boolean } {
  const paragraphs: string[] = [];
  let hasText = false;

  const pRe = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g;
  let pMatch;
  while ((pMatch = pRe.exec(spXml)) !== null) {
    const pContent = pMatch[1];
    const runs: string[] = [];

    // Match <a:r> runs
    const rRe = /<a:r>([\s\S]*?)<\/a:r>/g;
    let rMatch;
    while ((rMatch = rRe.exec(pContent)) !== null) {
      const runContent = rMatch[1];
      const tMatch = runContent.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/);
      if (!tMatch || !tMatch[1]) continue;
      hasText = true;

      const rPrMatch = runContent.match(/<a:rPr([^>]*)\/?>[\s\S]*?(?:<\/a:rPr>)?/);
      const rPrAttrs = rPrMatch ? rPrMatch[1] : '';

      const bold = /\bb="1"/.test(rPrAttrs);
      const italic = /\bi="1"/.test(rPrAttrs);
      const fontSize = getAttr(rPrAttrs, 'sz');
      const underline = getAttr(rPrAttrs, 'u');

      let color = '';
      const solidFill = runContent.match(/<a:solidFill>\s*<a:srgbClr val="([^"]*)"/);
      if (solidFill) color = `#${solidFill[1]}`;

      let style = '';
      if (fontSize) style += `font-size:${parseInt(fontSize, 10) / 100}pt;`;
      if (color) style += `color:${color};`;
      if (bold) style += 'font-weight:bold;';
      if (italic) style += 'font-style:italic;';
      if (underline && underline !== 'none') style += 'text-decoration:underline;';

      const escaped = esc(tMatch[1]);
      runs.push(style ? `<span style="${style}">${escaped}</span>` : escaped);
    }

    // Bare <a:t> text (not inside <a:r>)
    if (runs.length === 0) {
      const bareT = /<a:t[^>]*>([^<]+)<\/a:t>/g;
      let bt;
      while ((bt = bareT.exec(pContent)) !== null) {
        if (bt[1].trim()) {
          hasText = true;
          runs.push(esc(bt[1]));
        }
      }
    }

    // Paragraph alignment
    const pPrMatch = pContent.match(/<a:pPr([^>]*)\/?>/);
    const algn = pPrMatch ? getAttr(pPrMatch[1], 'algn') : null;
    let textAlign = '';
    if (algn === 'ctr') textAlign = 'text-align:center;';
    else if (algn === 'r') textAlign = 'text-align:right;';
    else if (algn === 'just') textAlign = 'text-align:justify;';

    if (runs.length > 0) {
      paragraphs.push(`<div style="margin:0;${textAlign}">${runs.join('')}</div>`);
    }
  }

  return { html: paragraphs.join(''), hasText };
}

/** Detect solid fill on an element */
function parseSolidFill(xml: string): string | null {
  const fill = xml.match(/<a:solidFill>\s*<a:srgbClr val="([^"]*)"/);
  return fill ? `#${fill[1]}` : null;
}

/* ── Layout placeholder position lookup ── */

/** Build a map of placeholder positions from a slide layout XML */
function buildPlaceholderMap(layoutXml: string): Map<string, Rect> {
  const map = new Map<string, Rect>();
  const spRe = /<p:sp>([\s\S]*?)<\/p:sp>/g;
  let spMatch;
  while ((spMatch = spRe.exec(layoutXml)) !== null) {
    const spXml = spMatch[1];
    const ph = getPlaceholder(spXml);
    if (!ph) continue;
    const pos = parseXfrm(spXml);
    if (!pos) continue;
    // Key by "type" or "idx" (idx takes priority for matching)
    const key = ph.idx ? `idx:${ph.idx}` : `type:${ph.type}`;
    map.set(key, pos);
    // Also store by type for fallback matching
    if (ph.type) map.set(`type:${ph.type}`, pos);
  }
  return map;
}

/** Look up a placeholder's position from layout, trying idx first, then type */
function lookupPlaceholderPos(
  ph: { type: string; idx: string },
  layoutMap: Map<string, Rect>,
): Rect | null {
  if (ph.idx) {
    const byIdx = layoutMap.get(`idx:${ph.idx}`);
    if (byIdx) return byIdx;
  }
  if (ph.type) {
    const byType = layoutMap.get(`type:${ph.type}`);
    if (byType) return byType;
  }
  return null;
}

/* ── Main converter ── */

/**
 * Convert a .pptx buffer to an array of HTML strings (one per slide).
 * Each slide is a self-contained div with absolutely positioned elements.
 */
export async function convertPptxToHtml(
  buffer: Buffer,
): Promise<{ slides: string[]; slideWidth: number; slideHeight: number }> {
  const AdmZip = (await import('adm-zip')).default;
  const zip = new AdmZip(buffer);

  // --- Read presentation.xml for slide size ---
  const presXml = zip.getEntry('ppt/presentation.xml')?.getData().toString('utf-8') ?? '';
  const sldSzMatch = presXml.match(/<p:sldSz[^>]*?cx="(\d+)"[^>]*?cy="(\d+)"/);
  const slideW = (sldSzMatch ? parseInt(sldSzMatch[1], 10) : 12192000) * EMU_TO_PX;
  const slideH = (sldSzMatch ? parseInt(sldSzMatch[2], 10) : 6858000) * EMU_TO_PX;

  // --- Collect media files as base64 data-URIs ---
  const media = new Map<string, string>();
  const entries = zip.getEntries();
  const mimeMap: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    tiff: 'image/tiff',
    emf: 'image/x-emf',
    wmf: 'image/x-wmf',
  };
  for (const entry of entries) {
    if (entry.entryName.startsWith('ppt/media/')) {
      const ext = entry.entryName.split('.').pop()?.toLowerCase() ?? 'png';
      const mime = mimeMap[ext] ?? 'application/octet-stream';
      media.set(entry.entryName, `data:${mime};base64,${entry.getData().toString('base64')}`);
    }
  }

  // --- Cache slide layout placeholder maps ---
  const layoutCache = new Map<string, Map<string, Rect>>();
  function getLayoutMap(layoutPath: string): Map<string, Rect> {
    const normalized = normalizePath(layoutPath);
    if (layoutCache.has(normalized)) return layoutCache.get(normalized)!;
    const layoutEntry = zip.getEntry(normalized);
    if (!layoutEntry) {
      layoutCache.set(normalized, new Map());
      return new Map();
    }
    const layoutXml = layoutEntry.getData().toString('utf-8');
    const map = buildPlaceholderMap(layoutXml);
    layoutCache.set(normalized, map);
    return map;
  }

  // --- Find and sort slide entries ---
  const slideEntries = entries
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
    .sort((a, b) => {
      const na = parseInt(a.entryName.match(/slide(\d+)/)?.[1] ?? '0');
      const nb = parseInt(b.entryName.match(/slide(\d+)/)?.[1] ?? '0');
      return na - nb;
    });

  const slidesHtml: string[] = [];

  for (const slideEntry of slideEntries) {
    const slideXml = slideEntry.getData().toString('utf-8');
    const slideNum = slideEntry.entryName.match(/slide(\d+)/)?.[1] ?? '1';

    // Load relationships for this slide
    const relsPath = `ppt/slides/_rels/slide${slideNum}.xml.rels`;
    const relsEntry = zip.getEntry(relsPath);
    const rels = relsEntry
      ? parseRels(relsEntry.getData().toString('utf-8'))
      : new Map<string, Rel>();

    // Resolve slide layout for placeholder position lookup
    let layoutMap = new Map<string, Rect>();
    for (const [, rel] of rels) {
      if (rel.type.includes('slideLayout')) {
        layoutMap = getLayoutMap('ppt/slides/' + rel.target);
        break;
      }
    }

    const elements: string[] = [];

    // --- Background ---
    let bgStyle = 'background-color:#fff;';
    const bgMatch = slideXml.match(/<p:bg>([\s\S]*?)<\/p:bg>/);
    if (bgMatch) {
      const bgColor = parseSolidFill(bgMatch[1]);
      if (bgColor) bgStyle = `background-color:${bgColor};`;
    }

    // --- Background image from layout/master (fill:blipFill on bg) ---
    const bgBlip = slideXml.match(/<p:bg>[\s\S]*?r:embed="([^"]*)"[\s\S]*?<\/p:bg>/);
    if (bgBlip) {
      const bgRel = rels.get(bgBlip[1]);
      if (bgRel) {
        const bgMediaPath = normalizePath('ppt/slides/' + bgRel.target);
        const bgUri = media.get(bgMediaPath);
        if (bgUri) {
          bgStyle = `background-image:url('${bgUri}');background-size:cover;background-position:center;`;
        }
      }
    }

    // --- Pictures (<p:pic>) ---
    const picRe = /<p:pic>([\s\S]*?)<\/p:pic>/g;
    let picMatch;
    while ((picMatch = picRe.exec(slideXml)) !== null) {
      const picXml = picMatch[1];
      const pos = parseXfrm(picXml);
      if (!pos) continue;

      const embedMatch = picXml.match(/r:embed="([^"]*)"/);
      if (!embedMatch) continue;
      const rel = rels.get(embedMatch[1]);
      if (!rel) continue;

      const normalizedPath = normalizePath('ppt/slides/' + rel.target);
      const dataUri = media.get(normalizedPath);
      if (!dataUri) continue;

      // Image cropping
      const srcRectMatch = picXml.match(/<a:srcRect([^/]*)\/?>/);
      let clipStyle = '';
      if (srcRectMatch) {
        const t = parseInt(getAttr(srcRectMatch[1], 't') ?? '0', 10) / 1000;
        const b = parseInt(getAttr(srcRectMatch[1], 'b') ?? '0', 10) / 1000;
        const l = parseInt(getAttr(srcRectMatch[1], 'l') ?? '0', 10) / 1000;
        const r = parseInt(getAttr(srcRectMatch[1], 'r') ?? '0', 10) / 1000;
        if (t || b || l || r) {
          clipStyle = `clip-path:inset(${t}% ${r}% ${b}% ${l}%);`;
        }
      }

      elements.push(
        `<div style="position:absolute;left:${pos.x}px;top:${pos.y}px;width:${pos.w}px;height:${pos.h}px;overflow:hidden;">` +
          `<img src="${dataUri}" style="width:100%;height:100%;object-fit:fill;${clipStyle}" />` +
          `</div>`,
      );
    }

    // --- Shapes with text (<p:sp>) ---
    const spRe = /<p:sp>([\s\S]*?)<\/p:sp>/g;
    let spMatch;
    while ((spMatch = spRe.exec(slideXml)) !== null) {
      const spXml = spMatch[1];

      // Get position: direct xfrm or inherited from layout placeholder
      let pos = parseXfrm(spXml);
      if (!pos) {
        const ph = getPlaceholder(spXml);
        if (ph) {
          pos = lookupPlaceholderPos(ph, layoutMap);
        }
      }
      if (!pos) continue;

      const { html: textHtml, hasText } = parseTextRuns(spXml);
      const shapeFill = parseSolidFill(spXml);

      // Skip invisible/empty shapes
      if (!hasText && !shapeFill) continue;

      let style = `position:absolute;left:${pos.x}px;top:${pos.y}px;width:${pos.w}px;height:${pos.h}px;`;
      style += 'overflow:hidden;display:flex;flex-direction:column;justify-content:center;';
      if (shapeFill) style += `background-color:${shapeFill};`;
      style += 'padding:4px 8px;box-sizing:border-box;';

      // Vertical alignment
      const bodyPr = spXml.match(/<a:bodyPr([^>]*)\/?>/);
      if (bodyPr) {
        const anchor = getAttr(bodyPr[1], 'anchor');
        if (anchor === 't') style += 'justify-content:flex-start;';
        else if (anchor === 'b') style += 'justify-content:flex-end;';
      }

      elements.push(`<div style="${style}">${textHtml}</div>`);
    }

    // --- Group shapes (<p:grpSp>) — flatten pictures & shapes inside ---
    const grpRe = /<p:grpSp>([\s\S]*?)<\/p:grpSp>/g;
    let grpMatch;
    while ((grpMatch = grpRe.exec(slideXml)) !== null) {
      const grpXml = grpMatch[1];

      // Pictures in groups
      const grpPicRe = /<p:pic>([\s\S]*?)<\/p:pic>/g;
      let gPicMatch;
      while ((gPicMatch = grpPicRe.exec(grpXml)) !== null) {
        const picXml = gPicMatch[1];
        const pos = parseXfrm(picXml);
        if (!pos) continue;

        const embedMatch = picXml.match(/r:embed="([^"]*)"/);
        if (!embedMatch) continue;
        const rel = rels.get(embedMatch[1]);
        if (!rel) continue;

        const normalizedPath = normalizePath('ppt/slides/' + rel.target);
        const dataUri = media.get(normalizedPath);
        if (!dataUri) continue;

        elements.push(
          `<div style="position:absolute;left:${pos.x}px;top:${pos.y}px;width:${pos.w}px;height:${pos.h}px;overflow:hidden;">` +
            `<img src="${dataUri}" style="width:100%;height:100%;object-fit:fill;" />` +
            `</div>`,
        );
      }

      // Shapes in groups
      const grpSpRe = /<p:sp>([\s\S]*?)<\/p:sp>/g;
      let gSpMatch;
      while ((gSpMatch = grpSpRe.exec(grpXml)) !== null) {
        const spXml = gSpMatch[1];
        const pos = parseXfrm(spXml);
        if (!pos) continue;
        const { html: textHtml, hasText } = parseTextRuns(spXml);
        const shapeFill = parseSolidFill(spXml);
        if (!hasText && !shapeFill) continue;

        let style = `position:absolute;left:${pos.x}px;top:${pos.y}px;width:${pos.w}px;height:${pos.h}px;`;
        style += 'overflow:hidden;display:flex;flex-direction:column;justify-content:center;';
        if (shapeFill) style += `background-color:${shapeFill};`;
        style += 'padding:4px 8px;box-sizing:border-box;';
        elements.push(`<div style="${style}">${textHtml}</div>`);
      }
    }

    const slideHtml =
      `<div style="position:relative;width:${slideW}px;height:${slideH}px;${bgStyle}overflow:hidden;font-family:Calibri,Arial,sans-serif;font-size:12pt;">` +
      elements.join('') +
      `</div>`;

    slidesHtml.push(slideHtml);
  }

  return { slides: slidesHtml, slideWidth: slideW, slideHeight: slideH };
}
