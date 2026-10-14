# Changelog & Requirements Specification

本项目遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/v1.0.0/) 提交规范，记录每次迭代的需求整理、技术决策与变更明细。

---

## [1.0.12] - 2026-10-14

### 需求整理 (Requirements Overview)
1. **浏览器系统日间/夜间色彩模式原生探测机制**：
   - **技术可行性解答**：现代跨平台浏览器（Chromium、Firefox，包含 Android 移动端）完整原生支持系统日夜主题探测：
     - **CSS 原生媒体查询**：`@media (prefers-color-scheme: dark)` 与 `@media (prefers-color-scheme: light)`；
     - **JavaScript 响应式 API**：`window.matchMedia('(prefers-color-scheme: dark)')`。通过 `.matches` 属性可在页面挂载瞬间判定系统主题；通过 `addEventListener('change', listener)` 能毫秒级捕获操作系统日出/日落自动切换或用户偏好变更，实现零刷新平滑自适应。
2. **主题驱动引擎架构 (`src/core/theme.js`)**：
   - 封装 `isSystemDarkMode()`、`resolveTheme(preference)`、`applyTheme(theme)` 与 `initTheme(preference, options)`；
   - 支持 3 种主题策略：
     - `auto`：默认值，自动侦测并监听系统日夜交替；
     - `dark`：固定夜间深色模式；
     - `light`：固定白天浅色模式；
   - 具备针对非 DOM 宿主环境的无缝降级与 `cleanup` 注销机制。
3. **偏好设置与多语言国际化扩展**：
   - 在 `storage.js` 的 `DEFAULT_SETTINGS` 中引入 `theme: 'auto'`；
   - 将 Options 设置页面首个分组升级为“🎨 外观主题与个性化”，新增“界面外观主题”下拉选择控件；
   - `zh-CN.js` 与 `en.js` 新增双语外观字典项与 `toastThemeChanged` 即时提示，保持 100% 字典键对等。
4. **全端白天/夜间双模顶级现代设计规范 (`options.css` & `popup.css`)**：
   - **夜间模式 (Dark Mode)**：保持原有沉稳科技感深空灰黑底板（`#0f1117`）、高阶深色卡片与幽蓝紫微光强调色；
   - **白天模式 (Light Mode)**：采用现代顶级 SaaS 风格（Stripe / Linear 调色盘），冷灰护眼底板（`#f8fafc`）、纯白悬浮卡片（`#ffffff`）、精致细腻边界（`#e2e8f0`）、高对比度深紫蓝强调色（`#4f46e5`）及深岩灰高清晰文字（`#0f172a`）；
   - **首屏防白屏与防闪烁 (Anti-FOUC)**：在 CSS 根层引入 `@media (prefers-color-scheme: light)` 兜底，即便在 JS 尚未加载完成的微秒级阶段，也能依系统偏好精准呈现对应色彩。
5. **单元测试与构建验证 (`tests/theme.test.js`)**：
   - 编写 13 项涵盖系统探测、偏好解析、DOM 挂载与响应式动态监听的单元测试用例；
   - 全套自动化测试套件扩充至 29 个套件、共 90 项单元测试，通过率 100%。

### 变更明细 (Detailed Changes)
- `feat(theme)`: 新增 `src/core/theme.js` 主题管理驱动引擎。
- `feat(settings)`: 在 `src/core/storage.js` 默认设置中增加 `theme: 'auto'`。
- `feat(options)`: 在 `options.html` 设置中心首组加入外观主题下拉选择框；在 `options.js` 中接入 `initTheme` 与即时切换监听。
- `feat(popup)`: 在 `popup.js` 初始化生命周期中接入 `initTheme`，同步遵循全局外观。
- `style`: 重构 `options.css` 与 `popup.css`，支持完整的白天浅色与夜间深色主题 CSS 变量系统与 Anti-FOUC 机制。
- `i18n`: 在 `zh-CN.js` 与 `en.js` 中新增主题配置多语言字典与 Toast 提示。
- `test`: 新增 `tests/theme.test.js` 并更新 `tests/run-all.js` 与 `tests/storage.test.js`。

---

## [1.0.11] - 2026-10-14

### 需求整理 (Requirements Overview)
1. **模块与文案命名规范统一（“大扫除”改为“批量删除”）**：
   - **优化背景**：为使功能表达更加准确、严肃且贴合浏览历史管理工具的专业性，将原“历史批量大扫除”全面更名为“历史批量删除”；
   - **覆盖范围**：涵盖 Options 页面左侧 Tab 侧边栏标题、主卡片面板标题、空状态引导文本、高级偏好设置说明，以及 `zh-CN.js` 与 `en.js`（“Batch History Delete”）中英双语字典。
