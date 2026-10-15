/**
 * @file historyCleaner.js
 * @description 历史记录全局回溯与规则出清服务
 * 负责在新增规则、更新规则或按规则清理时，全量异步扫描浏览器历史并物理抹除匹配项
 * 采用「检索生产者 + 自适应并发微让步工作池」流水线：
 * 1. 内核自适应并发 (Firefox: 6 / Chromium: 20)，深度规避 Firefox Places SQLite 单写锁互斥；
 * 2. 微让步流控 (Micro-yielding)，在批量删除中定时主动让出主线程微秒时间片，给 SQLite WAL checkpoint 与 Observer 留出写入缓冲；
 * 3. 检索关键词下推优化与跨批次物理 URL 强去重。
 */

import { browserApi } from '../adapters/index.js';
import { matchesRule, detectRuleType } from './ruleMatcher.js';

/** Firefox (Gecko) Places SQLite 单写锁深度调优并发数 */
export const DEFAULT_FIREFOX_DELETE_CONCURRENCY = 6;
/** Chromium (Chrome / Edge) 任务调度器推荐在途并发数 */
export const DEFAULT_CHROMIUM_DELETE_CONCURRENCY = 20;
/** 通用兜底在途并发数 */
export const DEFAULT_DELETE_CONCURRENCY = 6;

/** 默认单次 history.search 拉取条数 (500 条平衡拉取速度与 IPC 传输内存占用) */
export const DEFAULT_SEARCH_BATCH_SIZE = 500;
/** 待删除队列积压上限（超过后检索生产者暂停，避免内存无限增长） */
const MAX_PENDING_QUEUE = 5000;
/** 进度回调节流间隔 (ms) */
const PROGRESS_THROTTLE_MS = 120;

/** Firefox 微让步配置：每处理 2 条让步 3ms，给 SQLite WAL checkpoint 与 Observer 释放单写锁 */
export const DEFAULT_FIREFOX_YIELD_SETTINGS = { yieldInterval: 2, yieldMs: 3 };
/** Chromium 微让步配置：每处理 10 条让步 1ms，保持高吞吐的同时避免主线程卡死 */
export const DEFAULT_CHROMIUM_YIELD_SETTINGS = { yieldInterval: 10, yieldMs: 1 };

/**
 * 判断当前是否处于 Firefox / Gecko 运行环境
 * @param {Object} [api=browserApi]
 * @returns {boolean}
 */
export function isFirefoxEnvironment(api = browserApi) {
  if (api && typeof api.isFirefox === 'boolean') {
    return api.isFirefox;
  }
  return (
    (typeof browser !== 'undefined' && Boolean(browser.runtime?.getBrowserInfo)) ||
    (typeof navigator !== 'undefined' && /Firefox/i.test(navigator.userAgent))
  );
}

/**
 * 根据浏览器内核获取最优并发度
 * @param {Object} [api=browserApi]
 * @returns {number} Firefox 返回 6，Chromium 返回 20
 */
export function getOptimalDeleteConcurrency(api = browserApi) {
  return isFirefoxEnvironment(api)
    ? DEFAULT_FIREFOX_DELETE_CONCURRENCY
    : DEFAULT_CHROMIUM_DELETE_CONCURRENCY;
}

/**
 * 根据浏览器内核获取最优微让步策略
 * @param {Object} [api=browserApi]
 * @returns {{ yieldInterval: number, yieldMs: number }}
 */
export function getOptimalYieldSettings(api = browserApi) {
  return isFirefoxEnvironment(api)
    ? { ...DEFAULT_FIREFOX_YIELD_SETTINGS }
    : { ...DEFAULT_CHROMIUM_YIELD_SETTINGS };
}

/**
 * 解析计算最终并发数：处理用户配置 'auto'、数值及 Firefox 旧版 30 并发降级保护
 * @param {string|number} configuredValue - 用户偏好中的 deleteChunkSize
 * @param {Object} [api=browserApi]
 * @returns {number}
 */
