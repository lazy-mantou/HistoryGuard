/**
 * @file theme.test.js
 * @description 主题管理驱动引擎 (Theme Engine) 单元测试
 * 验证深色/浅色解析、系统 prefers-color-scheme 侦测、DOM 挂载与响应式动态监听
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSystemDarkMode,
  resolveTheme,
  applyTheme,
  initTheme
} from '../src/core/theme.js';

/**
 * 辅助函数：构造 Mock Window 对象
 */
function createMockWindow(isDark = false) {
  const listeners = new Set();
  const mediaQuery = {
    matches: isDark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (event, handler) => {
      if (event === 'change') listeners.add(handler);
    },
    removeEventListener: (event, handler) => {
      if (event === 'change') listeners.delete(handler);
    },
    // 兼容旧版
    addListener: (handler) => listeners.add(handler),
    removeListener: (handler) => listeners.delete(handler),
    _triggerChange: (matches) => {
      mediaQuery.matches = matches;
      for (const fn of listeners) {
        fn({ matches, media: mediaQuery.media });
      }
    },
    _getListenersCount: () => listeners.size
  };

  return {
    matchMedia: (query) => {
      if (query === '(prefers-color-scheme: dark)') {
        return mediaQuery;
      }
      return { matches: false, addEventListener: () => {}, removeEventListener: () => {} };
    },
    _mediaQuery: mediaQuery
  };
}

/**
 * 辅助函数：构造 Mock Document 对象
 */
function createMockDocument() {
  const attributes = new Map();
  return {
    documentElement: {
      setAttribute: (k, v) => attributes.set(k, String(v)),
      getAttribute: (k) => attributes.get(k) || null,
      removeAttribute: (k) => attributes.delete(k)
    },
    _attributes: attributes
  };
}

describe('theme - isSystemDarkMode 系统深色模式探测', () => {
  it('当系统偏好深色 (matches=true) 时应返回 true', () => {
    const mockWin = createMockWindow(true);
    assert.strictEqual(isSystemDarkMode(mockWin), true);
  });

  it('当系统偏好浅色 (matches=false) 时应返回 false', () => {
    const mockWin = createMockWindow(false);
    assert.strictEqual(isSystemDarkMode(mockWin), false);
  });

  it('在无 window 或无 matchMedia 环境下应安全降级返回 false', () => {
    assert.strictEqual(isSystemDarkMode(null), false);
    assert.strictEqual(isSystemDarkMode({}), false);
  });

  it('当 matchMedia 抛出异常时应安全捕获并返回 false', () => {
    const errorWin = {
      matchMedia: () => { throw new Error('SecurityError'); }
    };
    assert.strictEqual(isSystemDarkMode(errorWin), false);
  });
});

describe('theme - resolveTheme 主题配置解析算法', () => {
  it('显式设定为 dark 时应恒返回 dark', () => {
    const mockWin = createMockWindow(false); // 系统为 light
    assert.strictEqual(resolveTheme('dark', mockWin), 'dark');
  });

  it('显式设定为 light 时应恒返回 light', () => {
    const mockWin = createMockWindow(true); // 系统为 dark
    assert.strictEqual(resolveTheme('light', mockWin), 'light');
  });

  it('当设定为 auto 时，应准确跟随系统模式', () => {
    const darkWin = createMockWindow(true);
    const lightWin = createMockWindow(false);

    assert.strictEqual(resolveTheme('auto', darkWin), 'dark');
    assert.strictEqual(resolveTheme('auto', lightWin), 'light');
  });

  it('入参为空或未知模式时，默认回退为 auto 并检测系统', () => {
    const darkWin = createMockWindow(true);
    assert.strictEqual(resolveTheme(undefined, darkWin), 'dark');
    assert.strictEqual(resolveTheme(null, darkWin), 'dark');
  });
});

describe('theme - applyTheme DOM 挂载', () => {
  it('应当在 documentElement 上正确设置 data-theme 属性', () => {
    const doc = createMockDocument();
    applyTheme('dark', doc);
    assert.strictEqual(doc.documentElement.getAttribute('data-theme'), 'dark');

    applyTheme('light', doc);
    assert.strictEqual(doc.documentElement.getAttribute('data-theme'), 'light');
  });

  it('对非合法入参应安全归一化为 dark', () => {
    const doc = createMockDocument();
    applyTheme('unknown-val', doc);
    assert.strictEqual(doc.documentElement.getAttribute('data-theme'), 'dark');
  });

  it('处理空 doc 对象时应静默安全返回，不崩溃', () => {
    assert.doesNotThrow(() => {
      applyTheme('dark', null);
    });
  });
});

describe('theme - initTheme 完整生命周期与响应式监听', () => {
  it('指定 dark/light 时仅应用属性，不注册系统媒体监听', () => {
    const mockWin = createMockWindow(false);
    const mockDoc = createMockDocument();

    const { theme, cleanup } = initTheme('light', { win: mockWin, doc: mockDoc });
    assert.strictEqual(theme, 'light');
    assert.strictEqual(mockDoc.documentElement.getAttribute('data-theme'), 'light');
    assert.strictEqual(mockWin._mediaQuery._getListenersCount(), 0);

    cleanup();
  });

  it('指定 auto 时注册系统媒体监听，并在系统变化时触发更新与回调', () => {
    const mockWin = createMockWindow(true); // 初始系统为 dark
    const mockDoc = createMockDocument();

    let callbackValue = null;
    const { theme, cleanup } = initTheme('auto', {
      win: mockWin,
      doc: mockDoc,
      onChange: (t) => { callbackValue = t; }
    });

    assert.strictEqual(theme, 'dark');
    assert.strictEqual(mockDoc.documentElement.getAttribute('data-theme'), 'dark');
    assert.strictEqual(mockWin._mediaQuery._getListenersCount(), 1);

    // 模拟操作系统由深色切换到浅色
    mockWin._mediaQuery._triggerChange(false);
    assert.strictEqual(mockDoc.documentElement.getAttribute('data-theme'), 'light');
    assert.strictEqual(callbackValue, 'light');

    // 执行清理注销监听
    cleanup();
    assert.strictEqual(mockWin._mediaQuery._getListenersCount(), 0);

    // 注销后触发变更不应再响应
    mockWin._mediaQuery._triggerChange(true);
    assert.strictEqual(mockDoc.documentElement.getAttribute('data-theme'), 'light');
  });
});
