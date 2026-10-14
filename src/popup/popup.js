/**
 * @file popup.js
 * @description Popup 弹窗交互控制逻辑
 * 面向统一抽象接口 browserApi 与 core 业务逻辑实现零输入快速规则隐藏与清理
 */

import { browserApi } from '../adapters/index.js';
import { parseUrl } from '../core/urlParser.js';
import { filterHistoryByRule, findMatchingRule, computeCandidateStatus, normalizeDomain } from '../core/ruleMatcher.js';
import { t, initI18n, localizeCapsule } from '../core/i18n.js';
import { initTheme } from '../core/theme.js';
import {
  getRules,
  addRule,
  getSilentMode,
  setSilentMode,
  clearSilentMode,
  getSettings
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
    elements.silentText.textContent = t('popup.silentBtnActive', { time: formatRemainingTime(silent.remainingMs) });

    silentCountdownTimer = setInterval(async () => {
      const current = await getSilentMode();
      if (current.active && current.remainingMs > 0) {
        elements.silentText.textContent = t('popup.silentBtnActive', { time: formatRemainingTime(current.remainingMs) });
      } else {
        clearInterval(silentCountdownTimer);
        silentCountdownTimer = null;
        elements.btnSilentMode.classList.remove('active');
        elements.silentText.textContent = t('popup.silentBtn');
      }
    }, 1000);
  } else {
    elements.btnSilentMode.classList.remove('active');
    elements.silentText.textContent = t('popup.silentBtn');
  }
}


/**
 * 更新选中胶囊所联动的复选框与按钮文字及禁用态
 */
function updateActionButtons() {
  if (!selectedRule) {
    elements.btnHideAndClean.disabled = true;
    elements.btnCleanOnly.disabled = true;
    return;
  }

  const count = selectedRule.count || 0;

  // 副按钮：仅删 X 条 (为 0 条时 disabled，且 hover 不高亮)
  elements.btnCleanText.textContent = t('popup.cleanOnly', { count });
  elements.btnCleanOnly.disabled = (count === 0);

  // 主按钮：隐藏并清理 (若已在规则列表中或已被上级规则覆盖，则 disabled)
  if (selectedRule.isExactMatch) {
    elements.btnHideAndClean.disabled = true;
    elements.btnHideText.textContent = t('popup.alreadyHidden');
    elements.btnHideAndClean.title = t('popup.badgeInList');
  } else if (selectedRule.isCovered) {
    elements.btnHideAndClean.disabled = true;
    elements.btnHideText.textContent = t('popup.coveredByParent');
    elements.btnHideAndClean.title = t('popup.badgeCoveredDetail', { rule: selectedRule.coveringRule?.pattern || '' });
  } else {
    elements.btnHideAndClean.disabled = false;
    elements.btnHideText.textContent = t('popup.hideAndClean');
    elements.btnHideAndClean.title = t('popup.hideAndCleanWithRule', { rule: selectedRule.rule });
  }

  elements.retroactiveLabelText.textContent = t('popup.retroactiveLabel', { count });
}

/**
 * 选中某条候选规则胶囊 (被上级覆盖变灰的规则禁止选中)
 * @param {Object} candidate
 */
