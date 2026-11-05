# FDE2E Desigma 的来源与维护边界

FDE2E Desigma 由 FDE2E（昭智羽名(厦门)科技有限公司）维护，目标是完全运行于浏览器的设计编辑器。本仓库属于 GitHub fork 网络。

## 来源

- 上游：[deepfounder-ai/desigma](https://github.com/deepfounder-ai/desigma)。
- 初始及当前同步锚点以 [`.github/upstream.json`](.github/upstream.json) 为准；本次品牌改造基于 `e0d5c3a598047eddf68b80aa3253457e61db5651`。
- 保留完整 Git 祖先关系、[MIT](LICENSE-MIT) 与 [Apache-2.0](LICENSE-APACHE) 许可及原作者版权声明。FDE2E 新增贡献同以 MIT OR Apache-2.0 发布。
- 字体、图标、依赖与样例的声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 产品与品牌

对外名称为 **FDE2E Desigma**，维护品牌为 **FDE2E™**。产品使用 FDE2E 图标、介绍、仓库及问题入口；不沿用上游 logo、宣传素材、联系方式或桌面安装包。

这是独立维护的派生版本，不表示上游为其背书、提供支持或授予商标许可。原上游政策可在[锚定提交](https://github.com/deepfounder-ai/desigma/blob/e0d5c3a598047eddf68b80aa3253457e61db5651/TRADEMARKS.md)中查阅；软件许可不转移第三方商标权。当前维护与反馈入口均为 [jixoai/desigma](https://github.com/jixoai/desigma)。

`.desigma` 文件扩展名、Rust crate 名、`window.desigma`、`desigma_*` WebMCP 工具名、IndexedDB / 缓存键、协议标识及原生文件类型标识保留兼容，避免已有文件、数据和自动化失效。它们不是对外维护者标识。既有用户文档与已安装插件的内容不会因品牌更新而被重写。

## WASM 改造

共享 Rust 引擎编译为 WebAssembly；浏览器适配层负责 IndexedDB、Worker、WebMCP、WebRTC、沙箱插件和静态离线缓存。FDE2E Shapes 随静态应用发布，其他插件清单只接受当前仓库中的受控路径。文档操作在浏览器内完成。

只维护 `wasm32-unknown-unknown`。保留共享 Rust 源码及必要的原生条件编译代码以便合并上游；桌面 CI、发布、打包脚本与旧宣传素材已移除。`main` 只镜像上游；`browser-wasm` 是唯一维护产品分支。

## 更新

`upstream` 仅用于获取代码，推送地址为 `DISABLED`。每周任务创建隔离合并分支和草稿 PR，运行 WASM 构建、浏览器测试、维护范围及品牌回归检查。不自动合并，不向上游提交 PR。

品牌检查阻止旧项目链接、上游宣传名称、旧插件入口和已删除的分发素材重新进入产品路径；同步发生冲突时保留 FDE2E 产品配置，逐项整合引擎更新。操作步骤见 [docs/upstream-sync.md](docs/upstream-sync.md)。
