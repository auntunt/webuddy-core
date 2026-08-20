import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveProjectDir, normalize, handleHook } from '../src/kernel/hook.js';

test('resolveProjectDir 识别项目根', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-hook-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    const resolved = resolveProjectDir(tmpDir);
    assert.strictEqual(resolved, fs.realpathSync(tmpDir));
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('resolveProjectDir 无标志物', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-hook-'));
  try {
    const resolved = resolveProjectDir(tmpDir);
    assert.strictEqual(resolved, null);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('resolveProjectDir 路径不存在', () => {
  const resolved = resolveProjectDir('/tmp/does-not-exist-12345');
  assert.strictEqual(resolved, null);
});

test('normalize 编辑工具', () => {
  const payload = {
    tool_name: 'Edit',
    tool_input: { file_path: '/proj/src/app.js', old_string: 'a', new_string: 'b' },
    cwd: '/proj',
    session_id: 's123',
    agent: 'claude'
  };
  const ev = normalize(payload);
  assert.strictEqual(ev.kind, 'edit');
  assert.strictEqual(ev.file, 'app.js');
  assert.strictEqual(ev.cwd, '/proj');
  assert.strictEqual(ev.session, 's123');
  assert.strictEqual(ev.agent, 'claude');
});

test('normalize 命令执行', () => {
  const payload = {
    tool_name: 'Bash',
    tool_input: { command: 'npm test' },
    tool_response: { exit_code: 0 },
    cwd: '/proj'
  };
  const ev = normalize(payload);
  assert.strictEqual(ev.kind, 'run');
  assert.strictEqual(ev.cmd, 'npm test');
  assert.strictEqual(ev.exit, 0);
});

test('normalize 会话开始', () => {
  const payload = {
    hook_event_name: 'SessionStart',
    cwd: '/proj'
  };
  const ev = normalize(payload);
  assert.strictEqual(ev.kind, 'start');
});

test('normalize 会话结束', () => {
  const payload = {
    hook_event_name: 'SessionEnd',
    cwd: '/proj'
  };
  const ev = normalize(payload);
  assert.strictEqual(ev.kind, 'stop');
});

test('normalize 未知工具', () => {
  const payload = {
    tool_name: 'UnknownTool',
    cwd: '/proj'
  };
  const ev = normalize(payload);
  assert.strictEqual(ev.kind, 'other');
});

test('normalize 命令截断', () => {
  const payload = {
    tool_name: 'Bash',
    tool_input: { command: 'x'.repeat(300) },
    cwd: '/proj'
  };
  const ev = normalize(payload);
  assert.strictEqual(ev.cmd.length, 200);
});

test('normalize 空载荷', () => {
  const ev = normalize({});
  assert.strictEqual(ev.kind, 'other');
  assert.strictEqual(ev.file, '');
  assert.strictEqual(ev.cmd, '');
  assert.strictEqual(ev.exit, undefined);
});

test('normalize agent 参数', () => {
  const payload = { tool_name: 'Edit', cwd: '/proj' };
  const ev = normalize(payload, { agent: 'copilot' });
  assert.strictEqual(ev.agent, 'copilot');
});

test('handleHook 成功写入', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-hook-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    const payload = JSON.stringify({
      tool_name: 'Edit',
      tool_input: { file_path: 'test.js' },
      cwd: tmpDir
    });
    const result = handleHook(payload, { agent: 'claude' });
    assert.strictEqual(result.written, true);
    assert.strictEqual(result.dir, fs.realpathSync(tmpDir));
    assert.strictEqual(result.kind, 'edit');

    const eventsPath = path.join(tmpDir, '.webuddy', 'events.jsonl');
    assert.ok(fs.existsSync(eventsPath));
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('handleHook 无效 JSON', () => {
  const result = handleHook('not json', { agent: 'claude' });
  assert.strictEqual(result.written, false);
  assert.ok(result.why.includes('JSON'));
});

test('handleHook 无法定位项目', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-hook-'));
  try {
    // 没有项目标志物
    const payload = JSON.stringify({
      tool_name: 'Edit',
      cwd: tmpDir
    });
    const result = handleHook(payload);
    assert.strictEqual(result.written, false);
    assert.ok(result.why.includes('项目'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('handleHook 多条事件累积', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-hook-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');

    handleHook(JSON.stringify({
      tool_name: 'Edit',
      tool_input: { file_path: 'a.js' },
      cwd: tmpDir
    }));

    handleHook(JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_response: { exit_code: 0 },
      cwd: tmpDir
    }));

    const eventsPath = path.join(tmpDir, '.webuddy', 'events.jsonl');
    const lines = fs.readFileSync(eventsPath, 'utf8').trim().split('\n');
    assert.strictEqual(lines.length, 2);

    const ev1 = JSON.parse(lines[0]);
    const ev2 = JSON.parse(lines[1]);
    assert.strictEqual(ev1.kind, 'edit');
    assert.strictEqual(ev2.kind, 'run');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});
