# Pagefold

Pagefold 是一款轻量 Markdown 桌面应用。笔记、文件夹和分区均可直接创建，并通过拖动自由分类；资料库由应用自动管理，不要求用户选择本地工作区。

## 数据位置

Windows 默认资料库位于：

```text
%APPDATA%\pagefold\vault
```

卸载应用时默认保留资料库，重新安装后可以继续使用。

也可以在 **Settings → Library location → Choose folder** 中选择任意本地资料库目录。Pagefold 不会自动搬移或删除旧资料库。

## 多设备同步

Pagefold 可使用 OneDrive、Dropbox 或 Syncthing 已同步到本机的文件夹。推荐为 Pagefold 建立专用文件夹，并在每台设备上选择对应的本地同步目录。

Pagefold 会监听同步工具在后台新增、修改或删除的 Markdown 文件并刷新界面。如果打开的文档同时存在尚未保存的本地修改，外部版本不会静默覆盖本地内容。

使用 Syncthing 同步默认资料库时，两台 Windows 电脑都可以直接选择：

```text
%APPDATA%\pagefold\vault
```

避免在两台设备上同时编辑同一个文档，并在切换设备前等待同步工具显示同步完成。

## 本地开发

```powershell
npm install
npm run dev
```

## 验证与打包

```powershell
npm test
npm run build
npm run dist:win
```

Windows 安装包输出到 `release/Pagefold-Setup-0.1.0.exe`。
