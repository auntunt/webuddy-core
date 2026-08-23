/**
 * 把整个应用打成一个单文件可执行程序（Node SEA）。
 *
 * 为什么是"自解压"而不是"把代码编译进去"：
 * 这个程序有两处天生做不到静态打包——
 *   1. bin/webuddy.js 用 `import(join(__dirname,'../src/cli', 模块+'.js'))` 分发命令，
 *   2. pack.js 用 `import(pathToFileURL(包目录/native-rules.js))` 加载包自己的判据。
 * 两处的路径都是运行时算出来的，任何打包器都静态分析不出来。硬要打包就得改这两处，
 * 而 bin/webuddy.js 是冻结的、pack.js 是内核。
 *
 * 所以走另一条：可执行文件里塞一份整个应用的压缩包，第一次跑的时候解到用户目录下，
 * 之后 chdir 过去、动态 import 那份 bin/webuddy.js。对现有代码零改动，
 * 也不需要引任何打包器 —— dependencies/devDependencies 照旧恒空。
 *
 * 用法：node scripts/build-sea.mjs <输出目录>
 * 产出：<输出目录>/sea-main.js（SEA 的入口，CommonJS）+ sea-config.json
 * 之后由 CI 接手：node --experimental-sea-config → 拷 node 二进制 → postject 注入 → 签名。
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'tmp-sea-build'));

/**
 * 要带进可执行文件的东西。
 * packs/ 里的 fixtures 必须带上：webuddy demo 就是拿 fixtures/broken 拷出练习项目的。
 * test/ 不带 —— 用户不跑测试，带上白白多几百 K。
 */
const INCLUDE = ['bin', 'src', 'packs', 'web', 'package.json'];
const SKIP_DIRS = new Set(['node_modules', '.git', '.ref']);

function walk(rel, acc) {
  const abs = path.join(ROOT, rel);
  const st = fs.statSync(abs);
  if (st.isDirectory()) {
    if (SKIP_DIRS.has(path.basename(abs))) return acc;
    for (const e of fs.readdirSync(abs).sort()) walk(path.join(rel, e), acc);
  } else if (st.isFile()) {
    acc.push(rel);
  }
  return acc;
}

const files = INCLUDE.flatMap((p) => walk(p, []));
if (files.length === 0) throw new Error('一个文件都没收集到，检查 INCLUDE');

// 文件表：相对路径 → base64 内容。用 JSON 而不是 tar：tar 得自己写一个写入器，
// 而这里只需要"路径 + 内容"两样，JSON 加 gzip 已经够小了。
const manifest = {};
for (const rel of files) {
  manifest[rel.split(path.sep).join('/')] = fs.readFileSync(path.join(ROOT, rel)).toString('base64');
}
const raw = Buffer.from(JSON.stringify(manifest), 'utf8');
const packed = zlib.gzipSync(raw, { level: 9 });
// 内容哈希当版本号：换一版可执行文件就解到新目录，不会跟旧版混在一起
const stamp = crypto.createHash('sha256').update(packed).digest('hex').slice(0, 12);
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

