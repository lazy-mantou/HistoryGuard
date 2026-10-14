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

      search: ({ text = '', startTime = 0, maxResults = 100 } = {}) => {
        return new Promise((resolve, reject) => {
          if (typeof chrome === 'undefined' || !chrome.history) {
            return reject(new Error('chrome.history API is not available'));
          }

          const queryDetails = {
            text: typeof text === 'string' ? text : '',
            startTime: typeof startTime === 'number' ? startTime : 0,
            maxResults: typeof maxResults === 'number' && maxResults > 0 ? maxResults : 100
          };

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

          chrome.history.deleteUrl({ url }, () => {
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

            if (tabs && tabs.length > 0) {
              const activeTab = tabs[0];
              resolve({
                id: activeTab.id,
                url: activeTab.url || '',
                title: activeTab.title || ''
              });
            } else {
              resolve(null);
            }
          });
        });
      }
    };

    // Runtime API
    this.runtime = {
      openOptionsPage: () => {
        return new Promise((resolve, reject) => {
          if (typeof chrome === 'undefined' || !chrome.runtime?.openOptionsPage) {
            return reject(new Error('chrome.runtime.openOptionsPage is not available'));
          }

          chrome.runtime.openOptionsPage(() => {
            if (chrome.runtime?.lastError) {
              return reject(new Error(chrome.runtime.lastError.message));
            }
            resolve();
          });
        });
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
