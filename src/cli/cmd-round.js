/**
 * webuddy round start|end|abort|status —— 一轮活的开工与交活。
 *
 * 面向的是助手（multica 里的 AI 会话），不是人：人的日常回路在看板上，
 * 一个终端命令都不用打。所以这里的输出以"下一步该干什么"为主，
 * 违规要说清是哪几个文件——只说"有违规"的话，助手会原地重试而不是去改。
 */

import fs from 'node:fs';
import path from 'node:path';
import { startRound, endRound, abortRound, roundStatus } from '../kernel/rounds.js';
import { loadPack, resolvePack } from '../kernel/pack.js';
import { appendRecord } from '../kernel/state.js';

function fail(msg, how) {
  console.error(msg);
  if (how) console.error(`怎么办：${how}`);
  process.exit(1);
}

/** 拿包的 hints：快照要靠它才知道怎么数用例、依赖写在哪 */
async function packHints(projectDir) {
  const packDir = resolvePack(null, projectDir);
  if (!packDir) return {};
  const loaded = await loadPack(packDir);
  return loaded.ok ? loaded.pack.hints || {} : {};
}

function relTime(iso) {
  if (!iso) return '刚刚';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

export async function run(positionals, flags) {
  const sub = positionals[0];
  const projectDir = path.resolve(flags.project || process.cwd());

  if (flags.help || !sub) {
    console.log(`webuddy round — 一轮活的开工与交活

  round start --session <助手编号> [--files a.js,b.js] [--gate 3.2]
  round end   --session <助手编号>
  round abort --session <助手编号>
  round status [--json]`);
    return;
  }

  if (!fs.existsSync(projectDir)) {
    fail(`找不到 ${projectDir} 这个目录。`, '换一个 --project 再来。');
  }

  if (sub === 'status') {
    const rounds = roundStatus(projectDir);
    if (flags.json) {
      console.log(JSON.stringify({ rounds }, null, 2));
      return;
    }
    const live = rounds.filter((r) => !r.endedAt && !r.aborted);
    if (live.length === 0) {
      console.log('现在没有助手在干活。');
      return;
    }
    for (const r of live) {
      const n = (r.files || []).length;
      const what = n > 0 ? `正在改 ${n} 个文件` : '在干活，还没说要改哪些文件';
      console.log(`${r.sessionId} ${what}，从 ${relTime(r.startedAt)} 开始`);
      for (const v of r.violations || []) console.log(`  ！${v.say || v.kind}`);
    }
    return;
  }

  const sid = flags.session;
  if (!sid) {
    fail('不知道是哪个助手在干这一轮活。', '加上 --session <助手编号> 再来。');
  }

  if (sub === 'start') {
    const files = Array.isArray(flags.files) ? flags.files : [];
    const r = startRound(projectDir, sid, {
      files,
      gateId: flags.gate || '',
      hints: await packHints(projectDir),
    });
    if (!r.ok) {
      fail(r.error, '别人正改着这些文件，等他交活，或者换几个文件改。');
    }
    console.log(`开工了。记下了 ${r.fileCount} 个文件现在的样子。`);
    console.log('改完跑一次 webuddy round end --session ' + sid + ' 交活。');
    return;
  }

  if (sub === 'end') {
    const r = endRound(projectDir, sid, { hints: await packHints(projectDir) });
    if (!r.ok) fail(r.error, '先跑 webuddy round start 开工，再交活。');

    if (r.violations.length === 0) {
      console.log('交活了，没发现问题。');
      console.log('接着跑一次 webuddy check 看看现在到哪一步了。');
      return;
    }
    console.log(`交活了，但有 ${r.violations.length} 处要说一下：`);
    for (const v of r.violations) console.log(`  ！${v.say || v.kind}`);
    console.log('怎么办：把上面每一条改回去，或者说清为什么必须这么改。');
    return;
  }

  if (sub === 'abort') {
    const r = abortRound(projectDir, sid);
    if (!r.ok) fail(r.error, '这个助手手上没有开着的活，不用中止。');
    try {
      appendRecord(projectDir, { kind: 'round-abort', sessionId: sid });
    } catch {
      // 留痕失败不该让中止本身看起来没成
    }
    console.log('这一轮活中止了，认领的文件放开了。');
    return;
  }

  fail(`没有 round ${sub} 这个用法。`, '可用：start、end、abort、status。');
}
