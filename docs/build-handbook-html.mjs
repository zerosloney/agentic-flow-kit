import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const mdPath = path.join(__dirname, 'AI_NATIVE_ENGINE_HANDBOOK.md');
const outPath = path.join(__dirname, 'AI_NATIVE_ENGINE_HANDBOOK.html');

const md = fs.readFileSync(mdPath, 'utf8');

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// 简单的 Markdown 转 HTML 渲染器
function renderMarkdown(content) {
  const lines = content.split(/\r?\n/);
  const out = [];
  const toc = [];
  let inCode = false;
  let codeLang = '';
  let codeLines = [];
  let inTable = false;
  let tableHeader = [];
  let tableRows = [];

  function flushTable() {
    if (!inTable) return;
    let html = '<div class="table-container"><table>\n<thead><tr>';
    for (const h of tableHeader) {
      html += `<th>${renderInline(h.trim())}</th>`;
    }
    html += '</tr></thead>\n<tbody>\n';
    for (const row of tableRows) {
      html += '<tr>';
      for (let i = 0; i < tableHeader.length; i++) {
        const cell = row[i] ? row[i].trim() : '';
        html += `<td>${renderInline(cell)}</td>`;
      }
      html += '</tr>\n';
    }
    html += '</tbody></table></div>\n';
    out.push(html);
    inTable = false;
    tableHeader = [];
    tableRows = [];
  }

  function flushCode() {
    if (!inCode) return;
    const rawCode = codeLines.join('\n');
    if (codeLang === 'mermaid') {
      out.push(`<div class="mermaid-box"><pre class="mermaid">${escapeHtml(rawCode)}</pre></div>`);
    } else {
      const langClass = codeLang ? `language-${codeLang}` : '';
      const langLabel = codeLang ? codeLang.toUpperCase() : 'CODE';
      out.push(`
<div class="code-block-wrapper">
  <div class="code-block-header">
    <span class="code-lang-tag">${langLabel}</span>
    <button class="copy-btn" onclick="copyCode(this)" title="复制代码">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
      <span>复制</span>
    </button>
  </div>
  <pre><code class="${langClass}">${escapeHtml(rawCode)}</code></pre>
</div>`);
    }
    inCode = false;
    codeLang = '';
    codeLines = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 代码块
    if (line.startsWith('```')) {
      if (inTable) flushTable();
      if (inCode) {
        flushCode();
      } else {
        inCode = true;
        codeLang = line.slice(3).trim();
        codeLines = [];
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    // 表格识别
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const parts = line.trim().split('|').slice(1, -1);
      if (!inTable) {
        inTable = true;
        tableHeader = parts;
        tableRows = [];
        // 检查下一行是不是分隔行
        if (i + 1 < lines.length && lines[i + 1].includes('---')) {
          i++; // 跳过分隔行
        }
      } else {
        tableRows.push(parts);
      }
      continue;
    } else if (inTable) {
      flushTable();
    }

    // 空行
    if (!line.trim()) {
      out.push('');
      continue;
    }

    // 分隔线
    if (line.trim() === '---' || line.trim() === '***') {
      out.push('<hr />');
      continue;
    }

    // 标题
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const rawText = headingMatch[2].trim();
      const id = slugify(rawText);
      toc.push({ level, text: rawText, id });
      out.push(`<h${level} id="${id}" class="heading-anchor"><a href="#${id}" class="anchor-link">#</a>${renderInline(rawText)}</h${level}>`);
      continue;
    }

    // 引用块
    if (line.startsWith('>')) {
      const quoteText = line.replace(/^>\s?/, '');
      out.push(`<blockquote><p>${renderInline(quoteText)}</p></blockquote>`);
      continue;
    }

    // 无序列表
    if (/^\s*[-*+]\s+/.test(line)) {
      const indent = line.match(/^(\s*)/)[1].length;
      let text = line.replace(/^\s*[-*+]\s+/, '');
      // 任务列表勾选态
      if (text.startsWith('[ ] ')) {
        text = `<input type="checkbox" disabled /> ` + text.slice(4);
      } else if (text.startsWith('[x] ') || text.startsWith('[X] ')) {
        text = `<input type="checkbox" checked disabled /> ` + text.slice(4);
      }
      out.push(`<li class="indent-${indent}">${renderInline(text)}</li>`);
      continue;
    }

    // 有序列表
    if (/^\s*\d+\.\s+/.test(line)) {
      const text = line.replace(/^\s*\d+\.\s+/, '');
      out.push(`<li class="numbered">${renderInline(text)}</li>`);
      continue;
    }

    // 普通段落
    out.push(`<p>${renderInline(line)}</p>`);
  }

  if (inTable) flushTable();
  if (inCode) flushCode();

  return { html: out.join('\n'), toc };
}

