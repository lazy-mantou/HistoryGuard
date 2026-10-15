/**
 * @file options.js
 * @description Options 独立管理控制台业务逻辑
 * 支持左侧 Tab 导航切换、按搜索结果批量删除、规则增删改查、JSON 备份导入导出及全局状态联动
 */

import { browserApi } from '../adapters/index.js';
import { convertSearchTermToRule } from '../core/ruleMatcher.js';
import { cleanHistoryByRule } from '../core/historyCleaner.js';
import { t, initI18n, setLanguage, formatRelativeTime } from '../core/i18n.js';
import { initTheme } from '../core/theme.js';
import {
  getRules,
  saveRules,
  addRule,
  toggleRule,
  deleteRule,
  getSilentMode,
  exportRules,
  importRules,
  getSettings,
  saveSettings,
  resetRuleHits,
  clearAllRules,
  DEFAULT_SETTINGS,
  STORAGE_KEYS
} from '../core/storage.js';

// DOM 元素引用
const elements = {
  // 顶部全局统计
  statActiveRules: document.getElementById('stat-active-rules'),
  statTotalHits: document.getElementById('stat-total-hits'),
  statSilentStatus: document.getElementById('stat-silent-status'),

  // 左侧 Tab 导航
  navTabs: document.querySelectorAll('.nav-tab'),
  panelHistory: document.getElementById('panel-history'),
  panelRules: document.getElementById('panel-rules'),
  panelSettings: document.getElementById('panel-settings'),
  tabRulesBadge: document.getElementById('tab-rules-badge'),
  tabHistoryBadge: document.getElementById('tab-history-badge'),

  // 历史批量清理
  searchInput: document.getElementById('search-input'),
  btnClearSearch: document.getElementById('btn-clear-search'),
  timeFilters: document.querySelectorAll('.filter-capsule'),
  searchResultsSummary: document.getElementById('search-results-summary'),
  selectedSummary: document.getElementById('selected-summary'),
  btnSelectAll: document.getElementById('btn-select-all'),
  btnInvertSelect: document.getElementById('btn-invert-select'),
  historyScrollContainer: document.getElementById('history-scroll-container'),
  historyPreviewList: document.getElementById('history-preview-list'),
  loadMoreSection: document.getElementById('load-more-section'),
  btnLoadMore: document.getElementById('btn-load-more'),
  loadMoreText: document.getElementById('load-more-text'),
  noMoreHint: document.getElementById('no-more-hint'),
  btnDeleteSelected: document.getElementById('btn-delete-selected'),
  btnDeleteText: document.getElementById('btn-delete-text'),
  btnDeepClean: document.getElementById('btn-deep-clean'),

  // 异步执行进度条
  progressContainer: document.getElementById('progress-container'),
  progressStatusText: document.getElementById('progress-status-text'),
  progressPercentText: document.getElementById('progress-percent-text'),
  progressFillBar: document.getElementById('progress-fill-bar'),

  // 防护规则管理
  newRuleInput: document.getElementById('new-rule-input'),
  newRuleType: document.getElementById('new-rule-type'),
  btnAddRule: document.getElementById('btn-add-rule'),
  rulesCountSummary: document.getElementById('rules-count-summary'),
  rulesContainer: document.getElementById('rules-container'),
  btnToggleAll: document.getElementById('btn-toggle-all'),
  btnEnableAll: document.getElementById('btn-enable-all'),
  btnClearDisabled: document.getElementById('btn-clear-disabled'),
  btnGotoSettings: document.getElementById('btn-goto-settings'),

  // 高级偏好设置
  settingTheme: document.getElementById('setting-theme'),
  settingLanguage: document.getElementById('setting-language'),
  settingEnableHitTracking: document.getElementById('setting-enable-hit-tracking'),
  btnResetHits: document.getElementById('btn-reset-hits'),
  btnSettingsExportJson: document.getElementById('btn-settings-export-json'),
  btnSettingsImportJson: document.getElementById('btn-settings-import-json'),
  settingImportMode: document.getElementById('setting-import-mode'),
  fileSettingsImport: document.getElementById('file-settings-import'),
  btnClearAllRules: document.getElementById('btn-clear-all-rules'),
  settingSilentDuration: document.getElementById('setting-silent-duration'),
  settingDefaultRuleType: document.getElementById('setting-default-rule-type'),
  settingHistoryBatchSize: document.getElementById('setting-history-batch-size'),
  settingDeleteChunkSize: document.getElementById('setting-delete-chunk-size'),
  settingConfirmDeepClean: document.getElementById('setting-confirm-deep-clean'),
  settingToastDuration: document.getElementById('setting-toast-duration'),

  // 全局 Toast
  toast: document.getElementById('toast')
};

// 状态与配置管理
let currentSettings = { ...DEFAULT_SETTINGS };

function getBatchSize() {
  return Number(currentSettings.historyBatchSize) || 100;
}

function getDeleteChunkSize() {
  return Number(currentSettings.deleteChunkSize) || 30;
}

let currentSearchTimeFilter = 'all'; // 'all' | '1h' | 'today' | '7d'
let searchDebounceTimer = null;
let currentHistoryResults = [];
let checkedUrls = new Set();
let cachedRules = [];
let toastDismissTimer = null;
let silentCountdownTimer = null;

