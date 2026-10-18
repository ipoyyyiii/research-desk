/**
 * Diff baris sederhana (LCS DP) untuk layar review edit agent — tanpa dep.
 * Cap ukuran biar gak ngeslag tab tengah (file kut kilat thesis < 5k baris).
 */
const MAX_LINES = 5000;

export type DiffRow = {
  type: 'same' | 'add' | 'del';
  /** Nomor baris sumber (before) untuk same/del; target (after) untuk add. */
  line: number;
  text: string;
};

function clip(text: string): string[] {
  return text.replace(/\r\n/g, '\n').split('\n').slice(0, MAX_LINES);
}

export function countDiff(before: string, after: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const row of computeLineDiff(before, after)) {
    if (row.type === 'add') added += 1;
    if (row.type === 'del') removed += 1;
  }
  return { added, removed };
}

/** Unified-style diff baris. File thesis (beberapa ribu baris) tetap aman. */
export function computeLineDiff(before: string, after: string): DiffRow[] {
  // File kosong total → anggap 0 baris (bukan ['']), biar hitungan murni add/del.
  const a = before.trim() === '' ? [] : clip(before);
  const b = after.trim() === '' ? [] : clip(after);
  const n = a.length;
  const m = b.length;

  // Tabel LCS — (n+1) x (m+1); besar dibatasi MAX_LINES di atas.
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ type: 'same', line: i + 1, text: a[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: 'del', line: i + 1, text: a[i] });
      i += 1;
    } else {
      rows.push({ type: 'add', line: j + 1, text: b[j] });
      j += 1;
    }
  }
  while (i < n) {
    rows.push({ type: 'del', line: i + 1, text: a[i] });
    i += 1;
  }
  while (j < m) {
    rows.push({ type: 'add', line: j + 1, text: b[j] });
    j += 1;
  }
  return rows;
}
