# Pagefold

Pagefold 是一款轻量 Markdown 桌面应用。笔记、文件夹和分区均可直接创建，并通过拖动自由分类；资料库由应用自动管理，不要求用户选择本地工作区。

## 数据位置

Windows 默认资料库位于：

```text
%APPDATA%\pagefold\vault
```

卸载应用时默认保留资料库，重新安装后可以继续使用。

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