// 游标分页与海量历史加载状态
let cursorEndTime = 0; // 当前批次最旧访问时间游标
let hasMoreHistory = true;
let isLoadingBatch = false;
let isOperatingCleaning = false;
let isHistoryDirty = false;
let historyRemovedDebounceTimer = null;

/**
 * 弹出提示 Toast
 * @param {string} msg
 * @param {number} [duration]
 */
function showToast(msg, duration) {
  const actualDuration = typeof duration === 'number' ? duration : (Number(currentSettings.toastDuration) || 2500);
  if (toastDismissTimer) {
    clearTimeout(toastDismissTimer);
    toastDismissTimer = null;
  }
  elements.toast.textContent = msg;
  elements.toast.classList.remove('hidden');
  toastDismissTimer = setTimeout(() => {
    elements.toast.classList.add('hidden');
    toastDismissTimer = null;
  }, actualDuration);
}

/**
 * 左侧 Tab 切换控制 (支持 history, rules, settings)
 * @param {'history'|'rules'|'settings'} tabKey
 */
function switchTab(tabKey) {
  elements.navTabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabKey);
  });

  const isSwitchingToHistory = tabKey === 'history';
  elements.panelHistory.classList.toggle('hidden', !isSwitchingToHistory);
  elements.panelHistory.classList.toggle('active', isSwitchingToHistory);

  elements.panelRules.classList.toggle('hidden', tabKey !== 'rules');
  elements.panelRules.classList.toggle('active', tabKey === 'rules');

  if (elements.panelSettings) {
    elements.panelSettings.classList.toggle('hidden', tabKey !== 'settings');
    elements.panelSettings.classList.toggle('active', tabKey === 'settings');
  }

  try {
    localStorage.setItem('histguard_active_options_tab', tabKey);
  } catch (err) {
    console.warn('Cannot persist active tab:', err);
  }

  // 当用户切换回“历史批量删除 (Batch History Delete)”面板时，
  // 若先前添加规则或执行清理导致历史数据变更，立即重新拉取历史记录
  if (isSwitchingToHistory && isHistoryDirty) {
    isHistoryDirty = false;
    fetchHistoryBatch({ isReset: true });
  }
}

// 绑定 Tab 点击事件
elements.navTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    switchTab(tab.dataset.tab);
  });
});

if (elements.btnGotoSettings) {
  elements.btnGotoSettings.addEventListener('click', () => {
    switchTab('settings');
  });
}

/**
 * 计算时间过滤起始时间戳
 * @param {'all'|'1h'|'today'|'7d'} filterKey
 * @returns {number}
 */
function getStartTimeByFilter(filterKey) {
  const now = Date.now();
  switch (filterKey) {
    case '1h':
      return now - 3600 * 1000;
    case 'today': {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return today.getTime();
    }
    case '7d':
      return now - 7 * 86400 * 1000;
    case 'all':
    default:
      return 0;
  }
}

/**
 * 格式化访问时间戳
 * @param {number} timestamp
 * @returns {string}
 */
function formatTime(timestamp) {
  return formatRelativeTime(timestamp);
}

/**
 * HTML 转义，防止 XSS
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* ==========================================================================
   全局统计与状态展示
   ========================================================================== */

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
 * 实时刷新并启动静默免记录倒计时定时器
 */
async function refreshSilentModeStatus() {
  if (silentCountdownTimer) {
    clearInterval(silentCountdownTimer);
    silentCountdownTimer = null;
  }

  const silent = await getSilentMode();
  if (silent.active && silent.remainingMs > 0) {
    elements.statSilentStatus.textContent = t('options.statSilentOn', {
      time: formatRemainingTime(silent.remainingMs)
    });
    elements.statSilentStatus.className = 'stat-value silent-on';

    const targetUntil = silent.until;
    silentCountdownTimer = setInterval(async () => {
      const remaining = targetUntil - Date.now();
      if (remaining > 0) {
        elements.statSilentStatus.textContent = t('options.statSilentOn', {
          time: formatRemainingTime(remaining)
        });
      } else {
        clearInterval(silentCountdownTimer);
        silentCountdownTimer = null;
        await getSilentMode(); // 触发 storage 内部到期重置
        elements.statSilentStatus.textContent = t('options.statSilentOff');
        elements.statSilentStatus.className = 'stat-value silent-off';
      }
    }, 1000);
  } else {
    elements.statSilentStatus.textContent = t('options.statSilentOff');
    elements.statSilentStatus.className = 'stat-value silent-off';
  }
}

async function refreshGlobalStats() {
  cachedRules = await getRules();
  const activeCount = cachedRules.filter(r => r.enabled !== false).length;
  const totalHits = cachedRules.reduce((sum, r) => sum + (r.hits || 0), 0);

  elements.statActiveRules.textContent = activeCount;

  if (currentSettings.enableHitTracking === false) {
    elements.statTotalHits.textContent = t('options.statTotalHitsDisabled');
    elements.statTotalHits.title = t('options.statTotalHitsDisabledTitle');
    elements.statTotalHits.className = 'stat-value hits-disabled';
  } else {
    elements.statTotalHits.textContent = totalHits;
    elements.statTotalHits.title = t('options.statTotalHitsTitle');
    elements.statTotalHits.className = 'stat-value highlight-hits';
  }

  if (elements.tabRulesBadge) {
    elements.tabRulesBadge.textContent = cachedRules.length;
  }

  await refreshSilentModeStatus();

  elements.rulesCountSummary.textContent = t('options.rulesSummary', { count: cachedRules.length });
}

