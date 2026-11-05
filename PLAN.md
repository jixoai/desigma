# FDE2E Desigma 维护方向

唯一维护目标是浏览器中的 WASM 编辑器。当前实现、性能记录与限制见 [浏览器指南](docs/browser.md)。

- 共享 Rust 文档、布局、渲染和撤销引擎；避免维护第二套文档模型。
- Worker 处理导入、导出和缩略图；IndexedDB 按需加载与增量保存。
- WebMCP 与 UI 共享操作和权限；接口变更保持文件及自动化兼容。
- 自托管静态部署；协作信令可选，不接管文档处理。
- 持续同步上游引擎，保留 FDE2E 品牌、浏览器适配和 WASM 检查。

提交与验证规范见 [CONTRIBUTING.md](CONTRIBUTING.md)，更新流程见 [docs/upstream-sync.md](docs/upstream-sync.md)。
