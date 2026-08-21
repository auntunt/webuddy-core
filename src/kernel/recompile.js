/**
 * 骨架重编译器（§7）：让同一个担架包适配这个项目的实际长相。
 *
 * 三段式，三段之间不许抄近道：
 *   触发 shouldRecompile —— 判定依据（factsFingerprint）变了才允许提建议。
 *                           没变还提，等于让模型对着同一份材料反复重写清单。
 *   生成 propose        —— LLM 只能提三类改动，且每一类都要过代码的硬约束。
 *                           模型说什么不算数，代码复核过的才落盘。
 *   生效 applyProposal  —— 人点头才写 skeleton.json。这是写该文件的唯一路径。
 *
 * 为什么不信模型：na 掉一条 block 门禁就等于把底线删了；dims 里编一个
 * 项目里根本没有的字段名，会让人对着不存在的东西回答问题。两种都是
 * 沉默的错——清单看起来更合身了，实际是漏检。所以宁可少改，不可错改。
 *
 * LLM 失败/超时一律 fail-closed：返回 {ok:false, why}，现状一个字节不动。
 */

import fs from 'node:fs';
import { statePath, loadState, saveState, appendRecord, getInstanceVersion } from './state.js';
import { listFiles, readArtifact } from './artifact-io.js';
import { evaluate } from './evaluate.js';
import { effectiveSeverity } from './severity.js';
import { applyGlossary } from './glossary.js';
import { relayStructured } from './ai-relay.js';
import { readAiConfig, isReady } from './ai-config.js';

/** 模型只许输出这三类改动，多出来的字段一律不看 */
export const PROPOSAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['na', 'restore', 'dims'],
  properties: {
    na: { type: 'array', items: { type: 'string' } },
    restore: { type: 'array', items: { type: 'string' } },
    dims: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['gateId', 'anchor', 'anchorKind', 'question'],
        properties: {
          gateId: { type: 'string' },
          anchor: { type: 'string' },
          anchorKind: { type: 'string' },
          question: { type: 'string' },
        },
      },
    },
  },
};

/** 读骨架实例。缺失 = 包原始骨架，instanceVersion 视为 0。 */
export function loadSkeleton(dir) {
  const p = statePath(dir, 'skeleton.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    // 读坏了当缺失：手工编坏的骨架不该让人连建议都提不了
    return null;
  }
}

/**
 * 该不该重编译：判定依据的指纹跟骨架记的那个不一样才算"项目变了"。
 *
 * 指纹口径直接取 evaluate 的结果，不在这里另算一遍——两处算法一旦
 * 有出入，就会出现"看板说变了、propose 说没变"这种没法解释的现象。
 */
export function shouldRecompile(dir, pack) {
  const v = evaluate(dir, pack);
  const current = v.factsFingerprint || '';
  const skel = loadSkeleton(dir);
  const recorded = skel?.fingerprint || '';
  return {
    changed: current !== recorded,
    current,
    recorded,
    instanceVersion: skel?.instanceVersion ?? 0,
  };
}

/**
 * 项目里所有能读成文本的产物，拼一大段，给 anchor 逐字核对用。
 * .webuddy/ 排除在外：那是工具自己写的东西，模型从里面抄一个词
 * 再当"项目里有这个字段"就是自证。
 */
function artifactCorpus(dir) {
  const files = listFiles(dir, '', { recursive: true })
    .filter((f) => !f.startsWith('.webuddy/') && !f.startsWith('.git/'));
  const parts = [];
  for (const f of files) {
    const a = readArtifact(dir, f);
    const text = typeof a === 'string' ? a : (a?.raw ?? a?.text ?? '');
    if (typeof text === 'string' && text) parts.push(text);
  }
  return parts.join('\n');
}

/**
 * 一个维度收不收：anchor 必须逐字出现在产物里（移植 ref dynamic-dims 的 admit）。
 *
 * 逐字，不做同义词、不做模糊匹配。模型很会顺着行业习惯"补"一个听起来
 * 该有的字段名，人对着这种问题答不上来又说不清哪里不对。宁可漏收。
 */