/* ==========================================================================
   海量历史记录分批检索、事件委托与非阻塞流式清理
   ========================================================================== */

/**
 * 更新已勾选数量及底部操作按钮状态
 */
function updateSelectedSummary() {
  const selectedCount = checkedUrls.size;
  const hasSelected = selectedCount > 0;

  elements.selectedSummary.textContent = t('options.selectedSummary', { count: selectedCount });
  elements.btnDeleteText.textContent = t('options.btnDeleteSelected', { count: selectedCount });

  elements.btnDeleteSelected.disabled = !hasSelected || isOperatingCleaning;

  // 全部清空按钮：列表中无数据时禁用，有数据时可点击
  if (elements.btnDeepClean) {
    elements.btnDeepClean.disabled = currentHistoryResults.length === 0 || isOperatingCleaning;
  }
}

/**
 * 将单批次历史条目追加渲染到 DOM（采用 DocumentFragment，零重复开销）
 * @param {Array<Object>} items - 历史记录条目数组
 * @param {boolean} [autoCheck=false] - 是否默认勾选
 */
function appendHistoryBatchToDOM(items, autoCheck = false) {
  const fragment = document.createDocumentFragment();

  items.forEach((item) => {
    if (autoCheck) {
      checkedUrls.add(item.url);
    }
    const isChecked = checkedUrls.has(item.url);
    const row = document.createElement('div');
    row.className = `history-item ${isChecked ? 'checked' : ''}`;
    row.dataset.url = item.url;

    row.innerHTML = `
      <input type="checkbox" class="history-checkbox" ${isChecked ? 'checked' : ''}>
      <div class="history-details">
        <div class="history-title" title="${escapeHtml(item.title || item.url)}">
          ${escapeHtml(item.title || item.url)}
        </div>
        <div class="history-url" title="${escapeHtml(item.url)}">
          ${escapeHtml(item.url)}
        </div>
      </div>
      <div class="history-time">${formatTime(item.lastVisitTime)}</div>
    `;

    fragment.appendChild(row);
  });

  elements.historyPreviewList.appendChild(fragment);
  updateSelectedSummary();
}

/**
 * 游标分批拉取历史记录（核心解决 1500 条限制与 10万+ 巨量数据内存/IPC 暴涨问题）
 * @param {Object} options
 * @param {boolean} [options.isReset=false] - 是否为全新检索（重置游标与清空列表）
 */
