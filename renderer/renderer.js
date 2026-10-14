// Swipe Clean — interface (resumo, cartas, revisão, progresso e configurações)
// Tudo fica dentro de uma função para nenhum nome colidir com variáveis globais da janela.
(() => {
'use strict';

const api = window.swipeApi;
const logToFile = (t) => {
  try {
    if (api && api.log) api.log(t);
  } catch {}
};
window.addEventListener('error', (e) => logToFile(`Erro: ${e.message} (${e.filename}:${e.lineno})`));
window.addEventListener('unhandledrejection', (e) => logToFile('Promise rejeitada: ' + ((e.reason && e.reason.stack) || e.reason)));
const DEMO = !api || api.platform !== 'win32';
const $ = (s) => document.querySelector(s);

const state = {
  items: [],
  decided: new Map(), // id -> 'keep' | 'remove'
  history: [], // ids na ordem em que foram decididos
  front: null, // id que deve voltar ao topo (desfazer)
  cat: 'games',
  kept: {}, // decisões "manter" salvas entre sessões
  settings: { onlineCovers: true, showKept: false },
  info: { version: '', admin: false },
  donate: { enabled: false },
  donateIdx: 0,
  disk: null,
  prefetchAvailable: true,
  maxSize: 1,
  animating: false,
};

// ---------------------------------------------------------------- formatação

const nf = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
function fmtBytes(b) {
  if (!b) return { n: '?', u: '' };
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (b >= 1024 && i < units.length - 1) {
    b /= 1024;
    i++;
  }
  return { n: nf.format(b), u: units[i] };
}
const bytes = (b) => {
  const f = fmtBytes(b);
  return f.u ? `${f.n} ${f.u}` : 'tamanho desconhecido';
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function fmtInstallDate(s) {
  if (!s || !/^\d{8}$/.test(s)) return null;
  return `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`;
}
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString('pt-BR') : null);
function ago(ms) {
  if (!ms) return null;
  const d = Math.floor((Date.now() - ms) / 86400000);
  if (d <= 0) return 'hoje';
  if (d === 1) return 'ontem';
  if (d < 30) return `há ${d} dias`;
  const m = Math.floor(d / 30);
  if (m < 12) return `há ${m} ${m === 1 ? 'mês' : 'meses'}`;
  const y = Math.floor(d / 365);
  return `há ${y} ${y === 1 ? 'ano' : 'anos'}`;
}
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shortPath = (p) => {
  if (!p) return '—';
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length > 2 ? '…\\' + parts.slice(-2).join('\\') : p;
};
const OLD = 90 * 86400000;

// ---------------------------------------------------------------- categorias e tipos

const CATS = {
  games: { label: 'Jogos', emoji: '🎮', empty: 'Nenhum jogo encontrado.' },
  apps: { label: 'Aplicativos', emoji: '🧩', empty: 'Nenhum aplicativo encontrado.' },
  folders: { label: 'Pastas grandes', emoji: '📁', empty: 'Nenhuma pasta grande encontrada.' },
};
const CAT_ORDER = ['games', 'apps', 'folders'];

const catOf = (it) => (it.kind === 'game' || it.isGame ? 'games' : it.kind === 'program' || it.kind === 'store' ? 'apps' : 'folders');

const PLATFORM = {
  steam: { label: 'Steam', action: 'Abre a desinstalação na Steam' },
  epic: { label: 'Epic Games', action: 'Abre a Epic para você desinstalar' },
  pc: { label: 'PC', action: 'Abre o desinstalador oficial' },
};
const platformOf = (it) => (it.kind === 'game' ? it.platform : 'pc');

const KIND = {
  game: { label: 'Jogo', emoji: '🎮' },
  program: { label: 'Programa', emoji: '🧩', action: 'Abre o desinstalador oficial' },
  store: { label: 'App da Microsoft Store', emoji: '🛍️', action: 'Desinstala o app da Store' },
  temp: { label: 'Arquivos temporários', emoji: '🧹', action: 'Apaga o conteúdo (é recriado quando preciso)' },
  cache: { label: 'Cache', emoji: '♻️', action: 'Apaga o conteúdo (é recriado quando preciso)' },
  download: { label: 'Downloads', emoji: '⬇️', action: 'Move para a Lixeira' },
  user: { label: 'Arquivo pessoal', emoji: '🗂️', action: 'Move para a Lixeira' },
  appdata: { label: 'Dados de aplicativo', emoji: '🗃️', action: 'Move para a Lixeira' },
};
const actionOf = (it) => (catOf(it) === 'games' ? PLATFORM[platformOf(it)].action : KIND[it.kind].action);
const kindLabel = (it) =>
  catOf(it) === 'games' ? (it.kind === 'game' ? `Jogo · ${PLATFORM[it.platform].label}` : 'Jogo') : KIND[it.kind].label;

const iconHTML = (it) => {
  if (it.cover) return `<img class="thumb-cover" src="${it.cover}" alt="" />`;
  if (it.icon) return `<img src="${it.icon}" alt="" />`;
  if (catOf(it) === 'games') return fallbackCover(it);
  return it.isDir === false && it.kind !== 'temp' ? '📄' : KIND[it.kind].emoji;
};

// capa genérica quando não há imagem: gradiente estável por nome + iniciais
function hueOf(s) {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
function initials(name) {
  const words = String(name)
    .replace(/[™®©:]/g, '')
    .split(/[\s\-_]+/)
    .filter((w) => /[a-z0-9]/i.test(w) && !/^(de|da|do|das|dos|e|of|the|a|o|and|&)$/i.test(w));
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2)).toUpperCase();
}
function fallbackCover(it) {
  const h = hueOf(it.name);
  return `<div class="cover-fallback" style="--h1:${h};--h2:${(h + 50) % 360}"><span>${esc(initials(it.name))}</span></div>`;
}

// só conta para a barra do disco o que está na mesma unidade do Windows
const onSystemDrive = (it) => {
  const p = it.path || it.location;
  if (!p || !state.disk) return true;
  return p.slice(0, 2).toUpperCase() === state.disk.root.slice(0, 2).toUpperCase();
};

// ---------------------------------------------------------------- telas e topo

function show(name) {
  document.querySelectorAll('.screen').forEach((s) => (s.hidden = s.id !== 'screen-' + name));
}

const removeList = () => state.items.filter((it) => state.decided.get(it.id) === 'remove');

function updateTop() {
  const d = state.disk;
  const queue = removeList();
  const pendingBytes = queue.reduce((a, b) => a + (b.size || 0), 0);
  const pendingSys = queue.filter(onSystemDrive).reduce((a, b) => a + (b.size || 0), 0);
  if (d && d.total) {
    const used = d.total - d.free;
    $('#diskLabel').textContent = `Disco ${d.root.replace(/\\$/, '')}`;
    $('#diskFree').textContent = `${bytes(d.free)} livres de ${bytes(d.total)}`;
    $('#diskUsed').style.width = `${(Math.max(0, used - pendingSys) / d.total) * 100}%`;
    $('#diskPending').style.width = `${(Math.min(pendingSys, used) / d.total) * 100}%`;
  }
  const pill = $('#queuePill');
  pill.hidden = queue.length === 0;
  pill.textContent = `🗑 ${plural(queue.length, 'item', 'itens')} · ${bytes(pendingBytes)} → Revisar`;
}

// ---------------------------------------------------------------- resumo

// o que foi mantido em análises anteriores some (a não ser que a configuração peça);
// o que foi decidido nesta sessão continua contando
function visible(it) {
  return state.settings.showKept || !state.kept[it.id] || state.decided.has(it.id);
}

function renderSummary() {
  const total = state.items.filter(visible);
  const totalBytes = total.reduce((a, b) => a + (b.size || 0), 0);
  $('#summaryTitle').textContent = `Encontrei ${plural(total.length, 'item', 'itens')}`;
  const hiddenKept = state.items.length - total.length;
  $('#summarySub').textContent =
    `${bytes(totalBytes)} no total. Escolha por onde começar.` +
    (hiddenKept ? ` (${plural(hiddenKept, 'item que você já manteve está oculto', 'itens que você já manteve estão ocultos')})` : '');

  $('#tiles').innerHTML = CAT_ORDER.map((c) => {
    const all = total.filter((it) => catOf(it) === c);
    const left = all.filter((it) => !state.decided.has(it.id));
    const size = all.reduce((a, b) => a + (b.size || 0), 0);
    const top = [...all].sort((a, b) => (b.size || 0) - (a.size || 0)).slice(0, 3);
    let preview = '';
    if (c === 'games') {
      preview = `<div class="tile-covers">${top
        .map((g, i) => `<div class="tc tc${i}">${g.cover ? `<img src="${g.cover}" alt="" />` : fallbackCover(g)}</div>`)
        .join('')}</div>`;
    } else {
      preview = `<div class="tile-icons">${top.map((it) => `<div class="icon">${iconHTML(it)}</div>`).join('')}</div>`;
    }
    const done = all.length && !left.length;
    return `<button class="tile ${all.length ? '' : 'empty'}" data-cat="${c}" ${all.length ? '' : 'disabled'}>
      <div class="tile-preview">${all.length ? preview : `<div class="tile-none">${CATS[c].emoji}</div>`}</div>
      <div class="tile-body">
        <div class="tile-title">${CATS[c].emoji} ${CATS[c].label}</div>
        <div class="tile-size">${all.length ? bytes(size) : '—'}</div>
        <div class="tile-count">${
          all.length ? (done ? 'Tudo analisado ✓' : `${plural(left.length, 'carta', 'cartas')} para deslizar`) : CATS[c].empty
        }</div>
        <ul class="tile-top">${top.map((it) => `<li><span>${esc(it.name)}</span><b>${bytes(it.size)}</b></li>`).join('')}</ul>
      </div>
      <div class="tile-cta">${all.length ? (done ? 'Rever' : 'Começar →') : ''}</div>
    </button>`;
  }).join('');
  $('#tiles')
    .querySelectorAll('.tile:not(.empty)')
    .forEach((t) => t.addEventListener('click', () => openDeck(t.dataset.cat)));
  updateTop();
}

function openDeck(cat) {
  state.cat = cat;
  state.front = null;
  show('deck');
  renderDeck();
}

// ---------------------------------------------------------------- baralho

function pending(cat = state.cat) {
  const list = state.items.filter((it) => !state.decided.has(it.id) && visible(it) && catOf(it) === cat);
  if (state.front) {
    const i = list.findIndex((x) => x.id === state.front);
    if (i > 0) list.unshift(list.splice(i, 1)[0]);
  }
  return list;
}

function renderTabs() {
  $('#tabs').innerHTML = CAT_ORDER.map((c) => {
    const n = pending(c).length;
    return `<button data-cat="${c}" class="${c === state.cat ? 'on' : ''}">${CATS[c].emoji} ${CATS[c].label}<span class="badge">${n}</span></button>`;
  }).join('');
  $('#tabs')
    .querySelectorAll('button')
    .forEach((b) =>
      b.addEventListener('click', () => {
        state.cat = b.dataset.cat;
        state.front = null;
        renderDeck();
      })
    );
}

function facts(it) {
  const f = [];
  const c = catOf(it);
  if (c === 'games') {
    if (it.kind === 'game' && it.platform === 'steam') {
      if (it.lastUsed) f.push(['Último jogo', ago(it.lastUsed), Date.now() - it.lastUsed > OLD]);
      else f.push(['Último jogo', it.neverPlayed ? 'Nunca jogado' : 'Sem registro', !!it.neverPlayed]);
      f.push(['Atualizado', fmtDate(it.updated) || '—']);
    } else {
      const used = ago(it.lastUsed);
      f.push(['Último jogo', used || (state.prefetchAvailable ? 'Sem registro' : 'Abra como admin'), it.lastUsed && Date.now() - it.lastUsed > OLD]);
      f.push(['Instalado', fmtInstallDate(it.installDate) || fmtDate(it.installed) || '—']);
    }
    f.push(['Plataforma', PLATFORM[platformOf(it)].label]);
    f.push(['Pasta', shortPath(it.location)]);
  } else if (c === 'apps') {
    f.push(['Instalado em', fmtInstallDate(it.installDate) || '—']);
    let used = ago(it.lastUsed);
    if (!used) used = it.kind === 'store' ? 'Sem registro' : state.prefetchAvailable ? 'Sem registro' : 'Abra como admin';
    f.push(['Último uso', used, it.lastUsed && Date.now() - it.lastUsed > OLD]);
    f.push(['Versão', it.version || '—']);
    f.push(['Editora', it.publisher || '—']);
  } else {
    if (it.modified) f.push(['Modificado', ago(it.modified), Date.now() - it.modified > OLD]);
    else if (it.kind === 'appdata') f.push(['Programa', it.matchedProgram || 'Nenhum instalado']);
    else f.push(['Seguro apagar?', 'Sim, é recriado']);
    f.push(['Onde', shortPath(it.path)]);
  }
  return f;
}

function notesOf(it) {
  let warn = '';
  let note = '';
  if (it.kind === 'program' && it.risky) warn = 'Pode ser necessário para outros programas ou para o Windows. Na dúvida, mantenha.';
  if (it.kind === 'store' && it.risky) warn = 'Componente da Microsoft usado por outros apps. Na dúvida, mantenha.';
  if (it.kind === 'appdata') {
    if (it.matchedProgram) warn = `“${it.matchedProgram}” ainda está instalado. Apagar estes dados pode zerar as configurações dele.`;
    else note = 'Nenhum programa instalado com esse nome. Pode ser sobra de algo que você já desinstalou.';
  }
  if ((it.kind === 'cache' || it.kind === 'temp') && it.detail) note = it.detail;
  if (it.kind === 'store' && !it.size) note = 'O Windows não deixa medir o tamanho de apps da Store.';
  if (it.kind === 'game' && it.platform === 'epic') note = 'A remoção é feita pela própria Epic Games, que vai abrir para você.';
  return { warn, note };
}

function sizeBlock(it) {
  const size = fmtBytes(it.size);
  const ratio = it.size ? Math.max(0.03, Math.log10(it.size / 1e6 + 1) / Math.log10(state.maxSize / 1e6 + 1)) : 0;
  return `<div class="size-block">
      <div class="size">${size.n}<small>${size.u}</small></div>
      <div class="size-bar"><div style="width:${ratio * 100}%"></div></div>
      ${state.disk && it.size && onSystemDrive(it) ? `<div class="size-note">${nf.format((it.size / state.disk.total) * 100)}% do disco</div>` : ''}
    </div>`;
}

function factsHTML(it) {
  return `<div class="facts">${facts(it)
    .map(([l, v, old]) => `<div class="fact"><span>${l}</span><b class="${old ? 'old' : ''}" title="${esc(v)}">${esc(v)}</b></div>`)
    .join('')}</div>`;
}

function cardHTML(it, cls) {
  const { warn, note } = notesOf(it);
  const canOpen = it.path || it.location;
  const stamps = `<div class="tint"></div><div class="stamp keep">MANTER</div><div class="stamp remove">REMOVER</div>`;
  const foot = `<div class="card-foot">
      <span class="action-label">Se remover: ${esc(actionOf(it))}</span>
      ${canOpen ? `<button class="link" data-open="${esc(it.id)}">Abrir local ↗</button>` : ''}
    </div>`;

  if (catOf(it) === 'games') {
    const art = it.cover
      ? it.coverPortrait === false
        ? `<div class="cover-blur" style="background-image:url('${it.cover}')"></div><img class="cover-img wide" src="${it.cover}" alt="" />`
        : `<img class="cover-img" src="${it.cover}" alt="" />`
      : fallbackCover(it);
    return `<div class="card game ${cls}" data-id="${esc(it.id)}">
      ${stamps}
      <div class="cover">
        ${art}
        <span class="platform ${platformOf(it)}">${PLATFORM[platformOf(it)].label}</span>
        <div class="cover-title"><div class="name" title="${esc(it.name)}">${esc(it.name)}</div></div>
      </div>
      <div class="game-body">
        ${sizeBlock(it)}
        ${factsHTML(it)}
        ${warn ? `<div class="warn">⚠ ${esc(warn)}</div>` : ''}
        ${note ? `<div class="note">${esc(note)}</div>` : ''}
        ${foot}
      </div>
    </div>`;
  }

  return `<div class="card ${cls}" data-id="${esc(it.id)}">
    ${stamps}
    <div class="card-top">
      <div class="icon">${iconHTML(it)}</div>
      <div style="min-width:0">
        <div class="kind">${esc(kindLabel(it))}</div>
        <div class="name" title="${esc(it.name)}">${esc(it.name)}</div>
        ${catOf(it) === 'apps' ? `<div class="publisher">${esc(it.publisher || '')}</div>` : ''}
      </div>
    </div>
    ${sizeBlock(it)}
    ${factsHTML(it)}
    ${warn ? `<div class="warn">⚠ ${esc(warn)}</div>` : ''}
    ${note ? `<div class="note">${esc(note)}</div>` : ''}
    ${foot}
  </div>`;
}

function renderDeck() {
  renderTabs();
  const list = pending();
  const stack = $('#stack');
  stack.innerHTML = list
    .slice(0, 3)
    .map((it, i) => cardHTML(it, ['top', 'behind1', 'behind2'][i]))
    .reverse()
    .join('');

  const allInCat = state.items.filter((it) => visible(it) && catOf(it) === state.cat).length;
  const done = allInCat - list.length;
  $('#counter').textContent = list.length ? `${done + 1} de ${allInCat}` : '';
  $('#deckEmpty').hidden = list.length > 0;
  if (!list.length) {
    const q = removeList();
    $('#emptyTitle').textContent = allInCat ? `${CATS[state.cat].label}: tudo analisado` : CATS[state.cat].empty;
    $('#emptyText').textContent = q.length
      ? `Na fila para remover: ${plural(q.length, 'item', 'itens')} (${bytes(q.reduce((a, b) => a + (b.size || 0), 0))}).`
      : 'Nada marcado para remover até agora.';
    const next = CAT_ORDER.find((c) => c !== state.cat && pending(c).length);
    $('#emptyActions').innerHTML =
      (next ? `<button class="ghost" data-go="${next}">Ir para ${CATS[next].label} →</button>` : '') +
      (q.length ? `<button class="primary" id="emptyReviewBtn">Revisar remoções</button>` : '');
    $('#emptyActions')
      .querySelectorAll('[data-go]')
      .forEach((b) => b.addEventListener('click', () => openDeck(b.dataset.go)));
    const rb = $('#emptyReviewBtn');
    if (rb) rb.addEventListener('click', openReview);
  }
  $('#noBtn').disabled = $('#yesBtn').disabled = list.length === 0;
  $('#undoBtn').disabled = state.history.length === 0;

  const topCard = stack.querySelector('.card.top');
  if (topCard) attachDrag(topCard);
  stack.querySelectorAll('[data-open]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!DEMO) api.openLocation(b.dataset.open);
    })
  );
  updateTop();
}

