# Changelog & Requirements Specification

本项目遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/v1.0.0/) 提交规范，记录每次迭代的需求整理、技术决策与变更明细。

---

## [1.0.29] - 2026-10-15

### 需求整理与 Bug 修复 (Bug Fixes & Technical Decisions)
1. **修复静默模式与命中规则时工具栏图标未动态改变的核心 Bug (Fix Toolbar Icon Not Changing in Silent Mode & Rule Hits)**:
   - **Bug 根因排查与定位**：
     - **根因一：Service Worker 相对路径解析失效**：
       - `toolbarIndicator.js` 中 `ICON_PATHS` 使用了无前导斜杠的相对路径（如 `'icons/icon-green16.png'`）；
       - 在 Chromium MV3 Service Worker（位于 `/background/index.js` 子目录）执行环境下，Chrome 会将未带前导斜杠的相对路径按 Service Worker 脚本所在目录解析（即 `background/icons/icon-green16.png`），导致 `chrome.action.setIcon` 在底层抛出 `Could not load icon` 异常并失败；
     - **根因二：静默模式只针对单标签页且依赖前台窗口**：
       - 静默模式是全局行为，但原本仅在缓存更新时调用 `getCurrentActiveTab()` 尝试获取单个活动标签，而当用户在 Popup 弹窗中点击开启静默模式时，`chrome.tabs.query({ active: true, currentWindow: true })` 往往无法正确返回用户当前背后的网页标签，且缺少全局默认图标设置（无 `tabId` 的 `setIcon`）；
     - **根因三：`tabs.onUpdated` 状态未 complete 时跳过指示器更新**：
       - 原代码使用 `changeInfo.status === 'complete' ? tab?.url : null` 判定，当网页在加载中（`status: 'loading'`）或同源页面跳转只变动 hash/title 时，更新被阻断，用户无法在导航开始瞬间看到图标切换为绿色；
     - **根因四：活动标签切换事件（`onActivated`）无法及时同步**：
       - 原逻辑依赖 `getCurrentActiveTab` 间接反查，而在 Service Worker 中推荐使用 `chrome.tabs.get(activeInfo.tabId)` 精确秒级直查。
   - **全链路修复与架构优化**：
     - **路径绝对根锚定与适配器自动标准化**：
       - `ICON_PATHS` 中所有图标路径统一加上前置根路径斜杠（`'/icons/icon16.png'`, `'/icons/icon-green16.png'` 等）；
       - 在 `ChromiumAdapter.js` 与 `FirefoxAdapter.js` 的 `action.setIcon` 中增加路径自动规范化防御（若未带 `/` 则自动补全），彻底根除底层路径解析异常。
     - **静默模式全局与全标签页双重同步机制**：
       - 新增 `updateGlobalToolbarIndicator(silentUntil, lang)`，在静默模式开启或到期时，直接更新扩展全局默认的工具栏图标（绿色/蓝色），确保扩展在任何窗口、新开标签页或关闭弹窗后均直接显示正确颜色；
       - `syncAllTabsToolbarIndicators()` 遍历当前所有已打开的标签页（`browserApi.tabs.query({})`），逐个调用 `updateTabToolbarIndicator`，实现秒级全量刷新。
     - **导航监听即时响应与多级直查优化**：
       - `tabs.onUpdated` 改为优先获取 `changeInfo.url || tab?.url`，只要识别到目标 URL 即刻渲染对应防护状态（命中规则秒切绿盾，未命中保持蓝盾），无需阻塞等待全网页资源加载完毕；
       - `tabs.onActivated` 优先通过新增适配器方法 `browserApi.tabs.get(activeInfo.tabId)` 精确秒查标签页 URL 并同步指示器；
       - 适配器抽象契约同步补全 `tabs.get` 与 `tabs.query`。
2. **测试与版本同步 (Version 1.0.29 Synchronization)**：
   - 补充 `tests/adapters.test.js` 针对 `tabs.get` 与 `tabs.query` 的抽象契约测试；
   - 补充 `tests/toolbarIndicator.test.js` 针对 `updateGlobalToolbarIndicator` 全局图标渲染的独立测试；
   - 全套 159 项自动化单元测试全部通过（159 pass, 0 fail）；
   - 同步升级版本至 `1.0.29`（`package.json`, `manifest.chrome.json`, `manifest.firefox.json`），并执行 `node build.js` 重新构建发布包。

---

## [1.0.28] - 2026-10-15

### 需求整理 (Requirements Overview)
1. **工具栏图标蓝绿双态动态切换与角标纯净化 (Blue/Green Dual-State Icon & Clean Toolbar UX)**:
   - **用户需求背景**：
     - 用户明确要求：“图标平时蓝色，在浏览处于保护列表的页面时，图标换成绿色，不要用文字来区别保护状态”；
     - 工具栏原本采用绿色角标“无痕”与紫色角标“静默”来指示保护状态，文字角标在极小工具栏中容易产生视觉噪音与拥挤感；
     - 改为通过扩展图标本身的显式色彩状态进行直观沟通（蓝色 = 平时正常记录模式，绿色 = 命中保护规则或静默免记录模式），彻底移除所有文字角标，实现极简纯净的交互体验。
   - **视觉设计与色彩方案**：
     - **平时科技蓝盾牌 (Normal / Recording State - Blue Shield)**：
       - 当用户浏览普通网页、未受保护页面或内置页面时，扩展图标呈现高饱和科技蓝渐变盾牌（`#3b82f6` 至 `#0284c7`），中心内嵌 Chrome 官方经典纯白历史记录符号；
       - 默认图标（`action.default_icon` 及扩展清单 `icons`）直接指向全套蓝色盾牌 (`icons/icon*.png`)。
     - **保护状态翡翠绿盾牌 (Protected State - Green Shield)**：
       - 当页面命中已启用的域名/路径/关键词保护规则，或处于全局 30 分钟静默免记录模式时，动态切换为翡翠青绿渐变盾牌（`#10b981` 至 `#059669`），中心同样内嵌纯白历史符号；
       - 新增保护状态全套高精图标资源 (`icons/icon-green*.png`：16px, 32px, 48px, 128px, 512px) 及母本 `icons/icon-green.svg`。
     - **彻底移除角标文字提示 (Zero-Badge Interference)**：
       - 全部分支统一将 `browserApi.action.setBadgeText({ tabId, text: '' })` 置为空，彻底废除“无痕”、“HIDE”、“静默”、“MUTE”等文字角标，完全依赖图标蓝/绿色彩变化进行区分；
       - 保留细腻的 Tooltip 鼠标悬停提示，用户悬停时仍可清晰获悉是否保护、命中的具体规则或静默模式倒计时。
2. **全流程单元测试完善与版本同步 (Version 1.0.28 Synchronization)**：
   - 更新 `tests/toolbarIndicator.test.js`：覆盖保护状态（绿盾）、正常状态（蓝盾）、内部页面（蓝盾）以及角标文字恒为空字符串的核心断言；
   - 同步将 `package.json`、`manifest.chrome.json`、`manifest.firefox.json` 的版本号提升至 `1.0.28`，并通过 `build.js` 重新分发双内核包至 `dist/`。

### 变更明细 (Detailed Changes)
- `feat(branding)`:
  - 生成平时科技蓝全套图标：`icons/icon16.png`, `icon32.png`, `icon48.png`, `icon128.png`, `icon512.png` 与 `icons/icon.svg`。
  - 生成保护状态翡翠绿全套图标：`icons/icon-green16.png`, `icon-green32.png`, `icon-green48.png`, `icon-green128.png`, `icon-green512.png` 与 `icons/icon-green.svg`。
