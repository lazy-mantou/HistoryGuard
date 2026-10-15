/**
 * @file ruleMatcher.js
 * @description 规则匹配引擎
 * 支持高精度域名级与路径通配符级匹配，杜绝子串误杀，支持实时历史匹配与转换
 */

/**
 * 逃逸正则特殊字符，保留通配符 *
 * @param {string} str
 * @returns {string}
 */
function escapeRegexExceptWildcard(str) {
  return str.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
}

/**
 * 自动检测规则表达式类型
 * @param {string} pattern
 * @returns {'domain'|'path'|'keyword'}
 */
export function detectRuleType(pattern) {
  let cleaned = (pattern || '').trim().replace(/^https?:\/\//i, '');
  if (/^(?:keyword|kw):\s*/i.test(cleaned)) return 'keyword';
  if (/^path:\s*/i.test(cleaned)) return 'path';
  if (/^domain:\s*/i.test(cleaned)) return 'domain';

  // 根路径容错：剥离尾随斜杠 (如 "www.google.com/" 或 "https://www.google.com/")
  cleaned = cleaned.replace(/\/+$/, '');

  if (cleaned.includes('/')) return 'path';
  if (cleaned.includes('.') || cleaned.startsWith('*') || cleaned === 'localhost' || /^(\d{1,3}\.){3}\d{1,3}$/.test(cleaned)) {
    return 'domain';
  }
  return 'keyword';
}

/**
 * 将关键词规则转换为规范的 RegExp 匹配对象
 * 无论在任何域名或路径下，只要 URL 或标题中出现该关键词即命中
 * @param {string} pattern
 * @returns {RegExp}
 */
export function keywordRuleToRegex(pattern) {
  let cleaned = (pattern || '').trim();
  // 容错：剥离可能存在的 keyword: 或 kw: 前缀
  cleaned = cleaned.replace(/^(?:keyword|kw):\s*/i, '');
  const regexStr = escapeRegexExceptWildcard(cleaned);
  return new RegExp(regexStr, 'i');
}

/**
 * 将域名规则转换为规范的 RegExp 匹配对象
 * 支持: google.com 或 *.google.com 匹配 google.com 及 m.gemini.google.com
 * 严禁误匹配 mygoogle.com 或 google.com.cn
 * @param {string} pattern
 * @returns {RegExp}
 */
export function domainRuleToRegex(pattern) {
  let domain = (pattern || '').trim().toLowerCase();
  // 移除可能存在的协议与路径
  domain = domain.replace(/^https?:\/\//i, '').split('/')[0];
  // 移除开头的 *.
  if (domain.startsWith('*.')) {
    domain = domain.slice(2);
  } else if (domain.startsWith('*')) {
    domain = domain.slice(1);
  }

  const escapedDomain = domain.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  // 匹配: exact host 或 以 .domain 结尾的主机名
  // URL: ^(?:https?:\/\/)?(?:[a-zA-Z0-9-]+\.)*escapedDomain(?::\d+)?(?:\/.*)?$
  return new RegExp(`^(?:https?:\\/\\/)?(?:[a-zA-Z0-9-]+\\.)*${escapedDomain}(?::\\d+)?(?:[\\/?#].*)?$`, 'i');
}

/**
 * 将路径规则转换为规范的 RegExp 匹配对象
 * 支持: www.aaa.com/aa/bb/* 或 www.aaa.com/aa/bb/cc.html
 * @param {string} pattern
 * @returns {RegExp}
 */
export function pathRuleToRegex(pattern) {
  let cleaned = (pattern || '').trim();
  // 移除开头可能包含的协议
  cleaned = cleaned.replace(/^https?:\/\//i, '');

  const regexStr = escapeRegexExceptWildcard(cleaned);
  // 允许匹配 http:// 或 https://，且在无通配符结尾时匹配 query 与 hash 边界
  if (cleaned.endsWith('*')) {
    return new RegExp(`^(?:https?:\\/\\/)?${regexStr}`, 'i');
  }
  return new RegExp(`^(?:https?:\\/\\/)?${regexStr}(?:[?#].*)?$`, 'i');
}

/**
 * 将任意规则转换为匹配器 RegExp
 * @param {string} pattern
 * @param {'domain'|'path'|'keyword'} [type]
 * @returns {RegExp}
 */
export function ruleToRegex(pattern, type) {
  const actualType = type || detectRuleType(pattern);
  if (actualType === 'keyword') {
    return keywordRuleToRegex(pattern);
  }
  return actualType === 'path' ? pathRuleToRegex(pattern) : domainRuleToRegex(pattern);
}

/**
 * 判断指定 URL 或条目是否命中某条具体规则
 * @param {string|{pattern: string, type?: string}} rule
 * @param {string|{url: string, title?: string}} target
 * @returns {boolean}
 */
export function matchesRule(rule, target) {
  if (!target) return false;

  const urlString = typeof target === 'string' ? target : target.url;
  const titleString = typeof target === 'object' ? (target.title || '') : '';
  let pattern = typeof rule === 'string' ? rule : rule?.pattern;
  let type = typeof rule === 'object' ? rule?.type : undefined;

  if (!pattern) return false;

  // 容错处理前缀修饰符 (如 keyword:xxx, kw:xxx, domain:xxx, path:xxx)
  if (/^(?:keyword|kw):\s*/i.test(pattern)) {
    type = 'keyword';
    pattern = pattern.replace(/^(?:keyword|kw):\s*/i, '');
  } else if (/^domain:\s*/i.test(pattern)) {
    type = 'domain';
    pattern = pattern.replace(/^domain:\s*/i, '');
  } else if (/^path:\s*/i.test(pattern)) {
    type = 'path';
    pattern = pattern.replace(/^path:\s*/i, '');
  }

  type = type || detectRuleType(pattern);

  try {
    const regex = ruleToRegex(pattern, type);
    if (type === 'keyword') {
      if (urlString) {
        if (regex.test(urlString)) return true;
        try {
          const decoded = decodeURI(urlString);
          if (decoded !== urlString && regex.test(decoded)) return true;
        } catch {}
      }
      if (titleString && regex.test(titleString)) return true;
      return false;
    }
    return urlString ? regex.test(urlString) : false;
  } catch (err) {
    console.error('matchesRule regex test error:', err, { pattern, target });
    return false;
  }
}

/**
 * 在已启用的规则列表中查找命中当前 URL 或条目的规则
 * @param {Array<Object>} rules
 * @param {string|{url: string, title?: string}} target
 * @returns {{ matched: boolean, rule: Object|null }}
 */
export function findMatchingRule(rules, target) {
  if (!Array.isArray(rules) || !target) {
    return { matched: false, rule: null };
  }

  for (const rule of rules) {
    // 忽略未启用的规则
    if (rule.enabled === false) continue;

    if (matchesRule(rule, target)) {
      return { matched: true, rule };
    }
  }

  return { matched: false, rule: null };
}

/**
 * 从历史记录列表中筛选命中指定规则的条目
 * @param {string|Object} rule
 * @param {Array<Object>} historyItems
 * @returns {Array<Object>}
 */
export function filterHistoryByRule(rule, historyItems) {
  if (!Array.isArray(historyItems) || !rule) return [];

  try {
    return historyItems.filter(item => item && matchesRule(rule, item));
  } catch {
    return [];
  }
}

/**
 * 将用户搜索关键词智能转换为规范的隐藏规则
 * 用于 Options 页面的“删除记录并将搜索词加入永久隐藏”
 * @param {string} searchTerm
 * @returns {{ pattern: string, type: 'domain'|'path' }}
 */
export function convertSearchTermToRule(searchTerm) {
  const term = (searchTerm || '').trim();
  if (!term) {
    return { pattern: '', type: 'domain' };
  }

  // 移除协议前缀
  let cleanTerm = term.replace(/^https?:\/\//i, '');

  // 如果包含路径斜杠
  if (cleanTerm.includes('/')) {
    // 若以斜杠结尾但不是通配符，追加通配符
    if (cleanTerm.endsWith('/')) {
      cleanTerm += '*';
    } else if (!cleanTerm.endsWith('*')) {
      const pathPart = cleanTerm.slice(cleanTerm.indexOf('/'));
      // 如 github.com/user (路径无文件扩展名) 追加 /*
      if (!pathPart.includes('.')) {
        cleanTerm += '/*';
      }
    }
    return {
      pattern: cleanTerm,
      type: 'path'
    };
  }

  // 纯域名或主机名搜索词
  if (cleanTerm.includes('.')) {
    if (!cleanTerm.startsWith('*.')) {
      cleanTerm = `*.${cleanTerm.replace(/^\*\.?/, '')}`;
    }
    return {
      pattern: cleanTerm,
      type: 'domain'
    };
  }

  // 简写关键词 (如 bilibili -> *.bilibili.com)
  return {
    pattern: `*.${cleanTerm}.com`,
    type: 'domain'
  };
}

/**
 * 标准化域名字符串，统一转小写并移除协议、端口、路径与开头的 *.
 * @param {string} raw
 * @returns {string}
 */
export function normalizeDomain(raw) {
  if (!raw) return '';
  let d = raw.trim().toLowerCase().replace(/^https?:\/\//i, '').split('/')[0].split(':')[0];
  if (d.startsWith('*.')) d = d.slice(2);
  else if (d.startsWith('*')) d = d.slice(1);
  return d;
}

/**
 * 判断 candDomain 是否为 parentDomain 的子级域名 (即被父级域名覆盖保护)
 * 例如: candDomain = 'aa.bb.cc.dd', parentDomain = 'cc.dd' -> true
 *      candDomain = 'bb.cc.dd', parentDomain = 'cc.dd' -> true
 *      candDomain = 'cc.dd', parentDomain = 'cc.dd' -> false (相同不算覆盖，属于自身完全匹配)
 * @param {string} candDomain
 * @param {string} parentDomain
 * @returns {boolean}
 */
export function isSubdomainOf(candDomain, parentDomain) {
  const c = normalizeDomain(candDomain);
  const p = normalizeDomain(parentDomain);
  if (!c || !p || c === p) return false;
  return c.endsWith('.' + p);
}

/**
 * 计算候选规则相对于现有规则列表的层级覆盖状态
 * @param {Object} candidate - { rule: string, type?: 'domain'|'path' }
 * @param {Array<Object>} existingRules - 已保存的规则列表
 * @returns {{ isExactMatch: boolean, isCovered: boolean, coveringRule: Object|null, exactRule: Object|null }}
 */
export function computeCandidateStatus(candidate, existingRules) {
  const result = {
    isExactMatch: false,
    isCovered: false,
    coveringRule: null,
    exactRule: null
  };

  if (!candidate || !candidate.rule || !Array.isArray(existingRules) || existingRules.length === 0) {
    return result;
  }

  const candType = candidate.type || 'domain';
  const candRule = candidate.rule.trim().toLowerCase();

  // 1. 完全匹配判定 (自身已在规则列表中)
  for (const r of existingRules) {
    if (r.enabled === false) continue;
    const rPattern = (r.pattern || '').trim().toLowerCase();

    if (candType === 'domain') {
      const candNorm = normalizeDomain(candRule);
      const rNorm = normalizeDomain(rPattern);
      if ((r.type || 'domain') === 'domain' && candNorm && candNorm === rNorm) {
        result.isExactMatch = true;
        result.exactRule = r;
        return result;
      }
    } else {
      if ((r.type || 'domain') === candType && candRule === rPattern) {
        result.isExactMatch = true;
        result.exactRule = r;
        return result;
      }
    }
  }

  // 2. 关键词规则全局覆盖判定：只要候选规则字符串中包含了已启用的关键词规则，即判定为被覆盖
  for (const r of existingRules) {
    if (r.enabled === false || r.type !== 'keyword') continue;
    const kwRegex = keywordRuleToRegex(r.pattern);
    if (kwRegex.test(candRule)) {
      result.isCovered = true;
      result.coveringRule = r;
      return result;
    }
  }

  // 3. 层级覆盖判定 (上级父域名或前缀路径已拦截)
  // 用户需求: 例如 aa.bb.cc.dd，当 cc.dd 加入列表后，aa.bb.cc.dd 和 bb.cc.dd 判定为被覆盖变灰且不能选中
  if (candType === 'domain') {
    const candDomain = normalizeDomain(candRule);
    for (const r of existingRules) {
      if (r.enabled === false) continue;
      const rType = r.type || 'domain';
      if (rType === 'domain') {
        const rDomain = normalizeDomain(r.pattern);
        if (rDomain && isSubdomainOf(candDomain, rDomain)) {
          result.isCovered = true;
          result.coveringRule = r;
          return result;
        }
      }
    }
  } else if (candType === 'path') {
    for (const r of existingRules) {
      if (r.enabled === false) continue;
      if (r.type === 'domain') {
        const rDomain = normalizeDomain(r.pattern);
        const urlHost = normalizeDomain(candRule);
        if (rDomain && (urlHost === rDomain || isSubdomainOf(urlHost, rDomain))) {
          result.isCovered = true;
          result.coveringRule = r;
          return result;
        }
      } else if (r.type === 'path') {
        const rPattern = (r.pattern || '').trim().toLowerCase();
        if (rPattern.endsWith('*')) {
          const prefix = rPattern.slice(0, -1);
          if (candRule !== rPattern && candRule.startsWith(prefix)) {
            result.isCovered = true;
            result.coveringRule = r;
            return result;
          }
        }
      }
    }
  }

  return result;
}