function setStamps(card, dx) {
  const p = Math.min(1, Math.abs(dx) / 120);
  card.querySelector('.stamp.keep').style.opacity = dx > 0 ? p : 0;
  card.querySelector('.stamp.remove').style.opacity = dx < 0 ? p : 0;
  const tint = card.querySelector('.tint');
  tint.style.opacity = p * 0.18;
  tint.style.background = dx < 0 ? 'var(--red)' : 'var(--green)';
}

function attachDrag(card) {
  let sx = 0, sy = 0, dx = 0, dy = 0, t0 = 0, dragging = false;
  card.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button') || state.animating) return;
    dragging = true;
    sx = e.clientX;
    sy = e.clientY;
    t0 = performance.now();
    card.setPointerCapture(e.pointerId);
    card.style.transition = 'none';
  });
  card.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    dx = e.clientX - sx;
    dy = e.clientY - sy;
    card.style.transform = `translate(${dx}px, ${dy * 0.25}px) rotate(${dx / 16}deg)`;
    setStamps(card, dx);
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    const v = Math.abs(dx) / Math.max(1, performance.now() - t0);
    if (Math.abs(dx) > 120 || (Math.abs(dx) > 50 && v > 0.6)) {
      decide(dx < 0 ? 'remove' : 'keep', dx, dy);
    } else {
      card.style.transition = '';
      card.style.transform = '';
      setStamps(card, 0);
    }
    dx = dy = 0;
  };
  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', end);
}

