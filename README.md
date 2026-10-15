# 🛡️ HistGuard - 轻量级跨浏览器历史记录智能管理与全自动隐私抹除插件

> **HistGuard** 是一款专为重视隐私安全与浏览效率的用户打造的跨浏览器（Chrome / Edge / Brave / Firefox）历史记录管理扩展。采用**统一抽象适配器层（Adapter Pattern）**实现底层 API 解耦，支持基于 URL 层级自动拆解的零输入快速防护、毫秒级实时隐私抹除与 30 分钟临时无痕模式。

---

## ✨ 核心特性

- **跨浏览器内核统一兼容**：
  - **Chromium**：Chrome / Edge / Brave（Manifest V3，基于 `background.service_worker` 与 `chrome.*` API）。
  - **Firefox**：Gecko 内核（Manifest V3，基于 `background.scripts` 与原生 `browser.*` Promise API）。
  - 核心业务与 UI 层绝不直接耦合浏览器全局对象，通过 `IBrowserAdapter` 统一调度。
- **URL 智能层级拆解算法 (`urlParser.js`)**：
  - 域名维度：自动拆解当前完整域名、二级子域通配（`*.sub.domain.com`）与根域名通配（`*.domain.com`），内置数十种常见多级公用后缀（如 `.com.cn`, `.co.uk`, `.edu.cn`）识别。
  - 路径维度：自动拆解精确页面 URL、当前目录通配（`domain.com/a/b/*`）、逐级上级目录通配（`domain.com/a/*`）及全站路径通配（`domain.com/*`）。
- **高精度规则匹配引擎 (`ruleMatcher.js`)**：
  - 严格匹配域名及其合法子域，严防 `mygoogle.com` 等前缀子串误杀。
  - 支持通配符路径正则编译、全局关键词跨域拦截与实时历史库匹配反查。
- **毫秒级后台自动防护、崩溃自愈与临时无痕模式 (`background/index.js`)**：
  - 监听 `onVisited`、`webNavigation` 与 SPA 路由多通道事件，页面访问瞬间物理抹除命中规则的历史记录。
  - **30 分钟临时无痕模式**：一键开启，在此期间一切新浏览均物理不留痕，结合 `alarms` 定时器到期自动恢复。
  - **持久化任务队列与启动自愈**：大体量出清任务原子持久化至存储，即便遭遇浏览器崩溃或断电关机，冷启动后静默自愈续跑。
  - **工具栏动态状态指示器**：根据当前网页防护命中状态与临时无痕模式，实时变色切换工具栏图标（翡翠绿保护 / 科技蓝常规）与 Tooltip。
- **现代极简响应式 UI 设计**：
  - **Popup 弹窗**：紧凑自适应排版，支持实时历史匹配条数计算与“防护并清理”/“仅删历史”双操作。
  - **Options 控制台**：左侧 Tab 垂直导航与自适应全宽面板，涵盖多维历史检索与深度清理、规则完整增删改查、JSON 备份导入导出与高级偏好设置。

---

## 🏗️ 目录结构与模块解耦设计

```text
HistGuard/
├── .gitignore                    # Git 忽略规则
├── CHANGELOG.md                  # 迭代需求整理与变更记录
├── README.md                     # 本说明文档
├── package.json                  # 项目配置与 NPM Script
├── build.js                      # 零外部依赖原生构建打包脚本
├── manifest.chrome.json          # Chrome MV3 扩展清单
├── manifest.firefox.json         # Firefox MV3 扩展清单
├── icons/                        # 标准尺寸图标 (16, 32, 48, 128)
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
├── src/
│   ├── adapters/                 # 统一抽象适配器层 (Adapter Pattern)
│   │   ├── IBrowserAdapter.js    # 统一接口基类规范
│   │   ├── ChromiumAdapter.js    # Chromium (chrome.*) 适配器实现
│   │   ├── FirefoxAdapter.js     # Firefox (browser.*) 适配器实现
│   │   └── index.js              # 环境嗅探与 browserApi 单例工厂
│   ├── core/                     # 纯业务逻辑层 (与 DOM 及浏览器 API 解耦)
│   │   ├── urlParser.js          # URL 域名与路径逐层拆解算法
│   │   ├── ruleMatcher.js        # 规则正则匹配与反查筛选引擎
│   │   └── storage.js            # 本地规则、统计与静默生命周期存储管理
│   ├── background/               # 后台守护进程
│   │   └── index.js              # onVisited 实时拦截与 alarms 倒计时
│   ├── popup/                    # 极简 Popup 弹窗 (356px)
│   │   ├── popup.html
│   │   ├── popup.css
│   │   └── popup.js
│   └── options/                  # 独立 Options 管理控制台
│       ├── options.html
│       ├── options.css
│       └── options.js
└── dist/                         # 构建产物目录
    ├── chrome/                   # Chrome / Edge / Brave 产物
    └── firefox/                  # Firefox 产物
```

---

## 🚀 构建与安装使用

### 1. 运行构建
项目使用纯原生 Node.js 构建，无需 `npm install` 任何第三方依赖：
```bash
node build.js
# 或使用 npm
npm run build
```
构建完成后，产物将分别生成至 `dist/chrome` 和 `dist/firefox`。

### 2. 在 Chromium 浏览器中安装 (Chrome / Edge / Brave)
1. 打开浏览器并访问 `chrome://extensions/`（Edge 为 `edge://extensions/`）。
2. 在右上角开启 **“开发者模式” (Developer mode)**。
3. 点击 **“加载已解压的扩展程序” (Load unpacked)**。
4. 选择本项目根目录下的 `dist/chrome` 文件夹。

### 3. 在 Firefox 中安装
1. 打开 Firefox 浏览器，访问 `about:debugging#/runtime/this-firefox`。
2. 点击 **“临时载入附加组件...” (Load Temporary Add-on...)**。
3. 浏览并选中 `dist/firefox/manifest.json` 文件。

---

## 🔒 隐私与安全性保障
1. **完全离线运行**：本扩展不向任何外部服务器发送数据，所有规则匹配、历史记录操作与数据存储均严格发生在本机浏览器本地沙箱环境中。
2. **纯原生代码**：零引入外部 CDN 或第三方打包混淆库，代码审计透明。
