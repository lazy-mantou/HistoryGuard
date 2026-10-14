/**
 * @file build.js
 * @description 纯原生 Node.js 构建脚本 (零外部依赖)
 * 自动化打包分发 Chrome (MV3) 与 Firefox (MV3) 双内核产物至 dist/
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = __dirname;
const SRC_DIR = path.join(ROOT_DIR, 'src');
const ICONS_DIR = path.join(ROOT_DIR, 'icons');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

const TARGETS = [
  {
    name: 'chrome',
    label: 'Chromium (Chrome / Edge / Brave)',
    manifestSrc: path.join(ROOT_DIR, 'manifest.chrome.json'),
    outputDir: path.join(DIST_DIR, 'chrome')
  },
  {
    name: 'firefox',
    label: 'Gecko (Mozilla Firefox)',
    manifestSrc: path.join(ROOT_DIR, 'manifest.firefox.json'),
    outputDir: path.join(DIST_DIR, 'firefox')
  }
];

/**
 * 递归复制目录
 * @param {string} src
 * @param {string} dest
 */
function copyDirRecursiveSync(src, dest) {
  if (!fs.existsSync(src)) return;

  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursiveSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * 清空并创建输出目录
 * @param {string} dir
 */
function cleanAndEnsureDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * 计算目录下的文件总数与总大小
 * @param {string} dir
 * @returns {{ count: number, sizeBytes: number }}
 */
function getDirStats(dir) {
  let count = 0;
  let sizeBytes = 0;

  function traverse(currentPath) {
    if (!fs.existsSync(currentPath)) return;
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        traverse(fullPath);
      } else {
        count++;
        sizeBytes += fs.statSync(fullPath).size;
      }
    }
  }

  traverse(dir);
  return { count, sizeBytes };
}

/**
 * 执行构建主流程
 */
function build() {
  console.log('====================================================');
  console.log('🛡️  HistGuard 跨浏览器扩展构建工具 (Zero-Dependency)');
  console.log('====================================================\n');

  const startTime = Date.now();

  // 1. 确保 dist 根目录存在
  if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
  }

  // 2. 遍历构建目标
  for (const target of TARGETS) {
    console.log(`📦 正在构建 ${target.label} 产物...`);
    cleanAndEnsureDir(target.outputDir);

    // A. 校验并复制对应 Manifest
    if (!fs.existsSync(target.manifestSrc)) {
      throw new Error(`找不到清单文件: ${target.manifestSrc}`);
    }
    const manifestContent = fs.readFileSync(target.manifestSrc, 'utf-8');
    // 校验 JSON 格式
    JSON.parse(manifestContent);
    fs.writeFileSync(path.join(target.outputDir, 'manifest.json'), manifestContent, 'utf-8');

    // B. 复制图标资源
    if (fs.existsSync(ICONS_DIR)) {
      copyDirRecursiveSync(ICONS_DIR, path.join(target.outputDir, 'icons'));
    }

    // C. 复制核心业务与界面源码 (adapters, core, background, popup, options)
    const modulesToCopy = ['adapters', 'core', 'background', 'popup', 'options'];
    for (const mod of modulesToCopy) {
      const srcModDir = path.join(SRC_DIR, mod);
      const destModDir = path.join(target.outputDir, mod);
      if (fs.existsSync(srcModDir)) {
        copyDirRecursiveSync(srcModDir, destModDir);
      } else {
        console.warn(`[WARN] 模块目录不存在: ${srcModDir}`);
      }
    }

    const stats = getDirStats(target.outputDir);
    console.log(`   ✓ 成功输出至: dist/${target.name} (共 ${stats.count} 个文件, ${(stats.sizeBytes / 1024).toFixed(1)} KB)`);
  }

  const duration = Date.now() - startTime;
  console.log('\n====================================================');
  console.log(`🎉 构建圆满完成！耗时: ${duration}ms`);
  console.log('📂 产物就绪:');
  console.log('   - Chrome:  dist/chrome/  (在 chrome://extensions 中载入已解压的扩展程序)');
  console.log('   - Firefox: dist/firefox/ (在 about:debugging 中载入临时附加组件)');
  console.log('====================================================');
}

try {
  build();
} catch (err) {
  console.error('\n❌ 构建失败:', err);
  process.exit(1);
}