- `feat(toolbar)`:
  - 重构 `src/background/toolbarIndicator.js`：
    - `ICON_PATHS` 新增 `NORMAL`（蓝色）与 `PROTECTED`（绿色），同时保留 `ACTIVE` / `DIMMED` 兼容别名；
    - 命中保护规则与静默模式时切换为 `ICON_PATHS.PROTECTED`；
    - 普通网页与内部页面呈现 `ICON_PATHS.NORMAL`；
    - 移除所有角标文字输出，全状态清空 `setBadgeText`。
- `test`:
  - 更新 `tests/toolbarIndicator.test.js`，验证绿盾/蓝盾状态切换与文字角标恒为空，157 项单元测试全部通过。
- `build`:
  - `package.json`、`manifest.chrome.json`、`manifest.firefox.json`: 版本号统一步进至 `1.0.28`。
  - `dist/`: 经 `node build.js` 重新打包更新 Chrome 与 Firefox 发布包。

---

## [1.0.27] - 2026-10-15

### 需求整理 (Requirements Overview)
1. **去外框纯粹化与 Chrome 官方历史记录符号融合 (Frameless Pure Shield with Chrome History Emblem)**:
   - **业务与视觉反馈背景**：
     - 用户明确要求“图标不要外面的框，里面的盾形不错，保持，盾中间换成chrome历史记录的图标形状，大小比例要协调”；
     - 彻底去除外围方形底座，使图标背景 100% 透明，完全以经典盾牌轮廓作为主体，极致通透轻盈；
     - 保留用户认可的翡翠青绿渐变盾形轮廓，将盾牌中心符号替换为 Chrome 官方经典的“逆时针历史回溯圆弧带时钟指针（Chrome Material History Icon）”。
   - **视觉设计与工程落地**：
     - **纯粹无框透明设计 (Pure Frameless Design)**：
       - 彻底移除外围圆角矩阵（Squircle）方框，图标背景 100% 镂空透明；
       - 将经典盾牌轮廓等比例放大充盈至满画布（外置极细柔和微投影），充分利用 16×16、32×32、48×48 等工具栏各级像素空间；
     - **嵌入 Chrome 经典官方历史记录图腾**：
       - 采用 Google Material Design 官方 History 图腾（包含逆时针回溯圆环、左侧回溯箭头以及 12 点与 3 点方向的时钟指针）；
       - 采用纯白（`#ffffff`）矢量填充，大小控制在盾牌宽度黄金比例（~54%），居于盾牌视觉重心，留白协调，线条饱满，即使在 16px 工具栏下也清晰可辨；
     - **双态同步升级 (Active & Dim States)**：
       - 高亮彩版（`icon*.png`）：经典翡翠青绿渐变（`#10b981` 至 `#06b6d4`）；
       - 静默待机版（`icon-dim*.png`）：采用素雅石板灰渐变（`#94a3b8` 至 `#64748b`）；
     - **全套矢量与像素级生成**：
       - 重新生成全规格资源：`icons/icon16.png`, `icon32.png`, `icon48.png`, `icon128.png`, `icon512.png`、`icons/icon-dim16.png`, `icon-dim32.png`, `icon-dim48.png`, `icon-dim128.png`, `icon-dim512.png`，及母本 `icons/icon.svg`。
2. **全项目版本号同步与构建闭环 (Version 1.0.27 Synchronization)**：
   - 同步将 `package.json`、`manifest.chrome.json`、`manifest.firefox.json` 的版本号提升至 `1.0.27`，并通过 `build.js` 重新分发双内核包至 `dist/`。

### 变更明细 (Detailed Changes)
- `style(branding)`:
  - 重塑 `icons/icon.svg`：去除外部方框，保持盾形主体，中心精准融合 Chrome 官方 Material History 图腾。
  - 全量生成并替换 `icons/icon*.png` 与 `icons/icon-dim*.png` 各尺寸镂空图标。
- `build`:
  - `package.json`、`manifest.chrome.json`、`manifest.firefox.json`: 版本号统一步进至 `1.0.27`。
  - `dist/`: 经 `node build.js` 重新打包更新 Chrome 与 Firefox 发布包。
- `test`:
  - 全项目自动化测试 156 项全部通过（156 pass, 0 fail）。

---

## [1.0.26] - 2026-10-15

### 需求整理 (Requirements Overview)
1. **重构工具栏与全套品牌图标：极简轻量化与高亮浅色背景设计 (Light-Themed Minimalist Icon Redesign)**:
   - **业务与视觉反馈背景**：
     - 用户明确指出浏览器工具栏上的插件图标“黑漆漆一坨太丑了”，在标准浏览器浅色或暗色工具栏中因原深黑蓝底座（`#0e1726`、`#040711`）缩小至 16px/32px 后模糊成团、对比度低且辨识度差；
     - 用户要求“改成简单点的，浅色背景”。
   - **极简浅色视觉重构方案**：
     - **浅色高亮圆角矩阵底座 (Light Squircle Porcelain Canvas)**：
       - 彻底废除暗黑深空底座，改用清新通透的纯白至高雅微灰渐变底座（`#ffffff` 至 `#f1f5f9`），外加纤细柔和的立体微投影与 `#cbd5e1` 边界描边；
       - 确保图标无论在 Chrome、Edge、Firefox 的浅色主题还是深色/夜间主题工具栏中，均呈现清爽、通透、分明的高端视觉品质。
     - **极简明晰的翡翠青绿盾牌主体 (Simplified Emerald-Cyan Shield)**：
       - 摒弃以往复杂的 12 时钟刻度、多重暗金折面与细碎线条，回归纯粹极简图腾：
       - 采用现代渐变绿（`#10b981` 翡翠绿至 `#06b6d4` 电光青），在浅色底座上具备极高对比度（Contrast Ratio > 4.5:1）；
       - 盾牌中心采用加粗纯白极简守护勾勒（Checkmark），线条饱满、圆润，在 16×16、32×32 极限尺寸下依旧清晰锐利、一眼可辨。
     - **未激活/普通网页暗色状态同步升级 (Dim State Refinement)**：
       - `icon-dim*.png` 同步重塑为浅色白底微卡底座，中心盾牌采用中性素雅的石板灰（`#94a3b8` 至 `#64748b`），清爽呈现静默待机状态，彻底告别“黑成一坨”。
     - **全套资源与矢量母本交付**：
       - 生成并全面替换全套资源：`icon16.png`, `icon32.png`, `icon48.png`, `icon128.png`, `icon512.png`、`icon-dim16.png`, `icon-dim32.png`, `icon-dim48.png`, `icon-dim128.png`, `icon-dim512.png` 以及原生纯矢量 `icon.svg`。
2. **全项目版本号同步与构建闭环 (Version 1.0.26 Synchronization)**：
   - 同步将 `package.json`、`manifest.chrome.json`、`manifest.firefox.json` 的版本号提升至 `1.0.26`，并通过 `build.js` 重新分发双内核包至 `dist/`。

### 变更明细 (Detailed Changes)
- `style(branding)`:
  - 重构 `icons/icon.svg`：采用 `#ffffff` / `#f1f5f9` 浅色卡片底座，绘制极简翡翠青绿盾牌与粗线纯白勾玉。
  - 重塑并替换全量多尺寸图标：`icons/icon*.png`（高亮彩版）与 `icons/icon-dim*.png`（静默待机版）。
- `build`:
  - `package.json`、`manifest.chrome.json`、`manifest.firefox.json`: 版本号统一步进至 `1.0.26`。
  - `dist/`: 经 `node build.js` 重新打包更新 Chrome 与 Firefox 发布包。
- `test`:
  - 全项目自动化测试 156 项全部通过（156 pass, 0 fail）。

---

## [1.0.25] - 2026-10-15

