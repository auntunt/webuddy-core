// 探测原语解释器
import fs from 'node:fs';
import path from 'node:path';
import { statePath } from './state.js';

/**
 * 执行探测表达式
 * @param {object} ast - 解析后的 AST {fn, args}
 * @param {object} ctx - 上下文 {dir, art, lexicons, hints, round, gateId}
 * @returns {{r:'pass'|'fail', detail:string, evidence?:string}}
 */
export function evalProbe(ast, ctx) {
  const { fn, args } = ast;

  /**
   * 第 12 个原语 applies-if(条件, 正题)。
   *
   * 条件不成立 = 这个项目根本没有这回事,整条判 na（不适用）。
   * 条件成立 = 结果就是正题的结果,applies-if 本身不再插话。
   *
   * 为什么这不是"又一个连接词":all/any/not 只在 pass|fail 之间搬运,
   * 而这一条是唯一一个能产出第三种答案的写法。分不清"还没走到这一步"
   * 和"走到了但做错了",工具会把前者说成后者——那是误报,
   * 而误报会让人不再看工具说什么。
   *
   * 条件自己判出 na 时（applies-if 套 applies-if）整条也是 na:
   * "不适用的前提"推不出"适用的结论"。
   */
  if (fn === 'applies-if') {
    const cond = evalProbe(args[0].value, ctx);
    if (cond.r !== 'pass') {
      return { r: 'na', detail: naSay(cond.detail) };
    }
    return evalProbe(args[1].value, ctx);
  }

  // 连接词
  if (fn === 'all') {
    for (const arg of args) {
      const result = evalProbe(arg.value, ctx);
      // na 会传染：一个不适用的条件推不出"这条整体过了"，也推不出"没过"。
      if (result.r === 'na') return result;
      if (result.r === 'fail') {
        return result; // 短路
      }
    }
    return { r: 'pass', detail: '所有条件都满足' };
  }

  if (fn === 'any') {
    const failures = [];
    for (const arg of args) {
      const result = evalProbe(arg.value, ctx);
      if (result.r === 'na') return result; // 同上，na 传染
      if (result.r === 'pass') {
        return result; // 短路
      }
      failures.push(result.detail);
    }
    // 全败,拼前两个
    const details = failures.slice(0, 2).join(';');
    return { r: 'fail', detail: details };
  }

  if (fn === 'not') {
    const result = evalProbe(args[0].value, ctx);
    if (result.r === 'na') return result; // 「不适用」取反还是不适用
    if (result.r === 'pass') {
      return { r: 'fail', detail: `不应该满足:${result.detail}` };
    } else {
      return { r: 'pass', detail: '符合预期(不满足条件)' };
    }
  }

  // 12 个原语（applies-if 在上面单独处理，它要拿到未求值的子表达式）
  const probes = {
    'file-exists': fileExists,
    'section-filled': sectionFilled,
    'table-column-filled': tableColumnFilled,
    'count-at-least': countAtLeast,
    'regex-hit': regexHit,
    'lexicon-hit': lexiconHit,
    'cross-ref': crossRef,
    'no-placeholder': noPlaceholder,
    'fresh-within': freshWithin,
    'evidence-attached': evidenceAttached,
    'round-clean': roundClean
  };

  const probe = probes[fn];
  if (!probe) {
    return { r: 'fail', detail: `未实现的原语: ${fn}` };
  }

  return probe(args, ctx);
}

/**
 * 把条件的"没找着"改写成"这个项目没有这一项,不用管"。
 *
 * 同一件事从两个方向说，落到人眼里差别很大：
 *   「找不到「08-台账.md」这个文件」——听着像你少交了东西；
 *   「这个项目没有 08-台账.md，这条不用管」——听着像这条与你无关。
 * 后者才是 na 的意思。认不出来的写法就原样带上，不硬编，
 * 猜错了改写会比不改写更误导人。
 */
