/**
 * answer 命令 —— 把看板上那几条"等你答一句"的问题，在终端里答掉。
 *
 * 用法（§I3b）:
 *   webuddy answer <条目号> --set 键=值 [--set 键=值 …] [--project 目录] [--json]
 *
 * 为什么单开一条命令：日常回路是零终端的（看板上点两下就答了），
 * 但脚本、CI、以及"服务起不来的时候"也得能答，不然人就卡死在一条问题上。
 * 所以这条命令走的是跟 POST /v1/answers 一模一样的写入路径：
 * loadState → 合并 answers → saveState → appendRecord({kind:'answers'})。
 * 两边任何一边私自换个存法，答完的问题在另一边就会又冒出来。
 */

import path from 'node:path';
import process from 'node:process';
import { loadPack, resolvePack } from '../kernel/pack.js';
import { loadState, saveState, appendRecord } from '../kernel/state.js';
import { evaluate } from '../kernel/evaluate.js';
import { applyGlossary } from '../kernel/glossary.js';

/** 报错三段式（§2.5 铁律 5）：出了什么事 → 可能因为什么 → 怎么办 */
function sayError({ what, why, how }, json) {
  if (json) {
    console.log(JSON.stringify({ error: what, why, how }, null, 2));
  } else {
    console.error(`${what}\n可能是因为：${why}\n怎么办：${how}`);
  }
}

const USAGE = `回答看板上的待确认问题

用法：
  webuddy answer <条目号> --set 键=值 [--set 键=值 ...]

例子：
  webuddy answer 1.2 --set approval=SP-2026-001 --set approver=张三

选项：
  --set 键=值     答一条。可以写多次，一次答完一组问题。
                  值里带等号也行，只按第一个等号切开。
  --project 目录  要答哪个项目的问题（默认是当前目录）。
  --json          机器读的输出（给脚本用，人看的话不用加）。

不知道该答哪条：先跑 webuddy check，它会把等你答的那几条列出来。`;

/**
 * 把还等着人答的几组问题列出来。
 * 条目号打错的时候光说"没这条"没用——人不知道正确的号是什么，
 * 得把现在真正等着答的摆到眼前，让他直接照抄一个。
 */
function pendingGroups(projectDir, pack) {
  try {
    const r = evaluate(projectDir, pack, { scope: 'all' });
    return r.promptsPending || [];
  } catch {
    // 判定挂了不该连"答一句"都做不成，就当没有可推荐的条目
    return [];
  }
}

function describePending(groups, gl) {
  const g = (s) => applyGlossary(String(s ?? ''), gl);
  if (groups.length === 0) return '现在没有等着你答的问题（跑一次 webuddy check 看看到哪一步了）。';
  const lines = [`现在等着你答的有 ${groups.length} 组：`];
  for (const p of groups) {
    lines.push(`  ${p.id}（第 ${p.stage} 步）${g(p.lead)}`);
    for (const a of p.asks || []) lines.push(`      --set ${a.key}=…  ${g(a.q)}`);
  }
  return lines.join('\n');
}

