// ==========================================================
// DailyInBot — Real Games · app.js
// Data layer (Firebase RTDB read-only) + utils + renderers
// ==========================================================
const CONFIG = {
  FIREBASE_URL: 'https://dailyinbot-default-rtdb.firebaseio.com',
  PASSWORD_HASH: '2e014b2fbd7de75f3527cbd40028621025f0e2384a44f1bb06e86e5d3b5c5911',
};

const PALETTE = ['#22C9EF', '#EE3B8B', '#7ED321', '#FFD447', '#E24E3D'];
const ROLE_COLORS = { 'Developer': '#22C9EF', 'Arte3D': '#EE3B8B' };
const NO_ROLE = 'Time';

// ==========================================================
// AUTH
// ==========================================================
async function hashPassword(password) {
  const data = new TextEncoder().encode(password);
  const buffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function isAuthenticated() { return sessionStorage.getItem('dailybot_auth') === 'true'; }
function requireAuth() {
  if (!isAuthenticated()) { window.location.href = 'index.html'; return false; }
  return true;
}
function logout() {
  sessionStorage.removeItem('dailybot_auth');
  window.location.href = 'index.html';
}

// ==========================================================
// DATA
// ==========================================================
async function fetchPath(path) {
  const res = await fetch(`${CONFIG.FIREBASE_URL}/${path}.json`);
  if (!res.ok) throw new Error(`Erro ao buscar dados: ${res.status}`);
  return (await res.json()) || {};
}

let _lastData = null;

async function loadAllData() {
  const [usersData, reportsData, weekliesData, projectsData] = await Promise.all([
    fetchPath('users'),
    fetchPath('reports'),
    fetchPath('weeklies').catch(() => ({})),
    fetchPath('projects').catch(() => ({})),
  ]);
  _lastData = {
    users: usersData.users || [],
    reports: reportsData.reports || [],
    weeklies: weekliesData.weeklies || [],
    projects: projectsData.projects || [],
  };
  return _lastData;
}

// Escrita em fila: só funciona quando as regras do Firebase liberarem /queue/*.
// Até lá o Firebase responde 401 e mostramos aviso amigável.
async function queueWrite(queueName, data) {
  const res = await fetch(`${CONFIG.FIREBASE_URL}/queue/${queueName}.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...data, submittedAt: new Date().toISOString() }),
  });
  if (!res.ok) {
    const err = new Error('queue-denied');
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// ==========================================================
// UTILS
// ==========================================================
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
  return Math.abs(h);
}
function colorForTag(tag) { return PALETTE[hashStr(tag.toUpperCase()) % PALETTE.length]; }
function colorForRole(role) { return ROLE_COLORS[role] || PALETTE[hashStr(role) % PALETTE.length]; }

// ---- cor por pessoa = TOM da cor do cargo dela (mesmo matiz, variação por pessoa) ----
function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > .5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h * 360, s * 100, l * 100];
}
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = x => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`.toUpperCase();
}
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function colorForUser(userId) {
  const u = _lastData && _lastData.users ? _lastData.users.find(x => x._id === userId) : null;
  const base = u ? colorForRole(u.role || NO_ROLE) : PALETTE[hashStr(userId) % PALETTE.length];
  const [h, s, l] = hexToHsl(base);
  const seed = hashStr(userId);
  const dl = (seed % 29) - 14;            // luminosidade -14..+14
  const ds = ((seed >> 4) % 25) - 12;     // saturação   -12..+12
  return hslToHex(h, _clamp(s + ds, 45, 100), _clamp(l + dl, 38, 72));
}

function initials(name) {
  const parts = (name || '?').trim().split(/\s+/);
  return ((parts[0] || '?')[0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
}
function discordAvatarURL(user) {
  if (!user.avatar) return null;
  // defesa: se algum valor antigo tiver a URL completa em vez do hash, usa direto
  if (String(user.avatar).startsWith('http')) return user.avatar;
  return `https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.png`;
}
// html do avatar: imagem do Discord ou iniciais coloridas
function avatarHtml(user, cls) {
  const color = colorForUser(user._id);
  const url = discordAvatarURL(user);
  if (url) {
    return `<div class="${cls}" style="background-image:url('${url}');border:2px solid ${color}"></div>`;
  }
  return `<div class="${cls}" style="border:2px solid ${color};color:${color}">${escapeHtml(initials(user.username))}</div>`;
}

// ---- datas ----
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dateFromStr(s) { return new Date(s + 'T00:00:00'); }
function dstr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function isBusinessDay(d) { const wd = d.getDay(); return wd >= 1 && wd <= 5; }
function formatDate(dateStr) { return dateFromStr(dateStr).toLocaleDateString('pt-BR'); }
function formatDayLong(dateStr) {
  const d = dateFromStr(dateStr);
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'short' })
    .toUpperCase().replace(/\./g, '').replace(/ DE /g, ' ');
}
function formatTime(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
  catch (_) { return ''; }
}
// últimos N dias úteis terminando hoje (ou no último dia útil)
function lastBusinessDays(n) {
  const out = [];
  const d = new Date();
  while (out.length < n) {
    if (isBusinessDay(d)) out.unshift(dstr(d));
    d.setDate(d.getDate() - 1);
  }
  return out;
}

// ---- parsing de tags ----
const TAG_RE = /^-?\s*\[([^\]]+)\]\s*(.*)$/;
function parseLines(text) {
  if (!text) return [];
  return text.replace(/\r\n/g, '\n').split('\n')
    .map(l => l.trim().replace(/^[-*]\s+/, '- ').replace(/^- /, ''))
    .map(l => l.trim()).filter(Boolean)
    .map(line => {
      const m = line.match(/^\[([^\]]+)\]\s*(.*)$/);
      if (m) return { tag: m[1].trim(), text: m[2] };
      return { tag: null, text: line };
    });
}
function extractTags(reports) {
  const counts = new Map();
  for (const r of reports) {
    for (const field of [r.yesterday, r.today]) {
      for (const ln of parseLines(field)) {
        if (ln.tag) counts.set(ln.tag.toUpperCase(), (counts.get(ln.tag.toUpperCase()) || 0) + 1);
      }
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}
// ---- projetos canônicos ----
function normTag(s) { return (s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function activeProjects(data) { return (data.projects || []).filter(p => p.active !== false); }
function projectPaths(data) {
  const paths = [];
  for (const p of activeProjects(data)) {
    const subs = p.subs || [];
    if (subs.length) subs.forEach(s => paths.push(`${p.name}/${s}`));
    else paths.push(p.name);
  }
  return paths;
}
// relatório pertence ao projeto se: campo canônico bate, OU alguma [TAG] digitada
// normalizada começa com o nome do projeto (CARNAVAL-QUIZ ~ CARNAVAL_QUIZ ~ CARNAVAL/QUIZ)
function reportMatchesProject(r, projName) {
  const n = normTag(projName);
  if ((r.projects || []).some(p => normTag(String(p).split('/')[0]) === n)) return true;
  for (const field of [r.yesterday, r.today]) {
    for (const ln of parseLines(field)) {
      if (ln.tag && normTag(ln.tag).startsWith(n)) return true;
    }
  }
  return false;
}

function tagBadge(tag) {
  const c = colorForTag(tag);
  return `<span class="tag-badge" style="background:${c}1F;color:${c}">${escapeHtml(tag.toUpperCase())}</span>`;
}
function linesHtml(text) {
  const lines = parseLines(text);
  if (!lines.length) return '<span style="color:#5A6273">—</span>';
  return '<div class="report-lines">' + lines.map(ln =>
    `<div class="report-line">${ln.tag ? tagBadge(ln.tag) : ''}<span>${escapeHtml(ln.text)}</span></div>`
  ).join('') + '</div>';
}

// ---- presença unificada: daily conta seg–qui; SEXTA conta pelo WEEKLY da semana.
// (sexta não tem daily — o weekly substitui; sem isso todo mundo "falharia" às sextas)
function buildSentChecker(data) {
  const reportSet = new Set(data.reports.map(r => r.userId + '|' + r.date));
  const weeklySet = new Set((data.weeklies || []).map(w => w.userId + '|' + w.week));
  return (userId, dateStr) => {
    if (reportSet.has(userId + '|' + dateStr)) return true;
    if (dateFromStr(dateStr).getDay() === 5) {
      return weeklySet.has(userId + '|' + isoWeek(dateStr));
    }
    return false;
  };
}

// ---- streak: dias úteis consecutivos com presença (daily ou weekly na sexta),
// de trás pra frente. hoje sem envio ainda não quebra (só não conta).
function streakFor(userId, data) {
  const check = buildSentChecker(data);
  let streak = 0;
  const d = new Date();
  if (!check(userId, dstr(d))) d.setDate(d.getDate() - 1);
  while (true) {
    if (!isBusinessDay(d)) { d.setDate(d.getDate() - 1); continue; }
    if (check(userId, dstr(d))) { streak++; d.setDate(d.getDate() - 1); }
    else break;
  }
  return streak;
}

// ---- rótulos das colunas conforme dailyMode ----
function colLabels(user) {
  if (user && user.dailyMode === 'fim') return ['HOJE', 'AMANHÃ'];
  return ['ONTEM', 'HOJE'];
}

// ---- mês corrente ----
const MONTHS_PT = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
function currentMonthLabel() {
  const m = MONTHS_PT[new Date().getMonth()];
  return m[0].toUpperCase() + m.slice(1);
}
function businessDaysSoFarThisMonth() {
  const now = new Date();
  let count = 0;
  for (let day = 1; day <= now.getDate(); day++) {
    if (isBusinessDay(new Date(now.getFullYear(), now.getMonth(), day))) count++;
  }
  return count;
}
function isThisMonth(dateStr) {
  const d = dateFromStr(dateStr); const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

// ---- semana ISO (pra Weekly) ----
function isoWeek(dateStr) {
  const d = dateFromStr(dateStr);
  const t = new Date(d.valueOf());
  t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));
  const firstThu = new Date(t.getFullYear(), 0, 4);
  firstThu.setDate(firstThu.getDate() + 3 - ((firstThu.getDay() + 6) % 7));
  const week = 1 + Math.round((t - firstThu) / (7 * 86400000));
  return `${t.getFullYear()}-W${String(week).padStart(2, '0')}`;
}
function weekRangeLabel(weekKey) {
  // weekKey "2026-W27" → "SEMANA 27 · 29 JUN – 03 JUL"
  const m = weekKey.match(/^(\d{4})-W(\d{2})$/);
  if (!m) return weekKey;
  const year = +m[1], week = +m[2];
  const jan4 = new Date(year, 0, 4);
  const mon = new Date(jan4);
  mon.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (week - 1) * 7);
  const fri = new Date(mon); fri.setDate(mon.getDate() + 4);
  const fmt = d => d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
    .replace(/\./g, '').toUpperCase().replace(/ DE /g, ' ');
  return `SEMANA ${week} · ${fmt(mon)} – ${fmt(fri)}`;
}

// glifos do logo (SVG inline)
const GLYPHS = {
  target: '<svg width="13" height="13" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.4" stroke="#7ED321" stroke-width="2" fill="none"></circle><circle cx="8" cy="8" r="2.4" fill="#7ED321"></circle></svg>',
  bars: '<svg width="13" height="13" viewBox="0 0 16 16"><rect x="1" y="2" width="14" height="3" fill="#E24E3D"></rect><rect x="1" y="7" width="10" height="3" fill="#E24E3D"></rect><rect x="1" y="12" width="14" height="3" fill="#E24E3D"></rect></svg>',
  dots: '<svg width="13" height="13" viewBox="0 0 16 16"><rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1.5" fill="#22C9EF"></rect><rect x="9" y="1.5" width="5.5" height="5.5" rx="1.5" fill="#22C9EF"></rect><rect x="1.5" y="9" width="5.5" height="5.5" rx="1.5" fill="#22C9EF"></rect><rect x="9" y="9" width="5.5" height="5.5" rx="1.5" fill="#22C9EF"></rect></svg>',
  hex: '<svg width="13" height="13" viewBox="0 0 16 16"><polygon points="8,1.5 13.9,4.8 13.9,11.2 8,14.5 2.1,11.2 2.1,4.8" stroke="#FFD447" stroke-width="2" fill="none"></polygon></svg>',
  play: '<svg width="13" height="13" viewBox="0 0 16 16"><rect x="1.5" y="1.5" width="13" height="13" rx="2" stroke="#EE3B8B" stroke-width="2" fill="none"></rect><polygon points="6.4,5 11.4,8 6.4,11" fill="#EE3B8B"></polygon></svg>',
};

// ==========================================================
// HEADER / NAV / FOOTER compartilhados
// ==========================================================
const NAV_ITEMS = [
  { href: 'dashboard.html', label: 'Dashboard', glyph: 'target', color: '#22C9EF' },
  { href: 'weekly.html', label: 'Weekly', glyph: 'play', color: '#EE3B8B' },
  { href: 'projetos.html', label: 'Projetos', glyph: 'hex', color: '#FFD447' },
  { href: 'users.html', label: 'Membros', glyph: 'dots', color: '#22C9EF' },
  { href: 'register.html', label: 'Registrar', glyph: 'bars', color: '#E24E3D' },
];

const LOGO_MARK = `<svg width="38" height="38" viewBox="0 0 100 100" style="border-radius:6px;flex-shrink:0">
  <rect width="100" height="100" fill="#000"/>
  <rect x="4" y="4" width="92" height="92" fill="none" stroke="#fff" stroke-width="3"/>
  <text x="50" y="44" text-anchor="middle" fill="#fff" font-family="Barlow Condensed, sans-serif" font-weight="700" font-size="27" letter-spacing="2">REAL</text>
  <text x="50" y="70" text-anchor="middle" fill="#fff" font-family="Barlow Condensed, sans-serif" font-weight="700" font-size="27" letter-spacing="2">GAMES</text>
  <g transform="translate(24,76)">
    <rect x="0" y="2" width="9" height="2" fill="#E24E3D"/><rect x="0" y="5.5" width="7" height="2" fill="#E24E3D"/><rect x="0" y="9" width="9" height="2" fill="#E24E3D"/>
    <circle cx="19" cy="6.5" r="4" stroke="#7ED321" stroke-width="1.6" fill="none"/><circle cx="19" cy="6.5" r="1.3" fill="#7ED321"/>
    <rect x="28" y="2" width="3.6" height="3.6" rx=".8" fill="#22C9EF"/><rect x="33" y="2" width="3.6" height="3.6" rx=".8" fill="#22C9EF"/><rect x="28" y="7" width="3.6" height="3.6" rx=".8" fill="#22C9EF"/><rect x="33" y="7" width="3.6" height="3.6" rx=".8" fill="#22C9EF"/>
    <polygon points="46,1.5 50,4 50,9 46,11.5 42,9 42,4" stroke="#FFD447" stroke-width="1.6" fill="none"/>
  </g>
</svg>`;

function headerDate() {
  return new Date().toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
    .replace(/\./g, '').replace(/ de /g, ' ');
}

function renderHeader(activePage) {
  const nav = NAV_ITEMS.map(it => {
    const active = it.href === activePage;
    return `<a href="${it.href}" class="${active ? 'active' : ''}">${GLYPHS[it.glyph]}${it.label}${active ? `<span class="nav-underline" style="background:${it.color}"></span>` : ''}</a>`;
  }).join('');
  return `
  <header class="rg-header">
    <a href="dashboard.html" class="rg-brand">
      ${LOGO_MARK}
      <div style="display:flex;flex-direction:column">
        <span class="rg-brand-name rg-glow">DailyInBot</span>
        <span class="rg-brand-sub">real games</span>
      </div>
    </a>
    <nav class="rg-nav">${nav}</nav>
    <button class="btn-daily" onclick="openDailyModal()">▸ Fazer Daily</button>
    <span class="hdr-date">${headerDate()}</span>
    <a href="#" class="btn-logout-rg" onclick="logout(); return false;">SAIR</a>
  </header>`;
}

function renderFooter() {
  return `
  <footer class="rg-footer">
    <div class="glyphs">${GLYPHS.bars}${GLYPHS.target}${GLYPHS.dots}${GLYPHS.hex}</div>
    <span class="social">REAL GAMES · YT @realgames · IG @realgamesbr · FB @realgamesnoface</span>
  </footer>`;
}

// ==========================================================
// MODAL — FAZER DAILY
// ==========================================================
let _modalUsers = [];

function renderDailyModal() {
  return `
  <div class="modal-overlay" id="daily-modal">
    <div class="modal-card">
      <div class="modal-head">
        <div class="modal-title">▸ Fazer Daily</div>
        <button class="modal-close" onclick="closeDailyModal()">✕</button>
      </div>
      <div class="modal-field">
        <label>Quem é você?</label>
        <div class="who-chips" id="modal-who"></div>
      </div>
      <div class="modal-field">
        <label id="modal-label-a">O que você fez ontem?</label>
        <textarea id="modal-yesterday" placeholder="- [TAG] o que foi feito&#10;- outra coisa"></textarea>
      </div>
      <div class="modal-field">
        <label id="modal-label-b">O que vai fazer hoje?</label>
        <textarea id="modal-today" placeholder="- [TAG] o que vem agora"></textarea>
      </div>
      <div class="modal-field">
        <label>Impedimentos (opcional)</label>
        <input type="text" id="modal-blockers" placeholder="deixe vazio se não houver" />
      </div>
      <div class="modal-field" id="modal-projects-field" style="display:none">
        <label>🏷 Projetos que você tocou (opcional)</label>
        <div class="who-chips" id="modal-projects"></div>
      </div>
      <button class="btn-send-daily" id="modal-send" onclick="submitDailyModal()">Enviar Daily ▸</button>
      <div class="modal-msg" id="modal-msg"></div>
    </div>
  </div>`;
}

const _modalProjSel = new Set();

function openDailyModal() {
  const modal = document.getElementById('daily-modal');
  if (!modal) return;
  modal.classList.add('visible');
  renderModalChips();
  renderModalProjects();
}

function renderModalProjects() {
  const field = document.getElementById('modal-projects-field');
  const box = document.getElementById('modal-projects');
  if (!field || !box) return;
  const paths = _lastData ? projectPaths(_lastData) : [];
  if (!paths.length) { field.style.display = 'none'; return; }
  field.style.display = '';
  box.innerHTML = paths.map(p =>
    `<button class="chip ${_modalProjSel.has(p) ? 'active' : ''}" onclick="toggleModalProject('${escapeHtml(p)}')"><span class="sq" style="background:${colorForTag(p.split('/')[0])}"></span>${escapeHtml(p)}</button>`
  ).join('');
}
function toggleModalProject(p) {
  if (_modalProjSel.has(p)) _modalProjSel.delete(p); else _modalProjSel.add(p);
  renderModalProjects();
}
function closeDailyModal() {
  const modal = document.getElementById('daily-modal');
  if (modal) modal.classList.remove('visible');
}
function renderModalChips() {
  const box = document.getElementById('modal-who');
  if (!box) return;
  const saved = localStorage.getItem('dailybot_me') || '';
  box.innerHTML = _modalUsers.filter(u => u.active !== false).map(u => {
    const c = colorForUser(u._id);
    const on = u._id === saved;
    return `<button class="chip ${on ? 'active' : ''}" data-uid="${u._id}" onclick="pickModalUser('${u._id}')"><span class="dot" style="background:${c}"></span>${escapeHtml(u.username)}</button>`;
  }).join('');
  updateModalLabels(saved);
}
function pickModalUser(uid) {
  localStorage.setItem('dailybot_me', uid);
  renderModalChips();
}
function updateModalLabels(uid) {
  const u = _modalUsers.find(x => x._id === uid);
  const [a, b] = colLabels(u);
  const la = document.getElementById('modal-label-a');
  const lb = document.getElementById('modal-label-b');
  if (la) la.textContent = a === 'HOJE' ? 'O que você fez hoje?' : 'O que você fez ontem?';
  if (lb) lb.textContent = b === 'AMANHÃ' ? 'O que vai fazer amanhã?' : 'O que vai fazer hoje?';
}
async function submitDailyModal() {
  const msg = document.getElementById('modal-msg');
  const btn = document.getElementById('modal-send');
  const uid = localStorage.getItem('dailybot_me');
  if (!uid || !_modalUsers.find(u => u._id === uid)) {
    msg.className = 'modal-msg err'; msg.textContent = '▸ selecione quem você é'; return;
  }
  const yesterday = document.getElementById('modal-yesterday').value.trim();
  const today = document.getElementById('modal-today').value.trim();
  const blockers = document.getElementById('modal-blockers').value.trim();
  if (!yesterday && !today) {
    msg.className = 'modal-msg err'; msg.textContent = '▸ escreva pelo menos uma das respostas'; return;
  }
  btn.disabled = true;
  msg.className = 'modal-msg'; msg.textContent = 'enviando...';
  try {
    await queueWrite('dailies', {
      userId: uid, date: todayStr(),
      yesterday: yesterday || null, today: today || null, blockers: blockers || null,
      projects: _modalProjSel.size ? [..._modalProjSel] : null,
    });
    msg.className = 'modal-msg ok';
    msg.textContent = '✓ enviado! o bot processa em instantes.';
    setTimeout(() => { closeDailyModal(); window.location.reload(); }, 1800);
  } catch (e) {
    msg.className = 'modal-msg err';
    msg.textContent = '▸ envio pelo site ainda não ativado — use a DM do bot por enquanto.';
    btn.disabled = false;
  }
}

// injeta header/modal/footer nas páginas do app
function mountChrome(activePage) {
  // seleção de texto na cor da aba ativa (mesma cor do underline)
  const navItem = NAV_ITEMS.find(it => it.href === activePage);
  if (navItem) document.documentElement.style.setProperty('--sel', navItem.color);
  document.body.insertAdjacentHTML('afterbegin', renderHeader(activePage));
  document.body.insertAdjacentHTML('beforeend', renderDailyModal());
  document.body.insertAdjacentHTML('beforeend', renderFooter());
  const overlay = document.getElementById('daily-modal');
  overlay.addEventListener('click', e => { if (e.target === overlay) closeDailyModal(); });
}

// ==========================================================
// PÁGINA: LOGIN
// ==========================================================
async function initLogin() {
  if (isAuthenticated()) { window.location.href = 'dashboard.html'; return; }
  const form = document.getElementById('login-form');
  const errorEl = document.getElementById('login-error');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const password = document.getElementById('password-input').value;
    const hash = await hashPassword(password);
    if (hash === CONFIG.PASSWORD_HASH) {
      sessionStorage.setItem('dailybot_auth', 'true');
      window.location.href = 'dashboard.html';
    } else {
      errorEl.classList.add('visible');
    }
  });
}

