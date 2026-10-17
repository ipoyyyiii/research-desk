import { NextResponse } from 'next/server';
import { ensureServer } from '@/lib/opencode/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * SSE proxy: app → browser.
 * Mengambil event-bus OpenCode dan menyalurkan subset yang relevan untuk session ini.
 * Browser: `new EventSource('/api/ai/stream?sessionId=...')`
 *
 * Event yang disalurkan:
 * - delta        { type: session.text.delta, id, data }
 * - tool-event   { type: session.tool.*, id, data }
 * - agent-event  { type: session.step.*|session.idle|..., id, data }
 * - permission   { type: permission.asked, id, data }
 * - fs-change    { type: filesystem.changed, id, data }
 */
export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get('sessionId');
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId wajib ada' }, { status: 400 });
  }

  let client;
  try {
    client = await ensureServer();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server OpenCode tidak siap';
    return NextResponse.json({ error: message }, { status: 503 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // sudah tertutup
        }
      };
      request.signal.addEventListener('abort', close);

      const send = (eventName: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // stream putus
          close();
        }
      };

      send('hello', { sessionId });

      try {
        for await (const ev of client.event.subscribe()) {
          if (closed) break;
          const type = ev.type;
          const data = (ev as { data?: unknown }).data as
            | { sessionID?: string; file?: string; event?: string }
            | undefined;

          if (type === 'filesystem.changed') {
            send('fs-change', { id: ev.id, data });
            continue;
          }

          if (data?.sessionID && data.sessionID !== sessionId) continue;

          switch (type) {
            case 'session.text.delta':
            case 'session.reasoning.delta':
              send('delta', { id: ev.id, type, data });
              break;
            case 'session.tool.called':
            case 'session.tool.progress':
            case 'session.tool.success':
            case 'session.tool.failed':
              send('tool-event', { id: ev.id, type, data });
              break;
            case 'session.step.started':
            case 'session.step.ended':
            case 'session.step.failed':
            case 'session.execution.started':
            case 'session.execution.failed':
            case 'session.execution.interrupted':
            case 'session.idle':
            case 'session.text.started':
            case 'session.text.ended':
              send('agent-event', { id: ev.id, type, data });
              break;
            case 'permission.asked':
              send('permission', { id: ev.id, type, data });
              break;
            default:
              break;
          }
        }
      } catch (error) {
        if (!closed) {
          send('error', { message: error instanceof Error ? error.message : String(error) });
        }
      } finally {
        close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
