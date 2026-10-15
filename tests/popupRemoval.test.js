import test from 'node:test';
import assert from 'node:assert/strict';
import { addRule, deleteRule, getRules, clearAllRules } from '../src/core/storage.js';
import { parseUrl } from '../src/core/urlParser.js';
import { findMatchingRule, computeCandidateStatus } from '../src/core/ruleMatcher.js';
import { evaluatePageStatus, PAGE_PROTECT_STATUS } from '../src/background/toolbarIndicator.js';

let mockStorageMap = new Map();

test.describe('Popup - 已受保护页面的删除规则功能逻辑', () => {
  test.beforeEach(async () => {
    mockStorageMap.clear();
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
      runtime: {
        lastError: null
      }
    };
    await clearAllRules();
  });

  test.afterEach(() => {
    delete globalThis.chrome;
  });

  test('访问处于隐藏列表中的页面时，能够准确获取命中规则并通过 deleteRule 彻底移除', async () => {
    // 1. 先加入一条隐藏规则
    const added = await addRule({
      pattern: 'secret.example.com',
      type: 'domain',
      enabled: true
    });
    assert.ok(added.rule.id, '规则应当包含有效 ID');

    let rules = await getRules();
    const tab = { url: 'https://secret.example.com/dashboard', title: 'Dashboard' };

    // 2. 模拟进入 popup：检测到页面处于隐藏保护中
    const { matched, rule } = findMatchingRule(rules, tab);
    assert.equal(matched, true, '应当命中保护');
    assert.equal(rule.id, added.rule.id, '命中的规则应当为先前添加的规则');
    assert.equal(rule.pattern, 'secret.example.com');

    // 校验工具栏状态为受保护
    const statusBefore = evaluatePageStatus(tab.url, tab.title, rules, 0);
    assert.equal(statusBefore.status, PAGE_PROTECT_STATUS.PROTECTED_RULE);

    // 3. 模拟在 Popup 中点击"从列表中删除"功能
    const deleteSuccess = await deleteRule(rule.id);
    assert.equal(deleteSuccess, true, 'deleteRule 应当返回成功');

    // 4. 删除后刷新规则与页面状态
    rules = await getRules();
    assert.equal(rules.length, 0, '规则列表应当为空');

    const matchAfter = findMatchingRule(rules, tab);
    assert.equal(matchAfter.matched, false, '页面不应再命中保护');

    const statusAfter = evaluatePageStatus(tab.url, tab.title, rules, 0);
    assert.equal(statusAfter.status, PAGE_PROTECT_STATUS.RECORDING, '页面状态应立即恢复为正常记录');
  });

  test('在候选胶囊列表中选中已在列表的规则时，isExactMatch 为 true 且包含 exactRule.id 供直接删除', async () => {
    const { rule: createdRule } = await addRule({
      pattern: 'github.com',
      type: 'domain',
      enabled: true
    });

    const parsed = parseUrl('https://github.com/trending');
    const rules = await getRules();

    // 候选规则中包含 github.com
    const githubCandidate = parsed.domainRules.find(c => c.rule === 'github.com');
    assert.ok(githubCandidate, '应当包含 github.com 候选');

    const status = computeCandidateStatus(githubCandidate, rules);
    assert.equal(status.isExactMatch, true, '应当精确匹配已存规则');
    assert.equal(status.exactRule?.id, createdRule.id, '应当关联到存储中的规则 ID');

    // 模拟胶囊主按钮触发删除
    await deleteRule(status.exactRule.id);

    const rulesAfter = await getRules();
    assert.equal(rulesAfter.find(r => r.id === createdRule.id), undefined, '规则应被成功移除');

    const statusAfter = computeCandidateStatus(githubCandidate, rulesAfter);
    assert.equal(statusAfter.isExactMatch, false, '移除后胶囊不再处于列表中');
  });

  test('通配符规则覆盖的页面，点击删除横幅上的规则即可解除全站保护', async () => {
    const { rule: wildcardRule } = await addRule({
      pattern: '*.example.com',
      type: 'domain',
      enabled: true
    });

    const subTab = { url: 'https://app.sub.example.com/profile' };
    let rules = await getRules();

    const { matched, rule } = findMatchingRule(rules, subTab);
    assert.equal(matched, true);
    assert.equal(rule.id, wildcardRule.id);

    // 移除通配符规则
    await deleteRule(rule.id);

    rules = await getRules();
    const matchAfter = findMatchingRule(rules, subTab);
    assert.equal(matchAfter.matched, false, '子域全站不再处于隐藏列表');
  });
});
