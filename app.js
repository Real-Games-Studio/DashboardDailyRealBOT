// ==========================================
// CONFIGURAÇÃO
// ==========================================
const CONFIG = {
  JSONBIN_BASE: 'https://api.jsonbin.io/v3/b',
  ACCESS_KEY: '$2a$10$Mtd.pN.Z0lRl9LI2o23wS.u9f4ZXMVXQ7uvgZcpw2A5M0Pao22Pme',
  USERS_BIN: '69cc2461aaba882197b0dc8a',
  REPORTS_BIN: '69cc2461aaba882197b0dc91',
  PASSWORD_HASH: '2e014b2fbd7de75f3527cbd40028621025f0e2384a44f1bb06e86e5d3b5c5911',
};

// ==========================================
// AUTH
// ==========================================
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const buffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function isAuthenticated() {
  return sessionStorage.getItem('dailybot_auth') === 'true';
}

function requireAuth() {
  if (!isAuthenticated()) {
    window.location.href = 'index.html';
    return false;
  }
  return true;
}

function logout() {
  sessionStorage.removeItem('dailybot_auth');
  window.location.href = 'index.html';
}

// ==========================================
// DATA FETCHING
// ==========================================
async function fetchBin(binId) {
  const res = await fetch(`${CONFIG.JSONBIN_BASE}/${binId}/latest`, {
    headers: { 'X-Access-Key': CONFIG.ACCESS_KEY },
  });
  if (!res.ok) throw new Error(`Erro ao buscar dados: ${res.status}`);
  const json = await res.json();
  return json.record;
}

async function loadAllData() {
  const [usersBin, reportsBin] = await Promise.all([
    fetchBin(CONFIG.USERS_BIN),
    fetchBin(CONFIG.REPORTS_BIN),
  ]);
  return {
    users: usersBin.users || [],
    reports: reportsBin.reports || [],
  };
}

