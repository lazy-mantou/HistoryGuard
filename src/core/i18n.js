/**
 * @file i18n.js
 * @description 前端模板化国际化 (i18n) 核心驱动引擎
 * 支持浏览器语言自动探测、模板属性绑定 (data-i18n*)、动态参数插值与实时语言切换
 */

import { browserApi } from '../adapters/index.js';
import zhCN from './locales/zh-CN.js';
import en from './locales/en.js';

// 支持的语言包字典映射
const LOCALES = {
  'zh-CN': zhCN,
  'en': en
};

// 当前语言状态
let activeLanguage = 'zh-CN';
let configuredPreference = 'auto';

/**
 * 获取深层嵌套对象的值 (支持 a.b.c 路径)
 * @param {Object} obj
 * @param {string} path
 * @returns {any}
 */
function getNestedValue(obj, path) {
  if (!obj || typeof path !== 'string') return undefined;
  const segments = path.split('.');
  let current = obj;
  for (const seg of segments) {
    if (current && typeof current === 'object' && seg in current) {
      current = current[seg];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * 将偏好语言设置解析为实际语言代码 ('zh-CN' 或 'en')
 * @param {string} preference - 'auto' | 'zh-CN' | 'en'
 * @returns {string} 'zh-CN' | 'en'
 */
export function resolveLanguage(preference = 'auto') {
  if (preference === 'zh-CN' || preference === 'en') {
    return preference;
  }

  // preference 为 'auto' 时，根据浏览器 UI 语言自动适配
  let uiLang = '';
  try {
    if (browserApi?.i18n?.getUILanguage) {
      uiLang = browserApi.i18n.getUILanguage();
    }
  } catch (err) {
    console.warn('[i18n] getUILanguage failed:', err);
  }

  if (!uiLang && typeof navigator !== 'undefined' && navigator.language) {
    uiLang = navigator.language;
  }

  const cleanLang = (uiLang || '').toLowerCase().trim();

  // 若以 zh 开头 (如 zh, zh-CN, zh-TW, zh-HK) 匹配中文，否则默认英文
  if (cleanLang.startsWith('zh')) {
    return 'zh-CN';
  }

  return 'en';
}

/**
 * 翻译指定 key 并进行动态参数插值 (支持显式指定目标语言，便于后台无 DOM 环境下直接使用)
 * @param {string} key - 如 'options.statActiveRules'
 * @param {Object} [params] - 如 { count: 5 }
 * @param {string} [lang] - 显式指定语言代码 (如 'zh-CN', 'en')，缺省使用当前激活语言
 * @returns {string}
 */
export function t(key, params = {}, lang = null) {
  if (!key) return '';

  const targetLang = lang ? resolveLanguage(lang) : activeLanguage;
  const activeDict = LOCALES[targetLang] || LOCALES['zh-CN'];
  const fallbackDict = LOCALES['zh-CN'];

  let val = getNestedValue(activeDict, key);
  if (val === undefined) {
    val = getNestedValue(fallbackDict, key);
  }

  if (val === undefined) {
    return key;
  }

  let text = String(val);

  // 参数动态插值 {paramName}
  if (params && typeof params === 'object') {
    text = text.replace(/\{(\w+)\}/g, (match, paramKey) => {
      return params[paramKey] !== undefined ? String(params[paramKey]) : match;
    });
  }

  return text;
}

/**
 * 遍历 DOM 树，将具有 data-i18n* 模板属性的元素应用本地化
 * 支持：
 * - data-i18n: 替换元素的 textContent
 * - data-i18n-placeholder: 替换 input/textarea 的 placeholder
 * - data-i18n-title: 替换元素的 title 提示
 * - data-i18n-aria-label: 替换元素的 aria-label 属性
 * @param {HTMLElement|Document} [root=document]
 */
export function applyI18nToDOM(root) {
  const domRoot = root || (typeof document !== 'undefined' ? document : null);
  if (!domRoot || typeof domRoot.querySelectorAll !== 'function') return;

  // 1. TextContent 文本模板绑定
  const textElements = domRoot.querySelectorAll('[data-i18n]');
  textElements.forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (key) {
      const translation = t(key);
      if (translation && translation !== key) {
        el.textContent = translation;
      }
    }
  });

  // 2. Placeholder 占位符绑定
  const placeholderElements = domRoot.querySelectorAll('[data-i18n-placeholder]');
  placeholderElements.forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key) {
      const translation = t(key);
      if (translation && translation !== key) {
        el.setAttribute('placeholder', translation);
      }
    }
  });

  // 3. Title 提示绑定
  const titleElements = domRoot.querySelectorAll('[data-i18n-title]');
  titleElements.forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    if (key) {
      const translation = t(key);
      if (translation && translation !== key) {
        el.setAttribute('title', translation);
      }
    }
  });

  // 4. Aria-label 读屏标签绑定
  const ariaElements = domRoot.querySelectorAll('[data-i18n-aria-label]');
  ariaElements.forEach(el => {
    const key = el.getAttribute('data-i18n-aria-label');
    if (key) {
      const translation = t(key);
      if (translation && translation !== key) {
        el.setAttribute('aria-label', translation);
      }
    }
  });

  // 5. 同步 HTML 根节点的 lang 属性
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = activeLanguage;
  }
}

