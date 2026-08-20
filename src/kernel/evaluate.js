/**
 * 判定引擎：事实集 → 门禁结论。
 *
 * 为什么判定和探测分开：
 *   探测只回答"看到了什么"，判定只回答"这算不算过"。
 *   分开之后，规则改了不用重新扫盘，也能区分"没看见"和"判错了"。
 *
 * 三态判定，不打分：通过 / 待改 / 不通过。
 * 另加两个非评分态：
 *   ask —— 需要人确认一次，工具判不了。不计入不通过。
 *   na  —— 本项目不适用。
 *
 * 适配：
 * - 移除 UI/guide/prompts 依赖（那些在 pack 里）
 * - 返回纯数据结构（§5.2 EvalResult）
 * - stages/gates 从参数传入，不从全局导入
 */

import { effectiveSeverity, normalizeMode, isActive } from './severity.js';

/** 判定结果的中文名，界面直接用这个 */
export const VERDICT_LABEL = {
  pass: '通过', fix: '待改', fail: '不通过', ask: '待确认', na: '不适用',
};

/**
 * 一条门禁的结论。
 *
 * sev 是这条门禁在当前模式和挂钩状态下的有效档位，不是 stages.js 里写的那个。
 * 判定结果（r）跟档位（sev）是两件独立的事：r 说事实如何，sev 说这个事实
 * 该不该拦路。规则函数一个字都不知道档位——档位变了不会让判定结果跟着变，
 * 这是故意的：模式只能改变「拦不拦」，不能改变「过没过」。
 */
function judge(gate, facts, sev, rules) {
  const base = { id: gate.id, gate, severity: sev };

  /**
   * 需求自适应裁剪：AI 判过这条对本项目不适用，直接 na，不跑规则。
   *
   * 放在 rule 查找之前，是因为 na 是「这个场景不存在」，
   * 跟「规则判不了」是两件事——后者要人看一眼，前者根本不用看。
   * block 档在 adaptGates 里已经被挡掉了，进不到 naGates……
   * 但万一 state.json 是手工编辑的或从老版本迁移的，再检查一次：
   * block 不允许被 na（它们是任何项目的底线），静默当成没看见这条 na 标记。
   */
  if (sev !== 'block' && facts.local?.naGates?.includes(gate.id)) {
    return { ...base, r: 'na', detail: '根据项目需求，此项不适用' };
  }

  const rule = rules[gate.id];
  if (!rule) return { ...base, r: 'ask', detail: '这条工具还不会自动判，得你自己看一眼再确认' };

  let out;
  try {
    out = rule(facts);
  } catch (e) {
    // 规则本身出错，不能算项目不合格
    out = { r: 'ask', detail: `工具自己出错了，没能判这条（${e.message}）。不是你的项目有问题，这条先你自己看一眼` };
  }
  return { ...base, r: out.r, detail: out.detail || '' };
}

/**
 * 环节是否通过：该环节所有 auto 门禁都是 pass/na，
 * 且 human 门禁没有 fail/fix。
 * ask 不算过——但也不算不过，它算"还没判"。
 *
 * 2026-08-14 加了档位：info 档在非 full 模式下整条不算数（见 severity.js
 * 的 isActive），进不了分母也影响不了状态。剩下的 block 和 warn 都算数，
 * 但只有 block 的 fail 会让这一环节变 blocked——warn 的 fail 记在
 * softFails 里，界面照样亮红灯，人确认过就能往下走。
 * 这就是「外挂辅助」跟「强制规范」的差别落在代码里的地方。
 */
function stageStatus(stage, verdictById, mode) {
  const all = stage.gates.map((g) => verdictById.get(g.id)).filter(Boolean);
  const vs = all.filter((v) => isActive(v.severity, mode));
  const blocks = vs.filter((v) => v.severity === 'block');
  const softs = vs.filter((v) => v.severity !== 'block');

  const fails = vs.filter((v) => v.r === 'fail');
  const fixes = vs.filter((v) => v.r === 'fix');
  const asks = vs.filter((v) => v.r === 'ask');
  const passes = vs.filter((v) => v.r === 'pass' || v.r === 'na');

  // 拦路的只数 block 档。warn 档的没过要显示，但不改环节状态
  const hardFails = blocks.filter((v) => v.r === 'fail');
  const hardFixes = blocks.filter((v) => v.r === 'fix');
  // warn 门禁：已确认的不计入 softFails（但仍显示为橙色删除线）
  const softFails = softs.filter((v) => (v.r === 'fail' || v.r === 'fix') && !v.acked);

  let state;
  if (hardFails.length > 0) state = 'blocked';
  else if (hardFixes.length > 0) state = 'fixing';
  else if (asks.length > 0) state = 'waiting';
  else if (passes.length === vs.length && vs.length > 0) state = 'passed';
  else if (softFails.length > 0) state = 'fixing';
  else state = 'untouched';

  // 不适用的项从分子分母里一起拿掉。
  // 原来 na 算进分子，于是一个空项目的环节八显示「4/10」——
  // 那 4 分全是"还没上线所以不适用"。看着像有进展，其实一步没走。
  const nas = vs.filter((v) => v.r === 'na');
  const real = vs.length - nas.length;
  const won = passes.length - nas.length;
  return {
    id: stage.id,
    name: stage.name,
    state,
    total: real,
    passed: won,
    na: nas.length,
    fails: fails.map((v) => v.id),
    fixes: fixes.map((v) => v.id),
    asks: asks.map((v) => v.id),
    // 分档明细。界面按这个上颜色：hard 是真拦，soft 是提醒
    hardFails: hardFails.map((v) => v.id),
    softFails: softFails.map((v) => v.id),
    // 这个模式下静默掉的条数。界面上要说出来，不能让人以为门禁少了
    muted: all.length - vs.length,
    // 进度百分比只用于画条，不用于判断能不能过关
    percent: real === 0 ? 0 : Math.round((won / real) * 100),
  };
}

