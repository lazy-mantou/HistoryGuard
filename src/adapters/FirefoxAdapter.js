/**
 * @file FirefoxAdapter.js
 * @description Firefox (Gecko 内核) 专用适配器实现
 * 封装原生 browser.* Promise 命名空间，处理 Firefox 历史记录查询参数、弹窗上下文与生命周期差异
 */

import { IBrowserAdapter } from './IBrowserAdapter.js';

export class FirefoxAdapter extends IBrowserAdapter {
  constructor() {
    super();

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