function decide(dir, fromX = 0, fromY = 0) {
  const it = pending()[0];
  const card = $('#stack .card.top');
  if (!it || !card || state.animating) return;
  state.animating = true;

  const sign = dir === 'remove' ? -1 : 1;
  if (!fromX) setStamps(card, sign * 120);
  card.style.transition = 'transform .35s ease-in, opacity .35s ease-in';
  card.style.transform = `translate(${sign * 700}px, ${fromY * 0.25 + 40}px) rotate(${sign * 30}deg)`;
  card.style.opacity = '0';

  const b1 = $('#stack .card.behind1');
  if (b1) {
    b1.style.transform = 'none';
    b1.style.opacity = '1';
  }

  setTimeout(() => {
    state.decided.set(it.id, dir);
    state.history.push(it.id);
    state.front = null;
    if (dir === 'keep') state.kept[it.id] = Date.now();
    saveDecisions();
    state.animating = false;
    renderDeck();
  }, 300);
}

function undo() {
  if (state.animating) return;
  const id = state.history.pop();
  if (!id) return;
  state.decided.delete(id);
  delete state.kept[id];
  saveDecisions();
  const it = state.items.find((x) => x.id === id);
  if (it) state.cat = catOf(it);
  state.front = id;
  renderDeck();
}

