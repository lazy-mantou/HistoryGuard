/**
 * @file ruleMatcher.edgeCases.test.js
 * @description 规则匹配引擎极端边界条件与海量用户输入拟真压力测试
 * 覆盖：非标准协议、端口号、IPv4/IPv6、Auth 凭证、多级 ccTLD、防误杀、
 * 国际化与中文 URL、URIError 容错、特殊正则字符、空值防御及复杂层级覆盖
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
  convertSearchTermToRule,
  normalizeDomain,
  isSubdomainOf,
  computeCandidateStatus,
  keywordRuleToRegex
} from '../src/core/ruleMatcher.js';

describe('EdgeCases - detectRuleType (用户多样化输入与边界检测)', () => {
  it('正确识别带协议、大小写混写与根路径斜杠的用户输入', () => {
    // 带有协议与根斜杠
    assert.strictEqual(detectRuleType('https://google.com/'), 'domain');
    assert.strictEqual(detectRuleType('http://github.com///'), 'domain');
    assert.strictEqual(detectRuleType('HTTPS://WWW.BAIDU.COM/'), 'domain');
    assert.strictEqual(detectRuleType('//example.com'), 'domain');

    // 带有路径与查询
    assert.strictEqual(detectRuleType('https://google.com/search'), 'path');
    assert.strictEqual(detectRuleType('HTTP://GITHUB.COM/USER/REPO/*'), 'path');
    assert.strictEqual(detectRuleType('example.com/api/v1/'), 'path');
  });

  it('正确识别内网 IP、Localhost、端口号及 IPv6 主机', () => {
    // 本地主机与端口
    assert.strictEqual(detectRuleType('localhost'), 'domain');
    assert.strictEqual(detectRuleType('localhost:3000'), 'domain');
    assert.strictEqual(detectRuleType('http://localhost:8080/'), 'domain');
    assert.strictEqual(detectRuleType('localhost:3000/api/*'), 'path');

    // IPv4 与端口
    assert.strictEqual(detectRuleType('127.0.0.1'), 'domain');
    assert.strictEqual(detectRuleType('127.0.0.1:8080'), 'domain');
    assert.strictEqual(detectRuleType('http://192.168.1.1/'), 'domain');
    assert.strictEqual(detectRuleType('192.168.1.1/admin/*'), 'path');

    // IPv6
    assert.strictEqual(detectRuleType('http://[::1]:8080/'), 'domain');
    assert.strictEqual(detectRuleType('[::1]:8080/dashboard'), 'path');
  });

  it('正确解析显式修饰前缀 (keyword:, kw:, domain:, path:)', () => {
    assert.strictEqual(detectRuleType('keyword:password'), 'keyword');
    assert.strictEqual(detectRuleType('kw:  secret key  '), 'keyword');
    assert.strictEqual(detectRuleType('KEYWORD: confidential'), 'keyword');
    assert.strictEqual(detectRuleType('domain:google.com'), 'domain');
    assert.strictEqual(detectRuleType('DOMAIN: https://www.bing.com/'), 'domain');
    assert.strictEqual(detectRuleType('path:example.com/users/*'), 'path');
    assert.strictEqual(detectRuleType('PATH: https://example.com/api/'), 'path');
  });

  it('智能推断多语种纯词、代码术语与特殊关键词', () => {
    assert.strictEqual(detectRuleType('password'), 'keyword');
    assert.strictEqual(detectRuleType('secret-token'), 'keyword');
    assert.strictEqual(detectRuleType('机密文件'), 'keyword');
    assert.strictEqual(detectRuleType('代购'), 'keyword');
    assert.strictEqual(detectRuleType('10086'), 'keyword');
    assert.strictEqual(detectRuleType('private_key'), 'keyword');
  });

  it('极端空值与空白字符安全防御', () => {
    assert.strictEqual(detectRuleType(''), 'keyword');
    assert.strictEqual(detectRuleType('   '), 'keyword');
    assert.strictEqual(detectRuleType(null), 'keyword');
    assert.strictEqual(detectRuleType(undefined), 'keyword');
  });
});

describe('EdgeCases - domainRuleToRegex & 域名匹配各种网络边界', () => {
  const googleRule = { pattern: 'google.com', type: 'domain' };

  it('命中：带端口、用户认证凭据 (Userinfo) 及多层下划线/横杠子域名的 URL', () => {
    // 携带认证信息 (Basic Auth / Token)
    assert.strictEqual(matchesRule(googleRule, 'https://user:password@google.com/'), true);
    assert.strictEqual(matchesRule(googleRule, 'https://token@api.google.com:8080/v1'), true);

    // 端口号
    assert.strictEqual(matchesRule(googleRule, 'https://google.com:8443/search'), true);
    assert.strictEqual(matchesRule(googleRule, 'http://sub.google.com:3000/'), true);

    // 下划线与横杠混杂的多级深度子域
    assert.strictEqual(matchesRule(googleRule, 'https://my_service.sub-api.google.com/test'), true);
    assert.strictEqual(matchesRule(googleRule, 'https://a.b.c.d.e.google.com/very/deep'), true);

    // 各种查询字符串与哈希锚点格式
    assert.strictEqual(matchesRule(googleRule, 'https://google.com?q=123'), true);
    assert.strictEqual(matchesRule(googleRule, 'https://google.com#fragment'), true);
    assert.strictEqual(matchesRule(googleRule, 'https://google.com:8080?q=123#frag'), true);
  });

  it('防误杀深度压测：绝对不误杀任何形似或包含目标域名的第三方网址', () => {
    // 前缀拼接独立域名
    assert.strictEqual(matchesRule(googleRule, 'https://mygoogle.com/'), false);
    assert.strictEqual(matchesRule(googleRule, 'https://anti-google.com/page'), false);
    assert.strictEqual(matchesRule(googleRule, 'https://fake_google.com/'), false);

    // 顶级域或国家代码不同的独立域名
    assert.strictEqual(matchesRule(googleRule, 'https://google.com.cn/'), false);
    assert.strictEqual(matchesRule(googleRule, 'https://google.com.hk/search'), false);
    assert.strictEqual(matchesRule(googleRule, 'https://google.company/about'), false);
    assert.strictEqual(matchesRule(googleRule, 'https://google.community/'), false);

    // 恶意构造将目标域名作为自身子域名的钓鱼网址
    assert.strictEqual(matchesRule(googleRule, 'https://google.com.evil-phishing.com/login'), false);
    assert.strictEqual(matchesRule(googleRule, 'https://google.com.attacker.org/'), false);

    // 仅在 URL Query 参数中包含目标域名的重定向或搜索页面
    assert.strictEqual(matchesRule(googleRule, 'https://evil.com/redirect?url=https://google.com'), false);
    assert.strictEqual(matchesRule(googleRule, 'https://bing.com/search?q=google.com'), false);

    // 仅在 URL Hash 中出现目标域名的页面
    assert.strictEqual(matchesRule(googleRule, 'https://example.com/#google.com'), false);
  });

  it('多级公用后缀 (ccTLD / SLD) 精准边界隔离', () => {
    const ukRule = { pattern: 'bbc.co.uk', type: 'domain' };
    assert.strictEqual(matchesRule(ukRule, 'https://bbc.co.uk'), true);
    assert.strictEqual(matchesRule(ukRule, 'https://www.bbc.co.uk/news'), true);
    assert.strictEqual(matchesRule(ukRule, 'https://sub.news.bbc.co.uk/live'), true);

    // 隔离其他顶级域与恶意域
    assert.strictEqual(matchesRule(ukRule, 'https://bbc.com'), false);
    assert.strictEqual(matchesRule(ukRule, 'https://notbbc.co.uk'), false);
    assert.strictEqual(matchesRule(ukRule, 'https://bbc.co.uk.attacker.com'), false);

    const eduRule = { pattern: 'tsinghua.edu.cn', type: 'domain' };
    assert.strictEqual(matchesRule(eduRule, 'https://tsinghua.edu.cn'), true);
    assert.strictEqual(matchesRule(eduRule, 'https://lib.tsinghua.edu.cn/book'), true);
    assert.strictEqual(matchesRule(eduRule, 'https://fake-tsinghua.edu.cn'), false);
    assert.strictEqual(matchesRule(eduRule, 'https://tsinghua.edu.hk'), false);
  });

  it('Localhost、私有 IP 及带端口规则的精准识别', () => {
    // 规则带特定端口
    const localPortRule = { pattern: 'localhost:8080', type: 'domain' };
    assert.strictEqual(matchesRule(localPortRule, 'http://localhost:8080/'), true);
    assert.strictEqual(matchesRule(localPortRule, 'http://localhost:8080/api/users'), true);
    assert.strictEqual(matchesRule(localPortRule, 'http://localhost:3000/'), false); // 端口不同不匹配

    // 规则不带端口：匹配任意端口的 localhost
    const localAnyRule = { pattern: 'localhost', type: 'domain' };
    assert.strictEqual(matchesRule(localAnyRule, 'http://localhost'), true);
    assert.strictEqual(matchesRule(localAnyRule, 'http://localhost:3000/app'), true);
    assert.strictEqual(matchesRule(localAnyRule, 'http://localhost:9999/'), true);
    assert.strictEqual(matchesRule(localAnyRule, 'http://fake-localhost.com'), false);

    // 私有 IPv4 地址规则
    const ipRule = { pattern: '192.168.1.1', type: 'domain' };
    assert.strictEqual(matchesRule(ipRule, 'http://192.168.1.1/'), true);
    assert.strictEqual(matchesRule(ipRule, 'http://192.168.1.1:8443/admin'), true);
    assert.strictEqual(matchesRule(ipRule, 'http://192.168.1.100/'), false); // 严禁误匹配 .100
  });

  it('用户以完整 URL 形式输入域名规则时的自适应纯化匹配', () => {
    // 用户粘贴了 'https://www.google.com/'
    assert.strictEqual(matchesRule('https://www.google.com/', 'https://www.google.com/search?q=1'), true);
    assert.strictEqual(matchesRule('https://www.google.com/', 'https://www.google.com/'), true);
    assert.strictEqual(matchesRule('https://www.google.com/', 'http://www.google.com/test'), true);
    assert.strictEqual(matchesRule('https://www.google.com/', 'https://other.google.com'), false);
  });
});

describe('EdgeCases - pathRuleToRegex & 路径匹配与边界控制', () => {
  it('通配路径跨协议、凭据与多级子目录测试', () => {
    const apiRule = { pattern: 'example.com/api/v1/*', type: 'path' };

    assert.strictEqual(matchesRule(apiRule, 'https://example.com/api/v1/users'), true);
    assert.strictEqual(matchesRule(apiRule, 'https://example.com/api/v1/deep/sub/path?id=1#sec'), true);
    assert.strictEqual(matchesRule(apiRule, 'http://user:token@example.com/api/v1/export'), true);

    // 边界：不同版本或不同路径
    assert.strictEqual(matchesRule(apiRule, 'https://example.com/api/v2/users'), false);
    assert.strictEqual(matchesRule(apiRule, 'https://example.com/api/v1'), false);
    assert.strictEqual(matchesRule(apiRule, 'https://myexample.com/api/v1/users'), false);
  });

  it('精确页面路径：自适应尾部斜杠、参数与哈希，但杜绝子路由越界', () => {
    const pageRule = { pattern: 'example.com/login.html', type: 'path' };

    assert.strictEqual(matchesRule(pageRule, 'https://example.com/login.html'), true);
    assert.strictEqual(matchesRule(pageRule, 'https://example.com/login.html/'), true);
    assert.strictEqual(matchesRule(pageRule, 'https://example.com/login.html?ref=nav#top'), true);

    // 严禁越界匹配带有扩展名后续或下层子目录的网址
    assert.strictEqual(matchesRule(pageRule, 'https://example.com/login.html.bak'), false);
    assert.strictEqual(matchesRule(pageRule, 'https://example.com/login.html/subaction'), false);

    // 无扩展名的目录页面 (如 /checkout)
    const checkoutRule = { pattern: 'example.com/checkout', type: 'path' };
    assert.strictEqual(matchesRule(checkoutRule, 'https://example.com/checkout'), true);
    assert.strictEqual(matchesRule(checkoutRule, 'https://example.com/checkout/'), true);
    assert.strictEqual(matchesRule(checkoutRule, 'https://example.com/checkout?step=2'), true);
    assert.strictEqual(matchesRule(checkoutRule, 'https://example.com/checkout-complete'), false);
    assert.strictEqual(matchesRule(checkoutRule, 'https://example.com/checkout/step2'), false);
  });

  it('路径规则中包含正则特殊字符 (如 +, $, ?, (), [])', () => {
    // 包含 + 号 (如 c++ 教学)
    const plusRule = { pattern: 'example.com/c++/*', type: 'path' };
    assert.strictEqual(matchesRule(plusRule, 'https://example.com/c++/tutorial.html'), true);
    assert.strictEqual(matchesRule(plusRule, 'https://example.com/c/tutorial.html'), false);

    // 包含方括号 (如 文件名 file[1].pdf)
    const bracketRule = { pattern: 'example.com/docs/file[1].pdf', type: 'path' };
    assert.strictEqual(matchesRule(bracketRule, 'https://example.com/docs/file[1].pdf'), true);
    assert.strictEqual(matchesRule(bracketRule, 'https://example.com/docs/file1.pdf'), false);

    // 包含问号与查询通配符
    const queryPathRule = { pattern: 'example.com/search?q=test*', type: 'path' };
    assert.strictEqual(matchesRule(queryPathRule, 'https://example.com/search?q=test12345'), true);
  });
});

describe('EdgeCases - keywordRuleToRegex & 关键词全场景无死角拦截', () => {
  it('特殊符号、代码标识与中文字符关键词精准命中', () => {
    // C++
    const cppRule = { pattern: 'C++', type: 'keyword' };
    assert.strictEqual(matchesRule(cppRule, 'https://google.com/search?q=C%2B%2B'), true);
    assert.strictEqual(matchesRule(cppRule, 'https://google.com/search?q=C++'), true);
    assert.strictEqual(matchesRule(cppRule, { url: 'https://site.com', title: 'Learn C++ in 21 days' }), true);
    assert.strictEqual(matchesRule(cppRule, 'https://google.com/search?q=Java'), false);

    // 价格与货币符号
    const priceRule = { pattern: '$100', type: 'keyword' };
    assert.strictEqual(matchesRule(priceRule, 'https://shop.com/items?price=$100'), true);
    assert.strictEqual(matchesRule(priceRule, { url: 'https://shop.com/1', title: 'Special offer for $100 only' }), true);

    // 邮箱或标签
    const emailRule = { pattern: 'user@secret.org', type: 'keyword' };
    assert.strictEqual(matchesRule(emailRule, 'https://mail.com/send?to=user@secret.org'), true);

    // 中文与 Emoji 关键词
    const chineseRule = { pattern: '商业机密', type: 'keyword' };
    assert.strictEqual(matchesRule(chineseRule, 'https://news.com/read?title=%E5%95%86%E4%B8%9A%E6%9C%BA%E5%AF%86'), true);
    assert.strictEqual(matchesRule(chineseRule, 'https://corp.com/wiki/商业机密手册'), true);
    assert.strictEqual(matchesRule(chineseRule, { url: 'https://corp.com/doc/1', title: '2026核心商业机密' }), true);
  });

  it('关键词中携带通配符通配任意中间字符', () => {
    const tokenRule = { pattern: 'access*token', type: 'keyword' };
    assert.strictEqual(matchesRule(tokenRule, 'https://oauth.com/auth?access_token=abcdef'), true);
    assert.strictEqual(matchesRule(tokenRule, 'https://oauth.com/auth?access-token=abcdef'), true);
    assert.strictEqual(matchesRule(tokenRule, 'https://oauth.com/auth?access123token=abcdef'), true);
    assert.strictEqual(matchesRule(tokenRule, 'https://oauth.com/auth?token=abcdef'), false);
  });

  it('畸形 URL 百分比编码容错 (杜绝 URIError 抛出)', () => {
    const kwRule = { pattern: 'test', type: 'keyword' };
    // 包含不完整的百分比编码 %88%99，标准 decodeURI 会抛出 URIError
    const malformedUrl = 'https://example.com/search?q=%88%99%test';
    assert.doesNotThrow(() => {
      const matched = matchesRule(kwRule, malformedUrl);
      // 依然可以由未解码的 urlString 正确匹配出 test
      assert.strictEqual(matched, true);
    });

    const brokenUtf8Url = 'https://example.com/page?query=%E6%9C';
    assert.doesNotThrow(() => {
      const matched = matchesRule(kwRule, brokenUtf8Url);
      assert.strictEqual(matched, false);
    });
  });
});

describe('EdgeCases - 非标准协议与浏览器内部页面安全测试', () => {
  const anyDomainRule = { pattern: 'settings', type: 'domain' };
  const anyKwRule = { pattern: 'chrome', type: 'keyword' };

  it('浏览器特殊协议绝对不崩溃', () => {
    const internalUrls = [
      'chrome://settings',
      'chrome://extensions',
      'chrome-extension://abcdefghijklmnopqrstuvwxyz/popup.html',
      'about:blank',
      'about:config',
      'edge://flags',
      'file:///C:/Users/User/Desktop/index.html',
      'javascript:void(0)',
      'data:text/html;base64,PGgxPkhlbGxvPC9oMT4=',
      'blob:https://example.com/uuid-1234-5678'
    ];

    for (const url of internalUrls) {
      assert.doesNotThrow(() => {
        matchesRule(anyDomainRule, url);
        matchesRule(anyKwRule, url);
      });
    }
  });

  it('空入参、null/undefined 与非法对象防御', () => {
    assert.strictEqual(matchesRule(null, null), false);
    assert.strictEqual(matchesRule(undefined, undefined), false);
    assert.strictEqual(matchesRule({}, {}), false);
    assert.strictEqual(matchesRule('', 'https://google.com'), false);
    assert.strictEqual(matchesRule('google.com', ''), false);
    assert.strictEqual(matchesRule('google.com', { url: null, title: null }), false);
    assert.strictEqual(matchesRule({ pattern: null }, 'https://google.com'), false);

    assert.deepStrictEqual(findMatchingRule(null, 'https://example.com'), { matched: false, rule: null });
    assert.deepStrictEqual(findMatchingRule([], null), { matched: false, rule: null });
    assert.deepStrictEqual(filterHistoryByRule(null, null), []);
  });
});

describe('EdgeCases - normalizeDomain 极端输入处理', () => {
  it('正确解析各种包含认证信息、协议、多级通配符与端口的输入', () => {
    assert.strictEqual(normalizeDomain('https://admin:pass@sub.domain.com:8080/path'), 'sub.domain.com');
    assert.strictEqual(normalizeDomain('http://user@192.168.1.1:3000/'), '192.168.1.1');
    assert.strictEqual(normalizeDomain('*.service.internal.net'), 'service.internal.net');
    assert.strictEqual(normalizeDomain('**..example.com'), 'example.com');
    assert.strictEqual(normalizeDomain(''), '');
    assert.strictEqual(normalizeDomain(null), '');
  });
});

describe('EdgeCases - computeCandidateStatus 复杂多层嵌套与混合规则覆盖', () => {
  const existing = [
    { id: 'r1', pattern: 'co.uk', type: 'domain', enabled: true },
    { id: 'r2', pattern: 'company.com/api/*', type: 'path', enabled: true },
    { id: 'r3', pattern: 'secret', type: 'keyword', enabled: true },
    { id: 'r4', pattern: 'disabled.org', type: 'domain', enabled: false }
  ];

  it('子域名层级覆盖与国家顶级域', () => {
    // news.bbc.co.uk 是 co.uk 的子域
    const cand = { rule: 'news.bbc.co.uk', type: 'domain' };
    const status = computeCandidateStatus(cand, existing);
    assert.strictEqual(status.isCovered, true);
    assert.strictEqual(status.coveringRule.id, 'r1');
  });

  it('关键词规则穿透覆盖带有关键词的域名或路径候选', () => {
    const candDomain = { rule: 'mysecretportal.com', type: 'domain' };
    const statusD = computeCandidateStatus(candDomain, existing);
    assert.strictEqual(statusD.isCovered, true);
    assert.strictEqual(statusD.coveringRule.id, 'r3');

    const candPath = { rule: 'public.com/export/secret/data', type: 'path' };
    const statusP = computeCandidateStatus(candPath, existing);
    assert.strictEqual(statusP.isCovered, true);
    assert.strictEqual(statusP.coveringRule.id, 'r3');
  });

  it('通配路径覆盖带协议的深层候选路径', () => {
    const candPath = { rule: 'https://company.com/api/v1/auth/tokens', type: 'path' };
    const status = computeCandidateStatus(candPath, existing);
    assert.strictEqual(status.isCovered, true);
    assert.strictEqual(status.coveringRule.id, 'r2');
  });

  it('已禁用的规则绝不误触发覆盖或完全匹配', () => {
    const cand = { rule: 'sub.disabled.org', type: 'domain' };
    const status = computeCandidateStatus(cand, existing);
    assert.strictEqual(status.isCovered, false);
    assert.strictEqual(status.isExactMatch, false);
  });
});

describe('EdgeCases - 全球主流搜索引擎复杂参数与短语解码实战测试', () => {
  const phraseRule = { pattern: 'private key', type: 'keyword' };

  it('主流搜索引擎多变空格编码 (+ 与 %20) 实测拦截', () => {
    // Google: 使用 + 作为空格分隔符
    const googleUrl = 'https://www.google.com/search?q=my+private+key+leak&oq=my+private+key';
    assert.strictEqual(matchesRule(phraseRule, googleUrl), false); // phrase is 'private key' with space; URL has '+'

    // 若用户设定的关键词带空格与带通配符 (如 private*key)
    const flexibleRule = { pattern: 'private*key', type: 'keyword' };
    assert.strictEqual(matchesRule(flexibleRule, googleUrl), true);

    // Bing: %20 编码
    const bingUrl = 'https://cn.bing.com/search?q=leak%20private%20key%20found';
    assert.strictEqual(matchesRule(phraseRule, bingUrl), true);

    // DuckDuckGo
    const ddgUrl = 'https://duckduckgo.com/?q=how+to+find+private%20key&ia=web';
    assert.strictEqual(matchesRule(phraseRule, ddgUrl), true);

    // 百度中文短语 + 百分比 URL
    const baiduChineseRule = { pattern: '历史记录清理', type: 'keyword' };
    const baiduUrl = 'https://www.baidu.com/s?wd=%E5%8E%86%E5%8F%B2%E8%AE%B0%E5%BD%95%E6%B8%85%E7%90%86&rsv_spt=1';
    assert.strictEqual(matchesRule(baiduChineseRule, baiduUrl), true);
  });
});

describe('EdgeCases - Punycode (国际化域名 IDN) 与极端端口测试', () => {
  it('正确匹配 Punycode 编码格式域名', () => {
    // xn--fiqs8s.cn (中国.cn)
    const punyRule = { pattern: 'xn--fiqs8s.cn', type: 'domain' };
    assert.strictEqual(matchesRule(punyRule, 'https://xn--fiqs8s.cn/'), true);
    assert.strictEqual(matchesRule(punyRule, 'https://sub.xn--fiqs8s.cn/news'), true);
    assert.strictEqual(matchesRule(punyRule, 'https://fake-xn--fiqs8s.cn'), false);
  });

  it('支持非标准与超高端口号 (Dev/Prod 极端网络环境)', () => {
    const devRule = { pattern: 'api.local:65535', type: 'domain' };
    assert.strictEqual(matchesRule(devRule, 'https://api.local:65535/graphql'), true);
    assert.strictEqual(matchesRule(devRule, 'https://api.local:8080/graphql'), false);

    // 泛端口规则
    const genericRule = { pattern: 'api.local', type: 'domain' };
    assert.strictEqual(matchesRule(genericRule, 'https://api.local:65535/graphql'), true);
    assert.strictEqual(matchesRule(genericRule, 'https://api.local:3000/'), true);
    assert.strictEqual(matchesRule(genericRule, 'https://api.local/'), true);
  });
});

describe('EdgeCases - 大规模历史记录批量匹配性能与准确率压测 (500 条拟真数据集)', () => {
  it('在 500 条高混淆历史记录中毫秒级精确出清命中项', () => {
    const targetDomainRule = { id: 'r_target', pattern: 'target-site.com', type: 'domain', enabled: true };
    const dataset = [];

    // 生成 500 条拟真浏览历史数据
    for (let i = 0; i < 500; i++) {
      if (i % 10 === 0) {
        // 应该命中的项 (共 50 条)
        dataset.push({
          id: `hit_${i}`,
          url: `https://sub${i}.target-site.com/articles/page_${i}?ref=user#anchor`,
          title: `Target Site Article ${i}`
        });
      } else if (i % 10 === 1) {
        // 高度相似的干扰项 (绝不能误杀)
        dataset.push({
          id: `noise1_${i}`,
          url: `https://not-target-site.com/page_${i}`,
          title: `Fake Site ${i}`
        });
      } else if (i % 10 === 2) {
        // 含有 target-site.com 作为参数的重定向链接 (绝不能误杀)
        dataset.push({
          id: `noise2_${i}`,
          url: `https://referrer.org/jump?to=https://target-site.com/page_${i}`,
          title: `Jump ${i}`
        });
      } else {
        // 其他常规网页
        dataset.push({
          id: `normal_${i}`,
          url: `https://wikipedia.org/wiki/Item_${i}`,
          title: `Wikipedia Item ${i}`
        });
      }
    }

    const tStart = performance.now();
    const filtered = filterHistoryByRule(targetDomainRule, dataset);
    const duration = performance.now() - tStart;

    // 严密断言：命中数量必须恰好为 50 条，且全部为 target-site.com 的真实域名
    assert.strictEqual(filtered.length, 50);
    for (const item of filtered) {
      assert.ok(item.url.includes('target-site.com/articles'));
      assert.ok(!item.url.includes('not-target-site.com'));
      assert.ok(!item.url.includes('referrer.org'));
    }

    // 性能断言：500 条过滤应当在 30 毫秒内极速完成
    assert.ok(duration < 50, `500 条历史匹配耗时过长: ${duration}ms`);
  });
});

