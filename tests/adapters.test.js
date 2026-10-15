/**
 * @file adapters.test.js
 * @description 浏览器内核适配器接口规范与工厂模式单元测试用例
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { IBrowserAdapter } from '../src/adapters/IBrowserAdapter.js';
import { ChromiumAdapter } from '../src/adapters/ChromiumAdapter.js';
import { FirefoxAdapter } from '../src/adapters/FirefoxAdapter.js';
import { browserApi } from '../src/adapters/index.js';

describe('adapters - IBrowserAdapter 抽象基类规范', () => {
  it('IBrowserAdapter 应当定义完整的接口命名空间', () => {
    const adapter = new IBrowserAdapter();
    assert.ok(adapter.history, '应当包含 history 命名空间');
    assert.ok(adapter.storage, '应当包含 storage 命名空间');
    assert.ok(adapter.tabs, '应当包含 tabs 命名空间');
    assert.ok(adapter.webNavigation, '应当包含 webNavigation 命名空间');
    assert.ok(adapter.runtime, '应当包含 runtime 命名空间');
    assert.ok(adapter.alarms, '应当包含 alarms 命名空间');
    assert.ok(adapter.i18n, '应当包含 i18n 命名空间');
  });

  it('基类抽象方法未实现时应当抛出异常提示', async () => {
    const adapter = new IBrowserAdapter();
    assert.throws(() => adapter.history.onVisited(), /must be implemented/);
    await assert.rejects(async () => adapter.history.search(), /must be implemented/);
    await assert.rejects(async () => adapter.storage.get(), /must be implemented/);
    await assert.rejects(async () => adapter.tabs.getCurrentActiveTab(), /must be implemented/);
    assert.throws(() => adapter.tabs.onUpdated(), /must be implemented/);
    assert.throws(() => adapter.webNavigation.onHistoryStateUpdated(), /must be implemented/);
    assert.throws(() => adapter.webNavigation.onCommitted(), /must be implemented/);
    await assert.rejects(async () => adapter.runtime.openOptionsPage(), /must be implemented/);
    await assert.rejects(async () => adapter.alarms.create(), /must be implemented/);
    assert.throws(() => adapter.i18n.getUILanguage(), /must be implemented/);
  });
});

describe('adapters - ChromiumAdapter 实现验证', () => {
  it('ChromiumAdapter 应当完整实现所有必须的 API 契约', () => {
    const adapter = new ChromiumAdapter();
    assert.strictEqual(typeof adapter.history.onVisited, 'function');
    assert.strictEqual(typeof adapter.history.search, 'function');
    assert.strictEqual(typeof adapter.history.deleteUrl, 'function');
    assert.strictEqual(typeof adapter.storage.get, 'function');
    assert.strictEqual(typeof adapter.storage.set, 'function');
    assert.strictEqual(typeof adapter.storage.onChanged, 'function');
    assert.strictEqual(typeof adapter.tabs.getCurrentActiveTab, 'function');
    assert.strictEqual(typeof adapter.tabs.onUpdated, 'function');
    assert.strictEqual(typeof adapter.webNavigation.onHistoryStateUpdated, 'function');
    assert.strictEqual(typeof adapter.webNavigation.onCommitted, 'function');
    assert.strictEqual(typeof adapter.runtime.openOptionsPage, 'function');
    assert.strictEqual(typeof adapter.alarms.create, 'function');
    assert.strictEqual(typeof adapter.alarms.clear, 'function');
    assert.strictEqual(typeof adapter.alarms.onAlarm, 'function');
    assert.strictEqual(typeof adapter.i18n.getUILanguage, 'function');
  });

  it('在无真实 chrome 环境时，调用异步 API 应当被安全拦截或拒绝', async () => {
    const adapter = new ChromiumAdapter();
    await assert.rejects(async () => {
      await adapter.history.search();
    }, /chrome\.history API is not available/);

    await assert.rejects(async () => {
      await adapter.storage.get(['test']);
    }, /chrome\.storage\.local API is not available/);
  });

  it('i18n.getUILanguage 在无全局环境时应安全回退默认语言', () => {
    const adapter = new ChromiumAdapter();
    const lang = adapter.i18n.getUILanguage();
    assert.ok(typeof lang === 'string');
    assert.ok(lang.length > 0);
  });

  it('移动端无独立窗口环境时，tabs.getCurrentActiveTab 应当成功触发全局 active 标签兜底', async () => {
    globalThis.chrome = {
      tabs: {
        query: (queryInfo, callback) => {
          // 模拟移动浏览器 (如 Kiwi / Lemur) 中 currentWindow 与 lastFocusedWindow 返回空
          if (queryInfo.currentWindow || queryInfo.lastFocusedWindow) {
            callback([]);
          } else if (queryInfo.active === true) {
            callback([{ id: 101, url: 'https://m.bilibili.com', title: 'Bilibili Mobile' }]);
          } else {
            callback([]);
          }
        }
      },
      runtime: { lastError: null }
    };

    const adapter = new ChromiumAdapter();
    const tab = await adapter.tabs.getCurrentActiveTab();
    assert.ok(tab);
    assert.strictEqual(tab.id, 101);
    assert.strictEqual(tab.url, 'https://m.bilibili.com');

    delete globalThis.chrome;
  });

  it('移动端 openOptionsPage 失败时应当自动回退到 tabs.create 打开 options.html', async () => {
    let createdUrl = '';
    globalThis.chrome = {
      runtime: {
        openOptionsPage: (callback) => {
          globalThis.chrome.runtime.lastError = new Error('Not supported on mobile');
          callback();
        },
        getURL: (path) => `chrome-extension://histguard/${path}`,
        lastError: null
      },
      tabs: {
        create: ({ url }, callback) => {
          createdUrl = url;
          if (callback) callback();
        }
      }
    };

    const adapter = new ChromiumAdapter();
    await adapter.runtime.openOptionsPage();
    assert.strictEqual(createdUrl, 'chrome-extension://histguard/options/options.html');

    delete globalThis.chrome;
  });
});

describe('adapters - FirefoxAdapter 实现验证', () => {
  it('FirefoxAdapter 应当完整实现所有必须的 API 契约', () => {
    const adapter = new FirefoxAdapter();
    assert.strictEqual(typeof adapter.history.onVisited, 'function');
    assert.strictEqual(typeof adapter.history.search, 'function');
    assert.strictEqual(typeof adapter.history.deleteUrl, 'function');
    assert.strictEqual(typeof adapter.storage.get, 'function');
    assert.strictEqual(typeof adapter.storage.set, 'function');
    assert.strictEqual(typeof adapter.storage.onChanged, 'function');
    assert.strictEqual(typeof adapter.tabs.getCurrentActiveTab, 'function');
    assert.strictEqual(typeof adapter.tabs.onUpdated, 'function');
    assert.strictEqual(typeof adapter.webNavigation.onHistoryStateUpdated, 'function');
    assert.strictEqual(typeof adapter.webNavigation.onCommitted, 'function');
    assert.strictEqual(typeof adapter.runtime.openOptionsPage, 'function');
    assert.strictEqual(typeof adapter.alarms.create, 'function');
    assert.strictEqual(typeof adapter.alarms.clear, 'function');
    assert.strictEqual(typeof adapter.alarms.onAlarm, 'function');
    assert.strictEqual(typeof adapter.i18n.getUILanguage, 'function');
  });

  it('在无真实 browser 环境时，调用异步 API 应当被安全拦截或拒绝', async () => {
    const adapter = new FirefoxAdapter();
    await assert.rejects(async () => {
      await adapter.history.search();
    }, /Neither browser nor chrome API is available/);

    await assert.rejects(async () => {
      await adapter.storage.get(['test']);
    }, /Neither browser nor chrome API is available/);
  });

  it('Firefox for Android 移动端 tabs.getCurrentActiveTab 应当正确回退全局 active 标签', async () => {
    globalThis.browser = {
      tabs: {
        query: async (queryInfo) => {
          if (queryInfo.currentWindow || queryInfo.lastFocusedWindow) {
            return [];
          }
          if (queryInfo.active === true) {
            return [{ id: 202, url: 'https://m.zhihu.com', title: 'Zhihu Mobile' }];
          }
          return [];
        }
      }
    };

    const adapter = new FirefoxAdapter();
    const tab = await adapter.tabs.getCurrentActiveTab();
    assert.ok(tab);
    assert.strictEqual(tab.id, 202);
    assert.strictEqual(tab.url, 'https://m.zhihu.com');

    delete globalThis.browser;
  });

  it('Firefox for Android 移动端 openOptionsPage 抛出异常时自动回退到 tabs.create', async () => {
    let createdUrl = '';
    globalThis.browser = {
      runtime: {
        openOptionsPage: async () => {
          throw new Error('openOptionsPage is not implemented on Android');
        },
        getURL: (path) => `moz-extension://histguard/${path}`
      },
      tabs: {
        create: async ({ url }) => {
          createdUrl = url;
        }
      }
    };

    const adapter = new FirefoxAdapter();
    await adapter.runtime.openOptionsPage();
    assert.strictEqual(createdUrl, 'moz-extension://histguard/options/options.html');

    delete globalThis.browser;
  });
});

describe('adapters - 统一导出单例 browserApi', () => {
  it('导出的 browserApi 单例应当继承自 IBrowserAdapter', () => {
    assert.ok(browserApi instanceof IBrowserAdapter);
    assert.ok(browserApi.history);
    assert.ok(browserApi.storage);
    assert.ok(browserApi.tabs);
    assert.ok(browserApi.webNavigation);
    assert.ok(browserApi.runtime);
    assert.ok(browserApi.alarms);
    assert.ok(browserApi.i18n);
  });
});
