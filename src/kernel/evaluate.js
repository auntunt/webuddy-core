/**
 * 判定引擎：项目目录 + 担架包 → 每条门禁的结论。
 *
 * 为什么判定和探测分开：
 *   探测只回答"看到了什么"，判定只回答"这算不算过"。
 *   分开之后，规则改了不用重新扫盘，也能区分"没看见"和"判错了"。
 *
 * 五态判定，不打分：
 *   pass 通过 / fix 待改 / fail 不通过
 *   ask  需要人确认一次，工具判不了。不计入不通过。
 *   na   本项目不适用。
 * 另有 notyet 语义：还没走到的环节，它的门禁不算"现在该管"。
 *   notyet 不是第六种判定结果，是环节状态——同一条门禁在不同时间点
 *   该不该管会变，但它过没过不会变。混成一态的话，"不通过"这个数
 *   就会随着项目往前走自己涨跌，看板上没法解释。
 *
 * 本函数是纯函数：只读盘，不写盘。records 落盘归调用层（cmd-check / api）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { effectiveSeverity, normalizeMode, isActive } from './severity.js';
import { createFactContext, factsFingerprint } from './facts.js';
import { evalProbe } from './probes.js';
import { statePath, loadState, readRecords, getInstanceVersion } from './state.js';

/** 判定结果的中文名，人读界面直接用这个 */
export const VERDICT_LABEL = {
  pass: '通过', fix: '待改', fail: '不通过', ask: '待确认', na: '不适用',
};

/**
 * 按 scope 过滤门禁。
 *
 * all | stage:N | gate:ID | round:SID
 * round:SID 取该轮次绑定的门禁——一轮只申报一条门禁，所以是单条或空。
 * 认不出的 scope 当 all，不报错：scope 是机器传的，人不填这个，
 * 传错了让它退回"全查"比直接失败有用。
 */
function filterByScope(gates, scope, roundData) {
  if (!scope || scope === 'all') return gates;

  const stageMatch = /^stage:(\d+)$/.exec(scope);
  if (stageMatch) {
    const n = Number(stageMatch[1]);
    return gates.filter((g) => g.stage === n);
  }

  const gateMatch = /^gate:(.+)$/.exec(scope);
  if (gateMatch) {
    const id = gateMatch[1];
    return gates.filter((g) => g.id === id);
  }

  if (/^round:/.test(scope)) {
    const bound = roundData?.gateId;
    if (!bound) return [];
    return gates.filter((g) => g.id === bound);
  }

  return gates;
}

/**
 * human 门禁的判定：查 records.jsonl 里有没有人确认过。
 *
 * 匹配条件（§2.4）：同 gateId 最近一条 human-confirm，且 result==='pass'，
 * 且该条记录的 instanceVersion 等于当前骨架版本。
 *
 * 为什么要卡版本：骨架一变（门禁被裁掉、判据锚点被改），旧的确认就不再是
 * 对现在这条门禁的确认了。不失效的话，人会在"我明明确认过"和
 * "确认的是另一个东西"之间毫无察觉——那比没确认过更坏。
 */
function judgeHuman(gate, records, instanceVersion) {
  const mine = records.filter((r) => r.kind === 'human-confirm' && r.gateId === gate.id);
  if (mine.length === 0) {
    return { r: 'ask', say: '这条得你自己看一眼再确认，工具判不了' };
  }

  const latest = mine[mine.length - 1];
  if (latest.instanceVersion !== instanceVersion) {
    return {
      r: 'ask',
      say: `你确认过这条，但之后检查清单改过（改前是第 ${latest.instanceVersion} 版，现在是第 ${instanceVersion} 版），要重新看一眼`,
    };
  }
  if (latest.result === 'pass') {
    return { r: 'pass', say: latest.note ? `你确认过：${latest.note}` : '你已经确认过这条' };
  }
  return { r: 'fail', say: latest.note ? `你确认为不通过：${latest.note}` : '你确认过这条不通过' };
}

