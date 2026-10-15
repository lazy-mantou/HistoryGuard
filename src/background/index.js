/**
 * @file index.js (Background Service Worker / Background Script)
 * @description 后台守护服务
 * 监听浏览器历史记录新增事件，执行毫秒级静默拦截与删除，管理 30 分钟免记录倒计时
 */

import { browserApi } from '../adapters/index.js';
import { findMatchingRule, matchesRule } from '../core/ruleMatcher.js';
import {
  getRules,
  getSilentMode,
  clearSilentMode,
  incrementRuleHits,
  getSettings,
  DEFAULT_SETTINGS,
  STORAGE_KEYS
} from '../core/storage.js';
import { updateTabToolbarIndicator } from './toolbarIndicator.js';

// 内存中缓存已启用的规则、静默模式与运行设置，保证在 onVisited 高频触发时毫秒级响应
let cachedRules = [];
let cachedSilentUntil = 0;
let cachedSettings = { ...DEFAULT_SETTINGS };

/**
 * 刷新当前前台活动标签页的工具栏图标外观与角标状态
 */
async function refreshActiveTabIndicator() {
  try {
    const activeTab = await browserApi.tabs.getCurrentActiveTab();
    if (activeTab && typeof activeTab.id === 'number') {
      const lang = browserApi.i18n.getUILanguage() || 'zh-CN';
      await updateTabToolbarIndicator(
        activeTab.id,
        activeTab.url,
        activeTab.title,
        cachedRules,
        cachedSilentUntil,
        lang
      );
    }
  } catch (err) {
    // 忽略异常
  }
}

/**
 * 刷新后台内存缓存
 */
async function refreshCache() {
  try {
    const rules = await getRules();
    cachedRules = rules.filter(r => r.enabled !== false);

    const silent = await getSilentMode();
    cachedSilentUntil = silent.active ? silent.until : 0;

    cachedSettings = await getSettings();

    // 缓存刷新后立即同步当前活动标签页的工具栏指示器
    await refreshActiveTabIndicator();
  } catch (err) {
    console.error('[HistGuard BG] 刷新缓存失败:', err);
  }
}

// 1. 初始化加载缓存
refreshCache();

// 2. 监听存储变化，实时同步最新规则、静默状态与配置偏好
browserApi.storage.onChanged((changes) => {
  if (
    changes[STORAGE_KEYS.RULES] ||
    changes[STORAGE_KEYS.SILENT_MODE] ||
    changes[STORAGE_KEYS.SETTINGS]
  ) {
    refreshCache();
  }
});

// 3. 监听 定时器 闹钟事件（处理 30 分钟静默模式到期）
browserApi.alarms.onAlarm(async (alarm) => {
  if (alarm && alarm.name === 'silent_mode_alarm') {
    cachedSilentUntil = 0;
    await clearSilentMode();
    await refreshActiveTabIndicator();
    console.log('[HistGuard BG] 30 分钟静默免记录模式已到期，恢复正常历史记录监控。');
  }
});

/**
 * 执行 URL 规则比对与隐私抹除处理
 * @param {string} visitUrl
 * @param {string} [title='']
 */
async function handleUrlInspectionAndClean(visitUrl, title = '') {
  if (!visitUrl || typeof visitUrl !== 'string') return;

  // 内部或特殊协议页面不处理
  if (!visitUrl.startsWith('http://') && !visitUrl.startsWith('https://')) {
    return;
  }

  const now = Date.now();

  // A. 静默免记录模式检测：若处于开启中，抹除一切新访问
  if (cachedSilentUntil > now) {
    try {
      await browserApi.history.deleteUrl(visitUrl);
      console.log('[HistGuard BG] 静默免记录中，已抹除:', visitUrl);
    } catch (err) {
      console.error('[HistGuard BG] 静默删除失败:', err);
    }
    return;
  } else if (cachedSilentUntil > 0 && cachedSilentUntil <= now) {
    // 刚过期
    cachedSilentUntil = 0;
    await clearSilentMode();
  }

  // B. 规则自动隐藏检测
  // 如果当前缓存为空，尝试重新拉取最新规则
  if (!cachedRules || cachedRules.length === 0) {
    const allRules = await getRules();
    cachedRules = allRules.filter(r => r.enabled !== false);
  }

  const { matched, rule } = findMatchingRule(cachedRules, { url: visitUrl, title });

  if (matched && rule) {
    try {
      // 1. 立即物理删除
      await browserApi.history.deleteUrl(visitUrl);
      // 累加拦截命中计数（根据用户偏好设置控制是否记录，支持极致无痕）
      if (cachedSettings.enableHitTracking !== false) {
        await incrementRuleHits(rule.id);
      }
      console.log(`[HistGuard BG] 命中规则 [${rule.pattern}]，已成功抹除历史:`, visitUrl);
    } catch (err) {
      console.error('[HistGuard BG] 执行删除或命中统计失败:', err);
    }

    // 2. 防 Chrome 异步写入延迟与 Google 搜索等多级跳转/SPA pushState 残留：
    // 双重延迟重试，并在短时间历史中扫描清除可能被浏览器滞后写入的匹配条目
    const cleanResiduals = async () => {
      try {
        await browserApi.history.deleteUrl(visitUrl);

        // 如果是关键词规则，检索最近 30 秒内的匹配条目彻底抹除
        const searchKeyword = rule.type === 'keyword' ? rule.pattern.replace(/^(?:keyword|kw):\s*/i, '') : '';
        if (searchKeyword) {
          const recent = await browserApi.history.search({
            text: searchKeyword,
            startTime: Date.now() - 30000,
            maxResults: 30
          });
          for (const item of recent) {
            if (item && item.url && matchesRule(rule, item)) {
              await browserApi.history.deleteUrl(item.url);
            }
          }
        }
      } catch (e) {
        // 忽略非致命异常
      }
    };

    setTimeout(cleanResiduals, 200);
    setTimeout(cleanResiduals, 800);
  }
}

