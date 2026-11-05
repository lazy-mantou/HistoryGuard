/**
 * @file popup.js
 * @description Popup 弹窗交互控制逻辑
 * 面向统一抽象接口 browserApi 与 core 业务逻辑实现零输入快速规则隐藏与清理
 */

import { browserApi } from '../adapters/index.js';
import { parseUrl } from '../core/urlParser.js';
import { filterHistoryByRule, findMatchingRule, computeCandidateStatus, normalizeDomain } from '../core/ruleMatcher.js';
import { cleanHistoryByRule } from '../core/historyCleaner.js';
import { t, initI18n, localizeCapsule } from '../core/i18n.js';
import { initTheme } from '../core/theme.js';
import { updateTabToolbarIndicator, updateGlobalToolbarIndicator } from '../background/toolbarIndicator.js';
import {
  getRules,
  addRule,
  deleteRule,
  getSilentMode,
  setSilentMode,
  clearSilentMode,
  getPauseStatus,
  setPauseStatus,
  clearPauseStatus,
  getSettings,
  RULE_ERROR_I18N_KEYS
} from '../core/storage.js';

// DOM 元素引用
const elements = {
  popupContainer: document.getElementById('popup-container'),
  silentDropdown: document.getElementById('silent-dropdown'),
  btnSilentMode: document.getElementById('btn-silent-mode'),
  silentText: document.getElementById('silent-text'),
  silentDropdownMenu: document.getElementById('silent-dropdown-menu'),
  itemSilentExit: document.getElementById('item-silent-exit'),
  silentMenuDivider: document.getElementById('silent-menu-divider'),
  silentDurationItems: document.querySelectorAll('.silent-dropdown-item[data-duration]'),
  btnOpenOptions: document.getElementById('btn-open-options'),
  pauseDropdown: document.getElementById('pause-dropdown'),
  btnPauseMode: document.getElementById('btn-pause-mode'),
  pauseBadgeDot: document.getElementById('pause-badge-dot'),
  pauseDropdownMenu: document.getElementById('pause-dropdown-menu'),
  itemPauseResume: document.getElementById('item-pause-resume'),
  pauseMenuDivider: document.getElementById('pause-menu-divider'),
  pauseDurationItems: document.querySelectorAll('.pause-dropdown-item[data-duration]'),
  pausedProtectionBanner: document.getElementById('paused-protection-banner'),
  pausedCountdownText: document.getElementById('paused-countdown-text'),
  btnBannerResume: document.getElementById('btn-banner-resume'),
  tabStatusBadge: document.getElementById('tab-status-badge'),
  tabUrlText: document.getElementById('tab-url-text'),
  matchedRuleBanner: document.getElementById('matched-rule-banner'),
  matchedRuleText: document.getElementById('matched-rule-text'),
  btnRemoveMatchedRule: document.getElementById('btn-remove-matched-rule'),
  internalPageTip: document.getElementById('internal-page-tip'),
  mainContent: document.getElementById('main-content'),
  domainCapsulesGroup: document.getElementById('domain-capsules-group'),
  pathCapsulesGroup: document.getElementById('path-capsules-group'),
  cbRetroactive: document.getElementById('cb-retroactive'),
  retroactiveLabelText: document.getElementById('retroactive-label-text'),
  btnHideAndClean: document.getElementById('btn-hide-and-clean'),
  btnHideIcon: document.querySelector('#btn-hide-and-clean .btn-icon'),
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
let currentMatchedRule = null;
let cachedHistoryItems = [];
let silentCountdownTimer = null;
let pauseCountdownTimer = null;
let toastDismissTimer = null;
let isProtectionPaused = false;

/**
 * 实时同步浏览器工具栏图标外观（普通网页蓝色、拦截页面绿色、暂停时灰色）
 */
async function syncCurrentToolbarIndicator() {
  try {
    const pause = await getPauseStatus();
    const silent = await getSilentMode();
    const rules = await getRules();
    const lang = browserApi.i18n.getUILanguage() || 'zh-CN';
    const silentUntil = silent.active ? silent.until : 0;
    const activeRules = rules.filter(r => r.enabled !== false);

    await updateGlobalToolbarIndicator(silentUntil, lang, pause);

    if (currentTab && typeof currentTab.id === 'number') {
      await updateTabToolbarIndicator(
        currentTab.id,
        currentTab.url || '',
        currentTab.title || '',
        activeRules,
        silentUntil,
        lang,
        pause
      );
    }
  } catch (err) {
    // 忽略异常
  }
}

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
 * 获取对应语言的时长文案（和 options 完全对应，如 15 分钟、30 分钟 (推荐)、1 小时等）
 * @param {number} minutes
 * @param {boolean} [clean=false] 是否剥离 (推荐) 等额外修饰词
 * @returns {string}
 */
function getDurationI18nText(minutes, clean = false) {
  const m = Number(minutes) || 30;
  const key = `options.duration${m}m`;
  let text = t(key);
  if (!text || text === key) {
    if (m < 60) return `${m}min`;
    const h = m / 60;
    return Number.isInteger(h) ? `${h}h` : `${m}min`;
  }
  if (clean) {
    return text.replace(/\s*[\(（][^\)）]*[\)）]/g, '').trim();
  }
  return text;
}

