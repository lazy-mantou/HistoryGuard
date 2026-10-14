/**
 * @file urlParser.test.js
 * @description URL 层级自动拆解算法单元测试用例
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isHttpUrl,
  parseDomainInfo,
  getDomainRules,
  getPathRules,
  parseUrl
} from '../src/core/urlParser.js';

describe('urlParser - isHttpUrl', () => {
  it('应当正确识别合法的 http/https 协议 URL', () => {
    assert.strictEqual(isHttpUrl('http://example.com'), true);
    assert.strictEqual(isHttpUrl('https://example.com/path?query=1'), true);
    assert.strictEqual(isHttpUrl('https://sub.domain.org:8080/page#hash'), true);
  });

  it('应当拒绝非 http/https 协议 URL', () => {
    assert.strictEqual(isHttpUrl('ftp://example.com'), false);
    assert.strictEqual(isHttpUrl('chrome://extensions'), false);
    assert.strictEqual(isHttpUrl('chrome-extension://abcdefg/popup.html'), false);
    assert.strictEqual(isHttpUrl('moz-extension://abcdefg/popup.html'), false);
    assert.strictEqual(isHttpUrl('file:///C:/test.html'), false);
    assert.strictEqual(isHttpUrl('javascript:void(0)'), false);
    assert.strictEqual(isHttpUrl('about:blank'), false);
  });

  it('应当安全处理空值与非字符串入参', () => {
    assert.strictEqual(isHttpUrl(''), false);
    assert.strictEqual(isHttpUrl(null), false);
    assert.strictEqual(isHttpUrl(undefined), false);
    assert.strictEqual(isHttpUrl(12345), false);
    assert.strictEqual(isHttpUrl({}), false);
  });
});

describe('urlParser - parseDomainInfo', () => {
  it('应当正确解析普通单级顶级域（如 .com, .org）', () => {
    const info1 = parseDomainInfo('google.com');
    assert.strictEqual(info1.rootDomain, 'google.com');
    assert.strictEqual(info1.suffix, 'com');
    assert.deepStrictEqual(info1.subdomains, []);
    assert.strictEqual(info1.isIp, false);

    const info2 = parseDomainInfo('m.gemini.google.com');
    assert.strictEqual(info2.rootDomain, 'google.com');
    assert.strictEqual(info2.suffix, 'com');
    assert.deepStrictEqual(info2.subdomains, ['m', 'gemini']);
    assert.strictEqual(info2.isIp, false);
  });

  it('应当正确识别并解析多级公用后缀 TLD（如 .com.cn, .co.uk, .gov.cn）', () => {
    const infoCn = parseDomainInfo('news.sina.com.cn');
    assert.strictEqual(infoCn.rootDomain, 'sina.com.cn');
    assert.strictEqual(infoCn.suffix, 'com.cn');
    assert.deepStrictEqual(infoCn.subdomains, ['news']);

    const infoUk = parseDomainInfo('sub.bbc.co.uk');
    assert.strictEqual(infoUk.rootDomain, 'bbc.co.uk');
    assert.strictEqual(infoUk.suffix, 'co.uk');
    assert.deepStrictEqual(infoUk.subdomains, ['sub']);

    const infoHk = parseDomainInfo('portal.gov.hk');
    assert.strictEqual(infoHk.rootDomain, 'portal.gov.hk');
    assert.strictEqual(infoHk.suffix, 'gov.hk');
    assert.deepStrictEqual(infoHk.subdomains, []);
  });

  it('应当正确处理 IPv4 / IPv6 和 localhost', () => {
    const infoIpv4 = parseDomainInfo('192.168.1.1');
    assert.strictEqual(infoIpv4.isIp, true);
    assert.strictEqual(infoIpv4.rootDomain, '192.168.1.1');

    const infoLocal = parseDomainInfo('localhost');
    assert.strictEqual(infoLocal.isIp, true);
    assert.strictEqual(infoLocal.rootDomain, 'localhost');

    const infoIpv6 = parseDomainInfo('[::1]');
    assert.strictEqual(infoIpv6.isIp, true);
    assert.strictEqual(infoIpv6.rootDomain, '[::1]');
  });
});

describe('urlParser - getDomainRules', () => {
  it('应当针对单级主域名生成完整域名与全站通配候选规则', () => {
    const rules = getDomainRules('https://google.com/search?q=test');
    assert.strictEqual(rules.length >= 1, true);
    assert.strictEqual(rules[0].rule, 'google.com');
    assert.strictEqual(rules[0].type, 'domain');
    assert.strictEqual(rules[0].label, '当前完整域名');

    // 应该包含根域名全站通配 *.google.com
    const rootRule = rules.find(r => r.rule === '*.google.com');
    assert.ok(rootRule, '应当包含 *.google.com 规则');
    assert.strictEqual(rootRule.label, '根域名全站通配');
  });

  it('应当针对多级子域生成二级子域通配规则', () => {
    const rules = getDomainRules('https://m.gemini.google.com/chat');
    const rulePatterns = rules.map(r => r.rule);
    assert.ok(rulePatterns.includes('m.gemini.google.com'));
    assert.ok(rulePatterns.includes('*.gemini.google.com'));
    assert.ok(rulePatterns.includes('*.google.com'));
  });

  it('针对 IP 地址或 localhost 不应生成 *. 通配规则', () => {
    const rules = getDomainRules('http://192.168.1.100:8080/api');
    assert.strictEqual(rules.length, 1);
    assert.strictEqual(rules[0].rule, '192.168.1.100');
  });

  it('对于非法协议 URL 应返回空规则列表', () => {
    assert.deepStrictEqual(getDomainRules('chrome://settings'), []);
  });
});

describe('urlParser - getPathRules', () => {
  it('应当按路径深度由深至浅递进生成候选规则', () => {
    const url = 'https://www.example.com/products/electronics/phones.html?ref=nav';
    const rules = getPathRules(url);
    const rulePatterns = rules.map(r => r.rule);

    // 1. 精确 URL 路径
    assert.strictEqual(rulePatterns[0], 'www.example.com/products/electronics/phones.html');
    // 2. 当前目录通配
    assert.ok(rulePatterns.includes('www.example.com/products/electronics/*'));
    // 3. 上级目录通配
    assert.ok(rulePatterns.includes('www.example.com/products/*'));
    // 4. 全站路径通配
    assert.ok(rulePatterns.includes('www.example.com/*'));
  });

  it('针对根路径 URL 应只生成全站通配规则', () => {
    const rules = getPathRules('https://www.example.com/');
    assert.strictEqual(rules.length, 1);
    assert.strictEqual(rules[0].rule, 'www.example.com/*');
  });

  it('对于非法协议 URL 应返回空规则列表', () => {
    assert.deepStrictEqual(getPathRules('chrome://history'), []);
  });
});

describe('urlParser - parseUrl', () => {
  it('应当为合法 URL 返回完整拆解对象', () => {
    const res = parseUrl('https://docs.github.com/en/rest/quickstart');
    assert.strictEqual(res.isValid, true);
    assert.strictEqual(res.hostname, 'docs.github.com');
    assert.strictEqual(res.pathname, '/en/rest/quickstart');
    assert.strictEqual(res.domainRules.length > 0, true);
    assert.strictEqual(res.pathRules.length > 0, true);
  });

  it('应当为非法或内部 URL 返回 isValid: false 及原因', () => {
    const res = parseUrl('about:blank');
    assert.strictEqual(res.isValid, false);
    assert.strictEqual(typeof res.reason, 'string');
    assert.strictEqual(res.domainRules.length, 0);
    assert.strictEqual(res.pathRules.length, 0);
  });
});
