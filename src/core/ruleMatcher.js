/**
 * @file ruleMatcher.js
 * @description 规则匹配引擎
 * 支持高精度域名级与路径通配符级匹配，杜绝子串误杀，支持实时历史匹配与转换
 */

/**
 * 规则长度与容量安全上限常量
 */
export const MAX_RULE_LENGTH = 1024;
export const MAX_WILDCARDS_PER_RULE = 5;
export const MAX_RULES_TOTAL_LIMIT = 20000;
export const WARN_RULES_TOTAL_THRESHOLD = 10000;

export const RULE_ERROR_CODES = {
  EMPTY: 'RULE_EMPTY',
  TOO_LONG: 'RULE_TOO_LONG',
  TOO_MANY_WILDCARDS: 'RULE_TOO_MANY_WILDCARDS',
  WILDCARD_OVERMATCH: 'RULE_WILDCARD_OVERMATCH',
  CAPACITY_LIMIT: 'RULES_CAPACITY_LIMIT'
};

export const RULE_ERROR_I18N_KEYS = {
  [RULE_ERROR_CODES.EMPTY]: 'options.ruleErrorEmpty',
  [RULE_ERROR_CODES.TOO_LONG]: 'options.ruleErrorTooLong',
  [RULE_ERROR_CODES.TOO_MANY_WILDCARDS]: 'options.ruleErrorTooManyWildcards',
  [RULE_ERROR_CODES.WILDCARD_OVERMATCH]: 'options.ruleErrorWildcardOvermatch',
  [RULE_ERROR_CODES.CAPACITY_LIMIT]: 'options.ruleErrorCapacityLimit'
};

const DEFAULT_ERROR_MESSAGES = {
  [RULE_ERROR_CODES.EMPTY]: '规则表达式不能为空',
  [RULE_ERROR_CODES.TOO_LONG]: '单条规则长度不能超过 1024 个字符',
  [RULE_ERROR_CODES.TOO_MANY_WILDCARDS]: '单条规则通配符 (*) 数量不能超过 5 个',
  [RULE_ERROR_CODES.WILDCARD_OVERMATCH]: '禁止使用纯通配符或泛匹配规则 (如 *、*.*、*/*)，以防误删全部历史',
  [RULE_ERROR_CODES.CAPACITY_LIMIT]: '已达到规则最大存储上限 (20,000 条)，无法继续添加'
};

/**
 * 获取规则校验错误的默认或国际化文本
 * @param {string} code
 * @param {Function} [tFn]
 * @returns {string}
 */
export function getRuleErrorMessage(code, tFn) {
  if (typeof tFn === 'function') {
    const key = RULE_ERROR_I18N_KEYS[code];
    if (key) {
      const translated = tFn(key);
      if (translated && translated !== key) return translated;
    }
  }
  return DEFAULT_ERROR_MESSAGES[code] || '无效的规则表达式';
}

/**
 * 规则表达式输入智能预清洗
 * 1. 剔除 ASCII 控制字符 (\x00-\x1F\x7F)
 * 2. 剥离首尾多余空白字符
 * 3. 智能压缩多余的连续通配符 (*** -> *)，防止 NFA 正则回溯爆炸
 * @param {string} rawPattern
 * @returns {string}
 */
export function sanitizeRulePattern(rawPattern) {
  if (typeof rawPattern !== 'string') return '';
  return rawPattern
    .replace(/[\x00-\x1F\x7F]/g, '')
    .trim()
    .replace(/\*{2,}/g, '*');
}

/**
 * 校验规则表达式的合法性与边界安全
 * @param {string} pattern
 * @param {'domain'|'path'|'keyword'} [type]
 * @param {{ t?: Function }} [options]
 * @returns {{ valid: boolean, pattern?: string, code?: string, message?: string }}
 */
