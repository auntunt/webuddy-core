/**
 * 产物解析：把 artifacts/*.md 读成结构化事实。
 *
 * 纪律：只看结构，不看语义。
 *   看的是——某个栏位有没有填、表格有没有空格、类型在不在允许清单里、条目数量。
 *   不看的是——填得对不对、业务逻辑通不通。
 *
 * 为什么必须这样：门禁判据不许依赖读代码（20-环节定稿.md 规则二）。
 * 同理，判据也不许依赖"理解业务"。工具能判的是形式完整性，
 * 业务正确性只能靠 human 门禁项（比如 2.13 用三条真实数据回填）。
 */

import fs from 'node:fs';
import path from 'node:path';

/** 数据字典允许的字段类型，来自 06-产物模板.md */
export const ALLOWED_FIELD_TYPES = [
  '文本', '长文本', '数字', '金额', '日期', '日期时间',
  '选择', '多选', '图片', '附件', '是否',
];

/** 验收标准里的禁用词表，22 个。来自 07-门禁清单.md 门禁 3.2 */
// 词表以 07-门禁清单.md §3.2 为权威，两份源码合并后去掉「及时」。
// 去掉的原因：「及时处理」「及时通知」在业务文档里是正常中文，加进去会打掉大量没问题的标准。
// 词表需要新增时，同步修改 07-门禁清单.md 的「禁用词表」说明行。
export const BANNED_WORDS = [
  '友好', '快', '快速', '慢', '稳定', '可靠', '合理', '方便',
  '灵活', '简单', '高效', '智能', '优化', '完善', '良好', '适当',
  '尽量', '美观', '流畅', '健壮', '易用', '简洁',
];

/** 追溯对照表允许的层级 */
export const ALLOWED_TEST_LEVELS = ['单元', '集成', '端到端'];

/** 读文件，不存在返回 null。任何异常都当"不存在"处理，探测器不应该因为一个坏文件崩掉。 */
export function readIfExists(filePath) {
  try {
    const st = fs.statSync(filePath);
    if (!st.isFile()) return null;
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

/** 解析 YAML frontmatter（只支持平铺的 key: value，够用且不引依赖） */
export function parseFrontmatter(text) {
  if (!text || !text.startsWith('---')) return { meta: {}, body: text || '' };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { meta: {}, body: text };
  const raw = text.slice(4, end);
  const body = text.slice(end + 4);
  const meta = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Za-z0-9_一-龥-]+)\s*:\s*(.*)$/);
    if (m) meta[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return { meta, body };
}

/**
 * 抽出 Markdown 二级/三级标题下的段落内容。
 * 返回 Map<标题文本, 该标题下的正文>。
 */
export function sectionsOf(body) {
  const out = new Map();
  if (!body) return out;
  const lines = body.split('\n');
  let cur = null;
  let buf = [];
  const flush = () => { if (cur !== null) out.set(cur, buf.join('\n').trim()); };
  for (const line of lines) {
    const m = line.match(/^#{2,4}\s+(.+?)\s*$/);
    if (m) {
      flush();
      // 只剥编号前缀。不能简单剥掉"一二三"，否则"一直不处理怎么办"会被吃掉第一个字。
      cur = m[1].replace(/^(?:\d+|[一二三四五六七八九十]+)\s*[、.．)）]\s*/, '').trim();
      buf = [];
    } else if (cur !== null) {
      buf.push(line);
    }
  }
  flush();
  return out;
}

/**
 * 某个 section 是否算"填了"。模板占位符不算填。
 *
 * <尖括号> 这一条必须有：webuddy new 生成的空模板里，占位符带着示例文字
 * （「例：车间班组长」这种）。不排掉的话，一张一个字没填的空卡能拿 6/8 分——
 * 白送的绿灯比不给模板更坏，人会以为环节一快过了。
 */
const PLACEHOLDER = /^(待填|待补|TODO|TBD|待定|\/|—|-{1,3}|\.{3}|xxx|XXX|（.*）|\(.*\)|<.*>|-\s*<.*>)$/i;

