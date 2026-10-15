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
 * @param {number} [options.chunkSize=30] - 单批次并发删除条数
 * @param {number} [options.batchSize=200] - 历史检索游标单次拉取条数
 * @param {Object} [options.api=browserApi] - 底层浏览器适配器实例（支持依赖注入测试）
 * @returns {Promise<{ deleted: number, scanned: number }>} 清理结果统计
 */
export async function cleanHistoryByRule(rule, options = {}) {
  const {
    onProgress,
    chunkSize = 30,
    batchSize = 200,
    api = browserApi
  } = options;

  if (!rule) {
    return { deleted: 0, scanned: 0 };
  }

  const queryText = getQueryTextForRule(rule);
  let totalDeleted = 0;
  let cursorEndTime = 0;
  const seenUrls = new Set();

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

    // 过滤出本轮尚未考察过的条目
    const unseen = batch.filter(item => item && item.url && !seenUrls.has(item.url));
    const oldestItem = batch[batch.length - 1];
    const oldestTime = (oldestItem && typeof oldestItem.lastVisitTime === 'number')
      ? oldestItem.lastVisitTime
      : 0;

    if (unseen.length === 0) {
      // 本批次获取的所有记录此前都已考察过（未命中规则或删除受限）
      // 强行推进游标，跳出重复窗口
      if (!oldestTime || oldestTime <= 1 || (cursorEndTime > 0 && oldestTime >= cursorEndTime)) {
        break;
      }
      cursorEndTime = oldestTime - 1;
      continue;
    }

    // 标记已考察
    unseen.forEach(item => seenUrls.add(item.url));

    // 使用 matchesRule 进行精确二次匹配，严禁子串误杀
    const toDelete = unseen.filter(item => matchesRule(rule, item));

    if (toDelete.length > 0) {
      for (let i = 0; i < toDelete.length; i += chunkSize) {
        const chunk = toDelete.slice(i, i + chunkSize);
        const results = await Promise.allSettled(chunk.map(item => api.history.deleteUrl(item.url)));
        const successCount = results.filter(r => r.status === 'fulfilled').length;
        totalDeleted += successCount;

        if (typeof onProgress === 'function') {
          onProgress({
            deleted: totalDeleted,
            scanned: seenUrls.size
          });
        }
        // 宏任务让出主线程控制权，保障 UI 流畅重绘
        await new Promise(r => setTimeout(r, 0));
      }
    }

    // 如果底层返回的条数小于请求的批次大小，说明历史库已经全部遍历完毕
    if (batch.length < batchSize) {
      break;
    }

    // 如果批次中有未被删除的记录（如不匹配规则而保留），为了防止下一次请求完全重复返回这些条目：
    // 将 cursorEndTime 推进到 oldestTime
    if (toDelete.length < batch.length && oldestTime > 0) {
      if (cursorEndTime === oldestTime) {
        cursorEndTime = oldestTime - 1;
      } else {
        cursorEndTime = oldestTime;
      }
      if (cursorEndTime <= 1) {
        break;
      }
    }
  }

  return {
    deleted: totalDeleted,
    scanned: seenUrls.size
  };
}
