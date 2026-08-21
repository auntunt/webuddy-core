/**
 * webuddy recompile propose | apply <id> [--yes] | list（§7）
 *
 * propose 只提建议，不改任何东西；apply 才写骨架。中间那一步是人。
 * 破坏性说后果（易用性八铁律）：apply 会让旧的人工确认全部失效，
 * 这句话必须在点头之前说，不能等生效了再告诉人。
 */

import fs from 'node:fs';
import { loadPack } from '../kernel/pack.js';
import { loadState, statePath } from '../kernel/state.js';
import {
  propose, applyProposal, listProposals, loadProposal, renderProposal, shouldRecompile,
} from '../kernel/recompile.js';

function fail(msg, how) {
  console.error(msg);
  if (how) console.error(`怎么办：${how}`);
  process.exit(1);
}

async function pickPack(projectDir, flags) {
  const st = loadState(projectDir) || {};
  const dir = flags.pack || st.packDir || 'packs/software-engineering';
  if (!fs.existsSync(dir)) {
    fail(`找不到 ${dir} 这个检查清单。`, '先跑 webuddy pack mount，把清单挂到项目上。');
  }
  const r = await loadPack(dir);
  if (!r.ok) fail(`这个检查清单本身有问题：${(r.errors || []).join('；')}`);
  return r.pack;
}

export async function run(positionals, flags) {
  const sub = positionals[0];
  const projectDir = flags.project || process.cwd();

  if (flags.help || !sub) {
    console.log(`webuddy recompile — 让检查清单贴合这个项目的实际情况

  propose         看看清单该怎么调，出一份建议（不改任何东西）
  apply <编号>    让某份建议生效（会让旧的人工确认重新来一遍）
  list            列出提过的建议

  --project <目录>  哪个项目，缺省当前目录`);
    return;
  }

  if (!fs.existsSync(projectDir)) {
    fail(`找不到 ${projectDir} 这个目录。`);
  }

  if (sub === 'list') {
    const all = listProposals(projectDir);
    if (all.length === 0) {
      // 空状态即引导
      console.log('还没提过建议。');
      console.log('怎么办：跑一次 webuddy recompile propose，看看清单要不要调。');
      return;
    }
    if (flags.json) {
      console.log(JSON.stringify(all, null, 2));
      return;
    }
    for (const p of all) {
      const mark = p.status === 'applied' ? '已生效' : '等你点头';
      const n = (p.proposal?.na?.length || 0)
        + (p.proposal?.restore?.length || 0)
        + (p.proposal?.dims?.length || 0);
      console.log(`${p.id}  ${mark}  改动 ${n} 处  ${p.createdAt}`);
    }
    console.log('');
    console.log('看某一份：webuddy recompile apply <编号>（会先给你看清楚再问）');
    return;
  }

  if (sub === 'propose') {
    const pack = await pickPack(projectDir, flags);
    const trig = shouldRecompile(projectDir, pack);
    if (!trig.changed) {
      console.log('项目跟上次比没有变化，不用重新调整检查清单。');
      return;
    }
    const r = await propose(projectDir, pack, flags.desc || '', {});
    if (!r.ok) {
      // fail-closed：现状不变，且要说清是哪一步没成
      fail(r.why);
    }
    if (flags.json) {
      console.log(JSON.stringify(r.proposal, null, 2));
      return;
    }
    console.log(renderProposal(r.proposal, pack.glossary));
    console.log('');
    console.log(`要让它生效：webuddy recompile apply ${r.proposal.id}`);
    return;
  }

  if (sub === 'apply') {
    const id = positionals[1];
    if (!id) fail('要说清让哪一份建议生效。', '先跑 webuddy recompile list 看编号。');

    const p = loadProposal(projectDir, id);
    if (!p) fail(`找不到编号 ${id} 的建议。`, '跑 webuddy recompile list 看看有哪些编号。');

    const pack = await pickPack(projectDir, flags);

    // 破坏性操作说后果：先把要改什么、会失效什么摊开
    if (!flags.yes) {
      console.log(renderProposal(p, pack.glossary));
      console.log('');
      console.log(`确认无误就再跑一次，加上 --yes：webuddy recompile apply ${id} --yes`);
      return;
    }

    const r = applyProposal(projectDir, id, { approvedBy: flags.by || '' });
    if (!r.ok) fail(r.why);

    console.log(`生效了。检查清单从第 ${r.from} 版换到第 ${r.to} 版。`);
    console.log('你之前做过的人工确认要重新看一遍——跑 webuddy check 看还差哪些。');
    return;
  }

  fail(`recompile 没有 ${sub} 这个用法。`, '可用的是 propose、apply、list。');
}