function naSay(detail) {
  const d = String(detail || '').trim();
  const pats = [
    /^找不到「(.+?)」这个文件$/,
    /^「(.+?)」这个文件还没有[,，]先建它$/,
  ];
  for (const re of pats) {
    const m = re.exec(d);
    if (m) return `这个项目没有 ${m[1]}，这条不用管`;
  }
  const sec = /^「(.+?)」里找不到「(.+?)」这一节$/.exec(d);
  if (sec) return `这个项目没有 ${sec[1]} 的「${sec[2]}」这一节，这条不用管`;
  return d ? `这个项目没走到这一步（${d}），这条不用管` : '这条对本项目不适用';
}

// ===== 原语实现 =====

function fileExists(args, ctx) {
  const glob = args[0].value;
  const matches = resolveGlob(glob, ctx.dir);
  if (matches.length > 0) {
    return { r: 'pass', detail: `找到文件「${matches[0]}」` };
  }
  return { r: 'fail', detail: `找不到「${glob}」这个文件` };
}

function sectionFilled(args, ctx) {
  const file = args[0].value;
  const title = args[1].value;

  const artifact = ctx.art(file);
  if (!artifact.exists) {
    return { r: 'fail', detail: `「${file}」这个文件还没有,先建它` };
  }

  const section = artifact.sections.find(s => s.title === title);
  if (!section) {
    return { r: 'fail', detail: `「${file}」里找不到「${title}」这一节` };
  }

  // 非空 = 去空白与占位符后 ≥10 字
  let text = section.text.trim();
  text = text.replace(/<[^>]{1,20}>|待填|TODO|TBD/g, '');
  text = text.replace(/\s+/g, '');

  if (text.length >= 10) {
    return { r: 'pass', detail: `「${file}」的「${title}」一节已填写` };
  }

  return { r: 'fail', detail: `「${file}」里「${title}」这一节是空的` };
}

function tableColumnFilled(args, ctx) {
  const file = args[0].value;
  const tableName = args[1].value;
  const colName = args[2].value;

  const artifact = ctx.art(file);
  if (!artifact.exists) {
    return { r: 'fail', detail: `「${file}」这个文件还没有,先建它` };
  }

  const tables = tableName === '*' ? artifact.tables : artifact.tables.filter(t => t.name === tableName);
  if (tables.length === 0) {
    return { r: 'fail', detail: `「${file}」里找不到表「${tableName}」` };
  }

  let emptyCount = 0;
  for (const table of tables) {
    const colIndex = table.headers.indexOf(colName);
    if (colIndex === -1) continue;

    for (const row of table.rows) {
      const cell = row[colIndex] || '';
      if (cell.trim() === '' || /<[^>]{1,20}>|待填|TODO|TBD/.test(cell)) {
        emptyCount++;
      }
    }
  }

  if (emptyCount === 0) {
    return { r: 'pass', detail: `「${tableName}」的「${colName}」列已全部填写` };
  }

  const tableLabel = tableName === '*' ? '所有表' : `「${tableName}」`;
  return { r: 'fail', detail: `${tableLabel}的「${colName}」列有 ${emptyCount} 行没填` };
}

function countAtLeast(args, ctx) {
  const file = args[0].value;
  const unit = args[1].value; // 列表项/表行/小节
  const min = args[2].value;

  const artifact = ctx.art(file);
  if (!artifact.exists) {
    return { r: 'fail', detail: `「${file}」这个文件还没有,先建它` };
  }

  let count = 0;
  if (unit === '列表项') {
    count = artifact.lists.reduce((sum, list) => sum + list.items.length, 0);
  } else if (unit === '表行') {
    count = artifact.tables.reduce((sum, table) => sum + table.rows.length, 0);
  } else if (unit === '小节') {
    count = artifact.sections.length;
  } else {
    return { r: 'fail', detail: `不认识的单元类型「${unit}」` };
  }

  if (count >= min) {
    return { r: 'pass', detail: `「${file}」的${unit}有 ${count} 条` };
  }

  return { r: 'fail', detail: `「${file}」的${unit}只有 ${count} 条,至少要 ${min} 条` };
}

