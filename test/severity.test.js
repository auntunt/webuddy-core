/**
 * severity.js 测试
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  MODES,
  normalizeMode,
  showsInfo,
  isActive,
  effectiveSeverity,
  effectiveSeverityMap,
} from '../src/kernel/severity.js';

describe('severity', () => {
  describe('normalizeMode', () => {
    it('识别有效模式', () => {
      assert.strictEqual(normalizeMode('learning'), 'learning');
      assert.strictEqual(normalizeMode('mvp'), 'mvp');
      assert.strictEqual(normalizeMode('full'), 'full');
    });

    it('未知模式默认为 mvp', () => {
      assert.strictEqual(normalizeMode('invalid'), 'mvp');
      assert.strictEqual(normalizeMode(null), 'mvp');
      assert.strictEqual(normalizeMode(undefined), 'mvp');
    });
  });

  describe('showsInfo', () => {
    it('只有 full 模式显示 info', () => {
      assert.strictEqual(showsInfo('full'), true);
      assert.strictEqual(showsInfo('mvp'), false);
      assert.strictEqual(showsInfo('learning'), false);
    });
  });

  describe('isActive', () => {
    it('block 和 warn 在所有模式下都算数', () => {
      assert.strictEqual(isActive('block', 'learning'), true);
      assert.strictEqual(isActive('block', 'mvp'), true);
      assert.strictEqual(isActive('block', 'full'), true);
      assert.strictEqual(isActive('warn', 'learning'), true);
      assert.strictEqual(isActive('warn', 'mvp'), true);
      assert.strictEqual(isActive('warn', 'full'), true);
    });

    it('info 只在 full 模式算数', () => {
      assert.strictEqual(isActive('info', 'full'), true);
      assert.strictEqual(isActive('info', 'mvp'), false);
      assert.strictEqual(isActive('info', 'learning'), false);
    });
  });

  describe('effectiveSeverity', () => {
    it('learning 模式：block 保持，warn/info 降为 info', () => {
      const blockGate = { id: '1.1', severity: 'block' };
      const warnGate = { id: '1.2', severity: 'warn' };
      const infoGate = { id: '1.3', severity: 'info' };

      assert.strictEqual(effectiveSeverity(blockGate, { mode: 'learning' }), 'block');
      assert.strictEqual(effectiveSeverity(warnGate, { mode: 'learning' }), 'info');
      assert.strictEqual(effectiveSeverity(infoGate, { mode: 'learning' }), 'info');
    });

    it('mvp 和 full 模式：保持原档位', () => {
      const blockGate = { id: '1.1', severity: 'block' };
      const warnGate = { id: '1.2', severity: 'warn' };
      const infoGate = { id: '1.3', severity: 'info' };

      assert.strictEqual(effectiveSeverity(blockGate, { mode: 'mvp' }), 'block');
      assert.strictEqual(effectiveSeverity(warnGate, { mode: 'mvp' }), 'warn');
      assert.strictEqual(effectiveSeverity(infoGate, { mode: 'mvp' }), 'info');

      assert.strictEqual(effectiveSeverity(blockGate, { mode: 'full' }), 'block');
      assert.strictEqual(effectiveSeverity(warnGate, { mode: 'full' }), 'warn');
      assert.strictEqual(effectiveSeverity(infoGate, { mode: 'full' }), 'info');
    });

    // 哪些门禁"离了挂钩就没法查"是包自己说的，内核不认识任何具体门禁号。
    const hookDependentGates = ['5.2', '5.3'];

    it('挂钩依赖门禁：没装挂钩时降为 info', () => {
      const hookGate = { id: '5.2', severity: 'block' };

      assert.strictEqual(
        effectiveSeverity(hookGate, { mode: 'mvp', hookInstalled: true, hookDependentGates }),
        'block'
      );
      assert.strictEqual(
        effectiveSeverity(hookGate, { mode: 'mvp', hookInstalled: false, hookDependentGates }),
        'info'
      );
    });

    it('包没说哪些门禁依赖挂钩时，不擅自降档', () => {
      const hookGate = { id: '5.2', severity: 'block' };

      assert.strictEqual(effectiveSeverity(hookGate, { mode: 'mvp', hookInstalled: false }), 'block');
    });

    it('挂钩降档优先于模式降档', () => {
      const hookGate = { id: '5.3', severity: 'block' };

      // learning 模式 + 没装挂钩：挂钩降档优先
      assert.strictEqual(
        effectiveSeverity(hookGate, { mode: 'learning', hookInstalled: false, hookDependentGates }),
        'info'
      );
    });

    it('缺少 severity 字段时抛错', () => {
      assert.throws(() => effectiveSeverity({ id: '1.1' }), /缺 severity 字段/);
      assert.throws(() => effectiveSeverity(null), /缺 severity 字段/);
    });
  });

  describe('effectiveSeverityMap', () => {
    it('批量计算所有门禁的有效档位', () => {
      const gates = [
        { id: '1.1', severity: 'block' },
        { id: '1.2', severity: 'warn' },
        { id: '5.2', severity: 'block' },
      ];

      const map = effectiveSeverityMap(gates, {
        mode: 'learning',
        hookInstalled: false,
        hookDependentGates: ['5.2'],
      });

      assert.strictEqual(map.get('1.1'), 'block');
      assert.strictEqual(map.get('1.2'), 'info'); // learning 降档
      assert.strictEqual(map.get('5.2'), 'info'); // 挂钩降档
    });
  });
});
