# History Guard GitHub Actions CI/CD 商店发布密钥配置指南

本项目已配置完整的 GitHub Actions 持续集成与交付流程：
- **CI 流水线 (`ci.yml`)**：每次推送代码或提 PR 时自动运行单测与打包验证；
- **Release 流水线 (`release.yml`)**：每次推送版本 Tag（如 `v1.0.1`）时，自动运行测试门禁、打包生成 ZIP、自动创建 GitHub Release；若配置了以下 Secrets，将自动一键发布至对应应用商店。

---

## 如何在 GitHub 仓库配置 Secrets

1. 打开 GitHub 仓库页面：`https://github.com/lazy-mantou/HistoryGuard`
2. 点击顶部导航栏的 **Settings**（设置）
3. 在左侧菜单找到 **Secrets and variables** -> **Actions**
4. 点击 **New repository secret** 按钮，分别添加以下变量：

---

### 1. Chrome Web Store (谷歌应用商店)
*如暂未接入，留空不配置即可，流水线会自动安全跳过该发布步骤。*

| Secret 名称 | 说明 | 获取位置 |
| :--- | :--- | :--- |
| `CHROME_EXTENSION_ID` | Chrome 扩展唯一 ID | CWS 开发者控制台中的扩展详情 URL（32位小写字母） |
| `CHROME_CLIENT_ID` | GCP OAuth 客户端 ID | Google Cloud Console 凭据页面 |
| `CHROME_CLIENT_SECRET` | GCP OAuth 客户端密钥 | Google Cloud Console 凭据页面 |
| `CHROME_REFRESH_TOKEN` | OAuth 刷新令牌 | 通过 OAuth 授权流程生成的长期 Refresh Token |

---

### 2. Firefox Add-ons (火狐 AMO 商店)
*如暂未接入，留空不配置即可。*

| Secret 名称 | 说明 | 获取位置 |
| :--- | :--- | :--- |
| `FIREFOX_EXTENSION_ID` | 扩展 ID (Gecko ID) | 例如 `history-guard@...`（与 manifest.firefox.json 一致） |
| `FIREFOX_JWT_ISSUER` | AMO API Key (JWT Issuer) | AMO 开发者中心 -> Tools -> Manage API Keys |
| `FIREFOX_JWT_SECRET` | AMO API Secret (JWT Secret)| AMO 开发者中心 -> Tools -> Manage API Keys |

---

### 3. Microsoft Edge Add-ons (微软 Edge 商店)
*如暂未接入，留空不配置即可。*

| Secret 名称 | 说明 | 获取位置 |
| :--- | :--- | :--- |
| `EDGE_PRODUCT_ID` | Edge 扩展 Product ID | 微软合作伙伴中心 (Partner Center) 扩展概览页面 |
| `EDGE_CLIENT_ID` | Azure AD / API 客户端 ID | 微软合作伙伴中心 API 访问管理页面 |
| `EDGE_API_KEY` | 客户端密钥 (Client Secret) | 微软合作伙伴中心 API 访问管理页面 |
| `EDGE_TENANT_ID` | Azure 租户 ID | 微软合作伙伴中心 / Azure Active Directory |

---

## 触发发布的标准指令

当需要发布新版本（例如 `v1.0.1`）时，只需在本地终端执行：

```powershell
# 1. 确认已修改 package.json, manifest.chrome.json, manifest.firefox.json 并归档 CHANGELOG.md
git add .
git commit -m "chore(release): bump version to 1.0.1"

# 2. 打上对应的版本 Tag
git tag -a v1.0.1 -m "Release v1.0.1"

# 3. 推送代码和 Tag 至 GitHub
git push origin master
git push origin v1.0.1
```

推送后，即可在 GitHub 仓库的 **Actions** 页面实时查看自动编译、测试与分发进度！

