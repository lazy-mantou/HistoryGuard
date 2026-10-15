/**
 * @file historyCleaner.test.js
 * @description 历史记录全局回溯出清服务单元测试用例
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanHistoryByRule, getQueryTextForRule } from '../src/core/historyCleaner.js';

describe('historyCleaner - getQueryTextForRule (初筛搜索词提取)', () => {
  it('关键词规则提取：剥离 keyword: / kw: 前缀及通配符', () => {
    assert.strictEqual(getQueryTextForRule({ pattern: 'bagaga', type: 'keyword' }), 'bagaga');
    assert.strictEqual(getQueryTextForRule({ pattern: 'keyword:bagaga', type: 'keyword' }), 'bagaga');
    assert.strictEqual(getQueryTextForRule({ pattern: 'kw: bagaga' }), 'bagaga');
    assert.strictEqual(getQueryTextForRule({ pattern: '*secret*', type: 'keyword' }), 'secret');
  });

  it('域名规则提取：剥离协议、端口、路径与通配符', () => {
    assert.strictEqual(getQueryTextForRule({ pattern: 'google.com', type: 'domain' }), 'google.com');
    assert.strictEqual(getQueryTextForRule({ pattern: '*.google.com', type: 'domain' }), 'google.com');
    assert.strictEqual(getQueryTextForRule({ pattern: 'domain:bilibili.com' }), 'bilibili.com');
    assert.strictEqual(getQueryTextForRule({ pattern: 'https://m.zhihu.com/hot', type: 'domain' }), 'm.zhihu.com');
  });

  it('路径规则提取：剥离协议与尾部通配符', () => {
    assert.strictEqual(getQueryTextForRule({ pattern: 'github.com/myuser/*', type: 'path' }), 'github.com/myuser');
    assert.strictEqual(getQueryTextForRule({ pattern: 'path:example.com/test/*' }), 'example.com/test');
  });

  it('空规则或无效规则安全返回空字符串', () => {
    assert.strictEqual(getQueryTextForRule(null), '');
    assert.strictEqual(getQueryTextForRule({ pattern: '' }), '');
  });
});

describe('historyCleaner - cleanHistoryByRule (历史回溯扫描与精准出清)', () => {
  it('关键词规则：能够全量拉取并删除已有的匹配历史（如 Google 与百度真实搜索条目），非匹配条目不受影响', async () => {
    const deletedUrls = [];
    const mockHistory = [
      {
        url: 'https://www.google.com/search?q=bagaga&oq=bagaga',
        title: 'bagaga - Google 搜索',
        lastVisitTime: 10000
      },
      {
        url: 'https://www.baidu.com/s?wd=bagaga',
        title: 'bagaga_百度搜索',
        lastVisitTime: 9000
      },
      {
        url: 'https://github.com/torvalds/linux',
        title: 'Linux Kernel Repository',
        lastVisitTime: 8000
      },
      {
        url: 'https://news.ycombinator.com/',
        title: 'Hacker News',
        lastVisitTime: 7000
      }
    ];

    const mockApi = {
      history: {
        search: async ({ text }) => {
          // 模拟底层模糊全文检索
          return mockHistory.filter(item => {
            if (!text) return true;
            return item.url.includes(text) || (item.title && item.title.includes(text));
          });
        },
        deleteUrl: async (url) => {
          deletedUrls.push(url);
        }
      }
    };

    const progressReports = [];
    const result = await cleanHistoryByRule(
      { pattern: 'bagaga', type: 'keyword' },
      {
        api: mockApi,
        onProgress: (p) => progressReports.push(p)
      }
    );

    assert.strictEqual(result.deleted, 2, '应当精准删除 2 条命中的搜索历史');
    assert.strictEqual(result.scanned, 2, '仅扫描了初筛召回的 2 条记录');
    assert.strictEqual(deletedUrls.length, 2);
    assert.ok(deletedUrls.includes('https://www.google.com/search?q=bagaga&oq=bagaga'));
    assert.ok(deletedUrls.includes('https://www.baidu.com/s?wd=bagaga'));
    assert.ok(!deletedUrls.includes('https://github.com/torvalds/linux'));
    assert.ok(progressReports.length > 0);
  });

  it('域名规则：能够准确删除目标域名历史，严禁误杀 mygoogle.com 或其他类似非目标域名', async () => {
    const deletedUrls = [];
    const mockHistory = [
      {
        url: 'https://www.google.com/search?q=hello',
        title: 'Google Search',
        lastVisitTime: 10000
      },
      {
        url: 'https://google.com/doodles',
        title: 'Google Doodles',
        lastVisitTime: 9000
      },
      {
        url: 'https://mygoogle.com/phishing',
        title: 'Fake Site',
        lastVisitTime: 8000
      }
    ];

    const mockApi = {
      history: {
        search: async ({ text }) => {
          return mockHistory.filter(item => item.url.includes(text));
        },
        deleteUrl: async (url) => {
          deletedUrls.push(url);
        }
      }
    };

    const result = await cleanHistoryByRule(
      { pattern: 'google.com', type: 'domain' },
      { api: mockApi }
    );

    assert.strictEqual(result.deleted, 2);
    assert.strictEqual(result.scanned, 3);
    assert.ok(deletedUrls.includes('https://www.google.com/search?q=hello'));
    assert.ok(deletedUrls.includes('https://google.com/doodles'));
    assert.ok(!deletedUrls.includes('https://mygoogle.com/phishing'), '严禁误删类似域名');
  });

  it('分页游标与大批量安全退出：当遇到已见或无法删除的记录时安全推进游标，杜绝死循环', async () => {
    let callCount = 0;
    const mockApi = {
      history: {
        search: async ({ maxResults, endTime }) => {
          callCount++;
          // 第一次返回 2 条历史
          if (callCount === 1) {
            return [
              { url: 'https://example.com/1', lastVisitTime: 5000 },
              { url: 'https://example.com/2', lastVisitTime: 4000 }
            ];
          }
          // 第二次无更多历史
          return [];
        },
        deleteUrl: async () => {}
      }
    };

    const result = await cleanHistoryByRule(
      { pattern: 'example.com', type: 'domain' },
      { api: mockApi, batchSize: 2 }
    );

    assert.strictEqual(result.deleted, 2);
    assert.strictEqual(result.scanned, 2);
    assert.strictEqual(callCount, 2);
  });

  it('传入 null 或空规则时安全返回 0 条', async () => {
    const result = await cleanHistoryByRule(null);
    assert.strictEqual(result.deleted, 0);
    assert.strictEqual(result.scanned, 0);
  });
});
