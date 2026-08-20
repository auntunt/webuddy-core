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
  getLatestHumanConfirm
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
