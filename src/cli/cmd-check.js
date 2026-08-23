/**
 * check 命令 —— 查一遍这个项目卡在哪。
 *
 * 用法（§8.2）:
 *   webuddy check [--project 目录] [--scope all|stage:N|gate:ID|round:SID]
 *                 [--session sid] [--json] [--fail-on blocked|fail|needs-human]
 *
 * --json 与 HTTP 响应逐字节同构：两边共用 buildVerdict，这里不许另拼一套。
 * 人读输出走四段模板，文案过 applyGlossary；--json 永不替换（供 CI diff）。
 */

import path from 'node:path';
import process from 'node:process';
import { loadPack, resolvePack } from '../kernel/pack.js';
import { loadState, appendRecord, isPackFixture } from '../kernel/state.js';
import { evaluate } from '../kernel/evaluate.js';
import { buildVerdict, VERDICT_SAY } from '../kernel/verdict.js';
import { applyGlossary } from '../kernel/glossary.js';
import { roundStatus } from '../kernel/rounds.js';

/**
 * 着色。移植 ref render.js 的口径：不是终端（管道、重定向、CI）就不上色。
 * 带颜色的转义字符进了日志文件就是一堆乱码，比没颜色难读。
 */
const TTY = Boolean(process.stdout.isTTY);
const C = {
  red: (s) => (TTY ? `\x1b[31m${s}\x1b[0m` : s),
  yellow: (s) => (TTY ? `\x1b[33m${s}\x1b[0m` : s),
  green: (s) => (TTY ? `\x1b[32m${s}\x1b[0m` : s),
  dim: (s) => (TTY ? `\x1b[2m${s}\x1b[0m` : s),
};

/** 报错三段式（§2.5 铁律 5）：出了什么事 → 可能因为什么 → 怎么办 */
function sayError({ what, why, how }, json) {
  if (json) {
    console.log(JSON.stringify({ error: what, why, how }, null, 2));
  } else {
    console.error(`${what}\n可能是因为：${why}\n怎么办：${how}`);
  }
}

/** --fail-on 的档位顺序：blocked 最严，needs-human 最松 */
const FAIL_RANK = { blocked: 3, fail: 2, 'needs-human': 1, pass: 0 };

export async function run(positionals, flags) {
  const json = Boolean(flags.json);
  const projectDir = path.resolve(flags.project || positionals[0] || process.cwd());
  const scope = flags.scope || 'all';

  /**
   * 1. 找包。check 没有 --pack 选项（§8.2 的选项表里没有，分发器也已冻结）：
   * 用哪套检查清单是"挂载"这个动作决定的，不是每次查的时候临时选的。
   * 允许临时换的话，同一个项目两次查会得出不同结论，而人不会记得自己换过。
   */
  const packDir = resolvePack(null, projectDir);
  if (!packDir) {
    sayError({
      what: `不知道该用哪套检查清单来查 ${projectDir}。`,
      why: '这个项目还没挂过检查清单，命令里也没指定一套。',
      how: '先跑一次 webuddy pack mount <项目目录> software-engineering，挂上之后再查。',
    }, json);
    process.exit(1);
  }

  const loaded = await loadPack(packDir);
  if (!loaded.ok) {
    sayError({
      what: '这套检查清单本身有问题，没法用它来查。',
      why: loaded.errors.join('；'),
      how: `打开 ${packDir} 按上面每一条改，改完再跑一次。`,
    }, json);
    process.exit(1);
  }
  const pack = loaded.pack;

  // 2. 项目状态。没初始化过不是错，但要说清下一步干什么（§2.5 铁律 4）
  let state;
  try {
    state = loadState(projectDir);
  } catch (e) {
    sayError({
      what: `读不了 ${projectDir} 的记录文件。`,
      why: `文件内容不是完整的记录（${e.message}）；常见原因是手工改过或上次写到一半断电了。`,
      how: '把这个目录下 .webuddy/state.json 改回去；不确定改哪儿就把它删掉，重新挂一次检查清单。',
    }, json);
    process.exit(1);
  }
  if (!state) {
    sayError({
      what: `${projectDir} 还没在本工具里开过工，没有可查的东西。`,
      why: '这个目录下还没有记录文件，说明检查清单还没挂上来。',
      how: '跑一次 webuddy pack mount <项目目录> software-engineering，再回来查。',
    }, json);
    process.exit(1);
  }

  // 3. 轮次：scope=round:SID 或给了 --session 时，取该轮数据供 round-clean 用
  let round = null;
  const sid = flags.session || (/^round:(.+)$/.exec(scope)?.[1] ?? null);
  if (sid) {
    const rs = roundStatus(projectDir);
    round = (rs?.rounds || []).find((r) => r.sessionId === sid) || null;
  }

  // 4. 判定（纯函数，不落盘）
  const evalResult = evaluate(projectDir, pack, { scope, round });
  const verdict = buildVerdict(evalResult, pack);

  /**
   * 5. 落盘一条汇总（§2.4：records 归调用层，evaluate 不写盘）
   *
   * 两种情况不留档（I1a）：
   *   - 包自带的示例项目 —— 那是被 git 跟踪的素材，写进去仓库当场变脏；
   *   - 显式说了 --no-record —— 只想看一眼，不想在这个项目里留痕。
   * 结论照算照打，留不留档不进协议（--json 与 HTTP 的键集合都不变）。
   */
  const fixture = isPackFixture(projectDir);
  const noRecordFlag = Boolean(flags['no-record']);
  if (!fixture && !noRecordFlag) {
    try {
      appendRecord(projectDir, {
        kind: 'evaluate',
        scope,
        counts: verdict.counts,
        verdict: verdict.verdict,
        gateIds: {
          fail: evalResult.gates.filter((v) => v.r === 'fail').map((v) => v.id),
          ask: evalResult.gates.filter((v) => v.r === 'ask').map((v) => v.id),
        },
      });
    } catch {
      // 记不下留痕不该让人看不到结果。查的结论已经算出来了，照样打出来。
    }
  }

  if (json) {
    console.log(JSON.stringify(verdict, null, 2));
  } else {
    let note = null;
    if (fixture) note = '（这是示例项目，本次结论没有留档）';
    else if (noRecordFlag) note = '（这次只看不留档，项目里没有多出记录）';
    renderHuman(verdict, evalResult, pack, note);
  }

  // 6. 退出码。--fail-on 缺省 blocked
  const failOn = flags['fail-on'] || 'blocked';
  const threshold = FAIL_RANK[failOn];
  if (threshold === undefined) {
    sayError({
      what: `--fail-on 不认识 "${failOn}" 这个值。`,
      why: '它只收三种：blocked（有拦路的就算失败）、fail（有没过的就算失败）、needs-human（有等人确认的也算失败）。',
      how: '去掉这个选项就是默认的 blocked，或者改成上面三种之一。',
    }, json);
    process.exit(2);
  }
  process.exit(FAIL_RANK[verdict.verdict] >= threshold && threshold > 0 ? 1 : 0);
}

