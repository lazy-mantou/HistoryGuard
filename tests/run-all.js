/**
 * @file run-all.js
 * @description 统一自动化测试运行器 (Zero-dependency test suite runner)
 * 执行所有测试套件并输出结构化彩色报告
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testFiles = [
  'urlParser.test.js',
  'ruleMatcher.test.js',
  'historyCleaner.test.js',
  'storage.test.js',
  'i18n.test.js',
  'theme.test.js',
  'adapters.test.js'
];

console.log('\n========================================================');
console.log('   🛡️  HistGuard 跨浏览器插件全自动化单元测试套件');
console.log('========================================================\n');

const testArgs = ['--test', ...testFiles.map(f => path.join(__dirname, f))];

const child = spawn(process.execPath, testArgs, {
  stdio: 'inherit',
  shell: false
});

child.on('close', (code) => {
  console.log('\n========================================================');
  if (code === 0) {
    console.log('   🎉 全部单元测试通过 (All tests passed)!');
  } else {
    console.error(`   ❌ 存在测试未通过，退出码: ${code}`);
  }
  console.log('========================================================\n');
  process.exit(code || 0);
});
