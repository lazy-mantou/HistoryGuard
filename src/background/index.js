/**
 * @file index.js (Background Service Worker / Background Script)
 * @description 后台守护服务
 * 监听浏览器历史记录新增事件，执行毫秒级静默拦截与删除，管理 30 分钟免记录倒计时
 */

import { browserApi } from '../adapters/index.js';
import { findMatchingRule, matchesRule } from '../core/ruleMatcher.js';
import { cleanHistoryByRule, resolveDeleteConcurrency } from '../core/historyCleaner.js';
import {
  getRules,
  getSilentMode,
  clearSilentMode,
  incrementRuleHits,
  getSettings,
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  getPendingCleanJob,
  savePendingCleanJob,
  clearPendingCleanJob
} from '../core/storage.js';
import { updateTabToolbarIndicator, updateGlobalToolbarIndicator, ICON_PATHS } from './toolbarIndicator.js';

// 内存中缓存已启用的规则、静默模式与运行设置，保证在 onVisited 高频触发时毫秒级响应
let cachedRules = [];
let cachedSilentUntil = 0;
let cachedSettings = { ...DEFAULT_SETTINGS };
let isSettingsLoaded = false;
let settingsFetchPromise = null;

/**
 * 安全获取当前偏好设置（解决 MV3 Service Worker 冷启动竞态下默认配置未决问题）
 * @returns {Promise<typeof DEFAULT_SETTINGS>}
 */
async function getOrFetchSettings() {
  if (isSettingsLoaded) {
    return cachedSettings;
  }
  if (!settingsFetchPromise) {
    settingsFetchPromise = getSettings()
      .then(s => {
        cachedSettings = s;
        isSettingsLoaded = true;
        settingsFetchPromise = null;
        return s;
      })
      .catch(err => {
        settingsFetchPromise = null;
        return cachedSettings;
      });
  }
  return settingsFetchPromise;
}

/**
 * 全量同步所有标签页与全局默认的工具栏状态指示器
 */
