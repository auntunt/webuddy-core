# 财务审计流程SOP

中小企业年度财务审计标准作业流程，从 ref/webuddy-console/test-skills/financial-audit.md 翻译而来。

## 统计

- 环节: 3
- 门禁: 9 (auto 6 条，human 3 条)
- DSL 探测块: 6 条
- DSL 覆盖率: **100%** (6/6，所有 auto 门禁均用 DSL 实现)
- Native 实现: 无

## 门禁分布

- 环节 1 (审计准备): 3 道
- 环节 2 (实质性测试): 3 道
- 环节 3 (审计报告): 3 道

## DSL 覆盖情况

所有 auto 门禁均使用 DSL 实现：

| 门禁 | 实现方式 | 说明 |
|------|----------|------|
| 1.1 | DSL (file-exists) | 检查业务约定书 |
| 1.2 | DSL (all + file-exists + regex-hit) | 检查独立性声明及签署日期 |
| 2.1 | DSL (file-exists) | 检查重大科目底稿 |
| 2.2 | DSL (file-exists) | 检查函证回函 |
| 3.1 | DSL (all + file-exists + regex-hit) | 检查未更正错报汇总表完整性 |
| 3.2 | DSL (all + file-exists) | 检查审计报告与底稿存在性 |

## 自带的两个样板项目

`webuddy pack test packs/financial-audit` 拿这两个项目试一遍整套判据：

- `fixtures/good/` —— 业务约定书已签、独立性声明齐全、科目底稿完整、函证已回、错报汇总表完整、报告与底稿一致，应该全绿。人工确认预置在 `.webuddy/records.jsonl`（3 条 human 门禁）。
- `fixtures/broken/` —— 从 good/ 拷一份、故意缺两个文件：业务约定书（1.1 应红）、建设银行回函（2.2 应红）。该红的 2 条写在 `expected.json` 的 mustFail 里。

## 未使用 DSL 的原因

无 —— 所有 auto 门禁均使用 DSL 实现，无需 native。
