#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile, rm, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const outputDir = join(root, 'output');
const docsDir = join(root, 'docs');
const dataDir = join(docsDir, 'data');

function extractMeta(md, fileName) {
  const title = (md.match(/^#\s+(.+)$/m)?.[1] || fileName).trim();

  const date =
    fileName.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ||
    md.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ||
    'unknown';

  const lang = fileName.match(/-(zh|en)\.md$/)?.[1] || 'zh';

  const articleCount =
    Number(md.match(/文章总数\*\*[:：]\s*(\d+)/)?.[1]) ||
    Number(md.match(/Total(?: Articles)?\*\*:\s*(\d+)/i)?.[1]) ||
    Number(md.match(/\*\*Total(?: Articles)?\*\*:\s*(\d+)/i)?.[1]) ||
    0;

  return { title, date, lang, articleCount };
}

async function cleanDir(dir) {
  const files = await readdir(dir).catch(() => []);
  await Promise.all(files.map((f) => rm(join(dir, f), { recursive: true, force: true })));
}

async function main() {
  if (!existsSync(outputDir)) {
    throw new Error('output 目录不存在，请先生成日报');
  }

  await mkdir(dataDir, { recursive: true });
  await cleanDir(dataDir);

  const files = await readdir(outputDir);
  const mdFiles = files
    .filter((f) => /^tech-digest-\d{4}-\d{2}-\d{2}-(zh|en)\.md$/.test(f))
    .sort();

  if (mdFiles.length === 0) {
    throw new Error('未找到日报文件（output/tech-digest-YYYY-MM-DD-(zh|en).md）');
  }

  const items = [];

  for (const f of mdFiles) {
    const source = join(outputDir, f);
    const content = await readFile(source, 'utf8');
    const meta = extractMeta(content, f);

    await copyFile(source, join(dataDir, f));

    items.push({
      id: `${meta.date}-${meta.lang}`,
      date: meta.date,
      lang: meta.lang,
      title: meta.title,
      articleCount: meta.articleCount,
      md: `data/${f}`
    });
  }

  items.sort((a, b) => {
    if (a.date === b.date) {
      if (a.lang === b.lang) return 0;
      return a.lang === 'zh' ? -1 : 1;
    }
    return a.date < b.date ? 1 : -1;
  });

  await writeFile(
    join(dataDir, 'index.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), items }, null, 2),
    'utf8'
  );

  console.log(`✅ pages data built: ${items.length} item(s)`);
}

main().catch((err) => {
  console.error(`❌ build-pages failed: ${err.message}`);
  process.exit(1);
});
