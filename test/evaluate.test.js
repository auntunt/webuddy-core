/**
 * evaluate.js 测试（§5.2）。
 *
 * evaluate(projectDir, pack, opts) —— 吃项目目录和加载好的包，不吃 facts。
 * 所以这里的每个用例都在真实临时目录里摆好文件，不 mock fs。
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluate, VERDICT_LABEL } from '../src/kernel/evaluate.js';
import { loadPack } from '../src/kernel/pack.js';

const PACK_DIR = path.join(import.meta.dirname, 'fixtures', 'test-pack');

/** 建一个空项目目录，返回路径。用完由 after 统一删。 */
const dirs = [];
function mkProject() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-eval-'));
  dirs.push(d);
  fs.mkdirSync(path.join(d, '.webuddy'), { recursive: true });
  return d;
}

function write(dir, rel, content) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function writeState(dir, obj) {
  write(dir, '.webuddy/state.json', JSON.stringify(obj, null, 2));
}

/** test-pack 的 1.1/2.1/3.1/3.2 都靠文件，这里一次摆齐让它们全过。 */
function makeAllGreen(dir) {
  write(dir, '需求文档.md', '# 需求\n要做一个东西\n');
  write(dir, '设计文档.md', '# 设计\n\n## 架构设计\n分三层，前端后端数据库，各自职责写清楚了。\n');
  write(dir, 'src/main.js', 'export const main = () => 0;\n');
  write(
    dir,
    '测试清单.md',
    ['# 测试清单', '', '| 用例 | 结果 |', '| --- | --- |',
      '| 登录成功 | 过 |', '| 密码错 | 过 |', '| 账号锁 | 过 |', ''].join('\n')
  );
}

describe('evaluate', () => {
  let pack;

  before(async () => {
    const r = await loadPack(PACK_DIR);
    assert.ok(r.ok, `测试包加载失败：${(r.errors || []).join('；')}`);
    pack = r.pack;
  });

  after(() => {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  });

  it('返回 §5.2 约定的 EvalResult 字段', () => {
    const dir = mkProject();
    const r = evaluate(dir, pack);

    assert.strictEqual(r.dir, dir);
    assert.ok(Array.isArray(r.gates));
    assert.ok(Array.isArray(r.stages));
    assert.ok(Array.isArray(r.warnings));
    assert.ok(Array.isArray(r.hardFailsNow));
    assert.ok(Array.isArray(r.promptsPending));
    assert.ok(r.counts);
    assert.strictEqual(typeof r.inversionGap, 'number');
    assert.strictEqual(typeof r.currentStage, 'number');
    assert.strictEqual(typeof r.apparentStage, 'number');
    assert.strictEqual(r.mode, 'mvp'); // state.json 缺失时的默认
    assert.strictEqual(r.instanceVersion, 0);
  });

  it('没加载好的包直接抛错，不猜', () => {
    const dir = mkProject();
    assert.throws(() => evaluate(dir, null), /担架包/);
    assert.throws(() => evaluate(dir, { gates: [] }), /担架包/);
  });

  it('counts 每个桶加起来等于 total', () => {
    const dir = mkProject();
    const r = evaluate(dir, pack);
    const { total, pass, na, fix, fail, ask } = r.counts;
    assert.strictEqual(pass + na + fix + fail + ask, total);
  });

  it('空项目：auto 门禁判不过，human 门禁待确认', () => {
    const dir = mkProject();
    const r = evaluate(dir, pack);
    const by = new Map(r.gates.map((v) => [v.id, v]));

    assert.strictEqual(by.get('1.1').r, 'fail');
    assert.strictEqual(by.get('1.2').r, 'ask'); // human，没人确认过
    assert.ok(r.counts.ask >= 1);
  });

  it('阻断提问组：走到了的环节才拦路，还没走到的不拦', () => {
    const dir = mkProject();
    const r = evaluate(dir, pack);

    // test-pack 只有 1.2 是阻断组，落在环节一；空项目 currentStage=1，所以它该拦
    assert.deepStrictEqual(
      r.promptsPending.map((p) => p.id),
      ['1.2'],
      '环节一的阻断提问组该拦路'
    );

    // 环节三还没走到（notYetStages 含 3）。把 1.2 答掉、让 1.1 过掉，
    // 光标推进以前，环节三的门禁不许把项目判成"等你确认"
    assert.ok(r.notYetStages.includes(3), '前置条件：环节三应当还没走到');
    for (const p of r.promptsPending) {
      assert.ok(
        !r.notYetStages.includes(p.stage),
        `第 ${p.stage} 步还没走到，它的问题不该出现在待答列表里（${p.id}）`
      );
    }
  });

  it('产物齐了以后 auto 门禁转过', () => {
    const dir = mkProject();
    makeAllGreen(dir);
    const r = evaluate(dir, pack);
    const by = new Map(r.gates.map((v) => [v.id, v]));

    assert.strictEqual(by.get('1.1').r, 'pass');
    assert.strictEqual(by.get('2.1').r, 'pass');
    assert.strictEqual(by.get('3.1').r, 'pass');
    assert.strictEqual(by.get('3.2').r, 'pass');
  });

  it('每条结论都带 say（人能读懂的一句话）', () => {
    const dir = mkProject();
    const r = evaluate(dir, pack);
    for (const v of r.gates) {
      assert.strictEqual(typeof v.say, 'string', `${v.id} 没给 say`);
      assert.ok(v.say.length > 0, `${v.id} 的 say 是空的`);
      assert.ok(Object.hasOwn(VERDICT_LABEL, v.r), `${v.id} 的 r 不是五态之一：${v.r}`);
    }
  });
});