/**
 * 格式化倒计时毫秒数 (时:分:秒 或 分:秒)
 * @param {number} ms
 * @returns {string}
 */
function formatRemainingTime(ms) {
  if (ms <= 0) return '00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * 动态同步下拉菜单展开时的 Popup 页面高度
 * 当页面自身高度较短（如浏览器内部页面）且展开下拉菜单时，主动撑开容器高度，
 * 避免超出 Firefox / Chromium Popup 初始视口高度而产生滚动条。
 */
function syncDropdownPopupHeight() {
  if (!elements.popupContainer) return;

  const isPauseOpen = elements.pauseDropdown && elements.pauseDropdown.classList.contains('open');
  const isSilentOpen = elements.silentDropdown && elements.silentDropdown.classList.contains('open');

  let activeMenu = null;
  if (isPauseOpen && elements.pauseDropdownMenu && !elements.pauseDropdownMenu.classList.contains('hidden')) {
    activeMenu = elements.pauseDropdownMenu;
  } else if (isSilentOpen && elements.silentDropdownMenu && !elements.silentDropdownMenu.classList.contains('hidden')) {
    activeMenu = elements.silentDropdownMenu;
  }

  if (activeMenu) {
    elements.popupContainer.classList.add('dropdown-open');

    // 精准计算下拉菜单完全展示所需的最低高度，避免任何滚动条产生
    const parent = activeMenu.parentElement;
    if (parent) {
      const containerRect = elements.popupContainer.getBoundingClientRect();
      const parentRect = parent.getBoundingClientRect();
      const parentTopInContainer = parentRect.top - containerRect.top;
      const menuTopInContainer = parentTopInContainer + parent.offsetHeight + 6;
      const menuBottomInContainer = menuTopInContainer + activeMenu.offsetHeight;
      const requiredHeight = Math.ceil(menuBottomInContainer + 14); // 底部保留 14px 安全边距

      if (requiredHeight > 380) {
        elements.popupContainer.style.minHeight = `${requiredHeight}px`;
      }
    }
  } else {
    elements.popupContainer.classList.remove('dropdown-open');
    elements.popupContainer.style.minHeight = '';
  }
}

function openSilentDropdown() {
  if (!elements.silentDropdownMenu || !elements.silentDropdown) return;
  elements.silentDropdown.classList.add('open');
  elements.silentDropdownMenu.classList.remove('hidden');
  elements.btnSilentMode.setAttribute('aria-expanded', 'true');
  syncDropdownPopupHeight();
}

function closeSilentDropdown() {
  if (!elements.silentDropdownMenu || !elements.silentDropdown) return;
  elements.silentDropdown.classList.remove('open');
  elements.silentDropdownMenu.classList.add('hidden');
  elements.btnSilentMode.setAttribute('aria-expanded', 'false');
  syncDropdownPopupHeight();
}

function toggleSilentDropdown() {
  if (!elements.silentDropdownMenu) return;
  const isHidden = elements.silentDropdownMenu.classList.contains('hidden');
  if (isHidden) {
    closePauseDropdown();
    openSilentDropdown();
  } else {
    closeSilentDropdown();
  }
}

function openPauseDropdown() {
  if (!elements.pauseDropdownMenu || !elements.pauseDropdown) return;
  elements.pauseDropdown.classList.add('open');
  elements.pauseDropdownMenu.classList.remove('hidden');
  elements.btnPauseMode.setAttribute('aria-expanded', 'true');
  syncDropdownPopupHeight();
}

function closePauseDropdown() {
  if (!elements.pauseDropdownMenu || !elements.pauseDropdown) return;
  elements.pauseDropdown.classList.remove('open');
  elements.pauseDropdownMenu.classList.add('hidden');
  elements.btnPauseMode.setAttribute('aria-expanded', 'false');
  syncDropdownPopupHeight();
}

function togglePauseDropdown() {
  if (!elements.pauseDropdownMenu) return;
  const isHidden = elements.pauseDropdownMenu.classList.contains('hidden');
  if (isHidden) {
    closeSilentDropdown();
    openPauseDropdown();
  } else {
    closePauseDropdown();
  }
}

/**
 * 初始化并刷新防护暂停模式按钮与下拉菜单状态
 */
async function updatePauseModeState() {
  if (pauseCountdownTimer) {
    clearInterval(pauseCountdownTimer);
    pauseCountdownTimer = null;
  }

  // 更新各时长选项文字（如“临时关闭 15 分钟”等）
  if (elements.pauseDurationItems) {
    elements.pauseDurationItems.forEach(item => {
      const dur = item.dataset.duration;
      const textSpan = item.querySelector('.item-text');
      if (textSpan) {
        if (dur === 'manual') {
          textSpan.textContent = t('popup.pauseForever');
        } else {
          const durationLabel = getDurationI18nText(Number(dur), true);
          textSpan.textContent = t('popup.pauseDurationItem', { duration: durationLabel });
        }
      }
    });
  }

  const pause = await getPauseStatus();
  isProtectionPaused = Boolean(pause.active);

  // 实时同步扩展工具栏图标（普通网页蓝色、拦截页面绿色、暂停时灰色）
  await syncCurrentToolbarIndicator();

  if (pause.active) {
    elements.btnPauseMode.classList.add('paused');
    if (elements.pauseBadgeDot) elements.pauseBadgeDot.classList.remove('hidden');
    if (elements.itemPauseResume) elements.itemPauseResume.classList.remove('hidden');
    if (elements.pauseMenuDivider) elements.pauseMenuDivider.classList.remove('hidden');
    if (elements.pausedProtectionBanner) elements.pausedProtectionBanner.classList.remove('hidden');

    if (pause.manual) {
      if (elements.pausedCountdownText) elements.pausedCountdownText.textContent = t('popup.pauseForever');
      elements.btnPauseMode.title = `${t('popup.pauseBannerTitle')} (${t('popup.pauseForever')})`;
    } else {
      if (elements.pausedCountdownText) elements.pausedCountdownText.textContent = formatRemainingTime(pause.remainingMs);
      elements.btnPauseMode.title = `${t('popup.pauseBannerTitle')} (${formatRemainingTime(pause.remainingMs)})`;

      pauseCountdownTimer = setInterval(async () => {
        const cur = await getPauseStatus();
        if (cur.active && !cur.manual && cur.remainingMs > 0) {
          if (elements.pausedCountdownText) elements.pausedCountdownText.textContent = formatRemainingTime(cur.remainingMs);
          elements.btnPauseMode.title = `${t('popup.pauseBannerTitle')} (${formatRemainingTime(cur.remainingMs)})`;
        } else {
          clearInterval(pauseCountdownTimer);
          pauseCountdownTimer = null;
          await updatePauseModeState();
          await refreshPageData();
        }
      }, 1000);
    }
  } else {
    elements.btnPauseMode.classList.remove('paused');
    if (elements.pauseBadgeDot) elements.pauseBadgeDot.classList.add('hidden');
    if (elements.itemPauseResume) elements.itemPauseResume.classList.add('hidden');
    if (elements.pauseMenuDivider) elements.pauseMenuDivider.classList.add('hidden');
    if (elements.pausedProtectionBanner) elements.pausedProtectionBanner.classList.add('hidden');
    elements.btnPauseMode.title = t('popup.pauseTooltip');
  }
}

/**
 * 初始化并刷新静默免记录按钮与下拉菜单状态
 */
async function updateSilentModeState() {
  if (silentCountdownTimer) {
    clearInterval(silentCountdownTimer);
    silentCountdownTimer = null;
  }

  let defaultDuration = 30;
  try {
    const settings = await getSettings();
    defaultDuration = Number(settings.silentModeDuration) || 30;
  } catch (err) {
    console.warn('Failed to load settings in silent mode check:', err);
  }

  const silent = await getSilentMode();
  await syncCurrentToolbarIndicator();
  const defaultLabel = getDurationI18nText(defaultDuration, true);

  // 更新下拉菜单各时长文案（与 options 保持完全同步的 i18n 翻译）及 "默认" 徽标
  if (elements.silentDurationItems) {
    elements.silentDurationItems.forEach(item => {
      const dur = Number(item.dataset.duration);
      const textSpan = item.querySelector('.item-text');
      if (textSpan) {
        textSpan.textContent = getDurationI18nText(dur, false);
      }
      const badge = item.querySelector('.item-badge');
      if (dur === defaultDuration) {
        if (badge) {
          badge.textContent = t('popup.silentDefaultTag');
          badge.classList.remove('hidden');
        }
        item.classList.add('selected');
      } else {
        if (badge) {
          badge.classList.add('hidden');
        }
        item.classList.remove('selected');
      }
    });
  }

  if (silent.active && silent.remainingMs > 0) {
    elements.btnSilentMode.classList.add('active');
    elements.silentText.textContent = t('popup.silentBtnActive', { time: formatRemainingTime(silent.remainingMs) });

    if (elements.itemSilentExit) elements.itemSilentExit.classList.remove('hidden');
    if (elements.silentMenuDivider) elements.silentMenuDivider.classList.remove('hidden');

    silentCountdownTimer = setInterval(async () => {
      const current = await getSilentMode();
      if (current.active && current.remainingMs > 0) {
        elements.silentText.textContent = t('popup.silentBtnActive', { time: formatRemainingTime(current.remainingMs) });
      } else {
        clearInterval(silentCountdownTimer);
        silentCountdownTimer = null;
        elements.btnSilentMode.classList.remove('active');
        elements.silentText.textContent = t('popup.silentBtnParam', { duration: defaultLabel });
        if (elements.itemSilentExit) elements.itemSilentExit.classList.add('hidden');
        if (elements.silentMenuDivider) elements.silentMenuDivider.classList.add('hidden');
      }
    }, 1000);
  } else {
    elements.btnSilentMode.classList.remove('active');
    elements.silentText.textContent = t('popup.silentBtnParam', { duration: defaultLabel });

    if (elements.itemSilentExit) elements.itemSilentExit.classList.add('hidden');
    if (elements.silentMenuDivider) elements.silentMenuDivider.classList.add('hidden');
  }
}


/**
 * 更新选中胶囊所联动的复选框与按钮文字及禁用态
 */
function updateActionButtons() {
  if (isProtectionPaused) {
    elements.btnHideAndClean.disabled = true;
    elements.btnCleanOnly.disabled = true;
    if (elements.cbRetroactive) {
      elements.cbRetroactive.disabled = true;
    }
    elements.btnHideText.textContent = t('popup.hideAndClean');
    elements.btnHideAndClean.title = t('popup.pauseBannerDesc');
    return;
  }

  if (elements.cbRetroactive) {
    elements.cbRetroactive.disabled = false;
  }

  if (!selectedRule) {
    elements.btnHideAndClean.disabled = true;
    elements.btnCleanOnly.disabled = true;
    return;
  }

  const count = selectedRule.count || 0;

  // 副按钮：仅删 X 条 (为 0 条时 disabled，且 hover 不高亮)
  elements.btnCleanText.textContent = t('popup.cleanOnly', { count });
  elements.btnCleanOnly.disabled = (count === 0);

  // 主按钮：隐藏并清理 (若已在规则列表中，提供"从列表中删除"功能；若已被上级规则覆盖，则 disabled)
  const cbLabel = elements.cbRetroactive?.closest('.checkbox-label');
  if (selectedRule.isExactMatch) {
    elements.btnHideAndClean.disabled = false;
    elements.btnHideAndClean.classList.add('btn-danger-remove');
    if (elements.btnHideIcon) elements.btnHideIcon.textContent = '🗑️';
    elements.btnHideText.textContent = t('popup.removeFromList');
    elements.btnHideAndClean.title = t('popup.removeFromListTitle', { rule: selectedRule.rule });
    if (cbLabel) cbLabel.style.display = 'none';
  } else if (selectedRule.isCovered) {
    elements.btnHideAndClean.disabled = true;
    elements.btnHideAndClean.classList.remove('btn-danger-remove');
    if (elements.btnHideIcon) elements.btnHideIcon.textContent = '🛡️';
    elements.btnHideText.textContent = t('popup.coveredByParent');
    elements.btnHideAndClean.title = t('popup.badgeCoveredDetail', { rule: selectedRule.coveringRule?.pattern || '' });
    if (cbLabel) cbLabel.style.display = '';
  } else {
    elements.btnHideAndClean.disabled = false;
    elements.btnHideAndClean.classList.remove('btn-danger-remove');
    if (elements.btnHideIcon) elements.btnHideIcon.textContent = '🛡️';
    const isRetro = elements.cbRetroactive ? elements.cbRetroactive.checked : true;
    elements.btnHideText.textContent = isRetro ? t('popup.hideAndClean') : t('popup.addRuleOnly');
    elements.btnHideAndClean.title = isRetro
      ? t('popup.hideAndCleanWithRule', { rule: selectedRule.rule })
      : t('popup.addRuleOnlyWithRule', { rule: selectedRule.rule });
    if (cbLabel) cbLabel.style.display = '';
  }

  elements.retroactiveLabelText.textContent = t('popup.retroactiveLabel', { count });
}

/**
 * 选中某条候选规则胶囊 (被上级覆盖变灰的规则禁止选中)
 * @param {Object} candidate
 */
function selectRuleCapsule(candidate) {
  if (isProtectionPaused) return;
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
  container.replaceChildren();
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
    const isSelected = !isProtectionPaused && selectedRule?.rule === cand.rule;

    const stateClasses = [];
    if (isProtectionPaused) stateClasses.push('paused-disabled');
    if (isSelected && !cand.isCovered) stateClasses.push('selected');
    if (cand.isCovered) stateClasses.push('covered', 'disabled');
    else if (cand.isExactMatch) stateClasses.push('in-list');

    capsuleEl.className = `rule-capsule ${stateClasses.join(' ')}`;
    capsuleEl.dataset.rule = cand.rule;

    const { label, description } = localizeCapsule(cand);
    const count = cand.count || 0;
    const matchesTitle = t('popup.matchesCount', { count });
    const countText = t('popup.itemsCount', { count });

    const capsuleMain = document.createElement('div');
    capsuleMain.className = 'capsule-main';

    const patternSpan = document.createElement('span');
    patternSpan.className = 'capsule-pattern';
    patternSpan.title = cand.rule;
    patternSpan.textContent = cand.rule;

    const capsuleSub = document.createElement('span');
    capsuleSub.className = 'capsule-sub';

    const labelSpan = document.createElement('span');
    labelSpan.textContent = label;

    const dotSpan = document.createElement('span');
    dotSpan.textContent = '·';

    const descSpan = document.createElement('span');
    descSpan.textContent = cand.isCovered
      ? (cand.coveringRule ? t('popup.badgeCoveredDetail', { rule: cand.coveringRule.pattern }) : t('popup.coveredByParent'))
      : description;

    capsuleSub.append(labelSpan, dotSpan, descSpan);
    capsuleMain.append(patternSpan, capsuleSub);

    let statusTagEl;
    if (cand.isCovered) {
      const coverHint = t('popup.badgeCoveredDetail', { rule: cand.coveringRule?.pattern || '' });
      statusTagEl = document.createElement('div');
      statusTagEl.className = 'capsule-status-tag tag-covered';
      statusTagEl.title = coverHint;
      statusTagEl.textContent = t('popup.badgeCovered');
      capsuleEl.title = coverHint;
    } else if (cand.isExactMatch) {
      statusTagEl = document.createElement('div');
      statusTagEl.className = 'capsule-status-tag tag-in-list';
      statusTagEl.title = matchesTitle;
      statusTagEl.textContent = t('popup.badgeInList');
    } else {
      statusTagEl = document.createElement('div');
      statusTagEl.className = 'capsule-count';
      statusTagEl.title = matchesTitle;
      statusTagEl.textContent = countText;
    }

    capsuleEl.replaceChildren(capsuleMain, statusTagEl);

    capsuleEl.addEventListener('click', () => {
      // 临时关闭防护期间或已被上级规则覆盖时禁止交互
      if (isProtectionPaused || cand.isCovered) return;
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

  // 3. 检查当前 URL 是否处于暂停模式或命中现有启用规则
  if (isProtectionPaused) {
    elements.tabStatusBadge.className = 'badge badge-paused';
    elements.tabStatusBadge.textContent = '⏸ ' + t('popup.pauseBannerTitle');

    if (elements.matchedRuleBanner) {
      elements.matchedRuleBanner.classList.add('hidden');
    }
  } else {
    const { matched, rule } = findMatchingRule(existingRules, currentTab);
    currentMatchedRule = matched && rule ? rule : null;

    if (matched && rule) {
      elements.tabStatusBadge.className = 'badge badge-matched';
      elements.tabStatusBadge.textContent = t('popup.statusMatched', { pattern: rule.pattern });

      if (elements.matchedRuleBanner) {
        elements.matchedRuleBanner.classList.remove('hidden');
        if (elements.matchedRuleText) {
          elements.matchedRuleText.textContent = t('popup.matchedRuleBanner', { rule: rule.pattern });
        }
        if (elements.btnRemoveMatchedRule) {
          elements.btnRemoveMatchedRule.title = t('popup.removeFromListTitle', { rule: rule.pattern });
        }
      }
    } else {
      elements.tabStatusBadge.className = 'badge badge-normal';
      elements.tabStatusBadge.textContent = t('popup.statusNormal');

      if (elements.matchedRuleBanner) {
        elements.matchedRuleBanner.classList.add('hidden');
      }
    }
  }

  // 4. 智能推荐选中的候选规则：临时关闭防护期间不选中任何规则
  if (isProtectionPaused) {
    selectedRule = null;
  } else {
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
  }

  // 5. 渲染胶囊组
  renderCapsuleGroup(elements.domainCapsulesGroup, parsedUrlInfo.domainRules);
  renderCapsuleGroup(elements.pathCapsulesGroup, parsedUrlInfo.pathRules);

  if (!isProtectionPaused && selectedRule && !selectedRule.isCovered) {
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
    if (elements.cbRetroactive) {
      elements.cbRetroactive.checked = settings.cleanOnAddRule !== false;
    }
  } catch (err) {
    console.warn('Failed to load settings:', err);
    initI18n('auto');
    initTheme('auto');
  }

  // 全局控制状态初始化（临时无痕 & 暂停模式），确保在内部页面或不可用页面下同样完整就绪
  await updateSilentModeState();
  await updatePauseModeState();

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
    return;
  }

  // 4. 正常页面：加载数据与规则
  await refreshPageData();
}

// 事件绑定
// A1. 点击临时无痕按钮切换下拉菜单显隐
elements.btnSilentMode.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleSilentDropdown();
});

