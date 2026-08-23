/**
 * §5.5 与参照实现对数。
 *
 * golden 是拿参照实现自己的 json 命令生成后冻结的（scripts/gen-golden-from-ref.mjs）。
 * 冻结的意思是：这几个数字此后只许实现去迁就，不许反过来改数字迁就实现。
 * 一旦这里红了，先假定是新实现判错了，而不是 golden 过期了。
 *
 * 只比"影响结论"的字段：counts 的各桶（含 Now 系列）、currentStage、
 * inversionGap、apparentStage、逐环节状态。不比 say/how 那些人读文案——
 * 文案本来就要按易用性铁律重写，逐字对齐会把改文案变成改判定。
 *
 * 三个素材：
 *   b-modeling            —— 走到中段的项目，规格领先代码
 *   construction-project  —— 刚起步的项目，几乎全红
 *   inverted              —— 自造的倒挂项目，规格在第一环节、代码摸到第五环节
 *
 * 模式固定 mvp、挂钩状态由 fixture 里有没有 events.jsonl 决定：
 * golden 就是在这个口径下生成的，换口径等于换了一套题。
 */

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadPack } from '../src/kernel/pack.js';
import { evaluate } from '../src/kernel/evaluate.js';

const HERE = import.meta.dirname;

/** golden 文件头上有说明用的 // 注释行，JSON.parse 不认，读的时候去掉。 */
function readGolden(name) {
  const raw = fs.readFileSync(path.join(HERE, 'golden', `${name}.json`), 'utf8');
  return JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''));
}

const CASES = [
  { name: 'b-modeling', dir: path.join(HERE, 'fixtures', 'golden-src', 'b-modeling') },
  { name: 'construction-project', dir: path.join(HERE, 'fixtures', 'golden-src', 'construction-project') },
  { name: 'inverted', dir: path.join(HERE, 'fixtures', 'inverted') },
];

let pack = null;

before(async () => {
  const res = await loadPack(path.join(HERE, '..', 'packs', 'software-engineering'));
  assert.equal(res.ok, true, `担架包没加载起来：${(res.errors || []).join('；')}`);
  pack = res.pack;
});

for (const c of CASES) {
  test(`${c.name}：counts 与参照实现逐字段相等`, () => {
    const g = readGolden(c.name);
    const r = evaluate(c.dir, pack, { mode: 'mvp' });

    for (const k of Object.keys(g.counts)) {
      assert.equal(
        r.counts[k], g.counts[k],
        `counts.${k} 对不上：参照实现 ${g.counts[k]}，本实现 ${r.counts[k]}`
      );
    }
  });

  test(`${c.name}：环节推进与倒挂程度与参照实现相等`, () => {
    const g = readGolden(c.name);
    const r = evaluate(c.dir, pack, { mode: 'mvp' });

    assert.equal(r.currentStage, g.currentStage, '走到第几个环节对不上');
    assert.equal(r.apparentStage, g.apparentStage, '看着像走到第几个环节对不上');
    assert.equal(r.inversionGap, g.inversionGap, '倒挂几个环节对不上');
  });

  test(`${c.name}：逐环节的状态与条数与参照实现相等`, () => {
    const g = readGolden(c.name);
    const r = evaluate(c.dir, pack, { mode: 'mvp' });
    const mine = new Map(r.stages.map((s) => [s.id, s]));

    assert.equal(r.stages.length, g.stages.length, '环节个数对不上');
    for (const gs of g.stages) {
      const ms = mine.get(gs.id);
      assert.ok(ms, `少了第 ${gs.id} 个环节`);
      assert.equal(ms.state, gs.state, `第 ${gs.id} 个环节的状态对不上`);
      assert.equal(ms.total, gs.total, `第 ${gs.id} 个环节的门禁条数对不上`);
      assert.equal(ms.passed, gs.passed, `第 ${gs.id} 个环节过了几条对不上`);
      assert.equal(ms.na, gs.na, `第 ${gs.id} 个环节不适用几条对不上`);
    }
  });
}

/**
 * I1b：头注说的话得是真的。
 *
 * 冻结之前这三个文件的头注写着"一次性脚本，产出后已删除"，而脚本一直在
 * scripts/ 下躺着 —— 照着注释找的人会以为再也复核不了，于是没人复核，
 * ref 漂了也没人知道。注释错了跟数据错了不一样，但同样会误导人。
 */
test('golden 头注指的生成脚本真的在，且说清了重跑的后果', () => {
  const script = path.join(HERE, '..', 'scripts', 'gen-golden-from-ref.mjs');
  assert.ok(fs.existsSync(script), '头注指着的 scripts/gen-golden-from-ref.mjs 不存在');

  for (const c of CASES) {
    const raw = fs.readFileSync(path.join(HERE, 'golden', `${c.name}.json`), 'utf8');
    const header = raw.split('\n').filter((l) => l.trim().startsWith('//')).join('\n');
    assert.match(header, /scripts\/gen-golden-from-ref\.mjs/, `${c.name} 头注里没写生成脚本`);
    assert.doesNotMatch(header, /产出后已删除/, `${c.name} 头注还在说脚本已删除，可脚本就在 scripts\/ 下`);
    assert.match(header, /重跑会覆盖/, `${c.name} 头注要说清重跑的后果`);
  }
});
