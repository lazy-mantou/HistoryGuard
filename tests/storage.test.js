/**
 * @file storage.test.js
 * @description 规则存储、配置管理器与静默模式单元测试用例
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getRules,
  saveRules,
  addRule,
  toggleRule,
  deleteRule,
  incrementRuleHits,
  resetRuleHits,
  clearAllRules,
  getSilentMode,
  setSilentMode,
  clearSilentMode,
  importRules,
  exportRules,
  getSettings,
  saveSettings,
  DEFAULT_SETTINGS
} from '../src/core/storage.js';

// 内存模拟存储
let mockStorageMap = new Map();
let mockAlarmsMap = new Map();

beforeEach(() => {
  mockStorageMap.clear();
  mockAlarmsMap.clear();

  // 注入全真模拟 chrome 抽象环境
  globalThis.chrome = {
    storage: {
      local: {
        get: (keys, callback) => {
          const result = {};
          if (Array.isArray(keys)) {
            keys.forEach(k => {
              if (mockStorageMap.has(k)) {
                result[k] = JSON.parse(JSON.stringify(mockStorageMap.get(k)));
              }
            });
          } else if (typeof keys === 'string') {
            if (mockStorageMap.has(keys)) {
              result[keys] = JSON.parse(JSON.stringify(mockStorageMap.get(keys)));
            }
          }
          callback(result);
        },
        set: (items, callback) => {
          for (const [k, v] of Object.entries(items)) {
            mockStorageMap.set(k, JSON.parse(JSON.stringify(v)));
          }
          if (callback) callback();
        }
      }
    },
    alarms: {
      create: (name, info) => {
        mockAlarmsMap.set(name, info);
      },
      clear: (name, callback) => {
        const existed = mockAlarmsMap.delete(name);
        if (callback) callback(existed);
      }
    },
    runtime: {
      lastError: null
    }
  };
});

afterEach(() => {
  delete globalThis.chrome;
});

describe('storage - 规则增删改查与计数', () => {
  it('应当能正常添加新规则并生成唯一 ID 与初始元数据', async () => {
    const res = await addRule({ pattern: 'twitter.com', type: 'domain' });
    assert.strictEqual(res.isNew, true);
    assert.strictEqual(res.rule.pattern, 'twitter.com');
    assert.strictEqual(res.rule.type, 'domain');
    assert.strictEqual(res.rule.enabled, true);
    assert.strictEqual(res.rule.hits, 0);
    assert.ok(res.rule.id.startsWith('rule_'));

    const list = await getRules();
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].pattern, 'twitter.com');
  });

  it('添加重复规则时应当更新并重新激活，不产生重复条目', async () => {
    const r1 = await addRule({ pattern: 'weibo.com', enabled: false });
    assert.strictEqual(r1.isNew, true);

    const r2 = await addRule({ pattern: 'WEIBO.COM', enabled: true });
    assert.strictEqual(r2.isNew, false);
    assert.strictEqual(r2.rule.enabled, true);

    const list = await getRules();
    assert.strictEqual(list.length, 1);
  });

  it('添加空规则时应当抛出异常', async () => {
    await assert.rejects(async () => {
      await addRule({ pattern: '   ' });
    }, /规则表达式不能为空/);
  });

  it('toggleRule 应当正确切换或强制设置启用状态', async () => {
    const { rule } = await addRule({ pattern: 'youtube.com' });
    assert.strictEqual(rule.enabled, true);

    const toggled = await toggleRule(rule.id);
    assert.strictEqual(toggled.enabled, false);

    const forced = await toggleRule(rule.id, true);
    assert.strictEqual(forced.enabled, true);
  });

  it('deleteRule 应当正确移除目标规则', async () => {
    const { rule } = await addRule({ pattern: 'reddit.com' });
    const success = await deleteRule(rule.id);
    assert.strictEqual(success, true);

    const list = await getRules();
    assert.strictEqual(list.length, 0);

    const deleteNonExistent = await deleteRule('non_existent_id');
    assert.strictEqual(deleteNonExistent, false);
  });

  it('incrementRuleHits 与 resetRuleHits 应当正确累加和归零', async () => {
    const { rule } = await addRule({ pattern: 'bilibili.com' });
    assert.strictEqual(rule.hits, 0);

    await incrementRuleHits(rule.id);
    const hits2 = await incrementRuleHits(rule.id);
    assert.strictEqual(hits2, 2);

    const resetCount = await resetRuleHits();
    assert.strictEqual(resetCount, 1);

    const list = await getRules();
    assert.strictEqual(list[0].hits, 0);
  });

  it('clearAllRules 应当清空所有规则', async () => {
    await addRule({ pattern: 'rule1.com' });
    await addRule({ pattern: 'rule2.com' });
    let list = await getRules();
    assert.strictEqual(list.length, 2);

    await clearAllRules();
    list = await getRules();
    assert.strictEqual(list.length, 0);
  });
});

describe('storage - 静默免记录模式', () => {
  it('开启静默模式应正确持久化并注册 alarm 定时器', async () => {
    const state = await setSilentMode(30);
    assert.strictEqual(state.active, true);
    assert.ok(state.until > Date.now());
    assert.ok(mockAlarmsMap.has('silent_mode_alarm'));

    const current = await getSilentMode();
    assert.strictEqual(current.active, true);
    assert.ok(current.remainingMs > 0);
  });

  it('解除静默模式应清空状态并清除 alarm', async () => {
    await setSilentMode(15);
    await clearSilentMode();

    const current = await getSilentMode();
    assert.strictEqual(current.active, false);
    assert.strictEqual(mockAlarmsMap.has('silent_mode_alarm'), false);
  });

  it('已过期的静默模式应自动重置为非活跃状态', async () => {
    // 注入过期时间戳
    mockStorageMap.set('histguard_silent_mode', {
      active: true,
      until: Date.now() - 5000
    });

    const current = await getSilentMode();
    assert.strictEqual(current.active, false);
  });
});

describe('storage - 导入与导出', () => {
  it('导出规则应生成标准 JSON 结构', async () => {
    await addRule({ pattern: 'github.com' });
    const jsonStr = await exportRules();
    const parsed = JSON.parse(jsonStr);

    assert.strictEqual(parsed.version, '1.0.0');
    assert.ok(Array.isArray(parsed.rules));
    assert.strictEqual(parsed.rules.length, 1);
    assert.strictEqual(parsed.rules[0].pattern, 'github.com');
  });

  it('合并模式 (merge) 导入规则应去重合并', async () => {
    await addRule({ pattern: 'a.com' });

    const importPayload = JSON.stringify({
      rules: [
        { pattern: 'a.com' },
        { pattern: 'b.com' },
        { pattern: 'c.com' }
      ]
    });

    const result = await importRules(importPayload, 'merge');
    assert.strictEqual(result.importedCount, 2);
    assert.strictEqual(result.totalCount, 3);
  });

  it('覆盖模式 (replace) 导入规则应替换全部规则', async () => {
    await addRule({ pattern: 'old.com' });

    const importPayload = JSON.stringify({
      rules: [
        { pattern: 'new1.com' },
        { pattern: 'new2.com' }
      ]
    });

    const result = await importRules(importPayload, 'replace');
    assert.strictEqual(result.importedCount, 2);
    assert.strictEqual(result.totalCount, 2);

    const list = await getRules();
    assert.strictEqual(list.some(r => r.pattern === 'old.com'), false);
    assert.strictEqual(list.some(r => r.pattern === 'new1.com'), true);
  });

  it('导入非法 JSON 时应抛出明确异常', async () => {
    await assert.rejects(async () => {
      await importRules('invalid json');
    }, /导入失败：不是合法的 JSON 格式文本/);
  });
});

describe('storage - 全局偏好设置 (Settings)', () => {
  it('初次获取设置应返回默认设置', async () => {
    const settings = await getSettings();
    assert.strictEqual(settings.theme, 'auto');
    assert.strictEqual(settings.language, DEFAULT_SETTINGS.language);
    assert.strictEqual(settings.enableHitTracking, true);
    assert.strictEqual(settings.silentModeDuration, 30);
  });

  it('保存部分设置应与现有配置合并', async () => {
    const updated = await saveSettings({
      theme: 'dark',
      language: 'en',
      enableHitTracking: false
    });

    assert.strictEqual(updated.theme, 'dark');
    assert.strictEqual(updated.language, 'en');
    assert.strictEqual(updated.enableHitTracking, false);
    // 未修改的属性保持默认
    assert.strictEqual(updated.silentModeDuration, 30);

    const fetched = await getSettings();
    assert.strictEqual(fetched.theme, 'dark');
    assert.strictEqual(fetched.language, 'en');
    assert.strictEqual(fetched.enableHitTracking, false);
  });
});
