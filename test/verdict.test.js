/**
 * verdict.js 测试（§5.3 折算 + §5.4 协议形状）。
 *
 * 这里用手搓的 EvalResult：verdict.js 只做折算和组装，
 * 不读盘也不认识包，喂给它什么就该算出什么。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { computeVerdict, buildVerdict, VERDICT_SAY } from '../src/kernel/verdict.js';

const PACK = { meta: { name: 'test-pack', version: '1.0.0' } };

/** 一个全绿的 EvalResult 底子，用 overrides 往上改。 */
function er(overrides = {}) {
  return {
    dir: '/tmp/p',
    gates: [],
    stages: [],
    counts: {
      total: 3, totalAll: 3, muted: 0,
      pass: 3, na: 0, fix: 0, fail: 0, ask: 0,
      failNow: 0, fixNow: 0, askNow: 0,
    },
    inversionGap: 0,
    currentStage: 1,
    apparentStage: 1,
    warnings: [],
    hardFailsNow: [],
    promptsPending: [],
    mode: 'mvp',
    hookInstalled: true,
    instanceVersion: 0,
    notYetStages: [],
    scope: 'all',
    durationMs: 7,
    factsFingerprint: 'abc123',
    ...overrides,
  };
}

describe('computeVerdict（§5.3 写死的顺序）', () => {
  it('全绿 → pass', () => {
    assert.strictEqual(computeVerdict(er()), 'pass');
  });

  it('有拦路的没过 → blocked', () => {
    const r = er({
      hardFailsNow: [{ id: '2.1', stage: 2, severity: 'block', say: '缺文件' }],
      counts: { ...er().counts, fail: 1, failNow: 1, pass: 2 },
    });
    assert.strictEqual(computeVerdict(r), 'blocked');
  });

  it('有阻断提问组 → blocked（哪怕一条门禁都没红）', () => {
    const r = er({
      promptsPending: [{ id: '1.2', stage: 1, lead: '先说清', asks: [{ key: 'k', q: '过了吗？' }] }],
      counts: { ...er().counts, ask: 1, askNow: 1, pass: 2 },
    });
    assert.strictEqual(computeVerdict(r), 'blocked');
  });

  it('只有非拦路的没过 → fail', () => {
    const r = er({ counts: { ...er().counts, fail: 1, failNow: 1, pass: 2 } });
    assert.strictEqual(computeVerdict(r), 'fail');
  });

  it('只剩待确认 → needs-human', () => {
    const r = er({ counts: { ...er().counts, ask: 1, askNow: 1, pass: 2 } });
    assert.strictEqual(computeVerdict(r), 'needs-human');
  });

  it('拦路优先于待确认：两样都有时报 blocked', () => {
    const r = er({
      hardFailsNow: [{ id: '2.1', stage: 2, severity: 'block', say: 'x' }],
      counts: { ...er().counts, fail: 1, failNow: 1, ask: 1, askNow: 1, pass: 1 },
    });
    assert.strictEqual(computeVerdict(r), 'blocked');
  });

  it('还没走到的环节红了不算数：failNow 为 0 时仍是 pass', () => {
    const r = er({
      counts: { ...er().counts, fail: 5, failNow: 0, pass: 3 },
      notYetStages: [7, 8],
    });
    assert.strictEqual(computeVerdict(r), 'pass');
  });

  it('四个结论都有大白话', () => {
    for (const k of ['pass', 'fail', 'blocked', 'needs-human']) {
      assert.strictEqual(typeof VERDICT_SAY[k], 'string');
      assert.ok(VERDICT_SAY[k].length > 0);
    }
  });
});

