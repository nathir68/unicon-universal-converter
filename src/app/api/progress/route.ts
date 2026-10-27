import { NextRequest, NextResponse } from 'next/server';
import { getProgress } from '@/lib/converter';

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get('jobId');
  if (!jobId) return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });

  // Server-Sent Events stream
  const stream = new ReadableStream({
    start(controller) {
      const send = (data: string) => {
        controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
      };

      const interval = setInterval(() => {
        const pct = getProgress(jobId);
        send(JSON.stringify({ progress: pct }));
        if (pct >= 100) {
          clearInterval(interval);
          controller.close();
        }
      }, 300);

      // Timeout after 5 minutes
      setTimeout(() => { clearInterval(interval); try { controller.close(); } catch {} }, 5 * 60 * 1000);
    }
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
