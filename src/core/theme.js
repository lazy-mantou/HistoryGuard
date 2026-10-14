/**
 * @file theme.js
 * @description 主题管理驱动引擎 (Theme Engine)
 * 支持夜间深色 (Dark)、白天浅色 (Light) 及自动跟随系统 (Auto - prefers-color-scheme)
 * 支持跨平台 OS 实时颜色方案侦测与无刷新平滑切换
 */

/**
 * 探测系统当前是否处于夜间深色模式
 * @param {Window} [win] 注入的 window 对象 (便于在 Node 单元测试中 Mock)
 * @returns {boolean}
 */
export function isSystemDarkMode(win = (typeof window !== 'undefined' ? window : null)) {
  if (!win || typeof win.matchMedia !== 'function') {
    return false;
  }
  try {
    return win.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch (err) {
    return false;
  }
}

/**
 * 根据用户偏好配置，解析出实际应当渲染的生效主题 ('dark' | 'light')
 * @param {'auto' | 'dark' | 'light'} [preference='auto'] 用户设定的偏好
 * @param {Window} [win] 注入的 window 对象
 * @returns {'dark' | 'light'}
 */
export function resolveTheme(preference = 'auto', win = (typeof window !== 'undefined' ? window : null)) {
  if (preference === 'dark') {
    return 'dark';
  }
  if (preference === 'light') {
    return 'light';
  }
  // preference === 'auto' 或其他未定义入参：探测系统偏好
  return isSystemDarkMode(win) ? 'dark' : 'light';
}

/**
 * 将解析后的主题应用到 DOM 根节点 (<html>)
 * @param {'dark' | 'light'} theme
 * @param {Document} [doc] 注入的 document 对象
 */
export function applyTheme(theme, doc = (typeof document !== 'undefined' ? document : null)) {
  if (!doc || !doc.documentElement) return;
  const normalized = theme === 'light' ? 'light' : 'dark';
  doc.documentElement.setAttribute('data-theme', normalized);
}

/**
 * 初始化页面主题并设置系统监听
 * @param {'auto' | 'dark' | 'light'} preference
 * @param {Object} [options]
 * @param {Function} [options.onChange] 当系统主题交替时的回调
 * @param {Window} [options.win]
 * @param {Document} [options.doc]
 * @returns {{ theme: 'dark' | 'light', cleanup: Function }}
 */
export function initTheme(preference = 'auto', { onChange, win, doc } = {}) {
  const currentWin = win || (typeof window !== 'undefined' ? window : null);
  const currentDoc = doc || (typeof document !== 'undefined' ? document : null);

  const resolved = resolveTheme(preference, currentWin);
  applyTheme(resolved, currentDoc);

  let cleanup = () => {};

  if (preference === 'auto' && currentWin && typeof currentWin.matchMedia === 'function') {
    try {
      const mediaQuery = currentWin.matchMedia('(prefers-color-scheme: dark)');
      const listener = (e) => {
        const nextTheme = e.matches ? 'dark' : 'light';
        applyTheme(nextTheme, currentDoc);
        if (typeof onChange === 'function') {
          onChange(nextTheme);
        }
      };

      if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', listener);
        cleanup = () => mediaQuery.removeEventListener('change', listener);
      } else if (typeof mediaQuery.addListener === 'function') {
        mediaQuery.addListener(listener);
        cleanup = () => mediaQuery.removeListener(listener);
      }
    } catch (e) {
      // 容错处理
    }
  }

  return {
    theme: resolved,
    cleanup
  };
}
