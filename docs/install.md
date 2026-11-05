# 运行 FDE2E Desigma

FDE2E Desigma 是浏览器应用，只维护 WASM 构建。使用现代浏览器打开部署的静态页面即可，无需桌面安装包。

本地开发：

```sh
python3 scripts/build-web.py
python3 scripts/serve-web.py --port 8080
```

访问 <http://127.0.0.1:8080>。工具链与 HTTPS 部署配置见 [浏览器指南](browser.md#build-and-run)，构建产物发布见 [发布指南](releasing.md)。本仓库尚未指定线上站点。

项目保存在当前浏览器的 IndexedDB 中。使用 Download .desigma 下载文件备份，避免清理站点数据后丢失项目。