function renderInline(text) {
  let s = text;
  // 保护行内代码
  const inlineCodes = [];
  s = s.replace(/`([^`]+)`/g, (m, code) => {
    const placeholder = `__INLINE_CODE_${inlineCodes.length}__`;
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
    return placeholder;
  });

  // 链接与图片
  s = s.replace(/!\[(.*?)\]\((.*?)\)/g, '<img alt="$1" src="$2" />');
  s = s.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  // 加粗 & 斜体
  s = s.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*(.*?)\*/g, '<em>$1</em>');

  // 恢复行内代码
  inlineCodes.forEach((codeHtml, idx) => {
    s = s.replace(`__INLINE_CODE_${idx}__`, codeHtml);
  });

  return s;
}

const { html, toc } = renderMarkdown(md);

// 构建 TOC HTML 侧边栏
let tocHtml = '<ul class="toc-list">';
for (const item of toc) {
  if (item.level === 1) {
    tocHtml += `<li class="toc-item toc-h1"><a href="#${item.id}">${escapeHtml(item.text)}</a></li>`;
  } else if (item.level === 2) {
    tocHtml += `<li class="toc-item toc-h2"><a href="#${item.id}">${escapeHtml(item.text)}</a></li>`;
  } else if (item.level === 3) {
    tocHtml += `<li class="toc-item toc-h3"><a href="#${item.id}">${escapeHtml(item.text)}</a></li>`;
  }
}
tocHtml += '</ul>';

const template = `<!DOCTYPE html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI-Native 软件工程工作流与治理引擎完全手册 · Agentic Flow Kit</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600&family=Inter:wght@400;500;600;700;800&family=Noto+Sans+SC:wght@400;500;700&display=swap" rel="stylesheet">
<!-- Mermaid CDN -->
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
<style>
:root {
  --bg-primary: #ffffff;
  --bg-secondary: #f8fafc;
  --bg-sidebar: #f1f5f9;
  --bg-code: #0f172a;
  --border-color: #e2e8f0;
  --text-primary: #0f172a;
  --text-secondary: #475569;
  --text-muted: #94a3b8;
  --accent: #2563eb;
  --accent-hover: #1d4ed8;
  --accent-light: #eff6ff;
  --success: #16a34a;
  --warning: #d97706;
  --danger: #dc2626;
  --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
  --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
  --sidebar-width: 290px;
}

[data-theme="dark"] {
  --bg-primary: #0b0f19;
  --bg-secondary: #111827;
  --bg-sidebar: #0f172a;
  --bg-code: #030712;
  --border-color: #1f2937;
  --text-primary: #f9fafb;
  --text-secondary: #9ca3af;
  --text-muted: #6b7280;
  --accent: #3b82f6;
  --accent-hover: #60a5fa;
  --accent-light: #1e293b;
  --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.5);
  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.5);
}

* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: 'Inter', 'Noto Sans SC', system-ui, -apple-system, sans-serif;
  background-color: var(--bg-primary);
  color: var(--text-primary);
  line-height: 1.7;
  display: flex;
  min-height: 100vh;
}

