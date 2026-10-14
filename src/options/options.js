/**
 * @file options.js
 * @description Options 独立管理控制台业务逻辑
 * 支持左侧 Tab 导航切换、按搜索结果批量大扫除、规则增删改查、JSON 备份导入导出及全局状态联动
 */

import { browserApi } from '../adapters/index.js';
import { convertSearchTermToRule } from '../core/ruleMatcher.js';
import {
  getRules,
  saveRules,
  addRule,
  toggleRule,
  deleteRule,
  getSilentMode,
  exportRules,
  importRules,
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
  historyPreviewList: document.getElementById('history-preview-list'),
  btnDeleteSelected: document.getElementById('btn-delete-selected'),
  btnDeleteText: document.getElementById('btn-delete-text'),
  btnDeleteAndAddRule: document.getElementById('btn-delete-and-add-rule'),

  // 防护规则管理
  newRuleInput: document.getElementById('new-rule-input'),
  newRuleType: document.getElementById('new-rule-type'),
  btnAddRule: document.getElementById('btn-add-rule'),
  btnImportJson: document.getElementById('btn-import-json'),
  btnExportJson: document.getElementById('btn-export-json'),
  fileImportInput: document.getElementById('file-import-input'),
  rulesCountSummary: document.getElementById('rules-count-summary'),
  rulesContainer: document.getElementById('rules-container'),
  btnToggleAll: document.getElementById('btn-toggle-all'),
  btnEnableAll: document.getElementById('btn-enable-all'),
  btnClearDisabled: document.getElementById('btn-clear-disabled'),

  // 全局 Toast
  toast: document.getElementById('toast')
};

// 状态
let currentSearchTimeFilter = 'all'; // 'all' | '1h' | 'today' | '7d'
let searchDebounceTimer = null;
let currentHistoryResults = [];
let checkedUrls = new Set();
let cachedRules = [];
let toastDismissTimer = null;

/**
 * 弹出提示 Toast
 * @param {string} msg
 * @param {number} [duration=2500]
 */
function showToast(msg, duration = 2500) {
  if (toastDismissTimer) {
    clearTimeout(toastDismissTimer);
    toastDismissTimer = null;
  }
  elements.toast.textContent = msg;
  elements.toast.classList.remove('hidden');
  toastDismissTimer = setTimeout(() => {
    elements.toast.classList.add('hidden');
    toastDismissTimer = null;
  }, duration);
}

/**
 * 左侧 Tab 切换控制
 * @param {'history'|'rules'} tabKey
 */
function switchTab(tabKey) {
  elements.navTabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabKey);
  });

  if (tabKey === 'history') {
    elements.panelHistory.classList.remove('hidden');
    elements.panelHistory.classList.add('active');
    elements.panelRules.classList.add('hidden');
    elements.panelRules.classList.remove('active');
  } else {
    elements.panelRules.classList.remove('hidden');
    elements.panelRules.classList.add('active');
    elements.panelHistory.classList.add('hidden');
    elements.panelHistory.classList.remove('active');
  }

  try {
    localStorage.setItem('histguard_active_options_tab', tabKey);
  } catch (err) {
    console.warn('Cannot persist active tab:', err);
  }
}

