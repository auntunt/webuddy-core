/**
 * P6 判据：骨架重编译器的六条硬约束。
 *
 * 全部用 mock relay 注入，不连网络。真实临时目录（mkdtemp），不 mock fs。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPack } from '../src/kernel/pack.js';
import { statePath, readRecords, appendRecord } from '../src/kernel/state.js';
import { evaluate } from '../src/kernel/evaluate.js';
import {
  propose, applyProposal, listProposals, renderProposal,
  shouldRecompile, loadSkeleton, vetProposal, admitDim, judgePremises,
} from '../src/kernel/recompile.js';

const PACK_DIR = 'packs/construction-safety';

/** 一个有产物、能算出非空指纹的项目 */
function makeProject(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-recompile-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, '安全记录'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '安全记录', '培训签到表.md'),
    '## 参训人员\n\n张三、李四\n\n本项目新增了高空作业环节。\n',
    'utf8'
  );
  return dir;
}

/** 固定返回一份建议的 mock relay */
function mockRelay(value) {
  return async () => ({ value, model: 'mock', usage: null, formatMode: 'schema' });
}

/** 直接抛错的 mock relay（模拟超时） */
function failingRelay(message) {
  return async () => { throw new Error(message); };
}

async function getPack() {
  const r = await loadPack(PACK_DIR);
  assert.equal(r.ok, true, '演示包应该能加载');
  return r.pack;
}

test('P6-1: na 掉 block 门禁被剔除', async (t) => {
  const dir = makeProject(t);
  const pack = await getPack();

  const blockGate = pack.gates.find((g) => g.severity === 'block');
  const warnGate = pack.gates.find((g) => g.severity === 'warn');
  assert.ok(blockGate && warnGate, '演示包里应该同时有 block 和 warn 门禁');

  const r = await propose(dir, pack, '项目情况说明', {
    relay: mockRelay({ na: [blockGate.id, warnGate.id], restore: [], dims: [] }),
  });

  assert.equal(r.ok, true, r.why);
  assert.ok(
    !r.proposal.proposal.na.includes(blockGate.id),
    `block 档门禁 ${blockGate.id} 不该被标成不适用`
  );
  assert.ok(
    r.proposal.proposal.na.includes(warnGate.id),
    `warn 档门禁 ${warnGate.id} 应该保留在 na 里`
  );
  const why = r.proposal.dropped.find((d) => d.id === blockGate.id)?.why || '';
  assert.match(why, /底线/, '剔除原因要说人话');
});

test('P6-2: 幻觉锚点被 admit 丢弃，逐字命中的留下', async (t) => {
  const dir = makeProject(t);
  const pack = await getPack();
  const gid = pack.gates[0].id;

  const r = await propose(dir, pack, '项目情况说明', {
    relay: mockRelay({
      na: [],
      restore: [],
      dims: [
        { gateId: gid, anchor: '高空作业', anchorKind: '环节', question: '高空作业的防护措施谁验收？' },
        { gateId: gid, anchor: '水下爆破', anchorKind: '环节', question: '这个项目里根本没有的东西' },
      ],
    }),
  });

  assert.equal(r.ok, true, r.why);
  const anchors = r.proposal.proposal.dims.map((d) => d.anchor);
  assert.deepEqual(anchors, ['高空作业'], '只有产物里逐字出现的锚点能留下');
  const dropped = r.proposal.dropped.find((d) => d.anchor === '水下爆破');
  assert.ok(dropped, '编造的锚点要记在没采纳清单里');
  assert.match(dropped.why, /找不到/, '要说清为什么没采纳');
});

test('P6-3: 模型失败/超时后现状不变', async (t) => {
  const dir = makeProject(t);
  const pack = await getPack();

  const before = {
    skeleton: fs.existsSync(statePath(dir, 'skeleton.json')),
    proposals: listProposals(dir).length,
    records: readRecords(dir).length,
  };

  const r = await propose(dir, pack, '项目情况说明', {
    relay: failingRelay('模型 90 秒内没有返回'),
  });

  assert.equal(r.ok, false, '模型失败时不该返回成功');
  assert.match(r.why, /没能给出建议/);
  assert.equal(
    fs.existsSync(statePath(dir, 'skeleton.json')), before.skeleton,
    '失败后不该动骨架'
  );
  assert.equal(listProposals(dir).length, before.proposals, '失败后不该落盘建议');
  assert.equal(readRecords(dir).length, before.records, '失败后不该记账');
});