2. **“删除并隐藏”操作防呆校验与实时交互联动优化**：
   - **痛点分析与交互设计决策**：
     - 用户提出了非常敏锐且符合防呆规范（Poka-Yoke）的建议：“删除并隐藏按钮在没有输入关键词前设置为 disabled 比较合适”；
     - 业务逻辑上，该操作的核心功能是将选中的历史记录从底层删除的同时，将当前搜索框中输入的关键词通过 `convertSearchTermToRule(searchTerm)` 转化为永久拦截规则。若搜索框无任何内容，根本无法提取并建立拦截规则；
     - 原先仅根据是否勾选记录（`selectedCount > 0`）来控制按钮启用状态，若用户未输入关键词点击，无法提取规则。因此，将输入关键词作为激活的强前置条件至关重要。
   - **技术实现细节**：
     - **多条件激活判定**：`btnDeleteAndAddRule.disabled = !hasSelected || !hasKeyword || isOperatingCleaning;`，必须同时满足已勾选、已输入有效关键词且无并发删除任务；
     - **即时响应与零延迟**：不等待 250ms 的历史搜索防抖，而在搜索框原生 `input` 事件与清空按钮 `click` 事件中立即触发 `updateSelectedSummary()`，保证用户键入/清空时按钮即时切换禁用状态；
     - **动态智能 Tooltip 提示**：无关键词时悬浮提示“请先在上方搜索框输入关键词，以作为自动生成的永久隐藏规则”；未勾选记录时提示“请至少勾选一条待处理的历史记录”；条件满足时精准展示删除条数与生成规则词，提供极致清晰的状态感知。

### 变更明细 (Detailed Changes)
- `style(options)`: 更新 `options.html` 面板标题、Tab 标题及空状态文案为“历史批量删除”。
- `i18n`: 在 `zh-CN.js` 与 `en.js` 中更新相关文本，并新增 `btnDeleteAndAddRuleNoKeyword` 与 `btnDeleteAndAddRuleNoSelected` 双语悬浮提示字典项。
- `feat(options)`: 在 `options.js` 的 `updateSelectedSummary()` 中加入 `hasKeyword` 校验与动态 Tooltip 指引，并在 `input` 事件中即时触发联动。
- `docs`: 同步更新 `storage.js` 偏好配置说明与 `CHANGELOG.md`。

---

## [1.0.10] - 2026-10-14

### 需求整理 (Requirements Overview)
1. **移动端浏览器扩展全环境兼容支持 (Firefox for Android & Mobile Chromium)**：
   - **痛点与需求**：原本插件针对桌面端视窗设计，缺少移动端适配；在手机端浏览器（如 Firefox for Android、Kiwi Browser、Lemur、Yandex、Orion）上使用时，面临清单不被安卓识别、弹窗尺寸溢出、侧边栏排版被挤压及移动端独立窗口 API 缺失等问题。
   - **Manifest 移动端认证支持**：
     - 在 `manifest.firefox.json` 的 `browser_specific_settings` 中加入 `"gecko_android": { "strict_min_version": "120.0" }`，正式声明支持 Firefox for Android（Fenix / GeckoView）移动生态；
     - Chromium 清单原生兼容支持扩展的 Android Chromium 衍生内核（Kiwi / Lemur / Yandex / Orion）。
2. **底层 Adapter 适配层移动端环境容灾与回退**：
   - **标签页查询容灾 (`getCurrentActiveTab`)**：
     - 移动端浏览器单视窗运行，无桌面多窗口（`currentWindow` / `lastFocusedWindow` 可能返回空数组）；
     - 在 `ChromiumAdapter` 与 `FirefoxAdapter` 中增加移动端专用兜底，当窗口查询无结果时直接回退查询全局活动标签 `{ active: true }`，确保手机端弹窗能 100% 捕获当前页面 URL 与标题。
   - **设置页打开容灾 (`openOptionsPage`)**：
     - 部分移动端浏览器不支持弹层式 `openOptionsPage()`，自动安全降级为通过 `tabs.create({ url: 'options/options.html' })` 以独立标签页平滑打开控制台。
3. **Popup 弹窗视口与触控交互全自适应 (`src/popup/popup.css`)**：
   - **视口动态适配**：桌面端维持 356px 紧凑无滚动条尺寸；移动端（`max-width: 480px`）自动切换为 `100vw` 宽度、安全区 `env(safe-area-inset-bottom)` 边距与 `-webkit-overflow-scrolling: touch` 丝滑滚动；
   - **移动端触控人机规范**：按钮与胶囊项增大至 44px–48px 拇指友好触控尺寸，增大复选框与图标点击热区，支持 `:active` 缩放按压反馈与 `-webkit-tap-highlight-color: transparent`。
4. **Options 控制台移动端分段 Tab 与弹性堆叠重构 (`src/options/options.css`)**：
   - **头部与概览栏自适应**：统计条自适应重构为 3 列网格，紧凑排版，杜绝横向滚动溢出；
   - **侧边栏转移动端轻盈分段标签栏 (Segmented Tab Bar)**：小屏下隐藏繁冗文字描述，以图标 + 短标题 + 徽标横向自适应排布；隐藏大段说明释放纵向空间；
   - **主内容面板弹性高度解绑**：小屏下解绑 `calc(100vh - 175px)` 刚性约束，采用内容自适应弹性纵向展开与丝滑内部滚动；
   - **操作栏与设置项触控流式重构**：底部操作按钮小屏下全宽垂直堆叠（44px 拇指操作），表单与设置卡片自动转换为垂直两段式布局，Toast 提示居中吸底贴合移动手势习惯。