/**
 * 要人看的门禁，问之前先看看有没有前提没到位。
 *
 * 有些事根本还问不了：交接单还没写，"另一个人照着它装成功了吗"就没有意思。
 * 这时候跟人说"你自己看一眼确认"，人打开一看什么都没有，只会来问工具想要什么。
 * 所以包可以给这类门禁配一条判据，专门回答"现在有没有条件问这件事"。
 *
 * 这条判据只许往坏的方向说话：说不出问题就闭嘴，让人照常确认。
 * 它给的 pass 一概不算——工具替人点头这件事，从这里开始就不允许，
 * 不然包作者写错一条判据就能把"要人看"变成"不用人看"。
 *
 * @returns {null|{r:string, say:string}} null = 没发现前提问题
 */
function humanPrecheck(gate, env) {
  const { ctx, nativeRules } = env;
  const rule = nativeRules?.[gate.id];
  if (typeof rule !== 'function') return null;

  let out;
  try {
    ctx.gateId = gate.id;
    out = rule(ctx);
  } catch {
    // 前提判据自己出错，不该影响"这条要人看"这个既定事实
    return null;
  }
  const r = out && typeof out === 'object' ? out.r : null;
  if (r !== 'fail' && r !== 'fix') return null;
  const say = out.detail || out.say || '';
  if (!say) return null; // 说不出具体缺什么就别报，报了人也不知道该干什么
  return { r, say };
}

/**
 * 一条门禁的结论。
 *
 * sev 是这条门禁在当前模式和挂钩状态下的有效档位，不是包里写的那个天花板。
 * 判定结果（r）跟档位（sev）是两件独立的事：r 说事实如何，sev 说这个事实
 * 该不该拦路。探测表达式和规则函数一个字都不知道档位——档位变了不会让判定
 * 结果跟着变，这是故意的：模式只能改变「拦不拦」，不能改变「过没过」。
 */