// ==========================================================
// PÁGINA: DASHBOARD
// ==========================================================
const state = { role: null, member: null, project: null };

async function initDashboard() {
  mountChrome('dashboard.html');
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading"><div class="spinner"></div><p>Carregando...</p></div>';
  try {
    const data = await loadAllData();
    _modalUsers = data.users;
    // deep-link ?user=<id>
    const param = new URLSearchParams(location.search).get('user');
    if (param && data.users.find(u => u._id === param)) state.member = param;
    renderDashPage(data);
  } catch (err) {
    content.innerHTML = `<div class="empty-state boxed"><div class="icon">⚠️</div><p>Erro ao carregar dados.<br>${escapeHtml(err.message)}</p></div>`;
  }
}

function activeUsersOf(data) { return data.users.filter(u => u.active !== false); }
function usersInScope(data) {
  let us = activeUsersOf(data);
  if (state.role) us = us.filter(u => (u.role || NO_ROLE) === state.role);
  return us;
}
function reportsInScope(data) {
  const scopeIds = new Set(usersInScope(data).map(u => u._id));
  let rs = data.reports.filter(r => scopeIds.has(r.userId));
  if (state.member) rs = rs.filter(r => r.userId === state.member);
  if (state.project) rs = rs.filter(r => reportMatchesProject(r, state.project));
  return rs;
}

