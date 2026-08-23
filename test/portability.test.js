/**
 * 跨平台守卫：几类"在 POSIX 上恰好能用、在 Windows 上必炸"的写法。
 *
 * 这个文件是 v0.1.0 发版时 Windows 两格红了才补的。当时的表现是
 * 每一条命令都起不来，报「Only URLs with a scheme in: file, data, and node
 * are supported by the default ESM loader. Received protocol 'd:'」——
 * 因为 bin/webuddy.js 把 D:\...\cmd-pack.js 这种绝对路径直接喂给了动态 import。
 * 在 macOS 上同一行代码工作得好好的，所以它错了很久没人发现。
 *
 * 这类错的共同点：本机跑一万遍也测不出来。所以改成从源码上直接禁掉写法。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/** 递归收集某几个目录下的 .js/.mjs */
function collect(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', '.git', '.ref', 'fixtures'].includes(e.name)) continue;
      collect(p, acc);
    } else if (/\.(js|mjs)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

const SOURCES = ['src', 'bin', 'scripts'].flatMap((d) => collect(path.resolve(d)));
// 排除本文件：它的正则字面量里就写着要禁的那几种写法，扫自己必然命中
const SELF = path.resolve('test/portability.test.js');
const TESTS = collect(path.resolve('test')).filter((f) => f !== SELF);

/** 去掉注释，免得注释里举的反例被当成真代码 */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('跨平台守卫', () => {
  test('动态 import 一律走 file:// URL，不喂裸的绝对路径', () => {
    const bad = [];
    for (const f of SOURCES) {
      const src = strip(fs.readFileSync(f, 'utf8'));
      for (const m of src.matchAll(/\bimport\(([^)]*)\)/g)) {
        const arg = m[1].trim();
        // 静态字符串字面量（'./x.js'、'node:fs'）没问题，那是模块说明符
        if (/^['"][^'"]*['"]$/.test(arg)) continue;
        // 走了 pathToFileURL 的没问题
        if (/pathToFileURL/.test(arg)) continue;
        // 已经是 file:// 开头的模板串也行
        if (/^`file:\/\//.test(arg)) continue;
        // 先存进变量再 import 的（const url = pathToFileURL(p).href; import(url)）
        // 也算数 —— 顺着变量名往上看一眼它是怎么来的
        if (/^[A-Za-z_$][\w$]*$/.test(arg)) {
          const assigned = new RegExp(`\\b${arg}\\s*=[^;\n]*pathToFileURL`);
          if (assigned.test(src)) continue;
        }
        bad.push(`${path.relative(process.cwd(), f)}: import(${arg.slice(0, 60)})`);
      }
    }
    assert.deepEqual(bad, [], `这些动态 import 在 Windows 上会把盘符当协议名：\n  ${bad.join('\n  ')}`);
  });

  test('不用 new URL(import.meta.url).pathname 求目录', () => {
    // Windows 上它给的是 /D:/a/... —— 带一个前导斜杠，path.join 拼出来的路径不存在。
    // 要当前文件所在目录就用 import.meta.dirname，要路径就用 fileURLToPath。
    const bad = [];
    for (const f of [...SOURCES, ...TESTS]) {
      const src = strip(fs.readFileSync(f, 'utf8'));
      if (/new URL\(\s*import\.meta\.url\s*\)\s*\.pathname/.test(src)) {
        bad.push(path.relative(process.cwd(), f));
      }
    }
    assert.deepEqual(bad, [], `这些文件在 Windows 上会算出带前导斜杠的假路径：${bad.join('、')}`);
  });

  test('测试里顶替家目录时，HOME 和 USERPROFILE 要一起设', () => {
    // Windows 上 os.homedir() 读的是 %USERPROFILE%，只设 HOME 会让
    // registry.js（走 os.homedir()）和 pack.js（走 HOME || USERPROFILE）指到两个地方
    const bad = [];
    for (const f of TESTS) {
      const src = strip(fs.readFileSync(f, 'utf8'));
      if (/\bHOME:\s/.test(src) && !/USERPROFILE:\s/.test(src)) {
        bad.push(path.relative(process.cwd(), f));
      }
    }
    assert.deepEqual(bad, [], `这些测试只设了 HOME，Windows 上顶不掉家目录：${bad.join('、')}`);
  });
});