function judgeGate(gate, sev, env) {
  const { ctx, probes, probeMiss, prompts, nativeRules, naGates, records, instanceVersion } = env;
  // needsEvidence 跟着门禁一路传到界面：包说这条要交文件，卡片上就得有上传框。
  // 只在为真时带上，免得给每条门禁都加一个 false 字段。
  const base = {
    id: gate.id, stage: gate.stage, severity: sev, mode: gate.mode,
    ...(gate.needsEvidence ? { needsEvidence: true } : {}),
  };

  /**
   * 需求裁剪：骨架说这条对本项目不适用，直接 na，不跑判据。
   *
   * 放在查判据之前，因为 na 是「这个场景不存在」，跟「判不了」是两件事——
   * 后者要人看一眼，前者根本不用看。
   * block 档不允许被 na（它们是任何项目的底线）：就算 skeleton.json 是手工
   * 编辑或从老版本迁移来的，这里再挡一次，静默当没看见这条 na 标记。
   */
  if (sev !== 'block' && naGates.includes(gate.id)) {
    return { ...base, r: 'na', say: '按你项目的情况，这条不适用', how: '' };
  }

  if (gate.mode === 'human') {
    const out = judgeHuman(gate, records, instanceVersion);
    if (out.r === 'pass') {
      return { ...base, r: out.r, say: out.say, how: gate.hint || '' };
    }
    const blocked = humanPrecheck(gate, env);
    if (blocked) {
      return { ...base, r: blocked.r, say: blocked.say, how: gate.hint || '' };
    }
    return { ...base, r: out.r, say: out.say, how: gate.hint || '' };
  }

  // auto 门禁：probes.md 优先于 native（§3.4 交叉校验 a）
  const ast = probes.get(gate.id);
  if (ast) {
    let out;
    try {
      ctx.gateId = gate.id;
      out = evalProbe(ast, ctx);
    } catch (e) {
      // 判据本身出错，不能算项目不合格
      return {
        ...base,
        r: 'ask',
        say: `工具自己出错了，没能判这条（${e.message}）。不是你的项目有问题，这条先你自己看一眼`,
        how: gate.hint || '',
      };
    }
    /**
     * 「不过时算」的门禁级映射（I2b）。
     *
     * 表达式只答过 / 不过 / 不适用三样；「不过」落成哪一档由门禁自己说了算：
     *   缺省      = fail   你做错了
     *   fix       = fix    你还差一件事没做
     *   ask       = ask    机器看不准，你自己看一眼
     * 只映射 fail —— pass 和 na 是事实，不该被档位改写。
     */
    let r = out.r;
    let say = out.detail || gate.desc || '';
    let askGroup = null;
    if (r === 'fail' && probeMiss && probeMiss.get(gate.id)) {
      r = probeMiss.get(gate.id);
      if (r === 'ask') {
        /**
         * ask 走的是"等人答"这条通道，界面上要有话问。
         * 门禁自己有提问组就用它的；没有就拿探测的说法直接问人——
         * 光说"待确认"而不说待确认什么，人打开看板只会更懵。
         */
        const pg = (prompts || []).find((x) => x.id === gate.id) || null;
        if (pg) {
          say = pg.lead || say;
          askGroup = { asks: pg.asks || [] };
        } else {
          say = `机器看不准：${out.detail || gate.desc || ''}，你自己看一眼`;
        }
      }
    }

    return {
      ...base,
      r,
      say,
      how: gate.hint || '',
      ...(askGroup ? { askGroup } : {}),
      ...(out.evidence ? { evidence: out.evidence } : {}),
    };
  }

  const rule = nativeRules?.[gate.id];
  if (!rule) {
    return { ...base, r: 'ask', say: '这条工具还不会自动判，得你自己看一眼再确认', how: gate.hint || '' };
  }

  let out;
  try {
    ctx.gateId = gate.id;
    out = rule(ctx);
  } catch (e) {
    return {
      ...base,
      r: 'ask',
      say: `工具自己出错了，没能判这条（${e.message}）。不是你的项目有问题，这条先你自己看一眼`,
      how: gate.hint || '',
    };
  }

  /**
   * 规则返回垃圾也不能炸掉整场判定。
   *
   * 上面的 try/catch 只挡抛异常的规则，不挡 return null 或 return {} 的规则。
   * 包作者写错一条，92 条一起判不出来——那是内核的问题，不是包的问题。
   */
  const r = out && typeof out === 'object' ? out.r : null;
  if (!r || !Object.hasOwn(VERDICT_LABEL, r)) {
    return {
      ...base,
      r: 'ask',
      say: `这条的判据写坏了（没给出有效结论），先你自己看一眼。包的作者要修 ${gate.id} 这条`,
      how: gate.hint || '',
    };
  }
  return {
    ...base, r, say: out.detail || out.say || gate.desc || '', how: out.how || gate.hint || '',
  };
}

/**
 * 环节状态。
 *
 * 拦路的只数 block 档：warn 档没过要显示，但不改环节状态——
 * 这就是「外挂辅助」跟「强制规范」的差别落在代码里的地方。
 * info 档在非 full 模式下整条不算数（见 severity.js 的 isActive），
 * 进不了分母也影响不了状态。
 *
 * stage.gates 在本内核里是门禁 ID 的数组（skill-compile 的 buildStages 产出），
 * 不是门禁对象数组——这里按 ID 取，别照抄 ref 的 g.id。
 */
