import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'os';
import { createFactContext } from '../src/kernel/facts.js';
import { evalProbe } from '../src/kernel/probes.js';
import { parseProbe } from '../src/kernel/probe-dsl.js';

/**
 * ctx 契约对接测试：验证 §4.3 的 ctx 对象符合探测器预期。
 *
 * ctx 必须提供：
 * - art(rel): 返回 {exists, raw, sections, tables, lists, mtime}
 * - round: 轮次信息（可选）
 * - 其他探测器需要的上下文
 */

test('ctx 契约 - art 函数返回正确结构', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-ctx-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'doc.md'), `# 标题

正文内容。

## 章节1
内容1
`);

    const pack = { lexicons: {}, hints: {} };
    const ctx = createFactContext(tmpDir, pack);
    const artifact = ctx.art('doc.md');

    // 验证返回结构
    assert.strictEqual(artifact.exists, true);
    assert.ok(artifact.raw);
    assert.ok(Array.isArray(artifact.sections));
    assert.ok(Array.isArray(artifact.tables));
    assert.ok(Array.isArray(artifact.lists));
    assert.ok(artifact.mtime);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('ctx 契约 - art 缓存生效', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-ctx-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'doc.md'), 'content');

    const pack = { lexicons: {}, hints: {} };
    const ctx = createFactContext(tmpDir, pack);
    const a1 = ctx.art('doc.md');
    const a2 = ctx.art('doc.md');

    // 应该返回相同的缓存对象
    assert.strictEqual(a1, a2);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('ctx 契约 - 与 probes 对接', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-ctx-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'app.js'), 'console.log("hello")');

    const pack = { lexicons: {}, hints: {} };
    const ctx = createFactContext(tmpDir, pack);

    // file-exists 应该能用 ctx
    const parsed = parseProbe('file-exists("app.js")');
    assert.strictEqual(parsed.ok, true);

    const result = evalProbe(parsed.ast, ctx);
    assert.strictEqual(result.r, 'pass');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('ctx 契约 - round 传递', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-ctx-'));
  try {
    const pack = { lexicons: {}, hints: {} };
    const ctx = createFactContext(tmpDir, pack, { round: 'session123' });

    assert.strictEqual(ctx.round, 'session123');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('ctx 契约 - 探测器完整对接', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-ctx-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), `# 项目

## 功能
- 功能1
- 功能2
- 功能3
`);

    const pack = { lexicons: {}, hints: {} };
    const ctx = createFactContext(tmpDir, pack);

    // 测试多个探测器
    const tests = [
      { dsl: 'file-exists("README.md")', expectedR: 'pass' },
      { dsl: 'file-exists("missing.md")', expectedR: 'fail' },
      { dsl: 'section-filled("README.md", "功能")', expectedR: 'pass' },
      { dsl: 'count-at-least("README.md", "列表项", 2)', expectedR: 'pass' },
    ];

    for (const { dsl, expectedR } of tests) {
      const parsed = parseProbe(dsl);
      assert.strictEqual(parsed.ok, true, `DSL 解析失败: ${dsl}`);
      const result = evalProbe(parsed.ast, ctx);
      assert.strictEqual(result.r, expectedR, `Failed for ${dsl}`);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('ctx 契约 - art 不存在文件', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-ctx-'));
  try {
    const pack = { lexicons: {}, hints: {} };
    const ctx = createFactContext(tmpDir, pack);
    const artifact = ctx.art('missing.md');

    assert.strictEqual(artifact.exists, false);
    assert.strictEqual(artifact.raw, '');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('ctx 契约 - 复杂 DSL 表达式对接', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-ctx-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'doc1.md'), '# Doc1');
    fs.writeFileSync(path.join(tmpDir, 'doc2.md'), '# Doc2');

    const pack = { lexicons: {}, hints: {} };
    const ctx = createFactContext(tmpDir, pack);

    // 测试 all/any/not 连接词
    const tests = [
      {
        dsl: 'all(file-exists("doc1.md"), file-exists("doc2.md"))',
        expectedR: 'pass'
      },
      {
        dsl: 'any(file-exists("doc1.md"), file-exists("missing.md"))',
        expectedR: 'pass'
      },
      {
        dsl: 'not(file-exists("missing.md"))',
        expectedR: 'pass'
      }
    ];

    for (const { dsl, expectedR } of tests) {
      const parsed = parseProbe(dsl);
      assert.strictEqual(parsed.ok, true, `DSL 解析失败: ${dsl}`);
      const result = evalProbe(parsed.ast, ctx);
      assert.strictEqual(result.r, expectedR, `Failed for ${dsl}`);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});