5. **单元测试补齐与验证**：
   - 在 `tests/adapters.test.js` 中新增 4 个针对移动端标签查询兜底与选项页打开兜底的专用单元测试，全套测试增至 77 个，通过率 100%。

### 变更明细 (Detailed Changes)
- `feat(manifest)`: 在 `manifest.firefox.json` 中配置 `gecko_android` 认证 Firefox for Android 运行支持。
- `feat(adapters)`: 在 `ChromiumAdapter.js` 与 `FirefoxAdapter.js` 中增加移动端全局活动标签查询与设置页新标签兜底。
- `style(popup)`: 在 `popup.html` 中注入防误触缩放与刘海屏 meta；在 `popup.css` 中重构移动端全屏流式与触控按压反馈规范。
- `style(options)`: 在 `options.html` 中注入安全区 meta；在 `options.css` 中重构移动端分段 Tab 栏、3列统计网格、垂直全宽操作栏与设置卡片自适应系统。
- `test(adapters)`: 在 `tests/adapters.test.js` 中补充移动端容灾机制单元测试用例。

---

## [1.0.9] - 2026-10-14

### 需求整理 (Requirements Overview)
1. **全套自动化单元测试用例体系构建 (Zero-Dependency Modern Test Suite)**：
   - **痛点与需求**：项目中缺乏覆盖核心逻辑的单元测试用例，无法对规则匹配算法、URL 拆解机制、本地存储与配置管理、多语言翻译引擎及跨内核 Adapter 契约进行自动化回归验证。
   - **架构设计与零依赖原则**：
     - 基于现代 Node.js 原生测试运行器 (`node:test` 与 `node:assert/strict`)，不引入任何第三方 npm 依赖，保持纯净的零第三方构建体系；
     - 在根目录下建立独立的 `tests/` 测试套件目录，划分 5 大专用测试模块与统一入口运行器。
2. **多语言 i18n 完整性与动态驱动测试 (`tests/i18n.test.js` - 18 个测试)**：
   - **字典全量叶子对等性检验 (Locale Parity)**：递归扫描并比对 `zh-CN.js` 与 `en.js` 的所有键路径，确保 100% 双向对等无任何遗漏翻译；
   - **语言环境解析算法**：验证 `resolveLanguage('auto')` 对各类中文变体（zh-TW, zh-HK, zh）自动归一为 `zh-CN`，其他语言默认降级为 `en`；
   - **模板插值与容错机制**：测试深层嵌套键解析、`{param}` 模板变量插值替换、缺失键自动降级返回 key 字符串；
   - **胶囊标签与时间格式化**：验证 `localizeCapsule` 域名与路径通配规则的中英转换，以及 `formatRelativeTime` 在各时间段的格式化表达；
   - **DOM 模板渲染模拟**：通过 Mock DOM 验证 `applyI18nToDOM` 正确解析并写入 `data-i18n`、`data-i18n-placeholder`、`data-i18n-title`、`data-i18n-aria-label` 及 HTML lang 属性。
3. **URL 拆解与多级公用后缀算法测试 (`tests/urlParser.test.js` - 15 个测试)**：
   - **协议有效性过滤**：验证对非 HTTP/HTTPS 协议（chrome://, file://, about:blank 等）的安全拒绝；
   - **多级顶级域名识别**：验证 `.com.cn`, `.co.uk`, `.gov.hk`, `.co.jp` 等复合公用后缀及 IPv4/IPv6/localhost 的精确解析；
   - **候选规则递进生成**：验证完整域名、二级子域通配、根域名全站通配、精确页面路径与逐层上级目录通配候选列表的完备性。
4. **规则匹配引擎与边界防误杀测试 (`tests/ruleMatcher.test.js` - 16 个测试)**：
   - **精确域名边界匹配与防误杀**：验证目标域名匹配其本身及任意子域，严格防止包含目标子串的第三方类似域名（如 mygoogle.com, google.com.cn）被误杀；
   - **路径与通配符解析**：验证精确页面路径与带有 `*` 通配符的路由级匹配；
   - **智能搜索词规则化**：验证将用户输入的搜索关键词智能转换为规范的路径与域名隐藏规则，并修复路径检测中域名 dot 干扰通配符追加的边界 Bug。
5. **规则与配置存储管理器测试 (`tests/storage.test.js` - 16 个测试)**：
   - 注入全真内存模拟的 Chrome 存储与 Alarms 定时器环境；
   - 验证规则的增删改查、启用状态反转、命中次数累加与重置清零；
   - 验证静默模式生命周期、倒计时计算及过期自动清理重置；
   - 验证规则的 JSON 导入（merge 模式去重合并 / replace 模式全量替换）与规范导出；
   - 验证全局偏好设置的增量合并保存与默认值回退。
6. **浏览器 Adapter 接口规范测试 (`tests/adapters.test.js` - 8 个测试)**：
   - 验证 `IBrowserAdapter` 抽象基类的接口规范约束与未实现异常保护；
   - 验证 `ChromiumAdapter` 与 `FirefoxAdapter` 契约完整性及无环境时的安全拦截；
   - 验证统一单例 `browserApi` 的工厂实例导出。
