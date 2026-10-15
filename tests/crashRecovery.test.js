/**
 * @file crashRecovery.test.js
 * @description 异常中断与崩溃自愈续跑机制 (Crash Recovery & Persistent Clean Job) 单元测试
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  savePendingCleanJob,
  getPendingCleanJob,
  clearPendingCleanJob,
  addRule,
  toggleRule,
  saveRules
} from '../src/core/storage.js';
import { checkAndResumePendingCleanJob } from '../src/background/index.js';

let mockStorageMap = new Map();
let deletedHistoryUrls = [];
let mockHistoryDatabase = [];

beforeEach(() => {
  mockStorageMap.clear();
  deletedHistoryUrls = [];
  mockHistoryDatabase = [
    { url: 'https://youtube.com/watch?v=1', title: 'Video 1', lastVisitTime: 1000 },
    { url: 'https://youtube.com/watch?v=2', title: 'Video 2', lastVisitTime: 2000 },
    { url: 'https://github.com/trending', title: 'GitHub', lastVisitTime: 3000 },
    { url: 'https://youtube.com/shorts/3', title: 'Video 3', lastVisitTime: 4000 }
  ];

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
      create: () => {},
      clear: () => {}
    },
    runtime: {
      lastError: null,
      onMessage: {
        addListener: () => {}
      }
    },
    history: {
      search: (query, callback) => {
        const text = (query.text || '').toLowerCase();
        const results = mockHistoryDatabase.filter(item => {
          return !text || item.url.toLowerCase().includes(text) || (item.title && item.title.toLowerCase().includes(text));
        });
        callback(results);
      },
      deleteUrl: (details, callback) => {
        const targetUrl = details?.url || details;
        deletedHistoryUrls.push(targetUrl);
        mockHistoryDatabase = mockHistoryDatabase.filter(item => item.url !== targetUrl);
        if (callback) callback();
      }
    },
    tabs: {
      query: (filter, callback) => callback([]),
      get: (id, callback) => callback(null),
      getCurrentActiveTab: (callback) => callback(null)
    },
    action: {
      setIcon: (details, cb) => cb && cb(),
      setBadgeText: (details, cb) => cb && cb(),
      setTitle: (details, cb) => cb && cb()
    },
    i18n: {
      getUILanguage: () => 'zh-CN',
      getMessage: (k) => k
    }
  };
});

afterEach(() => {
  delete globalThis.chrome;
});

describe('crashRecovery - 浏览器关机/异常退出自愈续跑', () => {
  it('当没有挂起任务时，启动自愈探测应静默返回 null，不触发任何历史删除', async () => {
    const result = await checkAndResumePendingCleanJob(0);
    assert.strictEqual(result, null);
    assert.strictEqual(deletedHistoryUrls.length, 0);
  });

  it('当存在异常中断的挂起出清任务时，应自动在后台自愈完成历史清理并清空任务队列', async () => {
    const { rule } = await addRule({ pattern: 'youtube.com', type: 'domain' });
    
    // 模拟上次浏览器在执行清理时突然崩溃，遗留状态为 in_progress
    await savePendingCleanJob({
      rule,
      currentUrl: 'https://youtube.com/watch?v=current',
      status: 'in_progress',
      startedAt: Date.now() - 60000
    });

    assert.ok(await getPendingCleanJob(), '挂起任务应当已存入 storage');

    // 浏览器再次启动，执行自愈续跑
    const result = await checkAndResumePendingCleanJob(0);

    assert.ok(result, '应当成功返回清理统计结果');
    assert.strictEqual(result.deleted, 3, '应当删除了 3 条匹配的 youtube 历史');
    assert.ok(deletedHistoryUrls.includes('https://youtube.com/watch?v=current'), '当前访问页应当被额外清理');
    
    // 自愈完成后，挂起任务应当被清除
    const pendingAfter = await getPendingCleanJob();
    assert.strictEqual(pendingAfter, null, '完成清理后挂起任务必须已自动清除');
  });

  it('若挂起任务对应的规则在自愈执行前已被停用，应跳过清理并自动废弃该任务', async () => {
    const { rule } = await addRule({ pattern: 'youtube.com', type: 'domain' });
    
    // 存入挂起任务
    await savePendingCleanJob({
      rule,
      status: 'in_progress'
    });

    // 停用规则
    await toggleRule(rule.id, false);

    const result = await checkAndResumePendingCleanJob(0);
    assert.strictEqual(result, null);
    assert.strictEqual(deletedHistoryUrls.length, 0, '停用规则不应删除任何历史记录');
    assert.strictEqual(await getPendingCleanJob(), null, '挂起任务队列已被清理');
  });

  it('当历史检索抛出底层读取异常时，应安全完成降级并彻底清除任务队列', async () => {
    const { rule } = await addRule({ pattern: 'youtube.com', type: 'domain' });
    await savePendingCleanJob({
      rule,
      status: 'in_progress'
    });

    // 模拟底层 history.search 出现数据库只读锁异常
    globalThis.chrome.history.search = () => {
      throw new Error('Database disk image is locked');
    };

    const result = await checkAndResumePendingCleanJob(0);
    assert.ok(result, 'cleanHistoryByRule 应优雅降级并返回安全统计对象');
    assert.strictEqual(result.deleted, 0);
    assert.strictEqual(await getPendingCleanJob(), null, '为防反复崩溃，挂起任务必须被清除');
  });

  it('当发生未捕获严重异常时，应安全捕获、清理任务并避免死循环重启', async () => {
    const { rule } = await addRule({ pattern: 'youtube.com', type: 'domain' });
    await savePendingCleanJob({
      rule,
      status: 'in_progress'
    });

    // 模拟严重存储异常
    const originalGet = globalThis.chrome.storage.local.get;
    let callCount = 0;
    globalThis.chrome.storage.local.get = (keys, cb) => {
      callCount++;
      if (callCount > 1) {
        throw new Error('Fatal storage corruption');
      }
      return originalGet(keys, cb);
    };

    const result = await checkAndResumePendingCleanJob(0);
    assert.strictEqual(result, null, '严重异常时应当安全捕获并返回 null');
  });
});