export function admitDim(dim, corpus, gateIds) {
  if (!dim || typeof dim !== 'object') return { ok: false, why: '维度格式不对' };
  const { gateId, anchor, anchorKind, question } = dim;
  if (!gateId || !gateIds.has(gateId)) {
    return { ok: false, why: `门禁 ${gateId || '(空)'} 不在这个包里` };
  }
  if (typeof anchor !== 'string' || anchor.trim() === '') {
    return { ok: false, why: '锚点是空的' };
  }
  if (typeof question !== 'string' || question.trim() === '') {
    return { ok: false, why: '问题是空的' };
  }
  if (!corpus.includes(anchor)) {
    return { ok: false, why: `产物里找不到「${anchor}」这个说法` };
  }
  return {
    ok: true,
    dim: {
      gateId,
      anchor,
      anchorKind: typeof anchorKind === 'string' && anchorKind ? anchorKind : '字段',
      question,
    },
  };
}

/**
 * 代码复核模型的三类输出。丢掉的每一条都记原因，人审时能看见。
 *
 * na      —— block 档一律剔除；不认识的门禁 ID 剔除。
 * restore —— 只能恢复现在确实被 na 掉的，凭空 restore 没有意义。
 * dims    —— 逐条过 admitDim。
 */
export function vetProposal(raw, { pack, skeleton, corpus }) {
  const gates = pack.gates || [];
  const gateIds = new Set(gates.map((g) => g.id));
  const byId = new Map(gates.map((g) => [g.id, g]));
  const currentNa = new Set(Array.isArray(skeleton?.naGates) ? skeleton.naGates : []);
  const dropped = [];

  const na = [];
  for (const id of Array.isArray(raw?.na) ? raw.na : []) {
    const gate = byId.get(id);
    if (!gate) {
      dropped.push({ what: 'na', id, why: '这个包里没有这条门禁' });
      continue;
    }
    if (effectiveSeverity(gate) === 'block') {
      dropped.push({ what: 'na', id, why: '这是任何项目都得过的底线，不能标成不适用' });
      continue;
    }
    if (!na.includes(id)) na.push(id);
  }

  const restore = [];
  for (const id of Array.isArray(raw?.restore) ? raw.restore : []) {
    if (!gateIds.has(id)) {
      dropped.push({ what: 'restore', id, why: '这个包里没有这条门禁' });
      continue;
    }
    if (!currentNa.has(id)) {
      dropped.push({ what: 'restore', id, why: '这条本来就在查，不用恢复' });
      continue;
    }
    if (!restore.includes(id)) restore.push(id);
  }

  const dims = [];
  for (const d of Array.isArray(raw?.dims) ? raw.dims : []) {
    const r = admitDim(d, corpus, gateIds);
    if (!r.ok) {
      dropped.push({ what: 'dim', id: d?.gateId ?? '', anchor: d?.anchor ?? '', why: r.why });
      continue;
    }
    dims.push(r.dim);
  }

  // na 与 restore 同时点到一条：以 restore 为准（"继续查"比"不查"安全）
  const conflict = na.filter((id) => restore.includes(id));
  for (const id of conflict) {
    dropped.push({ what: 'na', id, why: '同一条既说不适用又说恢复，按继续查处理' });
  }

  return {
    proposal: { na: na.filter((id) => !restore.includes(id)), restore, dims },
    dropped,
  };
}

/**
 * 两个前提：这东西是不是要交给客户用（forClient）、是不是要上线（toDeploy）。
 *
 * 语义照 ref adapt.js：客户要用蕴含要上线——东西交到客户手上，
 * 就一定得先部署到某个地方。反过来不成立（内部工具会部署但没有外部客户）。
 * 判不出来保持 null，不猜：这两个前提会开关一批门禁，猜错比不知道更糟。
 */
export function judgePremises(raw) {
  let forClient = typeof raw?.forClient === 'boolean' ? raw.forClient : null;
  let toDeploy = typeof raw?.toDeploy === 'boolean' ? raw.toDeploy : null;
  if (forClient === true) toDeploy = true; // 蕴含关系由代码兜住，不靠模型自觉
  return { forClient, toDeploy };
}