export function resolveDeleteConcurrency(configuredValue, api = browserApi) {
  const isFirefox = isFirefoxEnvironment(api);

  if (!configuredValue || configuredValue === 'auto') {
    return isFirefox ? DEFAULT_FIREFOX_DELETE_CONCURRENCY : DEFAULT_CHROMIUM_DELETE_CONCURRENCY;
  }

  const num = Number(configuredValue);
  if (!Number.isFinite(num) || num <= 0) {
    return isFirefox ? DEFAULT_FIREFOX_DELETE_CONCURRENCY : DEFAULT_CHROMIUM_DELETE_CONCURRENCY;
  }

  // 深度防护：在 Firefox 环境下，若配置了过高并发 (如旧版本遗留的 30 或 50)，
  // 自动优化限制为安全并发 6，彻底杜绝 SQLite 单写锁互斥与严重卡死
  if (isFirefox && num > 15) {
    return DEFAULT_FIREFOX_DELETE_CONCURRENCY;
  }

  return num;
}

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

  if (type === 'regex') {
    // 剥离首尾斜杠与标志修饰符
    let clean = pattern.replace(/^\/|\/[a-z]*$/gi, '');
    // 移除字符集 [...] 与各类正则特殊符号及转义字符（包括通配符 .）
    clean = clean.replace(/\[[^\]]*\]/g, ' ')
                 .replace(/\\(?:[dDsSwWbBtrnvf0-9]|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4})/g, ' ')
                 .replace(/\\./g, ' ')
                 .replace(/[.+*?^$(){}|]/g, ' ');
    const literals = clean.match(/[a-zA-Z0-9_\-]{3,}/g);
    if (literals && literals.length > 0) {
      literals.sort((a, b) => b.length - a.length);
      return literals[0];
    }
    return '';
  }

  return pattern;
}

/**
 * 创建一个支持自适应并发与微让步流控的删除工作池。
 * 任一请求完成后立刻补位下一个，始终保持 concurrency 个 deleteUrl 在途；
 * 并通过 yieldInterval / yieldMs 定期微让出时间片，保证 SQLite 写入缓冲与 UI 响应性。
 * @param {Object} [params={}]
 * @param {Object} [params.api=browserApi] - 浏览器适配器
 * @param {number} [params.concurrency] - 在途并发数
 * @param {number} [params.yieldInterval] - 连续删除多少条后让步一次
 * @param {number} [params.yieldMs] - 微让步时长 (ms)
 * @param {Function} [params.onSettled] - 每个请求结束后的回调 (ok: boolean) => void
 */