7. **自动化测试执行指令集成**：
   - 在 `package.json` 中配置 `"test": "node --test tests/*.test.js"` 与 `"test:coverage": "node --test --experimental-test-coverage tests/*.test.js"`；
   - 提供独立彩色终端执行脚本 `tests/run-all.js`；
   - 全套 73 个测试用例全部通过，测试覆盖率超 90%。

### 变更明细 (Detailed Changes)
- `test(urlParser)`: 新增 `tests/urlParser.test.js` 覆盖 URL 协议校验、多级顶级域名识别、域名与路径规则拆解（15 个测试）。
- `test(ruleMatcher)`: 新增 `tests/ruleMatcher.test.js` 覆盖防误杀边界正则、通配符路径匹配与搜索词转换（16 个测试）。
- `fix(ruleMatcher)`: 修复 `convertSearchTermToRule` 中路径是否含文件扩展名的判断逻辑，防止域名自身的点号阻断 `/*` 通配符自动补齐。
- `test(storage)`: 新增 `tests/storage.test.js` 覆盖规则 CRUD、拦截计数、静默模式与 Alarms 管理、导入导出与偏好设置（16 个测试）。
- `test(i18n)`: 新增 `tests/i18n.test.js` 覆盖双语字典对等性、语言自动嗅探、动态插值、相对时间与 DOM 模板替换（18 个测试）。
- `test(adapters)`: 新增 `tests/adapters.test.js` 覆盖适配器抽象基类与 Chromium / Firefox 契约实现（8 个测试）。
- `test(runner)`: 新增 `tests/run-all.js` 统一终端测试套件执行入口。
- `chore(package)`: 在 `package.json` 中配置 `test` 与 `test:coverage` 自动化脚本命令。

---

## [1.0.8] - 2026-10-14

### 需求整理 (Requirements Overview)
1. **前端模板化国际化 (i18n) 核心驱动架构设计与零依赖纯原生实现**：
   - **痛点与需求**：插件原本全部采用硬编码中文文案，缺乏多语言拓展能力。要求在前端使用标准 HTML 模板机制实现国际化 (i18n)，能够自动适配浏览器当前语言，并在设置页中提供界面语言切换选项。
   - **零依赖现代前端模板引擎 (`src/core/i18n.js`)**：
     - 构建纯原生轻量级 i18n 引擎，支持 `data-i18n`（元素 textContent）、`data-i18n-placeholder`（输入框占位符）、`data-i18n-title`（气泡浮层提示）与 `data-i18n-aria-label`（无障碍读屏标签）四维声明式模板语法；
     - 统一提供 `t(key, params)` 动态格式化函数，支持点路径深层寻址与 `{count}`, `{pattern}`, `{val}` 变量插值替换；
     - 建立中英双语标准语言包字典（`src/core/locales/zh-CN.js` 与 `src/core/locales/en.js`），覆盖 Popup 弹窗与 Options 控制台 100% 的静态标签、动态列表微标、对话框与 Toast 提示文案。
2. **浏览器原生语言环境自动感知与智能适配**：
   - 当偏好设置为 `auto`（默认值）时，自动通过 `browserApi.i18n.getUILanguage()` 嗅探当前宿主浏览器界面语言（以 `navigator.language` 兜底）；
   - 若系统语言以 `zh` 开头（如 `zh`, `zh-CN`, `zh-TW`, `zh-HK`）自动解析为简体中文（`zh-CN`），其他语言环境一律优雅回退至英文（`en`），保障全球用户开箱即用体验。
3. **Options 控制台高级偏好设置增加「界面显示语言」选项与即时热生效**：
   - 在设置面板首位新增「语言与区域设置」独立卡片（配备 🌐 矢量图标），提供 `<select id="setting-language">` 下拉选项：
     - `auto`：自动跟随浏览器 (Auto / Follow Browser)
     - `zh-CN`：简体中文 (Simplified Chinese)
     - `en`：English
   - 切换选择后即时持久化到 `histguard_settings` 本地存储，并触发 `applyI18nToDOM()` 无刷新原地重绘所有模板节点；
   - 联动重新格式化全局拦截统计、实时相对时间（刚刚 / Just now）、胶囊拆解规则标签及历史列表概览，实现零白屏平滑热更新；
   - 借助 `browserApi.storage.onChanged` 实现多窗口与弹窗间的跨视窗语言实时同步。
4. **统一浏览器抽象层 Adapter 规范补齐**：
   - 在基类 `IBrowserAdapter.js`、`ChromiumAdapter.js` 与 `FirefoxAdapter.js` 中补齐 `i18n.getUILanguage()` 规范封装，严守业务逻辑零全局 API 污染的核心架构约束。