/**
 * 胶囊标签多语言本地化映射助手
 * @param {Object} candidate - { rule, type, label, description }
 * @returns {{ label: string, description: string }}
 */
export function localizeCapsule(candidate) {
  if (!candidate) return { label: '', description: '' };

  const isEn = activeLanguage === 'en';
  const label = candidate.label || '';
  const desc = candidate.description || '';

  if (!isEn) {
    return { label, description: desc };
  }

  // 英文本地化规则候选标签
  let enLabel = label;
  let enDesc = desc;

  if (label === '当前完整域名') {
    enLabel = 'Full Domain';
    enDesc = `Match exact domain (${candidate.rule})`;
  } else if (label === '二级子域通配') {
    enLabel = 'Subdomain Wildcard';
    enDesc = `Match ${candidate.rule.replace(/^\*\./, '')} & all subdomains`;
  } else if (label === '根域名全站通配') {
    enLabel = 'Root Domain Wildcard';
    enDesc = `Match root domain & all subdomains`;
  } else if (label === '精确 URL 路径') {
    enLabel = 'Exact Path';
    enDesc = 'Match this exact page path only';
  } else if (label === '当前目录通配') {
    enLabel = 'Directory Wildcard';
    enDesc = 'Match current directory and subpages';
  } else if (label === '上级目录通配') {
    enLabel = 'Parent Directory Wildcard';
    enDesc = 'Match parent directory and subpages';
  } else if (label === '全站路径通配') {
    enLabel = 'All Paths Wildcard';
    enDesc = 'Match all pages under this domain';
  }

  return { label: enLabel, description: enDesc };
}

/**
 * 格式化相对时间
 * @param {number} timestamp
 * @returns {string}
 */
export function formatRelativeTime(timestamp) {
  if (!timestamp) return '';
  const now = Date.now();
  const diffSec = Math.floor((now - timestamp) / 1000);

  if (diffSec < 60) {
    return t('options.timeJustNow');
  }
  if (diffSec < 3600) {
    return t('options.timeMinutesAgo', { m: Math.floor(diffSec / 60) });
  }
  if (diffSec < 86400) {
    return t('options.timeHoursAgo', { h: Math.floor(diffSec / 3600) });
  }

  const d = new Date(timestamp);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hour = String(d.getHours()).padStart(2, '0');
  const minute = String(d.getMinutes()).padStart(2, '0');

  return `${year}-${month}-${day} ${hour}:${minute}`;
}

/**
 * 获取当前生效的语言
 * @returns {'zh-CN'|'en'}
 */
export function getCurrentLanguage() {
  return activeLanguage;
}

/**
 * 获取当前配置的偏好设置 ('auto' | 'zh-CN' | 'en')
 * @returns {'auto'|'zh-CN'|'en'}
 */
export function getConfiguredPreference() {
  return configuredPreference;
}

/**
 * 设置并应用新的语言
 * @param {'auto'|'zh-CN'|'en'} preference
 * @param {HTMLElement|Document} [root=document]
 * @returns {'zh-CN'|'en'} 实际生效语言
 */
export function setLanguage(preference = 'auto', root) {
  configuredPreference = preference;
  activeLanguage = resolveLanguage(preference);
  applyI18nToDOM(root);
  return activeLanguage;
}

/**
 * 初始化 i18n
 * @param {'auto'|'zh-CN'|'en'} [preference='auto']
 * @param {HTMLElement|Document} [root]
 * @returns {'zh-CN'|'en'}
 */
export function initI18n(preference = 'auto', root) {
  return setLanguage(preference, root);
}