export function createDeletePool({
  api = browserApi,
  concurrency,
  yieldInterval,
  yieldMs,
  onSettled
} = {}) {
  const effectiveConcurrency = Math.max(1, Math.floor(concurrency || getOptimalDeleteConcurrency(api)));
  const defaultYield = getOptimalYieldSettings(api);
  const effectiveInterval = typeof yieldInterval === 'number' ? yieldInterval : defaultYield.yieldInterval;
  const effectiveYieldMs = typeof yieldMs === 'number' ? yieldMs : defaultYield.yieldMs;

  const queue = [];
  let head = 0;
  let closed = false;
  let workWaiters = [];
  let spaceWaiters = [];

  const pending = () => queue.length - head;

  const worker = async () => {
    let itemsSinceYield = 0;
    while (true) {
      if (head < queue.length) {
        const url = queue[head];
        queue[head] = undefined;
        head++;
        // 周期性压缩已消费的队列头部，避免数组无限增长
        if (head > 2048 && head * 2 > queue.length) {
          queue.splice(0, head);
          head = 0;
        }
        if (spaceWaiters.length && pending() < MAX_PENDING_QUEUE) {
          const w = spaceWaiters; spaceWaiters = []; w.forEach(fn => fn());
        }
        let ok = false;
        try {
          await api.history.deleteUrl(url);
          ok = true;
        } catch {
          ok = false;
        }
        if (typeof onSettled === 'function') onSettled(ok);

        itemsSinceYield++;
        // 微让步调度：释放单写锁与执行时间片
        if (effectiveInterval > 0 && itemsSinceYield >= effectiveInterval && effectiveYieldMs > 0) {
          itemsSinceYield = 0;
          await new Promise(resolve => setTimeout(resolve, effectiveYieldMs));
        }

        continue;
      }
      if (closed) return;
      await new Promise(resolve => workWaiters.push(resolve));
    }
  };

  const workers = Array.from({ length: effectiveConcurrency }, () => worker());

  return {
    /** 入队待删除 URL；当积压过多时等待消费以形成背压 */
    async push(urls) {
      for (const url of urls) queue.push(url);
      if (workWaiters.length) {
        const w = workWaiters; workWaiters = []; w.forEach(fn => fn());
      }
      while (pending() >= MAX_PENDING_QUEUE) {
        await new Promise(resolve => spaceWaiters.push(resolve));
      }
    },
    /** 关闭入口并等待全部在途请求完成 */
    async drain() {
      closed = true;
      if (workWaiters.length) {
        const w = workWaiters; workWaiters = []; w.forEach(fn => fn());
      }
      await Promise.all(workers);
    }
  };
}

/**
 * 以自适应并发与微让步模式删除一组 URL（供管理页批量删除等场景复用）
 * @param {Array<string>} urls
 * @param {Object} [options]
 * @param {number} [options.concurrency]
 * @param {number} [options.yieldInterval]
 * @param {number} [options.yieldMs]
 * @param {Function} [options.onProgress] - ({ processed, deleted, total }) => void
 * @param {Object} [options.api]
 * @returns {Promise<{ deleted: number, failed: number }>}
 */
export async function deleteUrlsConcurrently(urls, options = {}) {
  const {
    concurrency,
    yieldInterval,
    yieldMs,
    onProgress,
    api = browserApi
  } = options;

  const effectiveConcurrency = concurrency || getOptimalDeleteConcurrency(api);
  const list = Array.from(new Set((urls || []).filter(Boolean)));
  const total = list.length;
  let deleted = 0;
  let failed = 0;
  let lastEmit = 0;

  const emit = (force = false) => {
    if (typeof onProgress !== 'function') return;
    const now = Date.now();
    if (!force && now - lastEmit < PROGRESS_THROTTLE_MS) return;
    lastEmit = now;
    onProgress({ processed: deleted + failed, deleted, total });
  };

  const pool = createDeletePool({
    api,
    concurrency: effectiveConcurrency,
    yieldInterval,
    yieldMs,
    onSettled: (ok) => {
      if (ok) deleted++; else failed++;
      emit();
    }
  });

  await pool.push(list);
  await pool.drain();
  emit(true);

  return { deleted, failed };
}

/**
 * 针对指定规则执行浏览器历史记录回溯扫描与物理删除
 *
 * 流水线结构：
 *   检索生产者：按 lastVisitTime 时间游标从新到旧分页 history.search，精确匹配后入队
 *   删除工作池：自适应并发 + 微让步流控，与检索并行
 *
 * @param {string|{pattern: string, type?: string}} rule - 规则对象或规则字符串
 * @param {Object} [options={}] - 配置选项
 * @param {Function} [options.onProgress] - 进度回调函数 ({ deleted, scanned, failed }) => void（已节流）
 * @param {number} [options.concurrency] - 在途 deleteUrl 并发数 (未指定时自适应内核)
 * @param {number} [options.chunkSize] - 旧参数名，等价于 concurrency（向后兼容）
 * @param {number} [options.batchSize=500] - 历史检索游标单次拉取条数
 * @param {number} [options.startTime=0] - 检索起始时间戳 (ms since epoch)
 * @param {number} [options.yieldInterval] - 自定义微让步计数阈值
 * @param {number} [options.yieldMs] - 自定义微让步时长 (ms)
 * @param {Object} [options.api=browserApi] - 底层浏览器适配器实例（支持依赖注入测试）
 * @returns {Promise<{ deleted: number, scanned: number, failed: number }>} 清理结果统计
 */