function buildPrompt({ pack, skeleton, description, gates }) {
  const naNow = Array.isArray(skeleton?.naGates) ? skeleton.naGates : [];
  const lines = gates.map(
    (g) => `- ${g.id}（第${g.stage}环节，严格度 ${effectiveSeverity(g)}）：${g.desc}`
  );
  return [
    `这是一份「${pack.meta?.title || pack.meta?.name || '验收清单'}」，下面是它的全部检查项：`,
    lines.join('\n'),
    '',
    naNow.length ? `当前被标成"本项目不适用"的：${naNow.join('、')}` : '当前没有被标成不适用的检查项。',
    '',
    `这个项目的实际情况：${description || '（没有补充说明）'}`,
    '',
    '请只提三类改动，其它一律不要提：',
    '1. na：这个项目确实用不上的检查项 ID。',
    '2. restore：之前标了不适用、现在又该查回来的检查项 ID。',
    '3. dims：某条检查项需要额外追问的维度。anchor 必须是项目产物里原原本本出现过的词，',
    '   一个字都不能改，编造的会被丢弃。anchorKind 写它是什么（字段/状态/角色/接口…），',
    '   question 写要问人的那句话。',
    '',
    '另外可以给出 forClient（这东西要交给外部客户用吗）和 toDeploy（要部署上线吗），',
    '不确定就不要给这两个字段。',
  ].join('\n');
}

/**
 * 提一份建议。
 *
 * 指纹没变直接拒绝——不定时跑。这不是省钱，是防止清单被反复无意义地重写：
 * 同一份材料每次问模型都可能给出略有不同的答案，人会以为项目又变了。
 */
export async function propose(dir, pack, description, options = {}) {
  const relay = options.relay || relayStructured;
  const trig = shouldRecompile(dir, pack);
  if (!trig.changed) {
    return {
      ok: false,
      why: '项目跟上次比没有变化，不用重新调整检查清单',
    };
  }

  const cfg = options.aiConfig || readAiConfig();
  if (!options.relay && !isReady(cfg)) {
    return { ok: false, why: '还没配好模型，先去设置里填地址和密钥' };
  }

  const skeleton = loadSkeleton(dir);
  const gates = pack.gates || [];
  const prompt = buildPrompt({ pack, skeleton, description, gates });

  let out;
  try {
    out = await relay({
      baseURL: cfg?.baseURL,
      apiKey: cfg?.apiKey,
      model: cfg?.model,
      prompt,
      schema: PROPOSAL_SCHEMA,
    });
  } catch (e) {
    // fail-closed：现状一个字节不动
    return { ok: false, why: `模型这次没能给出建议：${e.message}` };
  }

  const raw = out?.value;
  if (!raw || typeof raw !== 'object') {
    return { ok: false, why: '模型返回的内容读不出建议' };
  }

  const corpus = artifactCorpus(dir);
  const { proposal, dropped } = vetProposal(raw, { pack, skeleton, corpus });
  const premises = judgePremises(raw);

  const ts = new Date().toISOString();
  const id = ts.replace(/[:.]/g, '-');
  const record = {
    id,
    proposal,
    premises,
    dropped,
    reasoning: typeof raw.reasoning === 'string' ? raw.reasoning : (description || ''),
    fingerprint: trig.current,
    packName: pack.meta?.name || '',
    packVersion: pack.meta?.version || '',
    baseInstanceVersion: trig.instanceVersion,
    status: 'pending',
    createdAt: ts,
  };

  const p = statePath(dir, 'proposals', `${id}.json`);
  fs.writeFileSync(p, JSON.stringify(record, null, 2) + '\n', 'utf8');

  return { ok: true, proposal: record };
}

