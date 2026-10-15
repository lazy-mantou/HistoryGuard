/**
 * @file toolbarIndicator.test.js
 * @description 工具栏动态状态指示器 (Icon, Badge, Tooltip) 单元测试用例
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluatePageStatus,
  updateTabToolbarIndicator,
  updateGlobalToolbarIndicator,
  PAGE_PROTECT_STATUS,
  ICON_PATHS
} from '../src/background/toolbarIndicator.js';
import { browserApi } from '../src/adapters/index.js';

describe('toolbarIndicator - evaluatePageStatus (页面防护状态判定算法)', () => {
  const sampleRules = [
    { id: 'r1', pattern: 'google.com', type: 'domain', enabled: true },
    { id: 'r2', pattern: 'secret', type: 'keyword', enabled: true },
    { id: 'r3', pattern: 'disabled.com', type: 'domain', enabled: false }
  ];

  it('非 HTTP/HTTPS 或内部/空协议 URL 判定为 INTERNAL', () => {
    assert.strictEqual(evaluatePageStatus('').status, PAGE_PROTECT_STATUS.INTERNAL);
    assert.strictEqual(evaluatePageStatus('chrome://extensions').status, PAGE_PROTECT_STATUS.INTERNAL);
    assert.strictEqual(evaluatePageStatus('about:blank').status, PAGE_PROTECT_STATUS.INTERNAL);
    assert.strictEqual(evaluatePageStatus('file:///C:/test.html').status, PAGE_PROTECT_STATUS.INTERNAL);
    assert.strictEqual(evaluatePageStatus('edge://settings').status, PAGE_PROTECT_STATUS.INTERNAL);
  });

  it('处于静默免记录有效时间内，优先判定为 PROTECTED_SILENT', () => {
    const futureTime = Date.now() + 60000;
    const res = evaluatePageStatus('https://example.com', '', sampleRules, futureTime);
    assert.strictEqual(res.status, PAGE_PROTECT_STATUS.PROTECTED_SILENT);
    assert.strictEqual(res.rule, null);
  });

  it('静默免记录已过期时，正常按规则判断', () => {
    const pastTime = Date.now() - 1000;
    const res = evaluatePageStatus('https://example.com', '', sampleRules, pastTime);
    assert.strictEqual(res.status, PAGE_PROTECT_STATUS.RECORDING);
  });

  it('命中启用的域名规则时，判定为 PROTECTED_RULE 并附带命中规则', () => {
    const res = evaluatePageStatus('https://www.google.com/search?q=test', '', sampleRules, 0);
    assert.strictEqual(res.status, PAGE_PROTECT_STATUS.PROTECTED_RULE);
    assert.ok(res.rule);
    assert.strictEqual(res.rule.id, 'r1');
  });

  it('命中启用的关键词规则时，判定为 PROTECTED_RULE', () => {
    const res = evaluatePageStatus('https://any-site.com/search?q=my_secret_token', '', sampleRules, 0);
    assert.strictEqual(res.status, PAGE_PROTECT_STATUS.PROTECTED_RULE);
    assert.ok(res.rule);
    assert.strictEqual(res.rule.id, 'r2');
  });

  it('已停用的规则不应触发保护，返回 RECORDING (正常记录历史)', () => {
    const res = evaluatePageStatus('https://disabled.com/page', '', sampleRules, 0);
    assert.strictEqual(res.status, PAGE_PROTECT_STATUS.RECORDING);
    assert.strictEqual(res.rule, null);
  });

  it('普通未受保护的网页判定为 RECORDING', () => {
    const res = evaluatePageStatus('https://github.com/trending', '', sampleRules, 0);
    assert.strictEqual(res.status, PAGE_PROTECT_STATUS.RECORDING);
    assert.strictEqual(res.rule, null);
  });
});

describe('toolbarIndicator - updateTabToolbarIndicator (工具栏状态指示器外观与角标渲染)', () => {
  let actionLog = [];

  beforeEach(() => {
    actionLog = [];
    browserApi.action = {
      setBadgeText: async (details) => {
        actionLog.push({ type: 'setBadgeText', details });
      },
      setBadgeBackgroundColor: async (details) => {
        actionLog.push({ type: 'setBadgeBackgroundColor', details });
      },
      setTitle: async (details) => {
        actionLog.push({ type: 'setTitle', details });
      },
      setIcon: async (details) => {
        actionLog.push({ type: 'setIcon', details });
      }
    };
  });

  it('命中防护规则时：切换为翡翠绿保护图标、不显示文字角标、显示详细 Tooltip', async () => {
    const rules = [{ id: '1', pattern: 'google.com', type: 'domain', enabled: true }];
    await updateTabToolbarIndicator(101, 'https://www.google.com', 'Google', rules, 0, 'zh-CN');

    const iconCall = actionLog.find(c => c.type === 'setIcon');
    const badgeTextCall = actionLog.find(c => c.type === 'setBadgeText');
    const titleCall = actionLog.find(c => c.type === 'setTitle');

    assert.ok(iconCall);
    assert.strictEqual(iconCall.details.tabId, 101);
    assert.deepStrictEqual(iconCall.details.path, ICON_PATHS.PROTECTED);

    assert.ok(badgeTextCall);
    assert.strictEqual(badgeTextCall.details.text, '');

    assert.ok(titleCall);
    assert.match(titleCall.details.title, /当前页面处于防护中/);
    assert.match(titleCall.details.title, /google\.com/);
  });

  it('静默免记录模式时：切换为翡翠绿保护图标、不显示文字角标、显示全局提示', async () => {
    const futureTime = Date.now() + 1800000;
    await updateTabToolbarIndicator(102, 'https://example.com', 'Example', [], futureTime, 'zh-CN');

    const iconCall = actionLog.find(c => c.type === 'setIcon');
    const badgeTextCall = actionLog.find(c => c.type === 'setBadgeText');
    const titleCall = actionLog.find(c => c.type === 'setTitle');

    assert.ok(iconCall);
    assert.deepStrictEqual(iconCall.details.path, ICON_PATHS.PROTECTED);

    assert.ok(badgeTextCall);
    assert.strictEqual(badgeTextCall.details.text, '');

    assert.ok(titleCall);
    assert.match(titleCall.details.title, /临时无痕模式中/);
  });

  it('普通正常网页时：呈现平时科技蓝图标、清空文字角标、提示正常记录历史', async () => {
    await updateTabToolbarIndicator(103, 'https://wikipedia.org', 'Wikipedia', [], 0, 'zh-CN');

    const iconCall = actionLog.find(c => c.type === 'setIcon');
    const badgeTextCall = actionLog.find(c => c.type === 'setBadgeText');
    const titleCall = actionLog.find(c => c.type === 'setTitle');

    assert.ok(iconCall);
    assert.deepStrictEqual(iconCall.details.path, ICON_PATHS.NORMAL);

    assert.ok(badgeTextCall);
    assert.strictEqual(badgeTextCall.details.text, '');

    assert.ok(titleCall);
    assert.match(titleCall.details.title, /正常记录历史/);
  });

  it('浏览器内部页面时：呈现平时科技蓝图标、清空文字角标、提示浏览器内部页面', async () => {
    await updateTabToolbarIndicator(104, 'chrome://settings', 'Settings', [], 0, 'zh-CN');

    const iconCall = actionLog.find(c => c.type === 'setIcon');
    const badgeTextCall = actionLog.find(c => c.type === 'setBadgeText');
    const titleCall = actionLog.find(c => c.type === 'setTitle');

    assert.ok(iconCall);
    assert.deepStrictEqual(iconCall.details.path, ICON_PATHS.NORMAL);

    assert.ok(badgeTextCall);
    assert.strictEqual(badgeTextCall.details.text, '');

    assert.ok(titleCall);
    assert.match(titleCall.details.title, /浏览器内部页面/);
  });

  it('严禁使用文字角标来区别保护状态（全语言环境下文字角标恒为空）', async () => {
    const rules = [{ id: '1', pattern: 'google.com', type: 'domain', enabled: true }];
    await updateTabToolbarIndicator(105, 'https://www.google.com', 'Google', rules, 0, 'en-US');
    const badgeCall = actionLog.find(c => c.type === 'setBadgeText');
    assert.strictEqual(badgeCall.details.text, '');

    actionLog = [];
    await updateTabToolbarIndicator(106, 'https://example.com', '', [], Date.now() + 60000, 'en-US');
    const muteBadgeCall = actionLog.find(c => c.type === 'setBadgeText');
    assert.strictEqual(muteBadgeCall.details.text, '');
  });

  it('非法或空 tabId 应当被安全静默忽略，不抛出异常', async () => {
    await updateTabToolbarIndicator(null, 'https://example.com', '', [], 0);
    await updateTabToolbarIndicator(0, 'https://example.com', '', [], 0);
    assert.strictEqual(actionLog.length, 0);
  });
});

describe('toolbarIndicator - updateGlobalToolbarIndicator (全局默认工具栏状态渲染)', () => {
  let actionLog = [];

  beforeEach(() => {
    actionLog = [];
    browserApi.action = {
      setBadgeText: async (details) => {
        actionLog.push({ type: 'setBadgeText', details });
      },
      setTitle: async (details) => {
        actionLog.push({ type: 'setTitle', details });
      },
      setIcon: async (details) => {
        actionLog.push({ type: 'setIcon', details });
      }
    };
  });

  it('静默模式激活时：将全局默认图标切换为翡翠绿保护图标、无角标、并设置全局提示', async () => {
    const futureTime = Date.now() + 60000;
    await updateGlobalToolbarIndicator(futureTime, 'zh-CN');

    const iconCall = actionLog.find(c => c.type === 'setIcon');
    const badgeCall = actionLog.find(c => c.type === 'setBadgeText');
    const titleCall = actionLog.find(c => c.type === 'setTitle');

    assert.ok(iconCall);
    assert.strictEqual(iconCall.details.tabId, undefined);
    assert.deepStrictEqual(iconCall.details.path, ICON_PATHS.PROTECTED);

    assert.ok(badgeCall);
    assert.strictEqual(badgeCall.details.text, '');

    assert.ok(titleCall);
    assert.match(titleCall.details.title, /临时无痕模式中/);
  });

  it('静默模式非激活时：将全局默认图标恢复为平时科技蓝图标、无角标、并设置常规提示', async () => {
    await updateGlobalToolbarIndicator(0, 'zh-CN');

    const iconCall = actionLog.find(c => c.type === 'setIcon');
    const badgeCall = actionLog.find(c => c.type === 'setBadgeText');
    const titleCall = actionLog.find(c => c.type === 'setTitle');

    assert.ok(iconCall);
    assert.strictEqual(iconCall.details.tabId, undefined);
    assert.deepStrictEqual(iconCall.details.path, ICON_PATHS.NORMAL);

    assert.ok(badgeCall);
    assert.strictEqual(badgeCall.details.text, '');

    assert.ok(titleCall);
    assert.match(titleCall.details.title, /正常记录历史/);
  });
});
