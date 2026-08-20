/**
 * 文本解析：把 markdown 读成结构化事实。
 *
 * 纪律一：只看结构，不看语义。
 *   看的是——某个栏位有没有填、表格有没有空格、条目数量。
 *   不看的是——填得对不对、业务逻辑通不通。
 *   业务正确性只能靠 human 门禁项（比如"用三条真实数据回填"）。
 *
 * 纪律二：这里不许出现任何一个行业才认识的词。
 *   曾经这个文件里有三样东西违反了它：允许的字段类型清单、22 个禁用形容词、
 *   允许的测试层级——都是某个包的门禁知识，被内核抄了一份。
 *   抄的那份还是死的（内核里没有调用者，真正在跑的是包自己 lib/ 下同名的
 *   那份），所以直接删掉了。
 *   换个行业的包，"友好/快速/稳定"这类词表要由那个包自己给，
 *   内核只提供"给我词表我来找"的机制——而机制已经有了，
 *   就是 DSL 的 lexicon-hit 原语 + pack.json 的 lexicons。
 *
 * 这个文件现在是纯函数模块，不碰文件系统——原来的 loadArtifact/loadFrozen
 * 一并删了：它们把 'artifacts/' 这个目录名写死在内核里，而产物放哪由包定；
 * 真正在用的读取入口是 artifact-io.js（路径从包的产物声明来）。
 */

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

/**
 * 按给定词表找命中的词。词表由调用方给，内核不自带任何一份。
 *
 * 这是上面「纪律二」说的那个机制：谁认识这些词，谁把词表传进来。
 * DSL 侧对应 lexicon-hit 原语，词表来自 pack.json 的 lexicons。
 *
 * @param {string} text
 * @param {string[]} words - 要找的词，来自包
 * @returns {string[]} 命中的词
 */
export function findWords(text, words) {
  if (!text || !Array.isArray(words)) return [];
  return words.filter((w) => w && text.includes(w));
}
