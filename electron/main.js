/**
 * research-desk desktop shell (Electron):
 * 1) Cek server research-desk (lewat SSH tunnel kalau belum jalan),
 * 2) Buka jendela apa adanya → UI Next.js di AWS tampil di Chromium Electron.
 * Web-tab di UI otomatis pakai <webview> (Chromium embed penuh, gak ada
 * blokir X-Frame) saat berjalan di dalam shell ini.
 *
 * Konfigurasi opsional lewat env: RD_SSH_HOST, RD_SSH_PEM, RD_PORT.
 */
const { app, BrowserWindow, dialog } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const os = require('os');
const path = require('path');

const HOST = process.env.RD_SSH_HOST || 'ubuntu@18.138.203.100';
const PEM =
  process.env.RD_SSH_PEM || path.join(os.homedir(), 'Desktop', 'n8n.pem');
const PORT = process.env.RD_PORT || '3000';
const APP_URL = `http://localhost:${PORT}/`;

function serverOk() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, timeout: 4000 }, (res) => {
      res.resume();
      resolve(res.statusCode !== undefined);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

function waitServer(totalMs) {
  const step = 750;
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = async () => {
      if (await serverOk()) return resolve(true);
      if (Date.now() - started >= totalMs) return resolve(false);
      setTimeout(tick, step);
    };
    tick();
  });
}

let tunnel = null;

function openTunnel() {
  return spawn(
    'ssh',
    [
      '-N',
      '-L', `${PORT}:localhost:${PORT}`,
      '-i', PEM,
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'ServerAliveInterval=30',
      '-o', 'ExitOnForwardFailure=yes',
      HOST,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
}

app.setName('research-desk');

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    title: 'research-desk',
    backgroundColor: '#F8FAFC',
    autoHideMenuBar: true,
    webPreferences: {
      webviewTag: true, // <webview> di tab tengah = Chromium embed penuh.
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadURL(APP_URL);
  win.on('closed', () => {
    win = null;
  });
}

app.whenReady().then(async () => {
  let ok = await waitServer(1500); // tunnel mungkin sudah jalan manual pun.
  if (!ok) {
    tunnel = openTunnel();
    let tunnelErr = '';
    tunnel.stderr.on('data', (chunk) => {
      tunnelErr += String(chunk);
      if (tunnelErr.length > 800) tunnelErr = tunnelErr.slice(-800);
    });
    tunnel.on('close', (code) => {
      // Tunnel mati di tengah sesi → tutup app (user tinggal buka lagi).
      if (!win) return;
      dialog.showErrorBox(
        'Koneksi ke server putus',
        `SSH tunnel tertutup (kode ${code}).\n${tunnelErr.trim() || 'Coba buka app lagi.'}`,
      );
      app.quit();
    });
    ok = await waitServer(25_000);
  }

  if (!ok) {
    dialog.showErrorBox(
      'Gagal nyambung ke server',
      `Server ${APP_URL} tidak mau hidup.\nCek: laptop lu online, file pem=${PEM} ada, host=${HOST}.`,
    );
    app.quit();
    return;
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('will-quit', () => {
  if (tunnel) {
    try {
      tunnel.kill();
    } catch {
      /* biarkan */
    }
  }
});