function renderDashPage(data) {
  const content = document.getElementById('content');
  const scopeUsers = usersInScope(data);
  const scopeReports = reportsInScope(data);
  const userMap = new Map(data.users.map(u => [u._id, u]));
  const today = todayStr();

  // ---- quem já fez hoje (na sexta conta o WEEKLY) ----
  const checker = buildSentChecker(data);
  const isFriday = new Date().getDay() === 5;
  const done = scopeUsers.filter(u => checker(u._id, today));
  const pending = scopeUsers.filter(u => !checker(u._id, today));
  const personHtml = (u, isPending) => {
    const c = colorForUser(u._id);
    const url = discordAvatarURL(u);
    let av;
    if (isPending) {
      const inner = url ? `style="background-image:url('${url}');border:2px dashed ${c}"` : `style="border:2px dashed ${c};color:${c}"`;
      av = `<div class="today-avatar pending" ${inner}>${url ? '' : escapeHtml(initials(u.username))}</div>`;
    } else {
      av = avatarHtml(u, 'today-avatar');
    }
    return `<span class="today-person" onclick="selectMember('${u._id}')" title="${escapeHtml(u.username)}${isPending ? ' — pendente' : ''}">${av}<span class="nm">${escapeHtml(u.username)}</span></span>`;
  };
  const todayHtml = `
    <div class="panel rg-in">
      <div class="panel-label">${GLYPHS.target} QUEM JÁ FEZ HOJE${isFriday ? ' · 📼 WEEKLY' : ''}</div>
      <div class="panel-sub">${done.length} de ${scopeUsers.length} enviaram${isFriday ? ' o weekly' : ''}</div>
      <div class="today-row">
        ${done.map(u => personHtml(u, false)).join('')}
        ${done.length && pending.length ? '<span class="today-divider" style="margin-top:10px"></span>' : ''}
        ${pending.map(u => personHtml(u, true)).join('')}
      </div>
    </div>`;

  // ---- barra 30 dias úteis (sexta conta pelo weekly) ----
  const days = lastBusinessDays(30);
  const total = scopeUsers.length || 1;
  let sentTotal = 0;
  const segs = days.map(d => {
    const n = Math.min(scopeUsers.filter(u => checker(u._id, d)).length, total);
    sentTotal += n;
    let color = '#1B1B23';
    if (n >= total) color = '#22C9EF';
    else if (n / total >= .6) color = '#15718B';
    else if (n > 0) color = '#123742';
    return `<span class="arcade-seg" style="background:${color}" title="${formatDate(d)} · ${n}/${total}"></span>`;
  }).join('');
  const pct = Math.round((sentTotal / (days.length * total)) * 100);
  const barHtml = `
    <div class="panel rg-in">
      <div class="panel-label" style="justify-content:space-between">
        <span style="display:inline-flex;align-items:center;gap:8px">${GLYPHS.bars} ÚLTIMOS 30 DIAS</span>
        <span class="arcade-pct" style="font-size:22px">${pct}%</span>
      </div>
      <div class="arcade-bar">${segs}</div>
      <div class="panel-sub" style="margin:10px 0 0">dailies enviadas pelo time · dias úteis</div>
    </div>`;

  const topHtml = `<div class="dash-top">${todayHtml}${barHtml}</div>`;

  // ---- filtros ----
  // cargo: só mostra o grupo se existir mais de um cargo de verdade
  const roles = [...new Set(activeUsersOf(data).map(u => u.role || NO_ROLE))];
  const showRoles = roles.length > 1;
  const roleChips = showRoles
    ? `<button class="chip ${!state.role ? 'active' : ''}" onclick="selectRole(null)">Time todo</button>` +
      roles.map(r => `<button class="chip ${state.role === r ? 'active' : ''}" onclick="selectRole('${escapeHtml(r)}')"><span class="sq" style="background:${colorForRole(r)}"></span>${escapeHtml(r)}</button>`).join('') +
      '<span class="filters-divider"></span>'
    : '';
  // membro vira DROPDOWN (clicar no avatar/nome na lista também filtra)
  const memberSelect = `
    <select class="filter-select" onchange="selectMember(this.value || null)">
      <option value="">Todos os membros</option>
      ${scopeUsers.map(u => `<option value="${u._id}" ${state.member === u._id ? 'selected' : ''}>${escapeHtml(u.username)}</option>`).join('')}
    </select>`;
  // chips de projeto CANÔNICOS — contagem respeita a pessoa selecionada;
  // com pessoa escolhida, só aparecem os projetos QUE ELA tocou
  const scopeIds = new Set(scopeUsers.map(u => u._id));
  const baseReports = data.reports.filter(r =>
    scopeIds.has(r.userId) && (!state.member || r.userId === state.member));
  const projChips = activeProjects(data).map(p => {
    const cnt = baseReports.filter(r => reportMatchesProject(r, p.name)).length;
    return { p, cnt };
  }).filter(({ p, cnt }) => !state.member || cnt > 0 || state.project === p.name)
    .map(({ p, cnt }) =>
      `<button class="chip ${state.project === p.name ? 'active' : ''}" onclick="selectProject('${escapeHtml(p.name)}')"><span class="sq" style="background:${colorForTag(p.name)}"></span>${escapeHtml(p.name)} <span class="cnt">${cnt}</span></button>`
    ).join('');
  const filtersHtml = `<div class="filters-row rg-in">${roleChips}${memberSelect}${projChips ? '<span class="filters-divider"></span>' + projChips : ''}</div>`;

  // ---- perfil ou lista ----
  let mainHtml;
  if (state.member) {
    const user = userMap.get(state.member);
    mainHtml = user ? renderProfile(user, data) : '<div class="empty-state boxed"><p>Membro não encontrado.</p></div>';
  } else {
    const sorted = [...scopeReports]
      .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || ''))
      .slice(0, 50);
    const sect = `<div class="sect-head">${GLYPHS.bars} ÚLTIMOS RELATÓRIOS <span class="cnt">${scopeReports.length} relatório${scopeReports.length !== 1 ? 's' : ''}</span></div>`;
    // lista agrupada por dia (herdado da antiga Timeline — as duas abas viraram uma)
    let listHtml = '';
    let lastDate = null;
    let i = 0;
    for (const r of sorted) {
      if (r.date !== lastDate) {
        lastDate = r.date;
        listHtml += `<div class="tl-day-head" style="margin-top:${i ? 14 : 0}px">${formatDayLong(r.date)}${r.date === today ? '<span class="today-mark">· HOJE</span>' : ''}</div>`;
      }
      listHtml += reportRowHtml(r, userMap, i++);
    }
    mainHtml = sorted.length ? sect + `<div class="reports-table">${listHtml}</div>`
      : '<div class="empty-state boxed"><div class="icon">🗂️</div><p>Nenhum relatório com esses filtros.</p></div>';
  }

  content.innerHTML = topHtml + filtersHtml + mainHtml;
  window._dashData = data;
}

