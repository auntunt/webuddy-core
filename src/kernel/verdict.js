/**
 * 裁决：EvalResult → 协议对象。这是协议的唯一出口。
 *
 * 为什么只许有一条出口：CLI 的 --json 和 HTTP 的响应必须逐字节同构。
 * 各拼各的话，两边迟早分家——而分家的那天，CI 里的 diff 会一直是绿的，
 * 因为它只看自己那一边。
 *
 * 折算规则写死（§5.3），全部用 Now 口径（排除还没走到的环节）：
 *   hardFailsNow 非空 或 promptsPending 非空  → 'blocked'
 *   counts.failNow > 0                        → 'fail'
 *   counts.askNow  > 0                        → 'needs-human'
 *   否则                                       → 'pass'
 */

/** 四个结论的大白话。人读界面用这个，--json 里不替换。 */
export const VERDICT_SAY = {
  pass: '这一步的检查都过了，可以往下走',
  fail: '有检查没过，先改完再往下走',
  blocked: '有拦路的问题，改完才能往下走',
  'needs-human': '有几条工具判不了，要你自己看一眼再确认',
};

/**
 * 折算总结论（§5.3）。写死的顺序，不许按项目情况调整。
 *
 * 顺序本身有意义：拦路的比不过的急，不过的比"等人看"急。
 * 反过来排的话，一个既有拦路项又有待确认项的项目会被报成"等你确认"，
 * 人去确认完了发现还是走不了——他会以为工具骗了他。
 */
export function computeVerdict(evalResult) {
  const c = evalResult.counts || {};
  if ((evalResult.hardFailsNow || []).length > 0) return 'blocked';
  if ((evalResult.promptsPending || []).length > 0) return 'blocked';
  if ((c.failNow || 0) > 0) return 'fail';
  if ((c.askNow || 0) > 0) return 'needs-human';
  return 'pass';
}

/**
 * 倒挂的一句话。gap 为 0 时返回 null（协议里 inversion 允许为 null）。
 *
 * 说人话的关键是把两个环节号都说出来：只说"倒挂了"没人知道该回去干什么。
 */
function inversionBlock(evalResult) {
  const gap = evalResult.inversionGap || 0;
  if (gap <= 0) return null;
  const w = (evalResult.warnings || []).find((x) => x.kind === 'inversion');
  return {
    gap,
    currentStage: evalResult.currentStage,
    apparentStage: evalResult.apparentStage,
    say: w?.headline
      || `已经干到第 ${evalResult.apparentStage} 步，但要回去补第 ${evalResult.currentStage} 步`,
  };
}

/**
 * 组装协议对象（§5.4 是唯一事实源）。
 *
 * @param {object} evalResult - evaluate() 的返回值
 * @param {object} pack - loadPack 返回的 pack（取 name/version）
 * @param {object} opts - { evaluatedAt } 由调用层给时间，保持本函数可测
 * @returns {object} Verdict
 */
export function buildVerdict(evalResult, pack, { evaluatedAt = null } = {}) {
  const verdict = computeVerdict(evalResult);
  const c = evalResult.counts || {};

  return {
    verdict,
    pack: {
      name: pack?.meta?.name || '',
      version: pack?.meta?.version || '',
    },
    instanceVersion: evalResult.instanceVersion ?? 0,
    counts: {
      pass: c.pass || 0,
      na: c.na || 0,
      fix: c.fix || 0,
      fail: c.fail || 0,
      ask: c.ask || 0,
      failNow: c.failNow || 0,
      fixNow: c.fixNow || 0,
      askNow: c.askNow || 0,
    },
    inversion: inversionBlock(evalResult),
    // = hardFailsNow 展开。注意不叫 blockers 的那个别的东西：
    // 阻断提问组在 humanPending 里，两者混叫过一次就再也分不开了。
    blockers: (evalResult.hardFailsNow || []).map((v) => ({
      id: v.id,
      stage: v.stage,
      severity: v.severity,
      say: v.say || '',
      how: v.how || '',
      ...(v.evidence ? { evidence: v.evidence } : {}),
    })),
    humanPending: buildHumanPending(evalResult),
    warnings: (evalResult.warnings || []).map((w) => ({
      kind: w.kind,
      severity: w.severity,
      headline: w.headline,
    })),
    trace: {
      evaluatedAt: evaluatedAt || new Date().toISOString(),
      scope: evalResult.scope || 'all',
      durationMs: evalResult.durationMs ?? 0,
      factsFingerprint: evalResult.factsFingerprint || '',
    },
  };
}

/**
 * humanPending = askNow 的门禁，连同它的提问组（§5.4）。
 *
 * 阻断提问组（promptsPending）一定在里面；此外每条 askNow 门禁都要出现，
 * 哪怕它没有提问组——不然界面上"待确认 3 条"却只列出 1 条，
 * 人会去找那两条找不到的。
 */
function buildHumanPending(evalResult) {
  // 哪些条目要交文件。这一位是包声明的（SKILL.md 的「需要凭据:」），
  // 从门禁结论里取，两条组装路径（阻断提问组 / 光秃秃的 ask 门禁）共用同一份。
  const wantsFile = new Set(
    (evalResult.gates || []).filter((v) => v.needsEvidence).map((v) => v.id)
  );
  const withFile = (o) => (wantsFile.has(o.id) ? { ...o, needsEvidence: true } : o);

  const byId = new Map();
  for (const p of evalResult.promptsPending || []) {
    byId.set(p.id, withFile({
      id: p.id, stage: p.stage, lead: p.lead || '', asks: p.asks || [],
    }));
  }

  const notYet = new Set(evalResult.notYetStages || []);
  for (const v of evalResult.gates || []) {
    if (v.r !== 'ask') continue;
    // Now 口径：还没走到的环节的待确认项不列出来。
    // 列了的话，一个刚开工的项目第一屏就是几十条"等你确认"，
    // 而其中绝大多数要等好几周才轮得到——这跟没提示一样没用。
    if (notYet.has(v.stage)) continue;
    if (byId.has(v.id)) continue;
    byId.set(v.id, withFile({
      id: v.id,
      stage: v.stage,
      lead: v.say || '',
      asks: [],
    }));
  }

  return [...byId.values()].sort((a, b) => String(a.id).localeCompare(String(b.id), 'en', { numeric: true }));
}
