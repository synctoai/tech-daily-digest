#!/usr/bin/env node
import { execSync } from 'node:child_process';

function run(cmd) {
  execSync(cmd, { stdio: 'inherit' });
}

function runOut(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

try {
  console.log('🔄 Build GitHub Pages data...');
  run('npm run build:pages');

  run('git add README.md package.json scripts/build-pages.mjs scripts/sync-pages-and-push.mjs docs .github/workflows');

  const status = runOut('git status --porcelain');
  if (!status) {
    console.log('ℹ️ 没有变更需要提交');
    process.exit(0);
  }

  run('git commit -m "chore: add pages site, docs and security workflows"');
  run('git push origin main');
  console.log('🚀 已推送到 origin/main');
} catch (err) {
  console.error(`❌ sync failed: ${err.message}`);
  process.exit(1);
}
