# NiuMa 插件包

可插拔运维模块与 IDE 扩展的**安装单元**，由 Platform 管理生命周期，Shell 经 `app://plugins/` 提供静态资源，Web 经 Extension Registry 注册路由。

## 目录

```
plugins/
├── README.md                 # 本文件
├── _examples/
│   └── hello-module/         # 最小示例（不含可运行 UI，仅 manifest 规范）
└── <your-plugin-id>/         # 正式插件
    ├── manifest.json
    ├── ui/
    └── service-ref.yaml      # 可选
```

## 快速开始

1. 复制 `_examples/hello-module/` 为 `plugins/com.example.hello/`
2. 编辑 `manifest.json` 中的 `id`、`module.routePath`
3. 实现 `ui/entry.ts`（P1 起接入 `app://` 加载）
4. P2 起通过 Platform 启用插件

## 文档

- [docs/04-plugin-system.md](../docs/04-plugin-system.md) — manifest、权限、生命周期
- [docs/10-web-extension-system.md](../docs/10-web-extension-system.md) — Web Registry 与 API
- [docs/06-directory-structure.md](../docs/06-directory-structure.md) — 全仓库目录

## 与内置模块的关系

`web/src/modules/*` 为第一方内置模块，与 `plugins/*` 使用同一套 `ModuleDescriptor` 注册，SideNav 与路由行为一致。