test('P6-4: apply 后 records 出现 skeleton-change', async (t) => {
  const dir = makeProject(t);
  const pack = await getPack();
  const warnGate = pack.gates.find((g) => g.severity === 'warn');

  const r = await propose(dir, pack, '项目情况说明', {
    relay: mockRelay({ na: [warnGate.id], restore: [], dims: [] }),
  });
  assert.equal(r.ok, true, r.why);

  const applied = applyProposal(dir, r.proposal.id, { approvedBy: '王工' });
  assert.equal(applied.ok, true, applied.why);
  assert.equal(applied.from, 0);
  assert.equal(applied.to, 1);

  const changes = readRecords(dir, { kind: 'skeleton-change' });
  assert.equal(changes.length, 1, 'records 里应该正好一条 skeleton-change');
  assert.equal(changes[0].from, 0);
  assert.equal(changes[0].to, 1);
  assert.equal(changes[0].proposalId, r.proposal.id);
  assert.equal(changes[0].approvedBy, '王工');

  const skel = loadSkeleton(dir);
  assert.equal(skel.instanceVersion, 1);
  assert.ok(skel.naGates.includes(warnGate.id), 'na 应该写进骨架');
});

test('P6-5: 旧 human-confirm 因版本失效', async (t) => {
  const dir = makeProject(t);
  const pack = await getPack();
  const humanGate = pack.gates.find((g) => g.mode === 'human');
  assert.ok(humanGate, '演示包里应该有人工门禁');

  // 第 0 版时确认过一次
  appendRecord(dir, {
    kind: 'human-confirm', gateId: humanGate.id, result: 'pass', by: '王工', note: '看过了',
  });
  const before = evaluate(dir, pack).gates.find((g) => g.id === humanGate.id);
  assert.equal(before.r, 'pass', '同版本内的确认应该算通过');

  // 骨架升到第 1 版
  const warnGate = pack.gates.find((g) => g.severity === 'warn');
  const r = await propose(dir, pack, '项目情况说明', {
    relay: mockRelay({ na: [warnGate.id], restore: [], dims: [] }),
  });
  assert.equal(r.ok, true, r.why);
  assert.equal(applyProposal(dir, r.proposal.id, { approvedBy: '王工' }).ok, true);

  const after = evaluate(dir, pack).gates.find((g) => g.id === humanGate.id);
  assert.notEqual(after.r, 'pass', '清单改过之后旧确认不该继续算通过');
  assert.match(after.say, /重新看一眼/, '要告诉人为什么又要确认一次');
});

test('P6-6: 无指纹变化时 propose 拒绝', async (t) => {
  const dir = makeProject(t);
  const pack = await getPack();
  const warnGate = pack.gates.find((g) => g.severity === 'warn');

  const first = await propose(dir, pack, '项目情况说明', {
    relay: mockRelay({ na: [warnGate.id], restore: [], dims: [] }),
  });
  assert.equal(first.ok, true, first.why);
  assert.equal(applyProposal(dir, first.proposal.id, { approvedBy: '王工' }).ok, true);

  // 产物一个字节没动 → 指纹没变
  const trig = shouldRecompile(dir, pack);
  assert.equal(trig.changed, false, '产物没动时指纹应该跟骨架记的一致');

  const again = await propose(dir, pack, '项目情况说明', {
    relay: mockRelay({ na: [], restore: [], dims: [] }),
  });
  assert.equal(again.ok, false, '指纹没变时应该直接拒绝');
  assert.match(again.why, /没有变化/);
  assert.equal(listProposals(dir).length, 1, '拒绝时不该再落盘一份建议');
});
