/**
 * answer 命令端到端：真起进程、真临时目录，只看它吐出来的字节和落盘的结果。
 *
 * 为什么不直接调 run()：这条命令的对外承诺有三样函数调用看不见——
 * 退出码、报错是不是三段式、以及"答完之后 check 真的不再问同一条"。
 * 最后这一样是它存在的全部理由，所以必须跑完整条链路（answer → check）来验。
 *
 * 用施工安全包当素材，不用软件工程包：这条命令跟行业无关，
 * 挑一个自带阻断提问组（1.2 有 approval/approver 两问）的包最省事。
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

const CLI = path.resolve('bin/webuddy.js');
const PACK = path.resolve('packs/construction-safety');
const GOOD = path.join(PACK, 'fixtures/good');

/** 跑一次命令，退出码非 0 也照样把输出带回来——报错时退 1 是它的正常行为。 */
function webuddy(args, cwd) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { cwd, maxBuffer: 20e6 }, (err, stdout, stderr) => {
      resolve({ code: err?.code ?? 0, stdout, stderr });
    });
  });
}

function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name.startsWith('dot-') ? `.${e.name.slice(4)}` : e.name);
    if (e.isDirectory()) copyTree(s, d);
    else if (e.isFile()) fs.copyFileSync(s, d);
  }
}

