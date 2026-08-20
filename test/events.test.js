import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { appendEvent, readEvents, summarizeEvents } from '../src/kernel/events.js';

test('appendEvent 追加事件', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-events-'));
  try {
    const ok = appendEvent(tmpDir, {
      kind: 'edit',
      file: 'test.js',
      agent: 'claude'
    });

    assert.strictEqual(ok, true);

    const eventsPath = path.join(tmpDir, '.webuddy', 'events.jsonl');
    assert.ok(fs.existsSync(eventsPath));

    const content = fs.readFileSync(eventsPath, 'utf8');
    assert.ok(content.includes('edit'));
    assert.ok(content.includes('test.js'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('appendEvent 过滤字段', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-events-'));
  try {
    appendEvent(tmpDir, {
      kind: 'run',
      cmd: 'npm test',
      exit: 0,
      extraField: 'should be removed'
    });

    const events = readEvents(tmpDir);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].kind, 'run');
    assert.strictEqual(events[0].cmd, 'npm test');
    assert.strictEqual(events[0].exit, 0);
    assert.strictEqual(events[0].extraField, undefined);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('readEvents 读取事件', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-events-'));
  try {
    appendEvent(tmpDir, { kind: 'edit', file: 'a.js' });
    appendEvent(tmpDir, { kind: 'edit', file: 'b.js' });
    appendEvent(tmpDir, { kind: 'run', cmd: 'npm test', exit: 0 });

    const events = readEvents(tmpDir);
    assert.strictEqual(events.length, 3);
    assert.strictEqual(events[0].kind, 'edit');
    assert.strictEqual(events[2].kind, 'run');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('readEvents 限制数量', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-events-'));
  try {
    for (let i = 0; i < 10; i++) {
      appendEvent(tmpDir, { kind: 'edit', file: `${i}.js` });
    }

    const events = readEvents(tmpDir, { limit: 5 });
    assert.strictEqual(events.length, 5);
    // 应该是最后 5 条
    assert.strictEqual(events[0].file, '5.js');
    assert.strictEqual(events[4].file, '9.js');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('readEvents 文件不存在', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-events-'));
  try {
    const events = readEvents(tmpDir);
    assert.deepStrictEqual(events, []);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('summarizeEvents 汇总事件', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-events-'));
  try {
    appendEvent(tmpDir, { kind: 'edit', file: 'a.js', agent: 'claude' });
    appendEvent(tmpDir, { kind: 'edit', file: 'b.js', agent: 'claude' });
    appendEvent(tmpDir, { kind: 'edit', file: 'a.js', agent: 'copilot' });
    appendEvent(tmpDir, { kind: 'run', cmd: 'npm test', exit: 0 });
    appendEvent(tmpDir, { kind: 'run', cmd: 'npm run dev', exit: 0 });

    const events = readEvents(tmpDir);
    const summary = summarizeEvents(events);

    assert.strictEqual(summary.count, 5);
    assert.strictEqual(summary.editCount, 3);
    assert.strictEqual(summary.touchedFiles.length, 2);
    assert.ok(summary.touchedFiles.includes('a.js'));
    assert.ok(summary.touchedFiles.includes('b.js'));
    assert.strictEqual(summary.agents.length, 2);
    assert.strictEqual(summary.runCount, 2);
    assert.strictEqual(summary.testRunCount, 1);
    assert.ok(summary.lastTest);
    assert.strictEqual(summary.lastTest.exit, 0);
    assert.ok(summary.lastStart);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('summarizeEvents 测试识别', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-events-'));
  try {
    appendEvent(tmpDir, { kind: 'run', cmd: 'npm test', exit: 0 });
    appendEvent(tmpDir, { kind: 'run', cmd: 'npm run test:unit', exit: 1 });
    appendEvent(tmpDir, { kind: 'run', cmd: 'pytest tests/', exit: 0 });
    appendEvent(tmpDir, { kind: 'run', cmd: 'npm run build', exit: 0 });

    const events = readEvents(tmpDir);
    const summary = summarizeEvents(events);

    assert.strictEqual(summary.testRunCount, 3);
    assert.strictEqual(summary.lastTest.exit, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('summarizeEvents 空事件', () => {
  const summary = summarizeEvents([]);
  assert.strictEqual(summary.count, 0);
  assert.strictEqual(summary.editCount, 0);
  assert.strictEqual(summary.testRunCount, 0);
  assert.strictEqual(summary.lastTest, null);
});
