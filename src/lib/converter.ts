import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';
import { Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, BorderStyle, WidthType } from 'docx';
import { PDFDocument, PDFName, PDFRawStream, StandardFonts, rgb, PageSizes } from 'pdf-lib';
import zlib from 'zlib';
import { compressPdfImages } from './pdfCompressor';
import { getProgress, setProgress, clearProgress } from './progress';
import { getUploadsDir, getConvertedDir } from './tempStorage';

let ffmpegAvailable = false;
function initFfmpeg() {
  try {
    const binaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const candidates = [
      path.join(process.cwd(), 'node_modules', 'ffmpeg-static', binaryName),
    ];
    try {
      const pkg = require.resolve('ffmpeg-static/package.json');
      candidates.push(path.join(path.dirname(pkg), binaryName));
    } catch {}
    try {
      const ffmpegStatic = require('ffmpeg-static');
      if (typeof ffmpegStatic === 'string') {
        candidates.push(ffmpegStatic);
      }
    } catch {}

    for (const cand of candidates) {
      if (fs.existsSync(/*turbopackIgnore: true*/ cand)) {
        if (process.platform !== 'win32') {
          try { fs.chmodSync(cand, 0o755); } catch {}
        }
        ffmpeg.setFfmpegPath(cand);
        ffmpegAvailable = true;
        return;
      }
    }

    try {
      const checkCmd = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg';
      const out = execSync(checkCmd, { stdio: 'pipe' }).toString().trim();
      if (out) {
        ffmpeg.setFfmpegPath(out.split(/\r?\n/)[0]);
        ffmpegAvailable = true;
        return;
      }
    } catch {}
  } catch {}
}
initFfmpeg();

export { getProgress, setProgress, clearProgress };

// ─── Helpers ────────────────────────────────────────────────────────────────

let cachedGhostscript: string | null = null;
/** Find Ghostscript executable on common Windows paths */
function findGhostscript(): string | null {
  if (cachedGhostscript !== null) return cachedGhostscript;
  const candidates = [
    'C:\\Program Files\\gs\\gs10.04.0\\bin\\gswin64c.exe',
    'C:\\Program Files\\gs\\gs10.03.1\\bin\\gswin64c.exe',
    'C:\\Program Files\\gs\\gs10.02.1\\bin\\gswin64c.exe',
    'C:\\Program Files (x86)\\gs\\gs10.04.0\\bin\\gswin32c.exe',
  ];
  try {
    const gsBase = 'C:\\Program Files\\gs';
    if (fs.existsSync(gsBase)) {
      const dirs = fs.readdirSync(gsBase);
      for (const dir of dirs) {
        candidates.unshift(`${gsBase}\\${dir}\\bin\\gswin64c.exe`);
      }
    }
  } catch {}

  for (const c of candidates) {
    if (fs.existsSync(/*turbopackIgnore: true*/ c)) {
      cachedGhostscript = c;
      return c;
    }
  }
  return null;
}

let cachedSoffice: string | null = null;
/** Find LibreOffice soffice executable (prefers soffice.com for headless CLI without window popups) */
function findLibreOffice(): string | null {
  if (process.env.VERCEL) return null;
  if (cachedSoffice !== null) return cachedSoffice;
  const candidates = [
    'C:\\Program Files\\LibreOffice\\program\\soffice.com',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.com',
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  ];
  for (const c of candidates) {
    if (fs.existsSync(/*turbopackIgnore: true*/ c)) {
      cachedSoffice = c;
      return c;
    }
  }
  return null;
}

/** Convert PDF to DOCX using pdf2docx (Python) with high visual fidelity */
async function convertPdfToDocxPython(inputPath: string, outputPath: string): Promise<boolean> {
  // On Vercel serverless, external python modules are not installed; skip instantly to prevent timeout
  if (process.env.VERCEL) return false;

  const pyCode = 'import sys; from pdf2docx import Converter; cv = Converter(sys.argv[1]); cv.convert(sys.argv[2]); cv.close()';
  const pyCandidates = ['python', 'py', 'python3'];
  
  for (const py of pyCandidates) {
    try {
      const success = await new Promise<boolean>((resolve) => {
        const proc = spawn(/*turbopackIgnore: true*/ py, ['-c', pyCode, inputPath, outputPath], {
          windowsHide: true,
          shell: false,
        });
        proc.on('close', (code) => {
          resolve(code === 0 && fs.existsSync(/*turbopackIgnore: true*/ outputPath));
        });
        proc.on('error', () => resolve(false));
      });
      if (success) return true;
    } catch {}
  }
  return false;
}

/** Convert PDF to DOCX using LibreOffice as a fallback */
async function convertPdfToDocxLibreOffice(inputPath: string, outputPath: string): Promise<boolean> {
  if (process.env.VERCEL) return false;
  const soffice = findLibreOffice();
  if (!soffice) return false;

  const outDir = path.dirname(outputPath);
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(/*turbopackIgnore: true*/ soffice, [
        '--headless',
        '--infilter=writer_pdf_import',
        '--convert-to', 'docx',
        '--outdir', outDir,
        inputPath
      ], {
        windowsHide: true,
        shell: false
      });
      proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`LibreOffice exited with code ${code}`)));
      proc.on('error', reject);
    });

    const inputBaseName = path.basename(inputPath, path.extname(inputPath));
    const loOutput = path.join(outDir, `${inputBaseName}.docx`);
    if (loOutput !== outputPath && fs.existsSync(loOutput)) {
      await fs.promises.rename(loOutput, outputPath);
    }
    return fs.existsSync(outputPath);
  } catch {
    return false;
  }
}

interface ExtractedPdfImage {
  buffer: Buffer;
  width: number;
  height: number;
}

/** Extract embedded images page-by-page from PDF using pdf-lib + sharp with caching and safety limits */
async function extractImagesFromPdf(pdfBytes: Buffer): Promise<Map<number, ExtractedPdfImage[]>> {
  const imagesByPage = new Map<number, ExtractedPdfImage[]>();
  const imageCache = new Map<any, ExtractedPdfImage>();
  let totalExtracted = 0;

  try {
    const loadedDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const pageCount = Math.min(loadedDoc.getPageCount(), 50);

    for (let pIdx = 0; pIdx < pageCount; pIdx++) {
      if (totalExtracted >= 25) break;
      const page = loadedDoc.getPage(pIdx);
      const pageImages: ExtractedPdfImage[] = [];

      try {
        const res = page.node.Resources();
        if (res) {
          const xObjRef = res.get(PDFName.of('XObject'));
          if (xObjRef) {
            const xObj = loadedDoc.context.lookup(xObjRef);
            if (xObj && typeof (xObj as any).entries === 'function') {
              for (const [, ref] of (xObj as any).entries()) {
                if (pageImages.length >= 6) break;

                if (imageCache.has(ref)) {
                  pageImages.push(imageCache.get(ref)!);
                  continue;
                }

                const stream = loadedDoc.context.lookup(ref);
                if (stream instanceof PDFRawStream) {
                  const dict = stream.dict;
                  const subtype = dict.get(PDFName.of('Subtype'))?.toString();
                  if (subtype === '/Image') {
                    const filter = dict.get(PDFName.of('Filter'))?.toString() || '';
                    const w = (dict.get(PDFName.of('Width')) as any)?.asNumber?.() || 300;
                    const h = (dict.get(PDFName.of('Height')) as any)?.asNumber?.() || 200;

                    // Filter out 1x1 masks / icons / excessive dimensions
                    if (w < 16 || h < 16 || w > 4000 || h > 4000) continue;

                    const colorSpace = dict.get(PDFName.of('ColorSpace'))?.toString();
                    let buf: Buffer | null = null;

                    if (filter.includes('DCTDecode') || filter.includes('JPXDecode')) {
                      try {
                        buf = await sharp(Buffer.from(stream.contents)).png().toBuffer();
                      } catch {}
                    } else if (filter.includes('FlateDecode')) {
                      try {
                        const raw = zlib.inflateSync(Buffer.from(stream.contents));
                        const channels = colorSpace === '/DeviceGray' ? 1 : 3;
                        if (raw.length >= w * h * channels) {
                          buf = await sharp(raw.subarray(0, w * h * channels), {
                            raw: { width: w, height: h, channels: channels as 1 | 3 }
                          }).png().toBuffer();
                        }
                      } catch {}
                    }

                    if (!buf) {
                      try {
                        buf = await sharp(Buffer.from(stream.contents)).png().toBuffer();
                      } catch {}
                    }

                    if (buf) {
                      const item: ExtractedPdfImage = { buffer: buf, width: w, height: h };
                      imageCache.set(ref, item);
                      pageImages.push(item);
                      totalExtracted++;
                    }
                  }
                }
              }
            }
          }
        }
      } catch {}

      if (pageImages.length > 0) {
        imagesByPage.set(pIdx, pageImages);
      }
    }
  } catch {}
  return imagesByPage;
}

