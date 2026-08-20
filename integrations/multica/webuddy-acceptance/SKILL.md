---
name: webuddy-acceptance
description: 交活前必须通过 WeBuddy 验收门禁。开工先认领,交活先自检,结论贴回 issue。
allowed-tools: Bash(webuddy *), Bash(multica *)
---

# WeBuddy 验收纪律

你在一个挂载了 WeBuddy 担架的项目里干活。issue ID 从你的任务简报读取
(工作区 `.agent_context/issue_context.md` 的 **Issue ID:** 字段,或任务提示里
multica 命令中已内联的 issue UUID),下文记作 <issue-id>。三条规矩:

## 1. 开工先开轮次
```
webuddy round start --session "$MULTICA_TASK_ID" --gate <要修的门禁ID,没有就省略> \
  --files <打算改的文件,逗号分隔>
```
提示文件被别的会话认领时,不要强行改那些文件——改别的,或写评论说明等待。

## 2. 交活前必须自检
```
webuddy round end --session "$MULTICA_TASK_ID"
webuddy check --json > /tmp/webuddy-verdict.json
```
verdict 是 blocked 或 fail:按 blockers 里的 how 指引修,修完重跑。
连续 2 次修不过:停下,把 verdict 摘要贴回 issue 请人裁决,不要继续硬试。

## 3. 结论贴回 issue(无论过没过)
先把人读摘要写成文件再发(multica 禁止多行内容走内联 --content):
```
webuddy check > ./webuddy-verdict.md
multica issue comment add <issue-id> --content-file ./webuddy-verdict.md
rm ./webuddy-verdict.md
multica issue metadata set <issue-id> --key webuddy_verdict --value <pass|fail|blocked|needs-human>
```
若本次任务由评论触发,按任务提示给的 comment ID 加 `--parent <id>` 回原线程。
needs-human 的提问要原文列在评论里——那些必须人答,不许替人答。

## 禁止
- 不许为让门禁变绿而改测试断言、删测试用例;不许改 .webuddy/ 下任何文件
  (webuddy 命令自身的写入除外)——轮次快照会记录并公示。