function stageStatus(stage, verdictById, mode) {
  const ids = Array.isArray(stage.gates) ? stage.gates : [];
  const all = ids.map((g) => verdictById.get(typeof g === 'string' ? g : g?.id)).filter(Boolean);
  const vs = all.filter((v) => isActive(v.severity, mode));
  const blocks = vs.filter((v) => v.severity === 'block');
  const softs = vs.filter((v) => v.severity !== 'block');

  const fails = vs.filter((v) => v.r === 'fail');
  const fixes = vs.filter((v) => v.r === 'fix');
  const asks = vs.filter((v) => v.r === 'ask');
  const passes = vs.filter((v) => v.r === 'pass' || v.r === 'na');

  const hardFails = blocks.filter((v) => v.r === 'fail');
  const hardFixes = blocks.filter((v) => v.r === 'fix');
  const softFails = softs.filter((v) => (v.r === 'fail' || v.r === 'fix') && !v.acked);

  let state;
  if (hardFails.length > 0) state = 'blocked';
  else if (hardFixes.length > 0) state = 'fixing';
  else if (asks.length > 0) state = 'waiting';
  else if (passes.length === vs.length && vs.length > 0) state = 'passed';
  else if (softFails.length > 0) state = 'fixing';
  else state = 'untouched';

  /**
   * 不适用的项从分子分母里一起拿掉。
   *
   * na 算进分子的话，一个空项目的环节八会显示「4/10」——那 4 分全是
   * "还没上线所以不适用"。看着像有进展，其实一步没走。
   */
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
    // 分档明细。界面按这个上颜色：hard 是真拦，soft 是提醒。
    // hardFixes 必须落进返回值——verdict.js 靠它判「能不能往下走」，
    // 少了这个字段就永远取到空数组，有拦路项也放行。
    hardFails: hardFails.map((v) => v.id),
    hardFixes: hardFixes.map((v) => v.id),
    softFails: softFails.map((v) => v.id),
    // 这个模式下静默掉的条数。界面上要说出来，不能让人以为门禁少了
    muted: all.length - vs.length,
    // 进度百分比只用于画条，不用于判断能不能过关
    percent: real === 0 ? 0 : Math.round((won / real) * 100),
  };
}

/**
 * 当前环节 = 第一个没通过的环节。
 *
 * 注意不是"最后有动静的环节"——那样会把倒挂项目算成进度很靠前。
 * 全部通过时返回最后一个环节的 id，不写死 8：环节数是包决定的，
 * 三环节的包全通过时返回 8 会让下游 stages.find 落空，
 * 于是一个全绿项目被报成"无法确定当前环节"。
 */
function findCurrentStage(stageStatuses) {
  for (const s of stageStatuses) {
    if (s.state !== 'passed') return s.id;
  }
  return stageStatuses.length > 0 ? stageStatuses[stageStatuses.length - 1].id : 0;
}

/**
 * 工程看起来干到哪一步了（不是"该在哪一步"）。
 *
 * 内核不知道"代码文件"、"部署脚本"长什么样，那是行业知识。所以这里两条路：
 *   1) 包提供 apparentStage(ctx) 钩子（native 包的具名导出）——按包自己的
 *      标志物判断，SE 包移植 ref evaluate.js 的同名函数；
 *   2) 包没提供时退到通用口径：有任何一条门禁判过（pass/fix/fail，不含 ask/na）
 *      的最大环节号。通用口径下不会误报倒挂，只会漏报——宁可少说一句，
 *      不能让一个刚建好的空项目第一眼就看到假警报。
 */
function computeApparentStage(env, verdicts, stageStatuses) {
  const hook = env.hooks.apparentStage;
  if (typeof hook === 'function') {
    try {
      const n = hook(env.ctx);
      if (Number.isInteger(n) && n > 0) return n;
    } catch {
      // 包的钩子出错就退到通用口径，不能让它炸掉整场判定
    }
  }

  const touched = verdicts.filter((v) => v.r === 'pass' || v.r === 'fix' || v.r === 'fail');
  if (touched.length === 0) {
    return stageStatuses.length > 0 ? stageStatuses[0].id : 0;
  }
  return Math.max(...touched.map((v) => v.stage));
}

