import { NextRequest, NextResponse } from 'next/server';
import { writeFile, readFile, stat } from 'fs/promises';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { convertFile, cleanupJob, cleanupOldFiles } from '@/lib/converter';
import { getUploadsDir, getConvertedDir } from '@/lib/tempStorage';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const targetFormat = formData.get('targetFormat') as string | null;
    const action = (formData.get('action') as string) || 'convert';

    if (!file || !targetFormat) {
      return NextResponse.json({ error: 'Missing file or target format' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const uploadsDir = getUploadsDir();
    const convertedDir = getConvertedDir();

    // Run background cleanup of old temp files
    cleanupOldFiles().catch(() => {});

    const jobId = uuidv4();
    const originalExt = file.name.split('.').pop() || '';
    const inputPath = join(/*turbopackIgnore: true*/ uploadsDir, `${jobId}.${originalExt}`);
    const outputPath = join(/*turbopackIgnore: true*/ convertedDir, `${jobId}.${targetFormat.toLowerCase()}`);

    await writeFile(/*turbopackIgnore: true*/ inputPath, buffer);

    await convertFile(inputPath, outputPath, targetFormat, file.type, action === 'compress', jobId);

    // Schedule cleanup of this job's files after 5 minutes
    setTimeout(() => cleanupJob(jobId, originalExt, targetFormat), 5 * 60 * 1000);

    const outStat = await stat(/*turbopackIgnore: true*/ outputPath).catch(() => null);
    const outBuffer = await readFile(/*turbopackIgnore: true*/ outputPath).catch(() => null);

    // Build base64 Data URL for instant, serverless-safe in-browser download (up to 4MB)
    let downloadDataUrl: string | undefined;
    if (outBuffer && outBuffer.length <= 4 * 1024 * 1024) {
      const tf = targetFormat.toLowerCase();
      let mime = 'application/octet-stream';
      if (tf === 'docx') mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      else if (tf === 'doc') mime = 'application/msword';
      else if (tf === 'pdf') mime = 'application/pdf';
      else if (tf === 'png') mime = 'image/png';
      else if (['jpg', 'jpeg'].includes(tf)) mime = 'image/jpeg';
      else if (tf === 'webp') mime = 'image/webp';
      else if (tf === 'txt') mime = 'text/plain';
      else if (tf === 'html') mime = 'text/html';
      else if (tf === 'mp3') mime = 'audio/mpeg';
      else if (tf === 'wav') mime = 'audio/wav';
      else if (tf === 'mp4') mime = 'video/mp4';

      downloadDataUrl = `data:${mime};base64,${outBuffer.toString('base64')}`;
    }

    return NextResponse.json({
      success: true,
      downloadUrl: `/api/download/${jobId}.${targetFormat.toLowerCase()}`,
      downloadDataUrl,
      jobId,
      originalSize: buffer.length,
      convertedSize: outStat ? outStat.size : buffer.length,
    });
  } catch (error: any) {
    console.error('Conversion error:', error);
    return NextResponse.json({ error: error.message || 'Conversion failed' }, { status: 500 });
  }
}