// 4. 多通道监听机制（全面覆盖标准导航、地址栏回车、单页 SPA pushState/replaceState）
// A. 标准历史新增访问事件
if (browserApi.history && typeof browserApi.history.onVisited === 'function') {
  browserApi.history.onVisited(async (historyItem) => {
    const visitUrl = typeof historyItem === 'string' ? historyItem : historyItem?.url;
    const title = typeof historyItem === 'object' ? (historyItem.title || '') : '';
    await handleUrlInspectionAndClean(visitUrl, title);
  });
}

// B. 标签页实时 URL 变动事件（解决 Google 搜索、SPA 客户端无刷新路由）
if (browserApi.tabs && typeof browserApi.tabs.onUpdated === 'function') {
  browserApi.tabs.onUpdated(async (tabId, changeInfo, tab) => {
    const url = changeInfo.url || (changeInfo.status === 'complete' ? tab?.url : null);
    if (url) {
      await handleUrlInspectionAndClean(url, tab?.title || '');
      const lang = browserApi.i18n.getUILanguage() || 'zh-CN';
      await updateTabToolbarIndicator(tabId, url, tab?.title || '', cachedRules, cachedSilentUntil, lang);
    }
  });
}

// C. 活动标签页切换事件（用户点击切换到不同标签页时，瞬时同步该标签页的工具栏图标与角标）
if (browserApi.tabs && typeof browserApi.tabs.onActivated === 'function') {
  browserApi.tabs.onActivated(async (activeInfo) => {
    try {
      const activeTab = await browserApi.tabs.getCurrentActiveTab();
      if (activeTab && activeTab.id === activeInfo.tabId) {
        const lang = browserApi.i18n.getUILanguage() || 'zh-CN';
        await updateTabToolbarIndicator(activeTab.id, activeTab.url, activeTab.title, cachedRules, cachedSilentUntil, lang);
      }
    } catch {
      // 忽略非致命异常
    }
  });
}

// D. WebNavigation 历史栈更新事件（专门捕获 history.pushState / history.replaceState）
if (browserApi.webNavigation && typeof browserApi.webNavigation.onHistoryStateUpdated === 'function') {
  browserApi.webNavigation.onHistoryStateUpdated(async (details) => {
    if (details && details.url && (details.frameId === 0 || details.frameId === undefined)) {
      await handleUrlInspectionAndClean(details.url);
      if (typeof details.tabId === 'number') {
        const lang = browserApi.i18n.getUILanguage() || 'zh-CN';
        await updateTabToolbarIndicator(details.tabId, details.url, '', cachedRules, cachedSilentUntil, lang);
      }
    }
  });
}

// E. WebNavigation 主框架导航提交事件
if (browserApi.webNavigation && typeof browserApi.webNavigation.onCommitted === 'function') {
  browserApi.webNavigation.onCommitted(async (details) => {
    if (details && details.url && (details.frameId === 0 || details.frameId === undefined)) {
      await handleUrlInspectionAndClean(details.url);
      if (typeof details.tabId === 'number') {
        const lang = browserApi.i18n.getUILanguage() || 'zh-CN';
        await updateTabToolbarIndicator(details.tabId, details.url, '', cachedRules, cachedSilentUntil, lang);
      }
    }
  });
}

console.log('[HistGuard BG] 后台拦截守护服务已启动就绪 (多通道拦截与工具栏状态指示引擎)');
