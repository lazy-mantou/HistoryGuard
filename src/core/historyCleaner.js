/**
 * @file historyCleaner.js
 * @description 历史记录全局回溯与规则出清服务
 * 负责在新增规则、更新规则或按规则清理时，全量异步扫描浏览器历史并物理抹除匹配项
 * 采用游标分页与并发分片让出主线程，杜绝页面卡顿与死循环
 */

import { browserApi } from '../adapters/index.js';
import { matchesRule, detectRuleType } from './ruleMatcher.js';

/**
 * 根据规则提取供 browser.history.search 使用的高召回初筛关键词
 * @param {string|{pattern: string, type?: string}} rule
 * @returns {string}
 */
export function getQueryTextForRule(rule) {
  if (!rule) return '';
  let pattern = typeof rule === 'string' ? rule : rule.pattern;
  let type = typeof rule === 'object' ? rule.type : undefined;
  if (!pattern) return '';

  pattern = pattern.trim();

  // 剥离可能存在的前缀修饰符
  if (/^(?:keyword|kw):\s*/i.test(pattern)) {
    type = 'keyword';
    pattern = pattern.replace(/^(?:keyword|kw):\s*/i, '').trim();
  } else if (/^domain:\s*/i.test(pattern)) {
    type = 'domain';
    pattern = pattern.replace(/^domain:\s*/i, '').trim();
  } else if (/^path:\s*/i.test(pattern)) {
    type = 'path';
    pattern = pattern.replace(/^path:\s*/i, '').trim();
  }

  type = type || detectRuleType(pattern);

  if (type === 'keyword') {
    // 移除通配符 *
    return pattern.replace(/^\*+|\*+$/g, '').trim();
  }

  if (type === 'domain') {
    // 移除协议、端口、路径与通配符 *.
    let domain = pattern.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0];
    domain = domain.replace(/^\*\.?/, '').replace(/\*+$/, '').trim();
    return domain;
  }

  if (type === 'path') {
    // 移除协议与末尾通配符
    let clean = pattern.replace(/^https?:\/\//i, '');
    clean = clean.replace(/\/\*+$/, '').replace(/\*+$/, '').trim();
    return clean;
  }

  return pattern;
}

/**
 * 针对指定规则执行浏览器全量历史记录回溯扫描与物理删除
 * @param {string|{pattern: string, type?: string}} rule - 规则对象或规则字符串
 * @param {Object} [options={}] - 配置选项
 * @param {Function} [options.onProgress] - 进度回调函数 ({ deleted, scanned }) => void
 * @param {number} [options.chunkSize=6] - 单批次并发删除条数 (避免 SQLite 锁争用)
 * @param {number} [options.batchSize=500] - 历史检索游标单次拉取条数
 * @param {Object} [options.api=browserApi] - 底层浏览器适配器实例（支持依赖注入测试）
 * @returns {Promise<{ deleted: number, scanned: number }>} 清理结果统计
 */
export async function cleanHistoryByRule(rule, options = {}) {
  const {
    onProgress,
    chunkSize = 6,
    batchSize = 500,
    api = browserApi
  } = options;

  if (!rule) {
    return { deleted: 0, scanned: 0 };
  }

  const queryText = getQueryTextForRule(rule);
  let totalDeleted = 0;
  let cursorEndTime = 0;
  const deletedUrls = new Set();
  const seenItemKeys = new Set();

  while (true) {
    const searchParams = {
      text: queryText,
      startTime: 0,
      maxResults: batchSize
    };
    if (cursorEndTime > 0) {
      searchParams.endTime = cursorEndTime;
    }

    let batch = [];
    try {
      batch = await api.history.search(searchParams);
    } catch (err) {
      console.error('[HistGuard] cleanHistoryByRule search error:', err);
      break;
    }

    if (!batch || batch.length === 0) {
      break;
    }

    // 过滤出本轮尚未考察过的历史条目（以 url + lastVisitTime 作为唯一特征，避免跨批次边界重复处理）
    const unseen = [];
    for (const item of batch) {
      if (!item || !item.url) continue;
      const key = `${item.url}|${item.lastVisitTime || 0}`;
      if (!seenItemKeys.has(key)) {
        seenItemKeys.add(key);
        unseen.push(item);
      }
    }

    const oldestItem = batch[batch.length - 1];
    const oldestTime = (oldestItem && typeof oldestItem.lastVisitTime === 'number')
      ? oldestItem.lastVisitTime
      : 0;

    // 从未考察过的条目中筛选出精确命中规则的项
    const toDelete = unseen.filter(item => matchesRule(rule, item));

    if (toDelete.length > 0) {
      // 核心优化 1：去重物理 URL。在历史库中同一 URL（如网站首页、视频播放页）往往有几十上百条重复访问。
      // browser.history.deleteUrl 会自动一次性抹除该 URL 的全部访问，严禁并发重复调用导致 Firefox Places SQLite 锁死
      const uniqueUrlsToDelete = [];
      for (const item of toDelete) {
        if (!deletedUrls.has(item.url)) {
          deletedUrls.add(item.url);
          uniqueUrlsToDelete.push(item.url);
        }
      }

      // 核心优化 2：安全小并发分片 (默认 6)，每批让出事件循环，杜绝阻塞主线程与数据库死锁
      for (let i = 0; i < uniqueUrlsToDelete.length; i += chunkSize) {
        const chunk = uniqueUrlsToDelete.slice(i, i + chunkSize);
        const results = await Promise.allSettled(chunk.map(url => api.history.deleteUrl(url)));
        const successCount = results.filter(r => r.status === 'fulfilled').length;
        totalDeleted += successCount;

        if (typeof onProgress === 'function') {
          onProgress({
            deleted: totalDeleted,
            scanned: seenItemKeys.size
          });
        }
        await new Promise(r => setTimeout(r, 2));
      }
    } else if (typeof onProgress === 'function' && unseen.length > 0) {
      onProgress({
        deleted: totalDeleted,
        scanned: seenItemKeys.size
      });
    }

    // 如果底层返回的条数小于请求的批次大小，说明历史库已经全部遍历完毕
    if (batch.length < batchSize) {
      break;
    }

    // 核心优化 3：严格单调递减的历史时间游标推进
    // 保证每一批次严格向过去的时间窗口推进，杜绝死循环与提前跳出
    if (!oldestTime || oldestTime <= 1) {
      break;
    }

    if (cursorEndTime === oldestTime) {
      // 连续两次最老时间戳相同（同 1 毫秒存在海量访问记录），推进 1 毫秒跳出
      cursorEndTime = oldestTime - 1;
    } else {
      cursorEndTime = oldestTime;
    }

    if (cursorEndTime <= 1) {
      break;
    }
  }

  return {
    deleted: totalDeleted,
    scanned: seenItemKeys.size
  };
}