/** Pure JavaScript High-Fidelity PDF to DOCX converter (runs everywhere including serverless cloud) */
async function convertPdfToDocxPureJs(inputPath: string, outputPath: string): Promise<void> {
  const pdfBytes = await fs.promises.readFile(inputPath);
  const imagesByPage = await extractImagesFromPdf(pdfBytes);

  let pdfData: any = null;
  try {
    const PDFParser = require('pdf2json');
    const parser = new PDFParser(null, 1);
    pdfData = await new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      }, 5000);

      parser.on('pdfParser_dataReady', (data: any) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(data);
        }
      });
      parser.on('pdfParser_dataError', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(null);
        }
      });

      try {
        parser.parseBuffer(pdfBytes);
      } catch {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(null);
        }
      }
    });
  } catch {
    pdfData = null;
  }

  const children: any[] = [];
  const hasValidPdf2JsonText = pdfData?.Pages?.some((p: any) => p.Texts && p.Texts.length > 0);

  if (hasValidPdf2JsonText) {
    const totalPages = pdfData.Pages.length;

    for (let pIdx = 0; pIdx < totalPages; pIdx++) {
      const pageData = pdfData.Pages[pIdx];
      const pageImages = imagesByPage.get(pIdx) || [];
      const pageWidth = pageData?.Width || 37;
      const hLines = pageData?.HLines || [];

      // Page break for subsequent pages
      if (pIdx > 0) {
        children.push(new Paragraph({
          children: [new TextRun({ text: '', break: 1 })],
          pageBreakBefore: true,
        }));
      }

      // Embed all extracted images on this page
      for (const img of pageImages) {
        const maxW = 520;
        const maxH = 650;
        let w = img.width;
        let h = img.height;
        if (w > maxW) {
          h = Math.round(h * (maxW / w));
          w = maxW;
        }
        if (h > maxH) {
          w = Math.round(w * (maxH / h));
          h = maxH;
        }
        children.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 160, after: 160 },
          children: [
            new ImageRun({
              data: img.buffer,
              transformation: { width: Math.max(w, 20), height: Math.max(h, 20) },
              type: 'png'
            })
          ]
        }));
      }

      if (pageData?.Texts && pageData.Texts.length > 0) {
        // 1. Group text items into visual lines by Y coordinate
        const linesMap = new Map<number, any[]>();
        for (const t of pageData.Texts) {
          const yKey = Math.round(t.y * 5) / 5;
          if (!linesMap.has(yKey)) linesMap.set(yKey, []);
          linesMap.get(yKey)!.push(t);
        }

        const sortedYs = Array.from(linesMap.keys()).sort((a, b) => a - b);
        const rawLines = sortedYs.map(y => {
          const items = linesMap.get(y)!.sort((a, b) => a.x - b.x);
          return { y, items };
        });

        for (let i = 0; i < rawLines.length; i++) {
          const line = rawLines[i];
          const items = line.items;

          // Check if line is a two-column split row (e.g. Degree on left, Expected date on right)
          if (items.length >= 2) {
            const first = items[0];
            const last = items[items.length - 1];
            const gap = last.x - (first.x + (first.w || 5));
            if (first.x < 10 && last.x > 18 && gap > 4) {
              const leftRuns: any[] = [];
              for (let itIdx = 0; itIdx < items.length - 1; itIdx++) {
                for (const r of items[itIdx].R) {
                  let t = '';
                  try { t = decodeURIComponent(r.T); } catch { t = r.T; }
                  leftRuns.push(new TextRun({
                    text: t,
                    bold: r.TS?.[2] === 1,
                    italics: r.TS?.[3] === 1,
                    size: Math.max(18, Math.min(36, Math.round((r.TS?.[1] || 14) * 1.5))),
                    color: '000000'
                  }));
                }
              }

              const rightRuns: any[] = [];
              for (const r of last.R) {
                let t = '';
                try { t = decodeURIComponent(r.T); } catch { t = r.T; }
                rightRuns.push(new TextRun({
                  text: t,
                  bold: r.TS?.[2] === 1,
                  italics: r.TS?.[3] === 1,
                  size: Math.max(18, Math.min(36, Math.round((r.TS?.[1] || 14) * 1.5))),
                  color: '000000'
                }));
              }

              children.push(new Table({
                width: { size: 100, type: WidthType.PERCENTAGE },
                borders: {
                  top: { style: BorderStyle.NONE },
                  bottom: { style: BorderStyle.NONE },
                  left: { style: BorderStyle.NONE },
                  right: { style: BorderStyle.NONE },
                  insideHorizontal: { style: BorderStyle.NONE },
                  insideVertical: { style: BorderStyle.NONE }
                },
                rows: [
                  new TableRow({
                    children: [
                      new TableCell({
                        width: { size: 75, type: WidthType.PERCENTAGE },
                        borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
                        children: [new Paragraph({ children: leftRuns, spacing: { before: 60, after: 30 } })]
                      }),
                      new TableCell({
                        width: { size: 25, type: WidthType.PERCENTAGE },
                        borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
                        children: [new Paragraph({ children: rightRuns, alignment: AlignmentType.RIGHT, spacing: { before: 60, after: 30 } })]
                      })
                    ]
                  })
                ]
              }));
              continue;
            }
          }

          // Collect runs and raw text for this line
          let fullLineText = '';
          const rawRuns: { text: string; bold: boolean; italics: boolean; size: number }[] = [];
          for (const item of items) {
            if (!item.R) continue;
            for (const r of item.R) {
              let txt = '';
              try { txt = decodeURIComponent(r.T); } catch { txt = r.T; }
              if (!txt) continue;
              fullLineText += txt;
              rawRuns.push({
                text: txt,
                bold: r.TS?.[2] === 1,
                italics: r.TS?.[3] === 1,
                size: Math.max(18, Math.min(48, Math.round((r.TS?.[1] || 14) * 1.5)))
              });
            }
          }

          const trimmed = fullLineText.trim();
          if (!trimmed) continue;

          const firstItem = items[0];
          const totalW = items[items.length - 1].x + (items[items.length - 1].w || 2) - firstItem.x;
          const isCentered = firstItem.x > 7 && (firstItem.x + totalW < pageWidth - 5);

          const isUpper = trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed) && trimmed.length > 4;
          const hasHLineBelow = hLines.some((hl: any) => Math.abs(hl.y - (line.y + 1.25)) < 1.0);
          const isSectionHeading = (rawRuns.every(r => r.bold) && isUpper && trimmed.length < 60) || hasHLineBelow;
          const isBullet = trimmed.startsWith('•') || trimmed.startsWith('- ') || trimmed.startsWith('* ');

          if (isSectionHeading) {
            children.push(new Paragraph({
              children: rawRuns.map(r => new TextRun({ text: r.text, bold: true, italics: r.italics, size: Math.max(r.size, 22), color: '000000' })),
              alignment: AlignmentType.LEFT,
              spacing: { before: 200, after: 60 },
              border: {
                bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000', space: 2 }
              }
            }));
          } else if (isCentered) {
            children.push(new Paragraph({
              children: rawRuns.map(r => new TextRun({ text: r.text, bold: r.bold, italics: r.italics, size: r.size, color: '000000' })),
              alignment: AlignmentType.CENTER,
              spacing: { after: 40 }
            }));
          } else if (isBullet) {
            const cleanRuns = rawRuns.map((r, idx) => {
              let t = r.text;
              if (idx === 0) t = t.replace(/^[•\-\*]\s*/, '');
              return new TextRun({ text: t, bold: r.bold, italics: r.italics, size: r.size, color: '000000' });
            });
            children.push(new Paragraph({
              children: [new TextRun({ text: '•  ', bold: true, color: '000000' }), ...cleanRuns],
              indent: { left: 360, hanging: 360 },
              spacing: { after: 60 }
            }));
          } else {
            // Regular paragraph: smart merge wrapped continuation lines into single paragraph
            let mergedRuns = rawRuns.map(r => new TextRun({ text: r.text, bold: r.bold, italics: r.italics, size: r.size, color: '000000' }));
            let lastLineY = line.y;

            while (i + 1 < rawLines.length) {
              const nextLine = rawLines[i + 1];
              const nextItems = nextLine.items;
              const nextFirst = nextItems[0];
              const deltaY = nextLine.y - lastLineY;

              let nextFull = '';
              for (const it of nextItems) {
                if (it.R) {
                  for (const r of it.R) {
                    try { nextFull += decodeURIComponent(r.T); } catch { nextFull += r.T; }
                  }
                }
              }
              const nextTrimmed = nextFull.trim();

              const isNextHeading = (nextTrimmed === nextTrimmed.toUpperCase() && /[A-Z]/.test(nextTrimmed) && nextTrimmed.length > 4) || hLines.some((hl: any) => Math.abs(hl.y - (nextLine.y + 1.25)) < 1.0);
              const isNextBullet = nextTrimmed.startsWith('•') || nextTrimmed.startsWith('- ') || nextTrimmed.startsWith('* ');
              const isNextSplit = nextItems.length >= 2 && nextItems[0].x < 10 && nextItems[nextItems.length - 1].x > 18;

              // Merge if vertically contiguous, aligned, and not a heading/bullet/split
              if (deltaY < 1.6 && Math.abs(nextFirst.x - firstItem.x) < 0.8 && !isNextHeading && !isNextBullet && !isNextSplit) {
                mergedRuns.push(new TextRun({ text: ' ', size: 20, color: '000000' }));
                for (const it of nextItems) {
                  if (it.R) {
                    for (const r of it.R) {
                      let txt = '';
                      try { txt = decodeURIComponent(r.T); } catch { txt = r.T; }
                      mergedRuns.push(new TextRun({
                        text: txt,
                        bold: r.TS?.[2] === 1,
                        italics: r.TS?.[3] === 1,
                        size: Math.max(18, Math.min(48, Math.round((r.TS?.[1] || 14) * 1.5))),
                        color: '000000'
                      }));
                    }
                  }
                }
                lastLineY = nextLine.y;
                i++;
              } else {
                break;
              }
            }

            children.push(new Paragraph({
              children: mergedRuns,
              alignment: AlignmentType.LEFT,
              spacing: { after: 100 }
            }));
          }
        }
      } else if (pageImages.length === 0) {
        children.push(new Paragraph({
          children: [new TextRun({ text: 'Page ' + (pIdx + 1), size: 24, color: '000000' })],
          spacing: { after: 120 }
        }));
      }
    }
  } else {
    // Robust Fallback using pdf-parse when pdf2json cannot parse or times out
    let fallbackPages: { text: string; num: number }[] = [];
    try {
      const { PDFParse } = require('pdf-parse');
      const parser = new PDFParse({ data: pdfBytes });
      const parsed = await parser.getText();
      if (parsed && Array.isArray(parsed.pages)) {
        fallbackPages = parsed.pages;
      }
      await parser.destroy().catch(() => {});
    } catch {}

    const totalPages = Math.max(fallbackPages.length, imagesByPage.size, 1);
    for (let pIdx = 0; pIdx < totalPages; pIdx++) {
      const pageImages = imagesByPage.get(pIdx) || [];
      const pageText = fallbackPages[pIdx]?.text || '';

      if (pIdx > 0) {
        children.push(new Paragraph({
          children: [new TextRun({ text: '', break: 1 })],
          pageBreakBefore: true,
        }));
      }

      for (const img of pageImages) {
        const maxW = 520;
        const maxH = 650;
        let w = img.width;
        let h = img.height;
        if (w > maxW) {
          h = Math.round(h * (maxW / w));
          w = maxW;
        }
        if (h > maxH) {
          w = Math.round(w * (maxH / h));
          h = maxH;
        }
        children.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 160, after: 160 },
          children: [
            new ImageRun({
              data: img.buffer,
              transformation: { width: Math.max(w, 20), height: Math.max(h, 20) },
              type: 'png'
            })
          ]
        }));
      }

      if (pageText.trim()) {
        const lines = pageText.split('\n');
        for (const rawL of lines) {
          const l = rawL.trim();
          if (!l) continue;
          const isUpper = l === l.toUpperCase() && /[A-Z]/.test(l) && l.length > 3 && l.length < 50;
          const isBullet = l.startsWith('•') || l.startsWith('- ') || l.startsWith('* ');

          if (isUpper) {
            children.push(new Paragraph({
              children: [new TextRun({ text: l, bold: true, size: 24, color: '000000' })],
              spacing: { before: 200, after: 60 },
              border: {
                bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000', space: 2 }
              }
            }));
          } else if (isBullet) {
            children.push(new Paragraph({
              children: [new TextRun({ text: '•  ' + l.replace(/^[•\-\*]\s*/, ''), size: 21, color: '000000' })],
              indent: { left: 360, hanging: 360 },
              spacing: { after: 60 }
            }));
          } else {
            children.push(new Paragraph({
              children: [new TextRun({ text: l, size: 21, color: '000000' })],
              spacing: { after: 80 }
            }));
          }
        }
      }
    }
  }

  if (children.length === 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Converted Document', size: 24, color: '000000' })]
    }));
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: {
            top: 720,
            right: 720,
            bottom: 720,
            left: 720,
          }
        }
      },
      children
    }]
  });

  const docxBuffer = await Packer.toBuffer(doc);
  await fs.promises.writeFile(outputPath, docxBuffer);
}

