/**
 * @file i18n.js
 * @description 前端模板化国际化 (i18n) 核心驱动引擎
 * 支持浏览器语言自动探测、模板属性绑定 (data-i18n*)、动态参数插值与实时语言切换
 * 支持 12 种主流语言：en, zh-CN, zh-TW, es, ar, id, pt, fr, ja, ru, de, ko
 */

import { browserApi } from '../adapters/index.js';
import zhCN from './locales/zh-CN.js';
import zhTW from './locales/zh-TW.js';
import en from './locales/en.js';
import es from './locales/es.js';
import ar from './locales/ar.js';
import id from './locales/id.js';
import pt from './locales/pt.js';
import fr from './locales/fr.js';
import ja from './locales/ja.js';
import ru from './locales/ru.js';
import de from './locales/de.js';
import ko from './locales/ko.js';

// 支持的语言代码常量列表
export const SUPPORTED_LANGUAGES = [
  'zh-CN',
  'zh-TW',
  'en',
  'es',
  'ar',
  'id',
  'pt',
  'fr',
  'ja',
  'ru',
  'de',
  'ko'
];

// 支持的语言包字典映射 (包含 ms 作为 id 的无缝兼容别名)
const LOCALES = {
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'en': en,
  'es': es,
  'ar': ar,
  'id': id,
  'ms': id,
  'pt': pt,
  'fr': fr,
  'ja': ja,
  'ru': ru,
  'de': de,
  'ko': ko
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
 * 将偏好语言设置解析为实际语言代码
 * @param {string} preference - 'auto' | 语言代码
 * @returns {string} 规范化语言代码
 */
export function resolveLanguage(preference = 'auto') {
  if (preference && preference !== 'auto') {
    // 别名标准化
    if (preference === 'ms') return 'id';
    if (LOCALES[preference]) {
      return preference;
    }
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

  // 1. 中文家族判别 (区分简体与繁体)
  if (
    cleanLang.startsWith('zh-tw') ||
    cleanLang.startsWith('zh-hk') ||
    cleanLang.startsWith('zh-mo') ||
    cleanLang.includes('hant')
  ) {
    return 'zh-TW';
  }
  if (cleanLang.startsWith('zh')) {
    return 'zh-CN';
  }

  // 2. 日语与韩语
  if (cleanLang.startsWith('ja')) return 'ja';
  if (cleanLang.startsWith('ko')) return 'ko';

  // 3. 西班牙语
  if (cleanLang.startsWith('es')) return 'es';

  // 4. 阿拉伯语
  if (cleanLang.startsWith('ar')) return 'ar';

  // 5. 印尼语 / 马来语
  if (cleanLang.startsWith('id') || cleanLang.startsWith('ms') || cleanLang.startsWith('in')) return 'id';

  // 6. 葡萄牙语
  if (cleanLang.startsWith('pt')) return 'pt';

  // 7. 法语
  if (cleanLang.startsWith('fr')) return 'fr';

  // 8. 德语
  if (cleanLang.startsWith('de')) return 'de';

  // 9. 俄语
  if (cleanLang.startsWith('ru')) return 'ru';

  // 10. 英文及其他未知语言默认回退为英文
  return 'en';
}

/**
 * 翻译指定 key 并进行动态参数插值
 * @param {string} key - 如 'options.statActiveRules'
 * @param {Object} [params] - 如 { count: 5 }
 * @param {string} [lang] - 显式指定语言代码，缺省使用当前激活语言
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

  // 5. 同步 HTML 根节点的 lang 与 dir (阿拉伯语 RTL)
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = activeLanguage;
    document.documentElement.dir = activeLanguage === 'ar' ? 'rtl' : 'ltr';
  }
}

/** 候选规则胶囊多语言映射表 */
const CAPSULE_I18N = {
  'en': {
    '当前完整域名': { label: 'Full Domain', desc: (r) => `Match exact domain (${r})` },
    '二级子域通配': { label: 'Subdomain Wildcard', desc: (r) => `Match ${r.replace(/^\*\./, '')} & all subdomains` },
    '根域名全站通配': { label: 'Root Domain Wildcard', desc: () => 'Match root domain & all subdomains' },
    '精确 URL 路径': { label: 'Exact Path', desc: () => 'Match this exact page path only' },
    '当前目录通配': { label: 'Directory Wildcard', desc: () => 'Match current directory and subpages' },
    '上级目录通配': { label: 'Parent Directory Wildcard', desc: () => 'Match parent directory and subpages' },
    '全站路径通配': { label: 'All Paths Wildcard', desc: () => 'Match all pages under this domain' }
  },
  'zh-TW': {
    '当前完整域名': { label: '目前完整網域', desc: (r) => `僅匹配該完整網域 (${r})` },
    '二级子域通配': { label: '次級子網域萬用字元', desc: (r) => `匹配 ${r.replace(/^\*\./, '')} 及其所有子網域` },
    '根域名全站通配': { label: '根網域全站萬用字元', desc: () => '匹配根網域及其全站所有子域' },
    '精确 URL 路径': { label: '精確 URL 路徑', desc: () => '僅匹配當前精確頁面路徑' },
    '当前目录通配': { label: '目前目錄萬用字元', desc: () => '匹配當前所在目錄及下級所有頁面' },
    '上级目录通配': { label: '上層目錄萬用字元', desc: () => '匹配上層目錄及所有下級頁面' },
    '全站路径通配': { label: '全站路徑萬用字元', desc: () => '匹配該網域下的所有網頁' }
  },
  'ja': {
    '当前完整域名': { label: '完全ドメイン', desc: (r) => `完全なドメイン (${r}) のみに一致` },
    '二级子域通配': { label: 'サブドメイン包括', desc: (r) => `${r.replace(/^\*\./, '')} および全サブドメインに一致` },
    '根域名全站通配': { label: 'ルートドメイン全体', desc: () => 'ルートドメインとすべてのサブドメインに一致' },
    '精确 URL 路径': { label: '正確なURLパス', desc: () => 'この正確なページパスのみに一致' },
    '当前目录通配': { label: '現在のディレクトリ', desc: () => '現在のディレクトリと配下の全ページに一致' },
    '上级目录通配': { label: '親ディレクトリ', desc: () => '親ディレクトリと配下の全ページに一致' },
    '全站路径通配': { label: 'サイト全体パス', desc: () => 'このドメイン配下のすべてのページに一致' }
  },
  'ko': {
    '当前完整域名': { label: '전체 도메인', desc: (r) => `해당 전체 도메인(${r})만 일치` },
    '二级子域通配': { label: '서브도메인 와일드카드', desc: (r) => `${r.replace(/^\*\./, '')} 및 모든 하위 도메인 일치` },
    '根域名全站通配': { label: '루트 도메인 전체', desc: () => '루트 도메인 및 전체 하위 도메인 일치' },
    '精确 URL 路径': { label: '정확한 URL 경로', desc: () => '이 정확한 페이지 경로만 일치' },
    '当前目录通配': { label: '현재 디렉터리', desc: () => '현재 디렉터리 및 하위의 모든 페이지 일치' },
    '上级目录通配': { label: '상위 디렉터리', desc: () => '상위 디렉터리 및 하위 페이지 일치' },
    '全站路径通配': { label: '사이트 전체 경로', desc: () => '해당 도메인의 모든 페이지 일치' }
  }
};

/**
 * 胶囊标签多语言本地化映射助手
 * @param {Object} candidate - { rule, type, label, description }
 * @returns {{ label: string, description: string }}
 */
export function localizeCapsule(candidate) {
  if (!candidate) return { label: '', description: '' };

  const label = candidate.label || '';
  const desc = candidate.description || '';

  if (activeLanguage === 'zh-CN') {
    return { label, description: desc };
  }

  // 匹配特定语言包或英文回退
  const langTable = CAPSULE_I18N[activeLanguage] || CAPSULE_I18N['en'];
  if (langTable && langTable[label]) {
    const entry = langTable[label];
    return {
      label: entry.label,
      description: typeof entry.desc === 'function' ? entry.desc(candidate.rule) : desc
    };
  }

  return { label, description: desc };
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
 * @returns {string}
 */
export function getCurrentLanguage() {
  return activeLanguage;
}

/**
 * 获取当前配置的偏好设置
 * @returns {string}
 */
export function getConfiguredPreference() {
  return configuredPreference;
}

/**
 * 设置并应用新的语言
 * @param {string} [preference='auto']
 * @param {HTMLElement|Document} [root=document]
 * @returns {string} 实际生效语言
 */
export function setLanguage(preference = 'auto', root) {
  configuredPreference = preference;
  activeLanguage = resolveLanguage(preference);
  applyI18nToDOM(root);
  return activeLanguage;
}

/**
 * 初始化 i18n
 * @param {string} [preference='auto']
 * @param {HTMLElement|Document} [root]
 * @returns {string}
 */
export function initI18n(preference = 'auto', root) {
  return setLanguage(preference, root);
}