async function fetchHistoryBatch({ isReset = false } = {}) {
  if (isLoadingBatch) return;
  if (!isReset && !hasMoreHistory) return;

  const query = (elements.searchInput.value || '').trim();
  const startTime = getStartTimeByFilter(currentSearchTimeFilter);

  elements.btnClearSearch.classList.toggle('hidden', query.length === 0);

  if (isReset) {
    cursorEndTime = 0;
    hasMoreHistory = true;
    currentHistoryResults = [];
    checkedUrls.clear();
    elements.historyPreviewList.innerHTML = '';
    elements.loadMoreSection.classList.add('hidden');
    elements.noMoreHint.classList.add('hidden');
    if (elements.btnDeepClean) {
      elements.btnDeepClean.disabled = true;
    }
  }

  isLoadingBatch = true;
  elements.btnLoadMore.disabled = true;
  elements.loadMoreText.textContent = t('options.loadMoreLoading');

  const batchSize = getBatchSize();

  try {
    const searchParams = {
      text: query,
      startTime,
      maxResults: batchSize
    };

    if (cursorEndTime > 0) {
      searchParams.endTime = cursorEndTime;
    }

    const rawResults = await browserApi.history.search(searchParams);

    const validItems = (rawResults || []).filter(item => {
      return item && item.url && (item.url.startsWith('http://') || item.url.startsWith('https://'));
    });

    // 如果接口返回条数小于请求批次大小，说明历史记录已全部检索完毕
    if (!rawResults || rawResults.length < batchSize) {
      hasMoreHistory = false;
    }

    if (validItems.length > 0) {
      // 游标移动：设定下一次批次拉取的截止时间为本次最后一条记录时间减 1 毫秒
      const oldestVisitTime = validItems[validItems.length - 1].lastVisitTime;
      cursorEndTime = oldestVisitTime - 1;

      if (startTime > 0 && cursorEndTime <= startTime) {
        hasMoreHistory = false;
      }

      currentHistoryResults.push(...validItems);
      appendHistoryBatchToDOM(validItems, true);
    }

    // 状态与空状态处理
    if (currentHistoryResults.length === 0) {
      elements.historyPreviewList.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">🔎</span>
          <p data-i18n="options.emptyHistoryNoMatch">${t('options.emptyHistoryNoMatch')}</p>
        </div>
      `;
      elements.loadMoreSection.classList.add('hidden');
      elements.noMoreHint.classList.add('hidden');
      updateSelectedSummary();
    } else {
      if (hasMoreHistory) {
        elements.loadMoreSection.classList.remove('hidden');
        elements.noMoreHint.classList.add('hidden');
        elements.btnLoadMore.disabled = false;
        elements.loadMoreText.textContent = t('options.loadMoreBtn', { count: batchSize });
      } else {
        elements.loadMoreSection.classList.add('hidden');
        elements.noMoreHint.classList.remove('hidden');
      }
    }

    elements.searchResultsSummary.textContent = t('options.loadedSummary', { count: currentHistoryResults.length });
    if (elements.tabHistoryBadge) {
      elements.tabHistoryBadge.textContent = currentHistoryResults.length;
    }

    // 历史批量删除页面全部清空按钮：列表中有数据即可点击，无数据时禁用
    if (elements.btnDeepClean) {
      elements.btnDeepClean.disabled = currentHistoryResults.length === 0 || isOperatingCleaning;
    }
  } catch (err) {
    console.error('Fetch history batch failed:', err);
    showToast(`${t('options.toastImportFailed', { error: err.message })}`);
  } finally {
    isLoadingBatch = false;
  }
}

/**
 * 历史列表联动刷新策略：
 * 若当前处于 Batch History Delete 视图，则立即全新拉取刷新；
 * 若当前处于规则/设置等非激活面板，则打上 isHistoryDirty 标记，用户切回该面板时自动重新拉取。
 */
async function refreshHistoryIfVisibleOrMarkDirty() {
  isHistoryDirty = true;
  if (elements.panelHistory && !elements.panelHistory.classList.contains('hidden')) {
    isHistoryDirty = false;
    await fetchHistoryBatch({ isReset: true });
  }
}

/**
 * 防抖执行全新检索
 */
function debouncedSearch() {
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
  }
  searchDebounceTimer = setTimeout(() => {
    fetchHistoryBatch({ isReset: true });
  }, 250);
}

/**
 * 分块并发删除指定的 URL 列表，通过宏任务分片让出主线程，实时更新进度条
 * @param {string[]} urls - 目标 URL 列表
 * @param {string} [title='正在批量清理历史...']
 * @returns {Promise<number>} 成功处理条数
 */
async function deleteUrlsWithProgress(urls, title = '正在批量清理历史...') {
  if (!urls || urls.length === 0) return 0;
  if (isOperatingCleaning) {
    showToast('已有清理任务正在执行中，请稍候...');
    return 0;
  }

  isOperatingCleaning = true;
  elements.progressContainer.classList.remove('hidden');
  elements.progressStatusText.textContent = title;
  elements.progressPercentText.textContent = `0% (0/${urls.length})`;
  elements.progressFillBar.style.width = '0%';

  elements.btnDeleteSelected.disabled = true;
  if (elements.btnDeepClean) elements.btnDeepClean.disabled = true;

  const total = urls.length;
  let processed = 0;
  const chunkSize = getDeleteChunkSize();

  try {
    for (let i = 0; i < total; i += chunkSize) {
      const chunk = urls.slice(i, i + chunkSize);
      await Promise.allSettled(chunk.map(url => browserApi.history.deleteUrl(url)));
      processed += chunk.length;

      const percent = Math.min(100, Math.round((processed / total) * 100));
      elements.progressFillBar.style.width = `${percent}%`;
      elements.progressPercentText.textContent = `${percent}% (${processed}/${total})`;

      // 宏任务让出主线程控制权，给浏览器重绘 UI 和响应事件的机会（避免 10万级操作导致无响应弹窗）
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  } finally {
    setTimeout(() => {
      elements.progressContainer.classList.add('hidden');
      elements.progressFillBar.style.width = '0%';
    }, 800);

    isOperatingCleaning = false;
    updateSelectedSummary();
  }

  return processed;
}

/**
 * 流式全量清空：针对十万级匹配结果，无需挂载海量 DOM，直接在底层按批次边检索边删除并分片让出线程
 */
async function streamCleanAllMatches() {
  if (currentHistoryResults.length === 0) {
    return;
  }

  const query = (elements.searchInput.value || '').trim();

  if (currentSettings.confirmDeepClean !== false) {
    const confirmMessage = query
      ? t('options.confirmDeepClean', { query })
      : t('options.confirmDeepCleanAll');
    const confirmed = window.confirm(confirmMessage);
    if (!confirmed) return;
  }

  if (isOperatingCleaning) {
    showToast(t('options.progressCleaning'));
    return;
  }

  isOperatingCleaning = true;
  elements.btnDeleteSelected.disabled = true;
  if (elements.btnDeepClean) elements.btnDeepClean.disabled = true;

  elements.progressContainer.classList.remove('hidden');
  elements.progressStatusText.textContent = t('options.progressStreamPreparing', { query: query || t('options.filterAll') });
  elements.progressPercentText.textContent = '...';
  elements.progressFillBar.style.width = '100%';

  const startTime = getStartTimeByFilter(currentSearchTimeFilter);
  let totalDeleted = 0;
  const STREAM_BATCH_SIZE = 200;
  const chunkSize = getDeleteChunkSize();

  try {
    while (true) {
      const batch = await browserApi.history.search({
        text: query,
        startTime,
        maxResults: STREAM_BATCH_SIZE
      });

      const validUrls = (batch || [])
        .map(item => item?.url)
        .filter(url => url && (url.startsWith('http://') || url.startsWith('https://')));

      if (validUrls.length === 0) {
        break;
      }

      // 分块删除
      for (let i = 0; i < validUrls.length; i += chunkSize) {
        const chunk = validUrls.slice(i, i + chunkSize);
        await Promise.allSettled(chunk.map(url => browserApi.history.deleteUrl(url)));
        totalDeleted += chunk.length;
        elements.progressStatusText.textContent = t('options.progressStreamCleaning', { count: totalDeleted });
        elements.progressPercentText.textContent = `${totalDeleted}`;
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      // 稍微让出 10ms，避免底层 SQLite 写事务竞争
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    showToast(t('options.toastStreamCleanSuccess', { count: totalDeleted }));
    await fetchHistoryBatch({ isReset: true });
  } catch (err) {
    console.error('Stream clean failed:', err);
    showToast(t('options.toastImportFailed', { error: err.message }));
  } finally {
    setTimeout(() => {
      elements.progressContainer.classList.add('hidden');
      elements.progressFillBar.style.width = '0%';
    }, 800);
    isOperatingCleaning = false;
    updateSelectedSummary();
  }
}

// 绑定搜索与筛选事件
elements.searchInput.addEventListener('input', () => {
  updateSelectedSummary();
  debouncedSearch();
});
elements.btnClearSearch.addEventListener('click', () => {
  elements.searchInput.value = '';
  elements.btnClearSearch.classList.add('hidden');
  updateSelectedSummary();
  fetchHistoryBatch({ isReset: true });
});

elements.timeFilters.forEach(btn => {
  btn.addEventListener('click', () => {
    elements.timeFilters.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentSearchTimeFilter = btn.dataset.time;
    fetchHistoryBatch({ isReset: true });
  });
});

// 单一事件委托监听器：无论加载 100 条还是 10 万条，只使用一个父级事件监听器，避免海量内存闭包
elements.historyPreviewList.addEventListener('click', (e) => {
  const row = e.target.closest('.history-item');
  if (!row) return;

  const url = row.dataset.url;
  if (!url) return;

  const checkbox = row.querySelector('.history-checkbox');
  if (e.target !== checkbox) {
    checkbox.checked = !checkbox.checked;
  }

  if (checkbox.checked) {
    checkedUrls.add(url);
    row.classList.add('checked');
  } else {
    checkedUrls.delete(url);
    row.classList.remove('checked');
  }
  updateSelectedSummary();
});

// 全选与反选（直接操作现有 DOM 状态，杜绝重新渲染导致的界面白屏闪烁）
elements.btnSelectAll.addEventListener('click', () => {
  currentHistoryResults.forEach(item => checkedUrls.add(item.url));
  const rows = elements.historyPreviewList.querySelectorAll('.history-item');
  rows.forEach(row => {
    row.classList.add('checked');
    const cb = row.querySelector('.history-checkbox');
    if (cb) cb.checked = true;
  });
  updateSelectedSummary();
});

elements.btnInvertSelect.addEventListener('click', () => {
  const newSet = new Set();
  currentHistoryResults.forEach(item => {
    if (!checkedUrls.has(item.url)) {
      newSet.add(item.url);
    }
  });
  checkedUrls = newSet;

  const rows = elements.historyPreviewList.querySelectorAll('.history-item');
  rows.forEach(row => {
    const isChecked = checkedUrls.has(row.dataset.url);
    row.classList.toggle('checked', isChecked);
    const cb = row.querySelector('.history-checkbox');
    if (cb) cb.checked = isChecked;
  });
  updateSelectedSummary();
});

// 点击加载下一批与触底滚动监听
elements.btnLoadMore.addEventListener('click', () => {
  fetchHistoryBatch({ isReset: false });
});

if (elements.historyScrollContainer) {
  elements.historyScrollContainer.addEventListener('scroll', () => {
    if (!hasMoreHistory || isLoadingBatch) return;
    const { scrollTop, scrollHeight, clientHeight } = elements.historyScrollContainer;
    if (scrollTop + clientHeight >= scrollHeight - 60) {
      fetchHistoryBatch({ isReset: false });
    }
  });
}

// 批量删除选中的记录（分块并发 + 宏任务让出线程）
elements.btnDeleteSelected.addEventListener('click', async () => {
  const targets = Array.from(checkedUrls);
  if (targets.length === 0) return;

  const count = targets.length;
  try {
    const deletedCount = await deleteUrlsWithProgress(targets, t('options.progressDeletingSelected', { count }));
    showToast(t('options.toastDeleteSelectedSuccess', { count: deletedCount }));
    await fetchHistoryBatch({ isReset: true });
  } catch (err) {
    showToast(t('options.toastImportFailed', { error: err.message }));
  }
});


// 流式全量清空
if (elements.btnDeepClean) {
  elements.btnDeepClean.addEventListener('click', streamCleanAllMatches);
}

/* ==========================================================================
   防护规则管理
   ========================================================================== */

/**
 * 渲染规则管理列表
 */
async function refreshRulesList() {
  await refreshGlobalStats();
  elements.rulesContainer.innerHTML = '';

  if (cachedRules.length === 0) {
    elements.rulesContainer.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">📋</span>
        <p data-i18n="options.emptyRules">${t('options.emptyRules')}</p>
      </div>
    `;
    return;
  }

  const fragment = document.createDocumentFragment();

  cachedRules.forEach(rule => {
    const row = document.createElement('div');
    row.className = `rule-row ${rule.enabled === false ? 'disabled' : ''}`;
    row.dataset.id = rule.id;

    let typeLabel, typeClass;
    if (rule.type === 'keyword') {
      typeLabel = t('options.tagKeyword');
      typeClass = 'type-keyword';
    } else if (rule.type === 'path') {
      typeLabel = t('options.tagPath');
      typeClass = 'type-path';
    } else {
      typeLabel = t('options.tagDomain');
      typeClass = 'type-domain';
    }
    const isHitTrackingEnabled = currentSettings.enableHitTracking !== false;
    const hitsText = t('options.ruleHitsCount', { count: rule.hits || 0 });
    const hitsBadgeHtml = isHitTrackingEnabled
      ? `<span class="hits-badge" title="${t('options.statTotalHitsTitle')}">${hitsText}</span>`
      : '';
    const toggleTitle = rule.enabled !== false ? t('options.ruleToggleActive') : t('options.ruleToggleDisabled');

    row.innerHTML = `
      <div class="rule-left">
        <span class="rule-type-badge ${typeClass}">${typeLabel}</span>
        <span class="rule-pattern" title="${escapeHtml(rule.pattern)}">${escapeHtml(rule.pattern)}</span>
      </div>
      <div class="rule-right">
        ${hitsBadgeHtml}
        <label class="toggle-switch" title="${toggleTitle}">
          <input type="checkbox" class="rule-toggle" ${rule.enabled !== false ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
        <button class="rule-delete-btn" title="${t('options.ruleDeleteTitle')}">🗑️</button>
      </div>
    `;

    // 绑定 Toggle 开关
    const toggle = row.querySelector('.rule-toggle');
    toggle.addEventListener('change', async () => {
      await toggleRule(rule.id, toggle.checked);
      row.classList.toggle('disabled', !toggle.checked);
      toggle.parentElement.title = toggle.checked ? t('options.ruleToggleActive') : t('options.ruleToggleDisabled');
      await refreshGlobalStats();
    });

    // 绑定删除按钮
    const delBtn = row.querySelector('.rule-delete-btn');
    delBtn.addEventListener('click', async () => {
      await deleteRule(rule.id);
      showToast(t('options.toastDeleteRuleSuccess', { pattern: rule.pattern }));
      await refreshRulesList();
    });

    fragment.appendChild(row);
  });

  elements.rulesContainer.appendChild(fragment);
}

// 手动新增规则
elements.btnAddRule.addEventListener('click', async () => {
  const pattern = (elements.newRuleInput.value || '').trim();
  const selectedType = elements.newRuleType.value;
  const type = selectedType === 'auto' ? undefined : selectedType;

  if (!pattern) {
    showToast(t('options.toastImportFailed', { error: 'Pattern required' }));
    elements.newRuleInput.focus();
    return;
  }

  const originalHtml = elements.btnAddRule.innerHTML;

  try {
    elements.btnAddRule.disabled = true;
    elements.btnAddRule.style.opacity = '0.7';
    elements.btnAddRule.innerHTML = `<span>⏳ ${t('options.btnAddingAndCleaning')}</span>`;

    // 1. 添加或激活规则
    const { rule, isNew } = await addRule({ pattern, type });

    // 2. 自动回溯清理已有历史匹配数据
    const chunkSize = getDeleteChunkSize();
    const cleanResult = await cleanHistoryByRule(rule, {
      chunkSize,
      onProgress: ({ deleted }) => {
        if (deleted > 0) {
          elements.btnAddRule.innerHTML = `<span>🧹 ${t('options.btnCleaningWithCount', { count: deleted })}</span>`;
        }
      }
    });

    if (cleanResult.deleted > 0) {
      showToast(t('options.toastAddRuleSuccessWithCleaned', {
        pattern: rule.pattern,
        count: cleanResult.deleted
      }));
    } else {
      showToast(isNew ? t('options.toastAddRuleSuccess', { pattern: rule.pattern }) : t('options.toastRuleAlreadyExists'));
    }

    elements.newRuleInput.value = '';
    await refreshRulesList();

    // 3. 联动刷新历史记录列表（若当前在 history 则立即刷新，不在则标记切回时刷新）
    await refreshHistoryIfVisibleOrMarkDirty();
  } catch (err) {
    console.error('Add rule and clean history failed:', err);
    showToast(t('options.toastImportFailed', { error: err.message }));
  } finally {
    elements.btnAddRule.disabled = false;
    elements.btnAddRule.style.opacity = '1';
    elements.btnAddRule.innerHTML = originalHtml;
  }
});

// 支持回车快捷添加
elements.newRuleInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    elements.btnAddRule.click();
  }
});