/**
 * 人读输出：四段模板（§8.2）。
 *
 * 顺序回答三问（§2.5 铁律 1）：我到哪一步了 → 卡在哪 → 下一步做什么。
 * 倒挂放最前面，因为它是"顺序错了"，比任何单条没过都急。
 */
function renderHuman(v, evalResult, pack, note = null) {
  const gl = pack.glossary || {};
  const g = (s) => applyGlossary(String(s ?? ''), gl);
  const out = [];

  // 第一段：我现在到哪一步了（含倒挂警告）
  const cur = evalResult.stages.find((s) => s.id === evalResult.currentStage);
  out.push('');
  out.push(g(`现在在第 ${evalResult.currentStage} 步${cur ? `：${cur.name}` : ''}`
    + `${cur ? `（这一步 ${cur.passed}/${cur.total} 过了）` : ''}`));

  if (v.inversion) {
    out.push(C.yellow(g(`⚠ 进度倒挂：第 ${v.inversion.apparentStage} 步在动，`
      + `但第 ${v.inversion.currentStage} 步还有窟窿：${v.inversion.say}`)));
  }
  for (const w of v.warnings) {
    if (w.kind === 'inversion') continue;
    out.push(C.yellow(g(`⚠ ${w.headline}`)));
  }

  // 第二段：卡在哪
  if (v.blockers.length === 0 && v.humanPending.length === 0) {
    out.push('');
    out.push(C.green(g('这一步没有卡住的地方。')));
  }
  for (const b of v.blockers) {
    out.push('');
    out.push(C.red(g(`✗ ${b.id} ${b.say}`)));
    if (b.how) out.push(g(`    怎么办：${b.how}`));
  }

  // 第三段：要你答一句的
  for (const h of v.humanPending) {
    const first = h.asks[0];
    out.push('');
    out.push(g(`? ${h.id} ${h.lead}${first ? `（答一句：${first.q}）` : ''}`));
  }

  // 第四段：一行总账 + 结论
  const c = v.counts;
  out.push('');
  out.push(C.dim(g(`${c.pass} 过 · ${c.failNow} 不过 · ${c.askNow} 待人答 · ${c.na} 不适用`)
    + ` —— 结论：${g(VERDICT_SAY[v.verdict] || v.verdict)}`));
  if (note) out.push(C.dim(g(note)));
  out.push('');

  console.log(out.join('\n'));
}
