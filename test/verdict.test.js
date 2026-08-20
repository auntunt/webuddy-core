/**
 * verdict.js 测试
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { computeVerdict, isComplete, getNextAction } from '../src/kernel/verdict.js';

describe('verdict', () => {
  // 创建测试用的 evalResult
  const createEvalResult = (overrides = {}) => ({
    dir: '/test/project',
    name: 'test-project',
    scannedAt: '2026-08-20T00:00:00Z',
    currentStage: 2,
    mode: 'mvp',
    hookInstalled: true,
    stages: [
      { id: 1, name: '环节1', state: 'passed', total: 2, passed: 2, percent: 100, fails: [], fixes: [], asks: [], hardFails: [], softFails: [] },
      { id: 2, name: '环节2', state: 'blocked', total: 3, passed: 1, percent: 33, fails: ['2.1'], fixes: [], asks: [], hardFails: ['2.1'], softFails: [] },
      { id: 3, name: '环节3', state: 'notyet', total: 2, passed: 0, percent: 0, fails: [], fixes: [], asks: [], hardFails: [], softFails: [] },
    ],
    verdicts: [
      { id: '1.1', r: 'pass', severity: 'block', gate: { stage: 1 } },
      { id: '1.2', r: 'pass', severity: 'warn', gate: { stage: 1 } },
      { id: '2.1', r: 'fail', severity: 'block', detail: '不通过原因', gate: { stage: 2 } },
      { id: '2.2', r: 'pass', severity: 'warn', gate: { stage: 2 } },
      { id: '2.3', r: 'fix', severity: 'warn', gate: { stage: 2 } },
    ],
    verdictById: new Map(),
    counts: {
      total: 5,
      totalAll: 5,
      muted: 0,
      pass: 3,
      na: 0,
      fix: 1,
      fail: 1,
      ask: 0,
      failNow: 1,
      fixNow: 1,
      askNow: 0,
      blockingNow: 1,
    },
    adapt: { adaptedAt: null, naGates: [], reasoning: '', description: '' },
    ...overrides,
  });

  describe('computeVerdict', () => {
    it('识别 blocked 状态', () => {
      const evalResult = createEvalResult();
      evalResult.verdictById = new Map(evalResult.verdicts.map(v => [v.id, v]));

      const verdict = computeVerdict(evalResult);

      assert.strictEqual(verdict.status, 'blocked');
      assert.ok(verdict.message.includes('阻断'));
      assert.strictEqual(verdict.canProceed, false);
      assert.strictEqual(verdict.currentStage, 2);
      assert.strictEqual(verdict.stageName, '环节2');
      assert.strictEqual(verdict.blocking, 1);
    });

    it('识别 passed 状态', () => {
      const evalResult = createEvalResult({ currentStage: 1 });
      evalResult.verdictById = new Map(evalResult.verdicts.map(v => [v.id, v]));

      const verdict = computeVerdict(evalResult);

      assert.strictEqual(verdict.status, 'passed');
      assert.ok(verdict.message.includes('通过'));
      assert.strictEqual(verdict.canProceed, true);
    });

    it('识别 fixing 状态', () => {
      const evalResult = createEvalResult();
      evalResult.stages[1].state = 'fixing';
      evalResult.stages[1].hardFails = []; // 没有 hard fails
      evalResult.verdictById = new Map(evalResult.verdicts.map(v => [v.id, v]));

      const verdict = computeVerdict(evalResult);

      assert.strictEqual(verdict.status, 'fixing');
      assert.ok(verdict.message.includes('待改进'));
      assert.strictEqual(verdict.canProceed, true); // 没有 hard fails 可以继续
    });

    it('识别 waiting 状态', () => {
      const evalResult = createEvalResult();
      evalResult.stages[1].state = 'waiting';
      evalResult.counts.askNow = 2;
      evalResult.verdictById = new Map(evalResult.verdicts.map(v => [v.id, v]));

      const verdict = computeVerdict(evalResult);

      assert.strictEqual(verdict.status, 'waiting');
      assert.ok(verdict.message.includes('待确认'));
      assert.strictEqual(verdict.canProceed, false);
    });

    it('计算进度百分比', () => {
      const evalResult = createEvalResult();
      evalResult.verdictById = new Map(evalResult.verdicts.map(v => [v.id, v]));

      const verdict = computeVerdict(evalResult);

      assert.strictEqual(verdict.progress, 60); // 3/5 = 60%
    });

    it('返回完整统计信息', () => {
      const evalResult = createEvalResult();
      evalResult.verdictById = new Map(evalResult.verdicts.map(v => [v.id, v]));

      const verdict = computeVerdict(evalResult);

      assert.ok(verdict.stats);
      assert.strictEqual(verdict.stats.total, 5);
      assert.strictEqual(verdict.stats.pass, 3);
      assert.strictEqual(verdict.stats.fail, 1);
      assert.strictEqual(verdict.stats.fix, 1);
      assert.strictEqual(verdict.stats.ask, 0);
    });
  });

  describe('isComplete', () => {
    it('所有环节通过时返回 true', () => {
      const evalResult = createEvalResult();
      evalResult.stages = [
        { id: 1, state: 'passed' },
        { id: 2, state: 'passed' },
        { id: 3, state: 'notyet' }, // notyet 不算未完成
      ];

      assert.strictEqual(isComplete(evalResult), true);
    });

    it('有环节未通过时返回 false', () => {
      const evalResult = createEvalResult();

      assert.strictEqual(isComplete(evalResult), false);
    });

    it('blocked 状态未完成', () => {
      const evalResult = createEvalResult();
      evalResult.stages[1].state = 'blocked';

      assert.strictEqual(isComplete(evalResult), false);
    });
  });

  describe('getNextAction', () => {
    it('返回第一个未通过的门禁', () => {
      const evalResult = createEvalResult();
      evalResult.verdictById = new Map(evalResult.verdicts.map(v => [v.id, v]));

      const action = getNextAction(evalResult);

      assert.ok(action);
      assert.strictEqual(action.gateId, '2.1'); // 第一个 fail
      assert.strictEqual(action.stage, 2);
      assert.strictEqual(action.stageName, '环节2');
      assert.strictEqual(action.action, '不通过，需要修正');
      assert.strictEqual(action.detail, '不通过原因');
    });

    it('优先级: fail > fix > ask', () => {
      const evalResult = createEvalResult();
      evalResult.stages[1].fails = [];
      evalResult.stages[1].fixes = ['2.3'];
      evalResult.stages[1].asks = ['2.4'];
      evalResult.verdictById = new Map([
        ['2.3', { id: '2.3', r: 'fix', detail: '待改进' }],
        ['2.4', { id: '2.4', r: 'ask', detail: '待确认' }],
      ]);

      const action = getNextAction(evalResult);

      assert.strictEqual(action.gateId, '2.3'); // fix 优先于 ask
      assert.strictEqual(action.action, '待改进');
    });

    it('当前环节全通过时返回 null', () => {
      const evalResult = createEvalResult({ currentStage: 1 });
      evalResult.verdictById = new Map(evalResult.verdicts.map(v => [v.id, v]));

      const action = getNextAction(evalResult);

      assert.strictEqual(action, null);
    });

    it('无效环节返回 null', () => {
      const evalResult = createEvalResult({ currentStage: 999 });
      evalResult.verdictById = new Map(evalResult.verdicts.map(v => [v.id, v]));

      const action = getNextAction(evalResult);

      assert.strictEqual(action, null);
    });
  });
});
