/**
 * @file index.js
 * @description 运行环境嗅探工厂与 BrowserAdapter 单例统一导出
 */

import { ChromiumAdapter } from './ChromiumAdapter.js';
import { FirefoxAdapter } from './FirefoxAdapter.js';
import { IBrowserAdapter } from './IBrowserAdapter.js';

/**
 * 自动检测当前运行环境并实例化对应内核适配器
 * @returns {IBrowserAdapter}
 */
function createBrowserAdapter() {
  const isFirefox = (
    typeof browser !== 'undefined' &&
    (
      Boolean(browser.runtime?.getBrowserInfo) ||
      (typeof navigator !== 'undefined' && /Firefox|Gecko/i.test(navigator.userAgent))
    )
  );

  if (isFirefox) {
    return new FirefoxAdapter();
  }
  return new ChromiumAdapter();
}

export const browserApi = createBrowserAdapter();
export { IBrowserAdapter, ChromiumAdapter, FirefoxAdapter };
