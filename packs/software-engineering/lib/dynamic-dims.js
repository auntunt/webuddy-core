/**
 * 动态判据层：门禁 6.5 的内容（该查哪些维度）由模型生成并缓存，
 * 判定由本模块的纯函数完成。
 *
 * 分层原则：规范的内容可以动态生成，规范的判定不能。
 *   - 模型只输出"该查的维度"（anchor + question），不做任何通过/失败判定
 *   - 词表（BOUNDARY_LEXICON）由代码持有，模型无权修改
 *   - 锚点必须逐字命中产物里的字段名/状态名，命中不了直接丢
 *   - 机械匹配：AC 正文同时含锚点名 + 词表里的词 → 已覆盖
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadArtifact, colIndex } from './parse.js';

export const CACHE_FILENAME = 'dynamic-dims.json';

/** 代码持有的边界词表。模型不许扩充或替换。 */
export const BOUNDARY_LEXICON = [
  '为空', '空的', '没有任何', '一条也没有', '0 条', '零条',
  '超长', '截断', '上限', '最大', '最小', '极值', '至少', '超过', '不超过',
  '重复', '两次', '并发', '同时', '非法', '损坏', '无效',
];

/** 从数据字典和状态表提取锚点——只含文档里实际存在的名字，不由模型提供。 */
export function anchors(dir) {
  const dict = loadArtifact(dir, '02-dictionary.md');
  const states = loadArtifact(dir, '02-states.md');
  const fields = [];
  for (const t of dict.tables) {
    const i = colIndex(t.headers, '字段', '栏位', '名称');
    const ty = colIndex(t.headers, '类型');
    const req = colIndex(t.headers, '必填');
    if (i === -1) continue;
    for (const r of t.rows) {
      const name = (r[i] || '').trim();
      if (!name || /^<.*>$/.test(name)) continue;
      fields.push({ name, type: (r[ty] || '').trim(), required: (r[req] || '').trim() });
    }
  }
  const stateNames = new Set();
  for (const t of states.tables) {
    for (const c of ['当前状态', '原状态', '从', '目标状态', '新状态', '到']) {
      const i = colIndex(t.headers, c);
      if (i === -1) continue;
      for (const r of t.rows) {
        const v = (r[i] || '').trim();
        if (v && !/^<.*>$/.test(v)) stateNames.add(v);
      }
    }
  }
  return { fields, states: [...stateNames] };
}

/**
 * 入库闸门：模型输出逐条检查，通不过的直接丢，不进判定。
 * 这样即使模型产出幻觉锚点，判定层也看不到它。
 */
export function admit(items, a) {
  const fieldNames = new Set(a.fields.map((f) => f.name));
  const stateNames = new Set(a.states);
  const kept = []; const dropped = [];
  for (const it of items || []) {
    const ok = it.anchorKind === '字段' ? fieldNames.has(it.anchor) : stateNames.has(it.anchor);
    if (!ok) { dropped.push({ ...it, reason: `锚点「${it.anchor}」不在产物里` }); continue; }
    if (!it.question || it.question.length < 6) { dropped.push({ ...it, reason: '问题太短' }); continue; }
    kept.push(it);
  }
  return { kept, dropped };
}

/**
 * 机械判定：逐条维度，在 AC 块里找"提到锚点 + 命中边界词"。
 * 模型不参与；返回 naked（没有 AC 覆盖的维度列表）。
 */
export function judge(items, acBlocks) {
  const rows = items.map((it) => {
    const hit = acBlocks.find((b) => {
      const t = `${b.code || ''}\n${b.text || ''}`;
      return t.includes(it.anchor) && BOUNDARY_LEXICON.some((w) => t.includes(w));
    });
    return { ...it, covered: Boolean(hit), by: hit ? (hit.code || null) : null };
  });
  return { rows, naked: rows.filter((r) => !r.covered) };
}

/** 读缓存。不存在或损坏返回 null。 */
export function loadCachedDims(dir) {
  try {
    const p = path.join(dir, '.webuddy', CACHE_FILENAME);
    if (!fs.existsSync(p)) return null;
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!Array.isArray(raw?.items)) return null;
    return raw;
  } catch { return null; }
}

/**
 * 锚点指纹：把当前产物里所有字段名 + 状态名排序后做 SHA-256 前 12 位。
 * 用来检测字典/状态机在 generate-dims 之后是否被修改过。
 */
export function anchorFingerprint(dir) {
  const a = anchors(dir);
  const names = [...a.fields.map((f) => f.name), ...a.states].sort();
  return crypto.createHash('sha256').update(names.join('\n')).digest('hex').slice(0, 12);
}

/** 写缓存（写入 .webuddy/dynamic-dims.json）。同时写入锚点指纹。 */
export function saveCachedDims(dir, items, meta = {}) {
  const p = path.join(dir, '.webuddy', CACHE_FILENAME);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const fp = anchorFingerprint(dir);
  fs.writeFileSync(p, JSON.stringify({
    ...meta,
    generatedAt: new Date().toISOString(),
    anchorFingerprint: fp,
    items,
  }, null, 2));
}