describe('webuddy answer（§I3b）', () => {
  let tmp;
  let n = 0;

  /**
   * 每个用例一个全新项目：答一句是会落盘的，共用一个目录的话
   * 后跑的用例会看见前一个用例答过的话，测出来的东西就不作数了。
   *
   * 清空 records.jsonl 是关键一步：这个样板项目预置了 1.2/2.2/3.2 的
   * "人已确认"记录，不清掉的话三条 human 门禁全是 pass，
   * 也就没有任何"等你答"的问题可以拿来答。
   */
  async function newProj() {
    const proj = path.join(tmp, `proj-${++n}`);
    copyTree(GOOD, proj);
    const r = await webuddy(['pack', 'mount', proj, PACK], tmp);
    assert.equal(r.code, 0, `挂包失败：${r.stdout}${r.stderr}`);
    fs.writeFileSync(path.join(proj, '.webuddy/records.jsonl'), '', 'utf8');
    return proj;
  }

  /** check 的 --json 里，某条问题还剩哪几个键没答 */
  async function pendingKeys(proj, promptId) {
    const r = await webuddy(['check', '--project', proj, '--json'], tmp);
    const v = JSON.parse(r.stdout);
    const item = (v.humanPending || []).find((h) => h.id === promptId);
    return (item?.asks || []).map((a) => a.key);
  }

  function readState(proj) {
    return JSON.parse(fs.readFileSync(path.join(proj, '.webuddy/state.json'), 'utf8'));
  }

  function readRecords(proj) {
    return fs.readFileSync(path.join(proj, '.webuddy/records.jsonl'), 'utf8')
      .split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  }

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'webuddy-answer-'));
  });

  after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('答完之后，check 就不再问这几个键了', async () => {
    const proj = await newProj();
    assert.deepEqual(await pendingKeys(proj, '1.2'), ['approval', 'approver'], '前提不成立：1.2 本该有两问');

    const r = await webuddy(
      ['answer', '1.2', '--project', proj, '--set', 'approval=SP-2026-001', '--set', 'approver=张三'],
      tmp,
    );
    assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);

    assert.deepEqual(await pendingKeys(proj, '1.2'), [], '答过的键还在问');
  });

  test('--set 可以写多次，一次答完一组', async () => {
    const proj = await newProj();
    const r = await webuddy(
      ['answer', '1.2', '--project', proj, '--json', '--set', 'approval=SP-1', '--set', 'approver=李四'],
      tmp,
    );
    assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.saved, 2);
    assert.deepEqual(out.keys, ['approval', 'approver']);
    // 机器输出不做术语替换（§铁律），也就不该冒出人读文案里的引导句
    assert.ok(!/怎么办/.test(r.stdout), r.stdout);
  });

  test('答案里带等号：只按第一个等号切，值原样存下来', async () => {
    const proj = await newProj();
    const r = await webuddy(
      ['answer', '1.2', '--project', proj, '--set', 'approval=a=b=c'],
      tmp,
    );
    assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
    const st = readState(proj);
    assert.equal(st.answers['1.2'].approval, 'a=b=c');
  });

  test('落盘走的是 /v1/answers 那条路：state.answers 里有，records 里也留一条 answers', async () => {
    const proj = await newProj();
    await webuddy(['answer', '1.2', '--project', proj, '--set', 'approval=SP-9', '--set', 'approver=王五'], tmp);

    const st = readState(proj);
    // 只有一种形状：嵌套（T1 定的唯一事实源，evaluate 认的也是它）
    assert.deepEqual(st.answers['1.2'], { approval: 'SP-9', approver: '王五' });
    // 曾经还会同时写一份 "1.2.approval" 的副本，T3 删掉了。
    // 两种形状并存的时候，谁是准的这个问题迟早会有人答错。
    const doubled = Object.keys(st.answers).filter((k) => k.startsWith('1.2.'));
    assert.deepEqual(doubled, [], `落盘里不该再有副本键：${doubled.join('、')}`);

    const rec = readRecords(proj).filter((x) => x.kind === 'answers');
    assert.equal(rec.length, 1);
    assert.equal(rec[0].promptId, '1.2');
    assert.deepEqual(rec[0].keys, ['approval', 'approver']);
    assert.ok(Number.isFinite(Date.parse(rec[0].ts)));
    assert.equal(typeof rec[0].instanceVersion, 'number');
  });

  test('同一个键答两次：后写的算数', async () => {
    const proj = await newProj();
    await webuddy(['answer', '1.2', '--project', proj, '--set', 'approval=旧'], tmp);
    await webuddy(['answer', '1.2', '--project', proj, '--set', 'approval=新'], tmp);
    assert.equal(readState(proj).answers['1.2'].approval, '新');
  });

  test('条目号不认识时，把现在真正等着答的那几组摆出来', async () => {
    const proj = await newProj();
    const r = await webuddy(['answer', '9.9', '--project', proj, '--set', 'a=b'], tmp);
    assert.equal(r.code, 1);
    const out = r.stdout + r.stderr;
    assert.ok(out.includes('9.9'), out);
    assert.ok(out.includes('1.2'), `没列出真正等着答的条目：${out}`);
    assert.ok(out.includes('approval'), `没告诉人这条要答哪几个键：${out}`);
    // 答错号不该改动任何东西
    assert.equal(readState(proj).answers, undefined);
  });

  test('--set 里没有等号：报错按三段式说话', async () => {
    const proj = await newProj();
    const r = await webuddy(['answer', '1.2', '--project', proj, '--set', 'approval'], tmp);
    assert.equal(r.code, 1);
    const out = r.stdout + r.stderr;
    assert.ok(out.includes('approval'), out);
    assert.ok(out.includes('可能是因为'), `缺第二段：${out}`);
    assert.ok(out.includes('怎么办'), `缺第三段：${out}`);
    assert.equal(readState(proj).answers, undefined);
  });

  test('等号左边是空的，也按三段式挡住', async () => {
    const proj = await newProj();
    const r = await webuddy(['answer', '1.2', '--project', proj, '--set', '=没有键'], tmp);
    assert.equal(r.code, 1);
    const out = r.stdout + r.stderr;
    assert.ok(out.includes('可能是因为') && out.includes('怎么办'), out);
  });

  test('一个 --set 都没给时，把这条要答的键列出来', async () => {
    const proj = await newProj();
    const r = await webuddy(['answer', '1.2', '--project', proj], tmp);
    assert.equal(r.code, 1);
    const out = r.stdout + r.stderr;
    assert.ok(out.includes('approval') && out.includes('approver'), out);
  });

  test('--help 能用，打的是用法，不是「尚未实现」', async () => {
    const r = await webuddy(['answer', '--help'], tmp);
    assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
    assert.ok(!/尚未实现/.test(r.stdout + r.stderr), r.stdout + r.stderr);
    assert.ok(r.stdout.includes('--set'), r.stdout);
    assert.ok(r.stdout.includes('webuddy answer'), r.stdout);
  });

  test('没挂过检查清单的目录：说清是什么事、为什么、下一步干什么', async () => {
    const empty = path.join(tmp, 'nothing-here');
    fs.mkdirSync(empty, { recursive: true });
    const r = await webuddy(['answer', '1.2', '--project', empty, '--set', 'a=b'], tmp);
    assert.equal(r.code, 1);
    const out = r.stdout + r.stderr;
    assert.ok(out.includes('webuddy pack mount'), `没告诉人下一步怎么办：${out}`);
  });
});