// 底部操作：一键全部启用
if (elements.btnEnableAll) {
  elements.btnEnableAll.addEventListener('click', async () => {
    const rules = await getRules();
    rules.forEach(r => r.enabled = true);
    await saveRules(rules);
    showToast(t('options.toastEnableAllSuccess'));
    await refreshRulesList();
  });
}

// 工具栏：反转状态
if (elements.btnToggleAll) {
  elements.btnToggleAll.addEventListener('click', async () => {
    const rules = await getRules();
    rules.forEach(r => r.enabled = !r.enabled);
    await saveRules(rules);
    showToast(t('options.toastToggleAllSuccess'));
    await refreshRulesList();
  });
}

// 底部操作：清理已停用规则
if (elements.btnClearDisabled) {
  elements.btnClearDisabled.addEventListener('click', async () => {
    const rules = await getRules();
    const activeRules = rules.filter(r => r.enabled !== false);
    const removedCount = rules.length - activeRules.length;
    if (removedCount === 0) {
      showToast(t('options.toastNoDisabledRules'));
      return;
    }
    await saveRules(activeRules);
    showToast(t('options.toastClearDisabledSuccess', { count: removedCount }));
    await refreshRulesList();
  });
}

/* ==========================================================================
   高级偏好设置管理 (拦截统计、数据迁移备份、运行参数)
   ========================================================================== */

