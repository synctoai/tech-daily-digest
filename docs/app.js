let allItems = [];

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

function setActiveListButton(button) {
  document.querySelectorAll('#list button').forEach((b) => b.classList.remove('active'));
  if (button) button.classList.add('active');
}

function renderMeta(item) {
  const total = item.articleCount > 0 ? item.articleCount : '-';
  document.getElementById('meta').innerHTML = `<span class="mono">${escapeHtml(item.date)}</span> · ${total} 篇`;
}

async function showItem(item) {
  const md = await loadMd(item.md);
  renderMeta(item);
  const rendered = marked.parse(md);
  document.getElementById('content').innerHTML = DOMPurify.sanitize(rendered);
}

function renderListAndBind() {
  const list = document.getElementById('list');
  list.innerHTML = '';

  if (allItems.length === 0) {
    document.getElementById('content').textContent = '暂无日报内容';
    document.getElementById('meta').textContent = '';
    return;
  }

  allItems.forEach((it, idx) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    if (idx === 0) btn.classList.add('active');

    const safeTitle = escapeHtml(it.title || 'Untitled');
    btn.innerHTML = `
      <strong class="mono">${escapeHtml(it.date)}</strong><br />
      <small>${safeTitle.slice(0, 72)}${safeTitle.length > 72 ? '…' : ''}</small>
    `;

    btn.addEventListener('click', async () => {
      setActiveListButton(btn);
      await showItem(it);
    });

    li.appendChild(btn);
    list.appendChild(li);
  });

  showItem(allItems[0]).catch((e) => {
    document.getElementById('content').textContent = `加载失败：${e.message}`;
  });
}

(async function boot() {
  try {
    const { items } = await loadIndex();
    allItems = Array.isArray(items) ? items : [];
    renderListAndBind();
  } catch (e) {
    document.getElementById('content').textContent = `加载失败：${e.message}`;
  }
})();
