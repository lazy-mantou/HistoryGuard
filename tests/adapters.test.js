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
});

describe('adapters - 统一导出单例 browserApi', () => {
  it('导出的 browserApi 单例应当继承自 IBrowserAdapter', () => {
    assert.ok(browserApi instanceof IBrowserAdapter);
    assert.ok(browserApi.history);
    assert.ok(browserApi.storage);
    assert.ok(browserApi.tabs);
    assert.ok(browserApi.runtime);
    assert.ok(browserApi.alarms);
    assert.ok(browserApi.i18n);
  });
});