/**
 * 将配置项载入到设置页面控件中
 */
async function loadSettingsToUI() {
  currentSettings = await getSettings();

  if (elements.settingTheme) {
    elements.settingTheme.value = currentSettings.theme || 'auto';
  }
  if (elements.settingLanguage) {
    elements.settingLanguage.value = currentSettings.language || 'auto';
  }
  if (elements.settingEnableHitTracking) {
    elements.settingEnableHitTracking.checked = currentSettings.enableHitTracking !== false;
  }
  if (elements.settingSilentDuration) {
    elements.settingSilentDuration.value = String(currentSettings.silentModeDuration || 30);
  }
  if (elements.settingDefaultRuleType) {
    elements.settingDefaultRuleType.value = currentSettings.defaultRuleType || 'auto';
  }
  if (elements.settingHistoryBatchSize) {
    elements.settingHistoryBatchSize.value = String(currentSettings.historyBatchSize || 100);
  }
  if (elements.settingDeleteChunkSize) {
    elements.settingDeleteChunkSize.value = String(currentSettings.deleteChunkSize || 30);
  }
  if (elements.settingConfirmDeepClean) {
    elements.settingConfirmDeepClean.checked = currentSettings.confirmDeepClean !== false;
  }
  if (elements.settingToastDuration) {
    elements.settingToastDuration.value = String(currentSettings.toastDuration || 2500);
  }
}