function reportRowHtml(r, userMap, i) {
  const u = userMap.get(r.userId);
  const [labelA, labelB] = colLabels(u);
  const delay = Math.min(i, 8) * 45;
  return `
  <div class="report-row rg-in" style="animation-delay:${delay}ms">
    <div class="report-who">
      ${u ? avatarHtml(u, 'mini-avatar') : '<div class="mini-avatar">?</div>'}
      <div>
        <div class="who-name" onclick="selectMember('${r.userId}')">${u ? escapeHtml(u.username) : 'Removido'}</div>
        <div class="who-date">${formatDate(r.date)}</div>
      </div>
    </div>
    <div><div class="report-col-label">${labelA}</div>${linesHtml(r.yesterday)}</div>
    <div><div class="report-col-label hl">${labelB}</div>${linesHtml(r.today)}</div>
    <div>
      <div class="report-col-label">IMPEDIMENTOS</div>
      ${r.blockers ? `<div class="blocker-box">${escapeHtml(r.blockers)}</div>` : '<span class="no-blocker">✓ nenhum</span>'}
    </div>
  </div>`;
}

function renderProfile(user, data) {
  const reports = data.reports.filter(r => r.userId === user._id).sort((a, b) => b.date.localeCompare(a.date));
  const userMap = new Map(data.users.map(u => [u._id, u]));
  const check = buildSentChecker(data);
  const streak = streakFor(user._id, data);
  const streakCls = streak >= 5 ? 'streak-badge hot' : 'streak-badge';

  // stats — presença conta daily seg–qui e weekly na sexta
  const monthExpected = businessDaysSoFarThisMonth();
  const monthDays = lastBusinessDays(Math.max(monthExpected, 1)).slice(-monthExpected);
  const monthDone = monthDays.filter(d => check(user._id, d)).length;
  const last12wDays = lastBusinessDays(60);
  const rate12w = Math.round((last12wDays.filter(d => check(user._id, d)).length / last12wDays.length) * 100);
  const tags = extractTags(reports);
  const topTag = tags.length ? tags[0][0] : '—';

  const miniBar = monthDays.map(d =>
    `<span style="background:${check(user._id, d) ? '#22C9EF' : '#1B1B23'}"></span>`).join('');

  // heatmap: 12 semanas × seg-sex
  const heatCols = [];
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7)); // segunda desta semana
  const blockedSet = new Set(reports.filter(r => r.blockers).map(r => r.date));
  for (let w = 11; w >= 0; w--) {
    const cells = [];
    for (let dow = 0; dow < 5; dow++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() - w * 7 + dow);
      const ds = dstr(d);
      let cls = '';
      if (d > now) cls = 'future';
      else if (blockedSet.has(ds)) cls = 'blocked';
      else if (check(user._id, ds)) cls = 'sent';
      cells.push(`<div class="heatmap-cell ${cls}" title="${formatDate(ds)}${dateFromStr(ds).getDay() === 5 ? ' · weekly' : ''}"></div>`);
    }
    heatCols.push(`<div class="heatmap-col">${cells.join('')}</div>`);
  }

  return `
  <div class="rg-in">
    <div class="profile-head">
      ${avatarHtml(user, 'profile-avatar')}
      <div>
        <div class="profile-name glitch-name">${escapeHtml(user.username)}</div>
        <div style="display:flex;align-items:center;gap:12px;margin-top:8px;flex-wrap:wrap">
          <span class="${streakCls}">🔥 ${streak} ${streak === 1 ? 'dia' : 'dias'}</span>
          <span class="t-mono">ID ${escapeHtml(user.discordId)}</span>
          ${user.createdAt ? `<span class="t-mono">DESDE ${new Date(user.createdAt).toLocaleDateString('pt-BR')}</span>` : ''}
        </div>
      </div>
      <button class="btn-clear-user" onclick="selectMember(null)">✕ ver todos</button>
    </div>

    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-value cyan">${monthDone}<span style="font-size:18px;color:#5A6273">/${monthExpected}</span></div>
        <div class="stat-label">Dailies em ${currentMonthLabel()}</div>
        <div class="stat-minibar">${miniBar}</div>
      </div>
      <div class="stat-card">
        <div class="stat-value grn">${rate12w}%</div>
        <div class="stat-label">Taxa em 12 semanas</div>
      </div>
      <div class="stat-card">
        <div class="stat-value yel" style="font-size:22px;padding-top:6px">${escapeHtml(topTag)}</div>
        <div class="stat-label">Projeto mais citado</div>
      </div>
    </div>

    <div class="panel" style="margin-bottom:20px">
      <div class="panel-label">${GLYPHS.bars} ÚLTIMAS 12 SEMANAS · SEG–SEX</div>
      <div class="heatmap">${heatCols.join('')}</div>
      <div class="heatmap-legend">
        <span><i style="background:#22C9EF"></i> enviada</span>
        <span><i style="background:#3A1620;border:1px solid rgba(226,78,61,.5)"></i> com impedimento</span>
        <span><i style="background:#1B1B23"></i> sem daily</span>
      </div>
    </div>

    <div class="panel-label" style="margin-bottom:10px">${GLYPHS.bars} HISTÓRICO${state.project ? ` · FILTRADO: <span style="color:${colorForTag(state.project)}">${escapeHtml(state.project)}</span>` : ''}</div>
    <div class="reports-table">
      ${(state.project ? reports.filter(r => reportMatchesProject(r, state.project)) : reports)
        .slice(0, 40).map((r, i) => reportRowHtml(r, userMap, i)).join('')
        || `<div class="empty-state boxed"><p>${state.project ? 'Nenhum relatório desse projeto.' : 'Sem relatórios ainda.'}</p></div>`}
    </div>
  </div>`;
}