### 需求整理 (Requirements Overview)
1. **核心规则匹配引擎极端边界强化与拟真高压测试体系 (Rule Matching Core Resilience & Boundary Stress Testing)**:
   - **业务与质量诉求**：
     - 用户提出针对插件最核心的“规则匹配引擎（`ruleMatcher`）”，希望测试更加完善、杜撰大量真实世界中用户可能输入的规则格式与各类复杂网络网址，全面验证各类极限边界条件。
   - **杜撰场景与边界维度全景**：
     - **用户输入多样性与自动类型推断边界**：
       - 协议与根路径容错：覆盖 `http://`、`https://`、全大写 `HTTPS://`、自适应双斜杠 `//example.com`、尾随多斜杠 `example.com///` 等；
       - 内网与本地开发环境：识别 `localhost`、`localhost:3000`、私有 IP `127.0.0.1:8080`、`192.168.1.1` 及 IPv6 `[::1]:8080`，杜绝带端口的主机名被误判为关键词；
       - 显式类型前缀容错：`keyword:`, `kw:`, `domain:`, `path:` 无论大小写或带多余空格均能精准清洗；
       - 单段词与特殊词：多语种纯词（如 `机密文件`、`代购`、`password`、`10086`）智能推断为 keyword；
     - **域名规则与防误杀极限挑战**：
       - 凭据、端口与深层子域：完整支持含 Userinfo（`user:pass@host`）、任意端口（`:8443`）、下划线与横杠组合子域名（`my_api.sub-domain.com`）；
       - 严格防误杀隔离：针对目标域名 `google.com`，深度验证前缀拼接域名（`mygoogle.com`、`anti-google.com`）、不同国家/顶级域名（`google.com.cn`、`google.company`）、作为子域的钓鱼域名（`google.com.evil.org`）、以及在 Query/Hash 中含有该域名的第三方网站（`evil.com/?url=google.com`）**全部 100% 严密隔离**；
       - 多级国家公用后缀：精确识别 `bbc.co.uk` 与 `tsinghua.edu.cn` 等二级顶级域；
     - **路径规则与边界控制**：
       - 通配与精确路径：通配符路径（`api/v1/*`）支持任意深层子路由与查询参数；精确路径（`example.com/checkout` 与 `example.com/checkout/`）支持尾随斜杠自适应与参数哈希匹配，同时杜绝未通配子目录越界（如 `checkout-complete`）；
       - 特殊正则符号：转义 `+`（`c++/*`）、方括号（`file[1].pdf`）、问号与星号等；
     - **关键词规则与解码引擎**：
       - 双重解码容错：同时支持 `decodeURIComponent` 与 `decodeURI`，完美解析搜索引擎将 `+` 编码为 `%2B`（如搜索 `C++` -> `%2B%2B`）及各种中文字符编码；
       - 畸形编码容错：针对包含残缺百分比编码（如 `%88%99`）的恶意或损坏 URL，严密捕获 `URIError`，杜绝插件后台崩溃；
       - 关键词内通配符：支持 `access*token` 跨越中间连接符与任意字符；
     - **非网页协议安全防御**：
       - 验证 `chrome://`, `about:blank`, `file:///`, `blob:`, `data:`, `javascript:` 等各类特殊协议不会引发异常；
       - 验证 `null`, `undefined`, 空对象, 空字符串等边界入参防御；
     - **大规模拟真压测 (500 条高混淆历史数据集)**：
       - 构造含真命中项、相似干扰项、重定向参数项、普通网页混合的 500 条数据集，测试批量出清性能，命中率 100% 且毫秒级响应。
2. **全项目版本号同步与构建闭环 (Version 1.0.25 Synchronization)**：
   - 同步将 `package.json`、`manifest.chrome.json`、`manifest.firefox.json` 的版本号提升至 `1.0.25`，并通过 `build.js` 重新分发双内核包至 `dist/`。

### 变更明细 (Detailed Changes)
- `refactor(core)`:
  - `src/core/ruleMatcher.js`:
    - `detectRuleType`: 完善协议剥离逻辑支持协议自适应 `//`；强化主机名分析，支持包含端口的 `localhost:port`、`127.0.0.1:port` 及 IPv6 识别为 domain 规则。
    - `domainRuleToRegex`: 正则中集成 Userinfo（`[^/@:\s]+@`）支持、下划线子域匹配，清洗多重星号与点号 `replace(/^[*.]+/g, '')`。
    - `pathRuleToRegex`: 精确路径规则增加尾部可选斜杠 `(?:\\/?(?:[?#].*)?)?$`，协议前缀剥离支持 `//`。
    - `matchesRule`: 关键词匹配新增 `decodeURIComponent` 优先级解码，精准解析 `%2B` 等 URI 关键字符，保持 `URIError` 容错。
    - `normalizeDomain`: 增加 Userinfo 凭据剥离与 `replace(/^[*.]+/g, '')`。
    - `computeCandidateStatus`: 路径规则比较时剥离协议前缀，提升多态容错。
- `test`:
  - 新增 `tests/ruleMatcher.edgeCases.test.js`，包含 10 个测试套件、27 个大项数十个极限边界测试用例。
  - 全项目自动化测试用例由 **129 项大幅扩充至 156 项全部通过**（156 pass, 0 fail），覆盖率达到核心模块 95.62% 行覆盖、100% 函数覆盖。
- `build`:
  - `package.json`、`manifest.chrome.json`、`manifest.firefox.json`: 版本号统一步进至 `1.0.25`。
  - `dist/`: 经 `node build.js` 重新编译更新发布包。

---

## [1.0.24] - 2026-10-15

### 需求整理 (Requirements Overview)
1. **直观工具栏图标与角标动态状态指示体系 (Real-time Toolbar Protection Status Indicator)**:
   - **业务与体验诉求**：
     - 用户在浏览网页时，希望无需主动点击插件弹出层，仅通过直观观察浏览器工具栏（Action Toolbar）的插件图标外观与动态角标（Badge），即可一眼获知当前页面是否受保护（即当前页面会不会被记录历史）。
   - **三维立体感知模型**：
     - **双态图标色调切换 (Adaptive Icon Saturation)**：
       - 当页面命中防记录规则或处于全局静默免记录时：展示高饱和、明亮青绿色的 Chrono-Shield 盾牌守护图标（`icons/icon-16.png`, `32`, `48` 等），传递坚固防护意象；
       - 当页面处于普通记录历史状态时：自动切换为低饱和度暗色灰度图标（`icons/icon-dim16.png`, `dim32`, `dim48` 等），减少视觉噪点；
       - 浏览器内置管理页（如 `chrome://`, `about:` 等）：自动切换为暗色灰度图标并清空角标。
     - **动态状态角标 (Dynamic Action Badge)**：
       - **规则命中（不记录历史）**：渲染翡翠绿背景（`#10b981`），角标文案标明 `无痕`（英文系统下自适应展示 `HIDE`）；
       - **静默模式激活（全局不记录历史）**：渲染极光紫背景（`#8b5cf6`），角标文案标明 `静默`（英文系统下自适应展示 `MUTE`）；
       - **普通网页（正常记录历史）**：彻底清空角标文案与背景色，保持浏览器工具栏整洁干净。
     - **鼠标悬浮详述 (Intelligent Tooltip)**：
       - 鼠标悬停在工具栏图标上时提供即时提示（Action Title），命中规则时清晰展示具体命中规则表达式（例如 `HistGuard: 🛡️ 已拦截历史记录 (命中规则: github.com)`）或静默免记录剩余倒计时说明。
   - **全方位事件监听与无缝联动网络**：
     - 深度联动标签页切换 (`tabs.onActivated`)、页面导航 (`tabs.onUpdated`)、单页应用 (SPA) 历史状态更替 (`webNavigation.onHistoryStateUpdated`, `onCommitted`)；
     - 深度联动规则持久化变更 (`storage.onChanged`)、规则内存缓存刷新 (`refreshCache`) 与静默模式到期闹钟 (`alarms.onAlarm`)，实时无缝调度指示器刷新。
   - **跨浏览器内核 Action 适配层演进**：
     - `IBrowserAdapter`、`ChromiumAdapter` 与 `FirefoxAdapter` 统一扩充 `action` 命名空间，对 `setBadgeText`、`setBadgeBackgroundColor`、`setTitle`、`setIcon` 实现跨内核抹平并内建标签页关闭瞬间的瞬态异常防御。