export async function cleanHistoryByRule(rule, options = {}) {
  const {
    onProgress,
    chunkSize,
    batchSize = DEFAULT_SEARCH_BATCH_SIZE,
    startTime = 0,
    yieldInterval,
    yieldMs,
    api = browserApi
  } = options;

  const rawConcurrency = options.concurrency || chunkSize;
  const concurrency = resolveDeleteConcurrency(rawConcurrency, api);

  if (!rule) {
    return { deleted: 0, scanned: 0, failed: 0 };
  }

  const queryText = getQueryTextForRule(rule);
  let deleted = 0;
  let failed = 0;
  let cursorEndTime = 0;
  let lastEmit = 0;
  const queuedUrls = new Set();
  const seenItemKeys = new Set();

  const emit = (force = false) => {
    if (typeof onProgress !== 'function') return;
    const now = Date.now();
    if (!force && now - lastEmit < PROGRESS_THROTTLE_MS) return;
    lastEmit = now;
    onProgress({ deleted, scanned: seenItemKeys.size, failed });
  };

  const pool = createDeletePool({
    api,
    concurrency,
    yieldInterval,
    yieldMs,
    onSettled: (ok) => {
      if (ok) deleted++; else failed++;
      emit();
    }
  });

  const yieldSettings = getOptimalYieldSettings(api);
  const searchBatchYieldMs = typeof yieldMs === 'number' ? yieldMs : yieldSettings.yieldMs;

  try {
    while (true) {
      const searchParams = {
        text: queryText,
        startTime: typeof startTime === 'number' ? startTime : 0,
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

      // 精确二次匹配并入队（同一 URL 仅入队一次；跨页边界的重复条目以 url+lastVisitTime 去重）
      const toQueue = [];
      for (const item of batch) {
        if (!item || !item.url) continue;
        if (startTime > 0 && typeof item.lastVisitTime === 'number' && item.lastVisitTime < startTime) {
          continue;
        }
        const key = `${item.url}|${item.lastVisitTime || 0}`;
        if (seenItemKeys.has(key)) continue;
        seenItemKeys.add(key);
        if (!queuedUrls.has(item.url) && matchesRule(rule, item)) {
          queuedUrls.add(item.url);
          toQueue.push(item.url);
        }
      }

      if (toQueue.length > 0) {
        await pool.push(toQueue);
      }
      emit();

      // 每拉取并推送完一个搜索批次，微让出时间片，保证事件循环与界面进度同步
      if (searchBatchYieldMs > 0) {
        await new Promise(r => setTimeout(r, searchBatchYieldMs));
      }

      // 底层返回的条数小于请求的批次大小，说明历史库已经全部遍历完毕
      if (batch.length < batchSize) {
        break;
      }

      // 严格单调递减的时间游标：每页都推进到本页最老时间戳
      const oldestItem = batch[batch.length - 1];
      const oldestTime = (oldestItem && typeof oldestItem.lastVisitTime === 'number')
        ? oldestItem.lastVisitTime
        : 0;
      if (!oldestTime || oldestTime <= 1 || (startTime > 0 && oldestTime <= startTime)) {
        break;
      }
      // 若同一毫秒堆积的条目超过一页，向前推进 1ms 跳出重合窗口
      cursorEndTime = (cursorEndTime === oldestTime) ? oldestTime - 1 : oldestTime;
      if (cursorEndTime <= 1 || (startTime > 0 && cursorEndTime <= startTime)) {
        break;
      }
    }
  } finally {
    await pool.drain();
  }

  emit(true);

  return {
    deleted,
    scanned: seenItemKeys.size,
    failed
  };
}