function selectRole(role) {
  state.role = role; state.member = null;
  renderDashPage(window._dashData);
}
function selectMember(id) {
  state.member = id;
  if (document.body.dataset.page !== 'dashboard') {
    window.location.href = 'dashboard.html' + (id ? `?user=${id}` : '');
    return;
  }
  renderDashPage(window._dashData);
}
function selectProject(name) {
  state.project = state.project === name ? null : name;
  renderDashPage(window._dashData);
}

// ==========================================================
// PÁGINA: WEEKLY
// ==========================================================
async function initWeekly() {
  mountChrome('weekly.html');
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading"><div class="spinner"></div><p>Carregando...</p></div>';
  try {
    const data = await loadAllData();
    _modalUsers = data.users;
    const userMap = new Map(data.users.map(u => [u._id, u]));
    const weeklies = data.weeklies || [];

    const banner = `
      <div class="weekly-banner rg-in">
        📼 <strong>Weekly:</strong> toda sexta às 17h o bot pede um resumo da semana — texto + <strong>print</strong> e opcionalmente <strong>vídeo</strong> (anexos enviados na DM do bot, limite 10MB).
      </div>`;

    if (!weeklies.length) {
      content.innerHTML = banner + '<div class="empty-state boxed"><div class="icon">📼</div><p>Nenhum weekly registrado ainda.<br>O primeiro chega na próxima sexta!</p></div>';
      return;
    }

    const byWeek = new Map();
    for (const w of weeklies) {
      const key = w.week || isoWeek((w.createdAt || '').slice(0, 10) || todayStr());
      if (!byWeek.has(key)) byWeek.set(key, []);
      byWeek.get(key).push(w);
    }
    const weeks = [...byWeek.keys()].sort((a, b) => b.localeCompare(a));

    content.innerHTML = banner + weeks.map(wk => {
      const cards = byWeek.get(wk).map(w => {
        const u = userMap.get(w.userId);
        const role = u && u.role ? u.role : null;
        const summary = linesHtml(w.summary);
        const img = w.imageUrl
          ? `<div class="media-box filled-img" style="background-image:url('${w.imageUrl}')" onclick="window.open('${w.imageUrl}','_blank')"></div>`
          : `<div class="media-box placeholder">📷<span>sem print</span></div>`;
        const vid = w.videoUrl
          ? `<div class="media-box filled-video" onclick="window.open('${w.videoUrl}','_blank')"><div class="play-btn">▶</div>${w.videoDuration ? `<span class="media-dur">${escapeHtml(w.videoDuration)}</span>` : ''}</div>`
          : `<div class="media-box placeholder" style="opacity:.5">🎬<span>sem vídeo</span></div>`;
        return `
        <div class="weekly-card rg-in">
          <div class="tl-entry-head" style="margin-bottom:12px">
            ${u ? avatarHtml(u, 'mini-avatar') : ''}
            <div>
              <strong style="font-size:.9rem">${u ? escapeHtml(u.username) : 'Removido'}</strong>
              ${role ? `<div style="display:flex;align-items:center;gap:5px;margin-top:2px"><span class="dot" style="width:7px;height:7px;border-radius:50%;background:${colorForRole(role)}"></span><span class="t-mono" style="font-size:9px">${escapeHtml(role)}</span></div>` : ''}
            </div>
          </div>
          ${summary}
          <div class="weekly-media">${img}${vid}</div>
        </div>`;
      }).join('');
      return `<div class="week-label">${weekRangeLabel(wk)}</div><div class="weekly-grid">${cards}</div>`;
    }).join('');
  } catch (err) {
    content.innerHTML = `<div class="empty-state boxed"><div class="icon">⚠️</div><p>Erro ao carregar.<br>${escapeHtml(err.message)}</p></div>`;
  }
}

