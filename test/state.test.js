import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  statePath,
  loadState,
  saveState,
  getInstanceVersion,
  appendRecord,
  readRecords,
  getLatestHumanConfirm,
  isPackFixture
} from '../src/kernel/state.js';

test('statePath 构建正确路径', () => {
  const dir = '/project';
  assert.strictEqual(statePath(dir), path.join('/project', '.webuddy'));
  assert.strictEqual(statePath(dir, 'state.json'), path.join('/project', '.webuddy', 'state.json'));
  assert.strictEqual(statePath(dir, 'rounds', 't1.json'), path.join('/project', '.webuddy', 'rounds', 't1.json'));
});

test('loadState 不存在时返回 null', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-'));
  try {
    const state = loadState(tmpDir);
    assert.strictEqual(state, null);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('saveState 和 loadState 往返', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-'));
  try {
    saveState(tmpDir, { pack: 'test-pack', packVersion: '1.0.0' });
    const state = loadState(tmpDir);
    assert.strictEqual(state.pack, 'test-pack');
    assert.strictEqual(state.packVersion, '1.0.0');

    // 部分更新
    saveState(tmpDir, { mountedAt: '2026-01-01T00:00:00Z' });
    const state2 = loadState(tmpDir);
    assert.strictEqual(state2.pack, 'test-pack');
    assert.strictEqual(state2.mountedAt, '2026-01-01T00:00:00Z');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('appendRecord 和 readRecords', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-'));
  try {
    appendRecord(tmpDir, { kind: 'evaluate', scope: 'all', verdict: 'pass' });
    appendRecord(tmpDir, { kind: 'human-confirm', gateId: '1.2', result: 'pass', note: 'ok' });
    appendRecord(tmpDir, { kind: 'human-confirm', gateId: '2.3', result: 'fail', note: 'bad' });

    const all = readRecords(tmpDir);
    assert.strictEqual(all.length, 3);
    assert.ok(all[0].ts);
    assert.strictEqual(all[0].instanceVersion, 0); // 无 skeleton,版本 0

    // 按 kind 过滤
    const humanOnly = readRecords(tmpDir, { kind: 'human-confirm' });
    assert.strictEqual(humanOnly.length, 2);

    // 按 gateId 过滤
    const gate12 = readRecords(tmpDir, { gateId: '1.2' });
    assert.strictEqual(gate12.length, 1);
    assert.strictEqual(gate12[0].result, 'pass');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('getInstanceVersion 无 skeleton 返回 0', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-'));
  try {
    assert.strictEqual(getInstanceVersion(tmpDir), 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('getInstanceVersion 读取 skeleton.json', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-'));
  try {
    const skelPath = statePath(tmpDir, 'skeleton.json');
    fs.mkdirSync(path.dirname(skelPath), { recursive: true });
    fs.writeFileSync(skelPath, JSON.stringify({ instanceVersion: 5 }), 'utf8');

    assert.strictEqual(getInstanceVersion(tmpDir), 5);

    // appendRecord 应使用该版本
    appendRecord(tmpDir, { kind: 'test', data: 'x' });
    const records = readRecords(tmpDir);
    assert.strictEqual(records[0].instanceVersion, 5);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('getLatestHumanConfirm 返回最近记录', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-'));
  try {
    appendRecord(tmpDir, { kind: 'human-confirm', gateId: '1.2', result: 'fail', note: 'first' });
    appendRecord(tmpDir, { kind: 'human-confirm', gateId: '1.2', result: 'pass', note: 'second' });
    appendRecord(tmpDir, { kind: 'human-confirm', gateId: '2.3', result: 'pass', note: 'other' });

    const latest = getLatestHumanConfirm(tmpDir, '1.2');
    assert.strictEqual(latest.result, 'pass');
    assert.strictEqual(latest.note, 'second');

    const noRecord = getLatestHumanConfirm(tmpDir, '9.9');
    assert.strictEqual(noRecord, null);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('saveState 原子写保护并发', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-'));
  try {
    // 模拟并发写
    saveState(tmpDir, { counter: 1 });
    saveState(tmpDir, { counter: 2 });
    saveState(tmpDir, { counter: 3 });

    const state = loadState(tmpDir);
    assert.strictEqual(state.counter, 3);

    // 验证无 .tmp 残留
    const tmpFiles = fs.readdirSync(statePath(tmpDir)).filter(f => f.endsWith('.tmp'));
    assert.strictEqual(tmpFiles.length, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

/* ─────────────── I1a：包内示例项目的写保护 ─────────────── */

test('isPackFixture 认出包自带的示例项目', () => {
  assert.equal(isPackFixture('packs/software-engineering/fixtures/broken'), true);
  assert.equal(isPackFixture('packs/software-engineering/fixtures/good'), true);
  // 包目录自己不是示例项目
  assert.equal(isPackFixture('packs/software-engineering'), false);
});

test('isPackFixture 对普通项目与临时目录一概说不是', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-fixture-'));
  try {
    assert.equal(isPackFixture(tmpDir), false);
    // 光有 fixtures 这个名字不算：上头得真有一个包
    const fake = path.join(tmpDir, 'fixtures', 'broken');
    fs.mkdirSync(fake, { recursive: true });
    assert.equal(isPackFixture(fake), false);
    // 补上 pack.json 才算
    fs.writeFileSync(path.join(tmpDir, 'pack.json'), '{}');
    assert.equal(isPackFixture(fake), true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

/* ─────────────── I1c：巡检快照滚动，别的留痕永不删 ─────────────── */

test('appendRecord 把 evaluate 削到 200 条，human-confirm 一条不少', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-rotate-'));
  try {
    const recordsPath = statePath(tmpDir, 'records.jsonl');
    fs.mkdirSync(path.dirname(recordsPath), { recursive: true });

    const lines = [];
    for (let i = 0; i < 250; i++) lines.push(JSON.stringify({ kind: 'evaluate', seq: i }));
    // 三条人工确认插在最前面——最旧的位置，最容易被"丢最旧的"一起带走
    for (let i = 0; i < 3; i++) lines.splice(i * 2, 0, JSON.stringify({ kind: 'human-confirm', gateId: `g${i}` }));
    fs.writeFileSync(recordsPath, lines.join('\n') + '\n', 'utf8');

    appendRecord(tmpDir, { kind: 'evaluate', seq: 999 });

    const raw = fs.readFileSync(recordsPath, 'utf8').split('\n').filter((l) => l.trim());
    const recs = raw.map((l) => JSON.parse(l)); // 读不动就在这儿抛：文件必须仍是合法 JSONL
    const evals = recs.filter((r) => r.kind === 'evaluate');
    const humans = recs.filter((r) => r.kind === 'human-confirm');

    assert.equal(evals.length, 200, '巡检快照应恰好 200 条');
    assert.equal(humans.length, 3, '人工确认一条都不许丢');
    assert.equal(evals[evals.length - 1].seq, 999, '最新的那条要在');
    assert.equal(evals[0].seq, 51, '丢的应该是最旧的（0..50 共 51 条）');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('appendRecord 不到 200 条时不动文件，别的 kind 也从不触发滚动', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-rotate2-'));
  try {
    for (let i = 0; i < 30; i++) appendRecord(tmpDir, { kind: 'evaluate', seq: i });
    assert.equal(readRecords(tmpDir, { kind: 'evaluate' }).length, 30);

    // 300 条 human-confirm 照样一条不删
    for (let i = 0; i < 300; i++) appendRecord(tmpDir, { kind: 'human-confirm', gateId: String(i) });
    assert.equal(readRecords(tmpDir, { kind: 'human-confirm' }).length, 300);
    assert.equal(readRecords(tmpDir, { kind: 'evaluate' }).length, 30);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
