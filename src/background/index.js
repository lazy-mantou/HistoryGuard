/**
 * @file index.js (Background Service Worker / Background Script)
 * @description 后台守护服务
 * 监听浏览器历史记录新增事件，执行毫秒级静默拦截与删除，管理 30 分钟免记录倒计时
 */

import { browserApi } from '../adapters/index.js';
import { findMatchingRule } from '../core/ruleMatcher.js';
import {
  getRules,
  getSilentMode,
  clearSilentMode,
  incrementRuleHits,
  getSettings,
  DEFAULT_SETTINGS,
  STORAGE_KEYS
} from '../core/storage.js';

// 内存中缓存已启用的规则、静默模式与运行设置，保证在 onVisited 高频触发时毫秒级响应
let cachedRules = [];
let cachedSilentUntil = 0;
let cachedSettings = { ...DEFAULT_SETTINGS };

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
    console.log('[HistGuard BG] 30 分钟静默免记录模式已到期，恢复正常历史记录监控。');
  }
});

// 4. 监听历史记录新增访问事件 (核心拦截逻辑)
browserApi.history.onVisited(async (historyItem) => {
  if (!historyItem || !historyItem.url) return;
  const visitUrl = historyItem.url;

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

  const { matched, rule } = findMatchingRule(cachedRules, historyItem);

  if (matched && rule) {
    try {
      // 立即物理删除
      await browserApi.history.deleteUrl(visitUrl);
      // 累加拦截命中计数（根据用户偏好设置控制是否记录，支持极致无痕）
      if (cachedSettings.enableHitTracking !== false) {
        await incrementRuleHits(rule.id);
      }
      console.log(`[HistGuard BG] 命中规则 [${rule.pattern}]，已成功抹除历史:`, visitUrl);
    } catch (err) {
      console.error('[HistGuard BG] 执行删除或命中统计失败:', err);
    }
  }
});

console.log('[HistGuard BG] 后台拦截守护服务已启动就绪');
