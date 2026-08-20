import { test } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { loadPack, resolvePack, mountPack } from '../src/kernel/pack.js';
import fs from 'node:fs';
import os from 'node:os';

const TEST_PACK_DIR = path.join(process.cwd(), 'test/fixtures/test-pack');

test('loadPack 加载有效包', async () => {
  const result = await loadPack(TEST_PACK_DIR);
  assert.strictEqual(result.ok, true);
  assert.ok(result.pack);
  assert.strictEqual(result.pack.meta.name, 'test-pack');
  assert.strictEqual(result.pack.stages.length, 3);
  assert.strictEqual(result.pack.gates.length, 6);
});

test('loadPack 包含 probes', async () => {
  const result = await loadPack(TEST_PACK_DIR);
  assert.ok(result.pack.probes);
  assert.ok(result.pack.probes.has('1.1'));
  assert.ok(result.pack.probes.has('2.1'));
});

test('loadPack 包含 prompts', async () => {
  const result = await loadPack(TEST_PACK_DIR);
  assert.ok(result.pack.prompts);
  const prompt12 = result.pack.prompts.find((p) => p.id === '1.2');
  assert.ok(prompt12);
  assert.strictEqual(prompt12.blockUntilAnswered, true);
  assert.ok(prompt12.asks.length > 0);
});

test('loadPack prompts.md 覆盖缺省提问组', async () => {
  const result = await loadPack(TEST_PACK_DIR);
  const prompt12 = result.pack.prompts.find((p) => p.id === '1.2');
  assert.ok(prompt12);
  // prompts.md 中定义了两个问题
  assert.strictEqual(prompt12.asks.length, 2);
  assert.ok(prompt12.asks.some((a) => a.key === 'approved'));
  assert.ok(prompt12.asks.some((a) => a.key === 'meeting'));
});

test('loadPack 包含 glossary', async () => {
  const result = await loadPack(TEST_PACK_DIR);
  assert.ok(result.pack.glossary);
  assert.strictEqual(result.pack.glossary['门禁'], '检查项');
});

test('loadPack 包含 lexicons', async () => {
  const result = await loadPack(TEST_PACK_DIR);
  assert.ok(result.pack.lexicons);
  assert.ok(Array.isArray(result.pack.lexicons.boundary));
  assert.ok(result.pack.lexicons.boundary.includes('为空'));
});

test('loadPack 目录不存在报错', async () => {
  const result = await loadPack('/nonexistent/path');
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('pack.json')));
});

test('loadPack 缺少 SKILL.md 报错', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-pack-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'pack.json'), JSON.stringify({
      name: 'test',
      version: '1.0.0',
      title: 'Test'
    }));
    const result = await loadPack(tmpDir);
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('SKILL.md')));
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('loadPack auto 门禁缺少实现报错', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-pack-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'pack.json'), JSON.stringify({
      name: 'test',
      version: '1.0.0',
      title: 'Test',
      lexicons: {},
      hints: {},
      native: false
    }));
    fs.writeFileSync(path.join(tmpDir, 'SKILL.md'), `---
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
- 目的：开发
- 产物：代码

### 2.1 代码
判据类型: auto

### 2.2 测试
判据类型: auto

## 环节3：测试
- 目的：测试
- 产物：报告

### 3.1 测试
判据类型: auto

### 3.2 覆盖率
判据类型: auto
`);
    // 没有 probes.md，auto 门禁缺少实现
    const result = await loadPack(tmpDir);
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('缺少探测实现')));
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('loadPack probes.md 门禁 ID 不存在报错', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-pack-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'pack.json'), JSON.stringify({
      name: 'test',
      version: '1.0.0',
      title: 'Test',
      lexicons: {},
      hints: {},
      native: false
    }));
    fs.writeFileSync(path.join(tmpDir, 'SKILL.md'), `---
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
- 目的：开发
- 产物：代码

### 2.1 代码
判据类型: auto

### 2.2 测试
判据类型: auto

## 环节3：测试
- 目的：测试
- 产物：报告

### 3.1 测试
判据类型: auto

### 3.2 覆盖率
判据类型: auto
`);
    fs.writeFileSync(path.join(tmpDir, 'probes.md'), `### 1.1
file-exists("需求.md")

### 9.9
file-exists("不存在.md")
`);
    const result = await loadPack(tmpDir);
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('9.9') && e.includes('不存在')));
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('resolvePack 解析绝对路径', () => {
  const resolved = resolvePack(TEST_PACK_DIR);
  assert.strictEqual(resolved, TEST_PACK_DIR);
});

test('resolvePack 解析相对路径', () => {
  const resolved = resolvePack('test/fixtures/test-pack');
  assert.ok(resolved);
  assert.ok(resolved.endsWith('test-pack'));
});

test('resolvePack 路径不存在返回 null', () => {
  const resolved = resolvePack('/nonexistent/pack');
  assert.strictEqual(resolved, null);
});

test('mountPack 挂载包到项目', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-mount-'));
  try {
    const result = await mountPack(tmpDir, TEST_PACK_DIR);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.packName, 'test-pack');

    const stateFile = path.join(tmpDir, '.webuddy', 'state.json');
    assert.ok(fs.existsSync(stateFile));

    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.strictEqual(state.pack.name, 'test-pack');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('mountPack 包不存在报错', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-mount-'));
  try {
    const result = await mountPack(tmpDir, '/nonexistent/pack');
    assert.strictEqual(result.ok, false);
    assert.ok(result.error.includes('找不到担架包'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('loadPack 对象深冻结', async () => {
  const result = await loadPack(TEST_PACK_DIR);
  assert.ok(Object.isFrozen(result.pack));
  assert.ok(Object.isFrozen(result.pack.meta));
  assert.ok(Object.isFrozen(result.pack.stages));
  assert.ok(Object.isFrozen(result.pack.gates));
  assert.ok(Object.isFrozen(result.pack.probes));
  assert.ok(Object.isFrozen(result.pack.prompts));
});
