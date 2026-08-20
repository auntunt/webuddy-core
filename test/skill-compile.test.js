import { test } from 'node:test';
import assert from 'node:assert';
import { compileSkill } from '../src/kernel/skill-compile.js';

const MINIMAL_SKILL = `---
name: test
---

## 环节1：需求
- 目的：明确需求
- 产物：需求文档

### 1.1 需求文档存在
判据类型: auto

### 1.2 需求已评审
判据类型: human
提问: 评审通过了吗？

## 环节2：开发
- 目的：编写代码
- 产物：源代码

### 2.1 代码提交
判据类型: auto

### 2.2 代码评审
判据类型: human

## 环节3：测试
- 目的：保证质量
- 产物：测试报告

### 3.1 测试通过
判据类型: auto

### 3.2 测试覆盖率
判据类型: auto
`;

test('compileSkill 解析基本结构', () => {
  const result = compileSkill(MINIMAL_SKILL);
  assert.strictEqual(result.errors.length, 0);
  assert.strictEqual(result.stages.length, 3);
  assert.strictEqual(result.gates.length, 6);
});

test('compileSkill 提取环节信息', () => {
  const result = compileSkill(MINIMAL_SKILL);
  const stage1 = result.stages[0];
  assert.strictEqual(stage1.id, 1);
  assert.strictEqual(stage1.name, '需求');
  assert.strictEqual(stage1.oneLiner, '明确需求');
  assert.ok(stage1.artifacts.includes('需求文档'));
});

test('compileSkill 提取门禁信息', () => {
  const result = compileSkill(MINIMAL_SKILL);
  const gate = result.gates.find((g) => g.id === '1.1');
  assert.ok(gate);
  assert.strictEqual(gate.stage, 1);
  assert.strictEqual(gate.mode, 'auto');
  assert.strictEqual(gate.desc, '需求文档存在');
});

test('compileSkill 识别 human 门禁', () => {
  const result = compileSkill(MINIMAL_SKILL);
  const humanGates = result.gates.filter((g) => g.mode === 'human');
  assert.strictEqual(humanGates.length, 2);
});

test('compileSkill human 门禁生成缺省提问组', () => {
  const result = compileSkill(MINIMAL_SKILL);
  const gate = result.gates.find((g) => g.id === '1.2');
  assert.ok(gate.defaultPrompt);
  assert.strictEqual(gate.defaultPrompt.id, '1.2');
  assert.ok(gate.defaultPrompt.asks.length > 0);
});

test('compileSkill 识别严格度', () => {
  const skill = `---
name: test
---

## 环节1：需求
- 目的：明确需求
- 产物：需求文档

### 1.1 必须有需求文档
判据类型: auto

### 1.2 设计方案
判据类型: auto
严格度: block

### 1.3 可选的文档
判据类型: auto

## 环节2：开发
- 目的：开发
- 产物：代码

### 2.1 代码
判据类型: auto

### 2.2 测试
判据类型: auto

## 环节3：测试
- 目的：测试
- 产物：报告

### 3.1 测试通过
判据类型: auto

### 3.2 覆盖率
判据类型: auto
`;

  const result = compileSkill(skill);
  assert.strictEqual(result.errors.length, 0);

  const gate11 = result.gates.find((g) => g.id === '1.1');
  assert.strictEqual(gate11.severity, 'block'); // 含"必须"

  const gate12 = result.gates.find((g) => g.id === '1.2');
  assert.strictEqual(gate12.severity, 'block'); // 显式声明

  const gate13 = result.gates.find((g) => g.id === '1.3');
  assert.strictEqual(gate13.severity, 'warn'); // 默认
});

test('compileSkill 环节数少于3报错', () => {
  const skill = `---
name: test
---

## 环节1：需求
- 目的：明确需求
- 产物：需求文档

### 1.1 门禁1
判据类型: auto

### 1.2 门禁2
判据类型: auto

## 环节2：开发
- 目的：开发
- 产物：代码

### 2.1 门禁1
判据类型: auto

### 2.2 门禁2
判据类型: auto
`;

  const result = compileSkill(skill);
  assert.ok(result.errors.some((e) => e.includes('环节数少于 3')));
});

test('compileSkill 环节门禁少于2报错', () => {
  const skill = `---
name: test
---

## 环节1：需求
- 目的：明确需求
- 产物：需求文档

### 1.1 门禁1
判据类型: auto

## 环节2：开发
- 目的：开发
- 产物：代码

### 2.1 门禁1
判据类型: auto

### 2.2 门禁2
判据类型: auto

## 环节3：测试
- 目的：测试
- 产物：报告

### 3.1 门禁1
判据类型: auto

### 3.2 门禁2
判据类型: auto
`;

  const result = compileSkill(skill);
  assert.ok(result.errors.some((e) => e.includes('门禁少于 2')));
});

test('compileSkill 门禁缺少判据类型报错', () => {
  const skill = `---
name: test
---

## 环节1：需求
- 目的：明确需求
- 产物：需求文档

### 1.1 门禁1
判据类型: auto

### 1.2 门禁2

## 环节2：开发
- 目的：开发
- 产物：代码

### 2.1 门禁1
判据类型: auto

### 2.2 门禁2
判据类型: auto

## 环节3：测试
- 目的：测试
- 产物：报告

### 3.1 门禁1
判据类型: auto

### 3.2 门禁2
判据类型: auto
`;

  const result = compileSkill(skill);
  assert.ok(result.errors.some((e) => e.includes('没有标记判据类型')));
});

test('compileSkill 环节缺少目的报错', () => {
  const skill = `---
name: test
---

## 环节1：需求
- 产物：需求文档

### 1.1 门禁1
判据类型: auto

### 1.2 门禁2
判据类型: auto

## 环节2：开发
- 目的：开发
- 产物：代码

### 2.1 门禁1
判据类型: auto

### 2.2 门禁2
判据类型: auto

## 环节3：测试
- 目的：测试
- 产物：报告

### 3.1 门禁1
判据类型: auto

### 3.2 门禁2
判据类型: auto
`;

  const result = compileSkill(skill);
  assert.ok(result.errors.some((e) => e.includes('缺少目的描述')));
});