/** 列出所有建议，新的在前。 */
export function listProposals(dir) {
  const d = statePath(dir, 'proposals');
  if (!fs.existsSync(d)) return [];
  const out = [];
  for (const f of fs.readdirSync(d)) {
    if (!f.endsWith('.json')) continue;
    try {
      out.push(JSON.parse(fs.readFileSync(statePath(dir, 'proposals', f), 'utf8')));
    } catch {
      // 坏文件跳过，不让一个坏文件挡住整张列表
    }
  }
  return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function loadProposal(dir, proposalId) {
  const p = statePath(dir, 'proposals', `${proposalId}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 建议渲染成人话。
 *
 * 顺序是「项目怎么了 → 建议改什么 → 为什么」：人先要知道这事跟他有什么关系，
 * 才有耐心看清单。改动数量写在最前面，因为"要不要点头"这个决定
 * 八成只取决于"动几条、动哪几条"。
 */
export function renderProposal(p, glossary = null) {
  if (!p) return '没有这条建议';
  const { na = [], restore = [], dims = [] } = p.proposal || {};
  const bits = [];
  if (restore.length) bits.push(`恢复 ${restore.length} 条检查（${restore.join('、')}）`);
  if (dims.length) {
    bits.push(`新增 ${dims.length} 个检查维度（${dims.map((d) => d.anchor).join('、')}）`);
  }
  bits.push(`移除 ${na.length} 条${na.length ? `（${na.join('、')}）` : ''}`);

  const lines = [];
  lines.push(p.reasoning ? `项目情况：${p.reasoning}` : '项目跟上次比有了变化。');
  lines.push(`建议：${bits.join('、')}。`);

  if (dims.length) {
    lines.push('');
    lines.push('要追问的维度：');
    for (const d of dims) {
      lines.push(`  · ${d.gateId} 那条，因为产物里有「${d.anchor}」这个${d.anchorKind}：${d.question}`);
    }
  }

  if (Array.isArray(p.dropped) && p.dropped.length) {
    lines.push('');
    lines.push(`另有 ${p.dropped.length} 条没采纳：`);
    for (const d of p.dropped) {
      const who = d.anchor ? `${d.id || ''}「${d.anchor}」` : (d.id || '');
      lines.push(`  · ${who}：${d.why}`);
    }
  }

  const pr = p.premises || {};
  if (pr.forClient !== null && pr.forClient !== undefined) {
    lines.push('');
    lines.push(`另外判断：${pr.forClient ? '这东西要交给客户用' : '这东西不对外交付'}${
      pr.toDeploy === true ? '，需要上线部署' : ''
    }。`);
  }

  lines.push('');
  lines.push('点头之后，你之前做过的人工确认要重新看一遍——清单改了，旧的确认不作数。');

  const text = lines.join('\n');
  return glossary ? applyGlossary(text, glossary) : text;
}

/**
 * 让建议生效。这是全仓库唯一写 skeleton.json 的地方。
 *
 * 新实例的 naGates = 旧的 - restore + na；dims 按 gateId+anchor 去重后合并。
 * instanceVersion 每次 +1，且写进 records——旧的 human-confirm 靠版本号失效
 * （evaluate 里比对），所以这个号只能涨，不能复用。
 */
export function applyProposal(dir, proposalId, { approvedBy } = {}) {
  const p = loadProposal(dir, proposalId);
  if (!p) return { ok: false, why: `找不到编号 ${proposalId} 的建议` };
  if (p.status === 'applied') {
    return { ok: false, why: '这条建议已经生效过了，不用再点一次' };
  }

  const prev = loadSkeleton(dir);
  const from = prev?.instanceVersion ?? 0;
  const to = from + 1;

  const { na = [], restore = [], dims = [] } = p.proposal || {};
  const prevNa = Array.isArray(prev?.naGates) ? prev.naGates : [];
  const nextNa = [...new Set([...prevNa.filter((id) => !restore.includes(id)), ...na])].sort();

  const prevDims = Array.isArray(prev?.dims) ? prev.dims : [];
  const seen = new Set(prevDims.map((d) => `${d.gateId}::${d.anchor}`));
  const nextDims = [...prevDims];
  for (const d of dims) {
    const k = `${d.gateId}::${d.anchor}`;
    if (seen.has(k)) continue;
    seen.add(k);
    nextDims.push(d);
  }

  const appliedAt = new Date().toISOString();
  const skeleton = {
    packName: p.packName || prev?.packName || '',
    packVersion: p.packVersion || prev?.packVersion || '',
    instanceVersion: to,
    naGates: nextNa,
    dims: nextDims,
    fingerprint: p.fingerprint || '',
    appliedAt,
    approvedBy: approvedBy || '',
    proposalId,
  };

  // 原子写：临时文件 + rename。半截的骨架文件会让判定全线读不出版本号。
  const target = statePath(dir, 'skeleton.json');
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(skeleton, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, target);

  // 前提随 apply 落到 state.json（判不出的保持原样，不用 null 覆盖已知值）
  const pr = p.premises || {};
  const patch = {};
  if (pr.forClient !== null && pr.forClient !== undefined) patch.forClient = pr.forClient;
  if (pr.toDeploy !== null && pr.toDeploy !== undefined) patch.toDeploy = pr.toDeploy;
  if (Object.keys(patch).length) saveState(dir, patch);

  // 顺序要紧：先写骨架再记账，appendRecord 读的 instanceVersion 才是新版本
  appendRecord(dir, { kind: 'skeleton-change', from, to, proposalId, approvedBy: approvedBy || '' });

  p.status = 'applied';
  p.appliedAt = appliedAt;
  p.approvedBy = approvedBy || '';
  fs.writeFileSync(
    statePath(dir, 'proposals', `${proposalId}.json`),
    JSON.stringify(p, null, 2) + '\n',
    'utf8'
  );

  return { ok: true, from, to, skeleton };
}