/** Extract structured text lines grouped by page and vertical position from PDF (failsafe) */
async function extractPdfData(inputPath: string): Promise<string[][]> {
  const pdfBytes = await fs.promises.readFile(inputPath);

  // 1. Try PDFParse first (super-fast, robust, never fails on malformed XRef)
  try {
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: pdfBytes });
    const parsed = await parser.getText();
    await parser.destroy().catch(() => {});
    if (parsed && Array.isArray(parsed.pages) && parsed.pages.length > 0) {
      return parsed.pages.map((p: any) =>
        (p.text || '').split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0)
      );
    }
  } catch {}

  // 2. Fallback to pdf2json
  try {
    const PDFParser = require('pdf2json');
    const pdfParser = new PDFParser(null, 1);
    return await new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve([['Text extraction timeout.']]);
        }
      }, 4000);

      pdfParser.on('pdfParser_dataReady', (pdfData: any) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          const pages: string[][] = [];
          if (pdfData && pdfData.Pages) {
            for (const page of pdfData.Pages) {
              const pageLines: string[] = [];
              const lineMap = new Map<number, string[]>();
              if (page.Texts) {
                for (const textItem of page.Texts) {
                  const y = Math.round(textItem.y * 10) / 10;
                  let textStr = '';
                  if (textItem.R) {
                    for (const r of textItem.R) {
                      try { textStr += decodeURIComponent(r.T); } catch { textStr += r.T; }
                    }
                  }
                  if (!lineMap.has(y)) lineMap.set(y, []);
                  lineMap.get(y)!.push(textStr);
                }
                const sortedY = Array.from(lineMap.keys()).sort((a, b) => a - b);
                for (const y of sortedY) {
                  pageLines.push(lineMap.get(y)!.join(' ').trim());
                }
              }
              pages.push(pageLines);
            }
          }
          resolve(pages.length > 0 ? pages : [['No text found in PDF.']]);
        }
      });

      pdfParser.on('pdfParser_dataError', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve([['Text extraction failed.']]);
        }
      });

      try {
        pdfParser.parseBuffer(pdfBytes);
      } catch {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve([['Text extraction failed.']]);
        }
      }
    });
  } catch {
    return [['Text extraction failed.']];
  }
}

