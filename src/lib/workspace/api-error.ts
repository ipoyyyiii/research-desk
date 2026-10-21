import { NextResponse } from 'next/server';
import { WorkspaceError } from './files';

const MESSAGES: Record<string, string> = {
  INVALID_PATH: 'Path tidak valid',
  PATH_OUT_OF_PROJECT: 'File di luar folder project',
  FILE_NOT_FOUND: 'File tidak ditemukan',
  FILE_TOO_BIG: 'File terlalu besar',
  UNSUPPORTED_TYPE: 'Tipe file ini belum bisa dibuka',
};

/** Balasan error untuk exception dari lib/workspace (path & file guard). */
export function workspaceError(error: unknown, fallback: string): NextResponse {
  if (error instanceof WorkspaceError) {
    return NextResponse.json(
      { error: MESSAGES[error.code] ?? fallback, code: error.code },
      { status: 400 },
    );
  }
  return NextResponse.json({ error: fallback }, { status: 500 });
}