// 绑定 Tab 点击事件
elements.navTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    switchTab(tab.dataset.tab);
  });
});

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
  if (!timestamp) return '';
  const d = new Date(timestamp);
  const now = Date.now();
  const diffSec = Math.floor((now - timestamp) / 1000);

  if (diffSec < 60) return '刚刚';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小时前`;

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hour = String(d.getHours()).padStart(2, '0');
  const minute = String(d.getMinutes()).padStart(2, '0');

  return `${year}-${month}-${day} ${hour}:${minute}`;
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

async function refreshGlobalStats() {
  cachedRules = await getRules();
  const activeCount = cachedRules.filter(r => r.enabled !== false).length;
  const totalHits = cachedRules.reduce((sum, r) => sum + (r.hits || 0), 0);

  elements.statActiveRules.textContent = activeCount;
  elements.statTotalHits.textContent = totalHits;

  if (elements.tabRulesBadge) {
    elements.tabRulesBadge.textContent = cachedRules.length;
  }

  const silent = await getSilentMode();
  if (silent.active && silent.remainingMs > 0) {
    const min = Math.ceil(silent.remainingMs / 60000);
    elements.statSilentStatus.textContent = `开启中 (余 ${min}m)`;
    elements.statSilentStatus.className = 'stat-value silent-on';
  } else {
    elements.statSilentStatus.textContent = '未开启';
    elements.statSilentStatus.className = 'stat-value silent-off';
  }

  elements.rulesCountSummary.textContent = `当前共有 ${cachedRules.length} 条防护规则`;
}

/* ==========================================================================
   历史记录批量清理
   ========================================================================== */

/**
 * 更新已勾选数量及底部操作按钮状态
 */
function updateSelectedSummary() {
  const selectedCount = checkedUrls.size;
  elements.selectedSummary.textContent = `已勾选 ${selectedCount} 条`;
  elements.btnDeleteText.textContent = `删除选中的 ${selectedCount} 条记录`;

  const hasSelected = selectedCount > 0;
  elements.btnDeleteSelected.disabled = !hasSelected;
  elements.btnDeleteAndAddRule.disabled = !hasSelected;
}

/**
 * 渲染历史记录预览列表
 */
function renderHistoryList() {
  elements.historyPreviewList.innerHTML = '';

  if (currentHistoryResults.length === 0) {
    elements.historyPreviewList.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">🔎</span>
        <p>未找到符合条件的历史记录</p>
      </div>
    `;
    updateSelectedSummary();
    return;
  }

  const fragment = document.createDocumentFragment();

  currentHistoryResults.forEach((item) => {
    const row = document.createElement('div');
    const isChecked = checkedUrls.has(item.url);
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

    const checkbox = row.querySelector('.history-checkbox');

    // 点击行切换勾选状态
    row.addEventListener('click', (e) => {
      if (e.target !== checkbox) {
        checkbox.checked = !checkbox.checked;
      }
      if (checkbox.checked) {
        checkedUrls.add(item.url);
        row.classList.add('checked');
      } else {
        checkedUrls.delete(item.url);
        row.classList.remove('checked');
      }
      updateSelectedSummary();
    });

    fragment.appendChild(row);
  });

  elements.historyPreviewList.appendChild(fragment);
  updateSelectedSummary();
}

/**
 * 执行历史记录搜索
 */
async function performHistorySearch() {
  const query = (elements.searchInput.value || '').trim();
  const startTime = getStartTimeByFilter(currentSearchTimeFilter);

  elements.btnClearSearch.classList.toggle('hidden', query.length === 0);

  try {
    const rawResults = await browserApi.history.search({
      text: query,
      startTime,
      maxResults: 1500
    });

    currentHistoryResults = (rawResults || []).filter(item => {
      return item && item.url && (item.url.startsWith('http://') || item.url.startsWith('https://'));
    });

    // 默认全选新搜索到的条目
    checkedUrls = new Set(currentHistoryResults.map(i => i.url));

    elements.searchResultsSummary.textContent = `共检索到 ${currentHistoryResults.length} 条`;
    if (elements.tabHistoryBadge) {
      elements.tabHistoryBadge.textContent = currentHistoryResults.length;
    }

    renderHistoryList();
  } catch (err) {
    console.error('Search history failed:', err);
    showToast(`搜索历史失败: ${err.message}`);
  }
}

/**
 * 防抖执行历史检索
 */
function debouncedSearch() {
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
  }
  searchDebounceTimer = setTimeout(performHistorySearch, 250);
}

