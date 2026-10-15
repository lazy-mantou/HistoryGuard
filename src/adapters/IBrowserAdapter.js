/**
 * @file IBrowserAdapter.js
 * @description 统一抽象浏览器接口规范基类 (Adapter Pattern)
 * 所有核心业务逻辑必须面向本抽象接口编程，严禁直接调用全局 chrome.* 或 browser.*
 */

export class IBrowserAdapter {
  constructor() {
    this.history = {
      /**
       * 监听页面历史记录新增访问事件
       * @param {function(HistoryItem): void} callback
       */
      onVisited: (callback) => {
        throw new Error('history.onVisited must be implemented by adapter');
      },

      /**
       * 监听历史记录物理删除事件（单条、多条或全量清空）
       * @param {function(Object): void} callback - (removed: { allHistory: boolean, urls?: string[] })
       */
      onVisitRemoved: (callback) => {
        throw new Error('history.onVisitRemoved must be implemented by adapter');
      },

      /**
       * 搜索历史记录 (支持 startTime, endTime 游标分页与海量数据分批拉取)
       * @param {Object} query - { text: string, startTime?: number, endTime?: number, maxResults?: number }
       * @returns {Promise<Array<HistoryItem>>}
       */
      search: (query) => {
        throw new Error('history.search must be implemented by adapter');
      },

      /**
       * 删除指定 URL 的历史记录
       * @param {string|{url: string}} url
       * @returns {Promise<void>}
       */
      deleteUrl: (url) => {
        throw new Error('history.deleteUrl must be implemented by adapter');
      }
    };

    this.storage = {
      /**
       * 获取本地存储数据
       * @param {string|Array<string>|Object|null} keys
       * @returns {Promise<Object>}
       */
      get: (keys) => {
        throw new Error('storage.get must be implemented by adapter');
      },

      /**
       * 设置本地存储数据
       * @param {Object} items
       * @returns {Promise<void>}
       */
      set: (items) => {
        throw new Error('storage.set must be implemented by adapter');
      },

      /**
       * 监听本地存储变更事件
       * @param {function(Object): void} callback
       */
      onChanged: (callback) => {
        throw new Error('storage.onChanged must be implemented by adapter');
      }
    };

    this.tabs = {
      /**
       * 获取当前活动标签页信息
       * @returns {Promise<{id: number, url: string, title: string}|null>}
       */
      getCurrentActiveTab: () => {
        throw new Error('tabs.getCurrentActiveTab must be implemented by adapter');
      },

      /**
       * 监听标签页更新（支持捕获 URL 变化、pushState、replaceState 等）
       * @param {function(number, Object, Object): void} callback - (tabId, changeInfo, tab)
       */
      onUpdated: (callback) => {
        throw new Error('tabs.onUpdated must be implemented by adapter');
      }
    };

    this.webNavigation = {
      /**
       * 监听 SPA 单页应用通过 pushState / replaceState 变更历史记录事件
       * @param {function(Object): void} callback - (details: { tabId, url, processId, frameId, timeStamp })
       */
      onHistoryStateUpdated: (callback) => {
        throw new Error('webNavigation.onHistoryStateUpdated must be implemented by adapter');
      },

      /**
       * 监听页面主框架或子框架导航提交事件
       * @param {function(Object): void} callback - (details)
       */
      onCommitted: (callback) => {
        throw new Error('webNavigation.onCommitted must be implemented by adapter');
      }
    };

    this.runtime = {
      /**
       * 打开扩展独立设置页
       * @returns {Promise<void>}
       */
      openOptionsPage: () => {
        throw new Error('runtime.openOptionsPage must be implemented by adapter');
      }
    };

    this.i18n = {
      /**
       * 获取浏览器当前 UI 界面语言代码 (如 'zh-CN', 'en-US')
       * @returns {string}
       */
      getUILanguage: () => {
        throw new Error('i18n.getUILanguage must be implemented by adapter');
      }
    };

    this.alarms = {
      /**
       * 创建定时器闹钟
       * @param {string} name
       * @param {Object} alarmInfo - { delayInMinutes, periodInMinutes, when }
       * @returns {Promise<void>}
       */
      create: (name, alarmInfo) => {
        throw new Error('alarms.create must be implemented by adapter');
      },

      /**
       * 清除指定定时器
       * @param {string} name
       * @returns {Promise<boolean>}
       */
      clear: (name) => {
        throw new Error('alarms.clear must be implemented by adapter');
      },

      /**
       * 监听定时器触发事件
       * @param {function(Object): void} callback
       */
      onAlarm: (callback) => {
        throw new Error('alarms.onAlarm must be implemented by adapter');
      }
    };
  }
}