/**
 * 倒挂检测。本工具区别于进度条的地方。
 *
 * 倒挂 = 后面的活已经干起来了，前面该先说清的还是空的。
 * 这不是"进度落后"，是"顺序错了"，代价完全不同：
 * 进度落后只是慢，顺序错了是已完成的东西要重做。
 *
 * missing 的每一项都自带 file：不许由下游拿 stage.artifacts[0] 去猜——
 * 一个环节有四份产物，猜出来的永远是第一份，于是"补权限表"会指到
 * 流程说明那个文件上。指错文件比不指文件坏：人打开一看里面根本没有
 * 要他补的那一栏，只能回头问人。
 */
function detectInversion(env, gap, currentStage, apparent, verdictById, gates) {
  if (gap <= 0) return [];

  const hook = env.hooks.upstreamMissing;
  let missing = null;
  if (typeof hook === 'function') {
    try {
      const out = hook(env.ctx);
      if (Array.isArray(out)) missing = out;
    } catch {
      missing = null;
    }
  }

  if (!missing) {
    // 通用口径：当前及之前环节里，拦路且没过的门禁就是"前面的窟窿"
    missing = gates
      .filter((g) => g.stage <= currentStage)
      .map((g) => verdictById.get(g.id))
      .filter((v) => v && v.severity === 'block' && (v.r === 'fail' || v.r === 'fix'))
      .map((v) => ({
        what: v.say || v.id, stage: v.stage, file: v.evidence || '', why: v.how || '',
      }));
  }

  if (missing.length === 0) return [];

  return [{
    kind: 'inversion',
    severity: missing.length >= 3 ? 'high' : 'mid',
    headline: `活已经干到第 ${apparent} 步了，但第 ${currentStage} 步还缺 ${missing.length} 份该先说清的东西`,
    missing,
    cost: '现在补，改的是几页文档；等后面的东西按错的前提定死了再补，改的是已经做完的活。',
  }];
}

/**
 * 这一轮 AI 动的东西超出了说好的范围。
 *
 * 违规明细来自 rounds.js 组装好的 violations（§6.2，每条自带大白话 say），
 * 这里只按维度归并成人能一眼看懂的一两句话。
 * 文案口径参照 ref evaluate.js 的 detectAiDrift / detectTestTamper。
 */
function detectRoundWarnings(roundData) {
  const vios = roundData?.violations || [];
  if (vios.length === 0) return [];

  const out = [];
  const tests = vios.filter((v) => v.dim === 'tests');
  if (tests.length > 0) {
    out.push({
      kind: 'test-tamper',
      severity: 'high',
      headline: `原来的检查被改动了：${tests.map((v) => v.say).join('；')}`,
      cost: '这些检查是你唯一能看出东西好没好的通道。改它让它显示通过，等于把仪表盘拆了——毛病还在，只是看不见了。',
    });
  }

  const others = vios.filter((v) => v.dim !== 'tests');
  if (others.length > 0) {
    out.push({
      kind: 'ai-drift',
      severity: 'mid',
      headline: `这一轮动的东西超出了说好的范围：${others.map((v) => v.say).join('；')}`,
      cost: '这类改动你当场看不出来，但会在几天后变成"昨天还好好的，今天怎么不行了"。',
    });
  }
  return out;
}

/**
 * 阻断提问组：blockUntilAnswered 且还没答完的那几组。
 *
 * 命名警告（§5.2）：ref 的 blockers 指的是这个，不是失败的 block 门禁。
 * 本内核里失败的 block 门禁叫 hardFailsNow，两者不许混叫。
 *
 * notYet = 还没走到的环节号。这些环节的问题一律不拦路，理由和
 * buildHumanPending 里那条一样：环节五的问题在环节一根本没法答，
 * 摆上去只会让刚开工的项目第一屏就是一堆"等你确认"，然后整个项目
 * 被判成 blocked——问的人答不了，判的人也判不动。
 */