2. **全项目版本号同步与构建闭环 (Version 1.0.24 Synchronization)**：
   - 同步将 `package.json`、`manifest.chrome.json`、`manifest.firefox.json` 的版本号提升至 `1.0.24`，并通过 `build.js` 重新分发双内核包至 `dist/`。

### 变更明细 (Detailed Changes)
- `feat(background)`:
  - 新增 `src/background/toolbarIndicator.js`：实现纯函数 `evaluatePageStatus` 算法（解析 4 种页面防护状态），以及 `updateTabToolbarIndicator` 跨浏览器工具栏外观驱动。
  - 修改 `src/background/index.js`：全量打通 `tabs.onActivated`、`tabs.onUpdated`、`storage.onChanged`、`alarms.onAlarm` 及 `webNavigation` 监听，确保前后台状态始终毫秒级一致。
- `feat(adapters)`:
  - 修改 `src/adapters/IBrowserAdapter.js`、`src/adapters/ChromiumAdapter.js`、`src/adapters/FirefoxAdapter.js`：扩充 `action` 命名空间及 `tabs.onActivated` 跨浏览器封装。
- `assets`:
  - 补充设计低饱和暗色灰度图标：`icons/icon-dim16.png`, `icon-dim32.png`, `icon-dim48.png`, `icon-dim128.png`, `icon-dim512.png`。
- `test`:
  - 新增 `tests/toolbarIndicator.test.js`（12 项高覆盖率测试），扩充 `tests/adapters.test.js`，全套 129 项自动化测试全部执行通过（129 pass, 0 fail）。
- `build`:
  - `package.json`、`manifest.chrome.json`、`manifest.firefox.json`: 版本号统一步进至 `1.0.24`。
  - `dist/`: 经 `node build.js` 重新编译更新发布包。

---

## [1.0.23] - 2026-10-15

### 需求整理 (Requirements Overview)
1. **精简规则列表操作项（移除“立即回溯清理匹配该规则的历史记录”按钮）**：
   - **业务与交互优化背景**：
     - 用户明确要求删除自动防护规则列表中单条规则右侧的“立即回溯清理匹配该规则的历史记录（`rule-clean-btn`，🧹 图标）”按钮；
     - 规则添加时底层已自带全局回溯扫描与历史出清，规则卡片行操作进一步精炼为“启用/停用开关（Toggle）”与“删除规则（Delete）”，界面排版更紧凑，降低冗余操作维度。
   - **技术重构与方案**：
     - **模板与 DOM 精简**：在 `src/options/options.js` 的 `refreshRulesList()` 中移除每行渲染的 `<button class="rule-clean-btn">🧹</button>`；
     - **解耦事件绑定**：移除针对 `rule-clean-btn` 的获取与点击清理事件监听函数；
     - **样式表纯化**：在 `src/options/options.css` 中移除 `.rule-clean-btn` 及其 hover 样式，仅保留规则删除按钮专用样式。
2. **全项目版本号同步与构建闭环 (Version 1.0.23 Synchronization)**：
   - 同步将 `package.json`、`manifest.chrome.json`、`manifest.firefox.json` 的版本号提升至 `1.0.23`，并通过 `build.js` 重新分发双内核包至 `dist/`。

### 变更明细 (Detailed Changes)
- `feat(options)`:
  - `src/options/options.js`: 移除规则列表单行中的扫帚清理按钮及其点击事件监听器。
  - `src/options/options.css`: 清理 `.rule-clean-btn` 样式类。
- `build`:
  - `package.json`、`manifest.chrome.json`、`manifest.firefox.json`: 版本号统一步进至 `1.0.23`。
  - `dist/`: 经 `node build.js` 重新编译更新发布包。
- `test`:
  - 全套 117 项自动化测试全部执行通过（117 pass, 0 fail）。

---

## [1.0.22] - 2026-10-15

### 需求整理 (Requirements Overview)
1. **全新品牌视觉识别体系设计（打造 HistGuard "Chrono-Shield 时空之盾" 全套图标）**：
   - **设计理念与视觉隐喻 (Brand Metaphors)**：
     - **Chrono-Shield（时空之盾）**：外部采用坚固的立体切面防卫盾牌（Security Shield），象征对浏览器足迹与隐私的无死角守护；
     - **History Dial（历史表盘）**：内部镶嵌 12 段精准时间刻度表盘，代表浏览器访问时间戳与历史日志；
     - **Rewind / Stealth Sweep（逆向回溯与无痕出清）**：中心融入高亮逆向回溯光弧与箭头，直观传递“瞬间抹平敏感浏览痕迹、历史无痕可退”的核心业务特性；
     - **Cyber Core Beacon（隐私信标）**：中央汇聚点如同智能探测信标，象征后台四通道多路实时自动化拦截网。
   - **全套尺寸与工程化落地 (Asset Deliverables)**：
     - `icon16.png` (16x16)：专为浏览器扩展栏 Favicon 与标签页设计，超高对比度保证极小尺寸下的高辨识度；
     - `icon32.png` (32x32)：适配 Windows 高 DPI 屏幕扩展栏主按钮与 Popup 弹窗头部 Brand Logo；
     - `icon48.png` (48x48)：专供 `chrome://extensions` 与 `about:addons` 扩展管理控制台卡片展示；
     - `icon128.png` (128x128)：Chrome Web Store、Edge Addons 与 Firefox AMO 应用商店官方分发规格；
     - `icon512.png` (512x512)：超高清视网膜母图；
     - `icon.svg`：原生手绘纯矢量 SVG 母本，内置霓虹线性/径向渐变与高斯辉光滤镜，任意无损放大。
   - **UI 界面深度融入**：
     - 在 `popup.html` 与 `options.html` 中彻底替换原有的通用 Emoji `🛡️`，接入定制高精度圆角 Brand 图标与发光微阴影。
2. **全项目版本号同步与发行闭环 (Version 1.0.22 Synchronization)**：
   - 同步将 `package.json`、`manifest.chrome.json`、`manifest.firefox.json` 的版本号提升至 `1.0.22`，并通过 `build.js` 重新分发双内核包至 `dist/`。

### 变更明细 (Detailed Changes)
- `feat(assets)`:
  - `icons/`: 新增并更新 `icon16.png`, `icon32.png`, `icon48.png`, `icon128.png`, `icon512.png`, `icon.svg`。
- `feat(popup & options)`:
  - `src/popup/popup.html` & `src/popup/popup.css`: 品牌标识由 Emoji 升级为专属 `icon32.png` 图标。
  - `src/options/options.html` & `src/options/options.css`: 控制台顶部品牌标识升级为带悬浮蓝光微阴影的 `icon48.png` 图标。
- `build`:
  - `package.json`、`manifest.chrome.json`、`manifest.firefox.json`: 版本号统一步进至 `1.0.22`。
  - `dist/`: 经 `node build.js` 重新编译更新发布包。
- `test`:
  - 全套 117 项自动化测试全部执行通过（117 pass, 0 fail）。

---

## [1.0.21] - 2026-10-15

