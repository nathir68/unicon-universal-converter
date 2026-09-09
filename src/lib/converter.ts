import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import { promisify } from 'util';
import libre from 'libreoffice-convert';

const libreConvertAsync = promisify(libre.convert);

export async function convertFile(inputPath: string, outputPath: string, targetFormat: string, mimeType: string, isCompress: boolean = false): Promise<void> {
  targetFormat = targetFormat.toLowerCase();
  const imageFormats = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'tiff', 'gif'];
  const videoAudioFormats = ['mp4', 'avi', 'mkv', 'mov', 'webm', 'flv', 'mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a'];
  const documentFormats = ['pdf', 'docx', 'doc', 'txt', 'html', 'pptx', 'ppt', 'xlsx', 'xls', 'csv'];

  if (isCompress && !imageFormats.includes(targetFormat) && !videoAudioFormats.includes(targetFormat)) {
    throw new Error('Compression is currently only supported for Image, Video, and Audio files.');
  }

  if (imageFormats.includes(targetFormat)) {
    let format = targetFormat;
    if (format === 'jpg') format = 'jpeg';
    
    let pipeline = sharp(inputPath);
    
    if (isCompress) {
      if (format === 'jpeg' || format === 'jpg') pipeline = pipeline.jpeg({ quality: 60 });
      else if (format === 'png') pipeline = pipeline.png({ quality: 60, compressionLevel: 9 });
      else if (format === 'webp') pipeline = pipeline.webp({ quality: 60 });
      else pipeline = pipeline.toFormat(format as any);
    } else {
      pipeline = pipeline.toFormat(format as any);
    }
    
    await pipeline.toFile(outputPath);
    return;
  }

  if (videoAudioFormats.includes(targetFormat)) {
    return new Promise((resolve, reject) => {
      let command = ffmpeg(inputPath).toFormat(targetFormat);
      
      if (isCompress) {
        if (['mp4', 'mkv', 'mov', 'webm', 'avi', 'flv'].includes(targetFormat)) {
          // Compress video by lowering video bitrate and crf
          command = command.videoCodec('libx264').outputOptions(['-crf 28', '-preset fast']).audioBitrate('96k');
        } else {
          // Compress audio
          command = command.audioBitrate('64k');
        }
      }
      
      command
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .save(outputPath);
    });
  }

  if (documentFormats.includes(targetFormat)) {
    // Handle PDF to TXT
    if (mimeType === 'application/pdf' && targetFormat === 'txt') {
      const PDFParser = require('pdf2json');
      
      return new Promise((resolve, reject) => {
        const pdfParser = new PDFParser(null, 1);
        
        pdfParser.on('pdfParser_dataError', (errData: any) => reject(new Error(errData.parserError)));
        pdfParser.on('pdfParser_dataReady', async () => {
          try {
            const text = pdfParser.getRawTextContent();
            await fs.promises.writeFile(outputPath, text);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
        
        pdfParser.loadPDF(inputPath);
      });
    }

    // Handle DOCX conversions
    if (mimeType.includes('wordprocessingml.document') || inputPath.endsWith('.docx')) {
      const mammoth = require('mammoth');
      const puppeteer = require('puppeteer-core');

      if (targetFormat === 'txt') {
        const result = await mammoth.extractRawText({ path: inputPath });
        await fs.promises.writeFile(outputPath, result.value);
        return;
      }
      
      if (targetFormat === 'html' || targetFormat === 'pdf') {
        const result = await mammoth.convertToHtml({ path: inputPath });
        const htmlContent = `<html><head><style>body{font-family:sans-serif;padding:2rem;}</style></head><body>${result.value}</body></html>`;
        
        if (targetFormat === 'html') {
          await fs.promises.writeFile(outputPath, htmlContent);
          return;
        }

        // Generate PDF using Edge browser
        const browser = await puppeteer.launch({
          executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
          headless: true
        });
        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
        await page.pdf({ path: outputPath, format: 'A4', margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' } });
        await browser.close();
        return;
      }
    }
    
    // Handle TXT or HTML to PDF
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
      return;
    }

    throw new Error('Document conversion for this specific format combination is currently unavailable.');
  }

  throw new Error(`Conversion to ${targetFormat} is not supported yet.`);
}
