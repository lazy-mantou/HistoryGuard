/**
 * @file FirefoxAdapter.js
 * @description Firefox (Gecko 内核) 专用适配器实现
 * 封装原生 browser.* Promise 命名空间，处理 Firefox 历史记录查询参数、弹窗上下文与生命周期差异
 */

import { IBrowserAdapter } from './IBrowserAdapter.js';

export class FirefoxAdapter extends IBrowserAdapter {
  constructor() {
    super();
    this.name = 'firefox';
    this.engine = 'gecko';
    this.isFirefox = true;

    // 获取 Firefox 原生 browser 对象或兜底到 chrome
    const getApi = () => {
      if (typeof browser !== 'undefined') return browser;
      if (typeof chrome !== 'undefined') return chrome;
      throw new Error('Neither browser nor chrome API is available in this environment');
    };

    // History API
    this.history = {
      onVisited: (callback) => {
        const api = getApi();
        if (api.history?.onVisited) {
          api.history.onVisited.addListener(callback);
        }
      },

      onVisitRemoved: (callback) => {
        const api = getApi();
        if (api.history?.onVisitRemoved) {
          api.history.onVisitRemoved.addListener((removed) => {
            callback(removed);
          });
        }
      },

      search: async ({ text = '', startTime = 0, endTime = 0, maxResults = 100 } = {}) => {
        const api = getApi();
        if (!api.history?.search) {
          throw new Error('browser.history API is not available');
        }

        const queryDetails = {
          startTime: typeof startTime === 'number' ? startTime : 0,
          maxResults: typeof maxResults === 'number' && maxResults > 0 ? maxResults : 100
        };

        // 支持 endTime 游标分页
        if (typeof endTime === 'number' && endTime > 0) {
          queryDetails.endTime = endTime;
        }

        // Firefox 历史搜索：仅当 text 非空时传值，空字符串在部分版本下可能无法正确匹配全量
        if (typeof text === 'string') {
          queryDetails.text = text;
        }

        const results = await api.history.search(queryDetails);
        return results || [];
      },

      deleteUrl: async (url) => {
        const api = getApi();
        if (!api.history?.deleteUrl) {
          throw new Error('browser.history API is not available');
        }

        const targetUrl = typeof url === 'string' ? url : url?.url;
        if (!targetUrl) return;

        await api.history.deleteUrl({ url: targetUrl });
      }
    };

    // Storage API
    this.storage = {
      get: async (keys) => {
        const api = getApi();
        if (!api.storage?.local) {
          throw new Error('browser.storage.local API is not available');
        }

        const result = await api.storage.local.get(keys);
        return result || {};
      },

      set: async (items) => {
        const api = getApi();
        if (!api.storage?.local) {
          throw new Error('browser.storage.local API is not available');
        }

        await api.storage.local.set(items);
      },

      onChanged: (callback) => {
        const api = getApi();
        if (api.storage?.onChanged) {
          api.storage.onChanged.addListener((changes, areaName) => {
            if (areaName === 'local') {
              callback(changes);
            }
          });
        }
      }
    };

    // Tabs API
    this.tabs = {
      getCurrentActiveTab: async () => {
        const api = getApi();
        if (!api.tabs?.query) {
          throw new Error('browser.tabs API is not available');
        }

        // 1. 优先查询当前活动窗口中的活动标签页
        let tabs = await api.tabs.query({ active: true, currentWindow: true });

        // 2. Firefox 核心兜底机制：在 Popup 独立视窗中，currentWindow 可能指向弹出层自身，需查询 lastFocusedWindow
        if (!tabs || tabs.length === 0 || (!tabs[0].url && !tabs[0].pendingUrl)) {
          tabs = await api.tabs.query({ active: true, lastFocusedWindow: true });
        }

        // 3. 移动端 (Firefox for Android) 专用兜底：移动端无独立桌面窗口，直接查询全局活动标签
        if (!tabs || tabs.length === 0 || (!tabs[0].url && !tabs[0].pendingUrl)) {
          tabs = await api.tabs.query({ active: true });
        }

        if (tabs && tabs.length > 0 && (tabs[0].url || tabs[0].pendingUrl)) {
          const activeTab = tabs[0];
          return {
            id: activeTab.id,
            url: activeTab.url || activeTab.pendingUrl || '',
            title: activeTab.title || ''
          };
        }
        return null;
      },

      get: async (tabId) => {
        const api = getApi();
        if (!api.tabs?.get || typeof tabId !== 'number') return null;
        try {
          const tab = await api.tabs.get(tabId);
          if (!tab) return null;
          return {
            id: tab.id,
            url: tab.url || '',
            title: tab.title || ''
          };
        } catch {
          return null;
        }
      },

      query: async (queryInfo = {}) => {
        const api = getApi();
        if (!api.tabs?.query) return [];
        try {
          const tabs = await api.tabs.query(queryInfo);
          if (!Array.isArray(tabs)) return [];
          return tabs.map(t => ({
            id: t.id,
            url: t.url || '',
            title: t.title || ''
          }));
        } catch {
          return [];
        }
      },

      onUpdated: (callback) => {
        const api = getApi();
        if (api.tabs?.onUpdated) {
          api.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            callback(tabId, changeInfo, tab);
          });
        }
      },

