import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createFactContext, factsFingerprint } from '../src/kernel/facts.js';
import { writeArtifact } from '../src/kernel/artifact-io.js';

test('createFactContext 创建上下文', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-facts-'));
  try {
    const pack = {
      lexicons: { boundary: ['为空', '超长'] },
      hints: {}
    };

    const ctx = createFactContext(tmpDir, pack);
    assert.strictEqual(ctx.dir, tmpDir);
    assert.ok(typeof ctx.art === 'function');
    assert.deepStrictEqual(ctx.lexicons, pack.lexicons);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('art 函数 - 文件存在', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-facts-'));
  try {
    const content = `---
title: 测试
---
## 功能描述

这是功能描述。

| 字段 | 类型 |
|---|---|
| 名称 | 文本 |

- 列表项1
- 列表项2
`;

    writeArtifact(tmpDir, 'doc.md', content);

    const pack = { lexicons: {}, hints: {} };
    const ctx = createFactContext(tmpDir, pack);
    const artifact = ctx.art('doc.md');

    assert.strictEqual(artifact.exists, true);
    assert.ok(artifact.raw.includes('功能描述'));
    assert.strictEqual(artifact.meta.title, '测试');
    assert.strictEqual(artifact.sections.length, 1);
    assert.strictEqual(artifact.sections[0].title, '功能描述');
    assert.strictEqual(artifact.tables.length, 1);
    assert.strictEqual(artifact.tables[0].headers[0], '字段');
    assert.ok(artifact.lists.length > 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('art 函数 - 文件不存在', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-facts-'));
  try {
    const pack = { lexicons: {}, hints: {} };
    const ctx = createFactContext(tmpDir, pack);
    const artifact = ctx.art('missing.md');

    assert.strictEqual(artifact.exists, false);
    assert.strictEqual(artifact.raw, '');
    assert.strictEqual(artifact.sections.length, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('art 函数 - 缓存生效', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-facts-'));
  try {
    writeArtifact(tmpDir, 'doc.md', '# Test');

    const pack = { lexicons: {}, hints: {} };
    const ctx = createFactContext(tmpDir, pack);

    const art1 = ctx.art('doc.md');
    const art2 = ctx.art('doc.md');

    // 应该返回同一个对象（缓存）
    assert.strictEqual(art1, art2);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('factsFingerprint 计算指纹', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-facts-'));
  try {
    writeArtifact(tmpDir, 'a.md', 'content A');
    writeArtifact(tmpDir, 'b.md', 'content B');

    const pack = { lexicons: {}, hints: {} };
    const ctx = createFactContext(tmpDir, pack);

    const fp1 = factsFingerprint(ctx, ['a.md', 'b.md']);
    assert.strictEqual(fp1.length, 12);

    // 相同内容应该产生相同指纹
    const fp2 = factsFingerprint(ctx, ['a.md', 'b.md']);
    assert.strictEqual(fp1, fp2);

    // 修改文件应该产生不同指纹
    writeArtifact(tmpDir, 'a.md', 'content A modified');
    const fp3 = factsFingerprint(ctx, ['a.md', 'b.md']);
    assert.notStrictEqual(fp1, fp3);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('factsFingerprint 文件顺序无关', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-facts-'));
  try {
    writeArtifact(tmpDir, 'a.md', 'A');
    writeArtifact(tmpDir, 'b.md', 'B');

    const pack = { lexicons: {}, hints: {} };
    const ctx = createFactContext(tmpDir, pack);

    const fp1 = factsFingerprint(ctx, ['a.md', 'b.md']);
    const fp2 = factsFingerprint(ctx, ['b.md', 'a.md']);
    assert.strictEqual(fp1, fp2);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('ctx.round 传递', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-facts-'));
  try {
    const pack = { lexicons: {}, hints: {} };
    const roundData = {
      sessionId: 't1',
      gateId: '1.2',
      violations: []
    };

    const ctx = createFactContext(tmpDir, pack, { round: roundData });
    assert.deepStrictEqual(ctx.round, roundData);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});
