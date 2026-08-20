/**
 * evaluate.js 测试
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { evaluate, VERDICT_LABEL } from '../src/kernel/evaluate.js';

describe('evaluate', () => {
  // 构造最小测试环境
  const createContext = () => ({
    stages: [
      { id: 1, name: '环节1', gates: [{ id: '1.1' }, { id: '1.2' }] },
      { id: 2, name: '环节2', gates: [{ id: '2.1' }] },
    ],
    gates: [
      { id: '1.1', stage: 1, severity: 'block', desc: '测试门禁1.1' },
      { id: '1.2', stage: 1, severity: 'warn', desc: '测试门禁1.2' },
      { id: '2.1', stage: 2, severity: 'block', desc: '测试门禁2.1' },
    ],
    rules: {
      '1.1': (facts) => ({ r: 'pass', detail: '通过' }),
      '1.2': (facts) => ({ r: 'pass', detail: '通过' }),
      '2.1': (facts) => ({ r: 'fail', detail: '不通过' }),
    },
    gateById: new Map([
      ['1.1', { id: '1.1', stage: 1, severity: 'block' }],
      ['1.2', { id: '1.2', stage: 1, severity: 'warn' }],
      ['2.1', { id: '2.1', stage: 2, severity: 'block' }],
    ]),
    stageById: new Map([
      [1, { id: 1, name: '环节1' }],
      [2, { id: 2, name: '环节2' }],
    ]),
  });

  const createFacts = (overrides = {}) => ({
    dir: '/test/project',
    name: 'test-project',
    scannedAt: '2026-08-20T00:00:00Z',
    local: {},
    agent: null,
    ...overrides,
  });

  it('返回完整的 EvalResult 结构', () => {
    const context = createContext();
    const facts = createFacts();
    const result = evaluate(facts, context);

    assert.ok(result);
    assert.strictEqual(result.dir, '/test/project');
    assert.strictEqual(result.name, 'test-project');
    assert.strictEqual(result.mode, 'mvp'); // 默认模式
    assert.ok(Array.isArray(result.stages));
    assert.ok(Array.isArray(result.verdicts));
    assert.ok(result.verdictById instanceof Map);
    assert.ok(result.counts);
  });

  it('判定门禁结果', () => {
    const context = createContext();
    const facts = createFacts();
    const result = evaluate(facts, context);

    const v11 = result.verdictById.get('1.1');
    const v21 = result.verdictById.get('2.1');

    assert.strictEqual(v11.r, 'pass');
    assert.strictEqual(v21.r, 'fail');
  });

  it('计算环节状态', () => {
    const context = createContext();
    const facts = createFacts();
    const result = evaluate(facts, context);

    const stage1 = result.stages.find(s => s.id === 1);
    const stage2 = result.stages.find(s => s.id === 2);

    assert.strictEqual(stage1.state, 'passed'); // 环节1所有门禁通过
    assert.strictEqual(stage2.state, 'blocked'); // 环节2有失败的 block 门禁
  });

  it('识别当前环节', () => {
    const context = createContext();
    const facts = createFacts();
    const result = evaluate(facts, context);

    assert.strictEqual(result.currentStage, 2); // 第一个未通过的环节
  });

  it('处理 naGates 裁剪', () => {
    const context = createContext();
    const facts = createFacts({
      local: { naGates: ['1.2'] },
    });
    const result = evaluate(facts, context);

    const v12 = result.verdictById.get('1.2');
    assert.strictEqual(v12.r, 'na');
  });

  it('block 门禁不允许被 na', () => {
    const context = createContext();
    const facts = createFacts({
      local: { naGates: ['1.1'] }, // 尝试 na 一个 block 门禁
    });
    const result = evaluate(facts, context);

    const v11 = result.verdictById.get('1.1');
    assert.notStrictEqual(v11.r, 'na'); // block 不能被 na
  });

  it('规则不存在时返回 ask', () => {
    const context = createContext();
    context.rules = {}; // 清空规则
    const facts = createFacts();
    const result = evaluate(facts, context);

    const v11 = result.verdictById.get('1.1');
    assert.strictEqual(v11.r, 'ask');
  });

  it('规则抛错时返回 ask', () => {
    const context = createContext();
    context.rules['1.1'] = () => {
      throw new Error('规则出错');
    };
    const facts = createFacts();
    const result = evaluate(facts, context);

    const v11 = result.verdictById.get('1.1');
    assert.strictEqual(v11.r, 'ask');
    assert.ok(v11.detail.includes('工具自己出错了'));
  });

  it('计算 counts 统计', () => {
    const context = createContext();
    const facts = createFacts();
    const result = evaluate(facts, context);

    assert.strictEqual(result.counts.total, 3); // mvp 模式下三个门禁都算数
    assert.strictEqual(result.counts.pass, 2);
    assert.strictEqual(result.counts.fail, 1);
  });

  it('learning 模式下 warn 不算数', () => {
    const context = createContext();
    const facts = createFacts({ local: { mode: 'learning' } });
    const result = evaluate(facts, context);

    // learning 模式下 warn 降为 info，不算数
    assert.strictEqual(result.counts.total, 2); // 只有两个 block
  });

  it('处理 acknowledgedWarns', () => {
    const context = createContext();
    const facts = createFacts({
      local: {
        acknowledgedWarns: { '1.2': '2026-08-20' },
      },
    });
    const result = evaluate(facts, context);

    const v12 = result.verdictById.get('1.2');
    assert.strictEqual(v12.acked, '2026-08-20');
  });

  it('识别挂钩是否安装', () => {
    const context = createContext();
    const factsWithHook = createFacts({ agent: { count: 5 } });
    const factsNoHook = createFacts({ agent: null });

    const resultWith = evaluate(factsWithHook, context);
    const resultNo = evaluate(factsNoHook, context);

    assert.strictEqual(resultWith.hookInstalled, true);
    assert.strictEqual(resultNo.hookInstalled, false);
  });
});
