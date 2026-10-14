# Changelog & Requirements Specification

本项目遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/v1.0.0/) 提交规范，记录每次迭代的需求整理、技术决策与变更明细。

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
