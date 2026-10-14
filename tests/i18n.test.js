/**
 * @file i18n.test.js
 * @description 前端模板化国际化 (i18n) 核心驱动引擎单元测试用例
 * 包括字典键值对等性校验、动态参数插值、DOM 模板属性替换与语言切换
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveLanguage,
  t,
  localizeCapsule,
  formatRelativeTime,
  getCurrentLanguage,
  getConfiguredPreference,
  setLanguage,
  initI18n,
  applyI18nToDOM
} from '../src/core/i18n.js';
import zhCN from '../src/core/locales/zh-CN.js';
import en from '../src/core/locales/en.js';

/**
 * 递归收集对象的所有叶子节点键路径 (如 'popup.hideAndClean')
 */
function getAllLeafKeys(obj, prefix = '') {
  let keys = [];
  for (const [key, value] of Object.entries(obj)) {
    const currentPath = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      keys = keys.concat(getAllLeafKeys(value, currentPath));
    } else {
      keys.push(currentPath);
    }
  }
  return keys;
}

describe('i18n - 语言包完整性与对等性 (Locale Parity)', () => {
  const zhKeys = getAllLeafKeys(zhCN).sort();
  const enKeys = getAllLeafKeys(en).sort();

  it('zh-CN 与 en 语言包的叶子键名数量应当保持一致', () => {
    assert.strictEqual(
      enKeys.length,
      zhKeys.length,
      `en 语言包键总数 (${enKeys.length}) 与 zh-CN (${zhKeys.length}) 不一致`
    );
  });

  it('zh-CN 中的每一个翻译键在 en 语言包中都必须存在且非空', () => {
    const missingInEn = zhKeys.filter(k => !enKeys.includes(k));
    assert.deepStrictEqual(
      missingInEn,
      [],
      `en 语言包缺少以下翻译键: ${missingInEn.join(', ')}`
    );
  });

  it('en 中的每一个翻译键在 zh-CN 语言包中都必须存在且非空', () => {
    const missingInZh = enKeys.filter(k => !zhKeys.includes(k));
    assert.deepStrictEqual(
      missingInZh,
      [],
      `zh-CN 语言包缺少以下翻译键: ${missingInZh.join(', ')}`
    );
  });
});

describe('i18n - resolveLanguage 语言解析算法', () => {
  afterEach(() => {
    delete globalThis.navigator;
    delete globalThis.chrome;
  });

  it('显式指定 zh-CN 或 en 应当直接返回', () => {
    assert.strictEqual(resolveLanguage('zh-CN'), 'zh-CN');
    assert.strictEqual(resolveLanguage('en'), 'en');
  });

  it('当偏好设置为 auto 时，匹配各种中文变体为 zh-CN', () => {
    globalThis.navigator = { language: 'zh-CN' };
    assert.strictEqual(resolveLanguage('auto'), 'zh-CN');

    globalThis.navigator = { language: 'zh-TW' };
    assert.strictEqual(resolveLanguage('auto'), 'zh-CN');

    globalThis.navigator = { language: 'zh-HK' };
    assert.strictEqual(resolveLanguage('auto'), 'zh-CN');

    globalThis.navigator = { language: 'zh' };
    assert.strictEqual(resolveLanguage('auto'), 'zh-CN');
  });

  it('当偏好设置为 auto 且浏览器为其他非中文语言时，默认降级为 en', () => {
    globalThis.navigator = { language: 'en-US' };
    assert.strictEqual(resolveLanguage('auto'), 'en');

    globalThis.navigator = { language: 'ja-JP' };
    assert.strictEqual(resolveLanguage('auto'), 'en');

    globalThis.navigator = { language: 'de' };
    assert.strictEqual(resolveLanguage('auto'), 'en');
  });
});

describe('i18n - t() 文本翻译与动态参数插值', () => {
  beforeEach(() => {
    setLanguage('zh-CN');
  });

  it('能正确翻译一级与深层嵌套的字典键', () => {
    assert.strictEqual(t('app.name'), 'HistGuard');
    assert.strictEqual(t('options.statActiveRules'), '启用规则');
  });

  it('支持模板参数动态插值 {paramName}', () => {
    const res = t('popup.matchesCount', { count: 18 });
    assert.strictEqual(res, '匹配到 18 条已有历史');

    const loaded = t('options.loadedSummary', { count: 1200 });
    assert.strictEqual(loaded, '已加载 1200 条历史记录');

    const silent = t('options.statSilentOn', { min: 25 });
    assert.strictEqual(silent, '开启中 (余 25m)');
  });

  it('切换到英文后应当返回对应的英文翻译', () => {
    setLanguage('en');
    assert.strictEqual(t('options.statActiveRules'), 'Active Rules');
    assert.strictEqual(t('popup.matchesCount', { count: 5 }), 'Matches 5 existing records');
  });

  it('不存在的键应当直接安全回退返回 key 本身', () => {
    assert.strictEqual(t('unknown.non_existent_key'), 'unknown.non_existent_key');
  });

  it('空入参应当返回空字符串', () => {
    assert.strictEqual(t(''), '');
    assert.strictEqual(t(null), '');
  });
});