// 绑定设置变更事件并即时持久化
let themeCleanup = () => {};

/**
 * 切换并应用当前主题偏好，若设为 auto 则挂载系统偏好监听
 * @param {'auto' | 'dark' | 'light'} themePref
 */
function updateActiveTheme(themePref) {
  if (typeof themeCleanup === 'function') {
    themeCleanup();
  }
  const result = initTheme(themePref, {
    onChange: (systemTheme) => {
      console.log(`[HistGuard] System theme changed to: ${systemTheme}`);
    }
  });
  themeCleanup = result.cleanup;
}

// 外观主题选项选择与即时生效
if (elements.settingTheme) {
  elements.settingTheme.addEventListener('change', async () => {
    const val = elements.settingTheme.value;
    await saveSettings({ theme: val });
    currentSettings.theme = val;
    updateActiveTheme(val);
    showToast(t('options.toastThemeChanged'));
  });
}

// 语言选项选择与即时生效
if (elements.settingLanguage) {
  elements.settingLanguage.addEventListener('change', async () => {
    const val = elements.settingLanguage.value;
    await saveSettings({ language: val });
    currentSettings.language = val;
    setLanguage(val);
    await refreshGlobalStats();
    updateSelectedSummary();
    await refreshRulesList();
    showToast(t('options.toastLanguageChanged'));
  });
}

if (elements.settingEnableHitTracking) {
  elements.settingEnableHitTracking.addEventListener('change', async () => {
    const val = elements.settingEnableHitTracking.checked;
    await saveSettings({ enableHitTracking: val });
    currentSettings.enableHitTracking = val;
    showToast(val ? t('options.toastHitTrackingOn') : t('options.toastHitTrackingOff'));
    await refreshGlobalStats();
    await refreshRulesList();
  });
}

if (elements.btnResetHits) {
  elements.btnResetHits.addEventListener('click', async () => {
    const ok = window.confirm(t('options.confirmResetHits'));
    if (!ok) return;

    try {
      const resetCount = await resetRuleHits();
      showToast(t('options.toastResetHitsSuccess', { count: resetCount }));
      await refreshRulesList();
    } catch (err) {
      showToast(t('options.toastImportFailed', { error: err.message }));
    }
  });
}

