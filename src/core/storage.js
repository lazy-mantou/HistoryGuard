/**
 * @file storage.js
 * @description 规则与状态存储管理器
 * 基于统一 browserApi 抽象层实现规则增删改查、命中统计与静默模式生命周期维护
 */

import { browserApi } from '../adapters/index.js';
import { detectRuleType } from './ruleMatcher.js';

export const STORAGE_KEYS = {
  RULES: 'histguard_rules',
  SILENT_MODE: 'histguard_silent_mode',
  SETTINGS: 'histguard_settings',
  PENDING_CLEAN_JOB: 'histguard_pending_clean_job',
  STATS: 'histguard_stats'
};

/**
 * 获取所有存储的规则列表
 * @returns {Promise<Array<Object>>}
 */
export async function getRules() {
  const data = await browserApi.storage.get([STORAGE_KEYS.RULES]);
  const rules = data[STORAGE_KEYS.RULES];
  return Array.isArray(rules) ? rules : [];
}

/**
 * 保存规则列表
 * @param {Array<Object>} rules
 * @returns {Promise<void>}
 */
export async function saveRules(rules) {
  await browserApi.storage.set({
    [STORAGE_KEYS.RULES]: Array.isArray(rules) ? rules : []
  });
}

/**
 * 添加一条新规则
 * @param {Object} param0 - { pattern, type, enabled }
 * @returns {Promise<{ rule: Object, isNew: boolean }>}
 */