// ==========================================================
// PÁGINA: MEMBROS
// ==========================================================
// ---- estado "aplicando" do toggle de formato (persiste em localStorage) ----
const PENDING_MODE_KEY = 'dailybot_pending_mode';
const PENDING_MODE_TTL = 10 * 60 * 1000; // desiste depois de 10min (algo deu errado no bot)
let _membersPollTimer = null;
const _justConfirmed = new Set();

function getPendingModes() {
  try { return JSON.parse(localStorage.getItem(PENDING_MODE_KEY)) || {}; } catch (_) { return {}; }
}
function savePendingModes(p) { localStorage.setItem(PENDING_MODE_KEY, JSON.stringify(p)); }

async function initMembers() {
  mountChrome('users.html');
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading"><div class="spinner"></div><p>Carregando...</p></div>';
  await refreshMembers();
}

async function refreshMembers() {
  const content = document.getElementById('content');
  try {
    const data = await loadAllData();
    _modalUsers = data.users;

    // reconcilia pendências: bot aplicou? (dailyMode no Firebase == escolha) → confirma
    const pending = getPendingModes();
    let changed = false;
    for (const [uid, p] of Object.entries(pending)) {
      const u = data.users.find(x => x._id === uid);
      const cur = u && (u.dailyMode === 'fim' ? 'fim' : 'inicio');
      if (!u || cur === p.mode || Date.now() - p.ts > PENDING_MODE_TTL) {
        if (u && cur === p.mode) {
          _justConfirmed.add(uid);
          setTimeout(() => { _justConfirmed.delete(uid); refreshMembers(); }, 5000);
        }
        delete pending[uid];
        changed = true;
      }
    }
    if (changed) savePendingModes(pending);

    renderMembersPage(data, pending);

    // enquanto houver pendência, checa o Firebase a cada 8s
    const hasPending = Object.keys(pending).length > 0;
    if (hasPending && !_membersPollTimer) {
      _membersPollTimer = setInterval(refreshMembers, 8000);
    } else if (!hasPending && _membersPollTimer) {
      clearInterval(_membersPollTimer);
      _membersPollTimer = null;
    }
  } catch (err) {
    content.innerHTML = `<div class="empty-state boxed"><div class="icon">⚠️</div><p>Erro ao carregar.<br>${escapeHtml(err.message)}</p></div>`;
  }
}