/* 顶部导航条 */
.top-nav {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 60px;
  background-color: var(--bg-primary);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  z-index: 100;
  backdrop-filter: blur(8px);
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 700;
  font-size: 1.05rem;
  color: var(--text-primary);
  text-decoration: none;
}
.brand-badge {
  background: linear-gradient(135deg, #2563eb, #7c3aed);
  color: white;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 0.75rem;
  font-weight: 600;
}

.nav-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.btn-icon {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85rem;
  font-weight: 500;
  transition: all 0.2s;
}
.btn-icon:hover {
  background: var(--accent-light);
  border-color: var(--accent);
}

/* 侧边栏 */
.sidebar {
  position: fixed;
  top: 60px;
  bottom: 0;
  left: 0;
  width: var(--sidebar-width);
  background-color: var(--bg-sidebar);
  border-right: 1px solid var(--border-color);
  overflow-y: auto;
  padding: 24px 16px 40px;
  z-index: 90;
}
.sidebar-title {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  margin-bottom: 12px;
  padding-left: 8px;
  font-weight: 700;
}
.toc-list {
  list-style: none;
}
.toc-item {
  margin-bottom: 4px;
}
.toc-item a {
  display: block;
  padding: 6px 10px;
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 0.85rem;
  border-radius: 6px;
  transition: all 0.15s;
  line-height: 1.4;
}
.toc-item a:hover {
  background-color: var(--accent-light);
  color: var(--accent);
}
.toc-item.active a {
  background-color: var(--accent-light);
  color: var(--accent);
  font-weight: 600;
}
.toc-h1 { font-weight: 600; margin-top: 10px; }
.toc-h2 { padding-left: 10px; }
.toc-h3 { padding-left: 20px; font-size: 0.8rem; }

/* 内容主体 */
.main-wrapper {
  margin-left: var(--sidebar-width);
  margin-top: 60px;
  flex: 1;
  max-width: calc(100vw - var(--sidebar-width));
  padding: 48px 60px 100px;
}
.article-content {
  max-width: 960px;
  margin: 0 auto;
}

/* 标题样式 */
h1, h2, h3, h4 {
  color: var(--text-primary);
  font-weight: 700;
  line-height: 1.3;
  position: relative;
}
h1 { font-size: 2.2rem; margin-bottom: 1.2rem; padding-bottom: 0.8rem; border-bottom: 2px solid var(--border-color); }
h2 { font-size: 1.55rem; margin-top: 2.8rem; margin-bottom: 1rem; padding-bottom: 0.4rem; border-bottom: 1px solid var(--border-color); }
h3 { font-size: 1.25rem; margin-top: 2rem; margin-bottom: 0.8rem; }
h4 { font-size: 1.05rem; margin-top: 1.5rem; margin-bottom: 0.6rem; }

.heading-anchor:hover .anchor-link { opacity: 1; }
.anchor-link {
  position: absolute;
  left: -24px;
  opacity: 0;
  color: var(--accent);
  text-decoration: none;
  font-weight: 400;
  transition: opacity 0.2s;
}

p { margin-bottom: 1.15rem; color: var(--text-secondary); }
strong { color: var(--text-primary); }
hr { border: none; border-top: 1px solid var(--border-color); margin: 2.5rem 0; }

a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

/* 引用块 */
blockquote {
  border-left: 4px solid var(--accent);
  background-color: var(--bg-secondary);
  padding: 12px 18px;
  margin-bottom: 1.2rem;
  border-radius: 0 8px 8px 0;
  color: var(--text-secondary);
  font-style: italic;
}
blockquote p { margin-bottom: 0; }

/* 列表 */
li {
  color: var(--text-secondary);
  margin-bottom: 0.45rem;
  list-style-position: inside;
}
li.indent-2 { margin-left: 20px; }
li.indent-4 { margin-left: 40px; }
li input[type="checkbox"] { margin-right: 8px; vertical-align: middle; }

/* 表格 */
.table-container {
  overflow-x: auto;
  margin: 1.5rem 0;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  box-shadow: var(--shadow-sm);
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
  text-align: left;
}
th {
  background-color: var(--bg-secondary);
  color: var(--text-primary);
  font-weight: 600;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
}
td {
  padding: 11px 16px;
  border-bottom: 1px solid var(--border-color);
  color: var(--text-secondary);
}
tr:last-child td { border-bottom: none; }
tr:hover td { background-color: var(--accent-light); }

/* 代码块 */
code {
  font-family: 'Fira Code', Consolas, Monaco, monospace;
  font-size: 0.88em;
  padding: 2px 6px;
  border-radius: 4px;
  background-color: var(--bg-secondary);
  color: #d946ef;
  border: 1px solid var(--border-color);
}
[data-theme="dark"] code { color: #f472b6; }

.code-block-wrapper {
  background-color: var(--bg-code);
  border-radius: 10px;
  margin: 1.5rem 0;
  overflow: hidden;
  box-shadow: var(--shadow-md);
  border: 1px solid var(--border-color);
}
.code-block-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.05);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}
.code-lang-tag {
  font-size: 0.72rem;
  font-weight: 700;
  color: #94a3b8;
  letter-spacing: 0.05em;
}
.copy-btn {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #cbd5e1;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 0.75rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 5px;
  transition: all 0.2s;
}
.copy-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.code-block-wrapper pre {
  padding: 16px;
  overflow-x: auto;
  line-height: 1.6;
}
.code-block-wrapper code {
  background-color: transparent !important;
  color: #e2e8f0 !important;
  border: none !important;
  padding: 0;
  font-size: 0.86rem;
  display: block;
}

