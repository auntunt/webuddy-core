/**
 * 用 ref 自己的 json 命令产出 golden（§5.5 条件 2）。脚本留在 scripts/ 下：
 * golden 冻结之后它的用途从"生成"变成"复核"——重跑一次跟冻结的数据体 diff，
 * 能抓出 ref 版本漂移。重跑会覆盖 test/golden/*.json，须经 DECISIONS 记录后才允许。
 *
 * 为什么必须由 ref 产出而不是新内核产出：golden 的作用是"新内核判得跟旧的一样"。
 * 拿新内核自己的输出当 golden，等于让考生自己出答案，测试永远是绿的。
 *
 * 用法：node scripts/gen-golden-from-ref.mjs [输出目录]
 * 产出：<输出目录>/{b-modeling,construction-project,inverted}.json，缺省 test/golden/
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const REF_CLI = path.join(ROOT, 'ref/webuddy-console/bin/webuddy.js');
const SRC_DIRS = {
  'b-modeling': 'test/fixtures/golden-src/b-modeling',
  'construction-project': 'test/fixtures/golden-src/construction-project',
  inverted: 'test/fixtures/inverted',
};
// 复核时传一个临时目录进来，就不会碰到冻结的那三个文件。
const OUT_DIR = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, 'test/golden');

/**
 * 字段名映射（新内核 ← ref），写进 golden 头注，供以后对账。
 *
 * ref 的 counts 里有 blockingNow，新内核没有这个桶：ref 把"阻断级且现在该管"
 * 数成一个数，新内核改成 hardFailsNow 数组（要能点开看是哪几条），
 * 所以不进 golden 的逐字段比对。
 */
const MAPPING = [
  '字段名映射（左 = 新内核 §5.2/§5.4，右 = ref json 输出）：',
  '  counts.failNow      ← counts.failNow',
  '  counts.fixNow       ← counts.fixNow',
  '  counts.askNow       ← counts.askNow',
  '  counts.pass/na/fix/fail/ask ← 同名',
  '  currentStage        ← currentStage',
  '  apparentStage       ← apparentStage',
  '  inversionGap        ← inversionGap',
  '  stages[].{id,state,total,passed,na} ← 同名',
  '  hardFailsNow(数组)  ← counts.blockingNow(计数) —— 形状不同，不逐字段比',
];

function refJson(dir) {
  const out = execFileSync('node', [REF_CLI, 'json', path.join(ROOT, dir)], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(out);
}

/** 只取 verdict 相关字段。scannedAt / dir 这类每次都变的不进 golden。 */
function pick(j) {
  const c = j.counts || {};
  return {
    currentStage: j.currentStage,
    apparentStage: j.apparentStage,
    inversionGap: j.inversionGap,
    counts: {
      pass: c.pass, na: c.na, fix: c.fix, fail: c.fail, ask: c.ask,
      failNow: c.failNow, fixNow: c.fixNow, askNow: c.askNow,
    },
    stages: (j.stages || []).map((s) => ({
      id: s.id, state: s.state, total: s.total, passed: s.passed, na: s.na,
    })),
  };
}

fs.mkdirSync(OUT_DIR, { recursive: true });

for (const [name, dir] of Object.entries(SRC_DIRS)) {
  const picked = pick(refJson(dir));
  const header = [
    '// golden：由 ref/webuddy-console 的 json 命令产出，已冻结（§5.5 条件 4）。',
    `// 来源 fixture：${dir}`,
    '// 生成命令：node scripts/gen-golden-from-ref.mjs（脚本存 scripts/，重跑会覆盖，须经 DECISIONS 记录后才允许）',
    '//',
    ...MAPPING.map((l) => `// ${l}`),
    '',
  ].join('\n');
  const body = JSON.stringify(picked, null, 2);
  fs.writeFileSync(path.join(OUT_DIR, `${name}.json`), `${header}${body}\n`);
  console.log(`写入 ${path.relative(ROOT, path.join(OUT_DIR, `${name}.json`))}`);
}
