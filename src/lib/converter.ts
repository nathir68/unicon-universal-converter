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

/** Extract embedded images page-by-page from PDF using pdf-lib + sharp */
async function extractImagesFromPdf(pdfBytes: Buffer): Promise<Map<number, ExtractedPdfImage[]>> {
  const imagesByPage = new Map<number, ExtractedPdfImage[]>();
  try {
    const loadedDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const pageCount = loadedDoc.getPageCount();

    for (let pIdx = 0; pIdx < pageCount; pIdx++) {
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
                const stream = loadedDoc.context.lookup(ref);
                if (stream instanceof PDFRawStream) {
                  const dict = stream.dict;
                  const subtype = dict.get(PDFName.of('Subtype'))?.toString();
                  if (subtype === '/Image') {
                    const filter = dict.get(PDFName.of('Filter'))?.toString() || '';
                    const w = (dict.get(PDFName.of('Width')) as any)?.asNumber?.() || 300;
                    const h = (dict.get(PDFName.of('Height')) as any)?.asNumber?.() || 200;
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
                      pageImages.push({ buffer: buf, width: w, height: h });
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

  const PDFParser = require('pdf2json');
  const parser = new PDFParser(null, 1);
  const pdfData: any = await new Promise((resolve) => {
    parser.on('pdfParser_dataReady', (data: any) => resolve(data));
    parser.on('pdfParser_dataError', () => resolve(null));
    parser.loadPDF(inputPath);
  });

  const children: any[] = [];
  const totalPages = pdfData?.Pages?.length || 1;

  for (let pIdx = 0; pIdx < totalPages; pIdx++) {
    const pageData = pdfData?.Pages?.[pIdx];
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

  if (children.length === 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Converted Document (Empty)', size: 24, color: '000000' })]
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

/** Extract structured text lines grouped by page and vertical position from PDF */
async function extractPdfData(inputPath: string): Promise<string[][]> {
  const PDFParser = require('pdf2json');
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser(null, 1);
    pdfParser.on('pdfParser_dataError', (e: any) => reject(new Error(e.parserError || 'Failed to parse PDF')));
    pdfParser.on('pdfParser_dataReady', (pdfData: any) => {
      try {
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
                    try {
                      textStr += decodeURIComponent(r.T);
                    } catch {
                      textStr += r.T;
                    }
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
        resolve(pages);
      } catch (err) {
        reject(err);
      }
    });
    pdfParser.loadPDF(inputPath);
  });
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

// ─── Pure JS Text/DOCX to PDF Generator ──────────────────────────────────────

/** Convert extracted plain text or DOCX text into a structured, multi-page A4 PDF */
async function convertTextOrDocxToPdf(
  text: string,
  outputPath: string,
  title?: string
): Promise<void> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage(PageSizes.A4);
  const { width, height } = page.getSize();
  const margin = 50;
  const maxWidth = width - margin * 2;
  let y = height - margin;
  const fontSize = 11;
  const lineHeight = 16;

  if (title) {
    const cleanTitle = title.replace(/[^\x20-\x7E]/g, ' ').trim();
    if (cleanTitle) {
      page.drawText(cleanTitle, {
        x: margin,
        y,
        size: 16,
        font: boldFont,
        color: rgb(0.1, 0.15, 0.3),
      });
      y -= 26;
    }
  }

  const cleanText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const paragraphs = cleanText.split('\n');

  for (const rawPara of paragraphs) {
    const para = rawPara.replace(/[^\x20-\x7E\t]/g, ' ').trim();
    if (!para) {
      y -= lineHeight * 0.5;
      continue;
    }

    const isHeading = (para.length < 50 && (para.endsWith(':') || para === para.toUpperCase())) || para.startsWith('#');
    const displayPara = para.replace(/^#+\s*/, '');
    const currentFont = isHeading ? boldFont : font;
    const currentSize = isHeading ? 13 : fontSize;
    const currentLineHeight = isHeading ? 19 : lineHeight;

    const words = displayPara.split(/\s+/);
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      let testWidth = 0;
      try {
        testWidth = currentFont.widthOfTextAtSize(testLine, currentSize);
      } catch {
        testWidth = testLine.length * currentSize * 0.6;
      }

      if (testWidth > maxWidth) {
        if (y - currentLineHeight < margin) {
          page = doc.addPage(PageSizes.A4);
          y = height - margin;
        }
        try {
          page.drawText(currentLine, {
            x: margin,
            y,
            size: currentSize,
            font: currentFont,
            color: isHeading ? rgb(0.1, 0.15, 0.25) : rgb(0.15, 0.15, 0.15),
          });
        } catch {}
        y -= currentLineHeight;
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }

    if (currentLine) {
      if (y - currentLineHeight < margin) {
        page = doc.addPage(PageSizes.A4);
        y = height - margin;
      }
      try {
        page.drawText(currentLine, {
          x: margin,
          y,
          size: currentSize,
          font: currentFont,
          color: isHeading ? rgb(0.1, 0.15, 0.25) : rgb(0.15, 0.15, 0.15),
        });
      } catch {}
      y -= currentLineHeight;
    }
    y -= 4;
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

    // PDF to HTML
    if (targetFormat === 'html') {
      const pages = await extractPdfData(inputPath);
      const htmlBody = pages.map((lines, i) => `
        <div class="page" style="margin-bottom: 2rem; padding: 2rem; background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.1); border-radius: 8px;">
          <div style="font-size: 0.8rem; color: #888; margin-bottom: 1rem;">Page ${i + 1}</div>
          ${lines.map(l => `<p style="margin: 0.5rem 0; line-height: 1.6;">${l.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`).join('')}
        </div>
      `).join('');
      const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Converted Document</title><style>body{font-family:system-ui,sans-serif;background:#f3f4f6;padding:2rem;max-width:800px;margin:auto;}</style></head><body>${htmlBody}</body></html>`;
      await fs.promises.writeFile(outputPath, fullHtml, 'utf8');
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
      const html = `<html><head><style>body{font-family:sans-serif;padding:2rem;}</style></head><body>${result.value}</body></html>`;
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

    // Pure JS Fallback using Mammoth + pdf-lib (runs on Vercel without LibreOffice or Edge)
    setProgress(jobId, 50);
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ path: inputPath });
    const text = result.value || 'Converted Document (Empty)';
    const originalName = path.basename(inputPath, path.extname(inputPath));
    await convertTextOrDocxToPdf(text, outputPath, originalName);
    setProgress(jobId, 100);
    return;
  }

  // ── TXT / HTML → PDF via pure pdf-lib ───────────────────────────────────────
  if ((mimeType.includes('text/plain') || mimeType.includes('text/html') || inputExt === 'txt' || inputExt === 'html') && targetFormat === 'pdf') {
    let content = await fs.promises.readFile(inputPath, 'utf8');
    if (mimeType.includes('text/html') || inputExt === 'html') {
      content = content.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                       .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                       .replace(/<[^>]+>/g, '\n')
                       .replace(/&nbsp;/g, ' ')
                       .replace(/&amp;/g, '&')
                       .replace(/&lt;/g, '<')
                       .replace(/&gt;/g, '>')
                       .replace(/&quot;/g, '"');
    }
    const originalName = path.basename(inputPath, path.extname(inputPath));
    await convertTextOrDocxToPdf(content, outputPath, originalName);
    setProgress(jobId, 100);
    return;
  }

  // ── TXT → DOCX ────────────────────────────────────────────────────────────
  if ((mimeType.includes('text/plain') || inputExt === 'txt') && (targetFormat === 'docx' || targetFormat === 'doc')) {
    const content = await fs.promises.readFile(inputPath, 'utf8');
    const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const docChildren = lines.map(line => new Paragraph({
      children: [new TextRun({ text: line, size: 24 })],
      spacing: { after: 100 }
    }));
    const doc = new Document({
      sections: [{
        properties: {},
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
