import { NextResponse } from 'next/server';
import { ensureServer } from '@/lib/opencode/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type QuestionBody = {
  sessionId?: string;
  /** ID form dari event `form.created` (data.form.id). */
  formId?: string;
  /** Jawaban per question-field: { q0: "APA" } atau { q0: "teks bebas" }. */
  answer?: Record<string, string | number | boolean | string[]>;
  /** Skip tanpa jawaban → session.form.cancel; agent nerima tool error, turn tetap lanjut. */
  cancel?: boolean;
  /** Pesan opsional saat cancel ( surfing "User skip"). */
  message?: string;
};

/**
 * Jawab pertanyaan agent (kartu pertanyaan di chat).
 * Mekanisme hasil probe Lane C (2026-10-19, /tmp/opencode/question-probe):
 * - Tool `question` agent = event `form.created` (metadata.kind = "question").
 * - Jawab user = `session.form.reply({ sessionID, formID, answer })` →
 *   bukti: HTTP/akurasi reply OK dan agent lanjut turn (session.execution.succeeded).
 * - Teks bebas diterima (field custom: true); cancel memakai `session.form.cancel`.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as QuestionBody;
    if (!body.sessionId || !body.formId) {
      return NextResponse.json({ error: 'sessionId dan formId wajib ada' }, { status: 400 });
    }
    const answer = body.answer && typeof body.answer === 'object' ? body.answer : null;
    if (!body.cancel && (!answer || Object.keys(answer).length === 0)) {
      return NextResponse.json({ error: 'answer (record jawaban) wajib ada kalau bukan cancel' }, { status: 400 });
    }    const client = await ensureServer();
    if (body.cancel) {
      await client.session.form.cancel({
        sessionID: body.sessionId,
        formID: body.formId,
        ...(body.message ? { message: body.message } : {}),
      });
      return NextResponse.json({ ok: true });
    }
    if (!answer || Object.keys(answer).length === 0) {
      return NextResponse.json({ error: 'answer (record jawaban) wajib ada kalau bukan cancel' }, { status: 400 });
    }
    await client.session.form.reply({
      sessionID: body.sessionId,
      formID: body.formId,
      answer,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal menjawab pertanyaan';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Daftar pertanyaan yang masih nunggu jawaban (buat restore kartu pas tab di-refresh). */
export async function GET(request: Request) {
  try {
    const sessionId = new URL(request.url).searchParams.get('sessionId');
    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId wajib ada' }, { status: 400 });
    }
    const client = await ensureServer();
    const forms = await client.session.form.list({ sessionID: sessionId });
    const raw = (Array.isArray(forms) ? forms : []) as Array<{ metadata?: { kind?: string } }>;
    return NextResponse.json({
      ok: true,
      forms: raw.filter((form) => form?.metadata?.kind === 'question'),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal membaca daftar pertanyaan';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