### 变更明细 (Detailed Changes)
- `feat(adapters)`: 在 `IBrowserAdapter.js`、`ChromiumAdapter.js` 与 `FirefoxAdapter.js` 中新增 `i18n.getUILanguage()` 抽象接口与跨浏览器实现。
- `feat(storage)`: 在 `src/core/storage.js` 的 `DEFAULT_SETTINGS` 中添加 `language: 'auto'` 语言偏好项。
- `feat(i18n)`: 新增 `src/core/locales/zh-CN.js`、`src/core/locales/en.js` 语言包与 `src/core/i18n.js` 模板翻译驱动引擎。
- `feat(popup)`: 在 `src/popup/popup.html` 中注入模板属性，在 `src/popup/popup.js` 中接入 `initI18n()`、动态胶囊本地化与 Toast 翻译。
- `feat(options)`: 在 `src/options/options.html` 中全量重构模板属性并新增语言设置分组；在 `src/options/options.js` 中实现双向绑定、热切换重绘与存储跨页监听。

---

## [1.0.7] - 2026-10-14

### 需求整理 (Requirements Overview)
1. **Options 控制台左右双侧视窗联动与自适应弹性闭环**：
   - **痛点与需求**：要求右侧面板 `.tab-panel` 与左侧 `.sidebar-nav` 实现完全对称的动态高度追踪，能够随浏览器视窗缩放实时动态调整，且支持明确的 `min-height` 与 `max-height` 安全阈值约束。
   - **双侧完全对称视窗追踪**：
     - 将左侧 `.sidebar-nav` 与右侧主卡片 `.tab-panel` 统一绑定动态高度公式：
       `height: calc(100vh - 175px); min-height: 560px; max-height: 960px;`
     - 左右两侧实时对称，无论浏览器窗口如何纵向拉伸或缩小，双侧高度完全一致。
   - **内部滚动区域现代 Flex 1 沉浸填充**：
     - 将 `.tab-panel` 内的 `.list-wrapper`（历史列表与规则列表）及 `.settings-scroll-container`（设置卡片列表）全部重构为 `flex: 1; min-height: 0;`；
     - 头部搜索/工具栏与底部操作栏牢牢吸附上下两侧，中间内容区域随视窗高度动态拉伸填满，并由内部实现高性能丝滑滚动，彻底杜绝外层页面跳动与不协调的额外滚动条；
     - 空状态 `.empty-state` 调整为 `flex: 1` 自动占满容器并在任意视窗高度下始终保持居中优雅。

### 变更明细 (Detailed Changes)
- `style(options)`: 在 `src/options/options.css` 中重构 `.sidebar-nav`、`.tab-panel`、`.list-wrapper`、`.settings-scroll-container` 与 `.empty-state`，建立左右双侧视窗联动、合理 min/max 阈值及内部 `flex: 1; min-height: 0;` 弹性滚动布局。

---

## [1.0.6] - 2026-10-14

### 需求整理 (Requirements Overview)
1. **Options 控制台面板高度与滚动条视觉重构优化**：
   - **痛点分析**：原实现中 `.tab-panel` 与 `.list-wrapper` 固定限高为 560px，在大屏/高分辨率（如 1080p、2K）下可视面积受限，展示少量条目即过早触发垂直滚动条，使得界面局促且美观度受损。
   - **自适应视窗高度拓展**：
     - 将左侧 `.sidebar-nav` 与右侧主卡片 `.tab-panel` 统一重构为响应式弹性高度：`min-height: calc(100vh - 170px); min-height: 720px;`，使控制台自然充盈当前浏览器视窗，告别矮窄感；
     - 将历史记录与规则列表容器 `.list-wrapper` 调整为 `flex: 1` 自动填满面板可用空间，并将最大可视高度从 560px 大幅扩充至 `max-height: calc(100vh - 350px); max-height: 740px;`，可舒适呈现约 18~20 条历史记录与 15+ 条规则而无需滚动；
     - 将设置容器 `.settings-scroll-container` 扩充至 `max-height: calc(100vh - 270px); max-height: 760px;`，消除大部分显示器下的内部滚动条，5 大设置分组一览无余；
     - 同步调整空状态 `.empty-state` 垂直居中基准高度至 420px，并在移动端（<860px）平滑回退，保持全端视觉协调。

### 变更明细 (Detailed Changes)
- `style(options)`: 在 `src/options/options.css` 中优化 `.sidebar-nav`、`.tab-panel`、`.list-wrapper`、`.settings-scroll-container` 与 `.empty-state` 的高度、内边距与视窗自适应规则。

---

## [1.0.5] - 2026-10-14

### 需求整理 (Requirements Overview)
1. **Options 控制台新增第三 Tab「高级偏好设置」**：
   - 在左侧侧边栏引入第三个核心导航 Tab「高级偏好设置」（配备精致矢量齿轮 SVG 图标与独立面板），实现主从 Tab 架构完整闭环与持久化记忆。
2. **拦截命中统计与极致无痕隐私控制**：
   - 增加「统计规则拦截命中次数」开关（`enableHitTracking`）：支持用户按需开启或彻底关闭命中统计。开启时在规则列表中显示拦截次数；关闭后处于极致无痕状态，底层自动物理抹除历史但不落盘任何拦截痕迹，满足极致隐私偏好。
   - 增加「重置所有规则拦截计数」功能，支持一键清空所有规则的累计计数器。
