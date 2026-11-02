import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { getConvertedDir } from '@/lib/tempStorage';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await params;
    if (!filename || filename.includes('..')) {
      return new NextResponse('Invalid filename', { status: 400 });
    }

    // Check temp storage first, then fallback to local .tmp
    let filePath = join(/*turbopackIgnore: true*/ getConvertedDir(), filename);
    if (!existsSync(/*turbopackIgnore: true*/ filePath)) {
      const fallback = join(/*turbopackIgnore: true*/ process.cwd(), '.tmp', 'converted', filename);
      if (existsSync(/*turbopackIgnore: true*/ fallback)) {
        filePath = fallback;
      } else {
        return new NextResponse('File not found', { status: 404 });
      }
    }

    const fileBuffer = await readFile(/*turbopackIgnore: true*/ filePath);
    
    const ext = filename.split('.').pop()?.toLowerCase();
    let contentType = 'application/octet-stream';
    if (ext === 'docx') contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    else if (ext === 'doc') contentType = 'application/msword';
    else if (ext === 'pdf') contentType = 'application/pdf';
    else if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext || '')) contentType = `image/${ext}`;
    else if (['mp3', 'wav'].includes(ext || '')) contentType = `audio/${ext}`;
    else if (['mp4', 'avi'].includes(ext || '')) contentType = `video/${ext}`;
    else if (ext === 'txt') contentType = 'text/plain';
    else if (ext === 'html') contentType = 'text/html';
    
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="converted-${filename}"`,
      },
    });
  } catch (error) {
    console.error('Download error:', error);
    return new NextResponse('Internal Error', { status: 500 });
  }
}