// 绑定搜索框事件
elements.searchInput.addEventListener('input', debouncedSearch);
elements.btnClearSearch.addEventListener('click', () => {
  elements.searchInput.value = '';
  elements.btnClearSearch.classList.add('hidden');
  performHistorySearch();
});

// 绑定时间筛选胶囊
elements.timeFilters.forEach(btn => {
  btn.addEventListener('click', () => {
    elements.timeFilters.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentSearchTimeFilter = btn.dataset.time;
    performHistorySearch();
  });
});

// 全选与反选
elements.btnSelectAll.addEventListener('click', () => {
  checkedUrls = new Set(currentHistoryResults.map(i => i.url));
  renderHistoryList();
});

elements.btnInvertSelect.addEventListener('click', () => {
  const newSet = new Set();
  currentHistoryResults.forEach(item => {
    if (!checkedUrls.has(item.url)) {
      newSet.add(item.url);
    }
  });
  checkedUrls = newSet;
  renderHistoryList();
});

// 批量删除选中的记录
elements.btnDeleteSelected.addEventListener('click', async () => {
  const targets = Array.from(checkedUrls);
  if (targets.length === 0) return;

  const count = targets.length;
  elements.btnDeleteSelected.disabled = true;
  elements.btnDeleteSelected.style.opacity = '0.7';

  try {
    for (const url of targets) {
      try {
        await browserApi.history.deleteUrl(url);
      } catch (err) {
        console.error('Delete url failed:', url, err);
      }
    }
    showToast(`成功物理删除 ${count} 条历史记录`);
    await performHistorySearch();
  } catch (err) {
    showToast(`删除失败: ${err.message}`);
  } finally {
    elements.btnDeleteSelected.disabled = false;
    elements.btnDeleteSelected.style.opacity = '1';
  }
});