function selectRuleCapsule(candidate) {
  if (!candidate) return;
  // 若已被父级域名覆盖，严禁选中
  if (candidate.isCovered) return;

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
    emptyEl.textContent = t('popup.emptyCandidates');
    container.appendChild(emptyEl);
    return;
  }

  candidates.forEach(cand => {
    const capsuleEl = document.createElement('div');
    const isSelected = selectedRule?.rule === cand.rule;

    const stateClasses = [];
    if (isSelected && !cand.isCovered) stateClasses.push('selected');
    if (cand.isCovered) stateClasses.push('covered', 'disabled');
    else if (cand.isExactMatch) stateClasses.push('in-list');

    capsuleEl.className = `rule-capsule ${stateClasses.join(' ')}`;
    capsuleEl.dataset.rule = cand.rule;

    const { label, description } = localizeCapsule(cand);
    const count = cand.count || 0;
    const matchesTitle = t('popup.matchesCount', { count });
    const countText = t('popup.itemsCount', { count });

    let statusTagHtml = '';
    if (cand.isCovered) {
      const coverHint = t('popup.badgeCoveredDetail', { rule: cand.coveringRule?.pattern || '' });
      statusTagHtml = `<div class="capsule-status-tag tag-covered" title="${coverHint}">${t('popup.badgeCovered')}</div>`;
      capsuleEl.title = coverHint;
    } else if (cand.isExactMatch) {
      statusTagHtml = `<div class="capsule-status-tag tag-in-list" title="${matchesTitle}">${t('popup.badgeInList')}</div>`;
    } else {
      statusTagHtml = `<div class="capsule-count" title="${matchesTitle}">${countText}</div>`;
    }

    capsuleEl.innerHTML = `
      <div class="capsule-main">
        <span class="capsule-pattern" title="${cand.rule}">${cand.rule}</span>
        <span class="capsule-sub">
          <span>${label}</span>
          <span>·</span>
          <span>${cand.isCovered ? (cand.coveringRule ? t('popup.badgeCoveredDetail', { rule: cand.coveringRule.pattern }) : t('popup.coveredByParent')) : description}</span>
        </span>
      </div>
      ${statusTagHtml}
    `;

    capsuleEl.addEventListener('click', () => {
      // 若已被上级规则覆盖，变灰且不能选中
      if (cand.isCovered) return;
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

  // 2. 获取现有启用规则，并计算各候选规则的状态 (已在列表中 / 已由上级覆盖)
  const existingRules = await getRules();
  allCandidateRules = [...parsedUrlInfo.domainRules, ...parsedUrlInfo.pathRules];
  allCandidateRules.forEach(cand => {
    const matchedItems = filterHistoryByRule(cand.rule, cachedHistoryItems);
    cand.count = matchedItems.length;
    cand.matchingHistory = matchedItems;

    const status = computeCandidateStatus(cand, existingRules);
    cand.isExactMatch = status.isExactMatch;
    cand.isCovered = status.isCovered;
    cand.coveringRule = status.coveringRule;
    cand.exactRule = status.exactRule;
  });

  // 3. 检查当前 URL 是否已命中现有启用规则
  const { matched, rule } = findMatchingRule(existingRules, currentTab.url);

  if (matched && rule) {
    elements.tabStatusBadge.className = 'badge badge-matched';
    elements.tabStatusBadge.textContent = t('popup.statusMatched', { pattern: rule.pattern });
  } else {
    elements.tabStatusBadge.className = 'badge badge-normal';
    elements.tabStatusBadge.textContent = t('popup.statusNormal');
  }

  // 4. 智能推荐选中的候选规则：优先选择未在列表且未被覆盖的规则
  const findBestCandidate = () => {
    const available = allCandidateRules.find(c => !c.isExactMatch && !c.isCovered);
    if (available) return available;
    const exact = allCandidateRules.find(c => c.isExactMatch);
    if (exact) return exact;
    return allCandidateRules.find(c => !c.isCovered) || null;
  };

  if (!selectedRule || selectedRule.isCovered) {
    selectedRule = findBestCandidate();
  } else {
    const refreshed = allCandidateRules.find(r => r.rule === selectedRule.rule);
    if (refreshed) {
      selectedRule = refreshed.isCovered ? findBestCandidate() : refreshed;
    }
  }

  // 5. 渲染胶囊组
  renderCapsuleGroup(elements.domainCapsulesGroup, parsedUrlInfo.domainRules);
  renderCapsuleGroup(elements.pathCapsulesGroup, parsedUrlInfo.pathRules);

  if (selectedRule && !selectedRule.isCovered) {
    selectRuleCapsule(selectedRule);
  } else {
    selectedRule = null;
    updateActionButtons();
  }
}

/**
 * 初始化 Popup 页面
 */
async function initPopup() {
  // 1. 加载偏好设置并初始化 i18n 与外观主题
  try {
    const settings = await getSettings();
    initI18n(settings.language || 'auto');
    initTheme(settings.theme || 'auto');
  } catch (err) {
    console.warn('Failed to load settings:', err);
    initI18n('auto');
    initTheme('auto');
  }

  // 2. 获取当前活动标签页
  try {
    currentTab = await browserApi.tabs.getCurrentActiveTab();
  } catch (err) {
    console.error('Failed to get active tab:', err);
  }

  if (!currentTab || !currentTab.url) {
    elements.tabUrlText.textContent = t('popup.cannotGetPageInfo');
    elements.tabStatusBadge.className = 'badge badge-internal';
    elements.tabStatusBadge.textContent = t('popup.statusUnavailable');
    await updateSilentModeState();
    return;
  }

  elements.tabUrlText.textContent = currentTab.url;
  elements.tabUrlText.title = currentTab.url;

  // 3. 解析 URL
  parsedUrlInfo = parseUrl(currentTab.url);

  if (!parsedUrlInfo.isValid) {
    elements.tabStatusBadge.className = 'badge badge-internal';
    elements.tabStatusBadge.textContent = t('popup.statusInternal');
    elements.internalPageTip.classList.remove('hidden');
    elements.mainContent.classList.add('hidden');
    await updateSilentModeState();
    return;
  }

  // 4. 正常页面：加载数据与规则
  await updateSilentModeState();
  await refreshPageData();
}

// 事件绑定
// A. 静默免记录模式切换按钮
elements.btnSilentMode.addEventListener('click', async () => {
  const silent = await getSilentMode();
  if (silent.active) {
    await clearSilentMode();
    showToast(t('popup.toastSilentExit'));
  } else {
    const settings = await getSettings();
    const duration = settings.silentModeDuration || 30;
    await setSilentMode(duration);
    showToast(t('popup.toastSilentEnter', { duration }));
  }
  await updateSilentModeState();
});

// B. 打开设置页齿轮入口
const openOptions = () => {
  browserApi.runtime.openOptionsPage();
  window.close();
};
elements.btnOpenOptions.addEventListener('click', openOptions);

// C. 主按钮：隐藏并清理 (当前选中规则)
elements.btnHideAndClean.addEventListener('click', async () => {
  // 兜底：若未显式选择，自动回退到第一个候选规则
  if (!selectedRule && parsedUrlInfo?.domainRules?.length > 0) {
    selectRuleCapsule(parsedUrlInfo.domainRules[0]);
  } else if (!selectedRule && parsedUrlInfo?.pathRules?.length > 0) {
    selectRuleCapsule(parsedUrlInfo.pathRules[0]);
  }

  if (!selectedRule) {
    showToast(t('popup.toastSelectRule'));
    return;
  }

  const originalText = elements.btnHideText.textContent;

  try {
    elements.btnHideAndClean.disabled = true;
    elements.btnHideAndClean.style.opacity = '0.7';
    elements.btnHideText.textContent = t('popup.toastProcessing');

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

    const actionText = isNew ? t('popup.actionAdd') : t('popup.actionUpdate');
    elements.btnHideText.textContent = t('popup.btnDone', { action: actionText });
    showToast(t('popup.toastAddedAndCleaned', { action: actionText, count: deletedCount }));

    // 3. 刷新数据
    await refreshPageData();
  } catch (err) {
    console.error('Hide and clean error:', err);
    elements.btnHideText.textContent = originalText;
    showToast(t('popup.toastFailed', { error: err.message }));
  } finally {
    setTimeout(() => {
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
    showToast(t('popup.toastSelectRule'));
    return;
  }

  const itemsToDelete = (selectedRule.matchingHistory && selectedRule.matchingHistory.length > 0)
    ? selectedRule.matchingHistory
    : (currentTab?.url ? [{ url: currentTab.url }] : []);

  if (itemsToDelete.length === 0) {
    showToast(t('popup.toastCleanOnlyEmpty'));
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

    showToast(t('popup.toastCleanOnlyDone', { count: deletedCount }));
    await refreshPageData();
  } catch (err) {
    console.error('Clean only error:', err);
    showToast(t('popup.toastFailed', { error: err.message }));
  } finally {
    elements.btnCleanOnly.style.opacity = '1';
    updateActionButtons();
  }
});

// DOM 启动加载
document.addEventListener('DOMContentLoaded', initPopup);
