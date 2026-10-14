// Swipe Clean — processo principal (Electron)
// Cuida da janela, das capas, das configurações e das remoções. A análise pesada
// roda em scanner.js, numa worker thread, para a janela nunca congelar.

const { app, BrowserWindow, ipcMain, shell, net, Menu, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const crypto = require('crypto');
const { Worker } = require('worker_threads');
const { execFile, spawn } = require('child_process');
const pix = require('./pix.js');
const i18n = require('./i18n.js');
const updater = require('./updater.js');

const IS_WIN = process.platform === 'win32';
const AUTO_SCAN = process.argv.includes('--auto-scan'); // usado pelo diagnostico.bat

let win = null;
let lastScan = new Map(); // id -> item (a remoção só aceita ids vindos do último scan)
let skipFlag = false;
let scanning = false;

// só uma janela do app por vez
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

// ---------------------------------------------------------------- log de diagnóstico
// Fica em %APPDATA%\Swipe Clean\log.txt e é recriado a cada abertura do app.

let logPath = null;
const T0 = Date.now();
function writeLog(text) {
  const line = `[${new Date().toISOString().slice(11, 23)} +${((Date.now() - T0) / 1000).toFixed(1)}s] ${text}\n`;
  try {
    process.stdout.write(line);
  } catch {}
  if (!logPath) return;
  try {
    fs.appendFileSync(logPath, line);
  } catch {}
}
process.on('uncaughtException', (e) => writeLog('ERRO não tratado: ' + (e.stack || e.message)));
process.on('unhandledRejection', (e) => writeLog('Promise rejeitada: ' + ((e && e.stack) || e)));

// ---------------------------------------------------------------- configurações

const DEFAULT_SETTINGS = { onlineCovers: true, showKept: false, showSystem: false, language: 'auto', autoUpdate: true };

// idioma: "auto" segue o Windows (português → pt-BR, qualquer outro → inglês)
let lang = 'en';
let t = i18n.createT(lang);
function applyLanguage() {
  let pref = settings.language;
  if (!pref || pref === 'auto') {
    const sys = typeof app.getPreferredSystemLanguages === 'function' ? app.getPreferredSystemLanguages() : [];
    pref = (sys && sys[0]) || app.getLocale();
  }
  lang = i18n.resolve(pref);
  t = i18n.createT(lang);
}
let settings = { ...DEFAULT_SETTINGS };
const userFile = (name) => path.join(app.getPath('userData'), name);

function loadSettings() {
  try {
    settings = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(userFile('config.json'), 'utf8')) };
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
}
function saveSettings() {
  try {
    fs.writeFileSync(userFile('config.json'), JSON.stringify(settings, null, 2));
  } catch (e) {
    writeLog('Não consegui salvar config.json: ' + e.message);
  }
}

// ---------------------------------------------------------------- janela

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 960,
    minHeight: 720,
    show: false,
    backgroundColor: '#0e1014',
    title: 'Swipe Clean',
    icon: path.join(__dirname, 'renderer', 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      additionalArguments: AUTO_SCAN ? ['--swipe-auto-scan'] : [],
    },
  });
  win.once('ready-to-show', () => win.show());
  // a tela nunca abre outras janelas nem navega para fora do app
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.webContents.on('console-message', (...args) => {
    const e = args[0];
    const msg = e && e.message !== undefined ? e.message : args[2];
    const level = e && e.level !== undefined ? e.level : args[1];
    if (level === 'error' || level === 3 || level === 'warning' || level === 2) writeLog('Tela: ' + msg);
  });
  win.webContents.on('render-process-gone', (_e, d) => writeLog('A tela fechou inesperadamente: ' + JSON.stringify(d)));
  win.webContents.on('preload-error', (_e, p, err) => writeLog('Erro no preload: ' + err.message));
}