// A2. 点击退出无痕模式
if (elements.itemSilentExit) {
  elements.itemSilentExit.addEventListener('click', async (e) => {
    e.stopPropagation();
    closeSilentDropdown();
    await clearSilentMode();
    showToast(t('popup.toastSilentExit'));
    await updateSilentModeState();
  });
}

// A3. 点击各时长选项
if (elements.silentDurationItems) {
  elements.silentDurationItems.forEach(item => {
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      closeSilentDropdown();
      const duration = Number(item.dataset.duration) || 30;
      await setSilentMode(duration);
      showToast(t('popup.toastSilentEnter', { duration }));
      await updateSilentModeState();
    });
  });
}

// A4. 点击页面外部关闭下拉菜单，按 Escape 键关闭
document.addEventListener('click', (e) => {
  if (elements.silentDropdown && !elements.silentDropdown.contains(e.target)) {
    closeSilentDropdown();
  }
  if (elements.pauseDropdown && !elements.pauseDropdown.contains(e.target)) {
    closePauseDropdown();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeSilentDropdown();
    closePauseDropdown();
  }
});

// A5. 点击关闭/暂停防护按钮切换下拉菜单显隐
elements.btnPauseMode.addEventListener('click', (e) => {
  e.stopPropagation();
  togglePauseDropdown();
});