describe('i18n - localizeCapsule 候选规则胶囊多语言映射', () => {
  it('在中文语言环境下保持中文标签和说明', () => {
    setLanguage('zh-CN');
    const candidate = {
      rule: 'google.com',
      label: '当前完整域名',
      description: '仅匹配该完整域名 (google.com)'
    };
    const localized = localizeCapsule(candidate);
    assert.strictEqual(localized.label, '当前完整域名');
    assert.strictEqual(localized.description, '仅匹配该完整域名 (google.com)');
  });

  it('在英文语言环境下自动转换为英文标签和说明', () => {
    setLanguage('en');
    const domainCandidate = {
      rule: 'google.com',
      label: '当前完整域名',
      description: '仅匹配该完整域名 (google.com)'
    };
    const locDomain = localizeCapsule(domainCandidate);
    assert.strictEqual(locDomain.label, 'Full Domain');
    assert.strictEqual(locDomain.description, 'Match exact domain (google.com)');

    const pathCandidate = {
      rule: 'example.com/docs/*',
      label: '当前目录通配',
      description: '匹配当前所在目录及下级所有页面'
    };
    const locPath = localizeCapsule(pathCandidate);
    assert.strictEqual(locPath.label, 'Directory Wildcard');
    assert.strictEqual(locPath.description, 'Match current directory and subpages');
  });
});

describe('i18n - formatRelativeTime 相对时间格式化', () => {
  it('不足 60 秒应当显示刚刚', () => {
    setLanguage('zh-CN');
    assert.strictEqual(formatRelativeTime(Date.now() - 10000), '刚刚');

    setLanguage('en');
    assert.strictEqual(formatRelativeTime(Date.now() - 10000), 'Just now');
  });

  it('1 小时内应当显示 X 分钟前', () => {
    setLanguage('zh-CN');
    assert.strictEqual(formatRelativeTime(Date.now() - 15 * 60 * 1000), '15 分钟前');

    setLanguage('en');
    assert.strictEqual(formatRelativeTime(Date.now() - 15 * 60 * 1000), '15m ago');
  });

  it('24 小时内应当显示 X 小时前', () => {
    setLanguage('zh-CN');
    assert.strictEqual(formatRelativeTime(Date.now() - 3 * 3600 * 1000), '3 小时前');

    setLanguage('en');
    assert.strictEqual(formatRelativeTime(Date.now() - 3 * 3600 * 1000), '3h ago');
  });

  it('超过 1 天应当格式化为 YYYY-MM-DD HH:mm', () => {
    const fixedTime = new Date('2026-05-01T14:30:00').getTime();
    const formatted = formatRelativeTime(fixedTime);
    assert.strictEqual(formatted, '2026-05-01 14:30');
  });
});

describe('i18n - applyI18nToDOM (DOM 模板属性绑定)', () => {
  /**
   * 模拟轻量级 DOM 元素
   */
  class MockElement {
    constructor(attrs = {}) {
      this.attributes = { ...attrs };
      this.textContent = '';
    }
    getAttribute(name) {
      return this.attributes[name] || null;
    }
    setAttribute(name, val) {
      this.attributes[name] = String(val);
    }
  }

  it('应当能正确解析 data-i18n* 系列属性并更新元素内容', () => {
    setLanguage('zh-CN');

    const textEl = new MockElement({ 'data-i18n': 'popup.hideAndClean' });
    const inputEl = new MockElement({ 'data-i18n-placeholder': 'options.searchPlaceholder' });
    const btnEl = new MockElement({
      'data-i18n-title': 'popup.optionsTooltip',
      'data-i18n-aria-label': 'options.navRulesTitle'
    });

    const mockRoot = {
      querySelectorAll: (selector) => {
        if (selector === '[data-i18n]') return [textEl];
        if (selector === '[data-i18n-placeholder]') return [inputEl];
        if (selector === '[data-i18n-title]') return [btnEl];
        if (selector === '[data-i18n-aria-label]') return [btnEl];
        return [];
      }
    };

    // 应用中文
    applyI18nToDOM(mockRoot);
    assert.strictEqual(textEl.textContent, '隐藏并清理');
    assert.strictEqual(inputEl.getAttribute('placeholder'), '搜索域名、URL 路径片段或页面标题 (支持防抖实时检索)...');
    assert.strictEqual(btnEl.getAttribute('title'), '打开管理控制台');
    assert.strictEqual(btnEl.getAttribute('aria-label'), '防护规则管理');

    // 切换为英文并更新
    setLanguage('en');
    applyI18nToDOM(mockRoot);
    assert.strictEqual(textEl.textContent, 'Hide & Clean');
    assert.strictEqual(inputEl.getAttribute('placeholder'), 'Search domain, URL path, or page title (real-time debounced)...');
    assert.strictEqual(btnEl.getAttribute('title'), 'Open Dashboard');
    assert.strictEqual(btnEl.getAttribute('aria-label'), 'Protection Rules');
  });
});
