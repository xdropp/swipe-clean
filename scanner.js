// Swipe Clean — trabalho pesado em uma worker thread.
// Tudo que mexe com muitos arquivos (medir pastas, apagar caches) roda aqui,
// para a janela do app nunca congelar.

const { parentPort, workerData } = require('worker_threads');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { spawn } = require('child_process');
const games = require('./games.js');
const { isSystemComponent } = require('./system-filter.js');
const i18n = require('./i18n.js');

const MB = 1024 * 1024;
const opts = workerData || {};
const t = i18n.createT(opts.lang || 'en');

const post = (msg) => parentPort.postMessage(msg);
const step = (id, status, extra = {}) => post({ type: 'progress', step: id, status, ...extra });
let lastDetail = 0;
const detail = (text) => {
  const now = Date.now();
  if (now - lastDetail < 120) return; // no máximo ~8 atualizações por segundo
  lastDetail = now;
  post({ type: 'progress', detail: text });
};

// ---------------------------------------------------------------- utilidades

const log = (text) => post({ type: 'log', text });

// Roda um .ps1 com stdin fechado (sem isso o PowerShell pode ficar esperando
// entrada para sempre) e com tempo limite.
function runPSFile(file, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const script = path.join(opts.scriptsDir, file);
    log(`PowerShell ${file}: iniciando (${script})`);
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-InputFormat', 'None', '-ExecutionPolicy', 'Bypass', '-File', script],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const out = [];
    let err = '';
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => (err += d.toString()));
    const timer = setTimeout(() => {
      log(`PowerShell ${file}: tempo esgotado após ${timeoutMs / 1000}s`);
      child.kill();
      reject(new Error(t('scan.psTimeout', { s: timeoutMs / 1000 })));
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      log(`PowerShell ${file}: erro ao iniciar: ${e.message}`);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const text = Buffer.concat(out).toString('utf8');
      log(`PowerShell ${file}: terminou com código ${code} em ${Date.now() - t0} ms, ${text.length} caracteres${err ? ', stderr: ' + err.slice(0, 500) : ''}`);
      if (code !== 0 && !text.trim()) reject(new Error((err || `código de saída ${code}`).trim().slice(0, 300)));
      else resolve(text);
    });
  });
}

function parseJSON(text) {
  const t = (text || '').trim().replace(/^\uFEFF/, '');
  if (!t) return [];
  const v = JSON.parse(t);
  return Array.isArray(v) ? v : [v];
}

async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

// Soma o tamanho de uma pasta (ignora atalhos/junções e arquivos sem permissão).
async function dirSize(dir, budget = { files: 300000 }) {
  let total = 0;
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  detail(dir);
  const files = [];
  for (const e of entries) {
    if (budget.files-- <= 0) break;
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) total += await dirSize(p, budget);
    else if (e.isFile()) files.push(p);
  }
  for (let i = 0; i < files.length; i += 64) {
    const stats = await Promise.all(files.slice(i, i + 64).map((f) => fsp.stat(f).catch(() => null)));
    for (const s of stats) if (s) total += s.size;
  }
  return total;
}

async function pathSize(p) {
  try {
    const s = await fsp.lstat(p);
    if (s.isSymbolicLink()) return 0;
    return s.isDirectory() ? dirSize(p) : s.size;
  } catch {
    return 0;
  }
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
    }
  });
  await Promise.all(workers);
  return out;
}

