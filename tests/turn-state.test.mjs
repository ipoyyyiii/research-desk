/**
 * Regression test: keputusan "turn sudah selesai belum?".
 *
 * Ini yang menjaga indikator "Ngetik..." di panel AI Assistant gak nyangkut
 * selamanya kalau event `session.idle` kelewat. Jalankan: npm test
 */
import assert from 'node:assert/strict';
import { turnFinished } from '../src/lib/opencode/turn-state.ts';

const START = 1_000_000;

let passed = 0;
function check(name, actual, expected) {
  assert.equal(actual, expected, `${name} → haru ${expected}, bukan ${actual}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('turn-state:');

// Belum ada balasan sama sekali (model masih mikir / provider lambat).
check('belum ada balasan', turnFinished([], START), 'unknown');
check(
  'balasan lama doang (turn sebelumnya)',
  turnFinished([{ role: 'assistant', finished: true, createdAt: START - 1000 }], START),
  'unknown',
);

// Balasan dari turn ini tapi belum selesai → agent masih kerja.
check(
  'balasan belum selesai',
  turnFinished([{ role: 'assistant', finished: false, createdAt: START + 10 }], START),
  'running',
);
check(
  'balasan selesai tapi ada tool yang jalan',
  turnFinished(
    [{ role: 'assistant', finished: true, createdAt: START + 10, toolEvents: [{ status: 'running' }] }],
    START,
  ),
  'running',
);

// Balasan selesai → turn selesai, indikator ngetik boleh mati.
check(
  'balasan selesai',
  turnFinished([{ role: 'assistant', finished: true, createdAt: START + 10 }], START),
  'done',
);

// Beberapa langkah: yang terakhir menentukan.
check(
  'langkah terakhir selesai',
  turnFinished(
    [
      { role: 'assistant', finished: true, createdAt: START + 10 },
      { role: 'assistant', finished: true, createdAt: START + 20 },
    ],
    START,
  ),
  'done',
);
check(
  'langkah terakhir belum selesai',
  turnFinished(
    [
      { role: 'assistant', finished: true, createdAt: START + 10 },
      { role: 'assistant', finished: false, createdAt: START + 20 },
    ],
    START,
  ),
  'running',
);

// Persis di detik turn dimulai → dianggap milik turn ini.
check(
  'balasan tepat di waktu turn mulai',
  turnFinished([{ role: 'assistant', finished: true, createdAt: START }], START),
  'done',
);

// Pesan user bukan sinyal selesai.
check(
  'cuma pesan user',
  turnFinished([{ role: 'user', createdAt: START + 5 }], START),
  'unknown',
);

console.log(`\n${passed} assertion lulus.`);
