#!/usr/bin/env node
/**
 * Tech Daily Digest - AI 增强版
 * 集成 OpenClaw AI 分析功能
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RSS_FEEDS, CATEGORIES } from './rss-feeds.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 配置
const CONFIG = {
  timeout: 15000,
  concurrency: 10,
  translateConcurrency: 6,
  summaryFetchConcurrency: 4,
  summaryFetchTimeout: 12000,
  cacheDir: join(__dirname, '..', '.cache'),
  outputDir: join(__dirname, '..', 'output'),
  zhTranslateCacheFile: join(__dirname, '..', '.cache', 'zh-translation-cache.json')
};

// 解析参数
function parseArgs() {
  const args = process.argv.slice(2);
  const getArg = (flag) => {
    const idx = args.indexOf(flag);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
  };

  return {
    hours: parseInt(getArg('--hours')) || 48,
    topN: parseInt(getArg('--top-n')) || 15,
    lang: getArg('--lang') || 'zh',
    output: getArg('--output'),
    withAI: args.includes('--with-ai'),
    help: args.includes('--help') || args.includes('-h')
  };
}

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

function compactText(text = '') {
  return String(text).replace(/\s+/g, ' ').trim();
}

function truncate(text = '', maxLen = 180) {
  const t = compactText(text);
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen)}...`;
}

function shouldTranslateToZh(text) {
  const t = compactText(text);
  return /[A-Za-z]/.test(t) && !/[\u4e00-\u9fff]/.test(t);
}

function parsePublishedDate(value) {
  const v = compactText(value);
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function ensureSentence(text) {
  const t = compactText(text);
  if (!t) return '';
  return /[。！？.!?]$/.test(t) ? t : `${t}。`;
}

async function loadZhTranslationCache() {
  try {
    const raw = await readFile(CONFIG.zhTranslateCacheFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
    return {};
  } catch {
    return {};
  }
}

async function saveZhTranslationCache(cache) {
  await writeFile(CONFIG.zhTranslateCacheFile, JSON.stringify(cache, null, 2), 'utf8');
}

async function translateToZh(text, cache) {
  const source = compactText(text);
  if (!source) return '';
  if (!shouldTranslateToZh(source)) return source;

  if (cache[source]) return cache[source];

  try {
    const url =
      'https://translate.googleapis.com/translate_a/single' +
      `?client=gtx&sl=auto&tl=zh-CN&dt=t&q=${encodeURIComponent(source)}`;

    const response = await fetch(url, {
      headers: { 'User-Agent': 'TechDailyDigest/1.0' }
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    const translated = (data?.[0] || [])
      .map((seg) => seg?.[0] || '')
      .join('')
      .trim();

    const finalText = translated || source;
    cache[source] = finalText;

    return finalText;
  } catch {
    return source;
  }
}

async function translateManyToZh(texts, cache) {
  const unique = [...new Set(texts.map((t) => compactText(t)).filter(Boolean))];
  const result = new Map();

  let cursor = 0;

  async function worker() {
    while (cursor < unique.length) {
      const idx = cursor++;
      const source = unique[idx];
      const translated = await translateToZh(source, cache);
      result.set(source, translated);
    }
  }

  const workers = Array.from({ length: CONFIG.translateConcurrency }, () => worker());
  await Promise.all(workers);

  return result;
}

// RSS 获取
async function fetchFeed(feed) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.timeout);

    const response = await fetch(feed.xmlUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'TechDailyDigest/1.0' }
    });
    clearTimeout(timeout);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } catch {
    return null;
  }
}

// 解析 RSS
function parseArticles(xmlText, feed) {
  if (!xmlText) return [];
  const articles = [];

  // RSS 格式
  const rssItems = xmlText.match(/<item[^>]*>([\s\S]*?)<\/item>/gi) || [];
  for (const item of rssItems) {
    const title = extractTag(item, 'title');
    const link = extractTag(item, 'link');
    const pubDate =
      extractTag(item, 'pubDate') || extractTag(item, 'dc:date') || extractTag(item, 'published');
    const desc = extractTag(item, 'description') || extractTag(item, 'content:encoded');

    if (title && link) {
      articles.push({
        title: cleanText(title),
        titleZh: cleanText(title),
        link: link.trim(),
        pubDate: parsePublishedDate(pubDate),
        description: cleanText(desc).slice(0, 500),
        hotSummaryZh: '',
        source: feed.name,
        sourceUrl: feed.htmlUrl
      });
    }
  }

  // Atom 格式
  if (articles.length === 0) {
    const atomEntries = xmlText.match(/<entry[^>]*>([\s\S]*?)<\/entry>/gi) || [];
    for (const entry of atomEntries) {
      const title = extractTag(entry, 'title');
      const linkMatch = entry.match(/<link[^>]*href=["']([^"']+)["']/i);
      const updated =
        extractTag(entry, 'updated') || extractTag(entry, 'published') || extractTag(entry, 'dc:date');
      const summary = extractTag(entry, 'summary') || extractTag(entry, 'content');

      if (title && linkMatch) {
        articles.push({
          title: cleanText(title),
          titleZh: cleanText(title),
          link: linkMatch[1],
          pubDate: parsePublishedDate(updated),
          description: cleanText(summary).slice(0, 500),
          hotSummaryZh: '',
          source: feed.name,
          sourceUrl: feed.htmlUrl
        });
      }
    }
  }

  return articles;
}

function extractTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (!match) return '';
  // 移除 CDATA
  let content = match[1];
  const cdataMatch = content.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  if (cdataMatch) content = cdataMatch[1];
  return content.trim();
}

function cleanText(text) {
  if (!text) return '';
  // 移除 CDATA
  const cdataMatch = text.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  if (cdataMatch) text = cdataMatch[1];
  // 解码常见实体，再移除 HTML 标签
  text = decodeHtmlEntities(text);
  text = text.replace(/<[^>]+>/g, ' ');
  // 规范化空白
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

// 文章处理
function filterArticles(articles, hours) {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
  return articles.filter((a) => a.pubDate instanceof Date && !Number.isNaN(a.pubDate.getTime()) && a.pubDate >= cutoff);
}

function deduplicate(articles) {
  const seen = new Set();
  return articles.filter((a) => {
    if (seen.has(a.link)) return false;
    seen.add(a.link);
    return true;
  });
}

function categorizeArticle(article) {
  const text = (article.title + ' ' + article.description).toLowerCase();

  const keywords = {
    AI_ML: ['ai', 'llm', 'gpt', 'machine learning', 'neural', 'transformer', 'openai', 'anthropic', 'claude', '模型', '人工智能', '机器学习'],
    SECURITY: ['security', 'vulnerability', 'exploit', 'hack', 'privacy', 'encryption', '安全', '漏洞', '黑客', '加密'],
    TOOLS_OPENSOURCE: ['github', 'release', 'tool', 'library', 'framework', '开源', '工具', '库', '框架'],
    ENGINEERING: ['architecture', 'performance', 'scalability', 'database', '架构', '性能', '数据库'],
    OPINION: ['opinion', 'essay', 'thoughts', 'career', '观点', '思考', '职业']
  };

  for (const [cat, words] of Object.entries(keywords)) {
    if (words.some((w) => text.includes(w))) return cat;
  }
  return 'OTHER';
}

function decodeHtmlEntities(text = '') {
  return text
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

function extractMetaDescription(html) {
  const metaTags = html.match(/<meta[^>]+>/gi) || [];
  for (const tag of metaTags) {
    const name = (tag.match(/(?:name|property)=['"]([^'"]+)['"]/i)?.[1] || '').toLowerCase();
    if (!['description', 'og:description', 'twitter:description'].includes(name)) continue;

    const content = tag.match(/content=['"]([\s\S]*?)['"]/i)?.[1] || '';
    const cleaned = compactText(decodeHtmlEntities(content));
    if (cleaned.length >= 30) return cleaned;
  }
  return '';
}

function extractFirstParagraph(html) {
  const matches = html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi);
  for (const m of matches) {
    const cleaned = compactText(decodeHtmlEntities(cleanText(m[1])));
    if (cleaned.length >= 50) return cleaned;
  }
  return '';
}

async function fetchArticleSnippet(article) {
  const localDesc = compactText(article.description);
  if (localDesc.length >= 60) return localDesc;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.summaryFetchTimeout);

    const response = await fetch(article.link, {
      signal: controller.signal,
      headers: { 'User-Agent': 'TechDailyDigest/1.0' }
    });

    clearTimeout(timeout);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const html = await response.text();
    const metaDescription = extractMetaDescription(html);
    if (metaDescription) return metaDescription;

    const firstParagraph = extractFirstParagraph(html);
    if (firstParagraph) return firstParagraph;
  } catch {
    // ignore and fallback below
  }

  return localDesc || article.title;
}

function buildHotSummaryParagraphZh(titleZh, summaryZh) {
  const titleText = compactText(titleZh) || '该文';
  const summaryText = compactText(summaryZh);

  if (!summaryText || summaryText.length < 18) {
    return `这篇文章围绕《${titleText}》展开，介绍了作者的核心观点与实践经验，适合快速了解相关主题。`;
  }

  const normalized = ensureSentence(truncate(summaryText, 220));
  return `这篇文章围绕《${titleText}》展开，核心要点是：${normalized}`;
}

async function localizeArticlesForChinese(articles, topN, translationCache) {
  const titleMap = await translateManyToZh(articles.map((a) => a.title), translationCache);

  for (const article of articles) {
    article.titleZh = titleMap.get(compactText(article.title)) || article.title;
  }

  const hotArticles = articles.slice(0, Math.min(topN, articles.length));
  const snippetSources = new Map();

  let cursor = 0;
  async function worker() {
    while (cursor < hotArticles.length) {
      const idx = cursor++;
      const article = hotArticles[idx];
      const snippet = await fetchArticleSnippet(article);
      snippetSources.set(article.link, snippet);
    }
  }

  await Promise.all(Array.from({ length: CONFIG.summaryFetchConcurrency }, () => worker()));

  const summaryMap = await translateManyToZh([...snippetSources.values()], translationCache);

  for (const article of hotArticles) {
    const sourceSnippet = snippetSources.get(article.link) || article.description || article.title;
    const translatedSummary = summaryMap.get(compactText(sourceSnippet)) || sourceSnippet;
    article.hotSummaryZh = buildHotSummaryParagraphZh(article.titleZh || article.title, translatedSummary);
  }
}

// 生成报告
function generateReport(articles, options) {
  const { hours, topN, lang } = options;
  const now = new Date();

  const stats = {
    total: articles.length,
    sources: new Set(articles.map((a) => a.source)).size
  };

  const byCategory = {};
  articles.forEach((a) => {
    const cat = a.category || 'OTHER';
    byCategory[cat] = (byCategory[cat] || 0) + 1;
  });

  const displayTitle = (article) => (lang === 'zh' ? article.titleZh || article.title : article.title);

  let report = `# 📰 Tech Daily Digest - ${now.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US')}\n\n`;
  report += `> ${lang === 'zh' ? '从 90+ 个顶级技术博客精选的每日科技资讯' : 'Curated daily tech news from 90+ top tech blogs'}\n\n`;

  // 概览
  report += `## 📊 ${lang === 'zh' ? '数据概览' : 'Overview'}\n\n`;
  report += `- **${lang === 'zh' ? '文章总数' : 'Total'}**: ${stats.total}\n`;
  report += `- **${lang === 'zh' ? '来源' : 'Sources'}**: ${stats.sources} blogs\n`;
  report += `- **${lang === 'zh' ? '时间范围' : 'Time Range'}**: ${hours}h\n\n`;

  // 分类
  report += `### ${lang === 'zh' ? '分类分布' : 'Categories'}\n\n`;
  Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .forEach(([cat, count]) => {
      const info = CATEGORIES[cat] || CATEGORIES.OTHER;
      report += `- ${info.emoji} ${lang === 'zh' ? info.name : cat}: ${count}\n`;
    });
  report += '\n';

  // 热门文章
  const topArticles = articles.slice(0, Math.min(topN, articles.length));
  report += `## 🔥 ${lang === 'zh' ? '热门文章' : 'Top Articles'}\n\n`;

  topArticles.forEach((a, i) => {
    const info = CATEGORIES[a.category] || CATEGORIES.OTHER;
    report += `### ${i + 1}. ${info.emoji} [${displayTitle(a)}](${a.link})\n`;
    report += `- ${lang === 'zh' ? '来源' : 'Source'}: ${a.source}\n`;

    if (lang === 'zh') {
      const summary =
        a.hotSummaryZh ||
        buildHotSummaryParagraphZh(displayTitle(a), truncate(a.description || displayTitle(a), 200));
      report += `- 中文总结：${summary}\n`;
    } else if (a.description) {
      report += `- ${truncate(a.description, 200)}\n`;
    }

    report += '\n';
  });

  // 分类列表
  report += `## 📑 ${lang === 'zh' ? '分类列表' : 'By Category'}\n\n`;

  for (const [key, info] of Object.entries(CATEGORIES)) {
    const catArticles = articles.filter((a) => (a.category || 'OTHER') === key);
    if (catArticles.length === 0) continue;

    report += `### ${info.emoji} ${lang === 'zh' ? info.name : key}\n\n`;
    catArticles.forEach((a) => {
      report += `- [${displayTitle(a)}](${a.link}) · ${a.source}\n`;
    });
    report += '\n';
  }

  // 页脚
  report += `---\n*Generated by Tech Daily Digest* · ${RSS_FEEDS.length} sources\n`;

  return report;
}

// AI 提示词生成
function generateAIPrompts(articles, options) {
  const { lang, topN } = options;
  const topArticles = articles.slice(0, topN);

  return {
    analysis:
      lang === 'zh'
        ? `请分析以下技术文章，为每篇生成：\n1. 中文标题翻译\n2. 3-4句话摘要\n3. 关键词标签(3-5个)\n\n${topArticles
            .map((a, i) => `${i + 1}. ${a.title}\n   ${a.description.slice(0, 200)}`)
            .join('\n\n')}`
        : `Analyze these tech articles. For each provide:\n1. 3-4 sentence summary\n2. Key tags (3-5)\n\n${topArticles
            .map((a, i) => `${i + 1}. ${a.title}\n   ${a.description.slice(0, 200)}`)
            .join('\n\n')}`,

    trends:
      lang === 'zh'
        ? `基于以下文章标题，总结今天技术圈的2-3个主要趋势:\n\n${articles
            .slice(0, 20)
            .map((a, i) => `${i + 1}. [${a.category}] ${a.title}`)
            .join('\n')}`
        : `Summarize 2-3 major tech trends from these article titles:\n\n${articles
            .slice(0, 20)
            .map((a, i) => `${i + 1}. [${a.category}] ${a.title}`)
            .join('\n')}`
  };
}

// 主程序
async function main() {
  const options = parseArgs();

  if (options.help) {
    console.log(`
Tech Daily Digest
Usage: node digest-complete.mjs [options]

Options:
  --hours <n>     Time range in hours (24, 48, 72) [default: 48]
  --top-n <n>     Number of top articles [default: 15]
  --lang <lang>   Language: zh | en [default: zh]
  --output <path> Output file path
  --with-ai       Generate AI prompts for analysis
  --help, -h      Show this help
`);
    return;
  }

  console.log(`🚀 Tech Daily Digest`);
  console.log(`   Hours: ${options.hours} | Top: ${options.topN} | Lang: ${options.lang}\n`);

  // 创建目录
  await mkdir(CONFIG.cacheDir, { recursive: true });
  await mkdir(CONFIG.outputDir, { recursive: true });

  // 获取 RSS
  console.log(`📡 Fetching ${RSS_FEEDS.length} feeds...`);
  const startTime = Date.now();

  const allArticles = [];
  for (let i = 0; i < RSS_FEEDS.length; i += CONFIG.concurrency) {
    const batch = RSS_FEEDS.slice(i, i + CONFIG.concurrency);
    const results = await Promise.all(batch.map(fetchFeed));

    results.forEach((xml, idx) => {
      if (xml) {
        const articles = parseArticles(xml, batch[idx]);
        allArticles.push(...articles);
      }
    });

    process.stdout.write(`\r   Progress: ${Math.min(i + CONFIG.concurrency, RSS_FEEDS.length)}/${RSS_FEEDS.length}`);
    await new Promise((r) => setTimeout(r, 50));
  }

  console.log(`\n   ✅ Fetched ${allArticles.length} articles in ${((Date.now() - startTime) / 1000).toFixed(1)}s\n`);

  // 处理文章
  let articles = deduplicate(allArticles);
  console.log(`📝 After dedup: ${articles.length}`);

  const undatedCount = articles.filter((a) => !(a.pubDate instanceof Date) || Number.isNaN(a.pubDate.getTime())).length;
  if (undatedCount > 0) {
    console.log(`⚠️ Dropped undated articles: ${undatedCount}`);
  }

  articles = filterArticles(articles, options.hours);
  console.log(`⏰ After time filter: ${articles.length}`);

  if (articles.length === 0) {
    console.log('\n⚠️ No articles found. Try increasing --hours');
    return;
  }

  // 分类并排序
  articles.forEach((a) => (a.category = categorizeArticle(a)));
  articles.sort((a, b) => b.pubDate - a.pubDate);

  // 中文模式下：统一翻译标题 + 热门摘要中文化
  if (options.lang === 'zh') {
    console.log('🌐 Translating titles and hot summaries to Chinese...');
    const translationCache = await loadZhTranslationCache();
    await localizeArticlesForChinese(articles, options.topN, translationCache);
    await saveZhTranslationCache(translationCache);
  }

  // 生成 AI 提示词
  if (options.withAI) {
    const prompts = generateAIPrompts(articles, options);
    const timestamp = Date.now();

    await writeFile(join(CONFIG.cacheDir, `ai-analysis-${timestamp}.txt`), prompts.analysis);
    await writeFile(join(CONFIG.cacheDir, `ai-trends-${timestamp}.txt`), prompts.trends);

    console.log(`\n🤖 AI prompts saved:`);
    console.log(`   - .cache/ai-analysis-${timestamp}.txt`);
    console.log(`   - .cache/ai-trends-${timestamp}.txt`);
  }

  // 生成报告
  console.log(`\n📝 Generating report...`);
  const report = generateReport(articles, options);

  // 保存
  const filename = `tech-digest-${formatDate(new Date())}-${options.lang}.md`;
  const outputPath = options.output || join(CONFIG.outputDir, filename);

  await writeFile(outputPath, report, 'utf-8');
  console.log(`\n✅ Report saved: ${outputPath}`);
  console.log(`   Articles: ${articles.length} | Sources: ${new Set(articles.map((a) => a.source)).size}`);

  // 同时输出报告内容
  console.log(`\n${'='.repeat(60)}`);
  console.log(report.slice(0, 3000));
  console.log(`\n... (${report.length - 3000} more characters)`);
  console.log('='.repeat(60));
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
