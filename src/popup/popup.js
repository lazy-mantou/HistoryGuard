/**
 * @file popup.js
 * @description Popup 弹窗交互控制逻辑
 * 面向统一抽象接口 browserApi 与 core 业务逻辑实现零输入快速规则隐藏与清理
 */

import { browserApi } from '../adapters/index.js';
import { parseUrl } from '../core/urlParser.js';
import { filterHistoryByRule, findMatchingRule } from '../core/ruleMatcher.js';
import {
  getRules,
  addRule,
  getSilentMode,
  setSilentMode,
  clearSilentMode
} from '../core/storage.js';

// DOM 元素引用
const elements = {
  btnSilentMode: document.getElementById('btn-silent-mode'),
  silentText: document.getElementById('silent-text'),
  btnOpenOptions: document.getElementById('btn-open-options'),
  tabStatusBadge: document.getElementById('tab-status-badge'),
  tabUrlText: document.getElementById('tab-url-text'),
  internalPageTip: document.getElementById('internal-page-tip'),
  mainContent: document.getElementById('main-content'),
  domainCapsulesGroup: document.getElementById('domain-capsules-group'),
  pathCapsulesGroup: document.getElementById('path-capsules-group'),
  cbRetroactive: document.getElementById('cb-retroactive'),
  retroactiveLabelText: document.getElementById('retroactive-label-text'),
  btnHideAndClean: document.getElementById('btn-hide-and-clean'),
  btnHideText: document.getElementById('btn-hide-text'),
  btnCleanOnly: document.getElementById('btn-clean-only'),
  btnCleanText: document.getElementById('btn-clean-text'),
  footerLink: document.getElementById('btn-footer-link'),
  footerLinkText: document.getElementById('footer-link-text'),
  toast: document.getElementById('toast')
};

// 状态管理
let currentTab = null;
let parsedUrlInfo = null;
let allCandidateRules = [];
let selectedRule = null;
let cachedHistoryItems = [];
let silentCountdownTimer = null;
let toastDismissTimer = null;

/**
 * 显示临时浮层提示 Toast
 * @param {string} message
 * @param {number} [duration=2500]
 */
function showToast(message, duration = 2500) {
  if (toastDismissTimer) {
    clearTimeout(toastDismissTimer);
    toastDismissTimer = null;
  }
  elements.toast.textContent = message;
  elements.toast.classList.remove('hidden');
  toastDismissTimer = setTimeout(() => {
    elements.toast.classList.add('hidden');
    toastDismissTimer = null;
  }, duration);
}

/**
 * 格式化倒计时毫秒数 (分:秒)
 * @param {number} ms
 * @returns {string}
 */