function renderMembersPage(data, pending) {
  const content = document.getElementById('content');
  const users = data.users;
  document.getElementById('subtitle').textContent =
    `${users.length} membro${users.length !== 1 ? 's' : ''} · gestão via bot no Discord`;

  if (!users.length) {
    content.innerHTML = '<div class="empty-state boxed"><div class="icon">👥</div><p>Nenhum membro ainda.</p></div>';
    return;
  }

  const byRole = new Map();
  for (const u of users) {
    const role = u.role || NO_ROLE;
    if (!byRole.has(role)) byRole.set(role, []);
    byRole.get(role).push(u);
  }
  const roleOrder = [...byRole.keys()].sort((a, b) => a === NO_ROLE ? 1 : b === NO_ROLE ? -1 : a.localeCompare(b));

  content.innerHTML = roleOrder.map(role => {
    const c = colorForRole(role);
    const cards = byRole.get(role)
      .sort((a, b) => a.username.localeCompare(b.username))
      .map((u, i) => {
        const streak = streakFor(u._id, data);
        const pend = pending[u._id];
        // otimista: se tem pendência, já mostra a escolha nova
        const mode = pend ? pend.mode : (u.dailyMode === 'fim' ? 'fim' : 'inicio');
        const applying = !!pend;
        const confirmed = _justConfirmed.has(u._id);
        const joined = u.createdAt ? new Date(u.createdAt).toLocaleDateString('pt-BR') : '—';
        const dis = applying ? 'disabled' : '';
        let statusHtml;
        if (applying) {
          statusHtml = `<div class="mode-status applying">⧗ AGUARDANDO O BOT APLICAR (~1 MIN) — dá pra trocar de novo depois de confirmado</div>`;
        } else if (confirmed) {
          statusHtml = `<div class="mode-status done">✓ APLICADO!</div>`;
        } else {
          statusHtml = `<div class="daily-mode-desc">${mode === 'inicio'
            ? 'DM às 9h · "o que fez ontem?" + "o que vai fazer hoje?"'
            : 'DM às 18h · "o que fez hoje?" + "o que vai fazer amanhã?"'}</div>`;
        }
        return `
        <div class="user-card-rg rg-in" style="animation-delay:${Math.min(i, 8) * 45}ms">
          <div class="uc-head">
            ${avatarHtml(u, 'uc-avatar')}
            <div style="min-width:0">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <span class="uc-name">${escapeHtml(u.username)}</span>
                ${u.active !== false ? '<span class="badge-active-rg">● ATIVO</span>' : '<span class="badge-inactive-rg">● INATIVO</span>'}
                <span class="streak-badge ${streak >= 5 ? 'hot' : ''}" style="font-size:9px;padding:2px 8px">🔥 ${streak}</span>
              </div>
              <div class="uc-meta">ID ${escapeHtml(u.discordId)}</div>
              <div class="uc-meta">DESDE ${joined}</div>
            </div>
          </div>
          <div class="daily-mode-block">
            <span class="t-mono" style="font-size:9px">FORMATO DA DAILY</span>
            <div class="daily-mode-toggle">
              <button ${dis} class="${mode === 'inicio' ? 'on-inicio' : ''}" onclick="setDailyMode('${u._id}','inicio')">☀ MANHÃ</button>
              <button ${dis} class="${mode === 'fim' ? 'on-fim' : ''}" onclick="setDailyMode('${u._id}','fim')">🌙 FIM DO DIA</button>
            </div>
            ${statusHtml}
          </div>
          <a class="btn-hist" href="dashboard.html?user=${u._id}">VER HISTÓRICO ▸</a>
        </div>`;
      }).join('');
    return `<div class="role-head"><span class="sq" style="background:${c}"></span><span style="color:${c}">${escapeHtml(role)}</span></div><div class="users-grid">${cards}</div>`;
  }).join('');
}

async function setDailyMode(uid, mode) {
  const u = _modalUsers.find(x => x._id === uid);
  const cur = u && (u.dailyMode === 'fim' ? 'fim' : 'inicio');
  if (cur === mode) return;                 // já está nesse modo
  if (getPendingModes()[uid]) return;       // travado: aguardando o bot aplicar
  try {
    await queueWrite('dailymode', { userId: uid, dailyMode: mode });
    const p = getPendingModes();
    p[uid] = { mode, ts: Date.now() };
    savePendingModes(p);
    refreshMembers();
  } catch (e) {
    alert('A troca de formato pelo site não está ativada — fale com o Matheus.');
  }
}

// ==========================================================
// PÁGINA: PROJETOS (gestão do registro canônico)
// ==========================================================
// Pendências otimistas (localStorage): o projeto aparece/atualiza/some NA HORA
// com "⧗ sincronizando"; o poll reconcilia quando o bot aplicar de verdade.
const PENDING_PROJ_KEY = 'dailybot_pending_projects';
const PENDING_PROJ_TTL = 10 * 60 * 1000;
let _projPollTimer = null;
let _projEditing = null; // nome do projeto em edição no form

function getPendingProjects() {
  try { return JSON.parse(localStorage.getItem(PENDING_PROJ_KEY)) || []; } catch (_) { return []; }
}
function savePendingProjects(list) { localStorage.setItem(PENDING_PROJ_KEY, JSON.stringify(list)); }

async function initProjects() {
  mountChrome('projetos.html');
  const content = document.getElementById('content');
  // form e lista em containers separados: o poll SÓ re-renderiza a lista,
  // então o que você está digitando no form nunca é apagado
  content.innerHTML = `
    <div id="proj-form-mount"></div>
    <div id="proj-list-mount"><div class="loading"><div class="spinner"></div><p>Carregando...</p></div></div>`;
  renderProjectsForm();
  await refreshProjects();
}

function renderProjectsForm() {
  const mount = document.getElementById('proj-form-mount');
  if (!mount) return;
  mount.innerHTML = `
    <div class="panel" style="margin-bottom:20px">
      <div class="panel-label">${GLYPHS.hex} ${_projEditing ? `EDITANDO: ${escapeHtml(_projEditing)}` : 'NOVO PROJETO'}</div>
      <div style="display:grid;grid-template-columns:1fr 180px 1fr auto;gap:10px;align-items:end" class="proj-form">
        <div class="modal-field" style="margin:0"><label>Nome</label><input type="text" id="proj-name" placeholder="ex: CARNAVAL" ${_projEditing ? 'readonly style="opacity:.6"' : ''} /></div>
        <div class="modal-field" style="margin:0"><label>Área</label>
          <input type="text" id="proj-area" list="area-list" placeholder="Developer" />
          <datalist id="area-list"><option value="Developer"></option><option value="Arte3D"></option></datalist>
        </div>
        <div class="modal-field" style="margin:0"><label>Subprojetos (vírgula, opcional)</label><input type="text" id="proj-subs" placeholder="QUIZ, VIDEO" /></div>
        <div style="display:flex;gap:8px">
          <button class="btn-daily" style="height:42px" onclick="submitProject()">${_projEditing ? '✓ Salvar' : '+ Adicionar'}</button>
          ${_projEditing ? '<button class="btn-logout-rg" style="height:42px" onclick="cancelEditProject()">CANCELAR</button>' : ''}
        </div>
      </div>
      <div class="mode-status" id="proj-status"></div>
    </div>`;
  if (_projEditing && _lastData) {
    const p = mergedProjects(_lastData, getPendingProjects()).find(x => normTag(x.name) === normTag(_projEditing));
    if (p) {
      document.getElementById('proj-name').value = p.name;
      document.getElementById('proj-area').value = p.area || '';
      document.getElementById('proj-subs').value = (p.subs || []).join(', ');
    }
  }
}