// ==========================================
// HELPERS
// ==========================================
function avatarURL(user) {
  if (user.avatar) {
    return `https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.png`;
  }
  return `https://cdn.discordapp.com/embed/avatars/${parseInt(user.discordId) % 5}.png`;
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

function formatDateLong(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('pt-BR', { timeZone: 'UTC', day: '2-digit', month: 'long', year: 'numeric' });
}

function formatWeekday(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('pt-BR', { timeZone: 'UTC', weekday: 'long' });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Formata o texto das respostas da daily para HTML legível.
 * - Detecta itens com hífen (` - ` ou início de linha com `- `) → <ul><li>
 * - Respeita quebras de linha \n
 * - Faz escape de HTML para segurança
 */
function formatText(text) {
  if (!text) return '';

  // Normaliza: troca " - " (separador inline) por quebra de linha + hífen
  // para unificar o tratamento
  let normalized = text
    .replace(/\r\n/g, '\n')
    // " - " no meio de uma linha vira newline + "- "
    .replace(/ - /g, '\n- ');

  const lines = normalized.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // Verifica se a maioria das linhas são itens de lista
  const listLines = lines.filter(l => l.startsWith('- ') || l.startsWith('* '));
  const isList = listLines.length > 0 && listLines.length >= Math.ceil(lines.length / 2);

  if (isList) {
    // Renderiza como lista <ul>
    let html = '<ul class="report-list">';
    for (const line of lines) {
      if (line.startsWith('- ') || line.startsWith('* ')) {
        html += `<li>${escapeHtml(line.slice(2))}</li>`;
      } else {
        // Linha sem hífen dentro de um bloco de lista → item também
        html += `<li>${escapeHtml(line)}</li>`;
      }
    }
    html += '</ul>';
    return html;
  }

  // Texto normal: respeita quebras de linha
  return lines.map(l => `<span>${escapeHtml(l)}</span>`).join('<br>');
}

// ==========================================
// RENDERERS
// ==========================================
function renderDashboard(reports, userMap) {
  const container = document.getElementById('content');

  if (reports.length === 0) {
    container.innerHTML = `
      <div class="table-wrapper">
        <div class="empty-state">
          <div class="icon">🗂️</div>
          <p>Nenhum relatório encontrado ainda.<br>Os relatórios aparecem aqui após a daily do dia.</p>
        </div>
      </div>`;
    return;
  }

  const sorted = [...reports]
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 50);

  let rows = '';
  for (const r of sorted) {
    const user = userMap.get(r.userId);
    const userCell = user
      ? `<div class="user-cell"><img src="${avatarURL(user)}" alt="${escapeHtml(user.username)}" /><strong>${escapeHtml(user.username)}</strong></div>`
      : '<span style="color:#4a5568">Usuário removido</span>';

    const yesterday = r.yesterday
      ? `<td class="text-cell">${formatText(r.yesterday)}</td>`
      : '<td class="text-cell empty">—</td>';

    const today = r.today
      ? `<td class="text-cell">${formatText(r.today)}</td>`
      : '<td class="text-cell empty">—</td>';

    const blockers = r.blockers
      ? `<td class="text-cell"><span class="badge-blocker">🚧 ${formatText(r.blockers)}</span></td>`
      : '<td class="text-cell"><span style="color:#22c55e">✓ Nenhum</span></td>';

    rows += `<tr>
      <td>${userCell}</td>
      ${yesterday}
      ${today}
      ${blockers}
      <td class="date-cell hide-mobile">${formatDate(r.date)}</td>
    </tr>`;
  }

  container.innerHTML = `
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Usuário</th>
            <th>Ontem</th>
            <th>Hoje</th>
            <th>Impedimentos</th>
            <th class="hide-mobile">Data</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderUserSelect(users, selectedId) {
  const select = document.getElementById('user-select');
  select.innerHTML = '<option value="">Selecione um membro...</option>';
  const sorted = [...users].sort((a, b) => a.username.localeCompare(b.username));
  for (const u of sorted) {
    const opt = document.createElement('option');
    opt.value = u._id;
    opt.textContent = u.username;
    if (u._id === selectedId) opt.selected = true;
    select.appendChild(opt);
  }
}

function renderMePage(user, reports) {
  const container = document.getElementById('content');

  if (!user) {
    container.innerHTML = `
      <div class="empty-state boxed">
        <div class="icon">👆</div>
        <p>Selecione um membro acima para ver o histórico.</p>
      </div>`;
    return;
  }

  const userReports = reports
    .filter(r => r.userId === user._id)
    .sort((a, b) => b.date.localeCompare(a.date));

  const total = userReports.length;
  const withBlockers = userReports.filter(r => r.blockers).length;

  let html = `
    <div class="profile-header">
      <img src="${avatarURL(user)}" alt="${escapeHtml(user.username)}" />
      <div class="profile-info">
        <h2>${escapeHtml(user.username)}</h2>
        <p>Histórico pessoal de dailies</p>
      </div>
    </div>

    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-value">${total}</div>
        <div class="stat-label">Dailies enviadas</div>
      </div>
      <div class="stat-card">
        <div class="stat-value red">${withBlockers}</div>
        <div class="stat-label">Com impedimentos</div>
      </div>
      <div class="stat-card">
        <div class="stat-value green">${total - withBlockers}</div>
        <div class="stat-label">Sem impedimentos</div>
      </div>
    </div>

    <div class="section-title">Histórico de Relatórios</div>`;

  if (userReports.length === 0) {
    html += `
      <div class="empty-state boxed">
        <div class="icon">📭</div>
        <p>Este membro ainda não tem relatórios registrados.</p>
      </div>`;
  } else {
    html += '<div class="reports-grid">';
    for (const r of userReports) {
      const dateStr = formatDateLong(r.date);
      const dayStr = formatWeekday(r.date);

      const yesterdayP = r.yesterday
        ? `<div class="report-text">${formatText(r.yesterday)}</div>`
        : '<p class="empty">Não informado</p>';

      const todayP = r.today
        ? `<div class="report-text">${formatText(r.today)}</div>`
        : '<p class="empty">Não informado</p>';

      const blockersP = r.blockers
        ? `<div class="report-text blocker">${formatText(r.blockers)}</div>`
        : '<p style="color:#22c55e">Nenhum</p>';

      html += `
        <div class="report-card">
          <div class="report-card-header">
            <div class="report-date">${dateStr}</div>
            <span class="day-badge">${dayStr}</span>
          </div>
          <div class="report-fields">
            <div class="report-field"><label>📅 Ontem</label>${yesterdayP}</div>
            <div class="report-field"><label>🎯 Hoje</label>${todayP}</div>
            <div class="report-field"><label>🚧 Impedimentos</label>${blockersP}</div>
          </div>
        </div>`;
    }
    html += '</div>';
  }

  container.innerHTML = html;
}

// ==========================================
// PAGE INIT
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  const page = document.body.dataset.page;

  if (page === 'login') {
    initLogin();
  } else if (page === 'dashboard') {
    if (requireAuth()) initDashboard();
  } else if (page === 'me') {
    if (requireAuth()) initMe();
  }
});

async function initLogin() {
  if (isAuthenticated()) {
    window.location.href = 'dashboard.html';
    return;
  }

  const form = document.getElementById('login-form');
  const errorEl = document.getElementById('login-error');

  form.addEventListener('submit', async (e) => {
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

async function initDashboard() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading"><div class="spinner"></div><p>Carregando relatórios...</p></div>';

  try {
    const { users, reports } = await loadAllData();
    const userMap = new Map(users.map(u => [u._id, u]));
    renderDashboard(reports, userMap);
  } catch (err) {
    content.innerHTML = `<div class="empty-state boxed"><div class="icon">⚠️</div><p>Erro ao carregar dados.<br>${escapeHtml(err.message)}</p></div>`;
  }
}

async function initMe() {
  const content = document.getElementById('content');
  const select = document.getElementById('user-select');
  content.innerHTML = '<div class="loading"><div class="spinner"></div><p>Carregando...</p></div>';

  try {
    const { users, reports } = await loadAllData();
    const savedUserId = localStorage.getItem('dailybot_selected_user');

    renderUserSelect(users, savedUserId);

    const selectedUser = users.find(u => u._id === savedUserId);
    if (selectedUser) {
      renderMePage(selectedUser, reports);
    } else {
      content.innerHTML = `
        <div class="empty-state boxed">
          <div class="icon">👆</div>
          <p>Selecione um membro acima para ver o histórico.</p>
        </div>`;
    }

    select.addEventListener('change', () => {
      const userId = select.value;
      if (userId) {
        localStorage.setItem('dailybot_selected_user', userId);
        const user = users.find(u => u._id === userId);
        renderMePage(user, reports);
      } else {
        localStorage.removeItem('dailybot_selected_user');
        content.innerHTML = `
          <div class="empty-state boxed">
            <div class="icon">👆</div>
            <p>Selecione um membro acima para ver o histórico.</p>
          </div>`;
      }
    });
  } catch (err) {
    content.innerHTML = `<div class="empty-state boxed"><div class="icon">⚠️</div><p>Erro ao carregar dados.<br>${escapeHtml(err.message)}</p></div>`;
  }
}
