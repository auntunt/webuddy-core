/**
 * check 命令端到端：真起一个进程，在真目录上跑，只看它吐出来的字节。
 *
 * 为什么不直接调 run()：这条命令的对外承诺有三样是函数调用看不见的——
 * 退出码、--json 的字节形状、人读输出里有没有把术语翻成人话。
 * 这三样恰好是 CI 和界面唯一依赖的东西，所以必须按人怎么用它就怎么测。
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

const CLI = path.resolve('bin/webuddy.js');
const SE = path.resolve('packs/software-engineering');
const GOOD = path.join(SE, 'fixtures/good');

/** 跑一次命令，退出码非 0 也照样把输出带回来——判据不过时退 1 是它的正常行为。 */
function webuddy(args, cwd) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { cwd, maxBuffer: 20e6 }, (err, stdout, stderr) => {
      resolve({ code: err?.code ?? 0, stdout, stderr });
    });
  });
}

/** dot-<名字> 还原成 .<名字>，跟内核拷 fixtures 时的约定一致。 */
function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name.startsWith('dot-') ? `.${e.name.slice(4)}` : e.name);
    if (e.isDirectory()) copyTree(s, d);
    else if (e.isFile()) fs.copyFileSync(s, d);
  }
}

describe('webuddy check（§5.4 协议 + §8.2 输出）', () => {
  let tmp;
  let proj;

  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'webuddy-check-'));
    proj = path.join(tmp, 'proj');
    copyTree(GOOD, proj);
    // 样板项目里的 state.json 记的是 fixtures 里那个包路径，重新挂一次指到真包上
    const r = await webuddy(['pack', 'mount', proj, SE], tmp);
    assert.equal(r.code, 0, `挂包失败：${r.stdout}${r.stderr}`);
  });

  after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('--json 的键正好是 §5.4 列的那些，一个不多一个不少', async () => {
    const r = await webuddy(['check', '--json'], proj);
    const v = JSON.parse(r.stdout);
    assert.deepEqual(
      Object.keys(v).sort(),
      ['blockers', 'counts', 'humanPending', 'instanceVersion', 'inversion', 'pack', 'trace', 'verdict', 'warnings'],
    );
  });

  test('counts 正好八个桶（§5.4 写死的那八个）', async () => {
    const r = await webuddy(['check', '--json'], proj);
    const v = JSON.parse(r.stdout);
    assert.deepEqual(
      Object.keys(v.counts).sort(),
      ['ask', 'askNow', 'fail', 'failNow', 'fix', 'fixNow', 'na', 'pass'],
    );
    for (const [k, n] of Object.entries(v.counts)) {
      assert.equal(typeof n, 'number', `counts.${k} 不是数字`);
    }
  });

  test('全绿的项目：verdict=pass，退出码 0，没有拦路的也没有等确认的', async () => {
    const r = await webuddy(['check', '--json'], proj);
    const v = JSON.parse(r.stdout);
    assert.equal(v.verdict, 'pass');
    assert.equal(r.code, 0);
    assert.deepEqual(v.blockers, []);
    assert.deepEqual(v.humanPending, []);
    assert.equal(v.counts.failNow, 0);
  });

  test('trace 四个字段都在，evaluatedAt 是个能解析的时间', async () => {
    const r = await webuddy(['check', '--json'], proj);
    const { trace } = JSON.parse(r.stdout);
    assert.deepEqual(Object.keys(trace).sort(), ['durationMs', 'evaluatedAt', 'factsFingerprint', 'scope']);
    assert.ok(Number.isFinite(Date.parse(trace.evaluatedAt)), trace.evaluatedAt);
    assert.equal(trace.scope, 'all');
  });

  test('人读输出按三问的顺序说话，不吐英文字段名', async () => {
    const r = await webuddy(['check'], proj);
    assert.equal(r.code, 0);
    assert.ok(!/failNow|hardFailsNow|verdict":/.test(r.stdout), r.stdout);
    assert.ok(r.stdout.trim().length > 0);
  });

  test('查不认识的目录时，说清是什么事、为什么、下一步干什么', async () => {
    const empty = path.join(tmp, 'nothing-here');
    fs.mkdirSync(empty, { recursive: true });
    const r = await webuddy(['check'], empty);
    assert.equal(r.code, 1);
    const out = r.stdout + r.stderr;
    assert.ok(out.includes('webuddy pack mount'), `没告诉人下一步怎么办：${out}`);
  });

  test('--fail-on 给了不认识的值时退 2，并列出收哪三种', async () => {
    const r = await webuddy(['check', '--fail-on', '随便'], proj);
    assert.equal(r.code, 2);
    const out = r.stdout + r.stderr;
    assert.ok(out.includes('blocked'), out);
    assert.ok(out.includes('needs-human'), out);
  });

  test('每查一次就留一条痕，记的 counts 跟当时报的一致', async () => {
    const recPath = path.join(proj, '.webuddy', 'records.jsonl');
    const countEval = () => fs.readFileSync(recPath, 'utf8').split('\n')
      .filter((l) => l.trim()).map((l) => JSON.parse(l))
      .filter((x) => x.kind === 'evaluate');

    const before = countEval().length;
    const r = await webuddy(['check', '--json'], proj);
    const after = countEval();
    assert.equal(after.length, before + 1);
    assert.deepEqual(after.at(-1).counts, JSON.parse(r.stdout).counts);
  });

  test('--json 两次跑出来除了 trace 之外完全一样（判定是纯函数）', async () => {
    const a = JSON.parse((await webuddy(['check', '--json'], proj)).stdout);
    const b = JSON.parse((await webuddy(['check', '--json'], proj)).stdout);
    delete a.trace; delete b.trace;
    assert.deepEqual(a, b);
  });

  test('术语替换只在人读那一层：人读说「检查项」，--json 里还是原词（§5.4 边界）', async () => {
    // 拿 broken 那份来测：它有红项，红项的文案里才有词可替
    const pk = path.join(tmp, 'pack-with-glossary');
    copyTree(SE, pk);
    // glossary.json 是一张平铺的对照表（§3.1 就写着 {"门禁":"检查项"}）
    fs.writeFileSync(path.join(pk, 'glossary.json'), JSON.stringify({ 场景卡: '需求单' }, null, 2));
    const p2 = path.join(tmp, 'proj-glossary');
    copyTree(path.join(SE, 'fixtures/broken'), p2);
    fs.rmSync(path.join(p2, 'expected.json'));
    assert.equal((await webuddy(['pack', 'mount', p2, pk], tmp)).code, 0);

    const human = (await webuddy(['check'], p2)).stdout;
    const raw = (await webuddy(['check', '--json'], p2)).stdout;

    assert.ok(human.includes('需求单'), `人读没替换：${human}`);
    assert.ok(!human.includes('场景卡'), `人读还留着原词：${human}`);
    assert.ok(raw.includes('场景卡'), '--json 被替换了，CI 就没法拿它对 diff');
    assert.ok(!raw.includes('需求单'), '--json 被替换了，CI 就没法拿它对 diff');
  });
});

