---
name: tech-daily-digest
description: 每日科技前沿资讯获取与整理。Use when user wants to (1) get daily tech news digest, (2) schedule automatic tech news delivery, (3) fetch and summarize articles from top tech blogs. Works with RSS feeds from Hacker News top blogs, uses AI to score, categorize, and summarize articles into structured daily digest.
---

# Tech Daily Digest - 每日科技资讯

自动从顶级技术博客获取最新文章，通过 AI 评分、分类和摘要，生成结构化的每日科技资讯日报。

## 信息源

90+ 个顶级技术博客 RSS 源，精选自 Hacker News 社区最受欢迎的独立技术博客：
- simonwillison.net (AI/Web开发)
- paulgraham.com (创业/技术观点)
- overreacted.io (React/前端)
- krebsonsecurity.com (安全)
- antirez.com (Redis作者)
- gwern.net (AI研究)
- 等等...

## 使用方法

### 手动获取今日资讯

```bash
# 获取最近 24 小时的资讯
cd /Users/leeeeeee/.openclaw/workspace-discord/skills/tech-daily-digest
node scripts/digest.mjs --hours 24 --top-n 15 --lang zh

# 获取最近 48 小时的资讯，英文输出
node scripts/digest.mjs --hours 48 --top-n 10 --lang en

# 保存到文件
node scripts/digest.mjs --hours 48 --top-n 15 --lang zh --output ~/tech-digest.md
```

### 参数说明

| 参数 | 说明 | 默认值 |
|-----|------|-------|
| `--hours` | 时间范围（24h/48h/72h/7d） | 48 |
| `--top-n` | 精选文章数量 | 15 |
| `--lang` | 输出语言（zh/en） | zh |
| `--output` | 输出文件路径 | 控制台输出 |

### 定时任务

使用 OpenClaw cron 设置每日自动推送：

```bash
# 每天早上 9:00 自动获取并推送资讯
openclaw cron add \
  --name "daily-tech-digest" \
  --schedule "0 9 * * *" \
  --command "cd /Users/leeeeeee/.openclaw/workspace-discord/skills/tech-daily-digest && node scripts/digest.mjs --hours 24 --top-n 15 --lang zh"
```

## 输出格式

生成的日报包含以下板块：

### 📊 数据概览
- 文章总数、分类分布
- 关键词云
- 来源分布

### 🔥 今日必读 (Top 3)
深度展示评分最高的 3 篇文章：
- 中英双语标题
- AI 生成的结构化摘要（4-6 句）
- 推荐理由
- 关键词标签

### 📑 分类文章列表
按 6 大分类分组：
- 🤖 AI / ML
- 🔒 安全
- ⚙️ 工程
- 🛠 工具 / 开源
- 💡 观点 / 杂谈
- 📝 其他

### 📝 今日看点
AI 归纳的当日技术圈 2-3 个宏观趋势

## 处理流程

```
RSS 抓取 → 时间过滤 → AI 评分+分类 → AI 摘要+翻译 → 趋势总结
```

1. **RSS 抓取** — 并发抓取 90+ 个源
2. **时间过滤** — 按指定时间窗口筛选
3. **AI 评分** — 从相关性、质量、时效性三维度打分（1-10）
4. **AI 摘要** — 生成结构化摘要、中文标题翻译
5. **趋势总结** — 归纳宏观技术趋势

## 技术实现

- 纯 JavaScript/Node.js，无第三方依赖
- 使用内置 `fetch` API
- 使用 kimi-coding/k2p5 模型进行 AI 处理
- 支持 RSS 2.0 和 Atom 格式

## 脚本文件

- `scripts/digest.mjs` — 主脚本，执行完整的资讯获取和生成流程
- `scripts/rss-feeds.mjs` — RSS 源定义

运行脚本前确保当前工作目录是技能根目录。