// ─── Progress Tracking & Cleanup ──────────────────────────────────────────

// ─── Cleanup ─────────────────────────────────────────────────────────────────

export async function cleanupJob(jobId: string, originalExt: string, targetFormat: string) {
  const inputPath = path.join(/*turbopackIgnore: true*/ getUploadsDir(), `${jobId}.${originalExt}`);
  const outputPath = path.join(/*turbopackIgnore: true*/ getConvertedDir(), `${jobId}.${targetFormat}`);
  try { if (fs.existsSync(/*turbopackIgnore: true*/ inputPath)) await fs.promises.unlink(inputPath); } catch {}
  try { if (fs.existsSync(/*turbopackIgnore: true*/ outputPath)) await fs.promises.unlink(outputPath); } catch {}
  clearProgress(jobId);
}

// Auto-cleanup old temp files (older than 10 minutes)
export async function cleanupOldFiles() {
  const dirs = [getUploadsDir(), getConvertedDir()];
  const tenMin = 10 * 60 * 1000;
  for (const fullDir of dirs) {
    try {
      if (!fs.existsSync(fullDir)) continue;
      const files = await fs.promises.readdir(fullDir);
      for (const file of files) {
        const filePath = path.join(fullDir, file);
        const stat = await fs.promises.stat(filePath);
        if (Date.now() - stat.mtimeMs > tenMin) {
          await fs.promises.unlink(filePath).catch(() => {});
        }
      }
    } catch {}
  }
}

// ─── Pure JS HTML/Text/DOCX to Vector PDF & HTML Generators ────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapInA4Template(body: string, title?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title || 'Document')}</title>
  <style>
    @page { size: A4; margin: 20mm; }
    * { box-sizing: border-box; }
    body {
      font-family: 'Liberation Serif', 'Times New Roman', Georgia, serif;
      background-color: #f3f4f6;
      margin: 0;
      padding: 2rem 1rem;
      color: #111827;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }
    .page {
      background: #ffffff;
      width: 210mm;
      min-height: 297mm;
      margin: 0 auto 2rem auto;
      padding: 25mm 20mm;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12);
      border-radius: 2px;
    }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
    th, td { padding: 0.4rem 0.6rem; vertical-align: top; }
    img { max-width: 100%; height: auto; display: block; margin: 1rem auto; }
    @media print {
      body { background: transparent; padding: 0; }
      .page { width: 100%; min-height: auto; margin: 0; padding: 0; box-shadow: none; border-radius: 0; page-break-after: always; }
    }
  </style>
</head>
<body>
  ${body}
