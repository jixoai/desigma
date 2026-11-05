# 来源、版权与第三方声明

## 共享编辑器引擎

本项目基于 [FORK.md](FORK.md) 记录的上游编辑器。原始版权声明为：

> Copyright (c) 2026 Deep Founder and the desigma contributors

原有代码按 MIT OR Apache-2.0 使用；原许可全文保留于 [LICENSE-MIT](LICENSE-MIT) 和 [LICENSE-APACHE](LICENSE-APACHE)。FDE2E 新增贡献版权归 FDE2E（昭智羽名(厦门)科技有限公司），沿用相同许可。品牌替换不改变原代码的作者或许可。

## 随应用使用的素材

- **Inter**：Copyright 2020 The Inter Project Authors；SIL Open Font License 1.1，见 [OFL.txt](crates/desigma-fonts/assets/inter/OFL.txt)。
- **Lucide / Feather 图标**：Lucide Contributors / Cole Bemis；ISC / MIT 来源声明，见 [LICENSE](crates/desigma-app/assets/icons/lucide/LICENSE)。这些是界面操作图标，FDE2E 产品标志独立绘制。
- **FDE2E Shapes**：本仓库维护的离线图形插件，MIT，见 [插件许可](plugins/shapes/LICENSE)。
- **导入测试素材**：保留 [Pencil 测试样例来源](crates/desigma-pen/tests/fixtures/ATTRIBUTION.md)。示例界面为虚构设计内容，不是服务承诺或联系方式。

Rust 与 JavaScript 依赖版本由 `Cargo.lock`、`web/package-lock.json` 和 `web/signaling/package-lock.json` 锁定，仍受各自的许可证约束。按需下载的字体和插件素材保留其随包许可；再分发时须一并保留。

静态构建的 `licenses/` 包含项目许可证、来源声明和内置字体 / 图标许可；插件目录随包附带 LICENSE。
