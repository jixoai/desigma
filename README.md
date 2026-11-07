# FDE2E Desigma

纯 Web 设计工具——完全运行于浏览器的 Rust / WebAssembly 编辑器。只维护 **WASM** 产品形态，复用同一套文档、布局、渲染与撤销引擎：

```text
设计界面 / Agent 操作 ──▶ WebMCP 工具面（64 个工具，共享文档与 Undo）
Rust 编辑与渲染引擎   ──▶ WebAssembly + WebGPU（WebGL / CPU 兼容路径）
本地项目与文件        ──▶ IndexedDB 按需加载 + 增量恢复 + 浏览器下载
导入 / 导出 / 缩略图  ──▶ Web Worker（按需启动，空闲回收）
```

由 **FDE2E（昭智羽名(厦门)科技有限公司）** 维护；对外名称 **FDE2E Desigma**，品牌 **FDE2E™**，使用自己的图标和项目入口。

## Fork 链

- 基于开源设计编辑器改造；上游仓库、锚定提交与改造边界见 [FORK.md](FORK.md)。
- 代码许可：**MIT OR Apache-2.0**；保留 [LICENSE-MIT](LICENSE-MIT)、[LICENSE-APACHE](LICENSE-APACHE) 及 [第三方声明](THIRD_PARTY_NOTICES.md)，新增代码贡献沿用相同许可。回归截图中的第三方图像按各自许可使用。
- 源码仓：[jixoai/desigma](https://github.com/jixoai/desigma)。`browser-wasm` 是默认开发分支；`main` 仅镜像上游历史。每周同步生成草稿 PR，通过 WASM、浏览器和品牌检查后人工合并。见 [同步说明](docs/upstream-sync.md)。

## 开发

需要仓库锁定的 Rust 工具链、Node 22+、Python 3.11+、Binaryen（`wasm-opt`）。

```sh
git clone https://github.com/jixoai/desigma.git
cd desigma
git switch browser-wasm
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.129 --locked
python3 scripts/build-web.py
python3 scripts/serve-web.py --port 8080
```

访问 <http://127.0.0.1:8080>。`dist/` 可部署到静态 HTTPS 托管服务；[WASM CI](https://github.com/jixoai/desigma/actions/workflows/web.yml) 提供 `desigma-browser` 构建产物。本仓库尚未指定线上站点。

## WebMCP

```js
const tools = window.desigma.tools();
const doc = await window.desigma.call('desigma_get_document', {});
await window.desigma.call('desigma_create_node', {
  parent_id: doc.pages[0].node_id,
  kind: 'rectangle', name: 'Card', width: 320, height: 180,
});
```

支持浏览器原生 `document.modelContext`；未支持时可用相同 JavaScript API。`.desigma` 文件、`desigma_*` 工具名及存储键保持兼容。接口清单随构建发布于 `tools.json`。

复杂建稿先读取 `desigma_get_editing_guide`。`desigma_create_instance` 自动创建关联母版的完整实例；`desigma_render_preview` 直接返回 PNG，无需等待浏览器下载。原型可用 `desigma_inspect_prototype` 检查实际命中图层，再用 `desigma_test_prototype` 断言每条路径的目标页面和内容，检查过程不会修改设计稿。

`desigma_inspect_components` 检查实例是否仍有有效母版和源图层，便于在重建规范板后发现断开的组件关联。

[运行与 API](docs/browser.md) · [贡献指南](CONTRIBUTING.md) · [静态发布](docs/releasing.md) · [反馈问题](https://github.com/jixoai/desigma/issues)

## 使用边界

推荐桌面尺寸的现代浏览器。浏览器存储有配额，请导出文件备份；WebGPU、WebMCP 与视频编码能力取决于浏览器。协作可交换连接链接，也可选配自托管信令及 STUN / TURN。内置 FDE2E Shapes 插件可离线安装。

本机 5000 图层实测帧间隔中位数 16.9 ms，CPU 画布准备中位数 2.73 ms；这是单机测量，不是持续 60 FPS 保证。[性能记录](docs/browser-performance.json) 与 [兼容性说明](docs/browser.md) 保留具体条件。
