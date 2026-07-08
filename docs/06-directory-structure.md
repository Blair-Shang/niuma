# 06 — 仓库目录结构

> 版本：v0.1 · 日期：2026-07-03  
> Monorepo 目录规划与各层职责

---

## 1. 顶层概览

```
NiuMa/
├── docs/                        # 设计文档
├── proto/                       # Protobuf 契约（规划）
├── scripts/                     # 构建、打包、开发脚本
├── third_party/cef/             # CEF 预编译包（setup 下载）
│
├── packages/
│   └── ui/                      # @niuma/ui 组件库
│
├── web/                         # Layer 4 — CEF 内 Vue 主应用
├── shell/                       # Layer 3 — C++ CEF 壳
├── platform/                    # Layer 2 — Go Platform Core（规划）
├── services/                    # Layer 1 — 能力服务 manifest + bin
├── plugins/                     # 可插拔插件包（内置 + 第三方）
│
├── pack/                        # 打包输出（gitignore）
└── build/                       # 编译中间产物（gitignore）
```

---

## 2. Web 层 `web/src/`

```
web/src/
├── main.ts                      # 入口
├── App.vue                      # RsConfigProvider 根
│
├── shell/                       # App Shell（固定，插件不可改）
│   ├── AppShell.vue
│   ├── TopBar.vue
│   ├── SideNav.vue
│   ├── TabBar.vue
│   ├── ModuleWorkspace.vue      # ← 插件 UI 唯一挂载容器
│   ├── StatusBar.vue
│   └── views/
│
├── extensions/                  # ★ 扩展体系（Registry / API / 类型）
│   ├── types/                   # manifest、contribution、module 类型
│   ├── registry/                # 注册表：builtin + dynamic
│   ├── api/                     # niuma.* 扩展 API 门面（受控）
│   └── contributions/           # commands / views 运行时（规划）
│
├── modules/                     # 内置模块实现（等同第一方插件）
│   ├── registry.ts              # 重导出 → extensions/registry
│   ├── ssh/
│   ├── database/
│   ├── api-tester/
│   └── ai/
│
├── composables/                 # useNiumaBridge 等
├── stores/                      # Pinia
├── router/
├── locale/
└── styles/
```

**原则**：新能力优先放 `plugins/`；第一方内置模块暂留 `modules/`，经 Registry 与外部插件同等注册。

---

## 3. 插件包 `plugins/`

```
plugins/
├── README.md
├── _examples/
│   └── hello-module/
│       ├── manifest.json
│       └── ui/
│           └── README.md        # 入口规范说明
└── <plugin-id>/                 # 正式插件（P1+）
    ├── manifest.json
    ├── ui/
    └── service-ref.yaml
```

运行时安装路径（规划）：

| 平台 | 路径 |
|------|------|
| Windows | `%LOCALAPPDATA%\NiuMa\plugins\` |
| macOS | `~/Library/Application Support/NiuMa/plugins/` |
| Linux | `~/.local/share/niuma/plugins/` |

开发时可直接读仓库内 `plugins/`，由 Shell `app://plugins/<id>/` 提供静态资源。

---

## 4. Shell 层 `shell/src/`

```
shell/src/
├── main.cpp
├── core/
│   ├── cef/                     # NiuMaApp、CEF 配置
│   ├── window/                  # WindowManager、NativeDialog
│   └── runtime/                 # ServiceManager、manifest 扫描
├── browser/                     # NiuMaClient、handlers
├── bridge/                      # BridgeRouter、StreamProxy
├── ipc/                         # PlatformClient gRPC
├── protocol/                    # app:// scheme（含 plugins/ 路径规划）
└── util/
```

**P1 需在 `protocol/` 增加**：`app://plugins/<id>/` → `${INSTALL_DIR}/plugins/<id>/`

---

## 5. Platform 层 `platform/`（规划）

```
platform/
├── cmd/platform-core/
└── internal/
    ├── server/                  # gRPC
    ├── plugin/                  # manifest 解析、启用/禁用
    ├── auth/                    # 权限裁决
    ├── credential/
    ├── store/                   # SQLite
    └── migrate/
```

---

## 6. Services 层 `services/`

```
services/
├── manifests/
│   ├── ssh-service.yaml
│   └── db-service.yaml          # 规划
└── bin/                         # 编译产物（gitignore）
```

---

## 7. 文档索引

| 路径 | 说明 |
|------|------|
| `docs/architecture.md` | 总架构 |
| `docs/04-plugin-system.md` | 插件 manifest、生命周期 |
| `docs/10-web-extension-system.md` | Web Registry、Contribution、API |
| `docs/09-web-app-shell.md` | Shell 布局与 Tab 模型 |

---

## 8. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1 | 2026-07-03 | 初版；补充 extensions/、plugins/ 目录规划 |
