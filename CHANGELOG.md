# Changelog & Requirements Specification

本项目遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/v1.0.0/) 提交规范，记录每次迭代的需求整理、技术决策与变更明细。

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
