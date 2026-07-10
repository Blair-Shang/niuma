# 20 — 工具组件管理（设置 → 外部 CLI）

> 版本：v0.1 · 日期：2026-07-09
> 状态：Phase 4a 已启动（检测 / 路径配置 / 下载引导）

---

## 1. 目标

在 **设置 → 工具组件** 中统一管理本机第三方 CLI（mongosh、mongodump 等），对标 Navicat **Environment → Executables**。

与 **设置 → 插件**（NiuMa Web 扩展）严格分离：

| 分区 | 管理对象 | 典型操作 |
|------|----------|----------|
| 插件 | `plugins/` manifest 扩展 | 启用 / 禁用 |
| **工具组件** | 本机可执行文件 | 检测 / 指定路径 / 打开官方下载页 |

能力服务（如 `mongodb-service`）通过 `platform.components.*` 读取**合并后的有效路径**，不在各服务内重复维护 UI 配置。

---

## 2. 分层

```
Web SettingsView → componentsApi → platform.components.*
                                        ↓
                              components.Registry
                    ┌───────────────────┼───────────────────┐
                    ▼                   ▼                   ▼
           components/*/manifest   nm_app_setting      data/components/
           （声明需要哪些工具）    （用户配置路径）    （可选安装目录，Phase 4b）
                    └───────────────────┬───────────────────┘
                                        ▼
                              PATH 自动探测
```

---

## 3. 组件包 manifest

仓库目录：

```
components/
└── mongodb-tools/
    └── manifest.yaml
```

字段约定：

```yaml
id: com.niuma.components.mongodb-tools   # 组件包唯一 id
name: MongoDB 官方工具                    # 设置页展示名
module: mongodb                          # 关联内置模块（分组用）
tools:
  - id: mongosh
    displayName: MongoDB Shell
    detect:
      executables: [mongosh, mongo]      # PATH 探测名（Windows 自动补 .exe）
      versionArgs: ["--version"]
    install:
      mode: detect_only                  # detect_only | optional_download（后者 Phase 4b）
      downloadPage: https://...
```

新增组件包：在 `components/<name>/manifest.yaml` 声明即可，**无需改 platform 业务代码**。

---

## 4. Bridge 契约（platform-core）

| 方法 | 入参 | 返回 |
|------|------|------|
| `platform.components.list` | `{}` 或 `{ bundleId? }` | `{ bundles: BundleStatus[] }` |
| `platform.components.detect` | `{ bundleId }` | `{ bundle: BundleStatus }` |
| `platform.components.setPath` | `{ bundleId, toolId, path }` | `{ updated: true }` |
| `platform.components.getDownload` | `{ bundleId, toolId }` | `{ url }` |

### 4.1 `BundleStatus`

```json
{
  "bundleId": "com.niuma.components.mongodb-tools",
  "name": "MongoDB 官方工具",
  "module": "mongodb",
  "tools": [
    {
      "toolId": "mongosh",
      "displayName": "MongoDB Shell",
      "status": "detected",
      "path": "C:\\Program Files\\mongosh\\mongosh.exe",
      "version": "2.3.1",
      "downloadPage": "https://www.mongodb.com/try/download/shell"
    }
  ]
}
```

`status` 枚举：

| 值 | 含义 |
|----|------|
| `configured` | 用户在设置中指定路径且文件存在 |
| `bundled` | 在 `{dataDir}/components/<bundleId>/bin/` 找到 |
| `detected` | 在系统 PATH 找到 |
| `missing` | 未找到 |

### 4.2 路径持久化

全局配置键：`components.tool_paths`（`nm_app_setting` 表）

```json
{
  "com.niuma.components.mongodb-tools": {
    "mongosh": "D:\\tools\\mongosh.exe",
    "mongodump": ""
  }
}
```

空字符串表示清除用户覆盖，回退到 bundled / PATH 探测。

### 4.3 有效路径优先级

```
1. components.tool_paths[bundleId][toolId]  （非空且文件存在）
2. {dataDir}/components/{bundleId}/bin/{executable}
3. exec.LookPath(executables...)
```

连接级 `connection_options.tool_paths`（[19 §12.5](./19-mongodb-module.md)）在 **mongodb-service** 内再覆盖全局，本模块不处理。

---

## 5. Web 集成

### 5.1 文件

| 路径 | 说明 |
|------|------|
| `web/src/api/components.ts` | Bridge 客户端 |
| `web/src/api/types/components.ts` | 类型 |
| `web/src/shell/views/ComponentsSettingsPanel.vue` | 设置页右栏 |
| `web/src/shell/views/SettingsView.vue` | 新增 `components` 分区 |

### 5.2 用户操作

- **重新检测**：`platform.components.detect`
- **浏览…**：`shell.dialog.openFile` 选 exe → `platform.components.setPath`
- **清除路径**：`setPath` 传空字符串
- **官方下载**：`getDownload` 取 URL → `window.open`

### 5.3 与 MongoDB 模块联动（后续）

MongoDB Console / Tools Tab 缺工具时展示横幅，跳转设置 `components` 分区（`tabStore.openSettings` + section 参数，待扩展）。

### 5.4 Phase 4a 已落地文件

| 路径 | 状态 |
|------|------|
| `components/mongodb-tools/manifest.yaml` | ✅ |
| `platform/internal/components/` | ✅ |
| `platform/internal/handler/components.go` | ✅ |
| `web/src/api/components.ts` | ✅ |
| `web/src/shell/views/ComponentsSettingsPanel.vue` | ✅ |
| `web/src/shell/views/SettingsView.vue`（`components` 分区） | ✅ |

---

## 6. Platform 实现

| 路径 | 说明 |
|------|------|
| `platform/internal/components/manifest.go` | 加载 `components/*/manifest.yaml` |
| `platform/internal/components/registry.go` | 探测、路径合并、持久化 |
| `platform/internal/components/detect.go` | PATH / 版本探测 |
| `platform/internal/handler/components.go` | Bridge 分发 |

`ResolveComponentsDir()` 从可执行文件向上查找含 `components/` 的目录（与 `supervisor.ResolveServicesDir` 同策略）。

---

## 7. 分期

| 阶段 | 内容 | 状态 |
|------|------|------|
| **4a** | list / detect / setPath / getDownload + 设置页 UI | **已落地** |
| **4b** | `platform.components.install` 下载解压至 `data/components/` | 未开始 |
| **5** | 版本更新提醒、校验和 | 未开始 |

---

## 8. 相关文档

- [19 — MongoDB 模块](./19-mongodb-module.md) §12（MongoDB 工具依赖）
- [14 — 能力连接框架](./14-capability-connection-framework.md)
- [09 — Web App Shell](./09-web-app-shell.md)（设置页布局）

---

## 9. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1 | 2026-07-09 | 初版；Phase 4a 契约与实现启动 |
| v0.2 | 2026-07-09 | Phase 4a 落地：platform.components.*、设置页、mongodb-tools manifest |