// A6. 点击恢复防护（下拉菜单顶部恢复项或横幅恢复按钮）
const handleResumeProtection = async (e) => {
  if (e) e.stopPropagation();
  closePauseDropdown();
  await clearPauseStatus();
  showToast(t('popup.toastPauseExit'));
  await updatePauseModeState();
  await refreshPageData();
};

if (elements.itemPauseResume) {
  elements.itemPauseResume.addEventListener('click', handleResumeProtection);
}
if (elements.btnBannerResume) {
  elements.btnBannerResume.addEventListener('click', handleResumeProtection);
}

// A7. 点击暂停时长选项
if (elements.pauseDurationItems) {
  elements.pauseDurationItems.forEach(item => {
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      closePauseDropdown();
      const dur = item.dataset.duration;
      await setPauseStatus(dur);

      if (dur === 'manual') {
        showToast(t('popup.toastPauseEnterForever'));
      } else {
        const durationLabel = getDurationI18nText(Number(dur), true);
        showToast(t('popup.toastPauseEnter', { duration: durationLabel }));
      }

      await updatePauseModeState();
      await updateSilentModeState();
      await refreshPageData();
    });
  });
}

// B. 打开设置页齿轮入口
const openOptions = () => {
  browserApi.runtime.openOptionsPage();
  window.close();
};
elements.btnOpenOptions.addEventListener('click', openOptions);