export async function addRule({ pattern, type, enabled = true }) {
  let cleanPattern = (pattern || '').trim();
  if (!cleanPattern) {
    throw new Error('规则表达式不能为空');
  }

  let actualType = type;

  // 智能解析用户输入中可能包含的前缀修饰符 (如 keyword:xxx, kw:xxx, domain:xxx, path:xxx)
  if (/^keyword:\s*/i.test(cleanPattern)) {
    actualType = 'keyword';
    cleanPattern = cleanPattern.replace(/^keyword:\s*/i, '').trim();
  } else if (/^kw:\s*/i.test(cleanPattern)) {
    actualType = 'keyword';
    cleanPattern = cleanPattern.replace(/^kw:\s*/i, '').trim();
  } else if (/^domain:\s*/i.test(cleanPattern)) {
    actualType = 'domain';
    cleanPattern = cleanPattern.replace(/^domain:\s*/i, '').trim();
  } else if (/^path:\s*/i.test(cleanPattern)) {
    actualType = 'path';
    cleanPattern = cleanPattern.replace(/^path:\s*/i, '').trim();
  }

  if (!cleanPattern) {
    throw new Error('规则表达式不能为空');
  }

  actualType = actualType || detectRuleType(cleanPattern);

  // 核心规范化：针对域名规则（无论是自动推断还是显式指定为 domain）
  // 若用户输入带有协议前缀 (https:// / http://) 或末尾根路径斜杠 (/)，自动纯化为纯域名
  // 例如：输入 "https://www.google.com/" -> 优先识别为 domain 并保存为 "www.google.com"
  if (actualType === 'domain') {
    cleanPattern = cleanPattern.replace(/^https?:\/\//i, '');
    cleanPattern = cleanPattern.replace(/\/+$/, '').trim();
  } else if (actualType === 'path') {
    // 路径规则同样剥离协议头，规范化前缀格式
    cleanPattern = cleanPattern.replace(/^https?:\/\//i, '').trim();
  }

  const currentRules = await getRules();

  // 检查是否已有完全相同的规则表达式
  const existingIndex = currentRules.findIndex(
    r => r.pattern.toLowerCase() === cleanPattern.toLowerCase()
  );

  if (existingIndex >= 0) {
    // 已经存在，更新状态为启用
    currentRules[existingIndex].enabled = true;
    currentRules[existingIndex].type = actualType;
    await saveRules(currentRules);
    return { rule: currentRules[existingIndex], isNew: false };
  }

  const newRule = {
    id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    pattern: cleanPattern,
    type: actualType,
    enabled: Boolean(enabled),
    hits: 0,
    createdAt: Date.now()
  };

  currentRules.unshift(newRule);
  await saveRules(currentRules);
  return { rule: newRule, isNew: true };
}

/**
 * 切换某条规则的启用/禁用状态
 * @param {string} ruleId
 * @param {boolean} [forcedState]
 * @returns {Promise<Object|null>}
 */
export async function toggleRule(ruleId, forcedState) {
  const currentRules = await getRules();
  const rule = currentRules.find(r => r.id === ruleId);
  if (!rule) return null;

  rule.enabled = typeof forcedState === 'boolean' ? forcedState : !rule.enabled;
  await saveRules(currentRules);
  if (!rule.enabled) {
    try {
      const pending = await getPendingCleanJob();
      if (pending && (pending.rule?.id === ruleId || pending.rule?.pattern === rule.pattern)) {
        await clearPendingCleanJob();
      }
    } catch {
      // ignore
    }
  }
  return rule;
}

/**
 * 删除指定规则
 * @param {string} ruleId
 * @returns {Promise<boolean>}
 */
export async function deleteRule(ruleId) {
  const currentRules = await getRules();
  const ruleToDelete = currentRules.find(r => r.id === ruleId);
  const filtered = currentRules.filter(r => r.id !== ruleId);
  if (filtered.length !== currentRules.length) {
    await saveRules(filtered);
    if (ruleToDelete) {
      try {
        const pending = await getPendingCleanJob();
        if (pending && (pending.rule?.id === ruleId || pending.rule?.pattern === ruleToDelete.pattern)) {
          await clearPendingCleanJob();
        }
      } catch {
        // ignore
      }
    }
    return true;
  }
  return false;
}

/**
 * 获取实时拦截统计聚合数据
 * @returns {Promise<{ dailyHits: Object<string, number>, typeHits: { domain: number, path: number, keyword: number }, lastHitTime: number }>}
 */
export async function getInterceptionStats() {
  const data = await browserApi.storage.get([STORAGE_KEYS.STATS]);
  const raw = data[STORAGE_KEYS.STATS];
  const stats = (raw && typeof raw === 'object') ? raw : {};
  return {
    dailyHits: (stats.dailyHits && typeof stats.dailyHits === 'object') ? stats.dailyHits : {},
    typeHits: {
      domain: Number(stats.typeHits?.domain) || 0,
      path: Number(stats.typeHits?.path) || 0,
      keyword: Number(stats.typeHits?.keyword) || 0
    },
    lastHitTime: Number(stats.lastHitTime) || 0
  };
}

/**
 * 累加规则拦截命中次数与实时统计数据
 * （仅在用户真实打开网页被规则即时拦截抹除时调用，不计入后台批量清理）
 * @param {string} ruleId
 * @returns {Promise<number>}
 */
export async function incrementRuleHits(ruleId) {
  const currentRules = await getRules();
  const rule = currentRules.find(r => r.id === ruleId);
  if (!rule) return 0;

  const now = Date.now();
  rule.hits = (rule.hits || 0) + 1;
  rule.lastHitAt = now;
  await saveRules(currentRules);

  try {
    const stats = await getInterceptionStats();
    const todayKey = new Date(now).toISOString().slice(0, 10);
    stats.dailyHits[todayKey] = (stats.dailyHits[todayKey] || 0) + 1;

    // 剔除 90 天前的陈旧聚合数据，保障存储轻量
    const cutoffDate = new Date(now - 90 * 86400 * 1000).toISOString().slice(0, 10);
    for (const dateStr of Object.keys(stats.dailyHits)) {
      if (dateStr < cutoffDate) {
        delete stats.dailyHits[dateStr];
      }
    }

    const ruleType = rule.type === 'keyword' ? 'keyword' : (rule.type === 'path' ? 'path' : 'domain');
    stats.typeHits[ruleType] = (stats.typeHits[ruleType] || 0) + 1;
    stats.lastHitTime = now;

    await browserApi.storage.set({
      [STORAGE_KEYS.STATS]: stats
    });
  } catch (err) {
    console.warn('Record interception stats error:', err);
  }

  return rule.hits;
}

/**
 * 获取静默免记录模式状态
 * 自动校验 30 分钟到期时间
 * @returns {Promise<{ active: boolean, until: number, remainingMs: number }>}
 */
export async function getSilentMode() {
  const data = await browserApi.storage.get([STORAGE_KEYS.SILENT_MODE]);
  const silent = data[STORAGE_KEYS.SILENT_MODE] || { active: false, until: 0 };

  const now = Date.now();
  if (silent.active && silent.until > now) {
    return {
      active: true,
      until: silent.until,
      remainingMs: silent.until - now
    };
  }

  // 若已过期但仍标记为 active，重置状态
  if (silent.active && silent.until <= now) {
    await clearSilentMode();
  }

  return { active: false, until: 0, remainingMs: 0 };
}

/**
 * 开启静默免记录模式 (默认 30 分钟)
 * @param {number} [durationMinutes=30]
 * @returns {Promise<{ active: boolean, until: number }>}
 */
export async function setSilentMode(durationMinutes = 30) {
  const until = Date.now() + durationMinutes * 60 * 1000;
  const state = { active: true, until };

  await browserApi.storage.set({
    [STORAGE_KEYS.SILENT_MODE]: state
  });

  // 设置 alarms 定时器，到期自动唤醒后台恢复
  try {
    await browserApi.alarms.create('silent_mode_alarm', {
      delayInMinutes: durationMinutes
    });
  } catch (err) {
    console.warn('Alarm creation error:', err);
  }

  return state;
}

/**
 * 提前解除静默模式
 * @returns {Promise<void>}
 */
export async function clearSilentMode() {
  await browserApi.storage.set({
    [STORAGE_KEYS.SILENT_MODE]: { active: false, until: 0 }
  });

  try {
    await browserApi.alarms.clear('silent_mode_alarm');
  } catch (err) {
    console.warn('Alarm clear error:', err);
  }
}

/**
 * 导入规则 JSON
 * @param {string} jsonString
 * @param {'merge'|'replace'} [mode='merge']
 * @returns {Promise<{ importedCount: number, totalCount: number }>}
 */
export async function importRules(jsonString, mode = 'merge') {
  let parsed;
  try {
    parsed = JSON.parse(jsonString);
  } catch (err) {
    throw new Error('导入失败：不是合法的 JSON 格式文本');
  }

  const rawRules = Array.isArray(parsed) ? parsed : (parsed.rules || []);
  if (!Array.isArray(rawRules)) {
    throw new Error('导入失败：未找到规则数组数据');
  }

  const validRules = [];
  for (const item of rawRules) {
    if (item && item.pattern && typeof item.pattern === 'string') {
      const pattern = item.pattern.trim();
      if (!pattern) continue;
      validRules.push({
        id: item.id || `rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        pattern,
        type: item.type === 'keyword' ? 'keyword' : (item.type === 'path' ? 'path' : 'domain'),
        enabled: item.enabled !== false,
        hits: typeof item.hits === 'number' ? item.hits : 0,
        createdAt: item.createdAt || Date.now()
      });
    }
  }

  if (mode === 'replace') {
    await saveRules(validRules);
    return { importedCount: validRules.length, totalCount: validRules.length };
  }

  // merge 模式
  const existing = await getRules();
  const patternMap = new Map();
  existing.forEach(r => patternMap.set(r.pattern.toLowerCase(), r));

  let newCount = 0;
  for (const vr of validRules) {
    const key = vr.pattern.toLowerCase();
    if (!patternMap.has(key)) {
      existing.push(vr);
      patternMap.set(key, vr);
      newCount++;
    }
  }

  await saveRules(existing);
  return { importedCount: newCount, totalCount: existing.length };
}

/**
 * 导出规则为 JSON 文本
 * @returns {Promise<string>}
 */
export async function exportRules() {
  const rules = await getRules();
  const exportPayload = {
    version: '1.0.0',
    exportTime: new Date().toISOString(),
    rules
  };
  return JSON.stringify(exportPayload, null, 2);
}

/**
 * 默认偏好配置项
 */
export const DEFAULT_SETTINGS = {
  theme: 'auto',                 // 界面外观主题 ('auto' | 'dark' | 'light')
  language: 'auto',              // 界面显示语言 ('auto' | 'zh-CN' | 'en')
  enableHitTracking: false,      // 是否统计规则拦截次数 (默认关闭)
  silentModeDuration: 30,        // 默认静默模式时长 (分钟)
  historyBatchSize: 100,         // 历史批量删除单批次加载条数 (50 | 100 | 200)
  deleteChunkSize: 'auto',       // 批量删除并发分片大小 ('auto' | 6 | 15 | 30 | 50)
  defaultRuleType: 'auto',       // 快捷添加规则识别模式 ('auto' | 'domain' | 'path' | 'keyword')
  confirmDeepClean: true,        // 流式全量清空前二次确认
  cleanOnAddRule: true,          // 添加防护规则时默认勾选同时清理已有历史记录 (默认打开)
  toastDuration: 2500            // Toast 消息停留时长 (ms)
};

/**
 * 获取全局设置（与默认配置合并）
 * @returns {Promise<typeof DEFAULT_SETTINGS>}
 */
export async function getSettings() {
  const data = await browserApi.storage.get([STORAGE_KEYS.SETTINGS]);
  const stored = data[STORAGE_KEYS.SETTINGS];
  return {
    ...DEFAULT_SETTINGS,
    ...(typeof stored === 'object' && stored !== null ? stored : {})
  };
}

/**
 * 保存全局偏好设置
 * @param {Partial<typeof DEFAULT_SETTINGS>} partialSettings
 * @returns {Promise<typeof DEFAULT_SETTINGS>}
 */
export async function saveSettings(partialSettings) {
  const current = await getSettings();
  const updated = {
    ...current,
    ...partialSettings
  };
  await browserApi.storage.set({
    [STORAGE_KEYS.SETTINGS]: updated
  });
  return updated;
}

/**
 * 一键清空所有规则的拦截计数与历史拦截统计数据
 * @returns {Promise<number>} 受影响的规则数
 */
export async function resetRuleHits() {
  const currentRules = await getRules();
  let updatedCount = 0;
  currentRules.forEach(rule => {
    if (rule.hits && rule.hits > 0) {
      rule.hits = 0;
      delete rule.lastHitAt;
      updatedCount++;
    }
  });
  await saveRules(currentRules);

  await browserApi.storage.set({
    [STORAGE_KEYS.STATS]: {
      dailyHits: {},
      typeHits: { domain: 0, path: 0, keyword: 0 },
      lastHitTime: 0
    }
  });

  return updatedCount;
}

/**
 * 一键清空所有已配置的防护规则
 * @returns {Promise<void>}
 */
export async function clearAllRules() {
  await saveRules([]);
  await clearPendingCleanJob();
}

/**
 * 获取当前持久化的挂起历史出清任务（若有）
 * 用于浏览器意外退出、崩溃或关机重启后自愈续跑
 * @returns {Promise<Object|null>}
 */
export async function getPendingCleanJob() {
  const data = await browserApi.storage.get([STORAGE_KEYS.PENDING_CLEAN_JOB]);
  const job = data[STORAGE_KEYS.PENDING_CLEAN_JOB];
  if (job && typeof job === 'object' && job.rule && job.status === 'in_progress') {
    return job;
  }
  return null;
}

/**
 * 持久化记录正在执行的历史出清任务
 * @param {Object} job - { id, rule, currentUrl, status, startedAt, updatedAt }
 * @returns {Promise<void>}
 */
export async function savePendingCleanJob(job) {
  if (!job || typeof job !== 'object' || !job.rule) return;
  await browserApi.storage.set({
    [STORAGE_KEYS.PENDING_CLEAN_JOB]: {
      id: job.id || `clean_job_${Date.now()}`,
      rule: job.rule,
      currentUrl: job.currentUrl || '',
      status: job.status || 'in_progress',
      startedAt: job.startedAt || Date.now(),
      updatedAt: Date.now()
    }
  });
}

/**
 * 清除已完成或取消的挂起出清任务
 * @returns {Promise<void>}
 */
export async function clearPendingCleanJob() {
  await browserApi.storage.set({
    [STORAGE_KEYS.PENDING_CLEAN_JOB]: null
  });
}