function regexHit(args, ctx) {
  const file = args[0].value;
  const pattern = args[1].value;
  const desc = args.length > 2 ? args[2].value : pattern;

  const artifact = ctx.art(file);
  if (!artifact.exists) {
    return { r: 'fail', detail: `「${file}」这个文件还没有,先建它` };
  }

  try {
    const regex = new RegExp(pattern, 'i');
    if (regex.test(artifact.raw)) {
      return { r: 'pass', detail: `「${file}」里找到${desc}` };
    }
    return { r: 'fail', detail: `「${file}」里没找到${desc}` };
  } catch (err) {
    return { r: 'fail', detail: `正则表达式「${pattern}」有错误: ${err.message}` };
  }
}

function lexiconHit(args, ctx) {
  const file = args[0].value;
  const lexiconName = args[1].value;

  const artifact = ctx.art(file);
  if (!artifact.exists) {
    return { r: 'fail', detail: `「${file}」这个文件还没有,先建它` };
  }

  const lexicon = ctx.lexicons[lexiconName];
  if (!lexicon || !Array.isArray(lexicon)) {
    return { r: 'fail', detail: `词表「${lexiconName}」不存在` };
  }

  for (const word of lexicon) {
    if (artifact.raw.includes(word)) {
      return { r: 'pass', detail: `「${file}」里提到了「${word}」` };
    }
  }

  return { r: 'fail', detail: `「${file}」里没提到${lexiconName}相关的内容` };
}

function crossRef(args, ctx) {
  const fileA = args[0].value;
  const unitA = args[1].value; // 表列值 或 小节标题
  const fileB = args[2].value;

  const artA = ctx.art(fileA);
  const artB = ctx.art(fileB);

  if (!artA.exists) {
    return { r: 'fail', detail: `「${fileA}」这个文件还没有,先建它` };
  }
  if (!artB.exists) {
    return { r: 'fail', detail: `「${fileB}」这个文件还没有,先建它` };
  }

  let names = [];
  if (unitA === '小节标题') {
    names = artA.sections.map(s => s.title);
  } else {
    // 假设是表列名
    for (const table of artA.tables) {
      const colIndex = table.headers.indexOf(unitA);
      if (colIndex !== -1) {
        names.push(...table.rows.map(row => row[colIndex]).filter(Boolean));
      }
    }
  }

  for (const name of names) {
    if (!artB.raw.includes(name)) {
      return { r: 'fail', detail: `「${name}」在 ${fileA} 里有、${fileB} 里没有` };
    }
  }

  return { r: 'pass', detail: `${fileA} 的所有${unitA}在 ${fileB} 中都有提及` };
}

function noPlaceholder(args, ctx) {
  const file = args[0].value;

  const artifact = ctx.art(file);
  if (!artifact.exists) {
    return { r: 'fail', detail: `「${file}」这个文件还没有,先建它` };
  }

  const placeholderRegex = /<[^>]{1,20}>|待填|TODO|TBD/gi;
  const matches = artifact.raw.match(placeholderRegex);

  if (!matches || matches.length === 0) {
    return { r: 'pass', detail: `「${file}」没有待填项` };
  }

  return { r: 'fail', detail: `「${file}」里还有 ${matches.length} 处「待填」没填` };
}

function freshWithin(args, ctx) {
  const glob = args[0].value;
  const days = args[1].value;

  const matches = resolveGlob(glob, ctx.dir);
  if (matches.length === 0) {
    return { r: 'fail', detail: `找不到「${glob}」这个文件` };
  }

  let maxMtime = 0;
  for (const file of matches) {
    const fullPath = path.join(ctx.dir, file);
    try {
      const stats = fs.statSync(fullPath);
      if (stats.mtimeMs > maxMtime) {
        maxMtime = stats.mtimeMs;
      }
    } catch (err) {
      // 忽略
    }
  }

  const now = Date.now();
  const ageMs = now - maxMtime;
  const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));

  if (ageDays <= days) {
    return { r: 'pass', detail: `「${glob}」最近 ${ageDays} 天前更新` };
  }

  return { r: 'fail', detail: `「${glob}」最近一次更新是 ${ageDays} 天前,超过了 ${days} 天` };
}

