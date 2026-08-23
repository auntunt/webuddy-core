/**
 * hook 命令端到端：真起一个进程，在真临时目录上跑，只看它吐出来的字节。
 *
 * 为什么不直接调 run()：这条命令的对外承诺有三样是函数调用看不见的——
 * 退出码（hook run 必须永远是 0）、--dry-run 打出来的 JSON 形状、以及
 * "说不写就一个字节都不写"。这三样恰好是 agent 和用户唯一依赖的东西。
 *
 * 家目录一律指到 mkdtemp 出来的临时目录（WEBUDDY_HOOK_HOME），
 * 任何一条用例都不许碰真实的 ~/.claude 或 ~/.codex。
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

const CLI = path.resolve('bin/webuddy.js');

/** 跑一次命令。退出码非 0 也照样把输出带回来。 */
function webuddy(args, { cwd, home, stdin } = {}) {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [CLI, ...args],
      { cwd, maxBuffer: 20e6, env: { ...process.env, WEBUDDY_HOOK_HOME: home } },
      (err, stdout, stderr) => resolve({ code: err?.code ?? 0, stdout, stderr }),
    );
    child.stdin.end(stdin ?? '');
  });
}

let tmp;
let home;
let proj;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'webuddy-hook-'));
  home = path.join(tmp, 'home');
  proj = path.join(tmp, 'proj');
  fs.mkdirSync(home, { recursive: true });
  // .webuddy/ 是内核唯一认的标志物：没有它 hook 一个字都不该往这个目录写
  fs.mkdirSync(path.join(proj, '.webuddy'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const settings = () => path.join(proj, '.claude', 'settings.json');

describe('webuddy hook install', () => {
  test('--dry-run 打出 ref 那套键，且一个字节都不落盘', async () => {
    const r = await webuddy(['hook', 'install', '--dry-run'], { cwd: proj, home });
    assert.equal(r.code, 0, r.stderr);

    const frag = JSON.parse(r.stdout);
    // 键名逐字对齐 ref/webuddy-console/src/hook-install.js
    assert.deepEqual(Object.keys(frag), ['hooks']);
    assert.deepEqual(Object.keys(frag.hooks), ['PostToolUse', 'Stop', 'SessionStart']);
    for (const ev of ['PostToolUse', 'Stop', 'SessionStart']) {
      const group = frag.hooks[ev];
      assert.equal(group.length, 1);
      assert.deepEqual(Object.keys(group[0]), ['hooks']);
      const h = group[0].hooks[0];
      assert.deepEqual(Object.keys(h), ['type', 'command', 'timeout']);
      assert.equal(h.type, 'command');
      assert.equal(h.timeout, 5);
      assert.match(h.command, /^node ".*bin\/webuddy\.js" hook run --agent claude-code$/);
    }

    // 说不写就不写：连 .claude 目录都不该冒出来
    assert.equal(fs.existsSync(path.join(proj, '.claude')), false);
    // 人话说明走 stderr，所以 stdout 才能是干净 JSON
    assert.match(r.stderr, /现在什么都没写/);
  });

  test('--dry-run 不碰真实家目录（临时 home 下什么都没多出来）', async () => {
    await webuddy(['hook', 'install', '--dry-run'], { cwd: proj, home });
    await webuddy(['hook', 'install', '--dry-run', '--agent', 'codex'], { cwd: proj, home });
    assert.deepEqual(fs.readdirSync(home), []);
  });

  test('装两次只有一条：第二次原地不动', async () => {
    const first = await webuddy(['hook', 'install'], { cwd: proj, home });
    assert.equal(first.code, 0, first.stderr);
    assert.match(first.stdout, /装好了/);

    const after1 = fs.readFileSync(settings(), 'utf8');
    const conf1 = JSON.parse(after1);
    for (const ev of ['PostToolUse', 'Stop', 'SessionStart']) {
      assert.equal(conf1.hooks[ev].length, 1);
    }

    const second = await webuddy(['hook', 'install'], { cwd: proj, home });
    assert.equal(second.code, 0, second.stderr);
    assert.match(second.stdout, /已经装过了/);
    // 逐字节没变
    assert.equal(fs.readFileSync(settings(), 'utf8'), after1);
  });

  test('别人的 hook 一条都不碰', async () => {
    fs.mkdirSync(path.dirname(settings()), { recursive: true });
    fs.writeFileSync(settings(), JSON.stringify({
      model: 'opus',
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo 别人的' }] }] },
    }, null, 2));

    const r = await webuddy(['hook', 'install'], { cwd: proj, home });
    assert.equal(r.code, 0, r.stderr);
    const conf = JSON.parse(fs.readFileSync(settings(), 'utf8'));
    assert.equal(conf.model, 'opus');
    assert.equal(conf.hooks.Stop.length, 2);
    assert.equal(conf.hooks.Stop[0].hooks[0].command, 'echo 别人的');
  });

  test('settings.json 是坏 JSON：三段式报错，且没动过那个文件', async () => {
    fs.mkdirSync(path.dirname(settings()), { recursive: true });
    fs.writeFileSync(settings(), '{ 半行');
    const r = await webuddy(['hook', 'install'], { cwd: proj, home });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /可能是因为：/);
    assert.match(r.stderr, /怎么办：/);
    assert.equal(fs.readFileSync(settings(), 'utf8'), '{ 半行');
  });

  test('--agent codex 写进临时家目录的 .codex/config.toml，装两次也只有一行', async () => {
    const r = await webuddy(['hook', 'install', '--agent', 'codex'], { cwd: proj, home });
    assert.equal(r.code, 0, r.stderr);
    const conf = path.join(home, '.codex', 'config.toml');
    const text = fs.readFileSync(conf, 'utf8');
    assert.match(text, /^notify = \["node",".*bin\/webuddy\.js","hook","run","--agent","codex"\]$/m);

    const again = await webuddy(['hook', 'install', '--agent', 'codex'], { cwd: proj, home });
    assert.match(again.stdout, /已经装过了/);
    assert.equal(fs.readFileSync(conf, 'utf8'), text);
  });

  test('--agent 给了不认识的词：三段式 + 退出码 2', async () => {
    const r = await webuddy(['hook', 'install', '--agent', 'cursor'], { cwd: proj, home });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /只支持两个/);
  });
});