### 需求整理 (Requirements Overview)
1. **精简历史批量删除底部操作栏（移除“删除记录并将搜索词加入永久隐藏”按钮）**：
   - **业务与交互优化背景**：
     - 用户明确要求去掉 Options 页面历史批量删除面板底部的“删除记录并将搜索词加入永久隐藏（`btnDeleteAndAddRule`）”按钮；
     - 底部操作栏精简聚焦于核心操作：“删除选中的 x 条记录”（批量常规删除）与“全部清空”（流式全量清空），去除复合混合操作，降低界面认知负担与误触风险。
   - **技术重构与方案**：
     - **模板精简**：从 `src/options/options.html` 的卡片底部操作栏（`.card-footer`）中彻底移除 `#btn-delete-and-add-rule` 按钮元素；
     - **脚本逻辑解耦与清理**：在 `src/options/options.js` 中移除 `btnDeleteAndAddRule` DOM 节点引用及其对应的高频状态维护（`disabled`、动态 tooltip 提示、清理过程锁），彻底移除绑定的点击事件监听器；
     - **样式自适应流式排版**：底部 `.card-footer` 保留常规删除与全部清空两枚高频主按钮，布局更为对称清爽。
2. **全项目版本号同步与构建闭环 (Version 1.0.21 Synchronization)**：
   - 同步将 `package.json`、`manifest.chrome.json`、`manifest.firefox.json` 的版本号提升至 `1.0.21`，并通过 `build.js` 重新分发双内核包至 `dist/`。

### 变更明细 (Detailed Changes)
- `feat(options)`:
  - `src/options/options.html`: 移除 `#btn-delete-and-add-rule` 按钮 DOM 结构。
  - `src/options/options.js`: 移除针对 `btnDeleteAndAddRule` 的节点获取、`updateSelectedSummary` 状态联动以及其点击绑定处理函数。
- `build`:
  - `package.json`、`manifest.chrome.json`、`manifest.firefox.json`: 版本号统一步进至 `1.0.21`。
  - `dist/`: 经 `node build.js` 重新编译更新发布包。
- `test`:
  - 全套 117 项自动化测试全部执行通过（117 pass, 0 fail）。

---

## [1.0.20] - 2026-10-15

### 需求整理 (Requirements Overview)
1. **优化历史批量删除中全部清空按钮交互逻辑（列表中无数据时禁用而非隐藏，有数据时可点击）**：
   - **交互痛点与问题根因**：
     - 原先“全部清空（`btnDeepClean`）”按钮在历史记录少于一页（无分页数据）或无数据时会被直接添加 `hidden` 样式类隐藏，导致界面操作区布局抖动，且用户无法直观了解是否存在“全部清空”功能；
     - 原逻辑中即使列表中有少量数据，也可能因 `!hasMoreHistory` 而被错误隐藏，违背“只要列表中有数据就能一键清空”的交互直觉。
   - **技术重构与方案**：
     - **按钮常驻占位**：从 HTML 结构中移除初始的 `hidden` 类，改为默认 `disabled` 状态；在任何数据拉取、重置与切换生命周期中，不再切换 `hidden`，保持界面按钮位置稳定不跳动；
     - **状态精准联动**：统一通过 `updateSelectedSummary()` 及数据加载生命周期，依据 `currentHistoryResults.length === 0 || isOperatingCleaning` 精确控制 `btnDeepClean.disabled` 状态；列表中只要有任何数据即解除禁用；
     - **无搜索词全量清空提示升级**：针对无过滤搜索词但有历史列表的场景，新增二次确认弹窗词条 `confirmDeepCleanAll`，支持对当前时间范围下的全部历史记录执行一键出清。
2. **全项目版本号同步与发行闭环 (Version 1.0.20 Synchronization)**：
   - 同步将 `package.json`、`manifest.chrome.json`、`manifest.firefox.json` 的版本号提升至 `1.0.20`，并通过 `build.js` 重新编译分发双内核包至 `dist/`。

### 变更明细 (Detailed Changes)
- `feat(options)`:
  - `src/options/options.html`: 移除全部清空按钮的 `hidden` 类并添加 `disabled` 属性，保持操作占位稳定。
  - `src/options/options.js`: 移除针对 `btnDeepClean` 的 `hidden` 控制，统一基于 `currentHistoryResults.length === 0 || isOperatingCleaning` 管理其 `disabled` 状态；并在流式全量删除中支持无搜索词全量清空确认弹窗与状态恢复。
- `i18n(core)`:
  - `src/core/locales/zh-CN.js` & `src/core/locales/en.js`: 新增 `confirmDeepCleanAll` 词条，支持空搜索词下对当前时间筛选范围的全量清空二次确认。
- `build`:
  - `package.json`、`manifest.chrome.json`、`manifest.firefox.json`: 版本号统一步进至 `1.0.20`。
  - `dist/`: 经 `node build.js` 重新编译更新发布包。
- `test`:
  - 全套 117 项自动化测试全部执行通过（117 pass, 0 fail）。

---

## [1.0.19] - 2026-10-15

### 需求整理 (Requirements Overview)
1. **彻底修复关键词规则未生效问题（Google 搜索及 SPA 动态路由无痕拦截）**：
   - **问题现象**：
     - 用户添加规则 `keyword:bagaga`，但在 Google 搜索 `bagaga` 时，搜索历史记录依然残留在浏览器中（如 `https://www.google.com/search?q=bagaga&...`）。
   - **双重根因彻底定位 (Root Cause Analysis)**：
     - **根因一（浏览器内核 SPA 路由机制差异）**：Google 搜索等现代 Web 应用在搜索框输入或页面交互时，通过 HTML5 `history.pushState` / `replaceState` 动态变更历史记录。根据 W3C 与 Chrome 官方规范，`chrome.history.onVisited` **仅对整页完全重新加载生效，完全不会捕获单页应用 SPA / pushState 产生的历史写入**！此前后台仅监听 `onVisited`，导致 Google 搜索的 URL 变更被完全漏过。
     - **根因二（语法前缀输入习惯未做容错清洗）**：用户在规则输入框中习惯性输入 `keyword:bagaga`，系统若原样将 `keyword:bagaga` 作为正则比对目标，将导致无法命中普通的 Google 搜索 URL `?q=bagaga`。
     - **根因三（浏览器内核 SQLite 异步写入微延迟）**：即使事件触发，Chrome 写入历史记录有时存在数十毫秒的异步提交滞后，单次瞬时 `deleteUrl` 极易与底层磁盘写入发生竞态冲突（删除指令早于写入完成）。
   - **技术重构与攻坚方案**：
     - **权限与适配器升级**：在 Chrome 与 Firefox 清单文件中新增 `webNavigation` 权限；在 `IBrowserAdapter` 及具体适配器中新增 `tabs.onUpdated` 与 `webNavigation.onHistoryStateUpdated`、`webNavigation.onCommitted` 监听契约；
     - **后台多通道全方位实时拦截**：后台重构为“四通道联动守护网”：
       1. `history.onVisited`：常规页面完全导航；
       2. `tabs.onUpdated`：标签页实时 URL 变动（捕获地址栏回车与直接变更）；
       3. `webNavigation.onHistoryStateUpdated`：专职捕获 SPA `pushState` / `replaceState`（覆盖 Google 搜索）；
       4. `webNavigation.onCommitted`：页面加载提交点捕获；
     - **抗竞态两段式补偿出清 (Deferred Residual Clean)**：命中规则后，不仅立即调用 `deleteUrl` 物理删除，还在 200ms 和 800ms 两次微延时调度历史深度搜索，精准出清最近 30 秒内因 Chrome 异步落盘滞后而写入的残留项；
     - **规则引擎前缀容错兼容**：`ruleMatcher.js` 的 `detectRuleType`、`keywordRuleToRegex` 与 `matchesRule`，以及 `storage.js` 的 `addRule` 中全面防御性剥离 `keyword:` / `kw:` / `domain:` / `path:` 前缀，老规则与新规则均可 100% 自动容错。

