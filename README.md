# 红果短剧电脑版 · Hongguo Desktop Wrapper

![Latest Release](https://img.shields.io/github/v/release/hwu121380-afk/hongguo-desktop-wrapper)
![Downloads](https://img.shields.io/github/downloads/hwu121380-afk/hongguo-desktop-wrapper/total)
![License](https://img.shields.io/github/license/hwu121380-afk/hongguo-desktop-wrapper)

> **二次开发版**：本仓库是 [huyang-md/hongguo-desktop-wrapper](https://github.com/huyang-md/hongguo-desktop-wrapper)（MIT 协议）的 fork 修改版，由 hwu121380-afk 维护；新增倍速播放、记忆倍速、一键清除缓存，许可证与上游署名见 [LICENSE](LICENSE)。

**红果短剧 电脑版 | Windows 客户端 | 免安装 | 无需安卓模拟器 | 源码 100% 开源**

把[红果短剧官方网页版](https://hongguoduanju.com/)装进一个原生 Windows 窗口:沉浸全屏刷剧、老板键一键隐藏、小窗置顶边干活边看、自动记住看过的剧。

## 📸 界面预览

| 首页 | 剧集详情 |
|---|---|
| ![首页](docs/preview-home.png) | ![详情](docs/preview-detail.png) |
| **小窗置顶模式** | |
| ![小窗模式](docs/preview-mini.png) | |

## 📥 下载安装

1. 打开 [Releases · 最新版](https://github.com/hwu121380-afk/hongguo-desktop-wrapper/releases/latest)
2. 下载 `HongguoDuanju-Setup-x.x.x.exe`
3. 双击安装,完成

> **首次运行遇到 SmartScreen 蓝色提示?** 点「更多信息」→「仍要运行」。本项目没有付费代码签名证书,但每个安装包都由 GitHub Actions 云端公开构建、发布页附 SHA-256,源码全部在这个仓库里——**无捆绑、无推广、无后台常驻,可自行编译复现**。
>
> ⚠️ 请**只从本仓库 Releases 页**下载安装包;其他站点(网盘/下载站/聚合站)分发的 exe 无法保证未被篡改,认准发布页附带的 SHA-256 校验值。

## ✨ 功能

- 原生窗口,关闭即缩到托盘,托盘菜单真退出
- **老板键 `Ctrl+Shift+B`**(全局生效):一键隐藏窗口并自动暂停播放,再按唤回
- **小窗置顶**(430×760 竖屏比例):边干活边刷剧
- **倍速播放**:`Ctrl+↑` / `Ctrl+↓` 以 0.25 步进调速(0.5x–3x),「功能」菜单有 0.75x/1.0x/1.25x/1.5x/2.0x 快选;换集后自动恢复上次倍速,托盘提示会显示当前倍速
- **一键清除缓存与登录状态**:托盘/「功能」菜单可清缓存、Cookie 与本地存储(会退出登录,需重新登录)
- **观看历史**:托盘「最近看过」一键直达,仅存本地、可清空
- **检查更新**:菜单/托盘一键检查,发现新版直达下载页;启动时每天自动查一次
- **反馈问题**:托盘/菜单一键直达 Issue 页,自动附上应用版本信息
- **开机自启**:托盘菜单勾选即可
- **F11 沉浸全屏**;`Ctrl+R` 刷新 / `Ctrl+=` `Ctrl+-` `Ctrl+0` 缩放
- 记住窗口位置、大小、最大化/全屏状态;单实例防重复启动
- 站内链接窗口内打开,站外链接自动走系统浏览器;断网有重试页

## 🔒 为什么可信

- 源码 100% 公开(MIT 许可),主进程 `main.js` 约 480 行、无 preload / 无 IPC,一次能通读
- 基于 Electron 45(官方支持中的最新大版本,随安全补丁更新);权限默认拒绝、仅放行全屏;站点触发的下载一律拦截
- 不抓取、不修改、不存储任何红果数据——播放内容全部来自官方网页版,体验与浏览器打开官网一致
- 安装包由 GitHub Actions 云端构建,构建过程公开可查,发布页附 SHA-256 校验

## ❓ FAQ

**Q: 会不会有病毒、捆绑、偷看隐私?**
A: 源码就在本仓库,每一行都能审计;CI 构建日志全程公开。逻辑上它只有一个能力:打开红果官网页面。

**Q: 需要登录吗?**
A: 与官网规则一致,浏览和看剧不强制登录。

**Q: 和微软商店里的红果官方 Windows 版什么关系?**
A: 没有关系,也建议追求最稳的用户优先装官方版。本项目是另一种轻量选择:托盘常驻、老板键、小窗置顶等壳层增强。

**Q: 为什么不做下载、弹幕、去广告?**
A: 见下方「设计边界」——那类功能依赖逆向红果私有接口,属于未授权访问,也是同类项目频繁"取源失效"的根源。

**Q: Mac / 电视版呢?**
A: 暂无计划。欢迎fork 修改,理论上 Electron 层改动很小。

## ⌨️ 快捷键

| 按键 | 功能 |
|---|---|
| `Ctrl+Shift+B` | 老板键(全局):隐藏+自动暂停 / 再按唤回 |
| `Ctrl+↑` `Ctrl+↓` | 倍速 +0.25 / -0.25(0.5x–3x,换集后记忆恢复) |
| `F11` | 沉浸全屏 |
| `Ctrl+R` | 刷新 |
| `Ctrl+=` `Ctrl+-` `Ctrl+0` | 页面缩放 |

## 🛠 自己编译 / 开发

```bash
npm install   # 首次
npm start     # 启动
npm run dist  # 打包安装包(产物在 dist/)
```

> 打包若报 winCodeSign 符号链接权限错误:用 7-Zip 把 `winCodeSign-2.6.0.7z` 解压到
> `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0\`(忽略两个 macOS 符号链接报错)即可。
> 推送 `v*` 标签时 GitHub Actions 会云端自动构建并发布安装包。

## 🚫 设计边界(有意不做)

不做下载、弹幕、去广告、超分、多源聚合等功能——那类实现依赖逆向红果私有接口,属于未授权访问,也是同类开源项目频繁"取源失效"的根源。本项目只做合规的桌面壳。

## 📄 许可证与免责声明

MIT — 见 [LICENSE](LICENSE)。可自由使用、修改、分发。

- 本项目为**非官方**第三方工具,与字节跳动及红果短剧官方无任何关联;"红果短剧"名称与相关商标权利归其权利人所有
- 播放内容全部来自红果官方网页版,本项目不存储、不分发任何音视频资源
- 仅供学习交流与个人使用,请勿用于商业用途
- 使用本项目产生的任何问题由使用者自行承担

## 🗂 目录结构

```
hongguo-desktop/
├── main.js               # Electron 主进程(窗口/托盘/快捷键/历史)
├── error.html            # 断网错误页
├── assets/icon.png       # 应用图标
├── .github/workflows/    # CI:推 v* 标签自动构建发版
└── scripts/              # 图标生成、调试脚本
```
