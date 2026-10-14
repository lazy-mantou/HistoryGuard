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
  SETTINGS: 'histguard_settings'
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
  const cleanPattern = (pattern || '').trim();
  if (!cleanPattern) {
    throw new Error('规则表达式不能为空');
  }

  const actualType = type || detectRuleType(cleanPattern);
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
  return rule;
}

/**
 * 删除指定规则
 * @param {string} ruleId
 * @returns {Promise<boolean>}
 */
export async function deleteRule(ruleId) {
  const currentRules = await getRules();
  const filtered = currentRules.filter(r => r.id !== ruleId);
  if (filtered.length !== currentRules.length) {
    await saveRules(filtered);
    return true;
  }
  return false;
}

/**
 * 累加规则拦截命中次数
 * @param {string} ruleId
 * @returns {Promise<number>}
 */
export async function incrementRuleHits(ruleId) {
  const currentRules = await getRules();
  const rule = currentRules.find(r => r.id === ruleId);
  if (!rule) return 0;

  rule.hits = (rule.hits || 0) + 1;
  await saveRules(currentRules);
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
        type: item.type === 'path' ? 'path' : 'domain',
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
