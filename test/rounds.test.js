import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { claim, startRound, endRound, abortRound, roundStatus, snapshot } from '../src/kernel/rounds.js';

test('snapshot 拍快照', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-round-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'app.js'), 'console.log("hello")');
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { lodash: '^4.0.0' },
      devDependencies: { jest: '^29.0.0' }
    }));

    const snap = snapshot(tmpDir);
    assert.ok(snap.at);
    assert.ok(snap.files['app.js']);
    assert.strictEqual(snap.deps.length, 2);
    assert.ok(snap.deps.includes('lodash'));
    assert.ok(snap.deps.includes('jest'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('snapshot 测试文件计数', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-round-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'app.test.js'), `
      test('add', () => { expect(1+1).toBe(2); });
      test('sub', () => { expect(2-1).toBe(1); });
    `);

    const hints = { testFile: /\.test\.js$/ };
    const snap = snapshot(tmpDir, hints);
    assert.ok(snap.cases['app.test.js']);
    assert.strictEqual(snap.cases['app.test.js'].cases, 2);
    assert.strictEqual(snap.cases['app.test.js'].asserts, 2);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('claim 认领文件成功', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-round-'));
  try {
    fs.mkdirSync(path.join(tmpDir, '.webuddy'), { recursive: true });
    const result = claim(tmpDir, 'session1', ['app.js', 'util.js']);
    assert.strictEqual(result.ok, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('claim 文件冲突', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-round-'));
  try {
    fs.mkdirSync(path.join(tmpDir, '.webuddy'), { recursive: true });

    // session1 先认领
    claim(tmpDir, 'session1', ['app.js', 'util.js']);

    // session2 尝试认领同一文件
    const result = claim(tmpDir, 'session2', ['app.js', 'other.js']);
    assert.strictEqual(result.ok, false);
    assert.ok(result.conflicts);
    assert.strictEqual(result.conflicts.length, 1);
    assert.strictEqual(result.conflicts[0].file, 'app.js');
    assert.ok(result.say.includes('app.js'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('claim 不同文件不冲突', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-round-'));
  try {
    fs.mkdirSync(path.join(tmpDir, '.webuddy'), { recursive: true });

    claim(tmpDir, 'session1', ['app.js']);
    const result = claim(tmpDir, 'session2', ['util.js']);
    assert.strictEqual(result.ok, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('startRound 开始轮次', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-round-'));
  try {
    fs.mkdirSync(path.join(tmpDir, '.webuddy'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'app.js'), 'console.log("v1")');

    const result = startRound(tmpDir, 'session1', {
      files: ['app.js'],
      gateId: '3.1',
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.sessionId, 'session1');
    assert.ok(result.fileCount >= 0);

    // 验证轮次文件已创建
    const roundPath = path.join(tmpDir, '.webuddy', 'rounds', 'session1.json');
    assert.ok(fs.existsSync(roundPath));
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('endRound 结束轮次无违规', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-round-'));
  try {
    fs.mkdirSync(path.join(tmpDir, '.webuddy'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'app.js'), 'console.log("v1")');

    startRound(tmpDir, 'session1', { files: ['app.js'] });

    // 修改已认领的文件
    fs.writeFileSync(path.join(tmpDir, 'app.js'), 'console.log("v2")');

    const result = endRound(tmpDir, 'session1');
    assert.strictEqual(result.ok, true);
    assert.ok(Array.isArray(result.violations));
    assert.strictEqual(result.violations.length, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('endRound 检测未认领文件修改', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-round-'));
  try {
    fs.mkdirSync(path.join(tmpDir, '.webuddy'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'app.js'), 'v1');
    fs.writeFileSync(path.join(tmpDir, 'util.js'), 'v1');

    startRound(tmpDir, 'session1', { files: ['app.js'] });

    // 修改未认领的文件
    fs.writeFileSync(path.join(tmpDir, 'util.js'), 'v2');

    const result = endRound(tmpDir, 'session1');
    assert.strictEqual(result.ok, true);
    assert.ok(result.violations.some(v => v.kind === 'outOfDeclaredScope'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('endRound 检测新依赖', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-round-'));
  try {
    fs.mkdirSync(path.join(tmpDir, '.webuddy'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { lodash: '^4.0.0' }
    }));

    startRound(tmpDir, 'session1', { files: ['package.json'] });

    // 添加新依赖
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { lodash: '^4.0.0', axios: '^1.0.0' }
    }));

    const result = endRound(tmpDir, 'session1');
    assert.strictEqual(result.ok, true);
    assert.ok(result.violations.some(v => v.kind === 'newDeps' && v.say.includes('axios')));
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('endRound 检测测试篡改', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-round-'));
  try {
    fs.mkdirSync(path.join(tmpDir, '.webuddy'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'app.test.js'), `
      test('a', () => { expect(1).toBe(1); });
      test('b', () => { expect(2).toBe(2); });
      test('c', () => { expect(3).toBe(3); });
    `);

    const hints = { testFile: /\.test\.js$/ };
    startRound(tmpDir, 'session1', { files: ['app.test.js'], hints });

    // 删除一个测试
    fs.writeFileSync(path.join(tmpDir, 'app.test.js'), `
      test('a', () => { expect(1).toBe(1); });
      test('b', () => { expect(2).toBe(2); });
    `);

    const result = endRound(tmpDir, 'session1', { hints });
    assert.strictEqual(result.ok, true);
    assert.ok(result.violations.some(v => v.kind === 'testsTampered'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('abortRound 中止轮次', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-round-'));
  try {
    fs.mkdirSync(path.join(tmpDir, '.webuddy'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'app.js'), 'v1');

    startRound(tmpDir, 'session1', { files: ['app.js'] });

    const result = abortRound(tmpDir, 'session1');
    assert.strictEqual(result.ok, true);

    // 验证认领已释放
    const result2 = claim(tmpDir, 'session2', ['app.js']);
    assert.strictEqual(result2.ok, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('roundStatus 列出轮次', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-round-'));
  try {
    fs.mkdirSync(path.join(tmpDir, '.webuddy'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'app.js'), 'v1');

    startRound(tmpDir, 'session1', { files: ['app.js'], gateId: '3.1' });
    startRound(tmpDir, 'session2', { files: ['util.js'], gateId: '3.2' });

    const rounds = roundStatus(tmpDir);
    assert.strictEqual(rounds.length, 2);
    assert.ok(rounds.some(r => r.sessionId === 'session1'));
    assert.ok(rounds.some(r => r.sessionId === 'session2'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('endRound 释放认领后其他会话可认领', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-round-'));
  try {
    fs.mkdirSync(path.join(tmpDir, '.webuddy'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'app.js'), 'v1');

    startRound(tmpDir, 'session1', { files: ['app.js'] });
    endRound(tmpDir, 'session1');

    // session2 应该可以认领相同文件
    const result = claim(tmpDir, 'session2', ['app.js']);
    assert.strictEqual(result.ok, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('两会话并行操作不相交文件', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-round-'));
  try {
    fs.mkdirSync(path.join(tmpDir, '.webuddy'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'app.js'), 'v1');
    fs.writeFileSync(path.join(tmpDir, 'util.js'), 'v1');

    // session1 和 session2 并行开始
    startRound(tmpDir, 'session1', { files: ['app.js'] });
    startRound(tmpDir, 'session2', { files: ['util.js'] });

    // 各自修改
    fs.writeFileSync(path.join(tmpDir, 'app.js'), 'v2');
    fs.writeFileSync(path.join(tmpDir, 'util.js'), 'v2');

    // 先结束 session1
    const r1 = endRound(tmpDir, 'session1');
    assert.strictEqual(r1.ok, true);
    // util.js 触发 outOfDeclaredScope 和 driveByRefactor 两个违规
    assert.strictEqual(r1.violations.length, 2);
    assert.ok(r1.violations.some(v => v.kind === 'outOfDeclaredScope'));
    assert.ok(r1.violations.some(v => v.kind === 'driveByRefactor'));

    // 再结束 session2
    const r2 = endRound(tmpDir, 'session2');
    assert.strictEqual(r2.ok, true);
    // app.js 触发 outOfDeclaredScope 和 driveByRefactor 两个违规
    assert.strictEqual(r2.violations.length, 2);
    assert.ok(r2.violations.some(v => v.kind === 'outOfDeclaredScope'));
    assert.ok(r2.violations.some(v => v.kind === 'driveByRefactor'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});
