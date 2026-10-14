/**
 * @file urlParser.js
 * @description URL 层级自动拆解算法
 * 支持识别多级 TLD，自动生成按域名层级与按路径层级的候选规则列表
 */

// 常见双段/多级公用顶级域名 (Public Suffix) 列表
const MULTI_LEVEL_TLDS = new Set([
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn',
  'co.uk', 'org.uk', 'me.uk', 'ac.uk', 'gov.uk', 'ltd.uk', 'plc.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp',
  'com.hk', 'org.hk', 'gov.hk', 'edu.hk', 'net.hk',
  'com.tw', 'org.tw', 'gov.tw', 'edu.tw', 'net.tw',
  'com.sg', 'org.sg', 'edu.sg', 'gov.sg',
  'co.nz', 'net.nz', 'org.nz',
  'co.kr', 'ne.kr', 'or.kr', 're.kr',
  'co.in', 'net.in', 'org.in', 'gen.in',
  'com.br', 'net.br', 'org.br',
  'com.mx', 'org.mx',
  'com.my', 'org.my'
]);

/**
 * 判断是否为有效的 HTTP/HTTPS URL
 * @param {string} urlString
 * @returns {boolean}
 */
export function isHttpUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') return false;
  try {
    const parsed = new URL(urlString);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * 解析主机名，拆分出根域名、子域名与顶级后缀
 * @param {string} hostname
 * @returns {{ rootDomain: string, subdomains: string[], suffix: string, hostname: string, isIp: boolean }}
 */
export function parseDomainInfo(hostname) {
  const host = (hostname || '').toLowerCase().trim();

  // 处理 IP 地址或 localhost
  const isIpv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(host);
  const isIpv6 = host.startsWith('[') || host.includes(':');
  const isLocal = host === 'localhost';

  if (isIpv4 || isIpv6 || isLocal) {
    return {
      hostname: host,
      rootDomain: host,
      subdomains: [],
      suffix: '',
      isIp: true
    };
  }

  const parts = host.split('.');
  if (parts.length <= 1) {
    return {
      hostname: host,
      rootDomain: host,
      subdomains: [],
      suffix: '',
      isIp: false
    };
  }

  // 检测多级公用后缀 (如 .com.cn, .co.uk)
  let suffix = '';
  let rootDomain = host;
  let subdomains = [];

  if (parts.length >= 3) {
    const lastTwo = parts.slice(-2).join('.');
    if (MULTI_LEVEL_TLDS.has(lastTwo)) {
      suffix = lastTwo;
      rootDomain = parts.slice(-3).join('.');
      subdomains = parts.slice(0, -3);
      return { hostname: host, rootDomain, subdomains, suffix, isIp: false };
    }
  }

  // 单级顶级后缀 (如 .com, .org, .net, .io)
  suffix = parts[parts.length - 1];
  rootDomain = parts.slice(-2).join('.');
  subdomains = parts.slice(0, -2);

  return {
    hostname: host,
    rootDomain,
    subdomains,
    suffix,
    isIp: false
  };
}

/**
 * 根据 URL 拆解出域名层级规则候选列表
 * 规则 1: 当前完整域名 (如 m.gemini.google.com)
 * 规则 2: 二级子域通配 (如 *.gemini.google.com，当域名段 >= 3 时)
 * 规则 3: 根域名全站通配 (如 *.google.com)
 * @param {string} urlString
 * @returns {Array<{ rule: string, type: 'domain', label: string, description: string }>}
 */
export function getDomainRules(urlString) {
  if (!isHttpUrl(urlString)) return [];

  const url = new URL(urlString);
  const host = url.hostname.toLowerCase();
  const info = parseDomainInfo(host);
  const rules = [];
  const added = new Set();

  const addRule = (rule, label, description) => {
    if (!added.has(rule)) {
      added.add(rule);
      rules.push({ rule, type: 'domain', label, description });
    }
  };

  // 1. 当前完整域名
  addRule(host, '当前完整域名', `仅匹配该完整域名 (${host})`);

  if (!info.isIp) {
    // 2. 如果存在两级或以上子域名 (如 m.gemini.google.com)，生成二级子域通配 (*.gemini.google.com)
    if (info.subdomains.length >= 2) {
      const secondLevelHost = [...info.subdomains.slice(1), info.rootDomain].join('.');
      addRule(`*.${secondLevelHost}`, '二级子域通配', `匹配 ${secondLevelHost} 及其所有子域名`);
    }

    // 3. 根域名全站通配 (*.rootDomain)
    if (host !== `*.${info.rootDomain}`) {
      addRule(`*.${info.rootDomain}`, '根域名全站通配', `匹配 ${info.rootDomain} 及其全站所有子域`);
    }
  }

  return rules;
}

/**
 * 根据 URL 拆解出路径层级规则候选列表
 * 规则 1: 精确 URL 路径 (如 www.aaa.com/aa/bb/cc.html)
 * 规则 2: 当前目录通配 (如 www.aaa.com/aa/bb/*)
 * 规则 3: 上级目录通配 (如 www.aaa.com/aa/*)
 * 规则 4: 全站路径通配 (如 www.aaa.com/*)
 * @param {string} urlString
 * @returns {Array<{ rule: string, type: 'path', label: string, description: string }>}
 */
export function getPathRules(urlString) {
  if (!isHttpUrl(urlString)) return [];

  const url = new URL(urlString);
  const host = url.hostname.toLowerCase();
  const pathname = url.pathname;
  const rules = [];
  const added = new Set();

  const addRule = (rule, label, description) => {
    if (!added.has(rule)) {
      added.add(rule);
      rules.push({ rule, type: 'path', label, description });
    }
  };

  // 1. 精确 URL 路径 (包含文件名或页面，不包含 query/hash)
  if (pathname && pathname !== '/') {
    const exactPath = `${host}${pathname}`;
    addRule(exactPath, '精确 URL 路径', '仅匹配该完整页面路径');
  }

  // 拆解路径段
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length >= 2) {
    // 2. 当前目录通配 (如 /aa/bb/*)
    const currentDirPath = `/${segments.slice(0, -1).join('/')}/*`;
    addRule(`${host}${currentDirPath}`, '当前目录通配', `匹配当前所在目录及下级所有页面`);

    // 3. 上级目录逐层通配 (如 /aa/*)
    for (let i = segments.length - 2; i >= 1; i--) {
      const parentDirPath = `/${segments.slice(0, i).join('/')}/*`;
      addRule(`${host}${parentDirPath}`, '上级目录通配', `匹配上级目录 ${segments.slice(0, i).join('/')} 下所有页面`);
    }
  }

  // 4. 全站路径通配
  addRule(`${host}/*`, '全站路径通配', `匹配 ${host} 域名下的所有页面路径`);

  return rules;
}

/**
 * 解析 URL 并返回完整拆解报告
 * @param {string} urlString
 * @returns {Object}
 */
export function parseUrl(urlString) {
  if (!isHttpUrl(urlString)) {
    return {
      isValid: false,
      reason: '当前页面为浏览器系统内置或不支持的协议页面',
      url: urlString || '',
      hostname: '',
      domainRules: [],
      pathRules: []
    };
  }

  const url = new URL(urlString);
  return {
    isValid: true,
    url: urlString,
    hostname: url.hostname.toLowerCase(),
    pathname: url.pathname,
    domainRules: getDomainRules(urlString),
    pathRules: getPathRules(urlString)
  };
}
