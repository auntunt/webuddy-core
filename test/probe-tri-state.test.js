/**
 * I2：探测表达式的第三种答案。
 *
 * 一条门禁"没过"这三个字，对人有三种完全不同的意思：
 *   你做错了（fail）、你还差一件事没做（fix）、机器看不准你自己看一眼（ask），
 * 再加上"这条跟你的项目无关"（na）。表达式本身只答"过 / 不过 / 不适用"，
 * 剩下的分档由门禁小节的「不过时算」决定。这个文件测的就是这两条机制，
 * 以及它们组合起来落到 counts 桶里的样子。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseProbe } from '../src/kernel/probe-dsl.js';
import { evalProbe } from '../src/kernel/probes.js';
import { loadPack } from '../src/kernel/pack.js';
import { evaluate } from '../src/kernel/evaluate.js';
import { buildVerdict } from '../src/kernel/verdict.js';

const TEST_PACK = path.resolve('test/fixtures/test-pack');

/** 现造一个项目目录，键是相对路径 */
function makeProject(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-tri-proj-'));
  for (const [rel, content] of Object.entries(files)) {
    const fp = path.join(dir, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, content, 'utf8');
  }
  return dir;
}

/**
 * 拷一份 test-pack，用给定内容顶掉 probes.md 里 1.1（必要时还有 1.2）那一节，
 * 其余小节原样留着 —— 包加载有一条硬校验「auto 门禁必须有探测实现」，
 * 整份换掉会让 2.1/3.1/3.2 集体没实现，报的错跟本文件要测的东西无关。
 */
