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
       * 搜索历史记录
       * @param {Object} query - { text: string, startTime: number, maxResults: number }
       * @returns {Promise<Array<HistoryItem>>}
       */
      search: (query) => {
        throw new Error('history.search must be implemented by adapter');
      },

      /**
       * 删除指定 URL 的历史记录
       * @param {string} url
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