2. **修复规则添加/清理后 Batch History Delete 面板未实时同步刷新问题**：
   - **问题现象**：用户在规则列表中添加关键词规则（或点击扫帚清理）后，匹配记录已被底层自动删除，但切换到或停留在“历史批量删除（Batch History Delete）”面板时，界面未同步刷新已删除的条目。
   - **根因分析**：
     - `switchTab('history')` 切换回历史视图时仅切换了 CSS class，未做数据刷新；
     - 规则添加与清理回调此前通过 `!panelHistory.classList.contains('hidden')` 判断，若在 rules 面板操作会被直接跳过且未打标记；
     - 适配器层缺失原生 `history.onVisitRemoved` 事件监听支持。
   - **解决方案**：
     - 在 `options.js` 引入 `isHistoryDirty` 脏标记状态与 `refreshHistoryIfVisibleOrMarkDirty` 统一调度；
     - 用户从其他面板切回“Batch History Delete”时，检测脏标记自动无感拉取最新历史；
     - 在 `IBrowserAdapter`、`ChromiumAdapter` 与 `FirefoxAdapter` 完整实现 `history.onVisitRemoved`，全自动监听底层历史移除并防抖同步 Options 视图；
     - 页面切回前台（visibilitychange）时自动感知脏数据并静默刷新。

3. **优化停用拦截命中统计时的界面隐私与纯净化呈现**：
   - **需求**：当用户在设置中停用“统计规则拦截命中次数（`enableHitTracking: false`）”时，顶部“累计拦截”状态卡片不再显示任何历史次数，仅显示“已停用”；同时在规则列表中完全隐藏“拦截xx次”徽章。
   - **变更与优化**：
     - 中英文语言包中将 `statTotalHitsDisabled` 文案纯化为“已停用”与“Disabled”（剥离 `{count}`）；
     - `options.css` 新增 `.hits-disabled` 专属沉浸样式；
     - `refreshRulesList()` 根据 `enableHitTracking` 动态判断，停用时完全不渲染 `.hits-badge` DOM 节点；
     - 设置开关变更与 `storage.onChanged` 实时重新渲染规则列表与顶部统计，实现无刷新即时响应。

4. **根路径 URL 规则输入智能识别与纯化（优先判定为 domain 并保存纯域名）**：
   - **问题现象**：
     - 当用户直接粘贴完整根路径 URL（如 `https://www.google.com/`）到规则输入框时，系统因末尾带 `/` 误将其归类为 `path` 路径规则，并原样保存包含协议头的冗长表达式，违背直觉且导致域名通配机制失效。
   - **技术重构与方案**：
     - `ruleMatcher.js` 的 `detectRuleType` 自动剥离末尾根路径斜杠后再做判定，若除去尾部斜杠后不含其他路由路径，一律优先识别为 `domain` 类型；
     - `storage.js` 的 `addRule` 新增域名规范化清洗通道：当规则类型为 `domain` 时，自动剥离前导协议（`https?://`）和末尾斜杠（`/`），将 `https://www.google.com/` 规范化为标准的纯域名 `www.google.com` 存储；
     - 规则查重机制无缝升级：输入带协议或斜杠的变体时，能够精准匹配并复用已存在的同名纯域名规则，杜绝冗余重复项。

5. **Options 页面导航栏视觉决策（保留 Tab 右侧数字徽章与功能图标）**：
   - **交互决策**：经界面实机体验与视觉效果对比评估，Tab 右侧具有动态统计数字徽章（当前已加载历史条数、已配置防护规则总数）及设置功能齿轮图标，能够为用户提供更清晰的数据概览与更直观的模块指示，决定保留徽章与图标的完整展现。

### 变更明细 (Detailed Changes)
- `feat(manifest)`: `manifest.chrome.json` 与 `manifest.firefox.json` 新增 `"webNavigation"` 权限。
- `feat(adapters)`:
  - `src/adapters/IBrowserAdapter.js`: 抽象基类新增 `tabs.onUpdated`，新增 `webNavigation` 命名空间及 `onHistoryStateUpdated`、`onCommitted` 规范；新增 `history.onVisitRemoved` 事件契约。
  - `src/adapters/ChromiumAdapter.js` & `src/adapters/FirefoxAdapter.js`: 完整实现 `tabs.onUpdated`、`webNavigation.onHistoryStateUpdated`、`webNavigation.onCommitted` 与 `history.onVisitRemoved`。
- `feat(core)`:
  - `src/core/ruleMatcher.js`: 防御性剥离 `keyword:` / `kw:` / `domain:` / `path:` 前缀；在 `detectRuleType` 中剥离根路径尾部斜杠，将 `https://www.google.com/` 优先推断为 `domain`。
  - `src/core/storage.js`: 在 `addRule` 入库时推断前缀语法并剥离；针对 `domain` 规则自动清洗协议头与末尾斜杠，规范保存纯域名。
- `feat(background)`:
  - `src/background/index.js`: 重构为多通道事件侦听网，新增 `cleanResiduals` 防异步滞后出清，完美覆盖 Google 搜索及所有 SPA 动态路由。
- `feat(options)`:
  - `src/options/options.js`: 接入 `isHistoryDirty` 与 `switchTab` 切回自动刷新，接入 `history.onVisitRemoved` 实时事件监听，彻底消除 Batch History Delete 视图不同步问题；支持停用拦截统计时顶部仅显示“已停用”并隐藏规则列表命中次数。
  - `src/options/options.css`: 新增 `.hits-disabled` 优雅呈现样式。
  - `src/core/locales/`: 调整 `statTotalHitsDisabled` 为纯状态词“已停用” / “Disabled”。
- `test`:
  - `tests/adapters.test.js`: 增加针对 `webNavigation`、`tabs.onUpdated` 与 `history.onVisitRemoved` 接口契约的单元测试。
  - `tests/ruleMatcher.test.js`: 增加用户反馈的 Google 搜索 URL 与 `keyword:bagaga` 容错匹配单元测试，增加 `https://www.google.com/` 根 URL 识别为 domain 的单元测试。
  - `tests/storage.test.js`: 增加 `addRule` 前缀自动清洗单元测试，增加 `https://www.google.com/` 自动纯化保存为 `www.google.com` 单元测试。
  - `tests/historyCleaner.test.js`: 全套回溯扫描与精准出清测试。全部 117 项测试用例全部通过。

---

## [1.0.18] - 2026-10-14

### 需求整理 (Requirements Overview)
1. **新增跨域关键词防护规则类型 (Keyword Rule Type)**：
   - **业务背景与设计目标**：
     - 用户希望支持跨域通用的全局敏感关键词拦截机制：“比如关键词 `xxx`，不管在 `a.com` 还是 `b.com`，只要出现 `xxx` 都可以不记录”。
     - 原有系统规则仅支持基于特定站点的 `domain`（域名规则）与 `path`（路径规则），无法应对跨域分散的敏感参数或查询词。
   - **技术方案与实现细节**：
     - **规则匹配引擎扩展**：在 `ruleMatcher.js` 中新增 `keyword` 规则类型与 `keywordRuleToRegex(pattern)` 正则转换器；
     - **跨域全量深度匹配**：不论用户访问哪个站点，只要 URL 主机名、路径、查询参数（如 `?q=xxx`）、解码后的百分比编码 URL（如中文关键词 `?q=%E6%B5%8B%E8%AF%95`）或页面标题中出现该关键词，均判定为命中；
     - **后台拦截实时联动**：在 `background/index.js` 的 `onVisited` 事件中即时拦截命中，立即物理删除历史记录并统计拦截次数，确保完全无痕；
     - **智能类型自动推断 (Smart Auto-Detection)**：在 `detectRuleType` 中，若用户未指定类型输入既不含斜杠 `/` 也不含点号 `.` 的纯词（如 `xxx`、`secret`、`password`），系统将自动推断为 `keyword` 类型；
     - **全局级联覆盖支持**：当存在已启用的关键词规则时，任何包含该关键词的候选域名或路径胶囊将自动判定为 `isCovered: true`（被关键词规则全局覆盖）；
     - **控制台与设置完整闭环**：在 Options 规则新增表单添加“关键词匹配”选项，规则列表展示专属玫红标签（`关键词` / `Keyword`），设置面板支持快捷搜索词强制转为关键词匹配。