app.whenReady().then(() => {
  logPath = userFile('log.txt');
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(logPath, '');
  } catch {}
  loadSettings();
  applyLanguage();
  writeLog(`Idioma: ${lang} (configuração: ${settings.language})`);
  writeLog(
    `Swipe Clean ${app.getVersion()} iniciado. Electron ${process.versions.electron}, Windows ${os.release()}, pasta ${__dirname}, capas online: ${settings.onlineCovers}`
  );
  Menu.setApplicationMenu(null);
  createWindow();
});
app.on('window-all-closed', () => app.quit());

const send = (channel, data) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- utilidades

// dentro do .exe empacotado, scripts e a thread ficam em app.asar.unpacked
const unpacked = (...p) => path.join(__dirname, ...p).replace('app.asar', 'app.asar.unpacked');

function runWorker(data, onProgress) {
  return new Promise((resolve, reject) => {
    const w = new Worker(unpacked('scanner.js'), { workerData: data });
    let settled = false;
    writeLog(`Thread iniciada: ${data.task}`);
    w.on('message', (m) => {
      if (m.type === 'log') {
        writeLog('Thread: ' + m.text);
      } else if (m.type === 'progress') {
        if (m.step) writeLog(`Etapa ${m.step}: ${m.status}${m.text ? ' — ' + m.text : ''}`);
        onProgress && onProgress(m);
      } else if (m.type === 'result') {
        writeLog('Thread concluída');
        settled = true;
        resolve(m.result);
      } else if (m.type === 'error') {
        writeLog('Thread falhou: ' + m.message);
        settled = true;
        reject(new Error(m.message));
      }
    });
    w.on('error', (e) => {
      writeLog('Erro na thread: ' + (e.stack || e.message));
      if (!settled) reject(e);
      settled = true;
    });
    w.on('exit', (code) => {
      writeLog(`Thread encerrada (código ${code})`);
      if (!settled) reject(new Error(t('scan.stopped', { code })));
    });
  });
}

function runPS(args, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-InputFormat', 'None', '-ExecutionPolicy', 'Bypass', ...args], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(t('remove.psTimeout')));
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error((err || `código ${code}`).trim().slice(0, 300)));
      else resolve(out);
    });
  });
}

async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function diskInfo() {
  const root = IS_WIN ? (process.env.SystemDrive || 'C:') + '\\' : '/';
  try {
    const s = await fsp.statfs(root);
    return { root, total: s.blocks * s.bsize, free: s.bavail * s.bsize };
  } catch {
    return { root, total: 0, free: 0 };
  }
}

async function fileIcon(p) {
  try {
    if (!p || !(await exists(p))) return null;
    const img = await app.getFileIcon(p, { size: 'large' });
    return img.isEmpty() ? null : img.toDataURL();
  } catch {
    return null;
  }
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    })
  );
}

let adminCache = null;
function isAdmin() {
  if (!IS_WIN) return Promise.resolve(false);
  if (adminCache !== null) return Promise.resolve(adminCache);
  return new Promise((resolve) => {
    const c = spawn('net', ['session'], { windowsHide: true, stdio: 'ignore' });
    c.on('error', () => resolve((adminCache = false)));
    c.on('close', (code) => resolve((adminCache = code === 0)));
  });
}

// ---------------------------------------------------------------- capas de jogos

const coverDir = () => userFile('covers');
let coverMisses = null; // chave -> data da última tentativa sem sucesso

function missesFile() {
  return path.join(coverDir(), 'sem-capa.json');
}
function loadMisses() {
  if (coverMisses) return;
  try {
    coverMisses = JSON.parse(fs.readFileSync(missesFile(), 'utf8'));
  } catch {
    coverMisses = {};
  }
}
function saveMisses() {
  try {
    fs.writeFileSync(missesFile(), JSON.stringify(coverMisses));
  } catch {}
}