// 设置页：规则 JSON 导出
if (elements.btnSettingsExportJson) {
  elements.btnSettingsExportJson.addEventListener('click', async () => {
    try {
      const jsonStr = await exportRules();
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const dateStr = new Date().toISOString().slice(0, 10);

      const a = document.createElement('a');
      a.href = url;
      a.download = `histguard-rules-${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast(t('options.toastExportSuccess'));
    } catch (err) {
      showToast(t('options.toastImportFailed', { error: err.message }));
    }
  });
}

// 设置页：规则 JSON 导入
if (elements.btnSettingsImportJson) {
  elements.btnSettingsImportJson.addEventListener('click', () => {
    if (elements.fileSettingsImport) {
      elements.fileSettingsImport.value = '';
      elements.fileSettingsImport.click();
    }
  });
}

if (elements.fileSettingsImport) {
  elements.fileSettingsImport.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const mode = elements.settingImportMode ? elements.settingImportMode.value : 'merge';
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const content = event.target?.result;
        const { importedCount, totalCount } = await importRules(content, mode);
        showToast(
          mode === 'replace'
            ? t('options.toastImportReplaceSuccess', { count: importedCount })
            : t('options.toastImportMergeSuccess', { imported: importedCount, total: totalCount })
        );
        await refreshRulesList();
      } catch (err) {
        showToast(t('options.toastImportFailed', { error: err.message }));
      }
    };
    reader.readAsText(file);
  });
}

// 设置页：清空所有规则
if (elements.btnClearAllRules) {
  elements.btnClearAllRules.addEventListener('click', async () => {
    const ok = window.confirm(t('options.confirmClearAllRules'));
    if (!ok) return;

    try {
      await clearAllRules();
      showToast(t('options.toastClearRulesSuccess'));
      await refreshRulesList();
    } catch (err) {
      showToast(t('options.toastImportFailed', { error: err.message }));
    }
  });
}

// 偏好下拉框即时保存
if (elements.settingSilentDuration) {
  elements.settingSilentDuration.addEventListener('change', async () => {
    const val = Number(elements.settingSilentDuration.value) || 30;
    await saveSettings({ silentModeDuration: val });
    currentSettings.silentModeDuration = val;
    showToast(t('options.toastSilentDurationChanged', { val }));
  });
}

if (elements.settingDefaultRuleType) {
  elements.settingDefaultRuleType.addEventListener('change', async () => {
    const val = elements.settingDefaultRuleType.value;
    await saveSettings({ defaultRuleType: val });
    currentSettings.defaultRuleType = val;
    showToast(t('options.toastDefaultRuleTypeChanged'));
  });
}

if (elements.settingHistoryBatchSize) {
  elements.settingHistoryBatchSize.addEventListener('change', async () => {
    const val = Number(elements.settingHistoryBatchSize.value) || 100;
    await saveSettings({ historyBatchSize: val });
    currentSettings.historyBatchSize = val;
    showToast(t('options.toastBatchSizeChanged', { val }));
  });
}

if (elements.settingDeleteChunkSize) {
  elements.settingDeleteChunkSize.addEventListener('change', async () => {
    const val = Number(elements.settingDeleteChunkSize.value) || 30;
    await saveSettings({ deleteChunkSize: val });
    currentSettings.deleteChunkSize = val;
    showToast(t('options.toastChunkSizeChanged', { val }));
  });
}

if (elements.settingConfirmDeepClean) {
  elements.settingConfirmDeepClean.addEventListener('change', async () => {
    const val = elements.settingConfirmDeepClean.checked;
    await saveSettings({ confirmDeepClean: val });
    currentSettings.confirmDeepClean = val;
    showToast(t('options.toastConfirmDeepCleanChanged', { state: val ? t('options.stateEnabled') : t('options.stateDisabled') }));
  });
}

if (elements.settingToastDuration) {
  elements.settingToastDuration.addEventListener('change', async () => {
    const val = Number(elements.settingToastDuration.value) || 2500;
    await saveSettings({ toastDuration: val });
    currentSettings.toastDuration = val;
    showToast(t('options.toastToastDurationChanged', { val: (val / 1000).toFixed(1) }));
  });
}

// 监听跨页面存储变更，实现多窗口实时同步
browserApi.storage.onChanged(async (changes) => {
  if (changes[STORAGE_KEYS.SILENT_MODE]) {
    await refreshSilentModeStatus();
  }
  if (changes[STORAGE_KEYS.RULES]) {
    await refreshRulesList();
    await refreshHistoryIfVisibleOrMarkDirty();
  }
  if (changes[STORAGE_KEYS.SETTINGS]) {
    const newSettings = changes[STORAGE_KEYS.SETTINGS].newValue;
    if (newSettings && typeof newSettings === 'object' && newSettings.language && newSettings.language !== currentSettings.language) {
      setLanguage(newSettings.language);
    }
    await loadSettingsToUI();
    await refreshGlobalStats();
    await refreshRulesList();
  }
});

// 当页面从后台标签页切回前台可见时，立即校验倒计时避免后台节流偏差
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    refreshSilentModeStatus();
    // 切回前台标签时，若期间有历史变更则静默刷新当前视图
    if (isHistoryDirty && elements.panelHistory && !elements.panelHistory.classList.contains('hidden')) {
      isHistoryDirty = false;
      fetchHistoryBatch({ isReset: true });
    }
  }
});

// 监听浏览器底层历史记录物理移除事件，实现全自动化实时同步
if (browserApi.history && typeof browserApi.history.onVisitRemoved === 'function') {
  browserApi.history.onVisitRemoved(() => {
    // 若当前正在由本页面执行主动批量清理，则由清理自身流程统一刷新，避免高频并发重绘
    if (isOperatingCleaning) return;

    isHistoryDirty = true;
    if (elements.panelHistory && !elements.panelHistory.classList.contains('hidden')) {
      if (historyRemovedDebounceTimer) {
        clearTimeout(historyRemovedDebounceTimer);
      }
      historyRemovedDebounceTimer = setTimeout(() => {
        isHistoryDirty = false;
        fetchHistoryBatch({ isReset: true });
      }, 250);
    }
  });
}

/* ==========================================================================
   页面初始化启动
   ========================================================================== */

async function initOptions() {
  // 恢复先前激活的 Tab 状态 (支持 history, rules, settings)
  try {
    const savedTab = localStorage.getItem('histguard_active_options_tab');
    if (savedTab && (savedTab === 'history' || savedTab === 'rules' || savedTab === 'settings')) {
      switchTab(savedTab);
    }
  } catch (err) {
    console.warn('Init tab state notice:', err);
  }

  try {
    const settings = await getSettings();
    initI18n(settings.language || 'auto');
    updateActiveTheme(settings.theme || 'auto');
  } catch (err) {
    console.warn('Init settings notice:', err);
    initI18n('auto');
    updateActiveTheme('auto');
  }

  await loadSettingsToUI();
  await refreshRulesList();
  await fetchHistoryBatch({ isReset: true });
}

document.addEventListener('DOMContentLoaded', initOptions);