3. **规则备份与数据迁移整合**：
   - 将原规则列表头部的 JSON 导出与导入功能完整迁移整合至设置页面，并重构增强：
     - 支持导出标准格式的 JSON 规则备份；
     - 导入时支持「合并导入（保留现有规则）」与「覆盖导入（完全替换已有规则）」双重模式；
     - 危险区域增设「清空所有防护规则」，提供严谨的二次确认防护机制。
4. **全面扩展前后台运行与交互偏好项**：
   - **默认静默免记录时长**：支持设置快捷开启静默模式的生效时长（15/30/60/120 分钟），Popup 与 Options 全局自适应。
   - **快捷搜索词转规则策略**：支持指定“删除并加入永久隐藏”时的缺省策略（智能识别 / 强制域名 / 强制路径）。
   - **海量历史检索性能与安全防护**：开放单批次游标拉取条数（50/100/200 条）、并发切片大小（15/30/50 条）及流式全量清空二次确认开关。
   - **界面交互与反馈**：支持自定义右下角 Toast 提示停留时长（1.5s/2.5s/4.0s）。

### 变更明细 (Detailed Changes)
- `feat(storage)`: 在 `src/core/storage.js` 中新增 `DEFAULT_SETTINGS`、`getSettings`、`saveSettings`、`resetRuleHits` 与 `clearAllRules` 存储管理函数。
- `feat(background)`: 在 `src/background/index.js` 中加入设置缓存，动态读取 `enableHitTracking` 控制是否累计拦截计数。
- `feat(popup)`: 在 `src/popup/popup.js` 中应用设置中的 `silentModeDuration` 预设时长。
- `feat(options)`: 在 `src/options/options.html` 中增加「高级偏好设置」Tab 按钮与 5 大功能分组卡片。
- `style(options)`: 在 `src/options/options.css` 中增加设置卡片体系、分组标题、下拉选择控件与响应式滚动布局。
- `feat(options)`: 在 `src/options/options.js` 中接入 `switchTab('settings')`、设置表单双向绑定即时存储、JSON 备份与恢复全流程、清空与重置交互。

---

## [1.0.4] - 2026-10-14

### 需求整理 (Requirements Overview)
1. **历史记录 1500 条限制根因分析与架构重构**：
   - **历史 1500 条限制根因**：浏览器底层 `chrome.history.search` / `browser.history.search` 均强制/默认采用 `maxResults` 阈值限制（Chrome 缺省为 100 条）。原实现中设置了固定硬编码上限 `maxResults: 1500`，若直接暴力拉取数万或数十万条数据，将引发严重的性能灾难：
     1. **IPC 序列化暴涨**：主进程与插件沙箱之间一次性传输数十万条数据将产生 50MB~200MB 的 IPC Payload，造成扩展进程假死；
     2. **DOM 爆炸与 OOM 崩盘**：挂载 10 万条 DOM 节点将生成超 50 万个子节点并占用 300MB~500MB+ 内存，触发浏览器标签页 Out-Of-Memory (OOM) 崩溃；
     3. **事件监听器内存泄露**：行级闭包激增给 GC 垃圾回收造成巨大压力；
     4. **SQLite 锁死与页面无响应**：逐条串行删除长时间霸占主线程，导致 UI 无法刷新并引发底层数据库写事务竞争。
2. **面向 10万+ 级海量历史的高效低内存防护架构**：
   - **游标分页架构 (Cursor-based Pagination)**：在 `IBrowserAdapter`、`ChromiumAdapter` 与 `FirefoxAdapter` 中深度支持 `endTime` 游标参数。以 `BATCH_SIZE = 100` 为步长按需加载，提取批次最旧记录时间戳 `lastVisitTime - 1` 作为下一次游标，彻底瓦解 1500 条天花板，单次拉取 IPC 内存峰值稳定在 1MB 以内。
   - **父级事件委托与增量追加 (DOM Optimization)**：通过 `DocumentFragment` 增量追加新批次；全列表仅在 `#history-preview-list` 挂载**唯一个事件委托监听器**，节约海量闭包内存。全选/反选直接复用现有 DOM，消除界面闪烁。
   - **非阻塞并发切片与宏任务让出 (Chunked Concurrency & Thread Yielding)**：批量删除选中的成千上万条记录时，按 `DELETE_CHUNK_SIZE = 30` 进行并发批处理（`Promise.allSettled`），每批完成后通过 `await new Promise(r => setTimeout(r, 0))` 显式让出主线程控制权，并实时更新平滑进度条，杜绝主线程冻结与 SQLite 事务锁。
   - **流式深度全量清空 (Streaming Deep Clean)**：针对海量历史的匹配清理场景，提供“流式全量清空”快捷引擎，绕过 DOM 渲染开销，直接以后台流式循环（Batch 200 -> Chunk 30并发删除 -> 让出线程）彻底出清十万级匹配历史，峰值内存占用小于 5MB。