async function syncAllTabsToolbarIndicators() {
  const lang = browserApi.i18n.getUILanguage() || 'zh-CN';

  // 1. 同步扩展全局默认工具栏状态（不绑定具体 tabId，设置全局兜底外观）
  await updateGlobalToolbarIndicator(cachedSilentUntil, lang);

  // 2. 遍历同步当前已打开的所有标签页具体状态
  try {
    if (typeof browserApi.tabs.query === 'function') {
      const tabs = await browserApi.tabs.query({});
      if (Array.isArray(tabs)) {
        for (const tab of tabs) {
          if (tab && typeof tab.id === 'number') {
            await updateTabToolbarIndicator(
              tab.id,
              tab.url || '',
              tab.title || '',
              cachedRules,
              cachedSilentUntil,
              lang
            );
          }
        }
      }
    } else {
      const activeTab = await browserApi.tabs.getCurrentActiveTab();
      if (activeTab && typeof activeTab.id === 'number') {
        await updateTabToolbarIndicator(
          activeTab.id,
          activeTab.url,
          activeTab.title,
          cachedRules,
          cachedSilentUntil,
          lang
        );
      }
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
    isSettingsLoaded = true;

    // 缓存刷新后立即同步全局与各标签页的工具栏指示器
    await syncAllTabsToolbarIndicators();
  } catch (err) {
    console.error('[HistGuard BG] Failed to refresh cache:', err);
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
    await syncAllTabsToolbarIndicators();
    console.log('[HistGuard BG] 30-minute silent mode expired. Resumed normal history monitoring.');
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

  // A. 临时无痕模式检测：若处于开启中，抹除一切新访问
  if (cachedSilentUntil > now) {
    try {
      await browserApi.history.deleteUrl(visitUrl);
      console.log('[HistGuard BG] Silent mode active, erased:', visitUrl);
    } catch (err) {
      console.error('[HistGuard BG] Silent mode erasure failed:', err);
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
      const currentSettings = await getOrFetchSettings();
      if (currentSettings.enableHitTracking === true) {
        await incrementRuleHits(rule.id);
      }
      console.log(`[HistGuard BG] Matched rule [${rule.pattern}], history erased:`, visitUrl);
    } catch (err) {
      console.error('[HistGuard BG] Failed to erase history or record hit stats:', err);
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

// B. 标签页实时 URL 变动事件（解决 Google 搜索、SPA 客户端无刷新路由与实时状态反馈）
if (browserApi.tabs && typeof browserApi.tabs.onUpdated === 'function') {
  browserApi.tabs.onUpdated(async (tabId, changeInfo, tab) => {
    const targetUrl = changeInfo.url || tab?.url;
    if (targetUrl) {
      if (changeInfo.url || changeInfo.status === 'complete') {
        await handleUrlInspectionAndClean(targetUrl, tab?.title || '');
      }
      const lang = browserApi.i18n.getUILanguage() || 'zh-CN';
      await updateTabToolbarIndicator(tabId, targetUrl, tab?.title || '', cachedRules, cachedSilentUntil, lang);
    }
  });
}

// C. 活动标签页切换事件（用户点击切换到不同标签页时，瞬时同步该标签页的工具栏图标与角标）
if (browserApi.tabs && typeof browserApi.tabs.onActivated === 'function') {
  browserApi.tabs.onActivated(async (activeInfo) => {
    try {
      let targetTab = null;
      if (typeof browserApi.tabs.get === 'function') {
        targetTab = await browserApi.tabs.get(activeInfo.tabId);
      }
      if (!targetTab) {
        targetTab = await browserApi.tabs.getCurrentActiveTab();
      }
      if (targetTab && typeof targetTab.id === 'number') {
        const lang = browserApi.i18n.getUILanguage() || 'zh-CN';
        await updateTabToolbarIndicator(targetTab.id, targetTab.url, targetTab.title, cachedRules, cachedSilentUntil, lang);
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

// F. 监听来自 Popup 或 Options 的消息（支持将繁重的历史回溯清理委托给持久后台进程执行）
let backgroundCleaningState = {
  isCleaning: false,
  rulePattern: '',
  deleted: 0,
  scanned: 0,
  lastUpdated: 0
};

if (browserApi.runtime && typeof browserApi.runtime.onMessage === 'function') {
  browserApi.runtime.onMessage(async (message) => {
    if (message?.action === 'CLEAN_HISTORY_BY_RULE') {
      const { rule, currentUrl } = message;
      if (!rule) return { success: false, error: 'Rule is required' };

      backgroundCleaningState.isCleaning = true;
      backgroundCleaningState.rulePattern = typeof rule === 'string' ? rule : (rule.pattern || '');
      backgroundCleaningState.deleted = 0;
      backgroundCleaningState.scanned = 0;
      backgroundCleaningState.lastUpdated = Date.now();

      // 持久化记录正在执行的任务，以防浏览器意外退出或关机
      await savePendingCleanJob({
        rule,
        currentUrl,
        status: 'in_progress',
        startedAt: Date.now()
      });

      try {
        console.log(`[HistGuard BG] Starting background full history clean for rule: [${backgroundCleaningState.rulePattern}]`);
        const currentSettings = await getOrFetchSettings();
        const concurrency = resolveDeleteConcurrency(currentSettings.deleteChunkSize, browserApi);
        const result = await cleanHistoryByRule(rule, {
          concurrency,
          onProgress: ({ deleted, scanned }) => {
            backgroundCleaningState.deleted = deleted;
            backgroundCleaningState.scanned = scanned;
            backgroundCleaningState.lastUpdated = Date.now();
          }
        });

        if (currentUrl) {
          try {
            await browserApi.history.deleteUrl(currentUrl);
          } catch {
            // ignore
          }
        }

        backgroundCleaningState.isCleaning = false;
        console.log(`[HistGuard BG] Background clean completed: deleted ${result.deleted}, scanned ${result.scanned}`);
        return { success: true, deleted: result.deleted, scanned: result.scanned };
      } catch (err) {
        backgroundCleaningState.isCleaning = false;
        console.error('[HistGuard BG] Background clean failed:', err);
        return { success: false, error: err.message, deleted: backgroundCleaningState.deleted, scanned: backgroundCleaningState.scanned };
      } finally {
        await clearPendingCleanJob();
      }
    }

    if (message?.action === 'GET_CLEANING_STATUS') {
      return { success: true, ...backgroundCleaningState };
    }

    return null;
  });
}

/**
 * 启动自愈探测：检查是否存在因浏览器异常崩溃、强制退出或关机断电而中断的挂起历史出清任务
 * 若存在，以无感让步模式自动续跑剩余未删记录，保障数据一致性与隐私抹除确定性
 * @param {number} [delayMs=2500] 启动冷启动延时缓冲 (ms)
 * @returns {Promise<Object|null>}
 */
export async function checkAndResumePendingCleanJob(delayMs = 2500) {
  if (delayMs > 0) {
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  try {
    const pendingJob = await getPendingCleanJob();
    if (!pendingJob || !pendingJob.rule) {
      return null;
    }

    const rulePattern = typeof pendingJob.rule === 'string' ? pendingJob.rule : (pendingJob.rule.pattern || '');
    console.log(`[HistGuard BG] Found interrupted history clean job [${rulePattern}], initiating self-healing resume...`);

    // 校验规则是否依然有效且未被停用
    const allRules = await getRules();
    const ruleId = pendingJob.rule.id;
    const existingRule = allRules.find(r => (ruleId && r.id === ruleId) || r.pattern === rulePattern);

    if (existingRule && existingRule.enabled === false) {
      console.log(`[HistGuard BG] Pending clean job rule is disabled, cancelling resume:`, rulePattern);
      await clearPendingCleanJob();
      return null;
    }

    backgroundCleaningState.isCleaning = true;
    backgroundCleaningState.rulePattern = rulePattern;
    backgroundCleaningState.deleted = 0;
    backgroundCleaningState.scanned = 0;
    backgroundCleaningState.lastUpdated = Date.now();

    const currentSettings = await getOrFetchSettings();
    const concurrency = resolveDeleteConcurrency(currentSettings.deleteChunkSize, browserApi);
    const result = await cleanHistoryByRule(pendingJob.rule, {
      concurrency,
      onProgress: ({ deleted, scanned }) => {
        backgroundCleaningState.deleted = deleted;
        backgroundCleaningState.scanned = scanned;
        backgroundCleaningState.lastUpdated = Date.now();
      }
    });

    if (pendingJob.currentUrl) {
      try {
        await browserApi.history.deleteUrl(pendingJob.currentUrl);
      } catch {
        // ignore
      }
    }

    console.log(`[HistGuard BG] Self-healing clean completed: deleted ${result.deleted}, scanned ${result.scanned}`);
    return result;
  } catch (err) {
    console.error('[HistGuard BG] Self-healing clean execution failed:', err);
    return null;
  } finally {
    backgroundCleaningState.isCleaning = false;
    await clearPendingCleanJob();
  }
}

// 5. 启动自愈机制：延迟检查并恢复因意外退出而中断的历史出清任务
checkAndResumePendingCleanJob(2500).catch(err => {
  console.error('[HistGuard BG] Error resuming pending clean job:', err);
});

console.log('[HistGuard BG] Background protection service ready (multi-channel interception, toolbar indicator, and clean engine).');
