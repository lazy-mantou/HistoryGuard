/**
 * @file ruleMatcher.test.js
 * @description 规则匹配引擎单元测试用例
 * 严格验证域名边界匹配、防误杀、通配符解析及搜索词自动规则化
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectRuleType,
  domainRuleToRegex,
  pathRuleToRegex,
  ruleToRegex,
  matchesRule,
  findMatchingRule,
  filterHistoryByRule,
  convertSearchTermToRule
} from '../src/core/ruleMatcher.js';

describe('ruleMatcher - detectRuleType', () => {
  it('应当正确判断域名规则与路径规则', () => {
    assert.strictEqual(detectRuleType('google.com'), 'domain');
    assert.strictEqual(detectRuleType('*.bilibili.com'), 'domain');
    assert.strictEqual(detectRuleType('https://github.com'), 'domain');

    assert.strictEqual(detectRuleType('google.com/search'), 'path');
    assert.strictEqual(detectRuleType('https://github.com/user/*'), 'path');
    assert.strictEqual(detectRuleType('domain.com/'), 'path');
  });
});

describe('ruleMatcher - domainRuleToRegex (精确边界匹配与防误杀)', () => {
  it('应当准确命中目标域名及其任意子域名', () => {
    const regex = domainRuleToRegex('google.com');

    assert.strictEqual(regex.test('https://google.com'), true);
    assert.strictEqual(regex.test('http://google.com/'), true);
    assert.strictEqual(regex.test('https://google.com/search?q=test'), true);
    assert.strictEqual(regex.test('https://mail.google.com'), true);
    assert.strictEqual(regex.test('https://sub.docs.google.com/doc/123'), true);
  });

  it('严禁误杀前缀拼接或后缀拼接的类似域名 (防误杀核心验证)', () => {
    const regex = domainRuleToRegex('google.com');

    // 严禁误匹配前缀包含 google 的第三方域名
    assert.strictEqual(regex.test('https://mygoogle.com'), false);
    assert.strictEqual(regex.test('https://notgoogle.com/page'), false);
    assert.strictEqual(regex.test('https://fake-google.com'), false);

    // 严禁误匹配后缀带有国家代码或其他顶级域的独立域名
    assert.strictEqual(regex.test('https://google.com.cn'), false);
    assert.strictEqual(regex.test('https://google.com.hk'), false);
    assert.strictEqual(regex.test('https://google.company'), false);
  });

  it('支持带有 *. 前缀的通配表达式规范化', () => {
    const regex = domainRuleToRegex('*.github.com');
    assert.strictEqual(regex.test('https://github.com'), true);
    assert.strictEqual(regex.test('https://gist.github.com'), true);
    assert.strictEqual(regex.test('https://mygithub.com'), false);
  });
});

describe('ruleMatcher - pathRuleToRegex', () => {
  it('通配符路径应当匹配前缀及下级任意路由', () => {
    const regex = pathRuleToRegex('example.com/blog/*');
    assert.strictEqual(regex.test('https://example.com/blog/article-1'), true);
    assert.strictEqual(regex.test('https://example.com/blog/2026/10/post'), true);
    assert.strictEqual(regex.test('https://example.com/other'), false);
  });

  it('精确页面路径不应匹配下层未通配的子路径', () => {
    const regex = pathRuleToRegex('example.com/login.html');
    assert.strictEqual(regex.test('https://example.com/login.html'), true);
    assert.strictEqual(regex.test('https://example.com/login.html?ref=top'), true);
    assert.strictEqual(regex.test('https://example.com/login.html#anchor'), true);
    assert.strictEqual(regex.test('https://example.com/login.html/subpath'), false);
  });
});

describe('ruleMatcher - matchesRule & findMatchingRule', () => {
  it('matchesRule 能够正确识别规则对象及规则字符串', () => {
    const ruleObj = { pattern: 'youtube.com', type: 'domain' };
    assert.strictEqual(matchesRule(ruleObj, 'https://www.youtube.com/watch?v=123'), true);
    assert.strictEqual(matchesRule('youtube.com', 'https://www.youtube.com/watch?v=123'), true);
    assert.strictEqual(matchesRule('youtube.com', 'https://vimeo.com'), false);
  });

  it('findMatchingRule 应当忽略未启用的规则，仅匹配已启用规则', () => {
    const rules = [
      { id: '1', pattern: 'twitter.com', type: 'domain', enabled: false },
      { id: '2', pattern: 'x.com', type: 'domain', enabled: true }
    ];

    const matchTwitter = findMatchingRule(rules, 'https://twitter.com/home');
    assert.strictEqual(matchTwitter.matched, false);
    assert.strictEqual(matchTwitter.rule, null);

    const matchX = findMatchingRule(rules, 'https://x.com/home');
    assert.strictEqual(matchX.matched, true);
    assert.strictEqual(matchX.rule.id, '2');
  });

  it('findMatchingRule 当列表为空或 URL 不匹配时返回 false', () => {
    assert.deepStrictEqual(findMatchingRule([], 'https://example.com'), { matched: false, rule: null });
    assert.deepStrictEqual(findMatchingRule(null, 'https://example.com'), { matched: false, rule: null });
  });
});

describe('ruleMatcher - filterHistoryByRule', () => {
  const historyList = [
    { url: 'https://github.com/trending', title: 'Trending' },
    { url: 'https://gist.github.com/user/code', title: 'Gist' },
    { url: 'https://gitlab.com/projects', title: 'GitLab' },
    { url: 'https://stackoverflow.com/questions', title: 'StackOverflow' }
  ];

  it('应当准确过滤出命中规则的历史记录条目', () => {
    const filtered = filterHistoryByRule('github.com', historyList);
    assert.strictEqual(filtered.length, 2);
    assert.strictEqual(filtered[0].url, 'https://github.com/trending');
    assert.strictEqual(filtered[1].url, 'https://gist.github.com/user/code');
  });

  it('输入空或无效规则时应返回空数组', () => {
    assert.deepStrictEqual(filterHistoryByRule(null, historyList), []);
    assert.deepStrictEqual(filterHistoryByRule('github.com', null), []);
  });
});

describe('ruleMatcher - convertSearchTermToRule (智能搜索词转规则)', () => {
  it('路径搜索词若以斜杠结尾应转为通配路径', () => {
    const r1 = convertSearchTermToRule('github.com/user/');
    assert.strictEqual(r1.type, 'path');
    assert.strictEqual(r1.pattern, 'github.com/user/*');
  });

  it('路径搜索词不带斜杠但为目录形式应自动追加 /*', () => {
    const r2 = convertSearchTermToRule('example.com/docs');
    assert.strictEqual(r2.type, 'path');
    assert.strictEqual(r2.pattern, 'example.com/docs/*');
  });

  it('带点的域名关键词应转为 *.domain 通配规则', () => {
    const r3 = convertSearchTermToRule('baidu.com');
    assert.strictEqual(r3.type, 'domain');
    assert.strictEqual(r3.pattern, '*.baidu.com');

    const r4 = convertSearchTermToRule('*.v2ex.com');
    assert.strictEqual(r4.pattern, '*.v2ex.com');
  });

  it('单段简写词应自动转换为 .com 泛域名', () => {
    const r5 = convertSearchTermToRule('bilibili');
    assert.strictEqual(r5.type, 'domain');
    assert.strictEqual(r5.pattern, '*.bilibili.com');
  });

  it('空字符串应返回空 pattern', () => {
    const empty = convertSearchTermToRule('   ');
    assert.strictEqual(empty.pattern, '');
    assert.strictEqual(empty.type, 'domain');
  });
});
