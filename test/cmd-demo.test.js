/**
 * demo 命令端到端（I4a）。
 *
 * 家目录用环境变量顶掉：注册表在 ~/.webuddy/projects.json，
 * 演示项目缺省也落在家目录下，不顶掉的话跑一次测试就往开发者自己的
 * 看板里塞一个项目、往家目录里扔一个文件夹。os.homedir() 在 POSIX 上
 * 读的就是 $HOME，所以子进程 spawn 之前把它换掉就够，不用改内核。
 * Windows 上 os.homedir() 认的是 %USERPROFILE% 而不是 $HOME，两个都得设：
 * registry.js 走 os.homedir()，而 pack.js:414 走 `HOME || USERPROFILE`，
 * 只设一个的话这两处会指到不同地方，测试要么污染真实用户目录、要么当场找不到文件。
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';

const CLI = path.resolve('bin/webuddy.js');
const SE = path.resolve('packs/software-engineering');
const REPO = path.resolve('.');

let home;

/** 跑一次命令。--no-browser 之后 cmd-open 会一直守着服务不退出，所以到点就掐掉。 */
function webuddy(args, { timeout = 20000 } = {}) {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath, [CLI, ...args],
      { cwd: REPO, env: { ...process.env, HOME: home, USERPROFILE: home }, maxBuffer: 20e6, timeout, killSignal: 'SIGKILL' },
      (err, stdout, stderr) => resolve({ code: err?.code ?? 0, killed: Boolean(err?.killed), stdout, stderr })
    );
    // 看板一起来就够了，不用等它自己退
    let seen = '';
    child.stdout.on('data', (d) => {
      seen += d;
      if (/看板开着呢/.test(seen)) child.kill('SIGKILL');
    });
  });
}

before(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'webuddy-demo-home-')); });
after(() => { fs.rmSync(home, { recursive: true, force: true }); });

