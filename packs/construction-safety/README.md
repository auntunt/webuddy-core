# 施工安全检查SOP

电力施工现场安全检查标准流程，从 ref/webuddy-console/test-skills/construction-safety.md 翻译而来。

## 统计

- 环节: 3
- 门禁: 8 (auto 5 条，human 3 条)
- DSL 探测块: 5 条
- DSL 覆盖率: **100%** (5/5，所有 auto 门禁均用 DSL 实现)
- Native 实现: 无

## 门禁分布

- 环节 1 (开工前检查): 3 道
- 环节 2 (过程巡检): 3 道
- 环节 3 (验收归档): 2 道

## DSL 覆盖情况

所有 auto 门禁均使用 DSL 实现：

| 门禁 | 实现方式 | 说明 |
|------|----------|------|
| 1.1 | DSL (all + file-exists) | 检查三个资质文件是否存在 |
| 1.3 | DSL (all + file-exists) | 检查四个方向围挡照片 |
| 2.1 | DSL (file-exists) | 检查巡检记录文件 |
| 2.3 | DSL (file-exists) | 检查接地电阻检测报告 |
| 3.1 | DSL (all + file-exists + regex-hit) | 检查隐患台账及整改完成标记 |

## 自带的两个样板项目

`webuddy pack test packs/construction-safety` 拿这两个项目试一遍整套判据：

- `fixtures/good/` —— 资质齐全、围挡到位、巡检完整、检测报告齐全、隐患已闭环，应该全绿。人工确认预置在 `.webuddy/records.jsonl`（3 条 human 门禁）。
- `fixtures/broken/` —— 从 good/ 拷一份、故意缺两个文件：项目经理证书（1.1 应红）、接地电阻检测报告（2.3 应红）。该红的 2 条写在 `expected.json` 的 mustFail 里。

## 未使用 DSL 的原因

无 —— 所有 auto 门禁均使用 DSL 实现，无需 native。