/**
 * I1a：什么时候留档、什么时候不留。
 *
 * 留档这件事不进协议 —— --json 的键集合一个不变，只看 records.jsonl 长没长。
 */
describe('check 的留档开关（I1a）', () => {
  let tmp;
  let proj;

  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'webuddy-record-'));
    proj = path.join(tmp, 'proj');
    copyTree(GOOD, proj);
    const r = await webuddy(['pack', 'mount', proj, SE], tmp);
    assert.equal(r.code, 0, `挂包失败：${r.stdout}${r.stderr}`);
  });

  after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const countRecords = () => {
    const f = path.join(proj, '.webuddy', 'records.jsonl');
    if (!fs.existsSync(f)) return 0;
    return fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).length;
  };

  test('普通项目照旧留档', async () => {
    const before_ = countRecords();
    await webuddy(['check'], proj);
    assert.equal(countRecords(), before_ + 1, '普通项目查一次就该多一条留痕');
  });

  test('--no-record 查完一行都不多', async () => {
    const before_ = countRecords();
    const r = await webuddy(['check', '--no-record'], proj);
    assert.equal(countRecords(), before_, '说了不留档就一行都不许多');
    assert.match(r.stdout, /只看不留档/, '要在尾行说清这次没留档');
  });

  test('--no-record 不改变 --json 的键集合', async () => {
    const a = JSON.parse((await webuddy(['check', '--json'], proj)).stdout);
    const b = JSON.parse((await webuddy(['check', '--json', '--no-record'], proj)).stdout);
    assert.deepEqual(Object.keys(b).sort(), Object.keys(a).sort(), '留不留档不进协议');
  });

  test('包自带的示例项目查两次都不留档，仓库不变脏', async () => {
    const fixture = path.join(SE, 'fixtures', 'broken');
    const recPath = path.join(fixture, '.webuddy', 'records.jsonl');
    const before_ = fs.existsSync(recPath) ? fs.readFileSync(recPath, 'utf8') : null;

    // cwd 必须是仓库根：resolvePack 找不到包就直接报错退出，根本走不到留档那一步
    const repoRoot = path.resolve('.');
    const r1 = await webuddy(['check', '--project', fixture], repoRoot);
    await webuddy(['check', '--project', fixture], repoRoot);

    const after_ = fs.existsSync(recPath) ? fs.readFileSync(recPath, 'utf8') : null;
    assert.equal(after_, before_, 'fixtures 里的留痕文件一个字节都不许变');
    assert.match(r1.stdout, /示例项目/, '要告诉人这次为什么没留档');
  });
});
