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
  // Also scan Program Files\gs for any version
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

  const imageFormats = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'tiff', 'gif', 'bmp', 'ico'];
  const videoFormats = ['mp4', 'avi', 'mkv', 'mov', 'webm', 'flv'];
  const audioFormats = ['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a'];
  const videoAudioFormats = [...videoFormats, ...audioFormats];
  const officeFormats = ['docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls', 'csv', 'odt'];

  setProgress(jobId, 5);

  // ── Image ────────────────────────────────────────────────────────────────
  if (imageFormats.includes(targetFormat)) {
    let format = targetFormat === 'jpg' ? 'jpeg' : targetFormat;
    let pipeline = sharp(inputPath);
    if (isCompress) {
      if (format === 'jpeg') pipeline = pipeline.jpeg({ quality: 60 });
      else if (format === 'png') pipeline = pipeline.png({ quality: 60, compressionLevel: 9 });
      else if (format === 'webp') pipeline = pipeline.webp({ quality: 60 });
      else pipeline = pipeline.toFormat(format as any);
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
          command = command.videoCodec('libx264').outputOptions(['-crf 28', '-preset fast']).audioBitrate('96k');
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

  // ── PDF Compression via Ghostscript ──────────────────────────────────────
  if (isCompress && mimeType === 'application/pdf' && targetFormat === 'pdf') {
    const gs = findGhostscript();
    if (!gs) throw new Error('Ghostscript is not installed. Please install it for PDF compression.');
    execSync(`"${gs}" -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/ebook -dNOPAUSE -dQUIET -dBATCH -sOutputFile="${outputPath}" "${inputPath}"`);
    setProgress(jobId, 100);
    return;
  }

  // ── PDF → TXT ─────────────────────────────────────────────────────────────
  if (mimeType === 'application/pdf' && targetFormat === 'txt') {
    const PDFParser = require('pdf2json');
    return new Promise((resolve, reject) => {
      const pdfParser = new PDFParser(null, 1);
      pdfParser.on('pdfParser_dataError', (e: any) => reject(new Error(e.parserError)));
      pdfParser.on('pdfParser_dataReady', async () => {
        try {
          const text = pdfParser.getRawTextContent();
          await fs.promises.writeFile(outputPath, text);
          setProgress(jobId, 100);
          resolve();
        } catch (err) { reject(err); }
      });
      pdfParser.loadPDF(inputPath);
    });
  }

  // ── Office Docs (DOCX, PPTX, XLSX) via LibreOffice ───────────────────────
  const isOfficeInput = officeFormats.some(ext => inputPath.toLowerCase().endsWith(`.${ext}`))
    || mimeType.includes('officedocument') || mimeType.includes('opendocument');
  const isDocxInput = inputPath.toLowerCase().endsWith('.docx') || mimeType.includes('wordprocessingml');

  // Special DOCX fast-path using mammoth
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

  // LibreOffice path for Office → PDF, DOCX, PPTX, XLSX, etc.
  if (isOfficeInput || ['pdf', 'docx', 'pptx', 'xlsx', 'odt', 'txt', 'html'].includes(targetFormat)) {
    const soffice = findLibreOffice();

    // Fallback: puppeteer path for DOCX → PDF when LibreOffice not available
    if (!soffice && isDocxInput && targetFormat === 'pdf') {
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

    if (!soffice) throw new Error('LibreOffice is not installed. Please install it to convert Office/PPTX/XLSX files.');

    // LibreOffice converts to a dir; we then rename the output file
    const outDir = path.dirname(outputPath);
    const loFormat = targetFormat === 'pdf' ? 'pdf' : targetFormat === 'docx' ? 'docx' : targetFormat === 'pptx' ? 'pptx' : targetFormat === 'xlsx' ? 'xlsx' : targetFormat;

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(`"${soffice}"`, [
        '--headless', '--convert-to', loFormat, '--outdir', outDir, inputPath
      ], { shell: true });
      proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`LibreOffice exited with code ${code}`)));
      proc.on('error', reject);
    });

    // LibreOffice names the output after the input file — rename to jobId
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

  throw new Error(`Conversion from ${mimeType} to ${targetFormat} is not supported yet.`);
}
