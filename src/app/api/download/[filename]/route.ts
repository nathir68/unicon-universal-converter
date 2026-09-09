import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

export async function GET(
  request: NextRequest,
  { params }: { params: { filename: string } }
) {
  try {
    const filename = params.filename;
    if (!filename || filename.includes('..')) {
      return new NextResponse('Invalid filename', { status: 400 });
    }

    const filePath = join(process.cwd(), '.tmp', 'converted', filename);

    if (!existsSync(filePath)) {
      return new NextResponse('File not found', { status: 404 });
    }

    const fileBuffer = await readFile(filePath);
    
    const ext = filename.split('.').pop()?.toLowerCase();
    let contentType = 'application/octet-stream';
    if (ext === 'pdf') contentType = 'application/pdf';
    else if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext || '')) contentType = `image/${ext}`;
    else if (['mp3', 'wav'].includes(ext || '')) contentType = `audio/${ext}`;
    else if (['mp4', 'avi'].includes(ext || '')) contentType = `video/${ext}`;
    
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
