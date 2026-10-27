import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { convertFile, cleanupJob, cleanupOldFiles } from '@/lib/converter';

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

    const tmpDir = join(process.cwd(), '.tmp');
    const uploadsDir = join(tmpDir, 'uploads');
    const convertedDir = join(tmpDir, 'converted');

    await mkdir(uploadsDir, { recursive: true });
    await mkdir(convertedDir, { recursive: true });

    // Run background cleanup of old temp files
    cleanupOldFiles().catch(() => {});

    const jobId = uuidv4();
    const originalExt = file.name.split('.').pop() || '';
    const inputPath = join(uploadsDir, `${jobId}.${originalExt}`);
    const outputPath = join(convertedDir, `${jobId}.${targetFormat}`);

    await writeFile(inputPath, buffer);

    await convertFile(inputPath, outputPath, targetFormat, file.type, action === 'compress', jobId);

    // Schedule cleanup of this job's files after 5 minutes
    setTimeout(() => cleanupJob(jobId, originalExt, targetFormat), 5 * 60 * 1000);

    return NextResponse.json({
      success: true,
      downloadUrl: `/api/download/${jobId}.${targetFormat}`,
      jobId,
    });
  } catch (error: any) {
    console.error('Conversion error:', error);
    return NextResponse.json({ error: error.message || 'Conversion failed' }, { status: 500 });
  }
}