export function isFilled(text) {
  if (!text) return false;
  const t = text.trim();
  if (!t) return false;
  // 全是列表符号或表格骨架也不算填
  const stripped = t.replace(/[|\-:*>\s\n]/g, '');
  if (!stripped) return false;
  if (PLACEHOLDER.test(t)) return false;
  // 只剩模板提示行的情况
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.some((l) => !PLACEHOLDER.test(l) && l.replace(/[|\-:*>\s]/g, '').length > 0);
}

/**
 * 解析 Markdown 表格。返回 { headers: string[], rows: string[][] }[]
 * 一个文档里可能有多张表，全部返回。
 */
export function parseTables(body) {
  if (!body) return [];
  const tables = [];
  const lines = body.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith('|') && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const headers = splitRow(line);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = splitRow(lines[i]);
        // 整行都是 <占位符> 的样例行不算数据行。
        // 不排掉的话，webuddy new 生成的空状态机会被算成"有 1 条流转"，
        // 于是「没有进不去的状态」「没人能删数据」这些结论全部成立——
        // 一张什么都没填的表拿到绿灯，是最难发现的假绿灯。
        const allPlaceholder = cells.length > 0 && cells.every((x) => !x.trim() || /^<.*>$/.test(x.trim()));
        if (!allPlaceholder) rows.push(cells);
        i += 1;
      }
      tables.push({ headers, rows });
      continue;
    }
    i += 1;
  }
  return tables;
}

function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

/** 在表头里找列的下标，支持多个候选名 */
export function colIndex(headers, ...candidates) {
  for (const c of candidates) {
    const i = headers.findIndex((h) => h.includes(c));
    if (i !== -1) return i;
  }
  return -1;
}

/** 表格里某一列是否存在空格（用于「无空行」类门禁） */
export function columnHasBlank(table, ...candidates) {
  const idx = colIndex(table.headers, ...candidates);
  if (idx === -1) return true; // 列都没有，等于全空
  return table.rows.some((r) => !isFilled(r[idx] || ''));
}

/** 计数列表条目：- 开头或数字开头的行 */
export function countListItems(text) {
  if (!text) return 0;
  return text.split('\n').filter((l) => /^\s*(?:[-*+]|\d+[.、)])\s+\S/.test(l) && isFilled(l)).length;
}

/** 文本里有没有可测量的数字（用于「成功指标可测量」） */
export function hasMeasurableNumber(text) {
  if (!text) return false;
  return /\d/.test(text) && /(分钟|小时|天|周|月|次|条|个|人|%|％|元|万|降到|提到|减少|从.*到)/.test(text);
}

/** 命中了哪些禁用词 */
export function findBannedWords(text) {
  if (!text) return [];
  return BANNED_WORDS.filter((w) => text.includes(w));
}

/** 抽取所有 AC- 编号 */
export function extractACCodes(text) {
  if (!text) return [];
  const out = new Set();
  for (const m of text.matchAll(/\bAC-?(\d{1,4})\b/gi)) out.add(`AC-${m[1].padStart(3, '0')}`);
  return [...out];
}

/** 产物文件的统一读取入口 */
export function loadArtifact(projectDir, filename) {
  const p = path.join(projectDir, 'artifacts', filename);
  const raw = readIfExists(p);
  if (raw === null) return { exists: false, path: p, meta: {}, body: '', sections: new Map(), tables: [] };
  const { meta, body } = parseFrontmatter(raw);
  return {
    exists: true,
    path: p,
    raw,
    meta,
    body,
    sections: sectionsOf(body),
    tables: parseTables(body),
  };
}

/** 读 .frozen（已冻结产物的哈希清单），格式：每行 `文件名  哈希` */
export function loadFrozen(projectDir) {
  const raw = readIfExists(path.join(projectDir, 'artifacts', '.frozen'));
  const map = new Map();
  if (!raw) return map;
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const parts = t.split(/\s+/);
    if (parts.length >= 2) map.set(parts[0], parts[1]);
  }
  return map;
}