function findPromptsPending(prompts, answers, verdictById, notYet = new Set()) {
  const out = [];
  for (const p of prompts || []) {
    if (!p.blockUntilAnswered) continue;
    if (notYet.has(p.stage)) continue;
    // 该门禁已经判过了（不是 ask），这组问题就不再拦路
    const v = verdictById.get(p.id);
    if (v && v.r !== 'ask') continue;
    const got = answers[p.id] || {};
    const unanswered = (p.asks || []).filter((a) => {
      const val = got[a.key];
      return val === undefined || val === null || String(val).trim() === '';
    });
    if (unanswered.length === 0) continue;
    out.push({
      id: p.id,
      stage: p.stage,
      lead: p.lead || '',
      asks: unanswered.map((a) => ({ key: a.key, q: a.q, why: a.why || '' })),
    });
  }
  return out;
}

/**
 * 读骨架实例（§7.3）。缺失 = 包原始骨架，instanceVersion 视为 0。
 * 读坏了也当缺失：手工编辑坏的 skeleton.json 不该让人连进度都看不到。
 */
function loadSkeleton(projectDir) {
  const p = statePath(projectDir, 'skeleton.json');
  if (!fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return raw && typeof raw === 'object' ? raw : null;
  } catch {
    return null;
  }
}

/**
 * 主入口（§5.2）。纯函数：只读盘，不写盘。
 *
 * @param {string} projectDir - 项目目录
 * @param {object} pack - loadPack 返回的 pack
 * @param {object} opts - { skeleton, scope, round }
 * @returns {object} EvalResult
 */