const boot = `/**
 * 单文件可执行程序的引导（构建产物，由 scripts/build-sea.mjs 生成，别手改）。
 * SEA 的入口只能是 CommonJS —— 实测 .mjs 入口会在运行时报 "Unexpected token 'export'"。
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { pathToFileURL } = require('node:url');

const STAMP = ${JSON.stringify(stamp)};
const VERSION = ${JSON.stringify(version)};
const PAYLOAD = ${JSON.stringify(packed.toString('base64'))};

/** 解到哪儿：各系统放"应用自己的数据"的标准位置，不往桌面或下载目录里撒东西。 */
function installRoot() {
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir();
    return path.join(base, 'WeBuddy');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'WeBuddy');
  }
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'WeBuddy');
}

const HOME_DIR = path.join(installRoot(), VERSION + '-' + STAMP);
const DONE = path.join(HOME_DIR, '.installed');
/** 检查清单的全局位置。pack.js 的 resolvePack 第 3 条查的就是这儿。 */
const GLOBAL_PACKS = path.join(process.env.HOME || process.env.USERPROFILE || os.homedir(), '.webuddy', 'packs');

/**
 * 解压。原子：先解到同级的临时目录再整体 rename，
 * 中途被强退不会留下一个"解了一半"的目录 —— 那种目录下次跑会被当成装好了。
 */
function extract() {
  if (fs.existsSync(DONE)) return;
  const tmp = HOME_DIR + '.tmp-' + process.pid;
  fs.rmSync(tmp, { recursive: true, force: true });
  const manifest = JSON.parse(zlib.gunzipSync(Buffer.from(PAYLOAD, 'base64')).toString('utf8'));
  for (const rel of Object.keys(manifest)) {
    const dest = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(manifest[rel], 'base64'));
  }
  fs.writeFileSync(path.join(tmp, '.installed'), STAMP, 'utf8');
  fs.mkdirSync(path.dirname(HOME_DIR), { recursive: true });
  fs.rmSync(HOME_DIR, { recursive: true, force: true });
  fs.renameSync(tmp, HOME_DIR);
}

/**
 * 把自带的检查清单挂到 ~/.webuddy/packs/ 下。
 *
 * 为什么走这条而不是 chdir 到安装目录：resolvePack 先查 cwd/packs/ 再查
 * ~/.webuddy/packs/。chdir 过去确实能让它找到清单，但代价是用户在自己项目里敲
 * webuddy check 时，"当前目录"变成了安装目录 —— 它会去查程序自己，而不是他的项目。
 * 挂到全局位置就没这个副作用：清单到处都找得到，当前目录还是用户的。
 *
 * 用链接不用拷贝：省掉一份 1.2 MB 的副本，也不会出现"升级了程序、清单还是旧的"。
 * Windows 上用 junction —— 普通符号链接要管理员权限，junction 不要。
 */
function linkPacks() {
  const src = path.join(HOME_DIR, 'packs');
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(GLOBAL_PACKS, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (!fs.existsSync(path.join(src, name, 'pack.json'))) continue;
    const dst = path.join(GLOBAL_PACKS, name);
    let cur = null;
    try { cur = fs.readlinkSync(dst); } catch { cur = null; }
    if (cur === path.join(src, name)) continue;
    // 已经有同名的东西（旧版本的链接，或者用户自己放的）就先让开
    if (cur !== null || fs.existsSync(dst)) {
      // 用户自己手放的目录不动它：那是他的东西，覆盖掉等于把他的清单删了
      if (cur === null) continue;
      fs.rmSync(dst, { recursive: true, force: true });
    }
    try {
      fs.symlinkSync(path.join(src, name), dst, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      // 链接建不了（少见的文件系统）就退回拷一份，功能比省空间重要
      fs.cpSync(path.join(src, name), dst, { recursive: true });
    }
  }
}

/**
 * 内置的 Node 22 对「import JSON 模块」还会打一句实验特性警告
 * （src/kernel/pack.js 与 src/server/api.js 都这么读 glossary-base.json）。
 * 目标用户看不懂这句，也无从处理，等于噪音 —— 而这个程序对外的每一句话
 * 都该是他能照着做的。只滤实验特性这一类，真警告照旧打出来。
 */
function quietExperimentalWarnings() {
  process.removeAllListeners('warning');
  process.on('warning', (w) => {
    if (w && w.name === 'ExperimentalWarning') return;
    console.error(w && w.stack ? w.stack : String(w));
  });
}

async function main() {
  quietExperimentalWarnings();
  try {
    extract();
    linkPacks();
  } catch (e) {
    console.error('WeBuddy 没能把自己装好。');
    console.error('可能是因为：' + HOME_DIR + ' 这个位置写不进去（磁盘满了，或者被安全软件挡住了）。');
    console.error('怎么办：把这句话连同下面这行转给技术同事——' + e.message);
    process.exit(1);
  }

  /**
   * 双击打开时一个参数都没有，这时候默认开看板。
   * argv 在 SEA 里是 [可执行文件, 可执行文件, ...真参数]，
   * 所以 bin/webuddy.js 里的 process.argv.slice(2) 拿到的正好是真参数，不用改它。
   */
  if (process.argv.length <= 2) process.argv = [process.argv[0], process.argv[1], 'open'];

  // 不 chdir：当前目录得留着是用户的，不然他在自己项目里敲 check 会查到程序头上。
  // 检查清单由 linkPacks() 挂到全局位置，到处都找得到。
  await import(pathToFileURL(path.join(HOME_DIR, 'bin', 'webuddy.js')).href);
}

main();
`;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'sea-main.js'), boot, 'utf8');
fs.writeFileSync(
  path.join(OUT, 'sea-config.json'),
  `${JSON.stringify({
    main: path.join(OUT, 'sea-main.js'),
    output: path.join(OUT, 'sea-prep.blob'),
    // 代码缓存是跟 CPU 架构绑的。关掉之后同一个 blob 能注进任意架构的 node，
    // Windows 32 位的包才能在 64 位的 CI 机器上打出来。
    useCodeCache: false,
    disableExperimentalSEAWarning: true,
  }, null, 2)}\n`,
  'utf8',
);

console.log(`收了 ${files.length} 个文件，压完 ${(packed.length / 1024).toFixed(0)} KB，版本戳 ${version}-${stamp}`);
console.log(`产出：${path.relative(ROOT, path.join(OUT, 'sea-main.js'))}、${path.relative(ROOT, path.join(OUT, 'sea-config.json'))}`);
