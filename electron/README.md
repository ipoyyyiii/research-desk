# research-desk desktop (Electron)

Shell app buat laptop: Chromium asli di-embed → web-tab di panel tengah jadi
**browser penuh** (bukan iframe, bukan proxy): blokir anti-frame gak berlaku,
login Google dst. jalan normal. UI tetap satu-satunya di server AWS; app ini
cuma bungkus + nyalain SSH tunnel sendiri.

## Cara run di macOS laptop (sekali setup)

1. Pastikan Node terpasang di laptop (`node -v`); kalau belum:
   `brew install node`, atau download dari nodejs.org.
2. Salin folder ini ke laptop — dari Terminal di laptop:
   `scp -i ~/Desktop/n8n.pem -r ubuntu@18.138.203.100:~/research-desk/electron ~/Desktop/research-desk-app`
3. `cd ~/Desktop/research-desk-app && npm install` — download ~120MB sekali.
4. `npm start` → app buka, tunnel SSH nyala otomatis pakai `~/Desktop/n8n.pem`.

## Konfigurasi (opsional)

- `RD_SSH_PEM=/path/pem npm start` — pem lain.
- `RD_SSH_HOST=ubuntu@1.2.3.4 npm start` — server lain.
- `RD_PORT=3000 npm start` — port tunnel lain.

## Catatan

- Tunnel dipakai bareng dengan shell manual lu: kalau yang dari Terminal
  sudah jalan dulu, app mendeteksi server hidup dan gak dobel-buat tunnel.
- Browser biasa (dari tunnel) tetap bisa dipakai — web-tab otomatis jatuh ke
  mode proxy-rewrite; di dalam app Electron ini otomatis mode webview penuh.