function evidenceAttached(args, ctx) {
  const gateId = args[0].value;
  const type = args[1].value;

  const evidenceDir = statePath(ctx.dir, 'evidence', gateId);
  if (!fs.existsSync(evidenceDir)) {
    return { r: 'fail', detail: `这一条要求上传${type}凭据,还没有——用 webuddy evidence add ${gateId} <文件> 上传` };
  }

  const files = fs.readdirSync(evidenceDir);
  const typeMap = {
    'photo': ['.jpg', '.jpeg', '.png', '.heic'],
    'scan': ['.pdf', '.jpg', '.jpeg', '.png'],
    'doc': ['.pdf', '.docx', '.md'],
    'any': []
  };

  const exts = typeMap[type];
  if (exts === undefined) {
    return { r: 'fail', detail: `不认识的凭据类型「${type}」` };
  }

  if (type === 'any') {
    if (files.length > 0) {
      return { r: 'pass', detail: `已上传凭据(${files.length} 个文件)` };
    }
  } else {
    const matched = files.filter(f => exts.some(ext => f.toLowerCase().endsWith(ext)));
    if (matched.length > 0) {
      return { r: 'pass', detail: `已上传${type}凭据` };
    }
  }

  return { r: 'fail', detail: `这一条要求上传${type}凭据,还没有——用 webuddy evidence add ${gateId} <文件> 上传` };
}

function roundClean(args, ctx) {
  const dim = args[0].value; // files/deps/schema/tests

  /**
   * 没开轮次的时候,这条原语两种判法都是错的:
   *   判绿 = 把"我不知道"写成"没问题",是假绿灯;
   *   判红 = 把"我没看着"写成"你越界了",是误报（包自测会抓出来）。
   * 正确答案是 ask（"判不了,你自己过一遍"）,而 DSL 只有 pass|fail 两态,
   * 给不出第三种。所以走轮次的门禁必须挂 native,不能只靠这条原语。
   * 这里维持判绿是为了不制造误报,真正的把关由 native 前置做。
   */
  if (!ctx.round) {
    return { r: 'pass', detail: '本轮未开轮次,跳过' };
  }

  const violations = ctx.round.violations || [];
  const dimViolations = violations.filter(v => v.dim === dim);

  if (dimViolations.length === 0) {
    return { r: 'pass', detail: `${dim} 维度没有违规` };
  }

  // 转述第一条 violation 的 say
  return { r: 'fail', detail: dimViolations[0].say };
}

// ===== 辅助函数 =====

/**
 * 简单的 glob 匹配(仅支持 * 和 **)
 * @param {string} glob
 * @param {string} dir
 * @returns {string[]} 匹配的相对路径
 */
function resolveGlob(glob, dir) {
  // 转换为正则
  let pattern = glob.replace(/\./g, '\\.');
  pattern = pattern.replace(/\*\*/g, '__DOUBLESTAR__');
  pattern = pattern.replace(/\*/g, '[^/]*');
  pattern = pattern.replace(/__DOUBLESTAR__/g, '.*');
  pattern = `^${pattern}$`;

  const regex = new RegExp(pattern);
  const matches = [];

  function walk(currentPath, relativePath) {
    try {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        const entryRelPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
        const entryFullPath = path.join(currentPath, entry.name);

        if (entry.isDirectory()) {
          walk(entryFullPath, entryRelPath);
        } else {
          if (regex.test(entryRelPath)) {
            matches.push(entryRelPath);
          }
        }
      }
    } catch (err) {
      // 忽略读取错误
    }
  }

  walk(dir, '');
  return matches;
}