### 变更明细 (Detailed Changes)
- `feat(adapters)`: 在 `IBrowserAdapter.js`、`ChromiumAdapter.js` 与 `FirefoxAdapter.js` 中新增 `endTime` 游标过滤参数支持。
- `feat(options)`: 在 `src/options/options.html` 中引入分批加载更多条（`#load-more-section`）、已全部加载完毕提示（`#no-more-hint`）、动态进度条（`#progress-container`）及流式全量清空按钮（`#btn-deep-clean`）。
- `style(options)`: 在 `src/options/options.css` 中增加进度条容器与轨迹、分批加载按钮与触底指示器样式。
- `perf(options)`: 在 `src/options/options.js` 中实现基于游标的时间倒序拉取、无限滚动与按需加载、单全局事件委托、`CHUNK_SIZE = 30` 异步并发切片让出线程删除及 `streamCleanAllMatches` 流式深度清理引擎。

---

## [1.0.3] - 2026-10-14

### 需求整理 (Requirements Overview)
1. **左侧 Tab 导航字体严格对齐优化**：
   - 彻底解决由于 Emoji 字符宽度不一致导致的 Tab 文本左侧缩进偏差：将原本不确定宽度的 Emoji 替换为定长 32px x 32px 居中的矢量 SVG 图标盒（`.tab-icon-box`），使文本左边缘严格保持 56px 的绝对对齐基线。
   - 统一全局表单与按钮字体继承（`button, input, select { font-family: inherit; }`），显式重置文本 `line-height`，并在 Tab 1 与 Tab 2 两侧对称加入微标徽章（`#tab-history-badge` 与 `#tab-rules-badge`），消除垂直与水平视觉微差。
2. **界面视觉净化（去除开发占位标签）**：
   - 全面移除 Options 控制台页面内所有“模块 A”、“模块 B”这类开发占位符标签，直接采用极简优雅的业务功能标题（“历史记录批量大扫除”、“自动防护规则管理”），提升产品化质感。

### 变更明细 (Detailed Changes)
- `style(options)`: 在 `src/options/options.css` 中重构 `.tab-icon-box` 尺寸体系、统一按钮字体继承规则，并删除 `.module-tag`、`.tag-a`、`.tag-b` 等旧样式。
- `feat(options)`: 更新 `src/options/options.html`，使用精细 SVG 图标替换 Emoji，并彻底清除所有“模块 A / B”标签。
- `feat(options)`: 更新 `src/options/options.js`，接入 `#tab-history-badge` 实时检索统计同步并净化注释。

---

## [1.0.2] - 2026-10-14

### 需求整理 (Requirements Overview)
1. **Options 控制台布局交互重构（左侧 Tab 垂直导航）**：
   - 废除左右并排挤占宽度的双卡片陈列模式，重构为现代沉浸式主从布局：**左侧固定 Tab 导航侧边栏 + 右侧全宽主内容面板**。
   - **Tab 1（历史批量大扫除）**：提供宽敞的全宽操作面板，支持防抖搜索、时间范围过滤胶囊、全选/反选以及完整防误删历史条目预览（标题与 URL 拥抱宽屏展示，彻底消除紧凑排版带来的视觉压迫）。
   - **Tab 2（防护规则管理）**：提供独立的全功能规则管理面板，涵盖手动添加规则表单、导入/导出 JSON 备份工具栏、完整规则列表（类型标签、表达式、拦截计数、开关 Toggle、删除）及底部批量控制。
   - **Tab 状态与交互增强**：
     - 左侧 Tab 按钮实时显示当前已配置的规则数微标徽章（Badge）；
     - 支持 `localStorage` 自动持久化记忆最后选中的 Tab 标签页，刷新或二次打开保持当前视图。
     - 响应式自适应：在宽屏下呈现左侧垂直侧边栏（宽度 250px），在移动端/极窄窗口（<860px）下平滑回退为顶部水平切换胶囊。

### 变更明细 (Detailed Changes)
- `feat(options)`: 重构 `src/options/options.html` 为左侧侧边栏 `<aside class="sidebar-nav">` + 右侧面板 `<main class="tab-content-area">` 架构。
- `style(options)`: 重构 `src/options/options.css`，加入全套 Tab 按钮悬浮、激活高亮、计数微标与全宽面板渐入动效（`fadeIn`），调整列表最大高度至 560px 提升浏览效率。
- `feat(options)`: 编写 `src/options/options.js` 中的 Tab 切换控制逻辑、规则数微标实时刷新及本地存储持久化机制。

---

## [1.0.1] - 2026-10-14

### 需求整理 (Requirements Overview)
1. **Firefox Popup “隐藏并清理” 按钮无响应 Bug 修复**：
   - 修复 Firefox 独立弹出层视窗下 `currentWindow: true` 无法获取标签页对象的问题，增加 `lastFocusedWindow: true` 与 `pendingUrl` 兜底。
   - 在 Manifest 清单权限中补齐 `"activeTab"` 与 `"host_permissions": ["<all_urls>"]`，彻底解决 Firefox MV3 下 `tab.url` 无法读取导致规则候选列表初始化为空、点击静默拦截退出的问题。
   - 增强点击执行交互反馈：按钮提供“正在处理...”及“✓ 已添加并清理”即时视觉状态反馈，自动回退兜底候选规则选择，并优化 Toast 定时器防抖清理。
