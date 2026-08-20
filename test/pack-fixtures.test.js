/**
 * runPackFixtures（§11.2）：包自己带的两个样板项目，一个该全过，一个该按名单红。
 *
 * 这套测试真正要守的是"包自测本身信不信得过"。包自测是给写包的人用的唯一一道
 * 自动关卡——如果它对着一个缺东西的样板项目也说通过，那后面所有包都是在没有
 * 秤的情况下称重。所以这里既测它认得出好包，也测它认得出被动过的包。
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPackFixtures } from '../src/kernel/pack.js';

const SE = 'packs/software-engineering';

/** 把包整个拷一份出来，好在副本上动手脚，不碰仓库里的原件。 */
function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyTree(s, d);
    else if (e.isFile()) fs.copyFileSync(s, d);
  }
}

describe('runPackFixtures（§11.2 包自测）', () => {
  let tmp;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'webuddy-packfx-'));
  });

  test('软件工程包过自测：good 全过，broken 正好红该红的', async () => {
    const r = await runPackFixtures(SE);
    assert.equal(r.ok, true, `包自测没过：\n${r.report.join('\n')}`);
    assert.ok(r.report.some((l) => l.includes('good/ 通过')), r.report.join('\n'));
    assert.ok(r.report.some((l) => l.includes('broken/ 通过')), r.report.join('\n'));
  });

  test('报告是给人看的：不出现英文字段名和大括号', async () => {
    const r = await runPackFixtures(SE);
    for (const line of r.report) {
      assert.ok(!/counts|failNow|hardFailsNow|\{|\}/.test(line), `这行不像人话：${line}`);
    }
  });

  test('good 里少一份产物就该被抓出来（不能冤枉好项目 = 也不能放过坏的）', async () => {
    const dir = path.join(tmp, 'pack-missing-artifact');
    copyTree(SE, dir);
    fs.rmSync(path.join(dir, 'fixtures/good/artifacts/01-scope-card.md'));

    const r = await runPackFixtures(dir);
    assert.equal(r.ok, false);
    assert.ok(r.report.some((l) => l.includes('good/ 没通过')), r.report.join('\n'));
  });

  test('broken 的 mustFail 少列一条 = 误报，要报出来是哪一条', async () => {
    const dir = path.join(tmp, 'pack-missed-entry');
    copyTree(SE, dir);
    const p = path.join(dir, 'fixtures/broken/expected.json');
    const exp = JSON.parse(fs.readFileSync(p, 'utf8'));
    const dropped = exp.mustFail.pop();
    fs.writeFileSync(p, JSON.stringify(exp, null, 2));

    const r = await runPackFixtures(dir);
    assert.equal(r.ok, false);
    const joined = r.report.join('\n');
    assert.ok(joined.includes('误报'), joined);
    assert.ok(joined.includes(dropped), `没点名到 ${dropped}：${joined}`);
  });

  test('broken 里把错改好了 = 漏报，也不能过', async () => {
    const dir = path.join(tmp, 'pack-fixed-broken');
    copyTree(SE, dir);
    const p = path.join(dir, 'fixtures/broken/package.json');
    const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
    pkg.dependencies.express = '4.19.2'; // 把没锁版本这处改好
    fs.writeFileSync(p, JSON.stringify(pkg, null, 2));

    const r = await runPackFixtures(dir);
    assert.equal(r.ok, false);
    const joined = r.report.join('\n');
    assert.ok(joined.includes('漏报'), joined);
    assert.ok(joined.includes('4.5'), joined);
  });

  test('mustFail 是空清单不算验过', async () => {
    const dir = path.join(tmp, 'pack-empty-must');
    copyTree(SE, dir);
    const p = path.join(dir, 'fixtures/broken/expected.json');
    fs.writeFileSync(p, JSON.stringify({ mustFail: [] }, null, 2));

    const r = await runPackFixtures(dir);
    assert.equal(r.ok, false);
    assert.ok(r.report.join('\n').includes('空清单'), r.report.join('\n'));
  });

  test('缺 fixtures 目录时说清缺什么、要放哪两个目录', async () => {
    const dir = path.join(tmp, 'pack-no-fixtures');
    copyTree(SE, dir);
    fs.rmSync(path.join(dir, 'fixtures'), { recursive: true });

    const r = await runPackFixtures(dir);
    assert.equal(r.ok, false);
    assert.ok(r.report.join('\n').includes('fixtures'), r.report.join('\n'));
  });

  test('源目录只读：跑完自测，仓库里的 fixtures 一个字节都没变', async () => {
    const stamp = (rel) => {
      const p = path.join(SE, rel);
      const st = fs.statSync(p);
      return `${st.size}:${st.mtimeMs}`;
    };
    const before = ['fixtures/good/.webuddy/records.jsonl', 'fixtures/broken/expected.json'].map(stamp);
    await runPackFixtures(SE);
    const after = ['fixtures/good/.webuddy/records.jsonl', 'fixtures/broken/expected.json'].map(stamp);
    assert.deepEqual(after, before, 'fixtures 源目录被写过了，判定必须在临时目录里跑');
  });
});