function formatRemainingTime(ms) {
  if (ms <= 0) return '00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * 初始化并刷新静默免记录按钮状态
 */
async function updateSilentModeState() {
  if (silentCountdownTimer) {
    clearInterval(silentCountdownTimer);
    silentCountdownTimer = null;
  }

  const silent = await getSilentMode();
  if (silent.active && silent.remainingMs > 0) {
    elements.btnSilentMode.classList.add('active');
    elements.silentText.textContent = `${formatRemainingTime(silent.remainingMs)} 暂停中`;

    silentCountdownTimer = setInterval(async () => {
      const current = await getSilentMode();
      if (current.active && current.remainingMs > 0) {
        elements.silentText.textContent = `${formatRemainingTime(current.remainingMs)} 暂停中`;
      } else {
        clearInterval(silentCountdownTimer);
        silentCountdownTimer = null;
        elements.btnSilentMode.classList.remove('active');
        elements.silentText.textContent = '暂停记录 30m';
      }
    }, 1000);
  } else {
    elements.btnSilentMode.classList.remove('active');
    elements.silentText.textContent = '暂停记录 30m';
  }
}

/**
 * 更新选中胶囊所联动的复选框与按钮文字
 */
function updateActionButtons() {
  if (!selectedRule) return;

  const count = selectedRule.count || 0;
  elements.retroactiveLabelText.textContent = `加入隐藏规则的同时，清理已有的 ${count} 条历史记录`;
  elements.btnHideText.textContent = `隐藏并清理 (${selectedRule.rule})`;
  elements.btnCleanText.textContent = `仅删 ${count} 条`;

  // 若匹配数量为 0，允许点击以清理当前已在历史中的本页或提示
  elements.btnCleanOnly.disabled = false;
  elements.btnCleanOnly.style.opacity = (count === 0) ? '0.75' : '1';
}

/**
 * 选中某条候选规则胶囊
 * @param {Object} candidate
 */
function selectRuleCapsule(candidate) {
  if (!candidate) return;
  selectedRule = candidate;

  // 移除所有已选中的高亮样式
  document.querySelectorAll('.rule-capsule').forEach(el => {
    el.classList.remove('selected');
  });

  // 添加当前选中的高亮
  const escapedRule = (candidate.rule || '').replace(/["\\]/g, '\\$&');
  const activeEl = document.querySelector(`.rule-capsule[data-rule="${escapedRule}"]`);
  if (activeEl) {
    activeEl.classList.add('selected');
  }

  updateActionButtons();
}

/**
 * 渲染胶囊列表 DOM
 * @param {HTMLElement} container
 * @param {Array<Object>} candidates
 */
function renderCapsuleGroup(container, candidates) {
  container.innerHTML = '';
  if (!candidates || candidates.length === 0) {
    const emptyEl = document.createElement('div');
    emptyEl.className = 'capsule-sub';
    emptyEl.style.padding = '4px';
    emptyEl.textContent = '暂无候选规则';
    container.appendChild(emptyEl);
    return;
  }

  candidates.forEach(cand => {
    const capsuleEl = document.createElement('div');
    capsuleEl.className = `rule-capsule ${selectedRule?.rule === cand.rule ? 'selected' : ''}`;
    capsuleEl.dataset.rule = cand.rule;

    capsuleEl.innerHTML = `
      <div class="capsule-main">
        <span class="capsule-pattern" title="${cand.rule}">${cand.rule}</span>
        <span class="capsule-sub">
          <span>${cand.label}</span>
          <span>·</span>
          <span>${cand.description}</span>
        </span>
      </div>
      <div class="capsule-count" title="匹配到 ${cand.count || 0} 条已有历史">${cand.count || 0} 条</div>
    `;

    capsuleEl.addEventListener('click', () => {
      selectRuleCapsule(cand);
    });

    container.appendChild(capsuleEl);
  });
}

/**
 * 刷新当前页面的规则命中状态与历史条目数统计
 */
async function refreshPageData() {
  if (!parsedUrlInfo || !parsedUrlInfo.isValid) return;

  // 1. 查询该域名相关的历史记录 (最多拉取 1000 条供实时匹配计数)
  try {
    cachedHistoryItems = await browserApi.history.search({
      text: parsedUrlInfo.hostname,
      startTime: 0,
      maxResults: 1000
    });
  } catch (err) {
    console.warn('History search notice:', err);
    cachedHistoryItems = [];
  }

  // 2. 为每个规则统计匹配历史条目数
  allCandidateRules = [...parsedUrlInfo.domainRules, ...parsedUrlInfo.pathRules];
  allCandidateRules.forEach(cand => {
    const matchedItems = filterHistoryByRule(cand.rule, cachedHistoryItems);
    cand.count = matchedItems.length;
    cand.matchingHistory = matchedItems;
  });

  // 3. 检查当前 URL 是否已命中现有启用规则
  const existingRules = await getRules();
  const { matched, rule } = findMatchingRule(existingRules, currentTab.url);

  if (matched && rule) {
    elements.tabStatusBadge.className = 'badge badge-matched';
    elements.tabStatusBadge.textContent = `⚡ 已命中隐藏规则 (${rule.pattern})`;
  } else {
    elements.tabStatusBadge.className = 'badge badge-normal';
    elements.tabStatusBadge.textContent = '● 未隐藏';
  }

  // 4. 更新底部总规则数
  elements.footerLinkText.textContent = `🔍 按搜索结果批量删除历史 / 管理规则 (${existingRules.length})`;

  // 5. 渲染胶囊组
  renderCapsuleGroup(elements.domainCapsulesGroup, parsedUrlInfo.domainRules);
  renderCapsuleGroup(elements.pathCapsulesGroup, parsedUrlInfo.pathRules);

  // 6. 默认选中第一条规则
  if (!selectedRule && parsedUrlInfo.domainRules.length > 0) {
    selectRuleCapsule(parsedUrlInfo.domainRules[0]);
  } else if (!selectedRule && parsedUrlInfo.pathRules.length > 0) {
    selectRuleCapsule(parsedUrlInfo.pathRules[0]);
  } else if (selectedRule) {
    // 重新校准当前选中的 candidate 对象数据
    const refreshed = allCandidateRules.find(r => r.rule === selectedRule.rule);
    if (refreshed) {
      selectedRule = refreshed;
    }
    updateActionButtons();
  }
}

/**
 * 初始化 Popup 页面
 */
async function initPopup() {
  // 1. 获取当前活动标签页
  try {
    currentTab = await browserApi.tabs.getCurrentActiveTab();
  } catch (err) {
    console.error('Failed to get active tab:', err);
  }

  if (!currentTab || !currentTab.url) {
    elements.tabUrlText.textContent = '无法获取当前页面信息 (请在常规网页标签页中打开)';
    elements.tabStatusBadge.className = 'badge badge-internal';
    elements.tabStatusBadge.textContent = '● 无法获取';
    await updateSilentModeState();
    const existingRules = await getRules();
    elements.footerLinkText.textContent = `🔍 按搜索结果批量删除历史 / 管理规则 (${existingRules.length})`;
    return;
  }

  elements.tabUrlText.textContent = currentTab.url;
  elements.tabUrlText.title = currentTab.url;

  // 2. 解析 URL
  parsedUrlInfo = parseUrl(currentTab.url);

  if (!parsedUrlInfo.isValid) {
    elements.tabStatusBadge.className = 'badge badge-internal';
    elements.tabStatusBadge.textContent = '⚠️ 内部页面';
    elements.internalPageTip.classList.remove('hidden');
    elements.mainContent.classList.add('hidden');
    await updateSilentModeState();
    const existingRules = await getRules();
    elements.footerLinkText.textContent = `🔍 按搜索结果批量删除历史 / 管理规则 (${existingRules.length})`;
    return;
  }

  // 3. 正常页面：加载数据与规则
  await updateSilentModeState();
  await refreshPageData();
}

// 事件绑定
// A. 静默免记录模式切换按钮
elements.btnSilentMode.addEventListener('click', async () => {
  const silent = await getSilentMode();
  if (silent.active) {
    await clearSilentMode();
    showToast('已退出静默模式，恢复正常记录');
  } else {
    await setSilentMode(30);
    showToast('已开启静默免记录模式 (30分钟)');
  }
  await updateSilentModeState();
});

// B. 打开设置页齿轮与底部入口
const openOptions = () => {
  browserApi.runtime.openOptionsPage();
  window.close();
};
elements.btnOpenOptions.addEventListener('click', openOptions);
elements.footerLink.addEventListener('click', openOptions);

// C. 主按钮：隐藏并清理 (当前选中规则)
elements.btnHideAndClean.addEventListener('click', async () => {
  // 兜底：若未显式选择，自动回退到第一个候选规则
  if (!selectedRule && parsedUrlInfo?.domainRules?.length > 0) {
    selectRuleCapsule(parsedUrlInfo.domainRules[0]);
  } else if (!selectedRule && parsedUrlInfo?.pathRules?.length > 0) {
    selectRuleCapsule(parsedUrlInfo.pathRules[0]);
  }

  if (!selectedRule) {
    showToast('请先选择一条要隐藏的候选规则');
    return;
  }

  const originalText = elements.btnHideText.textContent;

  try {
    elements.btnHideAndClean.disabled = true;
    elements.btnHideAndClean.style.opacity = '0.7';
    elements.btnHideText.textContent = '正在处理...';

    // 1. 添加隐藏规则到存储
    const { rule, isNew } = await addRule({
      pattern: selectedRule.rule,
      type: selectedRule.type,
      enabled: true
    });

    let deletedCount = 0;
    // 2. 若勾选了回溯清理，批量删除已有历史
    if (elements.cbRetroactive.checked) {
      const itemsToDelete = (selectedRule.matchingHistory && selectedRule.matchingHistory.length > 0)
        ? selectedRule.matchingHistory
        : (currentTab?.url ? [{ url: currentTab.url }] : []);

      for (const item of itemsToDelete) {
        if (item && item.url) {
          try {
            await browserApi.history.deleteUrl(item.url);
            deletedCount++;
          } catch (e) {
            console.error('Delete item failed:', item.url, e);
          }
        }
      }
    }

    elements.btnHideText.textContent = `✓ 已${isNew ? '添加' : '更新'}并清理`;
    showToast(`已${isNew ? '添加' : '更新'}规则并清理 ${deletedCount} 条历史记录`);

    // 3. 刷新数据
    await refreshPageData();
  } catch (err) {
    console.error('Hide and clean error:', err);
    elements.btnHideText.textContent = originalText;
    showToast(`操作失败: ${err.message}`);
  } finally {
    setTimeout(() => {
      elements.btnHideAndClean.disabled = false;
      elements.btnHideAndClean.style.opacity = '1';
      updateActionButtons();
    }, 1200);
  }
});

// D. 副按钮：仅删 X 条历史记录
elements.btnCleanOnly.addEventListener('click', async () => {
  if (!selectedRule && parsedUrlInfo?.domainRules?.length > 0) {
    selectRuleCapsule(parsedUrlInfo.domainRules[0]);
  }

  if (!selectedRule) {
    showToast('请先选择要清理的历史规则');
    return;
  }

  const itemsToDelete = (selectedRule.matchingHistory && selectedRule.matchingHistory.length > 0)
    ? selectedRule.matchingHistory
    : (currentTab?.url ? [{ url: currentTab.url }] : []);

  if (itemsToDelete.length === 0) {
    showToast('暂无匹配的历史记录可清理');
    return;
  }

  try {
    elements.btnCleanOnly.disabled = true;
    elements.btnCleanOnly.style.opacity = '0.7';

    let deletedCount = 0;
    for (const item of itemsToDelete) {
      if (item && item.url) {
        try {
          await browserApi.history.deleteUrl(item.url);
          deletedCount++;
        } catch (e) {
          console.error('Delete item failed:', item.url, e);
        }
      }
    }

    showToast(`成功物理删除 ${deletedCount} 条历史记录`);
    await refreshPageData();
  } catch (err) {
    console.error('Clean only error:', err);
    showToast(`清理失败: ${err.message}`);
  } finally {
    elements.btnCleanOnly.disabled = false;
    elements.btnCleanOnly.style.opacity = '1';
  }
});

// DOM 启动加载
document.addEventListener('DOMContentLoaded', initPopup);