/**
 * 当前环节 = 第一个没通过的环节。
 * 注意不是"最后有动静的环节"——那样会把倒挂项目算成进度很靠前。
 */
function findCurrentStage(stageStatuses) {
  for (const s of stageStatuses) {
    if (s.state !== 'passed') return s.id;
  }
  return 8;
}

/**
 * 主入口。输入 facts，输出全部结论。
 *
 * @param {object} facts - detect() 的事实集
 * @param {object} context - { stages, gates, rules, gateById, stageById }
 * @returns {object} EvalResult（§5.2）
 */
export function evaluate(facts, context) {
  const { stages, gates, rules, gateById, stageById } = context;

  const mode = normalizeMode(facts.local?.mode);

  /**
   * 挂钩装没装：一条 agent 痕迹都没有就当没装。
   *
   * 这跟 activeFloor 用的是同一个信号（facts.agent.count），故意保持一致——
   * 两处对「装没装」的判断分家，会出现界面一边说"挂钩已生效"、
   * 一边按没装的规则降档的情况。
   */
  const hookInstalled = Boolean(facts.agent?.count);

  /**
   * 人对 warn 档说过「我知道了」的那几条。
   *
   * 只影响 softFails（环节状态），不影响 r——「看过了」不等于「做过了」，
   * 所以百分比一分不加。这是跟 humanChecks 的根本区别：那个是人作证做过了，
   * 这个只是人表示知情。混成一件事的话，点几下按钮就能把进度刷满。
   */
  const acknowledgedWarns = facts.local?.acknowledgedWarns || {};

  const verdicts = gates.map((g) => {
    const v = judge(g, facts, effectiveSeverity(g, { mode, hookInstalled }), rules);
    // 只给 warn 档挂 acked：block 档不允许「知道了就算了」，info 档本来就不出声
    if (v.severity === 'warn' && acknowledgedWarns[v.id]) v.acked = acknowledgedWarns[v.id];
    return v;
  });

  const verdictById = new Map(verdicts.map((v) => [v.id, v]));
  const stageStatuses = stages.map((s) => stageStatus(s, verdictById, mode));

  // 这个模式下算数的门禁。counts 的每个桶都从这儿过一遍，
  // 保证分子分母同一套口径（check/fixtures.mjs 的 sane() 靠这个成立）
  const active = verdicts.filter((v) => isActive(v.severity, mode));

  const current = findCurrentStage(stageStatuses);

  // 还没走到的环节，不该显示成"卡住"。
  // 环节七的门禁在环节二当然是不通过的，把它标红只会淹掉真正的问题。
  const notYet = new Set();
  for (const s of stageStatuses) {
    if (s.id > current + 1 && s.state !== 'passed') {
      s.state = 'notyet';
      notYet.add(s.id);
    }
  }

  const result = {
    dir: facts.dir,
    name: facts.name,
    scannedAt: facts.scannedAt,
    currentStage: current,
    stages: stageStatuses,
    verdicts,
    verdictById,
    // 当前模式和挂钩状态。界面顶部要显示，也要靠它决定说哪句提示
    mode,
    hookInstalled,
    /**
     * 需求裁剪的结果。界面顶部要显示「32 条适用」，也要靠 adaptedAt
     * 区分「适配过、结论是一条都不裁」和「从没适配过」——
     * 两种情况 naGates 都是空数组，但要说的话不一样。
     */
    adapt: {
      adaptedAt: facts.local?.adaptedAt || null,
      naGates: facts.local?.naGates || [],
      reasoning: facts.local?.adaptReasoning || '',
      description: facts.local?.projectDescription || '',
    },
    counts: {
      /**
       * 分母是这个模式下算数的门禁条数，不随项目状态浮动——
       * 看板上的分母一会儿 82 一会儿 88 没法看。
       * 不写死数字：门禁增删时数字自己跟上，不会留下一个跟 stages.js 对不上的常量。
       * 分子只数真拿到的绿灯，不含不适用项，和环节行同一套口径。
       *
       * 为什么分母是 active 而不是全部 88：静默掉的 info 条目不该进分母。
       * 学习模式下 70 条是 info，留在分母里的话，把 18 条核心全做对的人
       * 看到的是「18/88」——他该做的全做了，却像只走了五分之一。
       * 全部条数走 totalAll，界面上用它说「另有 N 条在这个模式下不计」。
       */
      total: active.length,
      totalAll: verdicts.length,
      muted: verdicts.length - active.length,
      pass: active.filter((v) => v.r === 'pass').length,
      na: active.filter((v) => v.r === 'na').length,
      fix: active.filter((v) => v.r === 'fix').length,
      fail: active.filter((v) => v.r === 'fail').length,
      ask: active.filter((v) => v.r === 'ask').length,
      // 现在该管的：只算走到了的环节。看板上写"55不通过"没有意义——
      // 环节七的门禁在环节一当然不通过，那不是待办事项。
      failNow: active.filter((v) => v.r === 'fail' && !notYet.has(v.gate.stage)).length,
      fixNow: active.filter((v) => v.r === 'fix' && !notYet.has(v.gate.stage)).length,
      askNow: active.filter((v) => v.r === 'ask' && !notYet.has(v.gate.stage)).length,
      // 真拦路的有几条。这个数是「体验上从处处红灯变成重点提醒」的度量
      blockingNow: active.filter((v) => v.severity === 'block'
        && (v.r === 'fail' || v.r === 'fix') && !notYet.has(v.gate.stage)).length,
    },
  };

  return result;
}
