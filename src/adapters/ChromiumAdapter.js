/**
 * @file ChromiumAdapter.js
 * @description Chromium 内核 (Chrome / Edge / Brave) 专用适配器实现
 * 封装 chrome.* 命名空间，提供完整的 Promise 兼容与 Service Worker 运行保障
 */

import { IBrowserAdapter } from './IBrowserAdapter.js';

export class ChromiumAdapter extends IBrowserAdapter {
  constructor() {
    super();
    this.name = 'chromium';
    this.engine = 'chromium';
    this.isFirefox = false;

    // History API
    this.history = {
      isSupported: () => {
        return Boolean(typeof chrome !== 'undefined' && chrome.history && typeof chrome.history.search === 'function');
      },

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

          // Service Worker 中首选 lastFocusedWindow: true 以精准定位用户当前活跃窗口
          chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
            if (!chrome.runtime?.lastError && tabs && tabs.length > 0 && (tabs[0].url || tabs[0].pendingUrl)) {
              const activeTab = tabs[0];
              return resolve({
                id: activeTab.id,
                url: activeTab.url || activeTab.pendingUrl || '',
                title: activeTab.title || ''
              });
            }

            // 备用：currentWindow: true
            chrome.tabs.query({ active: true, currentWindow: true }, (fallbackTabs) => {
              if (!chrome.runtime?.lastError && fallbackTabs && fallbackTabs.length > 0 && (fallbackTabs[0].url || fallbackTabs[0].pendingUrl)) {
                const fallbackTab = fallbackTabs[0];
                return resolve({
                  id: fallbackTab.id,
                  url: fallbackTab.url || fallbackTab.pendingUrl || '',
                  title: fallbackTab.title || ''
                });
              }

              // 兜底：所有活动标签（兼容部分移动端或单一窗口模式）
              chrome.tabs.query({ active: true }, (allActiveTabs) => {
                if (!chrome.runtime?.lastError && allActiveTabs && allActiveTabs.length > 0 && (allActiveTabs[0].url || allActiveTabs[0].pendingUrl)) {
                  const mTab = allActiveTabs[0];
                  return resolve({
                    id: mTab.id,
                    url: mTab.url || mTab.pendingUrl || '',
                    title: mTab.title || ''
                  });
                }
                resolve(null);
              });
            });
          });
        });
      },

      get: (tabId) => {
        return new Promise((resolve) => {
          if (typeof chrome === 'undefined' || !chrome.tabs?.get || typeof tabId !== 'number') {
            return resolve(null);
          }
          chrome.tabs.get(tabId, (tab) => {
            if (chrome.runtime?.lastError || !tab) {
              return resolve(null);
            }
            resolve({
              id: tab.id,
              url: tab.url || tab.pendingUrl || '',
              title: tab.title || ''
            });
          });
        });
      },

      query: (queryInfo = {}) => {
        return new Promise((resolve) => {
          if (typeof chrome === 'undefined' || !chrome.tabs?.query) {
            return resolve([]);
          }
          chrome.tabs.query(queryInfo, (tabs) => {
            if (chrome.runtime?.lastError || !Array.isArray(tabs)) {
              return resolve([]);
            }
            resolve(tabs.map(t => ({
              id: t.id,
              url: t.url || t.pendingUrl || '',
              title: t.title || ''
            })));
          });
        });
      },

      onUpdated: (callback) => {
        if (typeof chrome !== 'undefined' && chrome.tabs?.onUpdated) {
          chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            callback(tabId, changeInfo, tab);
          });
        }
      },

      onActivated: (callback) => {
        if (typeof chrome !== 'undefined' && chrome.tabs?.onActivated) {
          chrome.tabs.onActivated.addListener((activeInfo) => {
            callback(activeInfo);
          });
        }
      }
    };

    // Action API (工具栏图标、角标 Badge 与 Tooltip 动态状态提示)
    this.action = {
      setBadgeText: ({ text = '', tabId } = {}) => {
        return new Promise((resolve) => {
          if (typeof chrome === 'undefined' || !chrome.action?.setBadgeText) {
            return resolve();
          }
          const details = { text: String(text || '') };
          if (typeof tabId === 'number') details.tabId = tabId;
          try {
            chrome.action.setBadgeText(details, () => {
              if (chrome.runtime?.lastError) { /* ignore closed tab */ }
              resolve();
            });
          } catch {
            resolve();
          }
        });
      },

      setBadgeBackgroundColor: ({ color = '#10b981', tabId } = {}) => {
        return new Promise((resolve) => {
          if (typeof chrome === 'undefined' || !chrome.action?.setBadgeBackgroundColor) {
            return resolve();
          }
          const details = { color };
          if (typeof tabId === 'number') details.tabId = tabId;
          try {
            chrome.action.setBadgeBackgroundColor(details, () => {
              if (chrome.runtime?.lastError) { /* ignore */ }
              resolve();
            });
          } catch {
            resolve();
          }
        });
      },

      setTitle: ({ title = '', tabId } = {}) => {
        return new Promise((resolve) => {
          if (typeof chrome === 'undefined' || !chrome.action?.setTitle) {
            return resolve();
          }
          const details = { title: String(title || '') };
          if (typeof tabId === 'number') details.tabId = tabId;
          try {
            chrome.action.setTitle(details, () => {
              if (chrome.runtime?.lastError) { /* ignore */ }
              resolve();
            });
          } catch {
            resolve();
          }
        });
      },

      setIcon: ({ path, tabId } = {}) => {
        return new Promise((resolve) => {
          if (typeof chrome === 'undefined' || !chrome.action?.setIcon) {
            return resolve();
          }
          // 深度标准化路径：统一以 '/' 开头，避免在 Service Worker 嵌套目录 background/ 下解析成 background/icons/...
          let normalizedPath = path;
          if (typeof path === 'string') {
            normalizedPath = path.startsWith('/') || path.startsWith('chrome-extension://') ? path : `/${path}`;
          } else if (path && typeof path === 'object') {
            normalizedPath = {};
            for (const [size, p] of Object.entries(path)) {
              normalizedPath[size] = (typeof p === 'string' && !p.startsWith('/') && !p.startsWith('chrome-extension://')) ? `/${p}` : p;
            }
          }
          const details = { path: normalizedPath };
          if (typeof tabId === 'number') details.tabId = tabId;
          try {
            chrome.action.setIcon(details, () => {
              if (chrome.runtime?.lastError) {
                console.warn('[HistGuard] chrome.action.setIcon notice:', chrome.runtime.lastError.message, details);
              }
              resolve();
            });
          } catch (err) {
            console.warn('[HistGuard] chrome.action.setIcon error:', err);
            resolve();
          }
        });
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
      },

      sendMessage: (message) => {
        return new Promise((resolve) => {
          if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
            return resolve(null);
          }
          try {
            chrome.runtime.sendMessage(message, (response) => {
              if (chrome.runtime?.lastError) {
                return resolve(null);
              }
              resolve(response);
            });
          } catch {
            resolve(null);
          }
        });
      },

      onMessage: (callback) => {
        if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
          chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