function cleanPath(p) {
  if (!p) return '';
  return p.replace(/"/g, '').replace(/,\s*-?\d+$/, '').trim();
}

// ---------------------------------------------------------------- programas

function isHidden(p) {
  if (p.systemComponent === 1) return true;
  if (p.parent) return true;
  if (/update|hotfix/i.test(p.releaseType || '')) return true;
  if (/^(security update|update for|hotfix)/i.test(p.name)) return true;
  if (/\bKB\d{6,}\b/.test(p.name)) return true;
  if (/swipe clean/i.test(p.name)) return true;
  return false;
}

const RISKY =
  /(visual c\+\+|redistributable|\.net|directx|driver|nvidia|geforce|amd software|radeon|chipset|intel\(r\)|realtek|webview2|microsoft edge|windows sdk|runtime|firmware|bios|microsoft update health|pc health check|windows app sdk|vcredist|openal|physx)/i;

async function readPrefetch() {
  const dir = path.join(process.env.SystemRoot || 'C:\\Windows', 'Prefetch');
  const map = new Map();
  try {
    const files = await fsp.readdir(dir);
    await pool(files.filter((f) => f.toLowerCase().endsWith('.pf')), 32, async (f) => {
      const exe = f.slice(0, f.lastIndexOf('-')).toUpperCase();
      try {
        const s = await fsp.stat(path.join(dir, f));
        if (!map.has(exe) || map.get(exe) < s.mtimeMs) map.set(exe, s.mtimeMs);
      } catch {}
    });
    return { available: true, map };
  } catch {
    return { available: false, map };
  }
}

async function findExes(dir, depth = 2, limit = 300) {
  const found = [];
  async function walk(d, level) {
    if (found.length >= limit) return;
    let entries;
    try {
      entries = await fsp.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (found.length >= limit) return;
      const p = path.join(d, e.name);
      if (e.isFile() && e.name.toLowerCase().endsWith('.exe')) found.push(p);
      else if (e.isDirectory() && !e.isSymbolicLink() && level < depth) await walk(p, level + 1);
    }
  }
  await walk(dir, 0);
  return found;
}

async function enrichProgram(p, prefetch) {
  const location = cleanPath(p.location);
  const iconPath = cleanPath(p.icon);
  const locOk = location && (await exists(location));

  const exes = [];
  if (/\.exe$/i.test(iconPath)) exes.push(iconPath);
  if (locOk) exes.push(...(await findExes(location)));

  let lastUsed = null;
  for (const x of exes) {
    const t = prefetch.map.get(path.basename(x).toUpperCase());
    if (t && (!lastUsed || t > lastUsed)) lastUsed = t;
  }

  let size = (p.sizeKB || 0) * 1024;
  if (!size && locOk) size = await dirSize(location);

  const mainExe = exes.find((x) => !/unins|uninst|setup|update|crash|helper/i.test(path.basename(x))) || '';
  const iconCandidates = [/\.(exe|ico)$/i.test(iconPath) ? iconPath : '', mainExe].filter(Boolean);

  return {
    id: 'p:' + p.key.toLowerCase(),
    kind: 'program',
    name: p.name.trim(),
    publisher: (p.publisher || '').trim(),
    version: p.version,
    installDate: p.installDate,
    location: locOk ? location : '',
    size,
    lastUsed,
    iconCandidates,
    risky: RISKY.test(p.name) || RISKY.test(p.publisher || ''),
    key: p.key,
    uninstall: p.uninstall,
    // bibliotecas e drivers (Visual C++, .NET, DirectX...) ficam ocultos por padrão
    system: isSystemComponent(p.name, p.publisher),
    isGame: !isSystemComponent(p.name, p.publisher) && games.isGameProgram({ name: p.name, publisher: p.publisher, location }),
  };
}

async function listPrograms(prefetch) {
  step('programs', 'active', { text: t('scan.readingRegistry') });
  // "Steam App 123" são os registros que a Steam cria para cada jogo: eles viram cartas de jogo
  const raw = parseJSON(await runPSFile('list-programs.ps1')).filter((p) => !isHidden(p) && !/\\Steam App \d+$/i.test(p.key));
  const seen = new Set();
  const unique = raw.filter((p) => {
    const k = (p.name + '|' + (p.version || '')).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  let done = 0;
  const out = await pool(unique, 6, async (p) => {
    const r = await enrichProgram(p, prefetch);
    done++;
    step('programs', 'active', { text: t('scan.analyzed', { done, total: unique.length }) });
    return r;
  });
  step('programs', 'done', { text: t('scan.found', { n: out.length }) });
  return out;
}

async function listStoreApps() {
  step('store', 'active', { text: t('scan.queryingStore') });
  const raw = parseJSON(await runPSFile('list-store-apps.ps1'));
  const out = await pool(raw, 6, async (a) => {
    const size = a.location ? await dirSize(a.location) : 0;
    return {
      id: 's:' + a.packageFullName.toLowerCase(),
      kind: 'store',
      name: a.name,
      publisher: a.publisher,
      version: a.version,
      installDate: a.installDate,
      location: a.location,
      size,
      lastUsed: null,
      risky: /^Microsoft\./i.test(a.packageFullName) && /store|xbox|gaming|winget|appinstaller/i.test(a.packageFullName),
      packageFullName: a.packageFullName,
    };
  });
  step('store', 'done', { text: t('scan.found', { n: out.length }) });
  return out;
}

// ---------------------------------------------------------------- pastas grandes

function cacheList() {
  const { home, local: L, roaming: R } = opts;
  const PD = process.env.ProgramData || 'C:\\ProgramData';
  const chrome = path.join(L, 'Google', 'Chrome', 'User Data', 'Default');
  const edge = path.join(L, 'Microsoft', 'Edge', 'User Data', 'Default');
  // [chave da tradução, pasta] — o nome e a descrição vêm de i18n.js ("Nome|Descrição")
  return [
    ['npm', path.join(L, 'npm-cache')],
    ['npm', path.join(R, 'npm-cache')],
    ['pip', path.join(L, 'pip', 'Cache')],
    ['yarn', path.join(L, 'Yarn', 'Cache')],
    ['pnpm', path.join(L, 'pnpm', 'store')],
    ['gradle', path.join(home, '.gradle', 'caches')],
    ['nuget', path.join(home, '.nuget', 'packages')],
    ['cargo', path.join(home, '.cargo', 'registry')],
    ['go', path.join(L, 'go-build')],
    ['chrome', path.join(chrome, 'Cache')],
    ['chromeCode', path.join(chrome, 'Code Cache')],
    ['edge', path.join(edge, 'Cache')],
    ['edgeCode', path.join(edge, 'Code Cache')],
    ['discord', path.join(R, 'discord', 'Cache')],
    ['spotify', path.join(L, 'Spotify', 'Data')],
    ['vscodeData', path.join(R, 'Code', 'CachedData')],
    ['vscode', path.join(R, 'Code', 'Cache')],
    ['cursorData', path.join(R, 'Cursor', 'CachedData')],
    ['cursor', path.join(R, 'Cursor', 'Cache')],
    ['d3d', path.join(L, 'D3DSCache')],
    ['nvidiaDx', path.join(L, 'NVIDIA', 'DXCache')],
    ['nvidiaGl', path.join(L, 'NVIDIA', 'GLCache')],
    ['amdDx', path.join(L, 'AMD', 'DxCache')],
    ['crashDumps', path.join(L, 'CrashDumps')],
    ['wer', path.join(PD, 'Microsoft', 'Windows', 'WER', 'ReportArchive')],
  ];
}

const APPDATA_SKIP = new Set([
  'microsoft', 'packages', 'temp', 'programs', 'google', 'mozilla', 'bravesoftware',
  'connecteddevicesplatform', 'comms', 'publishers', 'virtualstore', 'd3dscache', 'crashdumps',
  'nvidia', 'amd', 'npm-cache', 'pip', 'yarn', 'pnpm', 'go-build', 'swipe-clean', 'swipe clean',
]);

async function scanFolders(programs) {
  const { local: L, roaming: R } = opts;
  const out = [];
  const seen = new Set();
  const add = (o) => {
    const k = o.path.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ id: 'f:' + k, lastUsed: null, ...o });
  };

  // 1. temporários e caches
  step('caches', 'active', { text: t('scan.measuringTemp') });
  const tsize = await dirSize(opts.temp);
  if (tsize >= 50 * MB) {
    add({
      kind: 'temp',
      name: t('temp.name'),
      path: opts.temp,
      size: tsize,
      detail: t('temp.detail'),
    });
  }
  const caches = cacheList();
  let checked = 0;
  await pool(caches, 4, async ([key, p]) => {
    if (await exists(p)) {
      const size = await dirSize(p);
      const [name, info] = t('cache.' + key).split('|');
      if (size >= 100 * MB) add({ kind: 'cache', name, path: p, size, detail: info });
    }
    checked++;
    step('caches', 'active', { text: t('scan.placesChecked', { done: checked, total: caches.length }) });
  });
  const nCaches = out.length;
  step('caches', 'done', { text: nCaches ? t('scan.cachesDone', { n: nCaches }) : t('scan.nothingBig') });

  // 2. Downloads e pastas pessoais
  step('personal', 'active', { text: t('scan.looking', { folder: 'Downloads' }) });
  const personal = [
    ['download', opts.downloads, 100 * MB],
    ['user', opts.desktop, 500 * MB],
    ['user', opts.videos, 500 * MB],
    ['user', opts.documents, 500 * MB],
  ];
  const before = out.length;
  for (const [kind, base, min] of personal) {
    if (!base) continue;
    step('personal', 'active', { text: t('scan.looking', { folder: path.basename(base) }) });
    let entries = [];
    try {
      entries = await fsp.readdir(base, { withFileTypes: true });
    } catch {
      continue;
    }
    await pool(entries, 4, async (e) => {
      if (e.isSymbolicLink() || e.name.toLowerCase() === 'desktop.ini') return;
      const p = path.join(base, e.name);
      const size = await pathSize(p);
      if (size < min) return;
      let modified = null;
      try {
        modified = (await fsp.stat(p)).mtimeMs;
      } catch {}
      add({ kind, name: e.name, path: p, size, modified, isDir: e.isDirectory(), detail: t('item.inFolder', { folder: path.basename(base) }) });
    });
  }
  const nP = out.length - before;
  step('personal', 'done', { text: nP ? t('scan.bigItems', { n: nP }) : t('scan.nothingBig') });

  // 3. dados de aplicativos em AppData
  step('appdata', 'active', { text: t('scan.listingFolders') });
  const names = programs.map((p) => (p.name + ' ' + (p.publisher || '')).toLowerCase());
  const cachePaths = out.filter((o) => o.kind === 'cache').map((o) => [o.path.toLowerCase(), o.size]);
  const dirs = [];
  for (const base of [L, R]) {
    try {
      const entries = await fsp.readdir(base, { withFileTypes: true });
      for (const e of entries)
        if (e.isDirectory() && !e.isSymbolicLink() && !APPDATA_SKIP.has(e.name.toLowerCase())) dirs.push(path.join(base, e.name));
    } catch {}
  }
  const before2 = out.length;
  let measured = 0;
  await pool(dirs, 4, async (p) => {
    let size = await dirSize(p);
    measured++;
    step('appdata', 'active', { text: t('scan.foldersMeasured', { done: measured, total: dirs.length }) });
    for (const [cp, cs] of cachePaths) if (cp.startsWith(p.toLowerCase() + path.sep)) size -= cs;
    if (size < 300 * MB) return;
    const name = path.basename(p);
    const token = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const match = token.length >= 3 ? programs.find((pr, i) => names[i].includes(token)) : null;
    add({
      kind: 'appdata',
      name,
      path: p,
      size,
      detail: t('item.inFolder', { folder: `${path.basename(path.dirname(p))}\\${name}` }),
      matchedProgram: match ? match.name : null,
      risky: !!match,
    });
  });
  const nA = out.length - before2;
  step('appdata', 'done', { text: nA ? t('scan.bigFolders', { n: nA }) : t('scan.nothingBig') });

  return out;
}

// ---------------------------------------------------------------- tarefas

async function scan() {
  step('usage', 'active', { text: t('scan.readingPrefetch') });
  const prefetch = await readPrefetch();
  step('usage', 'done', {
    text: prefetch.available ? t('scan.records', { n: prefetch.map.size }) : t('scan.noAdmin'),
    warn: !prefetch.available,
  });

  const ctx = { prefetch, dirSize, findExes, log };
  const gamesPromise = (async () => {
    step('games', 'active', { text: t('scan.searchingGames') });
    const [steam, epic] = await Promise.all([
      games.listSteamGames(ctx).catch((e) => (log('Steam falhou: ' + e.message), [])),
      games.listEpicGames(ctx).catch((e) => (log('Epic falhou: ' + e.message), [])),
    ]);
    return { steam, epic };
  })();

  const [programs, store] = await Promise.all([
    listPrograms(prefetch).catch((e) => {
      step('programs', 'error', { text: t('scan.failedStep', { msg: e.message.slice(0, 120) }) });
      return [];
    }),
    listStoreApps().catch((e) => {
      step('store', 'error', { text: t('scan.failedStep', { msg: e.message.slice(0, 120) }) });
      return [];
    }),
  ]);

  const { steam, epic } = await gamesPromise;
  // jogos que também aparecem no registro: fica só a carta da Steam/Epic
  const launcherLocs = new Set([...steam, ...epic].map((g) => g.location.toLowerCase().replace(/\\+$/, '')));
  const apps = programs.filter((p) => !(p.location && launcherLocs.has(p.location.toLowerCase().replace(/\\+$/, ''))));
  const otherGames = apps.filter((p) => p.isGame).length;
  step('games', 'done', {
    text: t('scan.gamesDone', { steam: steam.length, epic: epic.length, other: otherGames }),
  });

  const folders = await scanFolders(apps);
  return { items: [...steam, ...epic, ...apps, ...store, ...folders], prefetchAvailable: prefetch.available };
}

async function clean(dir) {
  let entries;
  try {
    entries = await fsp.readdir(dir);
  } catch {
    return { status: 'done', message: t('clean.missing') };
  }
  let kept = 0;
  await pool(entries, 8, async (name) => {
    try {
      await fsp.rm(path.join(dir, name), { recursive: true, force: true, maxRetries: 1 });
    } catch {
      kept++;
    }
  });
  return {
    status: 'done',
    message: kept ? t('clean.partial', { n: kept }) : t('clean.done'),
  };
}

(async () => {
  try {
    const result = opts.task === 'clean' ? await clean(opts.path) : await scan();
    post({ type: 'result', result });
  } catch (e) {
    post({ type: 'error', message: e.message });
  }
})();
