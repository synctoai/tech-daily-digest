let allItems = [];
let currentLang = 'all';

async function loadIndex() {
  const res = await fetch('./data/index.json');
  if (!res.ok) throw new Error('无法读取 data/index.json');
  return res.json();
}

async function loadMd(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`无法读取 ${path}`);
  return res.text();
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatLang(lang) {
  return lang === 'en' ? 'EN' : 'ZH';
}

function getFilteredItems() {
  return currentLang === 'all' ? allItems : allItems.filter((it) => it.lang === currentLang);
}

function setActiveFilter(lang) {
  currentLang = lang;
  document.querySelectorAll('.chip').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });
}

function setActiveListButton(button) {
  document.querySelectorAll('#list button').forEach((b) => b.classList.remove('active'));
  if (button) button.classList.add('active');
}

function renderMeta(item) {
  const total = item.articleCount > 0 ? item.articleCount : '-';
  document.getElementById('meta').innerHTML = [
    `<span class="mono">${escapeHtml(item.date)}</span>`,
    `<span class="badge">${formatLang(item.lang)}</span>`,
    `· ${total} 篇`
  ].join(' ');
}

async function showItem(item) {
  const md = await loadMd(item.md);
  renderMeta(item);
  const rendered = marked.parse(md);
  document.getElementById('content').innerHTML = DOMPurify.sanitize(rendered);
}

function renderListAndBind() {
  const list = document.getElementById('list');
  const items = getFilteredItems();
  list.innerHTML = '';

  if (items.length === 0) {
    document.getElementById('content').textContent = '当前筛选条件下暂无日报内容';
    document.getElementById('meta').textContent = '';
    return;
  }

  items.forEach((it, idx) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    if (idx === 0) btn.classList.add('active');

    const safeTitle = escapeHtml(it.title || 'Untitled');
    btn.innerHTML = `
      <strong class="mono">${escapeHtml(it.date)}</strong>
      <span class="badge">${formatLang(it.lang)}</span><br />
      <small>${safeTitle.slice(0, 72)}${safeTitle.length > 72 ? '…' : ''}</small>
    `;

    btn.addEventListener('click', async () => {
      setActiveListButton(btn);
      await showItem(it);
    });

    li.appendChild(btn);
    list.appendChild(li);
  });

  showItem(items[0]).catch((e) => {
    document.getElementById('content').textContent = `加载失败：${e.message}`;
  });
}

function bindFilters() {
  document.querySelectorAll('.chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const lang = btn.dataset.lang || 'all';
      setActiveFilter(lang);
      renderListAndBind();
    });
  });
}

(async function boot() {
  try {
    const { items } = await loadIndex();
    allItems = Array.isArray(items) ? items : [];

    if (allItems.length === 0) {
      document.getElementById('content').textContent = '暂无日报内容';
      return;
    }

    bindFilters();
    renderListAndBind();
  } catch (e) {
    document.getElementById('content').textContent = `加载失败：${e.message}`;
  }
})();
