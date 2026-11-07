# 浏览器中文缺字调查与修复

2026-11-07。复现于原浏览器缓存及 FDE2E Personal Agent Android 设计。渲染引擎支持中文，故障发生在字体子集选择和编辑器 UI 回退注册。

| 原因 | 直接证据 | 修复 |
| --- | --- | --- |
| Noto SC/JP/KR 的短名称没有匹配到文字系统 | 缓存 URL 为 `noto-sans-sc@5.3.1/latin-400-normal.ttf`；34,868 字节、218 个 Unicode 映射，不含“中文图层” | SC/JP/KR 显式选择 chinese-simplified/japanese/korean；缺少对应子集时报告错误，不退到拉丁或编号片段 |
| 英文界面不安装 CJK UI 字体 | WASM 回退逻辑只在 ZhCn 时执行；英文菜单中的中文文件/图层名显示方框 | 为所有 UI 字族安装同一份内置中文回退，与菜单语言无关 |
| 错误字体已被持久缓存 | 旧 Noto SC/JP 文件反复命中 IndexedDB | 根据已保存的 Fontsource URL 识别错误子集，作为缓存未命中重新获取，不删除用户文档和自带字体 |

内置 `FDE2E UI CJK` 是 OFL 授权的 Noto Sans SC 常用字子集，7,946 个 Unicode 映射、常规字重。它在 WASM 内只保存一份，由 egui UI、文档渲染和导出 Worker 共享；源字体、哈希、许可及生成脚本见 [素材说明](../../../crates/desigma-fonts/assets/cjk/README.md)。不是完整 Unicode 汉字全集，生僻字及特定字重/字形仍应选择对应的设计字体。

验证通过：

- `cargo test --locked -p desigma-fonts --lib`：27 项，包含 CJK 子集选择与旧缓存迁移。
- `cargo test --locked -p desigma-app --test browser_fonts --no-default-features`：真实 egui 字族中的中文 glyph 覆盖检查通过。该独立目标避开上游单元测试对已移除 macOS 打包模板的依赖。
- WASM clippy `-D warnings`、完整优化构建、14 项脚本测试、品牌和 WASM 维护边界检查通过。
- 新端口 `127.0.0.1:8083` 无字体缓存，屏蔽 Fontsource API/CDN 后，英文菜单中文名称、中文菜单、Inter 文档中文回退和 Worker 导出正常；没有外部字体请求。
- PNG 导出 46,426 字节、SVG 33,243 字节，均包含实际字形。浏览器回归入口为 `web/tests/browser-fonts.js`。
- 向隔离测试空间放入旧 Latin 缓存后，显式 Noto Sans SC 请求自动改为 `chinese-simplified-400-normal.ttf`，缓存更新至 2,534,728 字节。
- 压缩 WASM 从 9,366,210 字节增至 11,026,597 字节，低于现有 12 MiB 限制。没有据此声称所有大型设计都具有相同加载或帧率表现。

[修复前](before.png) · [英文 UI 修复后](after-editor-en.png) · [中文 UI 修复后](after-editor-zh.png) · [无缓存验证](cold-cache-en.png) · [导出结果](export.png) · [结构化记录](report.json)

更新后保存并重新打开旧编辑器标签即可加载新 WASM；不需要清除站点数据。启用 Service Worker 的旧标签可能保留旧版本，关闭旧标签后再打开。

历史截图中的社区角色按独立许可保留，见 [CHARACTER-NOTICE.md](CHARACTER-NOTICE.md)。Personal Agent 产品探索稿已迁至 [Omni 研究目录](https://github.com/jixoai/fde2e-omni-v1/tree/main/docs/research/design-explorations/personal-agent-android)；本目录只维护编辑器字体回归证据。