let saveTimer = null;
function saveDecisions() {
  if (DEMO) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => api.saveDecisions({ kept: state.kept }), 400);
}

// ---------------------------------------------------------------- análise

const STEPS = [
  ['usage', 'Histórico de uso'],
  ['programs', 'Programas instalados'],
  ['store', 'Apps da Microsoft Store'],
  ['games', 'Jogos (Steam, Epic e outros)'],
  ['caches', 'Temporários e caches'],
  ['personal', 'Downloads e pastas pessoais'],
  ['appdata', 'Dados de aplicativos'],
  ['covers', 'Capas dos jogos'],
  ['icons', 'Ícones dos programas'],
];
let scanTimer = null;
let scanBusy = false;

function resetSteps() {
  $('#steps').innerHTML = STEPS.map(
    ([id, label]) =>
      `<li class="pending" data-step="${id}"><span class="st-icon"></span><span class="st-label">${label}</span><span class="st-text"></span></li>`
  ).join('');
  document.querySelectorAll('.scan-error').forEach((e) => e.remove());
  $('#scanBar').style.width = '3%';
  $('#scanDetail').innerHTML = '&nbsp;';
  const t0 = Date.now();
  $('#scanElapsed').textContent = '0:00';
  clearInterval(scanTimer);
  scanTimer = setInterval(() => {
    const s = Math.floor((Date.now() - t0) / 1000);
    $('#scanElapsed').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 1000);
}

const shortenDetail = (p) => (p.length > 70 ? '…' + p.slice(-69) : p);

function onScanProgress(m) {
  if (m.detail) $('#scanDetail').textContent = shortenDetail(m.detail);
  if (!m.step) return;
  const li = document.querySelector(`#steps li[data-step="${m.step}"]`);
  if (!li) return;
  li.className = m.status + (m.warn ? ' warn' : '');
  if (m.text != null) li.querySelector('.st-text').textContent = m.text;
  const lis = [...document.querySelectorAll('#steps li')];
  const score = lis.reduce(
    (a, l) => a + (l.classList.contains('done') || l.classList.contains('error') ? 1 : l.classList.contains('active') ? 0.5 : 0),
    0
  );
  $('#scanBar').style.width = `${Math.max(3, (score / lis.length) * 100)}%`;
}

const nextPaint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function demoScan() {
  const plan = [
    ['usage', '512 registros', ['C:\\Windows\\Prefetch']],
    ['programs', '86 encontrados', ['C:\\Program Files\\Adobe']],
    ['store', '14 encontrados', ['C:\\Program Files\\WindowsApps']],
    ['games', '3 Steam · 1 Epic · 1 outros', ['C:\\Program Files (x86)\\Steam\\steamapps']],
    ['caches', '3 com espaço para liberar', ['C:\\Users\\Gabriel\\AppData\\Local\\npm-cache\\_cacache']],
    ['personal', '2 itens grandes', ['C:\\Users\\Gabriel\\Downloads']],
    ['appdata', '1 pasta grande', ['C:\\Users\\Gabriel\\AppData\\Roaming\\Unity']],
    ['covers', '4 de 5 com capa', []],
    ['icons', '84 carregados', []],
  ];
  for (const [id, done, details] of plan) {
    onScanProgress({ step: id, status: 'active', text: '' });
    for (const d of details) {
      onScanProgress({ detail: d });
      await wait(160);
    }
    await wait(120);
    onScanProgress({ step: id, status: 'done', text: done });
  }
  await wait(200);
  return { items: structuredClone(window.DEMO_DATA), prefetchAvailable: true };
}

async function startScan() {
  logToFile('Clique em analisar' + (scanBusy ? ' (ignorado: já analisando)' : ''));
  if (scanBusy) return;
  scanBusy = true;
  const btns = [$('#startBtn'), $('#againBtn'), $('#rescanBtn')];
  btns.forEach((b) => {
    b.disabled = true;
    b.dataset.label = b.textContent;
    b.innerHTML = '<span class="spin-sm"></span>Preparando…';
  });
  resetSteps();
  show('scan');
  await nextPaint();
  try {
    let result;
    if (DEMO) {
      result = await demoScan();
    } else {
      result = await api.scan();
      state.disk = await api.diskInfo();
    }
    state.items = result.items.sort((a, b) => (b.size || 0) - (a.size || 0));
    state.prefetchAvailable = result.prefetchAvailable;
    state.maxSize = Math.max(1, ...state.items.map((i) => i.size || 0));
    state.decided.clear();
    state.history = [];
    state.front = null;
    const counts = CAT_ORDER.map((c) => `${c}=${state.items.filter((i) => catOf(i) === c).length}`).join(' ');
    logToFile(`Resumo: ${counts}, com capa=${state.items.filter((i) => i.cover).length}`);
    show('summary');
    renderSummary();
  } catch (e) {
    logToFile('Análise falhou na tela: ' + (e.message || e));
    const msg = String(e.message || e).replace(/^Error invoking remote method 'scan': (Error: )?/, '');
    $('#scanDetail').textContent = '';
    $('#scanDetail').insertAdjacentHTML(
      'afterend',
      `<div class="warn scan-error">Não foi possível terminar a análise: ${esc(msg)}<br/><button class="ghost" style="margin-top:10px">Voltar ao início</button></div>`
    );
    document.querySelector('.scan-error button').onclick = () => {
      document.querySelector('.scan-error').remove();
      show('home');
    };
  } finally {
    clearInterval(scanTimer);
    scanBusy = false;
    btns.forEach((b) => {
      b.disabled = false;
      b.textContent = b.dataset.label;
    });
  }
}

// ---------------------------------------------------------------- revisão

function openReview() {
  const list = removeList();
  if (!list.length) return;
  $('#reviewList').innerHTML = CAT_ORDER.map((c) => {
    const group = list.filter((it) => catOf(it) === c);
    if (!group.length) return '';
    const size = group.reduce((a, b) => a + (b.size || 0), 0);
    return `<div class="group-head">${CATS[c].emoji} ${CATS[c].label}<span>${plural(group.length, 'item', 'itens')} · ${bytes(size)}</span></div>` +
      group
        .map((it) => {
          const act = actionOf(it);
          let sub = kindLabel(it) + ' · ' + act.charAt(0).toLowerCase() + act.slice(1);
          let warnCls = '';
          if (it.risky || it.matchedProgram) {
            sub = '⚠ ' + (it.matchedProgram ? `“${it.matchedProgram}” ainda está instalado` : 'Pode ser necessário para outros programas');
            warnCls = 'warn-text';
          }
          return `<label class="item">
            <input type="checkbox" checked data-id="${esc(it.id)}" />
            <div class="icon ${catOf(it) === 'games' ? 'has-cover' : ''}">${iconHTML(it)}</div>
            <div class="item-main"><div class="item-name">${esc(it.name)}</div><div class="item-sub ${warnCls}">${esc(sub)}</div></div>
            <div class="item-size">${bytes(it.size)}</div>
          </label>`;
        })
        .join('');
  }).join('');
  $('#reviewList').querySelectorAll('input').forEach((c) => c.addEventListener('change', updateReviewTotal));
  updateReviewTotal();
  show('review');
}

function selectedForRemoval() {
  const ids = new Set([...$('#reviewList').querySelectorAll('input:checked')].map((c) => c.dataset.id));
  return state.items.filter((it) => ids.has(it.id));
}

function updateReviewTotal() {
  const sel = selectedForRemoval();
  const total = sel.reduce((a, b) => a + (b.size || 0), 0);
  $('#reviewTotal').innerHTML = `<b>${bytes(total)}</b> em ${plural(sel.length, 'item', 'itens')}`;
  $('#confirmBtn').disabled = sel.length === 0;
  $('#confirmBtn').textContent = sel.length ? `Remover ${plural(sel.length, 'item', 'itens')}` : 'Remover';
}

function askConfirm(text, { title = 'Confirmar remoção', ok = 'Sim, remover' } = {}) {
  return new Promise((resolve) => {
    $('#modalTitle').textContent = title;
    $('#modalOk').textContent = ok;
    $('#modalText').textContent = text;
    $('#modal').hidden = false;
    const done = (v) => {
      $('#modal').hidden = true;
      $('#modalOk').onclick = $('#modalCancel').onclick = null;
      resolve(v);
    };
    $('#modalOk').onclick = () => done(true);
    $('#modalCancel').onclick = () => done(false);
  });
}

async function confirmRemoval() {
  const sel = selectedForRemoval();
  if (!sel.length) return;
  const n = (f) => sel.filter(f).length;
  const lines = [];
  const steam = n((i) => i.kind === 'game' && i.platform === 'steam');
  const epic = n((i) => i.kind === 'game' && i.platform === 'epic');
  const progs = n((i) => i.kind === 'program');
  const store = n((i) => i.kind === 'store');
  const trash = n((i) => ['download', 'user', 'appdata'].includes(i.kind));
  const wipe = n((i) => ['cache', 'temp'].includes(i.kind));
  if (steam) lines.push(`• ${plural(steam, 'jogo da Steam', 'jogos da Steam')}: a Steam vai pedir confirmação de cada um.`);
  if (epic) lines.push(`• ${plural(epic, 'jogo da Epic', 'jogos da Epic')}: a Epic vai abrir para você desinstalar.`);
  if (progs) lines.push(`• ${plural(progs, 'programa', 'programas')}: o desinstalador de cada um vai abrir, um de cada vez.`);
  if (store) lines.push(`• ${plural(store, 'app da Store será desinstalado', 'apps da Store serão desinstalados')}.`);
  if (trash) lines.push(`• ${plural(trash, 'arquivo/pasta vai', 'arquivos/pastas vão')} para a Lixeira (dá para recuperar).`);
  if (wipe) lines.push(`• ${plural(wipe, 'cache/temporário será apagado', 'caches/temporários serão apagados')} de vez.`);
  const ok = await askConfirm(lines.join('\n') + `\n\nTotal estimado: ${bytes(sel.reduce((a, b) => a + (b.size || 0), 0))}.`);
  if (ok) runRemoval(sel);
}

// ---------------------------------------------------------------- remoção

const STATUS_LABEL = { queued: 'Na fila', running: 'Removendo', waiting: 'Aguardando você', done: 'Concluído', error: 'Erro', skipped: 'Pulado' };

function setRowStatus(d) {
  const row = document.querySelector(`#removeList .item[data-id="${CSS.escape(d.id)}"]`);
  if (!row) return;
  const st = row.querySelector('.status');
  st.className = 'status ' + d.status;
  st.textContent = STATUS_LABEL[d.status] || d.status;
  if (d.message) row.querySelector('.item-sub').textContent = d.message;
  row.classList.toggle('current', d.status === 'running' || d.status === 'waiting');
  if (d.status === 'running' || d.status === 'waiting') row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  $('#skipBtn').hidden = !d.canSkip;
}

async function runRemoval(sel) {
  const order = { temp: 0, cache: 1, download: 2, user: 2, appdata: 3, store: 4, program: 5, game: 6 };
  sel = [...sel].sort((a, b) => order[a.kind] - order[b.kind]);
  $('#removeTitle').textContent = 'Removendo…';
  $('#removeSub').textContent = 'Não feche o app enquanto isso acontece.';
  $('#removeFoot').hidden = true;
  $('#donateStrip').hidden = true;
  $('#removeList').innerHTML = sel
    .map(
      (it) => `<div class="item" data-id="${esc(it.id)}">
        <div class="icon ${catOf(it) === 'games' ? 'has-cover' : ''}">${iconHTML(it)}</div>
        <div class="item-main"><div class="item-name">${esc(it.name)}</div><div class="item-sub">${bytes(it.size)}</div></div>
        <span class="status queued">Na fila</span>
      </div>`
    )
    .join('');
  $('#queuePill').hidden = true;
  show('remove');

  let result;
  if (DEMO) {
    const results = [];
    for (const it of sel) {
      setRowStatus({ id: it.id, status: 'running', message: 'Removendo…' });
      await wait(500);
      const r = { id: it.id, status: 'done', message: 'Concluído (simulação)', trashed: ['download', 'user', 'appdata'].includes(it.kind) };
      setRowStatus(r);
      results.push(r);
    }
    result = { results, freed: sel.filter((i) => !results.find((r) => r.id === i.id).trashed).reduce((a, b) => a + (b.size || 0), 0) };
    state.disk = { ...state.disk, free: state.disk.free + result.freed };
  } else {
    result = await api.remove(sel.map((i) => i.id));
    if (result.disk) state.disk = result.disk;
  }

  $('#skipBtn').hidden = true;
  const ok = result.results.filter((r) => r.status === 'done').length;
  const trashedBytes = result.results.filter((r) => r.trashed).reduce((a, r) => a + (sel.find((i) => i.id === r.id)?.size || 0), 0);
  $('#removeTitle').textContent = `Pronto! ${ok} de ${plural(sel.length, 'item removido', 'itens removidos')}`;
  $('#removeSub').textContent = trashedBytes
    ? `Para liberar mais ${bytes(trashedBytes)}, esvazie a Lixeira quando tiver certeza.`
    : 'Jogos em outros discos liberam espaço lá, não no disco do sistema.';
  const drive = state.disk ? state.disk.root.replace(/\\$/, '') : '';
  $('#removeTotal').innerHTML =
    result.freed >= 1024 * 1024
      ? `<b>${bytes(result.freed)}</b> liberados no disco ${drive}`
      : trashedBytes
        ? `<b>${bytes(trashedBytes)}</b> na Lixeira`
        : `Nenhum espaço liberado no disco ${drive}`;
  $('#removeFoot').hidden = false;
  $('#donateStrip').hidden = !(state.donate.enabled && ok > 0);
  if (ok > 0) $('#donateStripTitle').textContent = result.freed > 0 ? `Você liberou ${bytes(result.freed)}! Gostou?` : 'Gostou do resultado?';

  const doneIds = new Set(result.results.filter((r) => r.status === 'done').map((r) => r.id));
  state.items = state.items.filter((i) => !doneIds.has(i.id));
  // o que não foi removido volta para as cartas
  for (const id of [...state.decided.keys()]) if (state.decided.get(id) === 'remove') state.decided.delete(id);
  updateTop();
}

// ---------------------------------------------------------------- configurações

function renderSettings() {
  $('#optCovers').checked = !!state.settings.onlineCovers;
  $('#optShowKept').checked = !!state.settings.showKept;
  const nKept = Object.keys(state.kept).length;
  $('#keptInfo').textContent = nKept
    ? `${plural(nKept, 'item que você manteve não aparece', 'itens que você manteve não aparecem')} nas novas análises.`
    : 'Nenhum item mantido ainda.';
  $('#clearKeptBtn').disabled = !nKept;
  $('#adminInfo').textContent = DEMO
    ? 'Indisponível no modo demonstração.'
    : state.info.admin
      ? 'Rodando como administrador ✓ (o último uso dos aplicativos aparece).'
      : 'Sem permissão: o último uso dos aplicativos fica oculto. Jogos da Steam mostram mesmo assim.';
  $('#adminBtn').hidden = DEMO || state.info.admin;
  $('#donateSetting').hidden = !state.donate.enabled;
  $('#about').textContent = `Swipe Clean ${DEMO ? '(demonstração)' : 'v' + state.info.version} · seus dados ficam só no seu PC`;
}

async function setSetting(k, v) {
  state.settings[k] = v;
  if (!DEMO) state.settings = await api.setSettings({ [k]: v });
  if (k === 'showKept' && state.items.length) {
    if (!$('#screen-summary').hidden) renderSummary();
    if (!$('#screen-deck').hidden) renderDeck();
  }
  renderSettings();
}

async function relaunchAdmin() {
  if (DEMO) return;
  const ok = await askConfirm('O Swipe Clean vai fechar e abrir de novo com permissão de administrador. O Windows vai pedir sua confirmação.', {
    title: 'Reiniciar como administrador',
    ok: 'Reiniciar',
  });
  if (ok) await api.relaunchAdmin();
}


// ---------------------------------------------------------------- doação por Pix

function openDonate(where) {
  if (!state.donate.enabled) return;
  if (!DEMO) api.donateOpened(where);
  const opts = state.donate.options;
  // começa no valor do meio (ex.: R$ 10) quando houver valores sugeridos
  state.donateIdx = opts.length > 2 ? Math.min(2, opts.length - 1) : 0;
  $('#donateName').textContent = state.donate.name || '—';
  $('#donateKey').textContent = state.donate.key;
  renderDonate();
  $('#settings').hidden = true;
  $('#donate').hidden = false;
}

function renderDonate() {
  const opts = state.donate.options;
  const money = (v) => 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  $('#amounts').innerHTML = opts
    .map((o, i) => `<button data-i="${i}" class="${i === state.donateIdx ? 'on' : ''}">${o.amount ? money(o.amount) : 'Outro valor'}</button>`)
    .join('');
  $('#amounts')
    .querySelectorAll('button')
    .forEach((b) =>
      b.addEventListener('click', () => {
        state.donateIdx = Number(b.dataset.i);
        renderDonate();
      })
    );
  $('#donateQr').src = opts[state.donateIdx].qr;
  $('#copied').hidden = true;
}

async function copyText(text) {
  try {
    if (DEMO) await navigator.clipboard.writeText(text);
    else await api.copyText(text);
    $('#copied').hidden = false;
    setTimeout(() => ($('#copied').hidden = true), 2200);
  } catch {}
}

// ---------------------------------------------------------------- eventos

$('#startBtn').addEventListener('click', startScan);
$('#rescanBtn').addEventListener('click', startScan);
$('#againBtn').addEventListener('click', startScan);
$('#backSummaryBtn').addEventListener('click', () => {
  show('summary');
  renderSummary();
});
$('#toSummary').addEventListener('click', () => {
  show('summary');
  renderSummary();
});
$('#noBtn').addEventListener('click', () => decide('remove'));
$('#yesBtn').addEventListener('click', () => decide('keep'));
$('#undoBtn').addEventListener('click', undo);
$('#queuePill').addEventListener('click', openReview);
$('#backToDeck').addEventListener('click', () => {
  show('deck');
  renderDeck();
});
$('#confirmBtn').addEventListener('click', confirmRemoval);
$('#skipBtn').addEventListener('click', () => {
  if (!DEMO) api.skipCurrent();
  $('#skipBtn').hidden = true;
});

$('#settingsBtn').addEventListener('click', () => {
  renderSettings();
  $('#settings').hidden = false;
});
$('#settingsClose').addEventListener('click', () => ($('#settings').hidden = true));
$('#settings').addEventListener('click', (e) => {
  if (e.target.id === 'settings') $('#settings').hidden = true;
});
$('#optCovers').addEventListener('change', (e) => setSetting('onlineCovers', e.target.checked));
$('#optShowKept').addEventListener('change', (e) => setSetting('showKept', e.target.checked));
$('#clearKeptBtn').addEventListener('click', async () => {
  state.kept = {};
  if (!DEMO) await api.clearDecisions();
  renderSettings();
  if (!$('#screen-summary').hidden) renderSummary();
});
$('#openLogsBtn').addEventListener('click', () => !DEMO && api.openLogs());
$('#adminBtn').addEventListener('click', relaunchAdmin);
$('#adminBtnHome').addEventListener('click', relaunchAdmin);

$('#donateStripBtn').addEventListener('click', () => openDonate('resultado'));
$('#donateSettingBtn').addEventListener('click', () => openDonate('configuracoes'));
$('#donateClose').addEventListener('click', () => ($('#donate').hidden = true));
$('#donate').addEventListener('click', (e) => {
  if (e.target.id === 'donate') $('#donate').hidden = true;
});
$('#copyCodeBtn').addEventListener('click', () => copyText(state.donate.options[state.donateIdx].code));
$('#copyKeyBtn').addEventListener('click', () => copyText(state.donate.key));

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    $('#settings').hidden = true;
    $('#donate').hidden = true;
    return;
  }
  if ($('#screen-deck').hidden || !$('#modal').hidden || !$('#settings').hidden || !$('#donate').hidden) return;
  if (e.key === 'ArrowLeft') decide('remove');
  else if (e.key === 'ArrowRight') decide('keep');
  else if ((e.ctrlKey && e.key.toLowerCase() === 'z') || e.key === 'Backspace') undo();
  else if (['1', '2', '3'].includes(e.key)) openDeck(CAT_ORDER[Number(e.key) - 1]);
});

