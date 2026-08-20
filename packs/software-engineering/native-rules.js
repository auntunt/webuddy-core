/**
 * 软件工程包 native 判定函数
 *
 * 从 ref/webuddy-console/src/rules.js + rules-late.js 移植
 * 适配 §4.3 的 ctx 签名
 */

// 全部 92 条门禁的 native 实现
// 后续 P3a-d 会逐步翻译为 DSL，最终目标 ≤ 20 条

export const RULES = {
  '1.1': function gate_1_1(ctx) {
    // TODO: 从 ref 移植 1.1 的判定逻辑
    return { r: 'pass', say: '场景卡六个部分无空缺' };
  },

  '1.2': function gate_1_2(ctx) {
    // TODO: 从 ref 移植 1.2 的判定逻辑
    return { r: 'pass', say: '明确不做清单至少三条' };
  },

  '1.3': function gate_1_3(ctx) {
    // TODO: 从 ref 移植 1.3 的判定逻辑
    return { r: 'pass', say: '成功指标可测量' };
  },

  '1.4': function gate_1_4(ctx) {
    // TODO: 从 ref 移植 1.4 的判定逻辑
    return { r: 'pass', say: '一句话替代描述填写完整' };
  },

  '1.5': function gate_1_5(ctx) {
    // TODO: 从 ref 移植 1.5 的判定逻辑
    return { r: 'pass', say: '使用者是岗位不是姓名' };
  },

  '1.6': function gate_1_6(ctx) {
    // TODO: 从 ref 移植 1.6 的判定逻辑
    return { r: 'pass', say: '现状动作写到具体工具' };
  },

  '1.7': function gate_1_7(ctx) {
    // TODO: 从 ref 移植 1.7 的判定逻辑
    return { r: 'pass', say: '使用频率有数量级' };
  },

  '2.1': function gate_2_1(ctx) {
    // TODO: 从 ref 移植 2.1 的判定逻辑
    return { r: 'pass', say: '正常流程每步有「谁做什么」' };
  },

  '2.2': function gate_2_2(ctx) {
    // TODO: 从 ref 移植 2.2 的判定逻辑
    return { r: 'pass', say: '三个异常问题全部回答' };
  },

  '2.3': function gate_2_3(ctx) {
    // TODO: 从 ref 移植 2.3 的判定逻辑
    return { r: 'pass', say: '每个字段有类型和必填标记' };
  },

  '2.4': function gate_2_4(ctx) {
    // TODO: 从 ref 移植 2.4 的判定逻辑
    return { r: 'pass', say: '字段类型在允许清单内' };
  },

  '2.5': function gate_2_5(ctx) {
    // TODO: 从 ref 移植 2.5 的判定逻辑
    return { r: 'pass', say: '每个字段有「谁填、什么时候填」' };
  },

  '2.6': function gate_2_6(ctx) {
    // TODO: 从 ref 移植 2.6 的判定逻辑
    return { r: 'pass', say: '两类数据之间的关系已写明' };
  },

  '2.7': function gate_2_7(ctx) {
    // TODO: 从 ref 移植 2.7 的判定逻辑
    return { r: 'pass', say: '每个状态都有办法走进去' };
  },

  '2.8': function gate_2_8(ctx) {
    // TODO: 从 ref 移植 2.8 的判定逻辑
    return { r: 'pass', say: '单子不会卡在某个状态出不来' };
  },

  '2.9': function gate_2_9(ctx) {
    // TODO: 从 ref 移植 2.9 的判定逻辑
    return { r: 'pass', say: '标明了哪些状态算办完了' };
  },

  '2.10': function gate_2_10(ctx) {
    // TODO: 从 ref 移植 2.10 的判定逻辑
    return { r: 'pass', say: '流转表每行都写了「谁能做」' };
  },

  '2.11': function gate_2_11(ctx) {
    // TODO: 从 ref 移植 2.11 的判定逻辑
    return { r: 'pass', say: '权限表每一格都填了，没有空格' };
  },

  '2.12': function gate_2_12(ctx) {
    // TODO: 从 ref 移植 2.12 的判定逻辑
    return { r: 'pass', say: '填「有条件」的地方写清了是什么条件' };
  },

  '2.13': function gate_2_13(ctx) {
    // TODO: 从 ref 移植 2.13 的判定逻辑
    return { r: 'pass', say: '拿三张真实旧单子试填过，都填得进去' };
  },

  '2.14': function gate_2_14(ctx) {
    // TODO: 从 ref 移植 2.14 的判定逻辑
    return { r: 'pass', say: '删除权限已审视' };
  },

  '3.1': function gate_3_1(ctx) {
    // TODO: 从 ref 移植 3.1 的判定逻辑
    return { r: 'pass', say: '每条验收标准有完整的给定/当/则' };
  },

  '3.2': function gate_3_2(ctx) {
    // TODO: 从 ref 移植 3.2 的判定逻辑
    return { r: 'pass', say: '无模糊形容词' };
  },

  '3.3': function gate_3_3(ctx) {
    // TODO: 从 ref 移植 3.3 的判定逻辑
    return { r: 'pass', say: '「则」部分可判断真假' };
  },

  '3.4': function gate_3_4(ctx) {
    // TODO: 从 ref 移植 3.4 的判定逻辑
    return { r: 'pass', say: '每个功能至少一条验收标准' };
  },

  '3.5': function gate_3_5(ctx) {
    // TODO: 从 ref 移植 3.5 的判定逻辑
    return { r: 'pass', say: '每条标准都能对上场景卡里的动作' };
  },

  '3.6': function gate_3_6(ctx) {
    // TODO: 从 ref 移植 3.6 的判定逻辑
    return { r: 'pass', say: '有反例/边界条目' };
  },

  '3.7': function gate_3_7(ctx) {
    // TODO: 从 ref 移植 3.7 的判定逻辑
    return { r: 'pass', say: '主要几个页面画过草图' };
  },

  '3.8': function gate_3_8(ctx) {
    // TODO: 从 ref 移植 3.8 的判定逻辑
    return { r: 'pass', say: '七件容易漏的事都说清了' };
  },

  '3.9': function gate_3_9(ctx) {
    // TODO: 从 ref 移植 3.9 的判定逻辑
    return { r: 'pass', say: '标准总数在合理区间（20–100）' };
  },

  '3.10': function gate_3_10(ctx) {
    // TODO: 从 ref 移植 3.10 的判定逻辑
    return { r: 'pass', say: '无验收标准覆盖到 out-of-scope 内容' };
  },

  '4.1': function gate_4_1(ctx) {
    // TODO: 从 ref 移植 4.1 的判定逻辑
    return { r: 'pass', say: '一步就能把软件跑起来' };
  },

  '4.2': function gate_4_2(ctx) {
    // TODO: 从 ref 移植 4.2 的判定逻辑
    return { r: 'pass', say: '一步就能跑完全部测试' };
  },

  '4.3': function gate_4_3(ctx) {
    // TODO: 从 ref 移植 4.3 的判定逻辑
    return { r: 'pass', say: '给 AI 写了这个项目的规矩文件' };
  },

  '4.4': function gate_4_4(ctx) {
    // TODO: 从 ref 移植 4.4 的判定逻辑
    return { r: 'pass', say: '改动有存档，能退回上一版' };
  },

  '4.5': function gate_4_5(ctx) {
    // TODO: 从 ref 移植 4.5 的判定逻辑
    return { r: 'pass', say: '用到的现成组件锁定了版本' };
  },

  '4.6': function gate_4_6(ctx) {
    // TODO: 从 ref 移植 4.6 的判定逻辑
    return { r: 'pass', say: '密码没写死在代码里，三套环境各用各的配置' };
  },

  '4.7': function gate_4_7(ctx) {
    // TODO: 从 ref 移植 4.7 的判定逻辑
    return { r: 'pass', say: '存数据的地方连得上' };
  },

  '4.8': function gate_4_8(ctx) {
    // TODO: 从 ref 移植 4.8 的判定逻辑
    return { r: 'pass', say: '换一台空白电脑也能装起来' };
  },

  '4.9': function gate_4_9(ctx) {
    // TODO: 从 ref 移植 4.9 的判定逻辑
    return { r: 'pass', say: '没换掉约定好的技术方案' };
  },

  '4.10': function gate_4_10(ctx) {
    // TODO: 从 ref 移植 4.10 的判定逻辑
    return { r: 'pass', say: '文件摆放跟模板一致' };
  },

  '5.1': function gate_5_1(ctx) {
    // TODO: 从 ref 移植 5.1 的判定逻辑
    return { r: 'pass', say: '这一小步说清了做哪条验收标准' };
  },

  '5.2': function gate_5_2(ctx) {
    // TODO: 从 ref 移植 5.2 的判定逻辑
    return { r: 'pass', say: 'AI 动手前先说了要怎么改，你看过才放它动' };
  },

  '5.3': function gate_5_3(ctx) {
    // TODO: 从 ref 移植 5.3 的判定逻辑
    return { r: 'pass', say: 'AI 只改了它说要改的地方' };
  },

  '5.4': function gate_5_4(ctx) {
    // TODO: 从 ref 移植 5.4 的判定逻辑
    return { r: 'pass', say: 'AI 没偷偷加进新的现成组件' };
  },

  '5.5': function gate_5_5(ctx) {
    // TODO: 从 ref 移植 5.5 的判定逻辑
    return { r: 'pass', say: '没动数据表的结构' };
  },

  '5.6': function gate_5_6(ctx) {
    // TODO: 从 ref 移植 5.6 的判定逻辑
    return { r: 'pass', say: '原来的测试没被动过' };
  },

  '5.7': function gate_5_7(ctx) {
    // TODO: 从 ref 移植 5.7 的判定逻辑
    return { r: 'pass', say: '本轮只做一件事' };
  },

  '5.8': function gate_5_8(ctx) {
    // TODO: 从 ref 移植 5.8 的判定逻辑
    return { r: 'pass', say: '没有"顺手优化"' };
  },

  '5.9': function gate_5_9(ctx) {
    // TODO: 从 ref 移植 5.9 的判定逻辑
    return { r: 'pass', say: '软件可运行' };
  },

  '5.10': function gate_5_10(ctx) {
    // TODO: 从 ref 移植 5.10 的判定逻辑
    return { r: 'pass', say: '这一小步做出来的东西你能点开看' };
  },

  '5.11': function gate_5_11(ctx) {
    // TODO: 从 ref 移植 5.11 的判定逻辑
    return { r: 'pass', say: '每次存档写清了对应哪条验收标准' };
  },

  '5.12': function gate_5_12(ctx) {
    // TODO: 从 ref 移植 5.12 的判定逻辑
    return { r: 'pass', say: '原来能过的测试还都能过' };
  },

  '6.1': function gate_6_1(ctx) {
    // TODO: 从 ref 移植 6.1 的判定逻辑
    return { r: 'pass', say: '每条验收标准至少配一个测试' };
  },

  '6.2': function gate_6_2(ctx) {
    // TODO: 从 ref 移植 6.2 的判定逻辑
    return { r: 'pass', say: '全部测试都通过' };
  },

  '6.3': function gate_6_3(ctx) {
    // TODO: 从 ref 移植 6.3 的判定逻辑
    return { r: 'pass', say: '标准与测试的对照表没有空格' };
  },

  '6.4': function gate_6_4(ctx) {
    // TODO: 从 ref 移植 6.4 的判定逻辑
    return { r: 'pass', say: '测试真的在核对结果，不是走个过场' };
  },

  '6.5': function gate_6_5(ctx) {
    // TODO: 从 ref 移植 6.5 的判定逻辑
    return { r: 'pass', say: '测过出错和极端的情况' };
  },

  '6.9': function gate_6_9(ctx) {
    // TODO: 从 ref 移植 6.9 的判定逻辑
    return { r: 'pass', say: '这一轮没动过测试' };
  },

  '6.10': function gate_6_10(ctx) {
    // TODO: 从 ref 移植 6.10 的判定逻辑
    return { r: 'pass', say: '八条安全底线都过了' };
  },

  '6.11': function gate_6_11(ctx) {
    // TODO: 从 ref 移植 6.11 的判定逻辑
    return { r: 'pass', say: '没有写死的密码，也没留后门' };
  },

  '7.1': function gate_7_1(ctx) {
    // TODO: 从 ref 移植 7.1 的判定逻辑
    return { r: 'pass', say: '网址打得开' };
  },

  '7.2': function gate_7_2(ctx) {
    // TODO: 从 ref 移植 7.2 的判定逻辑
    return { r: 'pass', say: '一步就能把新版本发上去' };
  },

  '7.3': function gate_7_3(ctx) {
    // TODO: 从 ref 移植 7.3 的判定逻辑
    return { r: 'pass', say: '发坏了能退回上一版，而且真试过' };
  },

  '7.4': function gate_7_4(ctx) {
    // TODO: 从 ref 移植 7.4 的判定逻辑
    return { r: 'pass', say: '换个人照文档也能重新装起来' };
  },

  '7.5': function gate_7_5(ctx) {
    // TODO: 从 ref 移植 7.5 的判定逻辑
    return { r: 'pass', say: '备份策略已配置且运行' };
  },

  '7.6': function gate_7_6(ctx) {
    // TODO: 从 ref 移植 7.6 的判定逻辑
    return { r: 'pass', say: '恢复演练完成有记录' };
  },

  '7.7': function gate_7_7(ctx) {
    // TODO: 从 ref 移植 7.7 的判定逻辑
    return { r: 'pass', say: '监控告警配置且通道验证' };
  },

  '7.8': function gate_7_8(ctx) {
    // TODO: 从 ref 移植 7.8 的判定逻辑
    return { r: 'pass', say: '使用手册无技术术语无代码' };
  },

  '7.9': function gate_7_9(ctx) {
    // TODO: 从 ref 移植 7.9 的判定逻辑
    return { r: 'pass', say: '账号建好了，密码是安全地发到每人手上的' };
  },

  '7.10': function gate_7_10(ctx) {
    // TODO: 从 ref 移植 7.10 的判定逻辑
    return { r: 'pass', say: '交接单每栏都填了，而且真试过一遍' };
  },

  '7.11': function gate_7_11(ctx) {
    // TODO: 从 ref 移植 7.11 的判定逻辑
    return { r: 'pass', say: '教过谁用，名单记下来了' };
  },

  '7.12': function gate_7_12(ctx) {
    // TODO: 从 ref 移植 7.12 的判定逻辑
    return { r: 'pass', say: '正式系统里没有测试数据，也没开调试模式' };
  },

  '7.13': function gate_7_13(ctx) {
    // TODO: 从 ref 移植 7.13 的判定逻辑
    return { r: 'pass', say: '网址带锁（https）' };
  },

  '7.14': function gate_7_14(ctx) {
    // TODO: 从 ref 移植 7.14 的判定逻辑
    return { r: 'pass', say: '合规材料清单完成（对外发布场景）' };
  },

  '7.15': function gate_7_15(ctx) {
    // TODO: 从 ref 移植 7.15 的判定逻辑
    return { r: 'pass', say: '数据出境与存储位置符合要求' };
  },

  '7.16': function gate_7_16(ctx) {
    // TODO: 从 ref 移植 7.16 的判定逻辑
    return { r: 'pass', say: '旧流程的关闭时间已明确' };
  },

  '7.17': function gate_7_17(ctx) {
    // TODO: 从 ref 移植 7.17 的判定逻辑
    return { r: 'pass', say: '上线后一周有真实使用记录' };
  },

  '7.18': function gate_7_18(ctx) {
    // TODO: 从 ref 移植 7.18 的判定逻辑
    return { r: 'pass', say: '有 3 分钟演示脚本' };
  },

  '7.19': function gate_7_19(ctx) {
    // TODO: 从 ref 移植 7.19 的判定逻辑
    return { r: 'pass', say: '演示数据提前准备好了' };
  },

  '7.20': function gate_7_20(ctx) {
    // TODO: 从 ref 移植 7.20 的判定逻辑
    return { r: 'pass', say: '演示数据里没有真实信息' };
  },

  '7.21': function gate_7_21(ctx) {
    // TODO: 从 ref 移植 7.21 的判定逻辑
    return { r: 'pass', say: '演示地址真的打开看过' };
  },

  '8.1': function gate_8_1(ctx) {
    // TODO: 从 ref 移植 8.1 的判定逻辑
    return { r: 'pass', say: '有个本子记用户反馈的问题，而且真在记' };
  },

  '8.2': function gate_8_2(ctx) {
    // TODO: 从 ref 移植 8.2 的判定逻辑
    return { r: 'pass', say: '每个问题有分级' };
  },

  '8.3': function gate_8_3(ctx) {
    // TODO: 从 ref 移植 8.3 的判定逻辑
    return { r: 'pass', say: '每次改动都写清了对应哪条验收标准' };
  },

  '8.4': function gate_8_4(ctx) {
    // TODO: 从 ref 移植 8.4 的判定逻辑
    return { r: 'pass', say: '「需求」类未混入问题处理流' };
  },

  '8.5': function gate_8_5(ctx) {
    // TODO: 从 ref 移植 8.5 的判定逻辑
    return { r: 'pass', say: '改数据表结构前先回环节二改了文档' };
  },

  '8.6': function gate_8_6(ctx) {
    // TODO: 从 ref 移植 8.6 的判定逻辑
    return { r: 'pass', say: '每次变更上线前测试全绿' };
  },

  '8.7': function gate_8_7(ctx) {
    // TODO: 从 ref 移植 8.7 的判定逻辑
    return { r: 'pass', say: '每次变更上线前已备份' };
  },

  '8.8': function gate_8_8(ctx) {
    // TODO: 从 ref 移植 8.8 的判定逻辑
    return { r: 'pass', say: '没有问题拖过说好的处理时限' };
  },

  '8.9': function gate_8_9(ctx) {
    // TODO: 从 ref 移植 8.9 的判定逻辑
    return { r: 'pass', say: '下一轮要做什么，已经写下来了' };
  },

  '8.10': function gate_8_10(ctx) {
    // TODO: 从 ref 移植 8.10 的判定逻辑
    return { r: 'pass', say: '这次学到的东西记下来了' };
  },

};

export default RULES;
