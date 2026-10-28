import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Find Ghostscript executable on common Windows paths */
function findGhostscript(): string | null {
  const candidates = [
    'gswin64c',
    'gswin32c',
    'gs',
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
    try { execSync(`"${c}" --version`, { stdio: 'ignore' }); return c; } catch {}
  }
  return null;
}

/** Find LibreOffice soffice executable */
function findLibreOffice(): string | null {
  const candidates = [
    'soffice',
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  ];
  for (const c of candidates) {
    try { execSync(`"${c}" --version`, { stdio: 'ignore' }); return c; } catch {}
  }
  return null;
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

// ─── Progress Tracking ───────────────────────────────────────────────────────

const progressMap = new Map<string, number>();

export function getProgress(jobId: string): number {
  return progressMap.get(jobId) ?? 0;
}

export function setProgress(jobId: string, pct: number) {
  progressMap.set(jobId, pct);
}

export function clearProgress(jobId: string) {
  progressMap.delete(jobId);
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

export async function cleanupJob(jobId: string, originalExt: string, targetFormat: string) {
  const tmpDir = path.join(process.cwd(), '.tmp');
  const inputPath = path.join(tmpDir, 'uploads', `${jobId}.${originalExt}`);
  const outputPath = path.join(tmpDir, 'converted', `${jobId}.${targetFormat}`);
  try { await fs.promises.unlink(inputPath); } catch {}
  try { await fs.promises.unlink(outputPath); } catch {}
  clearProgress(jobId);
}

// Auto-cleanup old temp files (older than 10 minutes)
export async function cleanupOldFiles() {
  const tmpDir = path.join(process.cwd(), '.tmp');
  const dirs = ['uploads', 'converted'];
  const tenMin = 10 * 60 * 1000;
  for (const dir of dirs) {
    const fullDir = path.join(tmpDir, dir);
    try {
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
      const { compressPdfImages } = require('./pdfCompressor');
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

    // PDF to DOCX (Word Document)
    if (targetFormat === 'docx' || targetFormat === 'doc') {
      const { Document, Packer, Paragraph, TextRun } = require('docx');
      const pages = await extractPdfData(inputPath);
      const docChildren: any[] = [];
      for (const lines of pages) {
        for (const line of lines) {
          if (line.trim()) {
            docChildren.push(new Paragraph({
              children: [new TextRun({ text: line, size: 24 })],
              spacing: { after: 120 }
            }));
          }
        }
      }
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

  // DOCX -> PDF via Edge fallback if LibreOffice is absent
  if (isDocxInput && targetFormat === 'pdf') {
    const soffice = findLibreOffice();
    if (!soffice) {
      const mammoth = require('mammoth');
      const puppeteer = require('puppeteer-core');
      const result = await mammoth.convertToHtml({ path: inputPath });
      const html = `<html><head><style>body{font-family:sans-serif;padding:2rem;}</style></head><body>${result.value}</body></html>`;
      const browser = await puppeteer.launch({
        executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        headless: true
      });
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      await page.pdf({ path: outputPath, format: 'A4', margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' } });
      await browser.close();
      setProgress(jobId, 100);
      return;
    }
  }

  // LibreOffice path for Office inputs (DOCX, PPTX, XLSX)
  if (isOfficeInput) {
    const soffice = findLibreOffice();
    if (!soffice) throw new Error('LibreOffice is required to convert Office (PPTX/XLSX/DOCX) files.');

    const outDir = path.dirname(outputPath);
    const loFormat = targetFormat;

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(`"${soffice}"`, [
        '--headless', '--convert-to', loFormat, '--outdir', outDir, inputPath
      ], { shell: true });
      proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`LibreOffice exited with code ${code}`)));
      proc.on('error', reject);
    });

    const inputBaseName = path.basename(inputPath, path.extname(inputPath));
    const loOutput = path.join(outDir, `${inputBaseName}.${loFormat}`);
    if (loOutput !== outputPath && fs.existsSync(loOutput)) {
      await fs.promises.rename(loOutput, outputPath);
    }
    setProgress(jobId, 100);
    return;
  }

  // ── TXT / HTML → PDF via puppeteer ───────────────────────────────────────
  if ((mimeType.includes('text/plain') || mimeType.includes('text/html')) && targetFormat === 'pdf') {
    const puppeteer = require('puppeteer-core');
    let content = await fs.promises.readFile(inputPath, 'utf8');
    if (mimeType.includes('text/plain')) {
      content = `<html><head><style>body{font-family:monospace;white-space:pre-wrap;padding:2rem;}</style></head><body>${content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</body></html>`;
    }
    const browser = await puppeteer.launch({
      executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      headless: true
    });
    const page = await browser.newPage();
    await page.setContent(content, { waitUntil: 'networkidle0' });
    await page.pdf({ path: outputPath, format: 'A4', margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' } });
    await browser.close();
    setProgress(jobId, 100);
    return;
  }

  throw new Error(`Conversion from ${mimeType || path.extname(inputPath)} to ${targetFormat} is not supported.`);
}