export function evaluate(
  projectDir, pack, { skeleton = null, scope = 'all', round = null, mode: modeOpt = null } = {}
) {
  if (!pack || !Array.isArray(pack.gates) || !Array.isArray(pack.stages)) {
    throw new Error('evaluate 要一个加载好的担架包（含 stages 与 gates）');
  }

  const startedAt = Date.now();
  const skel = skeleton || loadSkeleton(projectDir);
  const instanceVersion = skel ? (skel.instanceVersion ?? 0) : 0;
  const state = loadState(projectDir) || {};
  /**
   * 模式默认跟着项目状态走；调用方显式传了就以传的为准。
   * 传参这条路只给"拿同一个项目按另一个档位算一遍"用（包自测、对拍），
   * 不写回状态文件——它是一次查询的口径，不是项目的设置。
   */
  const mode = normalizeMode(modeOpt || state.mode);

  /**
   * 挂钩装没装：读事件日志有没有过痕迹。
   * 判不出来就当装了——当没装会静默降档一批门禁，那种"少了几条检查"
   * 比"多红几条"难发现得多。
   */
  const eventsPath = statePath(projectDir, 'events.jsonl');
  const hookInstalled = fs.existsSync(eventsPath)
    ? fs.statSync(eventsPath).size > 0
    : false;

  const naGates = Array.isArray(skel?.naGates) ? skel.naGates : [];
  const records = readRecords(projectDir) || [];
  const ctx = createFactContext(projectDir, pack, { round });

  /**
   * 包可以挂两个钩子（native 包的具名导出）：apparentStage 与 upstreamMissing。
   * 没挂就走通用口径，见 computeApparentStage / detectInversion 的说明。
   */
  const hooks = {
    apparentStage: pack.hooks?.apparentStage || null,
    upstreamMissing: pack.hooks?.upstreamMissing || null,
  };

  const env = {
    ctx, hooks, records, instanceVersion, naGates,
    probes: pack.probes instanceof Map ? pack.probes : new Map(),
    probeMiss: pack.probeMiss instanceof Map ? pack.probeMiss : new Map(),
    prompts: pack.prompts || [],
    nativeRules: pack.nativeRules || null,
  };

  const scopedGates = filterByScope(pack.gates, scope, round);
  const hookDependentGates = pack.hookDependentGates || [];

  const acknowledgedWarns = state.notes?.acknowledgedWarns || {};

  const verdicts = scopedGates.map((g) => {
    const sev = effectiveSeverity(g, { mode, hookInstalled, hookDependentGates });
    const v = judgeGate(g, sev, env);
    // 只给 warn 档挂 acked：block 档不允许「知道了就算了」，info 档本来就不出声。
    // 「看过了」不等于「做过了」，所以 acked 一分不加，只影响环节状态。
    if (v.severity === 'warn' && acknowledgedWarns[v.id]) v.acked = true;
    return v;
  });

  const verdictById = new Map(verdicts.map((v) => [v.id, v]));

  /**
   * 环节行只算 scope 里的门禁。
   * scope=gate:1.1 时其余环节自然是空的——这是对的：那次查询问的就是一条。
   */
  const scopedStageIds = new Set(scopedGates.map((g) => g.stage));
  const stageStatuses = pack.stages
    .filter((s) => scopedStageIds.has(s.id))
    .map((s) => stageStatus(s, verdictById, mode));

  const currentStage = findCurrentStage(stageStatuses);

  /**
   * 还没走到的环节，不该显示成"卡住"。
   * 环节七的门禁在环节二当然是不通过的，把它标红只会淹掉真正的问题。
   * 留一个环节的余量（current+1）：下一步该干的活要能看见。
   */
  const notYet = new Set();
  for (const s of stageStatuses) {
    if (s.id > currentStage + 1 && s.state !== 'passed') {
      s.state = 'notyet';
      notYet.add(s.id);
    }
  }

  // 这个模式下算数的门禁。counts 每个桶都从这儿过一遍，保证分子分母同一套口径
  const active = verdicts.filter((v) => isActive(v.severity, mode));
  const now = (v) => !notYet.has(v.stage);

  const apparentStage = computeApparentStage(env, verdicts, stageStatuses);
  const inversionGap = Math.max(0, apparentStage - currentStage);

  const warnings = [
    ...detectInversion(env, inversionGap, currentStage, apparentStage, verdictById, scopedGates),
    ...detectRoundWarnings(round),
  ];

  const hardFailsNow = active.filter((v) => v.severity === 'block' && v.r === 'fail' && now(v));
  const promptsPending = findPromptsPending(pack.prompts, state.answers || {}, verdictById, notYet);

  const counts = {
    total: active.length,
    totalAll: verdicts.length,
    muted: verdicts.length - active.length,
    pass: active.filter((v) => v.r === 'pass').length,
    na: active.filter((v) => v.r === 'na').length,
    fix: active.filter((v) => v.r === 'fix').length,
    fail: active.filter((v) => v.r === 'fail').length,
    ask: active.filter((v) => v.r === 'ask').length,
    // 现在该管的。看板上写"55 条不通过"没有意义——环节七的门禁在环节一
    // 当然不通过，那不是待办事项。
    failNow: active.filter((v) => v.r === 'fail' && now(v)).length,
    fixNow: active.filter((v) => v.r === 'fix' && now(v)).length,
    askNow: active.filter((v) => v.r === 'ask' && now(v)).length,
  };

  return {
    dir: projectDir,
    gates: verdicts,
    stages: stageStatuses,
    counts,
    inversionGap,
    currentStage,
    apparentStage,
    warnings,
    hardFailsNow,
    promptsPending,
    mode,
    hookInstalled,
    instanceVersion,
    // 哪些环节还没走到。下游要按 Now 口径过滤门禁，就得知道这个集合，
    // 不能各自再猜一遍——猜法不一致时两处的"待确认 N 条"会对不上。
    notYetStages: [...notYet].sort((a, b) => a - b),
    scope,
    durationMs: Date.now() - startedAt,
    factsFingerprint: factsFingerprint(ctx, []),
  };
}
