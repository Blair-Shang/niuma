# NiuMa 品牌图标

**NiuMa** 原创 **剑形** 标：极光渐变圆角底 + 顶部高光 + 白色几何剪影（剑刃 / 护手 / 剑柄 / 剑首）。

> 由 `scripts/platforms/windows/build/generate-app-icon.ps1` 程序化绘制，与 `app-icon.svg` 同源。
> 极光配色与应用内品牌标 `.nm-brand-icon`（`web/src/styles/tokens.css` 的 `--nm-aurora-a..e`）保持一致，
> 确保 Windows 任务栏 / 托盘图标与应用内图标同色。

## 版权说明

- 字标为项目专用几何造型，**不沿用** 第三方产品 Logo。
- 极光渐变（青 `#5ac8fa` → 紫 `#bf5af2` → 品红 `#ff375f` → 蓝 `#64d2ff` → 绿 `#30d158`）为通用色带，单独使用不构成 Logo 侵权；上线前仍建议做一次商标检索（尤其「NiuMa / NM」相关类别）。
- 旧版「三层叠放」图标及纯蓝底 `#007AFF` 版本已废弃；前者与 Lucide `layers` 等通用 UI 隐喻相近且溯源不明，后者与应用内极光标不同色。

## 文件

| 文件 | 用途 |
|------|------|
| `app-icon.svg` | 矢量源（512 坐标系） |
| `app-icon-512.png` | 脚本输出位图 |
| `app-icon.ico` | Windows exe / 任务栏 |
| `web/public/favicon.svg` | Web / Playground favicon |

## 重新生成

```powershell
powershell -ExecutionPolicy Bypass -File scripts/platforms/windows/build/generate-app-icon.ps1
pnpm build:shell
```
