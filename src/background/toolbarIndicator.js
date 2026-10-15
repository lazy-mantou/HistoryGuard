/**
 * @file toolbarIndicator.js
 * @description 工具栏动态状态指示器引擎
 * 根据当前标签页 URL、规则匹配状态与 30 分钟静默模式，实时同步扩展图标外观、角标 (Badge) 与 Tooltip
 */

import { browserApi } from '../adapters/index.js';
import { findMatchingRule } from '../core/ruleMatcher.js';

// 图标资源路径配置
export const ICON_PATHS = {
  ACTIVE: {
    16: 'icons/icon16.png',
    32: 'icons/icon32.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png'
  },
  DIMMED: {
    16: 'icons/icon-dim16.png',
    32: 'icons/icon-dim32.png',
    48: 'icons/icon-dim48.png',
    128: 'icons/icon-dim128.png'
  }
};

// 状态类型常量
export const PAGE_PROTECT_STATUS = {
  PROTECTED_RULE: 'PROTECTED_RULE',     // 命中自动隐藏规则，该页不记录历史
  PROTECTED_SILENT: 'PROTECTED_SILENT', // 处于静默免记录模式，全局不记录历史
  RECORDING: 'RECORDING',               // 正常普通页面，会记录历史
  INTERNAL: 'INTERNAL'                  // 浏览器内置页面或特殊协议
};

/**
 * 纯函数：根据当前页面信息计算防护状态
 * @param {string} url
 * @param {string} [title='']
 * @param {Array<Object>} [rules=[]]
 * @param {number} [silentUntil=0]
 * @returns {{ status: string, rule: Object|null }}
 */
export function evaluatePageStatus(url, title = '', rules = [], silentUntil = 0) {
  if (!url || typeof url !== 'string' || (!url.startsWith('http://') && !url.startsWith('https://'))) {
    return { status: PAGE_PROTECT_STATUS.INTERNAL, rule: null };
  }

  const now = Date.now();
  if (silentUntil > now) {
    return { status: PAGE_PROTECT_STATUS.PROTECTED_SILENT, rule: null };
  }

  const { matched, rule } = findMatchingRule(rules || [], { url, title });
  if (matched && rule) {
    return { status: PAGE_PROTECT_STATUS.PROTECTED_RULE, rule };
  }

  return { status: PAGE_PROTECT_STATUS.RECORDING, rule: null };
}

/**
 * 刷新指定标签页的工具栏图标与角标提示
 * @param {number} tabId
 * @param {string} url
 * @param {string} title
 * @param {Array<Object>} rules
 * @param {number} silentUntil
 * @param {string} [lang='zh-CN']
 */
export async function updateTabToolbarIndicator(tabId, url, title, rules, silentUntil, lang = 'zh-CN') {
  if (!tabId || typeof tabId !== 'number') return;

  const isZh = !lang || lang.startsWith('zh');
  const { status, rule } = evaluatePageStatus(url, title, rules, silentUntil);

  try {
    switch (status) {
      case PAGE_PROTECT_STATUS.PROTECTED_RULE: {
        await browserApi.action.setIcon({ tabId, path: ICON_PATHS.ACTIVE });
        await browserApi.action.setBadgeBackgroundColor({ tabId, color: '#10b981' }); // 翡翠绿
        await browserApi.action.setBadgeText({ tabId, text: isZh ? '无痕' : 'HIDE' });
        const tooltip = isZh
          ? `HistGuard: 当前页面处于保护中 (不记录历史${rule?.pattern ? ` - 规则: ${rule.pattern}` : ''})`
          : `HistGuard: Protected (History recording disabled${rule?.pattern ? ` - rule: ${rule.pattern}` : ''})`;
        await browserApi.action.setTitle({ tabId, title: tooltip });
        break;
      }

      case PAGE_PROTECT_STATUS.PROTECTED_SILENT: {
        await browserApi.action.setIcon({ tabId, path: ICON_PATHS.ACTIVE });
        await browserApi.action.setBadgeBackgroundColor({ tabId, color: '#8b5cf6' }); // 极光紫
        await browserApi.action.setBadgeText({ tabId, text: isZh ? '静默' : 'MUTE' });
        const tooltip = isZh
          ? 'HistGuard: 静默免记录模式中 (全局不记录历史)'
          : 'HistGuard: Silent mode active (Global history tracking paused)';
        await browserApi.action.setTitle({ tabId, title: tooltip });
        break;
      }

      case PAGE_PROTECT_STATUS.RECORDING: {
        await browserApi.action.setIcon({ tabId, path: ICON_PATHS.DIMMED });
        await browserApi.action.setBadgeText({ tabId, text: '' });
        const tooltip = isZh
          ? 'HistGuard: 正常记录历史 (点击图标可开启保护)'
          : 'HistGuard: Recording history (Click icon to protect)';
        await browserApi.action.setTitle({ tabId, title: tooltip });
        break;
      }

      case PAGE_PROTECT_STATUS.INTERNAL:
      default: {
        await browserApi.action.setIcon({ tabId, path: ICON_PATHS.DIMMED });
        await browserApi.action.setBadgeText({ tabId, text: '' });
        const tooltip = isZh
          ? 'HistGuard: 浏览器内部页面 (不可记录)'
          : 'HistGuard: Browser internal page';
        await browserApi.action.setTitle({ tabId, title: tooltip });
        break;
      }
    }
  } catch (err) {
    // 忽略标签页关闭等非致命异常
  }
}