// 删除记录并将搜索词加入永久隐藏规则
elements.btnDeleteAndAddRule.addEventListener('click', async () => {
  const targets = Array.from(checkedUrls);
  const searchTerm = (elements.searchInput.value || '').trim();

  if (!searchTerm) {
    showToast('当前搜索词为空，请先在搜索框输入关键词或域名');
    return;
  }

  const { pattern, type } = convertSearchTermToRule(searchTerm);
  if (!pattern) {
    showToast('无法将该搜索词转换为有效规则表达式');
    return;
  }

  elements.btnDeleteAndAddRule.disabled = true;
  elements.btnDeleteAndAddRule.style.opacity = '0.7';

  try {
    // 1. 添加为永久规则
    const { rule, isNew } = await addRule({ pattern, type, enabled: true });

    // 2. 删除选中的记录
    let deletedCount = 0;
    for (const url of targets) {
      try {
        await browserApi.history.deleteUrl(url);
        deletedCount++;
      } catch (err) {
        console.error('Delete url failed:', url, err);
      }
    }

    showToast(`已${isNew ? '添加' : '更新'}规则 [${pattern}] 并清理 ${deletedCount} 条历史`);
    await refreshRulesList();
    await performHistorySearch();
  } catch (err) {
    showToast(`操作失败: ${err.message}`);
  } finally {
    elements.btnDeleteAndAddRule.disabled = false;
    elements.btnDeleteAndAddRule.style.opacity = '1';
  }
});

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
        <p>暂无配置规则，您可在左侧历史大扫除中加入，或在上方手动添加</p>
      </div>
    `;
    return;
  }

  const fragment = document.createDocumentFragment();

  cachedRules.forEach(rule => {
    const row = document.createElement('div');
    row.className = `rule-row ${rule.enabled === false ? 'disabled' : ''}`;
    row.dataset.id = rule.id;

    const isDomain = rule.type === 'domain';
    const typeLabel = isDomain ? '域名' : '路径';
    const typeClass = isDomain ? 'type-domain' : 'type-path';

    row.innerHTML = `
      <div class="rule-left">
        <span class="rule-type-badge ${typeClass}">${typeLabel}</span>
        <span class="rule-pattern" title="${escapeHtml(rule.pattern)}">${escapeHtml(rule.pattern)}</span>
      </div>
      <div class="rule-right">
        <span class="hits-badge" title="累计拦截次数">拦截 ${rule.hits || 0} 次</span>
        <label class="toggle-switch" title="${rule.enabled !== false ? '已启用，点击暂停' : '已暂停，点击启用'}">
          <input type="checkbox" class="rule-toggle" ${rule.enabled !== false ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
        <button class="rule-delete-btn" title="删除该规则">🗑️</button>
      </div>
    `;

    // 绑定 Toggle 开关
    const toggle = row.querySelector('.rule-toggle');
    toggle.addEventListener('change', async () => {
      await toggleRule(rule.id, toggle.checked);
      row.classList.toggle('disabled', !toggle.checked);
      toggle.parentElement.title = toggle.checked ? '已启用，点击暂停' : '已暂停，点击启用';
      await refreshGlobalStats();
    });

    // 绑定删除按钮
    const delBtn = row.querySelector('.rule-delete-btn');
    delBtn.addEventListener('click', async () => {
      await deleteRule(rule.id);
      showToast(`已删除规则: ${rule.pattern}`);
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
    showToast('请输入有效的规则表达式');
    elements.newRuleInput.focus();
    return;
  }

  try {
    const { rule, isNew } = await addRule({ pattern, type });
    showToast(isNew ? `成功添加规则: ${rule.pattern}` : `规则已存在，已恢复为启用状态`);
    elements.newRuleInput.value = '';
    await refreshRulesList();
  } catch (err) {
    showToast(`添加失败: ${err.message}`);
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
    showToast('已全部启用所有防护规则');
    await refreshRulesList();
  });
}

// 工具栏：反转状态
if (elements.btnToggleAll) {
  elements.btnToggleAll.addEventListener('click', async () => {
    const rules = await getRules();
    rules.forEach(r => r.enabled = !r.enabled);
    await saveRules(rules);
    showToast('已反转所有规则启用状态');
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
      showToast('当前没有已停用的规则可清理');
      return;
    }
    await saveRules(activeRules);
    showToast(`已清理 ${removedCount} 条已停用的防护规则`);
    await refreshRulesList();
  });
}

// JSON 导出
elements.btnExportJson.addEventListener('click', async () => {
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

    showToast('规则已成功导出为 JSON 文件');
  } catch (err) {
    showToast(`导出失败: ${err.message}`);
  }
});

// JSON 导入
elements.btnImportJson.addEventListener('click', () => {
  elements.fileImportInput.value = '';
  elements.fileImportInput.click();
});

elements.fileImportInput.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const content = event.target?.result;
      const { importedCount, totalCount } = await importRules(content, 'merge');
      showToast(`导入成功：新增 ${importedCount} 条规则，当前共 ${totalCount} 条`);
      await refreshRulesList();
    } catch (err) {
      showToast(`导入失败: ${err.message}`);
    }
  };
  reader.readAsText(file);
});

// 监听跨页面存储变更，实现多窗口实时同步
browserApi.storage.onChanged((changes) => {
  if (changes[STORAGE_KEYS.RULES] || changes[STORAGE_KEYS.SILENT_MODE]) {
    refreshRulesList();
  }
});

/* ==========================================================================
   页面初始化启动
   ========================================================================== */

async function initOptions() {
  // 恢复先前激活的 Tab 状态
  try {
    const savedTab = localStorage.getItem('histguard_active_options_tab');
    if (savedTab && (savedTab === 'history' || savedTab === 'rules')) {
      switchTab(savedTab);
    }
  } catch (err) {
    console.warn('Init tab state notice:', err);
  }

  await refreshRulesList();
  await performHistorySearch();
}

document.addEventListener('DOMContentLoaded', initOptions);