### 变更明细 (Detailed Changes)
- `feat(core)`:
  - `src/core/ruleMatcher.js`: 引入 `keyword` 规则类型，新增 `keywordRuleToRegex` 支持纯词与通配符，在 `matchesRule` 中支持 URL 编码解码匹配与标题匹配，在 `computeCandidateStatus` 中加入关键词全局覆盖判定。
  - `src/core/storage.js`: 在 `importRules` 与 `addRule` 中全面支持持久化与导出 `keyword` 类型规则。
  - `src/core/locales/zh-CN.js` & `en.js`: 新增 `typeKeyword`、`tagKeyword`、`ruleTypeKeyword` 等中英双语国际化词条，保持 100% 键对等。
- `feat(options)`:
  - `options.html`: 在手动新增规则下拉框与快捷转换策略下拉框中新增“关键词匹配”选项；
  - `options.css`: 新增 `.type-keyword` 玫红徽章色彩规范，适配夜间深色与白天浅色模式；
  - `options.js`: 渲染 `rule-row` 时支持关键词类型徽标，支持快捷转为关键词匹配规则。
- `feat(background & popup)`:
  - `background/index.js`: 在 `onVisited` 拦截触发时将完整的 `historyItem` 传入 `findMatchingRule`，全面支持 URL 与标题的关键词实时抹除。
  - `popup.js`: 页面加载时以完整标签页信息核对关键词命中状态并实时展示保护徽标。
- `test`: 新增 9 项针对关键词跨域匹配、大小写不敏感、URL 解码、标题匹配与全局覆盖的单元测试，用例总数扩充至 106 项，全部通过。

---

## [1.0.17] - 2026-10-14

### 需求整理 (Requirements Overview)
1. **Popup 弹窗界面精简与多级域名级联覆盖防护 (Cascading Coverage)**：
   - **底部冗余入口精简**：彻底移除底部“按搜索结果批量删除历史记录/管理规则”条，右上角齿轮按钮作为前往 Options 的唯一专职入口，页面结构更清爽精炼；
   - **0 条历史时副按钮悬停与交互规范**：当匹配历史记录为 0 条时，副按钮“仅删 0 条”设为 disabled，并通过 CSS `pointer-events: none !important;` 彻底杜绝鼠标 hover 时的红色高亮与位移动画；
   - **隐藏列表已收录域名主按钮联动**：当选中域名已在隐藏规则列表中时，“隐藏并清理”主按钮设为 disabled，文字自动切换为“已在隐藏列表”，防范重复添加；
   - **多级域名层级覆盖算法 (Hierarchical Domain Cascading Coverage)**：
     - 当更上级父域名加入隐藏列表后（例如当前访问 `aa.bb.cc.dd`，当 `cc.dd` 或 `*.cc.dd` 被加入规则列表），其所有下级子域名（如 `aa.bb.cc.dd` 与 `bb.cc.dd`）均判定为受上级规则全面覆盖；
     - 被上级覆盖的胶囊在界面上整体半透明变灰、右侧显示 `已由上级覆盖` 徽标，并在 DOM 事件层拦截点击，禁止被选中；
     - 智能候选推荐算法优先推荐未入库且未被覆盖的规则，若全部被覆盖则安全回退，主按钮安全禁用；
   - **入库状态直观可视化体现**：已加入列表的域名胶囊附带绿色高亮边框与 `✓ 已在列表中` 标签，形成未加入 / 已入库 / 已由上级覆盖的三态视觉体系。
2. **Options 历史批量删除页面精炼与全部清空体验升级**：
   - **搜索框提示词精简**：删除搜索框 placeholder 中的“ (支持防抖实时检索)”字样；
   - **“全部清空”命名统一**：原“流式全量清空”统一更名为“全部清空”（英文为 `Clear All`），涵盖操作按钮、高级偏好设置选项、二次确认提示等所有层级；
   - **全部清空按钮智能动态显示**：仅在当前匹配的历史记录总量超过单页所能呈现的批次上限（存在更多未加载数据）时，才动态呈现“全部清空”按钮，避免在少量结果下造成视觉干扰。

### 变更明细 (Detailed Changes)
- `feat(core)`: 在 `src/core/ruleMatcher.js` 中新增并导出 `normalizeDomain`、`isSubdomainOf` 与 `computeCandidateStatus` 级联覆盖计算引擎，在 `tests/ruleMatcher.test.js` 中添加针对父子域级联与多级通配的完整单元测试。
- `feat(popup)`: 
  - `popup.html`: 移除底部 `<footer class="footer">` 结构；
  - `popup.css`: 增加 `.rule-capsule.in-list`、`.rule-capsule.covered`、`.capsule-status-tag` 状态样式；规范 `.btn:disabled` 强制屏蔽 hover 高亮；
  - `popup.js`: 接入级联计算逻辑，动态驱动主按钮 disabled 与副按钮 0 条禁用，移除废弃的 footer 事件绑定。
- `feat(options)`:
  - `options.html`: 搜索框 placeholder 移除防抖检索字样；将流式全量清空按钮与设置项文案统一调整为全部清空；
  - `options.js`: 在 `fetchHistoryBatch` 中根据 `hasMoreHistory` 动态切换 `#btn-deep-clean` 的可见性，仅在超过能显示数量时显示。
- `i18n(core)`: 在 `src/core/locales/zh-CN.js` 与 `en.js` 中同步新增 `badgeInList`、`badgeCovered`、`alreadyHidden` 等键值，更新 `btnDeepClean` 系列文案。
- `test`: 测试用例总数扩充至 97 项，全部自动化执行通过。

---

## [1.0.16] - 2026-10-14

### 需求整理 (Requirements Overview)
1. **彻底根除 Popup 弹窗视口坍缩为“细长条”核心缺陷**：
   - **致命根因诊断 (Root Cause)**：
     - **扩展弹窗视口与常规网页的根本机制差异**：在浏览器扩展中，桌面端工具栏 Popup 弹窗自身的初始尺寸完全由 `html` 与 `body` 的固定像素尺寸撑开。此前在样式表中误引入了 `@media (max-width: 480px)`，由于 Popup 设定的 460px 宽度小于 480px，导致桌面端弹窗在挂载瞬间被浏览器**无条件命中**为手机屏幕视口；
     - **100vw 循环坍缩与 100vh 垂直拉伸**：一旦命中媒体查询，`width: 100vw` 失去外部固定像素锚定，直接被 Chromium/Firefox 引擎坍缩为最小内容极限宽度（几十像素）；而容器样式又包含 `min-height: 100vh`，将纵向高度拉伸至全屏高度，最终在视觉上呈现为一根极窄、垂直超长、文字全部错乱换行的“细长条”。
   - **重构与修复细节**：
     - **绝对锚定视口尺寸**：彻底清除 `html, body` 上的所有视口宽度媒体查询，在全局硬性设定 `width: 460px; min-width: 460px; max-width: 460px; margin: 0 auto;`，保证无论在任何 Chromium、Edge 或 Firefox 桌面宿主中均稳定以标准 460px 黄金尺寸展开；
     - **高度自适应包裹**：彻底废除任何 `min-height: 100vh` 强制撑高指令，高度 100% 由卡片与规则胶囊内容高度自然流式包裹；
     - **触控特性安全隔离**：将触控人机优化严格迁移至 `@media (hover: none) and (pointer: coarse)`（标准触控指针硬件特性），确保仅在真实移动触屏环境下适度放大点击热区，桌面端鼠标指针环境 0 干扰。