export async function run(positionals, flags) {
  const json = Boolean(flags.json);

  if (flags.help) {
    console.log(USAGE);
    process.exit(0);
  }

  const projectDir = path.resolve(flags.project || process.cwd());

  // 1. 找包。跟 check 一个口径：用哪套清单是"挂载"决定的，不是这里临时选的。
  const packDir = resolvePack(null, projectDir);
  if (!packDir) {
    sayError({
      what: `不知道 ${projectDir} 用的是哪套检查清单，没法确认你答的是哪条。`,
      why: '这个项目还没挂过检查清单。',
      how: '先跑一次 webuddy pack mount <项目目录> software-engineering，挂上之后再答。',
    }, json);
    process.exit(1);
  }

  const loaded = await loadPack(packDir);
  if (!loaded.ok) {
    sayError({
      what: '这套检查清单本身有问题，没法用它来对号。',
      why: loaded.errors.join('；'),
      how: `打开 ${packDir} 按上面每一条改，改完再答。`,
    }, json);
    process.exit(1);
  }
  const pack = loaded.pack;
  const gl = pack.glossary || {};

  // 2. 项目得先开过工，不然 answers 存进去也没人读
  let state;
  try {
    state = loadState(projectDir);
  } catch (e) {
    sayError({
      what: `读不了 ${projectDir} 的记录文件，你答的话没地方存。`,
      why: `文件内容不是完整的记录（${e.message}）；常见原因是手工改过或上次写到一半断电了。`,
      how: '把这个目录下 .webuddy/state.json 改回去；不确定改哪儿就把它删掉，重新挂一次检查清单。',
    }, json);
    process.exit(1);
  }
  if (!state) {
    sayError({
      what: `${projectDir} 还没在本工具里开过工，没有可答的问题。`,
      why: '这个目录下还没有记录文件，说明检查清单还没挂上来。',
      how: '跑一次 webuddy pack mount <项目目录> software-engineering，再回来答。',
    }, json);
    process.exit(1);
  }

  // 3. 条目号
  const promptId = positionals[0];
  if (!promptId) {
    sayError({
      what: '没说要答哪一条。',
      why: '这条命令第一个位置要写条目号，比如 webuddy answer 1.2 --set approval=SP-001。',
      how: describePending(pendingGroups(projectDir, pack), gl),
    }, json);
    process.exit(1);
  }

  const prompt = (pack.prompts || []).find((p) => String(p.id) === String(promptId));
  if (!prompt) {
    sayError({
      what: `这套检查清单里没有 ${promptId} 这条问题。`,
      why: '条目号可能打错了，或者它是另一套清单里的号。',
      how: describePending(pendingGroups(projectDir, pack), gl),
    }, json);
    process.exit(1);
  }

  // 4. --set 拆键值。
  //    只按第一个等号切：值里本来就可能有等号（路径、口令、公式），
  //    按最后一个或者全部切开的话，人得给自己的答案转义，那不合理。
  const raw = flags.set === undefined ? [] : (Array.isArray(flags.set) ? flags.set : [flags.set]);
  if (raw.length === 0) {
    const asks = (prompt.asks || []).map((a) => `  --set ${a.key}=…  ${applyGlossary(a.q, gl)}`);
    sayError({
      what: `说了要答 ${promptId}，但一个答案都没给。`,
      why: '答案要写成 --set 键=值 的样子，命令里没有这一段。',
      how: asks.length
        ? `这条要答的是：\n${asks.join('\n')}`
        : `这条没有可填的项，直接跑 webuddy check 看看它现在的状态。`,
    }, json);
    process.exit(1);
  }

  const ans = {};
  for (const item of raw) {
    const at = String(item).indexOf('=');
    if (at <= 0) {
      sayError({
        what: `--set 后面这段看不懂：${item}`,
        why: at < 0
          ? '它里面没有等号，工具分不出哪半截是问题、哪半截是你的答案。'
          : '等号左边是空的，不知道这是在答哪个问题。',
        how: `写成 --set 键=值，比如 --set ${(prompt.asks || [])[0]?.key || 'done'}=你的答案。`
          + '（值里可以带等号，只按第一个等号切开。）',
      }, json);
      process.exit(1);
    }
    // 同一个键写了两次：后写的算数，跟人改口的直觉一致
    ans[String(item).slice(0, at)] = String(item).slice(at + 1);
  }

  /**
   * 5. 写盘 —— 与 POST /v1/answers 同一条路径（loadState / saveState / appendRecord）。
   *
   * 只有一种形状：answers[条目号][键]。evaluate.js 的 findPromptsPending 认的
   * 就是它，答完了 check 才不会接着问同一条。
   *
   * 这里曾经同时写一份 "条目号.键" 的平铺副本，为的是跟当时 api.js 的写法兼容。
   * 那个不一致已经在 T2 修掉了（api.js 改写嵌套，老账由 loadState 读的时候折过来），
   * 所以副本删了：两种形状并存的时候，谁是准的这个问题迟早会有人答错。
   */
  const all = state.answers && typeof state.answers === 'object' ? { ...state.answers } : {};
  const group = all[promptId] && typeof all[promptId] === 'object' ? { ...all[promptId] } : {};
  for (const k of Object.keys(ans)) group[k] = ans[k];
  all[promptId] = group;

  saveState(projectDir, { answers: all });
  appendRecord(projectDir, { kind: 'answers', promptId, keys: Object.keys(ans) });

  const keys = Object.keys(ans);
  if (json) {
    console.log(JSON.stringify({ ok: true, promptId, saved: keys.length, keys }, null, 2));
  } else {
    // 答完之后还剩几条，是人最想知道的下一句
    const left = pendingGroups(projectDir, pack);
    const g = (s) => applyGlossary(String(s ?? ''), gl);
    const out = [];
    out.push(`记下了：${promptId} 答了 ${keys.length} 条（${keys.join('、')}）。`);
    if (left.length === 0) {
      out.push('没有别的问题等着你了，下一步跑 webuddy check 看看现在到哪一步。');
    } else {
      out.push(`还有 ${left.length} 组等着你答：${left.map((p) => p.id).join('、')}`);
      const first = left[0];
      const firstKey = (first.asks || [])[0]?.key;
      out.push(g(`下一条是 ${first.id}：${first.lead}`));
      if (firstKey) out.push(`答它就跑：webuddy answer ${first.id} --set ${firstKey}=你的答案`);
    }
    console.log(out.join('\n'));
  }
  process.exit(0);
}