/**
 * 调度历史清理任务：优先委托给后台 Background 守护进程（不受 Popup 窗口关闭影响），若环境不支持则本地回退执行
 * @param {Object} rule - { pattern, type }
 * @param {string} [currentUrl]
 * @param {Function} [onProgress]
 * @returns {Promise<{ deleted: number, scanned: number }>}
 */
async function executeHistoryCleaning(rule, currentUrl, onProgress) {
  // 1. 尝试通过 runtime.sendMessage 委托给后台 Service Worker 执行，确保持久不中断
  try {
    if (browserApi.runtime && typeof browserApi.runtime.sendMessage === 'function') {
      const resp = await browserApi.runtime.sendMessage({
        action: 'CLEAN_HISTORY_BY_RULE',
        rule,
        currentUrl
      });
      if (resp && typeof resp === 'object' && resp.success !== undefined) {
        if (!resp.success) {
          throw new Error(resp.error || 'Background clean failed');
        }
        return { deleted: resp.deleted || 0, scanned: resp.scanned || 0 };
      }
    }
  } catch (msgErr) {
    console.warn('[Popup] Background messaging fallback:', msgErr);
  }

  // 2. 本地回退执行
  const cleanResult = await cleanHistoryByRule(rule, { onProgress });

  if (currentUrl) {
    try {
      await browserApi.history.deleteUrl(currentUrl);
    } catch {
      // ignore
    }
  }

  return cleanResult;
}

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

  // 分支 1：当前选中的是已在列表中的规则，执行从列表中删除
  if (selectedRule.isExactMatch && selectedRule.exactRule) {
    try {
      elements.btnHideAndClean.disabled = true;
      elements.btnHideAndClean.style.opacity = '0.7';
      elements.btnCleanOnly.disabled = true;
      elements.btnHideText.textContent = t('popup.toastProcessing');

      await deleteRule(selectedRule.exactRule.id);
      showToast(t('popup.toastRuleRemoved', { rule: selectedRule.rule }));
      await refreshPageData();
    } catch (err) {
      console.error('Delete rule error:', err);
      showToast(t('popup.toastFailed', { error: err.message }));
    } finally {
      elements.btnHideAndClean.style.opacity = '1';
      updateActionButtons();
    }
    return;
  }

  const originalText = elements.btnHideText.textContent;

  try {
    elements.btnHideAndClean.disabled = true;
    elements.btnHideAndClean.style.opacity = '0.7';
    elements.btnHideText.textContent = t('popup.toastProcessing');

    // 立即停用副按钮“仅删xx条”，防止重复操作
    elements.btnCleanOnly.disabled = true;

    // 1. 添加隐藏规则到存储
    const { rule, isNew } = await addRule({
      pattern: selectedRule.rule,
      type: selectedRule.type,
      enabled: true
    });

    let deletedCount = 0;
    // 2. 若勾选了回溯清理，全量回溯清理已有历史（完全由后台静默执行，前台无需展示数字进度，防止误以为必须保持前台运行）
    if (elements.cbRetroactive.checked) {
      const cleanResult = await executeHistoryCleaning(
        rule,
        currentTab?.url
      );
      deletedCount = cleanResult.deleted;
    }

    const actionText = isNew ? t('popup.actionAdd') : t('popup.actionUpdate');
    elements.btnHideText.textContent = t('popup.btnDone', { action: actionText });
    showToast(t('popup.toastAddedAndCleaned', { action: actionText, count: deletedCount }));

    // 3. 刷新数据
    await refreshPageData();
  } catch (err) {
    console.error('Hide and clean error:', err);
    elements.btnHideText.textContent = originalText;
    const i18nKey = err.code && RULE_ERROR_I18N_KEYS[err.code];
    const errMsg = i18nKey ? t(i18nKey) : (err.message || String(err));
    showToast(t('popup.toastFailed', { error: errMsg }));
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

  try {
    elements.btnCleanOnly.disabled = true;
    elements.btnCleanOnly.style.opacity = '0.7';
    elements.btnCleanText.textContent = t('popup.toastProcessing');

    // 立即停用主按钮，防止重复操作
    elements.btnHideAndClean.disabled = true;

    const cleanResult = await executeHistoryCleaning(
      { pattern: selectedRule.rule, type: selectedRule.type },
      currentTab?.url
    );
    const deletedCount = cleanResult.deleted;

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

// D2. 回溯清理勾选状态变化，实时联动主按钮文案
if (elements.cbRetroactive) {
  elements.cbRetroactive.addEventListener('change', () => {
    updateActionButtons();
  });
}

// E. 移除已命中保护规则快捷按钮 (顶部横幅)
if (elements.btnRemoveMatchedRule) {
  elements.btnRemoveMatchedRule.addEventListener('click', async () => {
    if (!currentMatchedRule) return;

    const ruleToDelete = currentMatchedRule;
    try {
      elements.btnRemoveMatchedRule.disabled = true;
      elements.btnRemoveMatchedRule.style.opacity = '0.7';
      elements.btnHideAndClean.disabled = true;
      elements.btnCleanOnly.disabled = true;

      await deleteRule(ruleToDelete.id);
      showToast(t('popup.toastRuleRemoved', { rule: ruleToDelete.pattern }));

      await refreshPageData();
    } catch (err) {
      console.error('Failed to remove matched rule:', err);
      showToast(t('popup.toastFailed', { error: err.message }));
    } finally {
      if (elements.btnRemoveMatchedRule) {
        elements.btnRemoveMatchedRule.disabled = false;
        elements.btnRemoveMatchedRule.style.opacity = '1';
      }
      updateActionButtons();
    }
  });
}

// DOM 启动加载
document.addEventListener('DOMContentLoaded', initPopup);