### 变更明细 (Detailed Changes)
- `fix(popup)`: 重构 `popup.css` 中 `html` 与 `body` 宽度声明为绝对 460px 锚定；移除 `@media (max-width: 480px)` 引起的 `100vw` 坍缩与 `100vh` 垂直长条拉伸；改用 `pointer: coarse` 隔离触控交互。

---

## [1.0.15] - 2026-10-14

### 需求整理 (Requirements Overview)
1. **Options 管理控制台静默模式倒计时实时自动更新机制**：
   - **痛点排查**：
     - **缺少心跳定时器驱动**：原 `options.js` 仅在页面初始加载调用 `refreshGlobalStats()` 时拉取一次 `getSilentMode()` 静态计算分钟数，此后即使时间推移、静默模式分秒递减或已自然过期，页面从未启动任何定时器进行动态重绘，导致界面永远停留在初次加载时的数值；
     - **跨页面与后台节流不同步**：跨页面存储监听 `storage.onChanged` 中对 `SILENT_MODE` 仅间接刷新规则列表，未独立触发静默状态重算；当浏览器对后台标签页实施 Timer Throttling 后切回页面时缺少可见性校准。
   - **重构与优化细节**：
     - **毫秒级目标时间差分计算**：基于 `silent.until` 绝对时间戳在 `refreshSilentModeStatus()` 中启动 1 秒心跳定时器，动态格式化 `MM:SS` 分秒倒计时展示（如 `开启中 (29:45)` / `Active (29:45)`），等宽字体下跳动丝滑直观；
     - **生命周期与自然到期重置**：当剩余时间归零时，自动注销定时器并调用底层清理，静默模式徽章自动平滑恢复为 `未开启` / `Off`；
     - **多标签与前台可见性校验**：监听 `document.visibilitychange`，切回标签页时瞬时校准真实剩余时间，彻底杜绝后台节流产生的显示时滞；在 `storage.onChanged` 中精准捕获 `SILENT_MODE` 变更并即时重置倒计时。

### 变更明细 (Detailed Changes)
- `feat(options)`: 封装 `formatRemainingTime` 与 `refreshSilentModeStatus`，实现秒级倒计时心跳驱动与自动注销清理；接入 `visibilitychange` 前台焦点校准与 `storage.onChanged` 实时重绘。
- `i18n(core)`: 升级 `options.statSilentOn` 为支持 `{time}` 动态插值（`开启中 ({time})` / `Active ({time})`）。
- `test(i18n)`: 同步更新单元测试 `tests/i18n.test.js` 中的插值验证断言。

---

## [1.0.14] - 2026-10-14

### 需求整理 (Requirements Overview)
1. **Popup 弹窗视口再次拓宽与英文环境按钮防撑爆彻底解决**：
   - **痛点排查**：
     - **英文文案长度不对称**：英文模式下副按钮原翻译为 `Delete {count} items only`（21 个字符），当与主按钮 `Hide & Clean` 并排时，副按钮作为 `flex-shrink: 0` 占据了过宽的横向空间，导致主按钮被严重压缩，触发文字溢出与撑爆；
     - **视口横向空间仍可更充裕**：410px 面对双英文操作按钮与长路径展示依然较为紧凑，对比行业标杆扩展（450px–480px），仍有进一步释放空间的余量。
   - **重构与优化细节**：
     - **视口拓宽至 460px**：将桌面端视口统一扩展至 `460px`（横向可用空间从 378px 跃升至 428px，大幅扩容 50px），元素呼吸感极佳；
     - **英文文案精简化**：将副按钮文案精炼为国际通用的 `Delete ({count})`，保持简洁有力的同时将完整语义交由 `title` Tooltip 保留，与主按钮比例达到黄金分割；
     - **多重防御机制**：为按钮文本新增 `.btn-text` 截断防溢出样式（`text-overflow: ellipsis`），按钮内边距调整为更平衡的 `9px 12px`，图标设置 `flex-shrink: 0`，顶部状态徽标拓宽至 `290px`，彻底杜绝任何语言模式下的换行撑爆。

### 变更明细 (Detailed Changes)
- `style(popup)`: 将基础及桌面端视口由 410px 拓宽至 460px；优化按钮 padding 及图标防缩、文本防溢出截断；将状态徽标最大宽度拓宽至 290px。
- `i18n(en)`: 将 `popup.cleanOnly` 由 `Delete {count} items only` 精简为 `Delete ({count})`，保持界面优雅与对称。
- `feat(popup)`: 为 `popup.html` 按钮文本节点添加 `btn-text` 防溢出类名。

---

## [1.0.13] - 2026-10-14

### 需求整理 (Requirements Overview)
1. **Popup 弹窗视口宽度与排版错位全量重构**：
   - **痛点排查**：
     - **视口过窄**：原桌面端固定宽度仅为 `356px`（远低于现代主流扩展如 Bitwarden / 1Password / uBlock 的 400px–420px 标准），导致内容元素极其局促；
     - **按钮文字暴涨撑爆布局**：选中候选规则时，原逻辑会将长规则路径直接拼接进主按钮文字（如 `隐藏并清理 (domain.com/path/*)`），动辄产生 40–60 字符的超长文本，彻底撑爆网格排版并把右侧“仅删 X 条”挤出屏幕；
     - **微标与文本被挤压截断**：规则胶囊内 `.capsule-count` 缺少 `flex-shrink: 0` 防收缩保护，长规则下数量徽标被挤压变形；复选框文字过长时复选框垂直居中悬空；底部跳转文本无截断保护引发多行换行。
   - **重构与优化细节**：
     - **视口黄金拓宽**：桌面端视口由 356px 升级拓宽为现代黄金阅读比例 `410px`，充分释放横向间距，呼吸感与比例大幅提升；
     - **按钮文本精简与悬浮解耦**：主按钮固定显示清爽的“🛡️ 隐藏并清理”，将具体规则详情转移至原生 `title` 悬浮 Tooltip，彻底根治按钮膨胀挤压；
     - **弹性抗挤压保护**：按钮组改用 `display: flex`（主按钮 `flex: 1`，辅助按钮 `flex-shrink: 0`）；规则胶囊数量徽标增加 `flex-shrink: 0`；复选框调整为顶对齐（`align-items: flex-start`）；底部链接文本加入弹性省略截断保护（`text-overflow: ellipsis`）。

### 变更明细 (Detailed Changes)
- `style(popup)`: 将桌面端视口拓宽至 410px；重构 `.popup-container`、`.btn-group`、`.checkbox-label`、`.rule-capsule` 与 `.footer-link` 弹性布局防挤压保护。
- `feat(popup)`: 在 `popup.js` 的 `updateActionButtons` 中将主按钮文本精炼化，完整规则转移至 `title` Tooltip。

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
- `style`: 重构 `options.css` 与 `popup.css`，支持完整的白天浅色与夜间深色主题 CSS 变量系统与 Anti-FOUC 机制；修复浅色模式下左侧激活 Tab 标题与描述硬编码白色导致对比度缺失的显示问题。
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