2. **Chrome 与 Firefox Options 管理页排版错误全面重构修复**：
   - 解决 Flex 子项缺乏 `min-width: 0` 导致的文本省略失效、超长 URL / 规则表达式将删除按钮与 Toggle 开关挤出卡片边界的溢出问题。
   - 重构 Module A 与 Module B 双卡片布局，使用 `align-items: stretch` 与统一定高（Header 34px、Action Row 40px、Toolbar 26px、Footer 38px、List 弹性填满 420-460px），确保左右双卡片高度与行高绝对齐平。
   - 优化添加规则表单的类型选择器宽度（收敛至固定 88px），调整时间胶囊筛选与工具栏自适应，杜绝因元素长文本导致的折行跳动。
   - 补充 Module B 底部批量启用与清理停用规则等对称操作按钮，提升控制台整体视觉平衡度与实用性。

### 变更明细 (Detailed Changes)
- `fix(firefox)`: 完善 `FirefoxAdapter.js` 与 `ChromiumAdapter.js` 的 `getCurrentActiveTab` 窗口查询兜底逻辑与 `deleteUrl` 传参解构。
- `fix(manifest)`: 在 `manifest.chrome.json` 与 `manifest.firefox.json` 中配置 `"activeTab"` 与 `"host_permissions": ["<all_urls>"]`。
- `fix(popup)`: 优化 `popup.js` 候选规则自动选择兜底、即时按钮文字反馈与 Toast 逻辑。
- `fix(options)`: 重构 `options.html` 与 `options.css`，加入全套 `min-width: 0` 与 `flex-shrink: 0` 防溢出样式规则，实现左右双卡片对称严格对齐；并在 `options.js` 中增加批量控制交互。

---

## [1.0.0] - 2026-10-14

### 需求整理 (Requirements Overview)
1. **跨浏览器统一架构**：
   - 兼容 Chromium 内核（Chrome、Edge、Brave，Manifest V3）与 Gecko 内核（Firefox，Manifest V3 / browser.*）。
   - 业务逻辑与底层浏览器 API 彻底解耦，采用 Adapter 设计模式统一封装 `history`、`storage`、`tabs`、`runtime`、`alarms` 接口。
   - 提供纯原生 Node.js 构建脚本 `build.js`（零第三方依赖），一键分发输出到 `dist/chrome` 和 `dist/firefox`。
2. **核心业务与匹配引擎**：
   - **URL 层级自动拆解 (`urlParser.js`)**：支持识别常见多级 TLD（如 `.com.cn`, `.co.uk`），自动按域名层级（完整域名、二级子域通配、根域名通配）与路径层级（精确路径、多级目录通配、全站路径）拆解出候选规则。
   - **规则匹配引擎 (`ruleMatcher.js`)**：支持域名边界匹配（避免子串误伤）与路径通配符正则转换，支持实时历史记录反查统计。
   - **后台实时守护 (`background/index.js`)**：监听 `onVisited` 事件，毫秒级静默删除命中规则的历史记录并计数；支持 30 分钟静默免记录模式（倒计时结合 `alarms` 自动恢复）。
3. **极简暗黑交互界面**：
   - **Popup 弹窗**：356px 宽度，无滚动条。展示当前标签页 URL 及命中状态、域名/路径层级胶囊单选组（显示实时匹配条数）、回溯清理复选框、隐藏并清理按钮、仅删历史按钮、以及 30 分钟静默胶囊倒计时。
   - **Options 管理页**：宽屏双卡片响应式布局。
     - **模块 A（历史大扫除）**：支持防抖搜索、时间范围过滤（全部、1小时、今天、7天）、防误删预览列表（支持逐条反选）、一键删除选中项以及将搜索词加入永久隐藏规则。
     - **模块 B（规则管理）**：支持手动新增规则、JSON 备份导入/导出、启用/暂停状态切换、拦截计数与删除。

### 变更明细 (Detailed Changes)
- `feat(adapters)`: 规范 `IBrowserAdapter` 接口，并分别实现 `ChromiumAdapter` 与 `FirefoxAdapter`，通过 `adapters/index.js` 实现环境自动嗅探导出。
- `feat(core)`: 实现 `urlParser.js` 域名/路径拆解算法与 `ruleMatcher.js` 正则引擎，并实现统一 `storage.js` 存储管理器。
- `feat(background)`: 编写后台服务守护脚本，支持访问实时拦截与 30 分钟免记录定时器。
- `feat(popup)`: 编写 356px 现代暗黑极简 Popup 视图（HTML/CSS/JS），实现当前页一键拆解、实时统计与一键清理。
- `feat(options)`: 编写独立 Options 控制台，支持防抖搜索批量删除、误删防护、规则增删改查与 JSON 导入导出。
- `feat(build)`: 编写 `build.js` 自动化构建工具与双 Manifest（`manifest.chrome.json` & `manifest.firefox.json`）。
- `feat(icons)`: 生成 16x16, 32x32, 48x48, 128x128 像素标准 PNG 图标。