describe('webuddy hook status', () => {
  test('装之前说没装并给出下一步，装之后说装了几个事件', async () => {
    const before = await webuddy(['hook', 'status'], { cwd: proj, home });
    assert.equal(before.code, 0, before.stderr);
    assert.match(before.stdout, /还没装/);
    assert.match(before.stdout, /webuddy hook install/);

    await webuddy(['hook', 'install'], { cwd: proj, home });

    const after = await webuddy(['hook', 'status'], { cwd: proj, home });
    assert.equal(after.code, 0, after.stderr);
    assert.match(after.stdout, /装好了/);
    assert.match(after.stdout, /PostToolUse/);
    assert.match(after.stdout, /路径是对的/);
  });

  test('配置里的路径指到别处：说清它现在收不到，并给出怎么办', async () => {
    await webuddy(['hook', 'install'], { cwd: proj, home });
    const raw = fs.readFileSync(settings(), 'utf8')
      .replaceAll(CLI, '/搬走了/bin/webuddy.js');
    fs.writeFileSync(settings(), raw);

    const r = await webuddy(['hook', 'status'], { cwd: proj, home });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /记不下来/);
    assert.match(r.stdout, /怎么办/);
  });
});

describe('webuddy hook run（跑在别人的 agent 里，三条铁约束）', () => {
  const events = () => path.join(proj, '.webuddy', 'events.jsonl');

  test('一条正常 payload → events.jsonl 正好多一行', async () => {
    const payload = JSON.stringify({
      session_id: 'sess-1',
      transcript_path: '/tmp/whatever.jsonl',
      cwd: proj,
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_response: { exit_code: 0 },
    });

    const r = await webuddy(['hook', 'run', '--agent', 'claude-code'], { cwd: proj, home, stdin: payload });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, '');

    const lines = fs.readFileSync(events(), 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    const ev = JSON.parse(lines[0]);
    assert.equal(ev.kind, 'run');
    assert.equal(ev.cmd, 'npm test');
    assert.equal(ev.exit, 0);
    assert.equal(ev.session, 'sess-1');

    // 再来一条就该正好两行——"追加"是这条命令的全部工作
    await webuddy(['hook', 'run'], { cwd: proj, home, stdin: payload });
    assert.equal(fs.readFileSync(events(), 'utf8').split('\n').filter(Boolean).length, 2);
  });

  test('认不出的格式：退出 0、一个字都不打印、什么都不写', async () => {
    // 只列"根本不是 JSON"的。合法 JSON 但字段认不出（比如 [1,2,3]）不算认不出格式：
    // 内核有意把它记成 other——宁可多一条不认识的，也别悄悄吞掉（见 events.js）。
    for (const bad of ['这不是 JSON', '', '{"tool_name":', '{半行']) {
      const r = await webuddy(['hook', 'run'], { cwd: proj, home, stdin: bad });
      assert.equal(r.code, 0, `payload=${bad} 退出码应为 0`);
      assert.equal(r.stdout, '');
      assert.equal(r.stderr, '');
    }
    assert.equal(fs.existsSync(events()), false);
  });

  test('目录没 init 过（没有 .webuddy/）：不撒记号、不报错', async () => {
    const stranger = path.join(tmp, 'stranger');
    fs.mkdirSync(stranger);
    const r = await webuddy(['hook', 'run'], {
      cwd: stranger,
      home,
      stdin: JSON.stringify({ cwd: stranger, tool_name: 'Edit', tool_input: { file_path: 'a.js' } }),
    });
    assert.equal(r.code, 0);
    assert.equal(fs.existsSync(path.join(stranger, '.webuddy')), false);
  });

  test('Codex 那种把 payload 当命令行参数递过来的：一样记下来', async () => {
    const payload = JSON.stringify({
      cwd: proj, tool_name: 'Edit', tool_input: { file_path: path.join(proj, 'src/a.js') },
    });
    const r = await webuddy(['hook', 'run', payload, '--agent', 'codex'], { cwd: proj, home, stdin: '' });
    assert.equal(r.code, 0);
    const lines = fs.readFileSync(events(), 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).kind, 'edit');
    assert.equal(JSON.parse(lines[0]).file, 'a.js');
  });
});
