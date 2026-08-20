# 软件工程八步法包

从 ref/webuddy-console 移植的软件工程验收包。

## 统计

- 环节: 8
- 门禁: 92
- Native 实现: 92 (目标 ≤ 20)
- DSL 覆盖率: 0% (目标 ≥ 80%)

## 门禁分布

- 环节 1 (场景定义): 7 道
- 环节 2 (流程与数据建模): 14 道
- 环节 3 (规格与验收标准): 10 道
- 环节 4 (工程地基): 10 道
- 环节 5 (分步实现): 12 道
- 环节 6 (验证与质量门禁): 8 道
- 环节 7 (上线与上架): 21 道
- 环节 8 (运行与迭代): 10 道

## Native 条目

当前全部 92 条为 native 实现（清单见 native-rules.js 的 RULE_SOURCE）。
P3a-d 将逐步翻译为 DSL，收口目标 native ≤ 20 条，届时本节改为逐条列出存留的 native
条目及"为什么这条只能用代码判"的理由。

## 自带的两个样板项目

`webuddy pack test packs/software-engineering` 拿这两个项目试一遍整套判据：

- `fixtures/good/` —— 什么都做齐了的项目，81 条现在该管的全过。人工确认预置在
  `.webuddy/records.jsonl`（24 条 human 门禁 + 7.12 一条）；运行痕迹在
  `.webuddy/state.json` 的 notes.runs 里；存档历史存成 `dot-git/`，跑测试时还原成 `.git/`
  （版本管理工具不肯把嵌套的 .git 目录当普通文件收进来）。
- `fixtures/broken/` —— 从 good/ 拷一份、动了四处，该红的 6 条写在 `expected.json` 的
  mustFail 里，多红少红都算这个包判错了。这几条门禁号是在 ref 上跑
  `node ref/webuddy-console/bin/webuddy.js json` 得出来的，不是手填的。