export function validateRulePattern(pattern, type, options = {}) {
  const sanitized = sanitizeRulePattern(pattern);
  const tFn = options.t;

  if (!sanitized) {
    return {
      valid: false,
      code: RULE_ERROR_CODES.EMPTY,
      message: getRuleErrorMessage(RULE_ERROR_CODES.EMPTY, tFn)
    };
  }

  if (sanitized.length > MAX_RULE_LENGTH) {
    return {
      valid: false,
      code: RULE_ERROR_CODES.TOO_LONG,
      message: getRuleErrorMessage(RULE_ERROR_CODES.TOO_LONG, tFn)
    };
  }

  const wildcardsCount = (sanitized.match(/\*/g) || []).length;
  if (wildcardsCount > MAX_WILDCARDS_PER_RULE) {
    return {
      valid: false,
      code: RULE_ERROR_CODES.TOO_MANY_WILDCARDS,
      message: getRuleErrorMessage(RULE_ERROR_CODES.TOO_MANY_WILDCARDS, tFn)
    };
  }

  // 严防“无差别抹杀全历史”的纯通配符模式 (如 *, *.*, */*, https://*, kw:*, domain:*)
  let core = sanitized;
  core = core.replace(/^(?:keyword|kw|domain|path):\s*/i, '');
  core = core.replace(/^(?:https?:)?\/\//i, '');
  const stripped = core.replace(/[*.\s/\\:?#&=-]/g, '');
  if (stripped.length === 0) {
    return {
      valid: false,
      code: RULE_ERROR_CODES.WILDCARD_OVERMATCH,
      message: getRuleErrorMessage(RULE_ERROR_CODES.WILDCARD_OVERMATCH, tFn)
    };
  }

  return {
    valid: true,
    pattern: sanitized
  };
}

/**
 * 断言规则表达式有效，若非法则直接抛出带有 code 的 Error，若有效返回预清洗后的 pattern
 * @param {string} pattern
 * @param {'domain'|'path'|'keyword'} [type]
 * @param {{ t?: Function }} [options]
 * @returns {string}
 */
export function assertValidRulePattern(pattern, type, options = {}) {
  const result = validateRulePattern(pattern, type, options);
  if (!result.valid) {
    const err = new Error(result.message);
    err.code = result.code;
    throw err;
  }
  return result.pattern;
}

/**
 * 逃逸正则特殊字符，保留通配符 *
 * @param {string} str
 * @returns {string}
 */
function escapeRegexExceptWildcard(str) {
  return str.replace(/\*{2,}/g, '*').replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
}

/**
 * 自动检测规则表达式类型
 * @param {string} pattern
 * @returns {'domain'|'path'|'keyword'}
 */
export function detectRuleType(pattern) {
  let cleaned = (pattern || '').trim().replace(/^(?:https?:)?\/\//i, '');
  if (/^(?:keyword|kw):\s*/i.test(cleaned)) return 'keyword';
  if (/^path:\s*/i.test(cleaned)) return 'path';
  if (/^domain:\s*/i.test(cleaned)) return 'domain';

  // 根路径容错：剥离尾随斜杠 (如 "www.google.com/" 或 "https://www.google.com/")
  cleaned = cleaned.replace(/\/+$/, '');

  if (cleaned.includes('/')) return 'path';

  const hostPart = cleaned.split(':')[0];
  if (
    cleaned.includes('.') ||
    cleaned.startsWith('*') ||
    hostPart === 'localhost' ||
    /^(\d{1,3}\.){3}\d{1,3}$/.test(hostPart) ||
    hostPart.startsWith('[')
  ) {
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
  domain = domain.replace(/^(?:https?:)?\/\//i, '').split('/')[0];
  // 移除开头的通配符与点号 (*. / * / **..)
  domain = domain.replace(/^[*.]+/g, '');

  const escapedDomain = domain.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  // 匹配: exact host 或 以 .domain 结尾的主机名
  // 支持: user:pass@ 身份认证前缀、下划线及横杠子域名、端口号、各种查询及哈希边界
  return new RegExp(`^(?:https?:\\/\\/)?(?:[^/@:\\s]+(?::[^/@:\\s]*)?@)?(?:[a-zA-Z0-9_-]+\\.)*${escapedDomain}(?::\\d+)?(?:[\\/?#].*)?$`, 'i');
}

/**
 * 将路径规则转换为规范的 RegExp 匹配对象
 * 支持: www.aaa.com/aa/bb/* 或 www.aaa.com/aa/bb/cc.html
 * @param {string} pattern
 * @returns {RegExp}
 */
export function pathRuleToRegex(pattern) {
  let cleaned = (pattern || '').trim();
  // 移除开头可能包含的协议 (包括协议自适应 //)
  cleaned = cleaned.replace(/^(?:https?:)?\/\//i, '');

  const regexStr = escapeRegexExceptWildcard(cleaned);
  // 允许匹配 http:// 或 https://，支持 userinfo，且在无通配符结尾时匹配 query 与 hash 边界
  if (cleaned.endsWith('*')) {
    return new RegExp(`^(?:https?:\\/\\/)?(?:[^/@:\\s]+(?::[^/@:\\s]*)?@)?${regexStr}`, 'i');
  }
  // 精确路径匹配：允许 URL 自适应尾随斜杠 (如 example.com/login 与 example.com/login/ 均能无缝命中)
  const baseRegex = regexStr.replace(/\/+$/, '');
  return new RegExp(`^(?:https?:\\/\\/)?(?:[^/@:\\s]+(?::[^/@:\\s]*)?@)?${baseRegex}(?:\\/?(?:[?#].*)?)?$`, 'i');
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
          const decodedComponent = decodeURIComponent(urlString);
          if (decodedComponent !== urlString && regex.test(decodedComponent)) return true;
        } catch {}
        try {
          const decodedUri = decodeURI(urlString);
          if (decodedUri !== urlString && regex.test(decodedUri)) return true;
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
  let d = raw.trim().toLowerCase().replace(/^(?:https?:)?\/\//i, '').split('/')[0];
  if (d.includes('@')) d = d.split('@').pop();
  d = d.split(':')[0];
  d = d.replace(/^[*.]+/g, '');
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
      const cleanCand = candRule.replace(/^https?:\/\//i, '');
      const cleanR = rPattern.replace(/^https?:\/\//i, '');
      if ((r.type || 'domain') === candType && (candRule === rPattern || cleanCand === cleanR)) {
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
        const rPattern = (r.pattern || '').trim().toLowerCase().replace(/^https?:\/\//i, '');
        const cleanCand = candRule.replace(/^https?:\/\//i, '');
        if (rPattern.endsWith('*')) {
          const prefix = rPattern.slice(0, -1);
          if (cleanCand !== rPattern && cleanCand.startsWith(prefix)) {
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