if (!DEMO) {
  api.onScanProgress(onScanProgress);
  api.onRemoveProgress(setRowStatus);
}

// ---------------------------------------------------------------- início

(async function init() {
  if (DEMO) {
    $('#demoBanner').hidden = false;
    state.disk = { root: 'C:\\', total: 476 * 1024 ** 3, free: 38 * 1024 ** 3 };
    state.info = { version: 'demo', admin: false };
    state.donate = window.DEMO_DONATE || { enabled: false };
  } else {
    const [disk, decisions, settings, info, donate] = await Promise.all([
      api.diskInfo(),
      api.getDecisions(),
      api.getSettings(),
      api.appInfo(),
      Promise.resolve()
        .then(() => api.donateInfo())
        .catch(() => ({ enabled: false })),
    ]);
    state.donate = donate || { enabled: false };
    state.disk = disk;
    state.kept = (decisions && decisions.kept) || {};
    state.settings = settings || state.settings;
    state.info = info || state.info;
    $('#adminNote').hidden = state.info.admin;
  }
  updateTop();
  if (api && api.autoScan) setTimeout(startScan, 500);
  logToFile(`Tela pronta (demo: ${DEMO ? 'sim' : 'não'}, admin: ${state.info.admin ? 'sim' : 'não'}, versão ${state.info.version})`);
})();
})();