describe('webuddy demo（§I4a）', () => {
  test('--help 能用，打的是用法', async () => {
    const r = await webuddy(['demo', '--help']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /练手用的演示项目/);
    assert.doesNotMatch(r.stdout + r.stderr, /尚未实现/);
  });

  test('造出来的项目挂好了清单、进了看板的名单，三句话都说了', async () => {
    const target = path.join(home, 'demo-a');
    const r = await webuddy(['demo', 'software-engineering', target, '--no-browser']);

    assert.ok(fs.existsSync(target), `${target} 没造出来：${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /故意留了错的练习项目/);
    assert.match(r.stdout, /红着的就是要修的/);
    assert.match(r.stdout, /修一条，红灯就灭一条/);

    const state = JSON.parse(fs.readFileSync(path.join(target, '.webuddy', 'state.json'), 'utf8'));
    assert.equal(state.pack, 'software-engineering', '演示项目得挂上清单，不然打开看板是空的');

    // /v1/projects 背后就是这份注册表
    const reg = JSON.parse(fs.readFileSync(path.join(home, '.webuddy', 'projects.json'), 'utf8'));
    assert.ok(reg.projects.some((p) => p.dir === target), '演示项目要出现在看板的项目列表里');

    // dot- 前缀在拷贝时还原：判据要看 .git 才判得出"改动存过档没有"
    assert.ok(fs.existsSync(path.join(target, '.git')), 'dot-git 应该还原成 .git');
    assert.ok(!fs.existsSync(path.join(target, 'dot-git')));
  });

  test('首屏红的正好是包里点名该红的那几条', async () => {
    const target = path.join(home, 'demo-b');
    await webuddy(['demo', 'software-engineering', target, '--no-browser']);

    const { loadPack } = await import('../src/kernel/pack.js');
    const { evaluate } = await import('../src/kernel/evaluate.js');
    const loaded = await loadPack(SE);
    const res = evaluate(target, loaded.pack, {});

    const actual = [...new Set(res.gates.filter((g) => g.r === 'fail').map((g) => g.id))].sort();
    const expected = JSON.parse(
      fs.readFileSync(path.join(SE, 'fixtures', 'broken', 'expected.json'), 'utf8')
    ).mustFail.slice().sort();
    assert.deepEqual(actual, expected, '演示项目的红灯集合要跟样板项目一模一样，多红少红都不行');
  });

  test('演示项目不在 packs/ 里，所以查一次是留档的（练习就得看见自己在往前走）', async () => {
    const target = path.join(home, 'demo-c');
    await webuddy(['demo', 'software-engineering', target, '--no-browser']);

    const recPath = path.join(target, '.webuddy', 'records.jsonl');
    const before_ = fs.existsSync(recPath)
      ? fs.readFileSync(recPath, 'utf8').split('\n').filter((l) => l.trim()).length : 0;
    await webuddy(['check', '--project', target]);
    const after_ = fs.readFileSync(recPath, 'utf8').split('\n').filter((l) => l.trim()).length;

    assert.equal(after_, before_ + 1, '演示项目是普通项目，查一次就该留一条痕');
    const { isPackFixture } = await import('../src/kernel/state.js');
    assert.equal(isPackFixture(target), false, '拷出来的目录不在包里，写保护不该命中它');
  });

  test('目录已经有了：三段式报错，一个字节都不动它', async () => {
    const target = path.join(home, 'demo-d');
    await webuddy(['demo', 'software-engineering', target, '--no-browser']);
    const marker = path.join(target, '我改了一半.md');
    fs.writeFileSync(marker, '别删我', 'utf8');

    const r = await webuddy(['demo', 'software-engineering', target, '--no-browser']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /已经有了/);
    assert.match(r.stderr, /可能是因为：/);
    assert.match(r.stderr, /怎么办：/);
    assert.equal(fs.readFileSync(marker, 'utf8'), '别删我', '不覆盖就是一个字节都不动');
  });

  test('清单名打错：说清没有这个名字，并告诉他去哪儿看有哪几个', async () => {
    const r = await webuddy(['demo', 'sofware-enginering', path.join(home, 'demo-e'), '--no-browser']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /没有「sofware-enginering」这套检查清单/);
    assert.match(r.stderr, /packs\//);
    assert.ok(!fs.existsSync(path.join(home, 'demo-e')), '没造成功就别留下半个目录');
  });

  test('一个清单名都没给：也走三段式，不打一句看不懂的报错', async () => {
    const r = await webuddy(['demo']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /不知道要拿哪套检查清单/);
    assert.match(r.stderr, /怎么办：/);
  });

  test('起一遍真服务：GET /v1/projects 里真能看见这个演示项目', async () => {
    const target = path.join(home, 'demo-f');
    await webuddy(['demo', 'software-engineering', target, '--no-browser']);

    const port = 9911;
    const token = 'demo-token';
    // 只连 127.0.0.1（铁律）。服务用同一个 HOME，才读得到刚写进去的那份注册表。
    const srv = spawn(process.execPath, [CLI, 'serve', '--port', String(port), '--token', token], {
      cwd: REPO, env: { ...process.env, HOME: home, USERPROFILE: home }, stdio: 'ignore',
    });
    try {
      let body = null;
      for (let i = 0; i < 60; i++) {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/v1/projects`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) { body = await res.json(); break; }
        } catch { /* 还没起来，再等等 */ }
        await new Promise((r) => setTimeout(r, 200));
      }
      assert.ok(body, '服务没起来或者 /v1/projects 没回话');
      const list = body.projects || body;
      assert.ok(Array.isArray(list), `/v1/projects 应该回一个列表，回的是 ${JSON.stringify(body).slice(0, 120)}`);
      assert.ok(list.some((p) => p.dir === target), `演示项目不在 /v1/projects 里：${JSON.stringify(list)}`);
    } finally {
      srv.kill('SIGKILL');
    }
  });
});
