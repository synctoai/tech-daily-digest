# tech-daily-digest

每日抓取科技博客 RSS，生成按日期归档的 Tech Digest（Markdown），并支持 GitHub Pages 在线查看（含移动端适配）。

## 功能

- 聚合 90+ 技术博客 RSS 源
- 按时间窗口过滤（24/48/72h）
- 生成中文/英文日报（`output/tech-digest-YYYY-MM-DD-(zh|en).md`）
- 一键构建 GitHub Pages 数据（`docs/data/index.json`）
- 内置移动端友好的日报浏览页面
- 提供基础安全扫描工作流（gitleaks）

---

## 目录结构

```text
tech-daily-digest/
├── SKILL.md
├── README.md
├── package.json
├── scripts/
│   ├── rss-feeds.mjs
│   ├── digest.mjs
│   ├── digest-complete.mjs
│   ├── build-pages.mjs
│   └── sync-pages-and-push.mjs
├── output/
│   └── tech-digest-YYYY-MM-DD-(zh|en).md
└── docs/
    ├── index.html
    ├── app.js
    ├── styles.css
    └── data/
        ├── index.json
        └── tech-digest-*.md
```

---

## 使用方法

## 1) 生成日报

```bash
cd /Users/leeeeeee/.openclaw/workspace-discord/skills/tech-daily-digest

# 中文日报（24 小时）
node scripts/digest-complete.mjs --hours 24 --top-n 15 --lang zh --with-ai

# 英文日报（48 小时）
node scripts/digest-complete.mjs --hours 48 --top-n 10 --lang en --with-ai
```

## 2) 构建 GitHub Pages 数据

```bash
npm run build:pages
```

该命令会：

- 扫描 `output/tech-digest-YYYY-MM-DD-(zh|en).md`
- 复制到 `docs/data/`
- 生成索引文件 `docs/data/index.json`

## 3) 推送更新（含 pages 文件）

```bash
npm run sync:pages
```

---

## 启用 GitHub Pages

在 GitHub 仓库中：

1. 进入 **Settings → Pages**
2. Source 选择 **Deploy from a branch**
3. Branch 选择 **main**，Folder 选择 **/docs**
4. 保存

页面地址将是：

```text
https://synctoai.github.io/tech-daily-digest/
```

---

## 安全建议（重点）

1. **不要把 API Key 写入仓库文件**（尤其是 `scripts/*.mjs`、`output/*.md`）
2. 统一使用环境变量传递密钥
3. 仅提交必要产物，缓存目录（`.cache/`）保持忽略
4. 保持 secret-scan 工作流开启，发现泄露立即 rotate 密钥

---

## GitHub Actions

- `.github/workflows/pages-refresh.yml`
  - 每日定时刷新 pages 数据（从 `output/*.md` 生成 `docs/data/*`）
- `.github/workflows/secret-scan.yml`
  - push / PR / 定时触发 gitleaks

---

## 常用命令速查

```bash
# 生成日报
node scripts/digest-complete.mjs --hours 24 --top-n 15 --lang zh --with-ai

# 构建 pages
npm run build:pages

# 查看变更
git status

# 提交并推送
git add . && git commit -m "chore: update daily digest" && git push
```
