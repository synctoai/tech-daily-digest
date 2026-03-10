#!/usr/bin/env node
/**
 * Tech Daily Digest - AI 增强版
 * 集成 OpenClaw AI 分析功能
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RSS_FEEDS, CATEGORIES } from './rss-feeds.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 配置
const CONFIG = {
  timeout: 15000,
  concurrency: 10,
  cacheDir: join(__dirname, '..', '.cache'),
  outputDir: join(__dirname, '..', 'output')
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

function formatRelativeTime(date, lang = 'zh') {
  const hours = Math.floor((Date.now() - date) / (1000 * 60 * 60));
  if (hours < 1) return lang === 'zh' ? '刚刚' : 'just now';
  if (hours < 24) return lang === 'zh' ? `${hours}小时前` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return lang === 'zh' ? `${days}天前` : `${days}d ago`;
  return lang === 'zh' ? `${Math.floor(days / 7)}周前` : `${Math.floor(days / 7)}w ago`;
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
  } catch (err) {
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
    const pubDate = extractTag(item, 'pubDate');
    const desc = extractTag(item, 'description');
    
    if (title && link) {
      articles.push({
        title: cleanText(title),
        link: link.trim(),
        pubDate: new Date(pubDate || Date.now()),
        description: cleanText(desc).slice(0, 500),
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
      const updated = extractTag(entry, 'updated') || extractTag(entry, 'published');
      const summary = extractTag(entry, 'summary') || extractTag(entry, 'content');
      
      if (title && linkMatch) {
        articles.push({
          title: cleanText(title),
          link: linkMatch[1],
          pubDate: new Date(updated || Date.now()),
          description: cleanText(summary).slice(0, 500),
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
  // 移除 HTML 标签
  text = text.replace(/<[^>]+>/g, ' ');
  // 规范化空白
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

// 文章处理
function filterArticles(articles, hours) {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
  return articles.filter(a => a.pubDate >= cutoff);
}

function deduplicate(articles) {
  const seen = new Set();
  return articles.filter(a => {
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
    if (words.some(w => text.includes(w))) return cat;
  }
  return 'OTHER';
}

// 生成报告
function generateReport(articles, options) {
  const { hours, topN, lang } = options;
  const now = new Date();
  
  const stats = { 
    total: articles.length, 
    sources: new Set(articles.map(a => a.source)).size 
  };
  
  const byCategory = {};
  articles.forEach(a => {
    const cat = a.category || 'OTHER';
    byCategory[cat] = (byCategory[cat] || 0) + 1;
  });
  
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
    report += `### ${i + 1}. ${info.emoji} [${a.title}](${a.link})\n`;
    report += `- ${lang === 'zh' ? '来源' : 'Source'}: ${a.source} · ${formatRelativeTime(a.pubDate, lang)}\n`;
    if (a.description) {
      report += `- ${a.description.slice(0, 200)}${a.description.length > 200 ? '...' : ''}\n`;
    }
    report += '\n';
  });
  
  // 分类列表
  report += `## 📑 ${lang === 'zh' ? '分类列表' : 'By Category'}\n\n`;
  
  for (const [key, info] of Object.entries(CATEGORIES)) {
    const catArticles = articles.filter(a => (a.category || 'OTHER') === key);
    if (catArticles.length === 0) continue;
    
    report += `### ${info.emoji} ${lang === 'zh' ? info.name : key}\n\n`;
    catArticles.forEach(a => {
      report += `- [${a.title}](${a.link}) · ${a.source} · ${formatRelativeTime(a.pubDate, lang)}\n`;
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
    analysis: lang === 'zh' 
      ? `请分析以下技术文章，为每篇生成：\n1. 中文标题翻译\n2. 3-4句话摘要\n3. 关键词标签(3-5个)\n\n${topArticles.map((a, i) => `${i+1}. ${a.title}\n   ${a.description.slice(0, 200)}`).join('\n\n')}`
      : `Analyze these tech articles. For each provide:\n1. 3-4 sentence summary\n2. Key tags (3-5)\n\n${topArticles.map((a, i) => `${i+1}. ${a.title}\n   ${a.description.slice(0, 200)}`).join('\n\n')}`,
    
    trends: lang === 'zh'
      ? `基于以下文章标题，总结今天技术圈的2-3个主要趋势:\n\n${articles.slice(0, 20).map((a, i) => `${i+1}. [${a.category}] ${a.title}`).join('\n')}`
      : `Summarize 2-3 major tech trends from these article titles:\n\n${articles.slice(0, 20).map((a, i) => `${i+1}. [${a.category}] ${a.title}`).join('\n')}`
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
    await new Promise(r => setTimeout(r, 50));
  }
  
  console.log(`\n   ✅ Fetched ${allArticles.length} articles in ${((Date.now() - startTime)/1000).toFixed(1)}s\n`);
  
  // 处理文章
  let articles = deduplicate(allArticles);
  console.log(`📝 After dedup: ${articles.length}`);
  
  articles = filterArticles(articles, options.hours);
  console.log(`⏰ After time filter: ${articles.length}`);
  
  if (articles.length === 0) {
    console.log('\n⚠️ No articles found. Try increasing --hours');
    return;
  }
  
  // 分类并排序
  articles.forEach(a => a.category = categorizeArticle(a));
  articles.sort((a, b) => b.pubDate - a.pubDate);
  
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
  console.log(`   Articles: ${articles.length} | Sources: ${new Set(articles.map(a => a.source)).size}`);
  
  // 同时输出报告内容
  console.log(`\n${'='.repeat(60)}`);
  console.log(report.slice(0, 3000));
  console.log(`\n... (${report.length - 3000} more characters)`);
  console.log('='.repeat(60));
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
