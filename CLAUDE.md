# CLAUDE.md — webuddy-core

## 定位
行业无关的验收内核 + 可插拔担架包。判定归规则(纯函数),LLM 只做辅助且 fail-closed。
语义参照:ref/webuddy-console(只读)。裁量记 DECISIONS.md(格式见 GOAL.md §0.5)。

## 铁律
- 零依赖:纯 Node ≥20 ESM,dependencies/devDependencies 恒空;node:test 是标准库,无需安装。
- src/kernel/ 里 grep 不到任何行业专有物(门禁 ID、TEST_HINT 类正则一律在包里)。
- 探测 DSL 原语封顶 12,现已满员、永久封版(第 12 个是 applies-if,GOAL-2 I2a 落地);
  连接词只有 all/any/not。想加原语 = 先想怎么降级 human。
- 面向用户的字符串全部大白话:带具体数字、文件名、怎么办。机器输出(--json/HTTP)不做术语替换。
- 易用性八铁律(GOAL.md §2.5)约束一切用户面:三问原则、术语零暴露(禁词表 glossary-base.json)、
  点击深度 ≤2、空状态即引导、报错三段式、不问技术参数、破坏性操作说后果、一个入口。
  用户画像:行业专家、计算机小白;日常回路必须零终端。
- LLM 调用失败 → 维持现状,绝不猜。
- 骨架变更只有 applyProposal 一条路径;human 确认随 instanceVersion 失效。
- evaluate 是纯函数;records 落盘在调用层(cmd-check / api)。
- .webuddy/ 路径只经 state.js 拼。
- bin/webuddy.js 于 GOAL-2 I0 注册 hook/answer/demo(并一次性补齐 --no-record/--agent/--dry-run/--set
  四个开关)后再次冻结;后续任务只填各自 src/cli/cmd-*.js。

## 验证纪律
- 同一测试失败盲目重试 ≤2 次,之后读代码找根因。
- 攒 3-5 个相关改动一次性验证;临时文件 tmp-* 用完即删。
- 测试用真实临时目录(mkdtemp),不 mock fs;网络测试只连 127.0.0.1。

## 提交
conventional commits + 任务 ID;判据通过才标 [判据通过];每 Phase 收口打 annotated tag phase-N。
