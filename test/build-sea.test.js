/**
 * 单文件可执行程序的构建脚本（scripts/build-sea.mjs）。
 *
 * 这里不真造可执行文件 —— 那要下载 100 多 MB 的 Node 二进制、还要 postject 和签名，
 * 那一步归 .github/workflows/release.yml，CI 上每次发版都会真跑一遍并冒烟。
 * 这个文件只管构建脚本自己：产出的引导代码语法对不对、载荷里东西全不全。
 *
 * 为什么值得单独测：引导代码是拼字符串拼出来的，写的时候在注释里搁一个反引号
 * 就会把模板字符串提前闭合，而错误要等到运行构建脚本才暴露。
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

const SCRIPT = path.resolve('scripts/build-sea.mjs');

describe('scripts/build-sea.mjs', () => {
  let out;
  let boot;
  let manifest;

  before(() => {
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'webuddy-sea-'));
    execFileSync(process.execPath, [SCRIPT, out], { encoding: 'utf8' });
    boot = fs.readFileSync(path.join(out, 'sea-main.js'), 'utf8');
    const b64 = /const PAYLOAD = "([^"]+)"/.exec(boot);
    assert.ok(b64, '引导代码里找不到载荷');
    manifest = JSON.parse(zlib.gunzipSync(Buffer.from(b64[1], 'base64')).toString('utf8'));
  });

  after(() => {
    fs.rmSync(out, { recursive: true, force: true });
  });

  test('产出的引导代码是合法的 CommonJS', () => {
    // SEA 的入口只能是 CJS：实测 .mjs 入口会在运行时报 Unexpected token 'export'
    const f = path.join(out, 'check.cjs');
    fs.writeFileSync(f, boot, 'utf8');
    // --check 把 .cjs 按 CommonJS 解析，混进 ESM 语法这里就抛了
    execFileSync(process.execPath, ['--check', f]);
    // 再看一眼源码本身：注释里会出现「import JSON 模块」这类字样，先剥掉注释
    const code = boot
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, /^\s*(import|export)\s/m, '引导代码里不该出现 ESM 的 import/export 语句');
    assert.match(code, /require\('node:fs'\)/);
  });

  test('跑起来要用的东西一个不少', () => {
    const need = [
      'package.json',
      'bin/webuddy.js',
      'src/kernel/pack.js',
      'src/kernel/glossary-base.json', // pack.js 用 import ... with{type:'json'} 读它，漏了就起不来
      'src/server/api.js',
      'src/cli/cmd-open.js',
      'web/app.js',
      'web/index.html',
      'web/style.css',
    ];
    for (const f of need) assert.ok(manifest[f], `载荷里缺 ${f}`);
  });

  test('三套清单连同它们的样板项目都带上了', () => {
    for (const p of ['construction-safety', 'financial-audit', 'software-engineering']) {
      assert.ok(manifest[`packs/${p}/pack.json`], `缺 packs/${p}/pack.json`);
      assert.ok(manifest[`packs/${p}/probes.md`], `缺 packs/${p}/probes.md`);
    }
    // fixtures 必须在：webuddy demo 就是拿 fixtures/broken 拷出练习项目的
    const fixtures = Object.keys(manifest).filter((k) => k.includes('/fixtures/'));
    assert.ok(fixtures.length > 20, `样板项目文件太少（${fixtures.length} 个），demo 会拷不出东西`);
  });

  test('测试文件不进包：用户不跑测试', () => {
    const leaked = Object.keys(manifest).filter((k) => k.startsWith('test/') || k.startsWith('.ref/'));
    assert.deepEqual(leaked, [], `不该带进去的东西：${leaked.join('、')}`);
  });

  test('sea-config 关掉了代码缓存，32 位包才能在 64 位机器上打出来', () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(out, 'sea-config.json'), 'utf8'));
    assert.equal(cfg.useCodeCache, false, '代码缓存是跟 CPU 架构绑的，开着就没法跨架构注入');
    assert.equal(path.basename(cfg.main), 'sea-main.js');
    assert.ok(fs.existsSync(cfg.main), 'sea-config 指的入口文件不存在');
  });

  test('引导代码不写死任何人的家目录，也不往仓库里落东西', () => {
    assert.doesNotMatch(boot, /\/Users\/[a-z]/i, '引导代码里写死了某台机器的路径');
    assert.match(boot, /LOCALAPPDATA/, 'Windows 上要落在 %LOCALAPPDATA%');
    assert.match(boot, /Application Support/, 'macOS 上要落在 ~/Library/Application Support');
  });
});