</body>
</html>`;
}

/** High-Fidelity PDF to HTML converter with embedded images, flexbox split rows, and A4 print styling */
async function convertPdfToHtmlPureJs(inputPath: string, outputPath: string): Promise<void> {
  const pdfBytes = await fs.promises.readFile(inputPath);
  const imagesByPage = await extractImagesFromPdf(pdfBytes);

  let pdfData: any = null;
  try {
    const PDFParser = require('pdf2json');
    const parser = new PDFParser(null, 1);
    pdfData = await new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      }, 5000);

      parser.on('pdfParser_dataReady', (data: any) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(data);
        }
      });
      parser.on('pdfParser_dataError', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(null);
        }
      });

      try {
        parser.parseBuffer(pdfBytes);
      } catch {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(null);
        }
      }
    });
  } catch {
    pdfData = null;
  }

  const pageSections: string[] = [];
  const hasValidPdf2JsonText = pdfData?.Pages?.some((p: any) => p.Texts && p.Texts.length > 0);

  if (hasValidPdf2JsonText) {
    const totalPages = pdfData.Pages.length;

    for (let pIdx = 0; pIdx < totalPages; pIdx++) {
      const pageData = pdfData.Pages[pIdx];
      const pageImages = imagesByPage.get(pIdx) || [];
      const pageWidth = pageData?.Width || 37;
      const hLines = pageData?.HLines || [];

      const pageElements: string[] = [];

      // Embedded images
      for (const img of pageImages) {
        const b64 = img.buffer.toString('base64');
        pageElements.push(
          `<div style="text-align: center; margin: 1.5rem 0;">` +
          `<img src="data:image/png;base64,${b64}" style="max-width: 100%; max-height: 400px; height: auto; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);" />` +
          `</div>`
        );
      }

      if (pageData?.Texts && pageData.Texts.length > 0) {
        // Group text items by line Y coordinate
        const linesMap = new Map<number, any[]>();
        for (const t of pageData.Texts) {
          const yKey = Math.round(t.y * 5) / 5;
          if (!linesMap.has(yKey)) linesMap.set(yKey, []);
          linesMap.get(yKey)!.push(t);
        }

        const sortedYs = Array.from(linesMap.keys()).sort((a, b) => a - b);
        const rawLines = sortedYs.map(y => {
          const items = linesMap.get(y)!.sort((a, b) => a.x - b.x);
          return { y, items };
        });

        for (let i = 0; i < rawLines.length; i++) {
          const line = rawLines[i];
          const items = line.items;

          // Check for 2-column split row
          if (items.length >= 2) {
            const first = items[0];
            const last = items[items.length - 1];
            const gap = last.x - (first.x + (first.w || 5));
            if (first.x < 10 && last.x > 18 && gap > 4) {
              let leftHtml = '';
              for (let itIdx = 0; itIdx < items.length - 1; itIdx++) {
                for (const r of items[itIdx].R) {
                  let t = '';
                  try { t = decodeURIComponent(r.T); } catch { t = r.T; }
                  const isB = r.TS?.[2] === 1;
                  const isI = r.TS?.[3] === 1;
                  if (isB && isI) leftHtml += `<strong><em>${escapeHtml(t)}</em></strong> `;
                  else if (isB) leftHtml += `<strong>${escapeHtml(t)}</strong> `;
                  else if (isI) leftHtml += `<em>${escapeHtml(t)}</em> `;
                  else leftHtml += `${escapeHtml(t)} `;
                }
              }

              let rightHtml = '';
              for (const r of last.R) {
                let t = '';
                try { t = decodeURIComponent(r.T); } catch { t = r.T; }
                const isB = r.TS?.[2] === 1;
                const isI = r.TS?.[3] === 1;
                if (isB && isI) rightHtml += `<strong><em>${escapeHtml(t)}</em></strong> `;
                else if (isB) rightHtml += `<strong>${escapeHtml(t)}</strong> `;
                else if (isI) rightHtml += `<em>${escapeHtml(t)}</em> `;
                else rightHtml += `${escapeHtml(t)} `;
              }

              pageElements.push(
                `<div style="display: flex; justify-content: space-between; align-items: baseline; margin: 0.4rem 0;">` +
                `<div style="flex: 1;">${leftHtml.trim()}</div>` +
                `<div style="text-align: right; color: #374151;">${rightHtml.trim()}</div>` +
                `</div>`
              );
              continue;
            }
          }

          let fullLineText = '';
          const rawRuns: { text: string; bold: boolean; italics: boolean; size: number }[] = [];
          for (const item of items) {
            if (!item.R) continue;
            for (const r of item.R) {
              let txt = '';
              try { txt = decodeURIComponent(r.T); } catch { txt = r.T; }
              if (!txt) continue;
              fullLineText += txt;
              rawRuns.push({
                text: txt,
                bold: r.TS?.[2] === 1,
                italics: r.TS?.[3] === 1,
                size: r.TS?.[1] || 14
              });
            }
          }

          const trimmed = fullLineText.trim();
          if (!trimmed) continue;

          const firstItem = items[0];
          const totalW = items[items.length - 1].x + (items[items.length - 1].w || 2) - firstItem.x;
          const isCentered = firstItem.x > 7 && (firstItem.x + totalW < pageWidth - 5);

          const isUpper = trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed) && trimmed.length > 4;
          const hasHLineBelow = hLines.some((hl: any) => Math.abs(hl.y - (line.y + 1.25)) < 1.0);
          const isSectionHeading = (rawRuns.every(r => r.bold) && isUpper && trimmed.length < 60) || hasHLineBelow;
          const isBullet = trimmed.startsWith('•') || trimmed.startsWith('- ') || trimmed.startsWith('* ');

          if (isSectionHeading) {
            const headingText = rawRuns.map(r => r.text).join(' ').trim();
            pageElements.push(
              `<h2 style="font-size: 13pt; font-weight: bold; text-transform: uppercase; border-bottom: 1.5px solid #000; padding-bottom: 3px; margin: 1.6rem 0 0.5rem 0; color: #000; letter-spacing: 0.5px;">` +
              `${escapeHtml(headingText)}` +
              `</h2>`
            );
          } else if (isCentered) {
            let inner = '';
            for (const r of rawRuns) {
              let seg = escapeHtml(r.text);
              if (r.bold && r.italics) seg = `<strong><em>${seg}</em></strong>`;
              else if (r.bold) seg = `<strong>${seg}</strong>`;
              else if (r.italics) seg = `<em>${seg}</em>`;
              inner += seg + ' ';
            }
            const fontSizeStyle = rawRuns[0]?.size > 18 ? 'font-size: 18pt; font-weight: bold;' : 'font-size: 10.5pt;';
            pageElements.push(
              `<div style="text-align: center; margin: 0.25rem 0; ${fontSizeStyle} color: #000;">${inner.trim()}</div>`
            );
          } else if (isBullet) {
            let cleanText = trimmed.replace(/^[•\-\*]\s*/, '');
            pageElements.push(
              `<ul style="margin: 0.35rem 0; padding-left: 1.6rem;"><li style="margin-bottom: 0.25rem; line-height: 1.5; color: #111;">${escapeHtml(cleanText)}</li></ul>`
            );
          } else {
            // Flowing paragraph with continuation merging
            let fullRuns = [...rawRuns];
            let lastLineY = line.y;

            while (i + 1 < rawLines.length) {
              const nextLine = rawLines[i + 1];
              const nextItems = nextLine.items;
              const nextFirst = nextItems[0];
              const deltaY = nextLine.y - lastLineY;

              let nextFull = '';
              for (const it of nextItems) {
                if (it.R) {
                  for (const r of it.R) {
                    try { nextFull += decodeURIComponent(r.T); } catch { nextFull += r.T; }
                  }
                }
              }
              const nextTrimmed = nextFull.trim();
              const isNextHeading = (nextTrimmed === nextTrimmed.toUpperCase() && /[A-Z]/.test(nextTrimmed) && nextTrimmed.length > 4) || hLines.some((hl: any) => Math.abs(hl.y - (nextLine.y + 1.25)) < 1.0);
              const isNextBullet = nextTrimmed.startsWith('•') || nextTrimmed.startsWith('- ');
              const isNextSplit = nextItems.length >= 2 && nextItems[0].x < 10 && nextItems[nextItems.length - 1].x > 18;

              if (deltaY < 1.6 && Math.abs(nextFirst.x - firstItem.x) < 0.8 && !isNextHeading && !isNextBullet && !isNextSplit) {
                for (const it of nextItems) {
                  if (it.R) {
                    for (const r of it.R) {
                      let txt = '';
                      try { txt = decodeURIComponent(r.T); } catch { txt = r.T; }
                      fullRuns.push({
                        text: txt,
                        bold: r.TS?.[2] === 1,
                        italics: r.TS?.[3] === 1,
                        size: r.TS?.[1] || 14
                      });
                    }
                  }
                }
                lastLineY = nextLine.y;
                i++;
              } else {
                break;
              }
            }

            let pContent = '';
            for (const r of fullRuns) {
              let seg = escapeHtml(r.text);
              if (r.bold && r.italics) seg = `<strong><em>${seg}</em></strong>`;
              else if (r.bold) seg = `<strong>${seg}</strong>`;
              else if (r.italics) seg = `<em>${seg}</em>`;
              pContent += seg + ' ';
            }

            pageElements.push(
              `<p style="margin: 0.6rem 0; line-height: 1.6; text-align: justify; color: #111;">${pContent.trim()}</p>`
            );
          }
        }
      }

      pageSections.push(
        `<div class="page">\n${pageElements.join('\n')}\n</div>`
      );
    }
  } else {
    // Robust Fallback using pdf-parse for HTML
    let fallbackPages: { text: string; num: number }[] = [];
    try {
      const { PDFParse } = require('pdf-parse');
      const parser = new PDFParse({ data: pdfBytes });
      const parsed = await parser.getText();
      if (parsed && Array.isArray(parsed.pages)) {
        fallbackPages = parsed.pages;
      }
      await parser.destroy().catch(() => {});
    } catch {}

    const totalPages = Math.max(fallbackPages.length, imagesByPage.size, 1);
    for (let pIdx = 0; pIdx < totalPages; pIdx++) {
      const pageImages = imagesByPage.get(pIdx) || [];
      const pageText = fallbackPages[pIdx]?.text || '';
      const pageElements: string[] = [];

      for (const img of pageImages) {
        const b64 = img.buffer.toString('base64');
        pageElements.push(
          `<div style="text-align: center; margin: 1.5rem 0;">` +
          `<img src="data:image/png;base64,${b64}" style="max-width: 100%; max-height: 400px; height: auto; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);" />` +
          `</div>`
        );
      }

      if (pageText.trim()) {
        const lines = pageText.split('\n');
        for (const rawL of lines) {
          const l = rawL.trim();
          if (!l) continue;
          const isUpper = l === l.toUpperCase() && /[A-Z]/.test(l) && l.length > 3 && l.length < 50;
          const isBullet = l.startsWith('•') || l.startsWith('- ') || l.startsWith('* ');

          if (isUpper) {
            pageElements.push(
              `<h2 style="font-size: 13pt; font-weight: bold; text-transform: uppercase; border-bottom: 1.5px solid #000; padding-bottom: 3px; margin: 1.6rem 0 0.5rem 0; color: #000; letter-spacing: 0.5px;">` +
              `${escapeHtml(l)}` +
              `</h2>`
            );
          } else if (isBullet) {
            pageElements.push(
              `<ul style="margin: 0.35rem 0; padding-left: 1.6rem;"><li style="margin-bottom: 0.25rem; line-height: 1.5; color: #111;">${escapeHtml(l.replace(/^[•\-\*]\s*/, ''))}</li></ul>`
            );
          } else {
            pageElements.push(
              `<p style="margin: 0.6rem 0; line-height: 1.6; text-align: justify; color: #111;">${escapeHtml(l)}</p>`
            );
          }
        }
      }

      pageSections.push(
        `<div class="page">\n${pageElements.join('\n')}\n</div>`
      );
    }
  }

  const fullHtml = wrapInA4Template(pageSections.join('\n\n'), path.basename(inputPath));
  await fs.promises.writeFile(outputPath, fullHtml, 'utf8');
}

/** Universal Vector PDF generator from HTML or structured text (preserves layout, images, tables, headings, styles) */
async function convertHtmlOrRichTextToPdf(
  htmlOrText: string,
  outputPath: string,
  title?: string
): Promise<void> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const italicFont = await doc.embedFont(StandardFonts.HelveticaOblique);
  const boldItalicFont = await doc.embedFont(StandardFonts.HelveticaBoldOblique);

  let page = doc.addPage(PageSizes.A4);
  const { width, height } = page.getSize();
  const margin = 50;
  const maxWidth = width - margin * 2;
  let y = height - margin;

  function ensurePageSpace(needed = 20) {
    if (y - needed < margin) {
      page = doc.addPage(PageSizes.A4);
      y = height - margin;
    }
  }

  const isHtml = /<(h[1-6]|p|table|ul|ol|hr|img|div|br)/i.test(htmlOrText);

  if (isHtml) {
    const blockRegex = /<(h[1-6]|p|table|ul|ol|hr|img|div)[^>]*>[\s\S]*?<\/\1>|<hr\s*\/?>|<img[^>]*\/?>/gi;
    let match;
    const blocks: string[] = [];
    while ((match = blockRegex.exec(htmlOrText)) !== null) {
      blocks.push(match[0]);
    }

    if (blocks.length === 0) {
      const clean = htmlOrText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      blocks.push(`<p>${clean}</p>`);
    }

    for (const block of blocks) {
      // 1. Embedded Image
      if (/^<img/i.test(block)) {
        const srcMatch = block.match(/src=["']([^"']+)["']/i);
        if (srcMatch && srcMatch[1]) {
          const src = srcMatch[1];
          try {
            let imgBuffer: Buffer | null = null;
            if (src.startsWith('data:image/')) {
              const b64 = src.split(',')[1];
              if (b64) imgBuffer = Buffer.from(b64, 'base64');
            } else if (fs.existsSync(src)) {
              imgBuffer = await fs.promises.readFile(src);
            }

            if (imgBuffer) {
              const pngBuf = await sharp(imgBuffer).png().toBuffer();
              const emb = await doc.embedPng(pngBuf);
              let imgW = emb.width;
              let imgH = emb.height;
              if (imgW > maxWidth) {
                imgH = Math.round(imgH * (maxWidth / imgW));
                imgW = maxWidth;
              }
              if (imgH > 350) {
                imgW = Math.round(imgW * (350 / imgH));
                imgH = 350;
              }
              ensurePageSpace(imgH + 20);
              page.drawImage(emb, {
                x: margin + Math.max(0, (maxWidth - imgW) / 2),
                y: y - imgH,
                width: imgW,
                height: imgH
              });
              y -= imgH + 16;
            }
          } catch {}
        }
        continue;
      }

      // 2. Headings (h1, h2, h3)
      if (/^<h1/i.test(block)) {
        const text = block.replace(/<[^>]+>/g, '').replace(/[^\x20-\x7E]/g, ' ').trim();
        if (text) {
          ensurePageSpace(32);
          const isCentered = /text-align:\s*center/i.test(block);
          let textW = 0;
          try { textW = boldFont.widthOfTextAtSize(text, 18); } catch { textW = text.length * 11; }
          const xPos = isCentered ? margin + Math.max(0, (maxWidth - textW) / 2) : margin;
          page.drawText(text, { x: xPos, y, size: 18, font: boldFont, color: rgb(0, 0, 0) });
          y -= 26;
        }
        continue;
      }

      if (/^<h[2-6]/i.test(block)) {
        const text = block.replace(/<[^>]+>/g, '').replace(/[^\x20-\x7E]/g, ' ').trim();
        if (text) {
          ensurePageSpace(26);
          page.drawText(text, { x: margin, y, size: 13, font: boldFont, color: rgb(0, 0, 0) });
          y -= 20;
        }
        continue;
      }

      // 3. Horizontal Rule
      if (/^<hr/i.test(block)) {
        ensurePageSpace(14);
        page.drawLine({
          start: { x: margin, y: y + 4 },
          end: { x: width - margin, y: y + 4 },
          thickness: 1,
          color: rgb(0.1, 0.1, 0.1)
        });
        y -= 14;
        continue;
      }

      // 4. Tables
      if (/^<table/i.test(block)) {
        const rows = block.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
        for (const row of rows) {
          const cells = row.match(/<(td|th)[^>]*>[\s\S]*?<\/\1>/gi) || [];
          if (cells.length >= 2 && cells[0] && cells[1]) {
            const cell0 = cells[0];
            const cell1 = cells[1];
            const c1Text = cell0.replace(/<[^>]+>/g, '').replace(/[^\x20-\x7E]/g, ' ').trim();
            const c2Text = cell1.replace(/<[^>]+>/g, '').replace(/[^\x20-\x7E]/g, ' ').trim();
            const c1IsBold = /<strong>|<b>/i.test(cell0);
            const c1IsItalic = /<em>|<i>/i.test(cell0);
            const c1Font = c1IsBold ? boldFont : (c1IsItalic ? italicFont : font);

            ensurePageSpace(20);
            page.drawText(c1Text, { x: margin, y, size: 10.5, font: c1Font, color: rgb(0, 0, 0) });
            if (c2Text) {
              let c2W = 0;
              try { c2W = font.widthOfTextAtSize(c2Text, 10.5); } catch { c2W = c2Text.length * 6; }
              page.drawText(c2Text, { x: width - margin - c2W, y, size: 10.5, font, color: rgb(0, 0, 0) });
            }
            y -= 16;
          } else if (cells.length === 1 && cells[0]) {
            const cell0 = cells[0];
            const c1Text = cell0.replace(/<[^>]+>/g, '').replace(/[^\x20-\x7E]/g, ' ').trim();
            const c1IsItalic = /<em>|<i>/i.test(cell0);
            ensurePageSpace(20);
            page.drawText(c1Text, { x: margin, y, size: 10, font: c1IsItalic ? italicFont : font, color: rgb(0, 0, 0) });
            y -= 16;
          }
        }
        y -= 6;
        continue;
      }

      // 5. Lists (ul, ol, li)
      if (/^<ul|^<ol/i.test(block)) {
        const items = block.match(/<li[^>]*>[\s\S]*?<\/li>/gi) || [];
        for (const item of items) {
          const itemText = item.replace(/<[^>]+>/g, '').replace(/[^\x20-\x7E]/g, ' ').trim();
          const words = itemText.split(/\s+/);
          let curLine = '';
          let isFirst = true;

          for (const w of words) {
            const test = curLine ? `${curLine} ${w}` : w;
            let wWidth = 0;
            try { wWidth = font.widthOfTextAtSize(test, 10); } catch { wWidth = test.length * 6; }
            if (wWidth > maxWidth - 24 && curLine) {
              ensurePageSpace(16);
              if (isFirst) {
                page.drawText('•', { x: margin + 8, y, size: 11, font: boldFont, color: rgb(0, 0, 0) });
                isFirst = false;
              }
              page.drawText(curLine, { x: margin + 22, y, size: 10, font, color: rgb(0, 0, 0) });
              y -= 14;
              curLine = w;
            } else {
              curLine = test;
            }
          }
          if (curLine) {
            ensurePageSpace(16);
            if (isFirst) {
              page.drawText('•', { x: margin + 8, y, size: 11, font: boldFont, color: rgb(0, 0, 0) });
            }
            page.drawText(curLine, { x: margin + 22, y, size: 10, font, color: rgb(0, 0, 0) });
            y -= 16;
          }
        }
        y -= 4;
        continue;
      }

      // 6. Paragraphs and Blocks
      if (/^<p|^<div/i.test(block)) {
        const isCentered = /text-align:\s*center/i.test(block);
        const cleanPara = block.replace(/<br\s*\/?>/gi, '\n');
        const innerHtml = cleanPara.replace(/^<[^>]+>/, '').replace(/<\/[^>]+>$/, '');

        const runRegex = /(<strong>[\s\S]*?<\/strong>|<b>[\s\S]*?<\/b>|<em>[\s\S]*?<\/em>|<i>[\s\S]*?<\/i>|[^<]+)/gi;
        let runMatch;
        const runs: { text: string; isBold: boolean; isItalic: boolean }[] = [];
        while ((runMatch = runRegex.exec(innerHtml)) !== null) {
          const seg = runMatch[0];
          if (!seg) continue;
          const isBold = /^<(strong|b)/i.test(seg);
          const isItalic = /^<(em|i)/i.test(seg);
          const txt = seg.replace(/<[^>]+>/g, '').replace(/[^\x20-\x7E]/g, ' ');
          if (txt) {
            runs.push({ text: txt, isBold, isItalic });
          }
        }

        let currentLineRuns: { text: string; font: any; width: number }[] = [];
        let currentLineWidth = 0;

        for (const run of runs) {
          const runWords = run.text.split(/(\s+)/);
          const rFont = run.isBold ? (run.isItalic ? boldItalicFont : boldFont) : (run.isItalic ? italicFont : font);

          for (const token of runWords) {
            if (!token) continue;
            let tokenWidth = 0;
            try { tokenWidth = rFont.widthOfTextAtSize(token, 10.5); } catch { tokenWidth = token.length * 6; }

            if (currentLineWidth + tokenWidth > maxWidth && currentLineRuns.length > 0 && token.trim().length > 0) {
              ensurePageSpace(16);
              let startX = isCentered ? margin + Math.max(0, (maxWidth - currentLineWidth) / 2) : margin;
              for (const r of currentLineRuns) {
                page.drawText(r.text, { x: startX, y, size: 10.5, font: r.font, color: rgb(0, 0, 0) });
                startX += r.width;
              }
              y -= 15;
              currentLineRuns = [];
              currentLineWidth = 0;
            }

            currentLineRuns.push({ text: token, font: rFont, width: tokenWidth });
            currentLineWidth += tokenWidth;
          }
        }

        if (currentLineRuns.length > 0) {
          ensurePageSpace(16);
          let startX = isCentered ? margin + Math.max(0, (maxWidth - currentLineWidth) / 2) : margin;
          for (const r of currentLineRuns) {
            page.drawText(r.text, { x: startX, y, size: 10.5, font: r.font, color: rgb(0, 0, 0) });
            startX += r.width;
          }
          y -= 18;
        }
      }
    }
  } else {
    // Plain text layout
    if (title) {
      const cleanTitle = title.replace(/[^\x20-\x7E]/g, ' ').trim();
      if (cleanTitle) {
        ensurePageSpace(30);
        page.drawText(cleanTitle, { x: margin, y, size: 16, font: boldFont, color: rgb(0, 0, 0) });
        y -= 26;
      }
    }

    const lines = htmlOrText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    for (const rawLine of lines) {
      const line = rawLine.replace(/[^\x20-\x7E\t]/g, ' ').trim();
      if (!line) {
        y -= 10;
        continue;
      }

      if (/^---+$|^===+$/.test(line)) {
        ensurePageSpace(14);
        page.drawLine({ start: { x: margin, y: y + 4 }, end: { x: width - margin, y: y + 4 }, thickness: 1, color: rgb(0.2, 0.2, 0.2) });
        y -= 14;
        continue;
      }

      const isHeading = line.startsWith('#') || (line.length < 50 && line === line.toUpperCase() && /[A-Z]/.test(line));
      const isBullet = line.startsWith('•') || line.startsWith('- ') || line.startsWith('* ');
      const curFont = isHeading ? boldFont : font;
      const curSize = isHeading ? 13 : 10.5;
      const curLineHeight = isHeading ? 19 : 15;

      const cleanLine = line.replace(/^#+\s*|^[•\-\*]\s*/, '');
      const words = cleanLine.split(/\s+/);
      let curText = '';
      let isFirstWord = true;

      for (const w of words) {
        const test = curText ? `${curText} ${w}` : w;
        let testWidth = 0;
        try { testWidth = curFont.widthOfTextAtSize(test, curSize); } catch { testWidth = test.length * curSize * 0.6; }

        if (testWidth > maxWidth - (isBullet ? 20 : 0)) {
          ensurePageSpace(curLineHeight);
          if (isBullet && isFirstWord) {
            page.drawText('•', { x: margin + 6, y, size: 11, font: boldFont, color: rgb(0, 0, 0) });
            isFirstWord = false;
          }
          page.drawText(curText, { x: margin + (isBullet ? 20 : 0), y, size: curSize, font: curFont, color: rgb(0, 0, 0) });
          y -= curLineHeight;
          curText = w;
        } else {
          curText = test;
        }
      }

      if (curText) {
        ensurePageSpace(curLineHeight);
        if (isBullet && isFirstWord) {
          page.drawText('•', { x: margin + 6, y, size: 11, font: boldFont, color: rgb(0, 0, 0) });
        }
        page.drawText(curText, { x: margin + (isBullet ? 20 : 0), y, size: curSize, font: curFont, color: rgb(0, 0, 0) });
        y -= curLineHeight + (isHeading ? 6 : 3);
      }
    }
  }

  const pdfBytes = await doc.save();
  await fs.promises.writeFile(outputPath, pdfBytes);
}

// ─── Main Converter ───────────────────────────────────────────────────────────

export async function convertFile(
  inputPath: string,
  outputPath: string,
  targetFormat: string,
  mimeType: string,
  isCompress: boolean = false,
  jobId: string = 'default'
): Promise<void> {
  targetFormat = targetFormat.toLowerCase();
  const inputExt = (inputPath.split('.').pop() || '').toLowerCase();

  const imageFormats = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'tiff', 'gif', 'bmp', 'ico'];
  const videoFormats = ['mp4', 'avi', 'mkv', 'mov', 'webm', 'flv'];
  const audioFormats = ['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a'];
  const videoAudioFormats = [...videoFormats, ...audioFormats];
  const officeFormats = ['docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls', 'csv', 'odt'];

  setProgress(jobId, 5);

  // ── Image to PDF ─────────────────────────────────────────────────────────
  const isImageInput = imageFormats.includes(inputExt) || mimeType.startsWith('image/');
  if (isImageInput && targetFormat === 'pdf') {
    const { PDFDocument } = require('pdf-lib');
    const pdfDoc = await PDFDocument.create();
    const imgBuffer = await fs.promises.readFile(inputPath);
    let image;
    if (inputPath.toLowerCase().endsWith('.png')) {
      try {
        image = await pdfDoc.embedPng(imgBuffer);
      } catch {
        const jpgBuf = await sharp(imgBuffer).jpeg().toBuffer();
        image = await pdfDoc.embedJpg(jpgBuf);
      }
    } else {
      try {
        image = await pdfDoc.embedJpg(imgBuffer);
      } catch {
        const jpgBuf = await sharp(imgBuffer).jpeg().toBuffer();
        image = await pdfDoc.embedJpg(jpgBuf);
      }
    }
    const page = pdfDoc.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    const pdfBytes = await pdfDoc.save();
    await fs.promises.writeFile(outputPath, pdfBytes);
    setProgress(jobId, 100);
    return;
  }

  // ── Image to Image (with compression) ────────────────────────────────────
  if (imageFormats.includes(targetFormat)) {
    let format = targetFormat === 'jpg' ? 'jpeg' : targetFormat;
    let pipeline = sharp(inputPath);
    if (isCompress) {
      if (format === 'jpeg') {
        pipeline = pipeline.jpeg({ quality: 50, mozjpeg: true });
      } else if (format === 'png') {
        pipeline = pipeline.png({ quality: 60, palette: true, compressionLevel: 9 });
      } else if (format === 'webp') {
        pipeline = pipeline.webp({ quality: 50 });
      } else if (format === 'avif') {
        pipeline = pipeline.avif({ quality: 45 });
      } else {
        pipeline = pipeline.toFormat(format as any);
      }
    } else {
      pipeline = pipeline.toFormat(format as any);
    }
    await pipeline.toFile(outputPath);
    setProgress(jobId, 100);
    return;
  }

  // ── Video / Audio ─────────────────────────────────────────────────────────
  if (videoAudioFormats.includes(targetFormat)) {
    if (!ffmpegAvailable) {
      initFfmpeg();
    }
    if (!ffmpegAvailable) {
      throw new Error(`Audio/Video conversion requires FFmpeg, which is not available in this environment.`);
    }
    return new Promise((resolve, reject) => {
      let command = ffmpeg(inputPath).toFormat(targetFormat);
      if (isCompress) {
        if (videoFormats.includes(targetFormat)) {
          command = command.videoCodec('libx264').outputOptions(['-crf 30', '-preset faster']).audioBitrate('64k');
        } else {
          command = command.audioBitrate('64k');
        }
      }
      command
        .on('progress', (prog) => {
          if (prog.percent) setProgress(jobId, Math.min(Math.round(prog.percent), 99));
        })
        .on('end', () => { setProgress(jobId, 100); resolve(); })
        .on('error', (err) => reject(err))
        .save(outputPath);
    });
  }

  // ── PDF Handling (DOCX, TXT, HTML, Compression) ───────────────────────────
  const isPdfInput = inputPath.toLowerCase().endsWith('.pdf') || mimeType === 'application/pdf';
  if (isPdfInput) {
    // PDF Compression
    if (isCompress) {
      const pdfBytes = await fs.promises.readFile(inputPath);
      const { buffer: compressedBytes } = await compressPdfImages(pdfBytes, 50);
      await fs.promises.writeFile(outputPath, compressedBytes);
      setProgress(jobId, 100);
      return;
    }

    if (targetFormat === 'pdf') {
      await fs.promises.copyFile(inputPath, outputPath);
      setProgress(jobId, 100);
      return;
    }

    // PDF to DOCX (Word Document) - High Fidelity Conversion
    if (targetFormat === 'docx' || targetFormat === 'doc') {
      setProgress(jobId, 20);

      // Tier 1: Specialized pdf2docx (reconstructs full document layout, tables, fonts, formatting, shapes, and images)
      let converted = await convertPdfToDocxPython(inputPath, outputPath);

      // Tier 2: LibreOffice Writer PDF Import filter
      if (!converted) {
        setProgress(jobId, 50);
        converted = await convertPdfToDocxLibreOffice(inputPath, outputPath);
      }

      // Tier 3: High-Fidelity Pure JavaScript Engine (extracts embedded photos/images, fonts, weights, headings & layout)
      if (!converted) {
        setProgress(jobId, 80);
        await convertPdfToDocxPureJs(inputPath, outputPath);
      }

      setProgress(jobId, 100);
      return;
    }

    // PDF to TXT
    if (targetFormat === 'txt') {
      const pages = await extractPdfData(inputPath);
      const fullText = pages.map(lines => lines.join('\r\n')).join('\r\n\r\n--- Page Break ---\r\n\r\n');
      await fs.promises.writeFile(outputPath, fullText || 'No text extracted.', 'utf8');
      setProgress(jobId, 100);
      return;
    }

    // PDF to HTML (High Fidelity with images, split rows, headings, and A4 print styling)
    if (targetFormat === 'html') {
      setProgress(jobId, 40);
      await convertPdfToHtmlPureJs(inputPath, outputPath);
      setProgress(jobId, 100);
      return;
    }

    throw new Error(`Converting PDF to ${targetFormat.toUpperCase()} is not supported. Supported: DOCX, TXT, HTML.`);
  }

  // ── Office Docs (DOCX, PPTX, XLSX) ─────────────────────────────────────────
  const isOfficeInput = officeFormats.some(ext => inputPath.toLowerCase().endsWith(`.${ext}`))
    || mimeType.includes('officedocument') || mimeType.includes('opendocument');
  const isDocxInput = inputPath.toLowerCase().endsWith('.docx') || mimeType.includes('wordprocessingml');

  // Fast-path DOCX using mammoth
  if (isDocxInput && ['txt', 'html'].includes(targetFormat)) {
    const mammoth = require('mammoth');
    if (targetFormat === 'txt') {
      const result = await mammoth.extractRawText({ path: inputPath });
      await fs.promises.writeFile(outputPath, result.value);
      setProgress(jobId, 100);
      return;
    }
    if (targetFormat === 'html') {
      const result = await mammoth.convertToHtml({ path: inputPath });
      const originalName = path.basename(inputPath, path.extname(inputPath));
      const html = wrapInA4Template(result.value, originalName);
      await fs.promises.writeFile(outputPath, html);
      setProgress(jobId, 100);
      return;
    }
  }

  // ── DOCX → PDF Conversion (Universal: LibreOffice local, Mammoth+pdf-lib cloud) ──
  if (isDocxInput && targetFormat === 'pdf') {
    const soffice = findLibreOffice();
    if (soffice) {
      const outDir = path.dirname(outputPath);
      try {
        await new Promise<void>((resolve, reject) => {
          const proc = spawn(/*turbopackIgnore: true*/ soffice, [
            '--headless',
            '--convert-to', 'pdf',
            '--outdir', outDir,
            inputPath
          ], { windowsHide: true, shell: false });
          proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`LibreOffice exited with code ${code}`)));
          proc.on('error', reject);
        });
        const inputBaseName = path.basename(inputPath, path.extname(inputPath));
        const loOutput = path.join(/*turbopackIgnore: true*/ outDir, `${inputBaseName}.pdf`);
        if (loOutput !== outputPath && fs.existsSync(/*turbopackIgnore: true*/ loOutput)) {
          await fs.promises.rename(loOutput, outputPath);
        }
        if (fs.existsSync(/*turbopackIgnore: true*/ outputPath)) {
          setProgress(jobId, 100);
          return;
        }
      } catch {}
    }

    // High-Fidelity Pure JS Fallback: Mammoth (extracts HTML with embedded images, tables, bold, italics, headings) + Vector PDF generator
    setProgress(jobId, 50);
    const mammoth = await import('mammoth');
    const result = await mammoth.convertToHtml({ path: inputPath });
    const originalName = path.basename(inputPath, path.extname(inputPath));
    await convertHtmlOrRichTextToPdf(result.value, outputPath, originalName);
    setProgress(jobId, 100);
    return;
  }

  // ── TXT / HTML → PDF via pure pdf-lib ───────────────────────────────────────
  if ((mimeType.includes('text/plain') || mimeType.includes('text/html') || inputExt === 'txt' || inputExt === 'html') && targetFormat === 'pdf') {
    const content = await fs.promises.readFile(inputPath, 'utf8');
    const originalName = path.basename(inputPath, path.extname(inputPath));
    await convertHtmlOrRichTextToPdf(content, outputPath, originalName);
    setProgress(jobId, 100);
    return;
  }

  // ── TXT → DOCX ────────────────────────────────────────────────────────────
  if ((mimeType.includes('text/plain') || inputExt === 'txt') && (targetFormat === 'docx' || targetFormat === 'doc')) {
    const content = await fs.promises.readFile(inputPath, 'utf8');
    const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const docChildren: any[] = [];
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        docChildren.push(new Paragraph({ children: [new TextRun('')], spacing: { after: 80 } }));
        continue;
      }
      if (/^---+$|^===+$/.test(line)) {
        docChildren.push(new Paragraph({
          children: [new TextRun('')],
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000', space: 2 } },
          spacing: { before: 100, after: 100 }
        }));
        continue;
      }
      const isHeading = line.startsWith('#') || (line.length < 50 && line === line.toUpperCase() && /[A-Z]/.test(line));
      const isBullet = line.startsWith('•') || line.startsWith('- ') || line.startsWith('* ');
      if (isHeading) {
        const cleanText = line.replace(/^#+\s*/, '');
        docChildren.push(new Paragraph({
          children: [new TextRun({ text: cleanText, bold: true, size: 28, color: '000000' })],
          spacing: { before: 200, after: 60 }
        }));
      } else if (isBullet) {
        const cleanText = line.replace(/^[•\-\*]\s*/, '');
        docChildren.push(new Paragraph({
          children: [new TextRun({ text: '•  ', bold: true, color: '000000' }), new TextRun({ text: cleanText, size: 24, color: '000000' })],
          indent: { left: 360, hanging: 360 },
          spacing: { after: 60 }
        }));
      } else {
        docChildren.push(new Paragraph({
          children: [new TextRun({ text: line, size: 24, color: '000000' })],
          spacing: { after: 100 }
        }));
      }
    }
    const doc = new Document({
      sections: [{
        properties: {
          page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } }
        },
        children: docChildren.length > 0 ? docChildren : [new Paragraph({ children: [new TextRun('Empty Document')] })]
      }]
    });
    const docxBuffer = await Packer.toBuffer(doc);
    await fs.promises.writeFile(outputPath, docxBuffer);
    setProgress(jobId, 100);
    return;
  }

  // LibreOffice path for remaining Office inputs (PPTX, XLSX)
  if (isOfficeInput) {
    const soffice = findLibreOffice();
    if (!soffice) throw new Error('LibreOffice is required to convert Office presentations and spreadsheets (PPTX/XLSX).');

    const outDir = path.dirname(outputPath);
    const loFormat = targetFormat;

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(/*turbopackIgnore: true*/ soffice, [
        '--headless',
        '--convert-to', loFormat,
        '--outdir', outDir,
        inputPath
      ], {
        windowsHide: true,
        shell: false
      });
      proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`LibreOffice exited with code ${code}`)));
      proc.on('error', reject);
    });

    const inputBaseName = path.basename(inputPath, path.extname(inputPath));
    const loOutput = path.join(/*turbopackIgnore: true*/ outDir, `${inputBaseName}.${loFormat}`);
    if (loOutput !== outputPath && fs.existsSync(/*turbopackIgnore: true*/ loOutput)) {
      await fs.promises.rename(loOutput, outputPath);
    }
    setProgress(jobId, 100);
    return;
  }

  throw new Error(`Conversion from ${mimeType || path.extname(inputPath)} to ${targetFormat} is not supported.`);
}
