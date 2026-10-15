/**
 * @file ChromiumAdapter.js
 * @description Chromium 内核 (Chrome / Edge / Brave) 专用适配器实现
 * 封装 chrome.* 命名空间，提供完整的 Promise 兼容与 Service Worker 运行保障
 */

import { IBrowserAdapter } from './IBrowserAdapter.js';

export class ChromiumAdapter extends IBrowserAdapter {
  constructor() {
    super();

    // History API
    this.history = {
      onVisited: (callback) => {
        if (typeof chrome !== 'undefined' && chrome.history?.onVisited) {
          chrome.history.onVisited.addListener(callback);
        }
      },

      onVisitRemoved: (callback) => {
        if (typeof chrome !== 'undefined' && chrome.history?.onVisitRemoved) {
          chrome.history.onVisitRemoved.addListener((removed) => {
            callback(removed);
          });
        }
      },

      search: ({ text = '', startTime = 0, endTime = 0, maxResults = 100 } = {}) => {
        return new Promise((resolve, reject) => {
          if (typeof chrome === 'undefined' || !chrome.history) {
            return reject(new Error('chrome.history API is not available'));
          }

          const queryDetails = {
            text: typeof text === 'string' ? text : '',
            startTime: typeof startTime === 'number' ? startTime : 0,
            maxResults: typeof maxResults === 'number' && maxResults > 0 ? maxResults : 100
          };

          // 支持 endTime 游标分页与海量数据分批拉取
          if (typeof endTime === 'number' && endTime > 0) {
            queryDetails.endTime = endTime;
          }

          chrome.history.search(queryDetails, (results) => {
            if (chrome.runtime?.lastError) {
              return reject(new Error(chrome.runtime.lastError.message));
            }
            resolve(results || []);
          });
        });
      },

      deleteUrl: (url) => {
        return new Promise((resolve, reject) => {
          if (typeof chrome === 'undefined' || !chrome.history) {
            return reject(new Error('chrome.history API is not available'));
          }

          const targetUrl = typeof url === 'string' ? url : url?.url;
          if (!targetUrl) return resolve();

          chrome.history.deleteUrl({ url: targetUrl }, () => {
            if (chrome.runtime?.lastError) {
              return reject(new Error(chrome.runtime.lastError.message));
            }
            resolve();
          });
        });
      }
    };

    // Storage API
    this.storage = {
      get: (keys) => {
        return new Promise((resolve, reject) => {
          if (typeof chrome === 'undefined' || !chrome.storage?.local) {
            return reject(new Error('chrome.storage.local API is not available'));
          }

          chrome.storage.local.get(keys, (items) => {
            if (chrome.runtime?.lastError) {
              return reject(new Error(chrome.runtime.lastError.message));
            }
            resolve(items || {});
          });
        });
      },

      set: (items) => {
        return new Promise((resolve, reject) => {
          if (typeof chrome === 'undefined' || !chrome.storage?.local) {
            return reject(new Error('chrome.storage.local API is not available'));
          }

          chrome.storage.local.set(items, () => {
            if (chrome.runtime?.lastError) {
              return reject(new Error(chrome.runtime.lastError.message));
            }
            resolve();
          });
        });
      },

      onChanged: (callback) => {
        if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
          chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName === 'local') {
              callback(changes);
            }
          });
        }
      }
    };

    // Tabs API
    this.tabs = {
      getCurrentActiveTab: () => {
        return new Promise((resolve, reject) => {
          if (typeof chrome === 'undefined' || !chrome.tabs) {
            return reject(new Error('chrome.tabs API is not available'));
          }

          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (chrome.runtime?.lastError) {
              return reject(new Error(chrome.runtime.lastError.message));
            }

            if (tabs && tabs.length > 0 && (tabs[0].url || tabs[0].pendingUrl)) {
              const activeTab = tabs[0];
              resolve({
                id: activeTab.id,
                url: activeTab.url || activeTab.pendingUrl || '',
                title: activeTab.title || ''
              });
            } else {
              chrome.tabs.query({ active: true, lastFocusedWindow: true }, (fallbackTabs) => {
                if (fallbackTabs && fallbackTabs.length > 0 && (fallbackTabs[0].url || fallbackTabs[0].pendingUrl)) {
                  const fallbackTab = fallbackTabs[0];
                  resolve({
                    id: fallbackTab.id,
                    url: fallbackTab.url || fallbackTab.pendingUrl || '',
                    title: fallbackTab.title || ''
                  });
                } else {
                  // 移动端专用兜底：部分移动浏览器无独立窗口概念，直接查询当前活动标签
                  chrome.tabs.query({ active: true }, (mobileTabs) => {
                    if (mobileTabs && mobileTabs.length > 0 && (mobileTabs[0].url || mobileTabs[0].pendingUrl)) {
                      const mTab = mobileTabs[0];
                      resolve({
                        id: mTab.id,
                        url: mTab.url || mTab.pendingUrl || '',
                        title: mTab.title || ''
                      });
                    } else {
                      resolve(null);
                    }
                  });
                }
              });
            }
          });
        });
      },

      onUpdated: (callback) => {
        if (typeof chrome !== 'undefined' && chrome.tabs?.onUpdated) {
          chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            callback(tabId, changeInfo, tab);
          });
        }
      }
    };

    // WebNavigation API (专为 SPA / pushState / replaceState 历史追踪设计)
    this.webNavigation = {
      onHistoryStateUpdated: (callback) => {
        if (typeof chrome !== 'undefined' && chrome.webNavigation?.onHistoryStateUpdated) {
          chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
            callback(details);
          });
        }
      },
      onCommitted: (callback) => {
        if (typeof chrome !== 'undefined' && chrome.webNavigation?.onCommitted) {
          chrome.webNavigation.onCommitted.addListener((details) => {
            callback(details);
          });
        }
      }
    };

    // Runtime API
    this.runtime = {
      openOptionsPage: () => {
        return new Promise((resolve, reject) => {
          if (typeof chrome === 'undefined' || !chrome.runtime) {
            return reject(new Error('chrome.runtime API is not available'));
          }

          if (chrome.runtime.openOptionsPage) {
            chrome.runtime.openOptionsPage(() => {
              if (chrome.runtime?.lastError) {
                // 移动端兜底：若 openOptionsPage 失败，尝试以独立 Tab 打开 options.html
                if (chrome.tabs?.create) {
                  const optUrl = chrome.runtime.getURL ? chrome.runtime.getURL('options/options.html') : 'options/options.html';
                  chrome.tabs.create({ url: optUrl }, () => resolve());
                } else {
                  reject(new Error(chrome.runtime.lastError.message));
                }
                return;
              }
              resolve();
            });
          } else if (chrome.tabs?.create) {
            // 移动端无 openOptionsPage 时以新标签页打开
            const optUrl = chrome.runtime.getURL ? chrome.runtime.getURL('options/options.html') : 'options/options.html';
            chrome.tabs.create({ url: optUrl }, () => resolve());
          } else {
            reject(new Error('Neither openOptionsPage nor tabs.create is available'));
          }
        });
      }
    };

    // I18n API
    this.i18n = {
      getUILanguage: () => {
        if (typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage) {
          return chrome.i18n.getUILanguage();
        }
        if (typeof navigator !== 'undefined' && navigator.language) {
          return navigator.language;
        }
        return 'zh-CN';
      }
    };

    // Alarms API
    this.alarms = {
      create: (name, alarmInfo) => {
        return new Promise((resolve, reject) => {
          if (typeof chrome === 'undefined' || !chrome.alarms) {
            return reject(new Error('chrome.alarms API is not available'));
          }

          try {
            chrome.alarms.create(name, alarmInfo);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      },

      clear: (name) => {
        return new Promise((resolve, reject) => {
          if (typeof chrome === 'undefined' || !chrome.alarms) {
            return reject(new Error('chrome.alarms API is not available'));
          }

          chrome.alarms.clear(name, (wasCleared) => {
            if (chrome.runtime?.lastError) {
              return reject(new Error(chrome.runtime.lastError.message));
            }
            resolve(Boolean(wasCleared));
          });
        });
      },

      onAlarm: (callback) => {
        if (typeof chrome !== 'undefined' && chrome.alarms?.onAlarm) {
          chrome.alarms.onAlarm.addListener(callback);
        }
      }
    };
  }
}
