#!/usr/bin/env node
/**
 * Tech Daily Digest - 每日科技资讯生成器
 * 
 * 使用方法:
 *   node digest.mjs --hours 48 --top-n 15 --lang zh
 *   node digest.mjs --hours 24 --top-n 10 --lang en --output ~/digest.md
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RSS_FEEDS, CATEGORIES } from './rss-feeds.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================================
// 配置常量
// ============================================================================

const FEED_FETCH_TIMEOUT_MS = 15_000;
const FEED_CONCURRENCY = 10;

// ============================================================================
// 工具函数
// ============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    hours: 48,
    topN: 15,
    lang: 'zh',
    output: null
  };
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--hours':
        const hours = parseInt(args[++i]);
        if (hours === 24 || hours === 48 || hours === 72) {
          options.hours = hours;
        } else if (hours === 7 * 24) {
          options.hours = 168; // 7 days
        }
        break;
      case '--top-n':
        options.topN = parseInt(args[++i]) || 15;
        break;
      case '--lang':
        options.lang = args[++i] === 'en' ? 'en' : 'zh';
        break;
      case '--output':
        options.output = args[++i];
        break;
      case '--help':
      case '-h':
        showHelp();
        process.exit(0);
    }
  }
  
  return options;
}

function showHelp() {
  console.log(`
Tech Daily Digest - 每日科技资讯生成器

用法: node digest.mjs [选项]

选项:
  --hours <n>     时间范围: 24, 48, 72 (小时) 或 7d (7天) [默认: 48]
  --top-n <n>     精选文章数量 [默认: 15]
  --lang <lang>   输出语言: zh | en [默认: zh]
  --output <path> 输出文件路径 (默认输出到控制台)
  --help, -h      显示帮助信息

示例:
  node digest.mjs --hours 24 --top-n 15 --lang zh
  node digest.mjs --hours 48 --top-n 10 --lang en --output ~/digest.md
`);
}

function formatRelativeTime(date, lang = 'zh') {
  const now = new Date();
  const diff = now - date;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  
  if (lang === 'zh') {
    if (hours < 1) return '刚刚';
    if (hours < 24) return `${hours}小时前`;
    if (days < 7) return `${days}天前`;
    return `${Math.floor(days / 7)}周前`;
  } else {
    if (hours < 1) return 'just now';
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return `${Math.floor(days / 7)}w ago`;
  }
}

function escapeXml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ============================================================================
// RSS 解析
// ============================================================================

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, { 
      signal: controller.signal,
      headers: {
        'User-Agent': 'TechDailyDigest/1.0 (RSS Reader)'
      }
    });
    clearTimeout(timeout);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    return await response.text();
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

function parseRSS(xmlText, sourceName, sourceUrl) {
  const articles = [];
  
  // 提取所有 item 元素
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match;
  
  while ((match = itemRegex.exec(xmlText)) !== null) {
    const itemContent = match[1];
    
    const titleMatch = itemContent.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const linkMatch = itemContent.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    const pubDateMatch = itemContent.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i);
    const descMatch = itemContent.match(/<description[^>]*>([\s\S]*?)<\/description>/i);
    
    if (titleMatch && linkMatch) {
      const title = titleMatch[1].replace(/<\!\[CDATA\[(.*?)\]\]>/s, '$1').trim();
      const link = linkMatch[1].trim();
      const pubDate = pubDateMatch ? new Date(pubDateMatch[1].trim()) : new Date();
      const description = descMatch 
        ? descMatch[1].replace(/<\!\[CDATA\[(.*?)\]\]>/s, '$1').replace(/<[^>]+>/g, '').trim()
        : '';
      
      articles.push({
        title,
        link,
        pubDate,
        description: description.slice(0, 500),
        source: sourceName,
        sourceUrl
      });
    }
  }
  
  return articles;
}

function parseAtom(xmlText, sourceName, sourceUrl) {
  const articles = [];
  
  // 提取所有 entry 元素
  const entryRegex = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;
  let match;
  
  while ((match = entryRegex.exec(xmlText)) !== null) {
    const entryContent = match[1];
    
    const titleMatch = entryContent.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const linkMatch = entryContent.match(/<link[^>]*href=["']([^"']+)["']/i);
    const updatedMatch = entryContent.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i);
    const publishedMatch = entryContent.match(/<published[^>]*>([\s\S]*?)<\/published>/i);
    const summaryMatch = entryContent.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
    const contentMatch = entryContent.match(/<content[^>]*>([\s\S]*?)<\/content>/i);
    
    if (titleMatch && linkMatch) {
      const title = titleMatch[1].replace(/<\!\[CDATA\[(.*?)\]\]>/s, '$1').trim();
      const link = linkMatch[1].trim();
      const dateStr = updatedMatch?.[1] || publishedMatch?.[1];
      const pubDate = dateStr ? new Date(dateStr.trim()) : new Date();
      
      let description = '';
      if (summaryMatch) {
        description = summaryMatch[1].replace(/<\!\[CDATA\[(.*?)\]\]>/s, '$1').replace(/<[^>]+>/g, '').trim();
      } else if (contentMatch) {
        description = contentMatch[1].replace(/<\!\[CDATA\[(.*?)\]\]>/s, '$1').replace(/<[^>]+>/g, '').trim();
      }
      
      articles.push({
        title,
        link,
        pubDate,
        description: description.slice(0, 500),
        source: sourceName,
        sourceUrl
      });
    }
  }
  
  return articles;
}

async function fetchFeed(feed) {
  try {
    const xmlText = await fetchWithTimeout(feed.xmlUrl, FEED_FETCH_TIMEOUT_MS);
    
    // 检测 RSS 或 Atom
    if (xmlText.includes('<feed') && xmlText.includes('xmlns="http://www.w3.org/2005/Atom"')) {
      return parseAtom(xmlText, feed.name, feed.htmlUrl);
    } else if (xmlText.includes('<rss') || xmlText.includes('<channel>')) {
      return parseRSS(xmlText, feed.name, feed.htmlUrl);
    }
    
    return [];
  } catch (error) {
    console.error(`❌ Failed to fetch ${feed.name}: ${error.message}`);
    return [];
  }
}

async function fetchAllFeeds(feeds, concurrency = FEED_CONCURRENCY) {
  const results = [];
  
  for (let i = 0; i < feeds.length; i += concurrency) {
    const batch = feeds.slice(i, i + concurrency);
    const batchPromises = batch.map(feed => fetchFeed(feed));
    const batchResults = await Promise.all(batchPromises);
    
    for (const articles of batchResults) {
      results.push(...articles);
    }
    
    // 小延迟避免过载
    if (i + concurrency < feeds.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  return results;
}

// ============================================================================
// 文章过滤和排序
// ============================================================================

function filterByTime(articles, hours) {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
  return articles.filter(article => article.pubDate >= cutoff);
}

function deduplicateArticles(articles) {
  const seen = new Set();
  return articles.filter(article => {
    const key = article.link;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortByDate(articles) {
  return articles.sort((a, b) => b.pubDate - a.pubDate);
}

// ============================================================================
// 分类启发式规则 (用于初步分类)
// ============================================================================

function heuristicCategorize(article) {
  const text = (article.title + ' ' + article.description).toLowerCase();
  
  const rules = [
    {
      category: 'AI_ML',
      keywords: ['ai', 'llm', 'gpt', 'machine learning', 'neural', 'transformer', 'model', 'training', 'inference', 'openai', 'anthropic', 'claude', 'gemini', '人工智能', '机器学习', '深度学习', '大模型']
    },
    {
      category: 'SECURITY',
      keywords: ['security', 'vulnerability', 'exploit', 'hack', 'breach', 'privacy', 'encryption', 'cryptography', 'malware', 'ransomware', '安全', '漏洞', '黑客', '加密', '隐私']
    },
    {
      category: 'TOOLS_OPENSOURCE',
      keywords: ['github', 'release', 'version', 'tool', 'library', 'framework', 'package', 'npm', 'pypi', 'crate', '开源', '工具', '库', '框架', '发布']
    },
    {
      category: 'ENGINEERING',
      keywords: ['architecture', 'system design', 'performance', 'scalability', 'database', 'backend', 'frontend', 'api', '架构', '性能', '可扩展', '数据库', '后端', '前端']
    },
    {
      category: 'OPINION',
      keywords: ['opinion', 'thoughts', 'essay', 'reflection', 'career', 'experience', '观点', '思考', '随笔', '职业', '经验']
    }
  ];
  
  for (const rule of rules) {
    if (rule.keywords.some(kw => text.includes(kw))) {
      return rule.category;
    }
  }
  
  return 'OTHER';
}

// ============================================================================
// AI 提示词生成
// ============================================================================

function generateScoringPrompt(articles, lang = 'zh') {
  const articleList = articles.map((a, i) => 
    `[${i + 1}] Title: ${a.title}\n    Source: ${a.source}\n    Description: ${a.description.slice(0, 200)}`
  ).join('\n\n');
  
  if (lang === 'zh') {
    return `请对以下技术文章进行评分和分类。从以下维度评估每篇文章（1-10分）：
1. 相关性 - 对技术人员的价值
2. 质量 - 内容深度和原创性  
3. 时效性 - 话题的新鲜程度

请将文章分类到以下类别之一：
- AI_ML: AI、机器学习、LLM
- SECURITY: 安全、隐私
- ENGINEERING: 软件工程、架构
- TOOLS_OPENSOURCE: 开发工具、开源项目
- OPINION: 观点、思考、职业发展
- OTHER: 其他

对每篇文章，输出格式如下：
[序号] | 分类 | 总分 | 中文标题 | 关键词(3-5个)

文章列表:
${articleList}

请输出评分结果：`;
  } else {
    return `Please score and categorize the following technical articles. Evaluate each article on these dimensions (1-10):
1. Relevance - Value to technical professionals
2. Quality - Depth and originality of content
3. Timeliness - Freshness of the topic

Categorize into:
- AI_ML: AI, Machine Learning, LLM
- SECURITY: Security, Privacy
- ENGINEERING: Software Engineering, Architecture
- TOOLS_OPENSOURCE: Developer Tools, Open Source
- OPINION: Opinions, Thoughts, Career
- OTHER: Other

Output format for each article:
[Index] | Category | Total Score | Keywords (3-5)

Articles:
${articleList}

Scoring results:`;
  }
}

function generateSummaryPrompt(articles, lang = 'zh') {
  const articleList = articles.map((a, i) => 
    `[${i + 1}] Title: ${a.title}\n    Source: ${a.source}\n    Link: ${a.link}\n    Description: ${a.description.slice(0, 300)}`
  ).join('\n\n');
  
  if (lang === 'zh') {
    return `请为以下技术文章生成结构化摘要和中文翻译。

对每篇文章，请提供：
1. 中文标题（简洁准确）
2. 结构化摘要（4-6句话，涵盖核心问题→关键论点→结论）
3. 推荐理由（为什么值得阅读，1-2句话）
4. 关键词标签（3-5个）

文章列表:
${articleList}

请按以下格式输出：

[序号]
中文标题: [翻译后的标题]
摘要: [4-6句话的详细摘要]
推荐理由: [阅读价值说明]
关键词: [标签1] [标签2] [标签3]`;
  } else {
    return `Please generate structured summaries for the following technical articles.

For each article, provide:
1. A concise summary (4-6 sentences covering problem→key arguments→conclusion)
2. Why it's worth reading (1-2 sentences)
3. Keywords/tags (3-5)

Articles:
${articleList}

Output format:

[Index]
Summary: [Detailed summary]
Why Read: [Value proposition]
Keywords: [tag1] [tag2] [tag3]`;
  }
}

function generateTrendsPrompt(articles, lang = 'zh') {
  const articleList = articles.slice(0, 20).map((a, i) => 
    `[${i + 1}] ${a.title} (${a.category || 'Unknown'})`
  ).join('\n');
  
  if (lang === 'zh') {
    return `基于以下技术文章列表，归纳今天技术圈的 2-3 个宏观趋势或热点话题。

文章列表:
${articleList}

请以以下格式输出：

📝 今日看点

1. [趋势标题]
   [3-5句话的描述，说明这个趋势的重要性、背景和影响]

2. [趋势标题]
   [3-5句话的描述]

3. [趋势标题] (可选)
   [3-5句话的描述]`;
  } else {
    return `Based on the following list of technical articles, identify 2-3 macro trends or hot topics in tech today.

Articles:
${articleList}

Output format:

📝 Today's Highlights

1. [Trend Title]
   [3-5 sentence description of importance, context, and impact]

2. [Trend Title]
   [Description]

3. [Trend Title] (optional)
   [Description]`;
  }
}

// ============================================================================
// 报告生成
// ============================================================================

function generateReport(articles, options, aiAnalysis = null) {
  const { hours, topN, lang } = options;
  const timeRange = hours <= 72 ? `${hours}h` : '7d';
  
  // 统计
  const categoryCount = {};
  articles.forEach(a => {
    const cat = a.category || 'OTHER';
    categoryCount[cat] = (categoryCount[cat] || 0) + 1;
  });
  
  // 提取关键词
  const keywordCount = {};
  articles.forEach(a => {
    const text = (a.title + ' ' + a.description).toLowerCase();
    const keywords = ['ai', 'llm', 'api', 'web', 'app', 'code', 'data', 'cloud', 'server', 'client', 'database', 'security', 'performance', 'testing', 'deployment'];
    keywords.forEach(kw => {
      if (text.includes(kw)) {
        keywordCount[kw] = (keywordCount[kw] || 0) + 1;
      }
    });
  });
  
  const topKeywords = Object.entries(keywordCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  
  let report = '';
  
  // 标题
  const now = new Date();
  const dateStr = now.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US');
  report += `# 📰 Tech Daily Digest - ${dateStr}\n\n`;
  report += `> ${lang === 'zh' ? '从 90+ 个顶级技术博客精选的每日科技资讯' : 'Curated daily tech news from 90+ top tech blogs'}\n\n`;
  
  // 数据概览
  report += `## 📊 ${lang === 'zh' ? '数据概览' : 'Overview'}\n\n`;
  report += `- **${lang === 'zh' ? '文章总数' : 'Total Articles'}**: ${articles.length}\n`;
  report += `- **${lang === 'zh' ? '时间范围' : 'Time Range'}**: ${timeRange}\n`;
  report += `- **${lang === 'zh' ? '来源数量' : 'Sources'}**: ${new Set(articles.map(a => a.source)).size}\n\n`;
  
  // 分类分布
  report += `### ${lang === 'zh' ? '分类分布' : 'Categories'}\n\n`;
  Object.entries(categoryCount)
    .sort((a, b) => b[1] - a[1])
    .forEach(([cat, count]) => {
      const catInfo = CATEGORIES[cat] || CATEGORIES.OTHER;
      report += `- ${catInfo.emoji} ${catInfo.name}: ${count}\n`;
    });
  report += '\n';
  
  // 热门关键词
  if (topKeywords.length > 0) {
    report += `### ${lang === 'zh' ? '热门关键词' : 'Top Keywords'}\n\n`;
    report += topKeywords.map(([kw, count]) => `\`${kw}\`(${count})`).join(' · ');
    report += '\n\n';
  }
  
  // AI 分析结果
  if (aiAnalysis) {
    // 今日看点
    if (aiAnalysis.trends) {
      report += aiAnalysis.trends + '\n\n';
    }
    
    // 今日必读
    const topArticles = articles.slice(0, Math.min(3, articles.length));
    if (topArticles.length > 0) {
      report += `## 🔥 ${lang === 'zh' ? '今日必读' : 'Must Read'}\n\n`;
      
      topArticles.forEach((article, i) => {
        const catInfo = CATEGORIES[article.category] || CATEGORIES.OTHER;
        report += `### ${i + 1}. ${catInfo.emoji} [${article.title}](${article.link})\n\n`;
        report += `- **${lang === 'zh' ? '来源' : 'Source'}**: [${article.source}](${article.sourceUrl}) · ${formatRelativeTime(article.pubDate, lang)}\n`;
        
        if (aiAnalysis.summaries && aiAnalysis.summaries[i]) {
          report += `- **${lang === 'zh' ? '摘要' : 'Summary'}**: ${aiAnalysis.summaries[i]}\n`;
        } else if (article.description) {
          report += `- **${lang === 'zh' ? '描述' : 'Description'}**: ${article.description.slice(0, 200)}${article.description.length > 200 ? '...' : ''}\n`;
        }
        
        report += '\n';
      });
    }
  }
  
  // 分类文章列表
  report += `## 📑 ${lang === 'zh' ? '分类文章列表' : 'Articles by Category'}\n\n`;
  
  Object.keys(CATEGORIES).forEach(catKey => {
    const catArticles = articles.filter(a => (a.category || 'OTHER') === catKey);
    if (catArticles.length === 0) return;
    
    const catInfo = CATEGORIES[catKey];
    report += `### ${catInfo.emoji} ${catInfo.name}\n\n`;
    report += `> ${catInfo.desc}\n\n`;
    
    catArticles.forEach(article => {
      report += `**[${article.title}](${article.link})**\n`;
      report += `- ${lang === 'zh' ? '来源' : 'Source'}: [${article.source}](${article.sourceUrl}) · ${formatRelativeTime(article.pubDate, lang)}\n`;
      if (article.description) {
        report += `- ${article.description.slice(0, 150)}${article.description.length > 150 ? '...' : ''}\n`;
      }
      report += '\n';
    });
  });
  
  // 页脚
  report += `---\n\n`;
  report += `*${lang === 'zh' ? '由 Tech Daily Digest 自动生成' : 'Generated by Tech Daily Digest'}* · `;
  report += `${lang === 'zh' ? '信息源' : 'Sources'}: Hacker News Top Blogs\n`;
  
  return report;
}

// ============================================================================
// 主程序
// ============================================================================

async function main() {
  const options = parseArgs();
  const lang = options.lang;
  
  console.log(`🚀 ${lang === 'zh' ? '正在获取科技资讯...' : 'Fetching tech news...'}`);
  console.log(`   ${lang === 'zh' ? '时间范围' : 'Time range'}: ${options.hours}h`);
  console.log(`   ${lang === 'zh' ? '精选数量' : 'Top N'}: ${options.topN}`);
  console.log();
  
  // 获取所有 RSS 源
  console.log(`📡 ${lang === 'zh' ? '正在抓取' : 'Fetching'} ${RSS_FEEDS.length} ${lang === 'zh' ? '个 RSS 源...' : 'RSS feeds...'}`);
  const startTime = Date.now();
  
  const allArticles = await fetchAllFeeds(RSS_FEEDS);
  console.log(`   ✅ ${lang === 'zh' ? '获取到' : 'Fetched'} ${allArticles.length} ${lang === 'zh' ? '篇文章' : 'articles'} (${((Date.now() - startTime) / 1000).toFixed(1)}s)`);
  
  // 去重
  let articles = deduplicateArticles(allArticles);
  console.log(`   📝 ${lang === 'zh' ? '去重后' : 'After dedup'}: ${articles.length} ${lang === 'zh' ? '篇' : 'articles'}`);
  
  // 时间过滤
  articles = filterByTime(articles, options.hours);
  console.log(`   ⏰ ${lang === 'zh' ? '时间过滤后' : 'After time filter'}: ${articles.length} ${lang === 'zh' ? '篇' : 'articles'}`);
  
  // 按日期排序
  articles = sortByDate(articles);
  
  if (articles.length === 0) {
    console.log(`\n⚠️ ${lang === 'zh' ? '未找到符合条件的文章' : 'No articles found matching criteria'}`);
    return;
  }
  
  // 初步分类
  articles.forEach(a => {
    a.category = heuristicCategorize(a);
  });
  
  // 显示 AI 提示词（供 OpenClaw 使用）
  console.log(`\n🤖 ${lang === 'zh' ? 'AI 分析提示词已生成' : 'AI analysis prompts generated'}`);
  console.log(`   ${lang === 'zh' ? '使用以下提示词调用 AI 进行深度分析...' : 'Use these prompts for AI analysis...'}`);
  
  const scoringPrompt = generateScoringPrompt(articles.slice(0, 30), lang);
  const summaryPrompt = generateSummaryPrompt(articles.slice(0, options.topN), lang);
  const trendsPrompt = generateTrendsPrompt(articles, lang);
  
  // 保存提示词到文件（供后续 AI 处理）
  const promptsDir = join(__dirname, '..', '.prompts');
  await mkdir(promptsDir, { recursive: true });
  
  const timestamp = Date.now();
  await writeFile(join(promptsDir, `scoring-${timestamp}.txt`), scoringPrompt);
  await writeFile(join(promptsDir, `summary-${timestamp}.txt`), summaryPrompt);
  await writeFile(join(promptsDir, `trends-${timestamp}.txt`), trendsPrompt);
  
  console.log(`   💾 ${lang === 'zh' ? '提示词已保存到' : 'Prompts saved to'}: .prompts/`);
  
  // 生成基础报告（无 AI 分析）
  console.log(`\n📝 ${lang === 'zh' ? '正在生成报告...' : 'Generating report...'}`);
  const report = generateReport(articles, options);
  
  // 输出或保存
  if (options.output) {
    await writeFile(options.output, report, 'utf-8');
    console.log(`\n✅ ${lang === 'zh' ? '报告已保存到' : 'Report saved to'}: ${options.output}`);
  } else {
    console.log(`\n${'='.repeat(80)}`);
    console.log(report);
    console.log(`${'='.repeat(80)}`);
  }
  
  // 输出提示词路径信息
  console.log(`\n💡 ${lang === 'zh' ? '提示' : 'Tip'}:`);
  console.log(`   ${lang === 'zh' ? '要获得 AI 增强的摘要和趋势分析，请使用以下文件中的提示词调用 AI:' : 'For AI-enhanced summaries and trend analysis, use prompts from:'}`);
  console.log(`   - .prompts/scoring-${timestamp}.txt`);
  console.log(`   - .prompts/summary-${timestamp}.txt`);
  console.log(`   - .prompts/trends-${timestamp}.txt`);
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