function makePack(probesMd) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-tri-pack-'));
  for (const f of fs.readdirSync(TEST_PACK)) {
    fs.copyFileSync(path.join(TEST_PACK, f), path.join(dir, f));
  }
  const override = new Set([...probesMd.matchAll(/^###\s+(\d+\.\d+)/gm)].map((m) => m[1]));
  const kept = fs.readFileSync(path.join(TEST_PACK, 'probes.md'), 'utf8')
    .split(/^(?=###\s)/m)
    .filter((chunk) => {
      const m = /^###\s+(\d+\.\d+)/.exec(chunk);
      return !m || !override.has(m[1]);
    })
    .join('');
  fs.writeFileSync(path.join(dir, 'probes.md'), `${probesMd}\n${kept}`, 'utf8');
  return dir;
}

function ctxFor(dir) {
  return {
    dir,
    lexicons: {},
    round: null,
    art: (rel) => {
      const fp = path.join(dir, rel);
      if (!fs.existsSync(fp)) return { exists: false, raw: '', sections: [], tables: [], lists: [] };
      return { exists: true, raw: fs.readFileSync(fp, 'utf8'), sections: [], tables: [], lists: [] };
    },
  };
}

const run = (src, ctx) => {
  const p = parseProbe(src);
  assert.equal(p.ok, true, `表达式没解析出来：${p.why}`);
  return evalProbe(p.ast, ctx);
};

describe('applies-if：第 12 个原语的三个分支', () => {
  test('条件不成立 → 整条 na，而且话是正着说的', () => {
    const dir = makeProject({ 'other.md': 'x' });
    const r = run('applies-if(file-exists("清单.md"), file-exists("随便.md"))', ctxFor(dir));
    assert.equal(r.r, 'na');
    // 「找不到清单.md」听着像你少交了东西；na 要说的是这条跟你无关
    assert.match(r.detail, /这个项目没有 清单\.md/);
    assert.match(r.detail, /不用管/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('条件成立、正题也成立 → pass，detail 取正题的', () => {
    const dir = makeProject({ '清单.md': 'a', '随便.md': 'b' });
    const r = run('applies-if(file-exists("清单.md"), file-exists("随便.md"))', ctxFor(dir));
    assert.equal(r.r, 'pass');
    assert.match(r.detail, /随便\.md/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('条件成立、正题不成立 → fail，applies-if 不插话', () => {
    const dir = makeProject({ '清单.md': 'a' });
    const r = run('applies-if(file-exists("清单.md"), file-exists("随便.md"))', ctxFor(dir));
    assert.equal(r.r, 'fail');
    assert.match(r.detail, /找不到「随便\.md」/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('na 会传染：all / any / not 里出现 na，整条就是 na', () => {
    const dir = makeProject({ '有的.md': 'a' });
    const ctx = ctxFor(dir);
    const na = 'applies-if(file-exists("没有的.md"), file-exists("有的.md"))';
    assert.equal(run(`all(file-exists("有的.md"), ${na})`, ctx).r, 'na');
    assert.equal(run(`any(file-exists("没有的.md"), ${na})`, ctx).r, 'na');
    assert.equal(run(`not(${na})`, ctx).r, 'na');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('两个参数都必须是表达式，写成字符串在解析阶段就要拦下', () => {
    const bad = parseProbe('applies-if("清单.md", "随便.md")');
    assert.equal(bad.ok, false);
    assert.match(bad.why, /应该是一个探测表达式/);
    const arity = parseProbe('applies-if(file-exists("a"))');
    assert.equal(arity.ok, false);
    assert.match(arity.why, /至少需要 2 个参数/);
  });

  test('原语表满 12 条并封版：再加一个就得先说清为什么不降级 human', () => {
    const src = fs.readFileSync('src/kernel/probe-dsl.js', 'utf8');
    const table = src.slice(src.indexOf('const KNOWN_PROBES'), src.indexOf('* 语法分析'));
    const names = [...table.matchAll(/^\s*'([a-z-]+)':\s*\{/gm)].map((m) => m[1]);
    const connectives = ['all', 'any', 'not'];
    const primitives = names.filter((n) => !connectives.includes(n));
    assert.equal(primitives.length, 12, `原语应恰好 12 个，现在是 ${primitives.length}：${primitives.join('、')}`);
    assert.ok(primitives.includes('applies-if'));
    assert.doesNotMatch(src, /保留空位/, 'probe-dsl.js 里不该再提"保留空位"');
  });
});

describe('不过时算：门禁级的分档映射', () => {
  const PROBE_FIX = '### 1.1\n不过时算: fix\nfile-exists("需求文档.md")\n';
  const PROBE_ASK = '### 1.1\n不过时算: ask\nfile-exists("需求文档.md")\n';
  const PROBE_PLAIN = '### 1.1\nfile-exists("需求文档.md")\n';

  async function judge(probesMd, projFiles = {}) {
    const packDir = makePack(probesMd);
    const loaded = await loadPack(packDir);
    assert.equal(loaded.ok, true, `包没加载起来：${(loaded.errors || []).join('；')}`);
    const proj = makeProject(projFiles);
    const res = evaluate(proj, loaded.pack, {});
    const v = res.gates.find((g) => g.id === '1.1');
    fs.rmSync(packDir, { recursive: true, force: true });
    fs.rmSync(proj, { recursive: true, force: true });
    return { gate: v, res, pack: loaded.pack };
  }

  test('缺省不写：表达式没过就是 fail', async () => {
    const { gate } = await judge(PROBE_PLAIN);
    assert.equal(gate.r, 'fail');
  });

  test('写 fix：同一个表达式、同一个项目，落成"还差一件事"', async () => {
    const { gate } = await judge(PROBE_FIX);
    assert.equal(gate.r, 'fix');
    assert.match(gate.say, /需求文档\.md/, '话还是探测说的那句，只是档变了');
  });

  test('写 ask：落成"你自己看一眼"，并说清机器为什么看不准', async () => {
    const { gate } = await judge(PROBE_ASK);
    assert.equal(gate.r, 'ask');
    assert.match(gate.say, /机器看不准/);
    assert.match(gate.say, /需求文档\.md/, '得把机器看到的事实一起交出来');
  });

  test('pass 不受映射影响：档位只改"没过"这一档', async () => {
    const { gate } = await judge(PROBE_FIX, { '需求文档.md': '有了' });
    assert.equal(gate.r, 'pass');
  });

  test('值只认 fix 和 ask，写别的在加载包时就报错', async () => {
    const packDir = makePack('### 1.1\n不过时算: 随便\nfile-exists("需求文档.md")\n');
    const loaded = await loadPack(packDir);
    assert.equal(loaded.ok, false);
    assert.ok(loaded.errors.some((e) => /只认 fix 或 ask/.test(e)), loaded.errors.join('；'));
    fs.rmSync(packDir, { recursive: true, force: true });
  });

  test('human 门禁的小节里写了「不过时算」就是死配置，加载时报错', async () => {
    // 1.2 在 test-pack 的 SKILL.md 里是 human 门禁：它根本不走探测表达式
    const packDir = makePack('### 1.1\nfile-exists("需求文档.md")\n\n### 1.2\n不过时算: ask\nfile-exists("评审记录.md")\n');
    const loaded = await loadPack(packDir);
    assert.equal(loaded.ok, false);
    assert.ok(
      loaded.errors.some((e) => /是 human 门禁/.test(e) && /不会生效/.test(e)),
      loaded.errors.join('；')
    );
    fs.rmSync(packDir, { recursive: true, force: true });
  });

  test('ask 映射的门禁有自己的提问组时，用提问组的话，不用兜底那句', async () => {
    // test-pack 的 prompts.md 给 1.2 写了提问组；这里把它挪到 1.1 上验证沿用
    const packDir = makePack('### 1.1\n不过时算: ask\nfile-exists("需求文档.md")\n');
    const promptsPath = path.join(packDir, 'prompts.md');
    const orig = fs.readFileSync(promptsPath, 'utf8');
    fs.writeFileSync(promptsPath, `${orig}\n\n### 1.1\n开场: 这条得你去现场看一眼\n- [看过没] 你去看过了吗？ | 为何: 机器进不去现场\n`, 'utf8');
    const loaded = await loadPack(packDir);
    assert.equal(loaded.ok, true, (loaded.errors || []).join('；'));
    const proj = makeProject({});
    const res = evaluate(proj, loaded.pack, {});
    const gate = res.gates.find((g) => g.id === '1.1');
    assert.equal(gate.r, 'ask');
    assert.equal(gate.say, '这条得你去现场看一眼');
    const v = buildVerdict(res, loaded.pack);
    const item = v.humanPending.find((h) => h.id === '1.1');
    assert.ok(item, 'ask 门禁必须出现在待人答里');
    assert.ok(item.asks.length > 0, '有提问组就得把问题一起端出来');
    fs.rmSync(packDir, { recursive: true, force: true });
    fs.rmSync(proj, { recursive: true, force: true });
  });

  test('applies-if 判出的 na 进 counts.na，不算"没过"', async () => {
    const packDir = makePack('### 1.1\napplies-if(file-exists("清单.md"), file-exists("需求文档.md"))\n');
    const loaded = await loadPack(packDir);
    assert.equal(loaded.ok, true, (loaded.errors || []).join('；'));

    const withList = makeProject({ '清单.md': 'a' });   // 条件成立 → 正题不成立 → fail
    const without = makeProject({});                     // 条件不成立 → na
    const a = evaluate(withList, loaded.pack, {});
    const b = evaluate(without, loaded.pack, {});

    assert.equal(a.gates.find((g) => g.id === '1.1').r, 'fail');
    assert.equal(b.gates.find((g) => g.id === '1.1').r, 'na');
    assert.equal(b.counts.na, a.counts.na + 1, 'na 得进 counts.na 那个桶');
    assert.equal(b.counts.fail, a.counts.fail - 1, '同时不能还算在 fail 里');

    fs.rmSync(packDir, { recursive: true, force: true });
    fs.rmSync(withList, { recursive: true, force: true });
    fs.rmSync(without, { recursive: true, force: true });
  });
});