      onActivated: (callback) => {
        const api = getApi();
        if (api.tabs?.onActivated) {
          api.tabs.onActivated.addListener((activeInfo) => {
            callback(activeInfo);
          });
        }
      }
    };

    // Action API (工具栏图标、角标 Badge 与 Tooltip 动态状态提示)
    this.action = {
      setBadgeText: async ({ text = '', tabId } = {}) => {
        const api = getApi();
        const actionApi = api.action || api.browserAction;
        if (!actionApi?.setBadgeText) return;
        const details = { text: String(text || '') };
        if (typeof tabId === 'number') details.tabId = tabId;
        try {
          await actionApi.setBadgeText(details);
        } catch { /* ignore */ }
      },

      setBadgeBackgroundColor: async ({ color = '#10b981', tabId } = {}) => {
        const api = getApi();
        const actionApi = api.action || api.browserAction;
        if (!actionApi?.setBadgeBackgroundColor) return;
        const details = { color };
        if (typeof tabId === 'number') details.tabId = tabId;
        try {
          await actionApi.setBadgeBackgroundColor(details);
        } catch { /* ignore */ }
      },

      setTitle: async ({ title = '', tabId } = {}) => {
        const api = getApi();
        const actionApi = api.action || api.browserAction;
        if (!actionApi?.setTitle) return;
        const details = { title: String(title || '') };
        if (typeof tabId === 'number') details.tabId = tabId;
        try {
          await actionApi.setTitle(details);
        } catch { /* ignore */ }
      },

      setIcon: async ({ path, tabId } = {}) => {
        const api = getApi();
        const actionApi = api.action || api.browserAction;
        if (!actionApi?.setIcon) return;
        let normalizedPath = path;
        if (typeof path === 'string') {
          normalizedPath = path.startsWith('/') ? path : `/${path}`;
        } else if (path && typeof path === 'object') {
          normalizedPath = {};
          for (const [size, p] of Object.entries(path)) {
            normalizedPath[size] = (typeof p === 'string' && !p.startsWith('/')) ? `/${p}` : p;
          }
        }
        const details = { path: normalizedPath };
        if (typeof tabId === 'number') details.tabId = tabId;
        try {
          await actionApi.setIcon(details);
        } catch { /* ignore */ }
      }
    };

    // WebNavigation API
    this.webNavigation = {
      onHistoryStateUpdated: (callback) => {
        const api = getApi();
        if (api.webNavigation?.onHistoryStateUpdated) {
          api.webNavigation.onHistoryStateUpdated.addListener((details) => {
            callback(details);
          });
        }
      },
      onCommitted: (callback) => {
        const api = getApi();
        if (api.webNavigation?.onCommitted) {
          api.webNavigation.onCommitted.addListener((details) => {
            callback(details);
          });
        }
      }
    };

    // Runtime API
    this.runtime = {
      openOptionsPage: async () => {
        const api = getApi();

        if (api.runtime?.openOptionsPage) {
          try {
            await api.runtime.openOptionsPage();
            return;
          } catch (err) {
            // Firefox Android 部分版本 openOptionsPage 会报错，回退到 tabs.create
            if (api.tabs?.create) {
              const url = api.runtime?.getURL ? api.runtime.getURL('options/options.html') : 'options/options.html';
              await api.tabs.create({ url });
              return;
            }
            throw err;
          }
        } else if (api.tabs?.create) {
          const url = api.runtime?.getURL ? api.runtime.getURL('options/options.html') : 'options/options.html';
          await api.tabs.create({ url });
        } else {
          throw new Error('Neither browser.runtime.openOptionsPage nor browser.tabs.create is available');
        }
      },

      sendMessage: async (message) => {
        const api = getApi();
        if (api.runtime?.sendMessage) {
          try {
            return await api.runtime.sendMessage(message);
          } catch {
            return null;
          }
        }
        return null;
      },

      onMessage: (callback) => {
        const api = getApi();
        if (api.runtime?.onMessage) {
          api.runtime.onMessage.addListener((message, sender, sendResponse) => {
            const res = callback(message, sender, sendResponse);
            if (res instanceof Promise) {
              res.then(sendResponse).catch(err => sendResponse({ error: err.message }));
              return true;
            }
            return res;
          });
        }
      }
    };

    // I18n API
    this.i18n = {
      getUILanguage: () => {
        try {
          const api = getApi();
          if (api.i18n?.getUILanguage) {
            return api.i18n.getUILanguage();
          }
        } catch (e) {
          // ignore
        }
        if (typeof navigator !== 'undefined' && navigator.language) {
          return navigator.language;
        }
        return 'zh-CN';
      }
    };

    // Alarms API
    this.alarms = {
      create: async (name, alarmInfo) => {
        const api = getApi();
        if (!api.alarms?.create) {
          throw new Error('browser.alarms API is not available');
        }

        api.alarms.create(name, alarmInfo);
      },

      clear: async (name) => {
        const api = getApi();
        if (!api.alarms?.clear) {
          throw new Error('browser.alarms API is not available');
        }

        return await api.alarms.clear(name);
      },

      onAlarm: (callback) => {
        const api = getApi();
        if (api.alarms?.onAlarm) {
          api.alarms.onAlarm.addListener(callback);
        }
      }
    };
  }
}