async function refreshProjects() {
  const content = document.getElementById('content');
  try {
    const data = await loadAllData();
    _modalUsers = data.users;

    // reconcilia: bot já aplicou? remove a pendência
    let pending = getPendingProjects();
    const before = pending.length;
    pending = pending.filter(pe => {
      if (Date.now() - pe.ts > PENDING_PROJ_TTL) return false;
      const server = (data.projects || []).find(p => normTag(p.name) === normTag(pe.name));
      // archive aplicado quando o projeto sumiu ou ficou inativo no servidor
      if (pe.action === 'archive') return !!(server && server.active !== false);
      // add/update: aplicado quando existe ativo e foi tocado depois do pedido
      if (!server || server.active === false) return true;
      const upd = Date.parse(server.updatedAt || server.createdAt || 0);
      return !(upd && upd >= pe.ts - 90 * 1000);
    });
    if (pending.length !== before) savePendingProjects(pending);

    renderProjectsPage(data, pending);

    if (pending.length && !_projPollTimer) _projPollTimer = setInterval(refreshProjects, 6000);
    else if (!pending.length && _projPollTimer) { clearInterval(_projPollTimer); _projPollTimer = null; }
  } catch (err) {
    content.innerHTML = `<div class="empty-state boxed"><div class="icon">⚠️</div><p>Erro ao carregar.<br>${escapeHtml(err.message)}</p></div>`;
  }
}

// mescla servidor + pendências pra visão otimista
function mergedProjects(data, pending) {
  const list = (data.projects || []).filter(p => p.active !== false).map(p => ({ ...p }));
  for (const pe of pending) {
    const i = list.findIndex(x => normTag(x.name) === normTag(pe.name));
    if (pe.action === 'archive') {
      if (i >= 0) list[i]._pending = 'archive';
    } else {
      const obj = { name: pe.name, area: pe.area, subs: pe.subs || [], _pending: pe.action };
      if (i >= 0) list[i] = { ...list[i], ...obj };
      else list.push(obj);
    }
  }
  return list;
}

function renderProjectsPage(data, pending) {
  const content = document.getElementById('proj-list-mount');
  if (!content) return;
  const projects = mergedProjects(data, pending);

  let listHtml;
  if (!projects.length) {
    listHtml = '<div class="empty-state boxed"><div class="icon">🏷</div><p>Nenhum projeto cadastrado ainda.<br>Adicione o primeiro acima — ele vira opção no dropdown da daily e filtro no dashboard.</p></div>';
  } else {
    const byArea = new Map();
    for (const p of projects) {
      const a = p.area || 'Sem área';
      if (!byArea.has(a)) byArea.set(a, []);
      byArea.get(a).push(p);
    }
    listHtml = [...byArea.keys()].sort().map(area => {
      const c = colorForRole(area);
      const cards = byArea.get(area).sort((a, b) => a.name.localeCompare(b.name)).map(p => {
        const pend = p._pending;
        const dim = pend ? 'opacity:.45' : '';
        const statusLine = pend === 'archive'
          ? '<div class="mode-status applying">⧗ REMOVENDO…</div>'
          : pend
            ? '<div class="mode-status applying">⧗ SINCRONIZANDO — o bot confirma em ~1 min</div>'
            : '';
        return `
        <div class="user-card-rg rg-in" style="${dim}">
          <div style="display:flex;align-items:center;gap:10px">
            <span class="sq" style="width:12px;height:12px;border-radius:3px;background:${colorForTag(p.name)}"></span>
            <strong style="flex:1">${escapeHtml(p.name)}</strong>
            <button class="btn-logout-rg" ${pend ? 'disabled' : ''} onclick="editProject('${escapeHtml(p.name)}')" title="Editar área e subprojetos">✎</button>
            <button class="btn-logout-rg" ${pend ? 'disabled' : ''} style="color:#E24E3D;border-color:rgba(226,78,61,.4)" onclick="archiveProject('${escapeHtml(p.name)}')" title="Excluir (some do dropdown e dos filtros; histórico continua)">✕</button>
          </div>
          ${(p.subs || []).length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px">${p.subs.map(s => `<span class="tag-badge" style="background:${colorForTag(p.name)}1F;color:${colorForTag(p.name)}">${escapeHtml(s)}</span>`).join('')}</div>` : ''}
          <div class="uc-meta" style="margin-top:10px">na daily aparece como: ${(p.subs || []).length ? p.subs.map(s => `${escapeHtml(p.name)}/${escapeHtml(s)}`).join(' · ') : escapeHtml(p.name)}</div>
          ${statusLine}
        </div>`;
      }).join('');
      return `<div class="role-head"><span class="sq" style="background:${c}"></span><span style="color:${c}">${escapeHtml(area)}</span></div><div class="users-grid">${cards}</div>`;
    }).join('');
  }

  content.innerHTML = listHtml;
}

function editProject(name) {
  _projEditing = name;
  renderProjectsForm();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function cancelEditProject() {
  _projEditing = null;
  renderProjectsForm();
}

async function submitProject() {
  const name = (document.getElementById('proj-name').value || '').trim().toUpperCase();
  const area = (document.getElementById('proj-area').value || '').trim();
  const subs = (document.getElementById('proj-subs').value || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  const status = document.getElementById('proj-status');
  if (!name) { status.className = 'mode-status applying'; status.textContent = '▸ dá um nome pro projeto'; return; }
  const action = _projEditing ? 'update' : 'add';
  try {
    await queueWrite('projects', { action, name, area: area || null, subs });
    const pending = getPendingProjects().filter(pe => normTag(pe.name) !== normTag(name));
    pending.push({ action, name, area: area || null, subs, ts: Date.now() });
    savePendingProjects(pending);
    _projEditing = null;
    renderProjectsForm();  // limpa o form pro próximo cadastro
    refreshProjects();
  } catch (e) {
    status.className = 'mode-status applying';
    status.textContent = '▸ envio não ativado — regras do Firebase precisam liberar /queue/projects';
  }
}

async function archiveProject(name) {
  if (!confirm(`Excluir "${name}"? Ele some do dropdown da daily e dos filtros (o histórico já registrado continua).`)) return;
  try {
    await queueWrite('projects', { action: 'archive', name });
    const pending = getPendingProjects().filter(pe => normTag(pe.name) !== normTag(name));
    pending.push({ action: 'archive', name, ts: Date.now() });
    savePendingProjects(pending);
    refreshProjects();
  } catch (e) {
    alert('Envio não ativado — regras do Firebase precisam liberar /queue/projects.');
  }
}

// ==========================================================
// ROUTER
// ==========================================================
document.addEventListener('DOMContentLoaded', () => {
  const page = document.body.dataset.page;
  if (page === 'login') { initLogin(); return; }
  // registrar é acessível sem login (novos membros ainda não têm a senha)
  if (page === 'register') { mountChrome('register.html'); return; }
  if (!requireAuth()) return;
  if (page === 'dashboard') initDashboard();
  else if (page === 'weekly') initWeekly();
  else if (page === 'users') initMembers();
  else if (page === 'projetos') initProjects();
});