/* Mermaid 容器 */
.mermaid-box {
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 24px;
  margin: 1.8rem 0;
  display: flex;
  justify-content: center;
  overflow-x: auto;
  box-shadow: var(--shadow-sm);
}

/* 响应式适配 */
@media (max-width: 1024px) {
  .sidebar { transform: translateX(-100%); transition: transform 0.3s; }
  .sidebar.open { transform: translateX(0); }
  .main-wrapper { margin-left: 0; max-width: 100vw; padding: 32px 24px 80px; }
  .menu-toggle { display: flex !important; }
}

.menu-toggle {
  display: none;
}

@media print {
  .top-nav, .sidebar, .copy-btn { display: none !important; }
  .main-wrapper { margin-left: 0 !important; padding: 0 !important; }
}
</style>
</head>
<body>

<header class="top-nav">
  <div style="display:flex;align-items:center;gap:12px;">
    <button class="btn-icon menu-toggle" onclick="toggleSidebar()" title="展开目录">☰ 目录</button>
    <a href="#" class="brand">
      <span>🛡️ Agentic Flow Kit</span>
      <span class="brand-badge">Engine Handbook</span>
    </a>
  </div>
  <div class="nav-actions">
    <button class="btn-icon" onclick="window.print()" title="打印或保存为 PDF">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
      <span>打印/PDF</span>
    </button>
    <button class="btn-icon" onclick="toggleTheme()" title="切换亮暗色模式">
      <span id="theme-icon">🌙</span>
      <span id="theme-text">暗色</span>
    </button>
  </div>
</header>

<aside class="sidebar" id="sidebar">
  <div class="sidebar-title">手册目录导航 (TOC)</div>
  ${tocHtml}
</aside>

<main class="main-wrapper">
  <article class="article-content">
    ${html}
  </article>
</main>

<script>
// 初始化 Mermaid
mermaid.initialize({
  startOnLoad: true,
  theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'default',
  securityLevel: 'loose'
});

// 主题切换
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('handbook-theme', next);
  document.getElementById('theme-icon').textContent = next === 'dark' ? '☀️' : '🌙';
  document.getElementById('theme-text').textContent = next === 'dark' ? '亮色' : '暗色';
}

const savedTheme = localStorage.getItem('handbook-theme');
if (savedTheme) {
  document.documentElement.setAttribute('data-theme', savedTheme);
  document.getElementById('theme-icon').textContent = savedTheme === 'dark' ? '☀️' : '🌙';
  document.getElementById('theme-text').textContent = savedTheme === 'dark' ? '亮色' : '暗色';
}

// 侧边栏展开
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// 复制代码
function copyCode(btn) {
  const code = btn.closest('.code-block-wrapper').querySelector('code').innerText;
  navigator.clipboard.writeText(code).then(() => {
    const textSpan = btn.querySelector('span');
    const originalText = textSpan.textContent;
    textSpan.textContent = '已复制!';
    btn.style.color = '#4ade80';
    setTimeout(() => {
      textSpan.textContent = originalText;
      btn.style.color = '';
    }, 2000);
  });
}

// 目录滚动联动
const headings = document.querySelectorAll('.heading-anchor');
const tocLinks = document.querySelectorAll('.toc-item a');

window.addEventListener('scroll', () => {
  let currentId = '';
  headings.forEach(h => {
    const rect = h.getBoundingClientRect();
    if (rect.top <= 120) {
      currentId = h.id;
    }
  });

  tocLinks.forEach(link => {
    const parent = link.closest('.toc-item');
    if (link.getAttribute('href') === '#' + currentId) {
      parent.classList.add('active');
    } else {
      parent.classList.remove('active');
    }
  });
});
</script>

</body>
</html>`;

fs.writeFileSync(outPath, template, 'utf8');
console.log('✅ HTML 手册生成完成: ' + outPath);