describe('buildVerdict（§5.4 是唯一事实源）', () => {
  const AT = '2026-08-20T00:00:00.000Z';

  it('顶层键与 §5.4 逐个对齐，不多不少', () => {
    const v = buildVerdict(er(), PACK, { evaluatedAt: AT });
    assert.deepStrictEqual(Object.keys(v).sort(), [
      'blockers', 'counts', 'humanPending', 'instanceVersion',
      'inversion', 'pack', 'trace', 'verdict', 'warnings',
    ]);
  });

  it('counts 只有 §5.4 的八个桶', () => {
    const v = buildVerdict(er(), PACK, { evaluatedAt: AT });
    assert.deepStrictEqual(Object.keys(v.counts).sort(), [
      'ask', 'askNow', 'fail', 'failNow', 'fix', 'fixNow', 'na', 'pass',
    ]);
  });

  it('trace 四个字段齐全，时间由调用层给', () => {
    const v = buildVerdict(er(), PACK, { evaluatedAt: AT });
    assert.deepStrictEqual(v.trace, {
      evaluatedAt: AT, scope: 'all', durationMs: 7, factsFingerprint: 'abc123',
    });
  });

  it('包名版本从 pack 上取', () => {
    const v = buildVerdict(er(), PACK, { evaluatedAt: AT });
    assert.deepStrictEqual(v.pack, { name: 'test-pack', version: '1.0.0' });
  });

  it('不倒挂时 inversion 是 null，不是省略也不是 0', () => {
    const v = buildVerdict(er(), PACK, { evaluatedAt: AT });
    assert.strictEqual(v.inversion, null);
  });

  it('倒挂时 inversion 把两个环节号都说出来', () => {
    const r = er({ inversionGap: 7, currentStage: 1, apparentStage: 8 });
    const v = buildVerdict(r, PACK, { evaluatedAt: AT });
    assert.strictEqual(v.inversion.gap, 7);
    assert.strictEqual(v.inversion.currentStage, 1);
    assert.strictEqual(v.inversion.apparentStage, 8);
    assert.match(v.inversion.say, /8/);
    assert.match(v.inversion.say, /1/);
  });

  it('blockers = hardFailsNow 展开，带怎么办', () => {
    const r = er({
      hardFailsNow: [
        { id: '2.1', stage: 2, severity: 'block', say: '流程说明里少了谁做什么', how: '打开流程说明补上' },
      ],
      counts: { ...er().counts, fail: 1, failNow: 1, pass: 2 },
    });
    const v = buildVerdict(r, PACK, { evaluatedAt: AT });
    assert.strictEqual(v.blockers.length, 1);
    assert.deepStrictEqual(v.blockers[0], {
      id: '2.1', stage: 2, severity: 'block',
      say: '流程说明里少了谁做什么', how: '打开流程说明补上',
    });
  });

  it('有凭据时 blockers 带 evidence，没有时不出现这个键', () => {
    const withEv = buildVerdict(er({
      hardFailsNow: [{ id: '2.1', stage: 2, severity: 'block', say: 'x', how: 'y', evidence: '流程说明.md' }],
    }), PACK, { evaluatedAt: AT });
    assert.strictEqual(withEv.blockers[0].evidence, '流程说明.md');

    const noEv = buildVerdict(er({
      hardFailsNow: [{ id: '2.1', stage: 2, severity: 'block', say: 'x', how: 'y' }],
    }), PACK, { evaluatedAt: AT });
    assert.ok(!Object.hasOwn(noEv.blockers[0], 'evidence'));
  });

  it('humanPending 覆盖每一条 askNow 门禁，不只是有提问组的那些', () => {
    const r = er({
      gates: [
        { id: '1.2', stage: 1, r: 'ask', severity: 'block', say: '要你确认评审过了' },
        { id: '2.2', stage: 2, r: 'ask', severity: 'warn', say: '要你确认方案评审过了' },
      ],
      promptsPending: [
        { id: '1.2', stage: 1, lead: '需求评审是第一关', asks: [{ key: 'approved', q: '过了吗？', why: '没过不能走' }] },
      ],
      counts: { ...er().counts, ask: 2, askNow: 2, pass: 1 },
    });
    const v = buildVerdict(r, PACK, { evaluatedAt: AT });
    assert.deepStrictEqual(v.humanPending.map((h) => h.id).sort(), ['1.2', '2.2']);
    const p12 = v.humanPending.find((h) => h.id === '1.2');
    assert.strictEqual(p12.asks.length, 1);
    assert.strictEqual(p12.asks[0].key, 'approved');
  });

  it('还没走到的环节的待确认项不列进 humanPending', () => {
    const r = er({
      gates: [{ id: '7.1', stage: 7, r: 'ask', severity: 'block', say: '上线前要你确认' }],
      notYetStages: [7],
      counts: { ...er().counts, ask: 1, askNow: 0, pass: 3 },
    });
    const v = buildVerdict(r, PACK, { evaluatedAt: AT });
    assert.strictEqual(v.humanPending.length, 0);
  });

  it('warnings 只留 kind/severity/headline 三个字段', () => {
    const r = er({
      warnings: [{ kind: 'inversion', severity: 'warn', headline: '顺序错了', missing: [{ what: 'x' }] }],
    });
    const v = buildVerdict(r, PACK, { evaluatedAt: AT });
    assert.deepStrictEqual(Object.keys(v.warnings[0]).sort(), ['headline', 'kind', 'severity']);
  });

  it('能 JSON 序列化（协议要能过网线）', () => {
    const v = buildVerdict(er(), PACK, { evaluatedAt: AT });
    const round = JSON.parse(JSON.stringify(v));
    assert.deepStrictEqual(round, v);
  });
});