const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 20);
const normName = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[™®©]/g, '')
    .replace(/\b(edition|edicao|definitive|remastered|goty|game of the year|deluxe|ultimate|standard|complete)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

async function fetchBuffer(url, opts = {}) {
  const res = await net.fetch(url, { ...opts, signal: AbortSignal.timeout(9000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const type = res.headers.get('content-type') || '';
  const buf = Buffer.from(await res.arrayBuffer());
  return { buf, type };
}

async function steamCdnCover(appid) {
  const bases = [
    `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appid}/`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/`,
  ];
  for (const [file, portrait] of [['library_600x900_2x.jpg', true], ['library_600x900.jpg', true], ['header.jpg', false]]) {
    for (const b of bases) {
      try {
        const { buf, type } = await fetchBuffer(b + file);
        if (buf.length > 2000 && /image/.test(type)) return { buf, portrait };
      } catch {}
    }
  }
  return null;
}

async function steamSearchAppId(name) {
  const term = name.replace(/[™®©]/g, '').trim();
  const { buf } = await fetchBuffer(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=brazilian&cc=BR`);
  const data = JSON.parse(buf.toString('utf8'));
  const want = normName(name);
  const items = (data.items || []).filter((i) => i.type === 'app' || !i.type);
  const exact = items.find((i) => normName(i.name) === want);
  if (exact) return exact.id;
  const close = items.find((i) => {
    const n = normName(i.name);
    return (n.startsWith(want) || want.startsWith(n)) && Math.abs(n.length - want.length) <= 6 && Math.min(n.length, want.length) >= 4;
  });
  return close ? close.id : null;
}

async function epicCover(ns, id) {
  const body = JSON.stringify({
    query: 'query($ns:String!,$id:String!){Catalog{catalogItem(namespace:$ns,id:$id){keyImages{type url}}}}',
    variables: { ns, id },
  });
  const { buf } = await fetchBuffer('https://graphql.epicgames.com/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  const imgs = JSON.parse(buf.toString('utf8'))?.data?.Catalog?.catalogItem?.keyImages || [];
  const pick =
    imgs.find((i) => i.type === 'DieselGameBoxTall') || imgs.find((i) => i.type === 'OfferImageTall') || imgs.find((i) => i.type === 'Thumbnail');
  if (!pick) return null;
  const r = await fetchBuffer(pick.url + (pick.url.includes('?') ? '&' : '?') + 'h=900&resize=1');
  return { buf: r.buf, portrait: true };
}

const toDataURL = (buf) => 'data:image/jpeg;base64,' + buf.toString('base64');

// Devolve { cover, coverPortrait } para um jogo, usando nesta ordem:
// cache do Swipe Clean → arquivos da Steam no PC → internet (se permitido).
async function resolveCover(it) {
  const key =
    it.platform === 'steam' ? 'steam-' + it.appid : it.platform === 'epic' ? 'epic-' + it.epicItem : 'nome-' + normName(it.name);
  const file = path.join(coverDir(), hash(key) + '.jpg');
  const meta = file.replace(/\.jpg$/, '.json');

  try {
    const buf = await fsp.readFile(file);
    let portrait = true;
    try {
      portrait = JSON.parse(await fsp.readFile(meta, 'utf8')).portrait;
    } catch {}
    return { cover: toDataURL(buf), coverPortrait: portrait };
  } catch {}

  if (it.coverPath) {
    try {
      const buf = await fsp.readFile(it.coverPath);
      return { cover: toDataURL(buf), coverPortrait: !!it.coverPortrait };
    } catch {}
  }

  if (!settings.onlineCovers) return null;
  loadMisses();
  if (coverMisses[key] && Date.now() - coverMisses[key] < 7 * 86400000) return null;

  let got = null;
  try {
    if (it.platform === 'steam') got = await steamCdnCover(it.appid);
    if (!got && it.platform === 'epic' && it.epicNamespace && it.epicItem)
      got = await epicCover(it.epicNamespace, it.epicItem).catch((e) => (writeLog(`Capa Epic de "${it.name}": ${e.message}`), null));
    if (!got) {
      const appid = await steamSearchAppId(it.name).catch(() => null);
      if (appid) got = await steamCdnCover(appid);
    }
  } catch (e) {
    writeLog(`Capa de "${it.name}": ${e.message}`);
  }

  if (!got) {
    writeLog(`Sem capa para "${it.name}" (${it.platform || 'pc'})`);
    coverMisses[key] = Date.now();
    saveMisses();
    return null;
  }
  try {
    await fsp.mkdir(coverDir(), { recursive: true });
    await fsp.writeFile(file, got.buf);
    await fsp.writeFile(meta, JSON.stringify({ portrait: got.portrait, name: it.name }));
  } catch {}
  return { cover: toDataURL(got.buf), coverPortrait: got.portrait };
}

// ---------------------------------------------------------------- IPC: leitura

ipcMain.on('log', (_e, text) => writeLog('Tela: ' + String(text).slice(0, 2000)));
ipcMain.handle('disk-info', () => diskInfo());
ipcMain.handle('app-info', async () => ({ version: app.getVersion(), admin: await isAdmin(), packaged: app.isPackaged, lang }));
ipcMain.handle('settings-get', () => settings);
ipcMain.handle('settings-set', (_e, patch) => {
  for (const k of Object.keys(patch || {})) {
    if (k === 'language') {
      if (['auto', 'pt-BR', 'en'].includes(patch[k])) settings.language = patch[k];
    } else if (k in DEFAULT_SETTINGS) settings[k] = !!patch[k];
  }
  saveSettings();
  applyLanguage();
  writeLog('Configurações: ' + JSON.stringify(settings));
  return settings;
});
ipcMain.handle('open-logs', () => shell.openPath(app.getPath('userData')));

// ---------------------------------------------------------------- atualizações

let updateInfo = null;
ipcMain.handle('update-check', async () => {
  try {
    updateInfo = await updater.check();
    writeLog(`Atualização: instalada ${updateInfo.current}, mais nova ${updateInfo.version} (${updateInfo.available ? 'disponível' : 'em dia'}, ${updateInfo.kind})`);
    const { setupUrl, sumsUrl, ...forUi } = updateInfo;
    return forUi;
  } catch (e) {
    writeLog('Atualização: não foi possível verificar: ' + e.message);
    return { error: 'network' };
  }
});
ipcMain.handle('update-install', async () => {
  if (!updateInfo || !updateInfo.available) return { error: 'none' };
  if (!updateInfo.canInstall) {
    updater.openReleases();
    return { opened: true };
  }
  try {
    await updater.install(updateInfo, {
      onProgress: (pct) => send('update-progress', { pct }),
      log: writeLog,
      beforeQuit: () => app.releaseSingleInstanceLock(),
    });
    return { installing: true };
  } catch (e) {
    writeLog('Atualização falhou: ' + e.message);
    return { error: /checksum/.test(e.message) ? 'checksum' : 'network' };
  }
});
ipcMain.handle('update-open', () => updater.openReleases());

ipcMain.handle('open-location', async (_e, id) => {
  const it = lastScan.get(id);
  const p = it && (it.path || it.location);
  if (!p) return false;
  shell.showItemInFolder(p);
  return true;
});

ipcMain.handle('relaunch-admin', async () => {
  if (!IS_WIN) return false;
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const args = app.isPackaged ? [] : [app.getAppPath()];
  const cmd =
    `Start-Process -FilePath ${q(process.execPath)} -Verb RunAs` + (args.length ? ` -ArgumentList ${args.map((a) => q('"' + a + '"')).join(',')}` : '');
  app.releaseSingleInstanceLock();
  try {
    await runPS(['-Command', cmd], 120000);
    writeLog('Reiniciando como administrador');
    setTimeout(() => app.quit(), 300);
    return true;
  } catch (e) {
    writeLog('Reinício como administrador cancelado: ' + e.message);
    app.requestSingleInstanceLock();
    return false;
  }
});

ipcMain.handle('scan', async () => {
  if (!IS_WIN) throw new Error(t('scan.onlyWindows'));
  if (scanning) throw new Error(t('scan.already'));
  scanning = true;
  writeLog('Análise pedida pela tela');
  try {
    const home = os.homedir();
    const result = await runWorker(
      {
        task: 'scan',
        lang,
        scriptsDir: unpacked('scripts'),
        home,
        local: process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'),
        roaming: process.env.APPDATA || path.join(home, 'AppData', 'Roaming'),
        temp: os.tmpdir(),
        downloads: app.getPath('downloads'),
        desktop: app.getPath('desktop'),
        videos: app.getPath('videos'),
        documents: app.getPath('documents'),
        selfData: app.getPath('userData'),
      },
      (m) => send('scan-progress', m)
    );

    // capas dos jogos
    const gameItems = result.items.filter((i) => i.kind === 'game' || i.isGame);
    const prog = (status, text) => send('scan-progress', { type: 'progress', step: 'covers', status, text });
    prog('active', t('scan.progress', { done: 0, total: gameItems.length }));
    let done = 0;
    let found = 0;
    await pool(gameItems, 6, async (g) => {
      const c = await resolveCover(g).catch(() => null);
      if (c) {
        Object.assign(g, c);
        found++;
      }
      done++;
      prog('active', t('scan.progress', { done, total: gameItems.length }));
    });
    prog('done', gameItems.length ? t('scan.coversDone', { found, total: gameItems.length }) : t('scan.noGames'));
    writeLog(`Capas: ${found} de ${gameItems.length}`);

    // ícones dos programas
    const programs = result.items.filter((i) => i.kind === 'program');
    const iconProg = (status, text) => send('scan-progress', { type: 'progress', step: 'icons', status, text });
    iconProg('active', t('scan.progress', { done: 0, total: programs.length }));
    done = 0;
    await pool(programs, 4, async (p) => {
      for (const c of p.iconCandidates || []) {
        p.icon = await fileIcon(c);
        if (p.icon) break;
      }
      done++;
      if (done % 4 === 0) iconProg('active', t('scan.progress', { done, total: programs.length }));
    });
    iconProg('done', t('scan.iconsDone', { n: programs.filter((p) => p.icon).length }));

    writeLog(`Análise pronta: ${result.items.length} itens`);
    lastScan = new Map(result.items.map((i) => [i.id, i]));
    // a tela não precisa (nem deve) ver comandos de desinstalação e caminhos internos
    const items = result.items.map(({ uninstall, key, packageFullName, iconCandidates, manifestPath, coverPath, ...rest }) => rest);
    return { items, prefetchAvailable: result.prefetchAvailable };
  } catch (e) {
    writeLog('Análise falhou: ' + (e.stack || e.message));
    throw e;
  } finally {
    scanning = false;
  }
});

// ---------------------------------------------------------------- remoção

function regKeyExists(key) {
  return new Promise((resolve) => {
    execFile('reg.exe', ['query', key], { windowsHide: true }, (err) => resolve(!err));
  });
}

function startUninstall(it) {
  let cmd = (it.uninstall || '').trim();
  let child;
  const msi = cmd.match(/msiexec(?:\.exe)?\s+\/[ix]\s*(\{[0-9A-F-]+\})/i);
  if (msi) {
    child = spawn('msiexec.exe', ['/x', msi[1]], { windowsHide: false });
  } else {
    // caminho sem aspas e com espaços: C:\Program Files\X\uninstall.exe /arg
    if (!cmd.startsWith('"')) {
      const m = cmd.match(/^(.+?\.exe)(\s.*)?$/i);
      if (m && m[1].includes(' ')) cmd = `"${m[1]}"${m[2] || ''}`;
    }
    child = spawn(cmd, { shell: true, windowsHide: false });
  }
  return new Promise((resolve) => {
    child.on('error', (e) => resolve({ error: e.message }));
    child.on('exit', (code) => resolve({ code }));
  });
}

// Espera até `isGone()` confirmar a remoção, o usuário pular, ou o tempo acabar.
async function waitUntilGone(it, isGone, { message, exitInfo }) {
  send('remove-progress', { id: it.id, status: 'waiting', canSkip: true, message });
  const deadline = Date.now() + 30 * 60 * 1000;
  let warned = false;
  while (true) {
    await sleep(1500);
    if (await isGone()) {
      const reboot = exitInfo && exitInfo.exit && (exitInfo.exit.code === 3010 || exitInfo.exit.code === 1641);
      return { status: 'done', message: reboot ? t('remove.doneReboot') : t('remove.done') };
    }
    if (skipFlag) return { status: 'skipped', message: t('remove.skipped') };
    if (exitInfo && exitInfo.exit) {
      const { code, error } = exitInfo.exit;
      if (error) return { status: 'error', message: t('remove.uninstallerFailed', { msg: error }) };
      if (code === 1602 || code === 1223) return { status: 'skipped', message: t('remove.cancelled') };
      if (!warned && Date.now() - exitInfo.at > 20000) {
        warned = true;
        send('remove-progress', {
          id: it.id,
          status: 'waiting',
          canSkip: true,
          message: t('remove.uninstallerClosed'),
        });
      }
    }
    if (Date.now() > deadline) return { status: 'skipped', message: t('remove.timeout') };
  }
}

async function removeProgram(it) {
  if (!(await regKeyExists(it.key))) return { status: 'done', message: t('remove.alreadyGone') };
  const exitInfo = { exit: null, at: 0 };
  startUninstall(it).then((r) => {
    exitInfo.exit = r;
    exitInfo.at = Date.now();
  });
  return waitUntilGone(it, async () => !(await regKeyExists(it.key)), {
    exitInfo,
    message: t('remove.uninstallerOpen'),
  });
}

async function removeSteamGame(it) {
  if (!(await exists(it.manifestPath))) return { status: 'done', message: t('remove.alreadyGone') };
  await shell.openExternal(`steam://uninstall/${it.appid}`);
  return waitUntilGone(it, async () => !(await exists(it.manifestPath)), {
    message: t('remove.steamConfirm'),
  });
}

async function removeEpicGame(it) {
  if (!(await exists(it.manifestPath))) return { status: 'done', message: t('remove.alreadyGone') };
  const x86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const launcher = [
    path.join(x86, 'Epic Games', 'Launcher', 'Portal', 'Binaries', 'Win64', 'EpicGamesLauncher.exe'),
    path.join(x86, 'Epic Games', 'Launcher', 'Portal', 'Binaries', 'Win32', 'EpicGamesLauncher.exe'),
  ];
  let opened = false;
  for (const l of launcher) {
    if (await exists(l)) {
      spawn(l, [], { detached: true, stdio: 'ignore' }).unref();
      opened = true;
      break;
    }
  }
  if (!opened) await shell.openExternal('com.epicgames.launcher://store').catch(() => {});
  return waitUntilGone(it, async () => !(await exists(it.manifestPath)), {
    message: t('remove.epicHint', { name: it.name }),
  });
}

async function removeStoreApp(it) {
  if (!/^[A-Za-z0-9._~-]+$/.test(it.packageFullName)) return { status: 'error', message: t('remove.invalidPackage') };
  await runPS(['-Command', `Remove-AppxPackage -Package '${it.packageFullName}' -ErrorAction Stop`]);
  return { status: 'done', message: t('remove.storeDone') };
}

async function moveToTrash(it) {
  if (!(await exists(it.path))) return { status: 'done', message: t('remove.alreadyMissing') };
  try {
    await shell.trashItem(it.path);
    return { status: 'done', message: t('remove.trashed'), trashed: true };
  } catch {
    return { status: 'error', message: t('remove.trashFailed') };
  }
}

ipcMain.on('skip-current', () => {
  skipFlag = true;
});

ipcMain.handle('remove', async (_e, ids) => {
  if (!IS_WIN) throw new Error(t('remove.onlyWindows'));
  const before = await diskInfo();
  const results = [];

  // ordem: caches e temporários → pastas → apps da Store → programas e jogos (os interativos por último)
  const order = { temp: 0, cache: 1, download: 2, user: 2, appdata: 3, store: 4, program: 5, game: 6 };
  const items = ids
    .map((id) => lastScan.get(id))
    .filter(Boolean)
    .sort((a, b) => order[a.kind] - order[b.kind]);

  for (const it of items) {
    skipFlag = false;
    send('remove-progress', { id: it.id, status: 'running', message: t('remove.removing') });
    let r;
    try {
      if (it.kind === 'program') r = await removeProgram(it);
      else if (it.kind === 'game' && it.platform === 'steam') r = await removeSteamGame(it);
      else if (it.kind === 'game' && it.platform === 'epic') r = await removeEpicGame(it);
      else if (it.kind === 'store') r = await removeStoreApp(it);
      else if (it.kind === 'temp' || it.kind === 'cache') r = await runWorker({ task: 'clean', path: it.path, lang });
      else r = await moveToTrash(it);
    } catch (err) {
      r = { status: 'error', message: err.message };
    }
    writeLog(`Remoção [${it.kind}${it.platform ? '/' + it.platform : ''}] ${it.name}: ${r.status} — ${r.message}`);
    send('remove-progress', { id: it.id, ...r, canSkip: false });
    results.push({ id: it.id, ...r });
  }

  const after = await diskInfo();
  return { results, freed: Math.max(0, after.free - before.free), disk: after };
});


// ---------------------------------------------------------------- doação por Pix
// Os dados ficam em doacao.json, ao lado do app. Sem chave, a doação não aparece.

function readDonation() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'doacao.json'), 'utf8').replace(/^\uFEFF/, ''));
    if (!cfg.pixKey || !String(cfg.pixKey).trim()) return { enabled: false };
    const base = { key: cfg.pixKey, name: cfg.nome, city: cfg.cidade, message: cfg.mensagem };
    const amounts = (Array.isArray(cfg.valores) ? cfg.valores : []).filter((v) => Number(v) > 0).slice(0, 4);
    const options = [null, ...amounts].map((amount) => {
      const code = pix.brCode({ ...base, amount });
      return { amount, code, qr: pix.svgDataURL(pix.qrSVG(code)) };
    });
    return { enabled: true, key: String(cfg.pixKey).trim(), name: cfg.nome || '', options };
  } catch (e) {
    writeLog('Doação desativada: ' + e.message);
    return { enabled: false };
  }
}

// Pix só funciona no Brasil: a doação aparece apenas com o app em português
ipcMain.handle('donate-info', () => (lang === 'pt-BR' ? readDonation() : { enabled: false }));
ipcMain.handle('copy-text', (_e, text) => {
  clipboard.writeText(String(text).slice(0, 2000));
  return true;
});
ipcMain.on('donate-opened', (_e, where) => writeLog('Tela de doação aberta (' + String(where).slice(0, 30) + ')'));

// ---------------------------------------------------------------- decisões salvas

ipcMain.handle('decisions-get', async () => {
  try {
    return JSON.parse(await fsp.readFile(userFile('decisoes.json'), 'utf8'));
  } catch {
    return { kept: {} };
  }
});

ipcMain.handle('decisions-save', async (_e, data) => {
  try {
    await fsp.writeFile(userFile('decisoes.json'), JSON.stringify(data, null, 2));
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('decisions-clear', async () => {
  try {
    await fsp.rm(userFile('decisoes.json'), { force: true });
    writeLog('Decisões salvas apagadas');
    return true;
  } catch {
    return false;
  }
});
