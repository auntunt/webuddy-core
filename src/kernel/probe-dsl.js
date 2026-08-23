// 探测 DSL 解析器
// 语法:expr := IDENT "(" [arg ("," arg)*] ")"
// arg := STRING | NUMBER | expr

/**
 * Levenshtein 距离计算,用于命令建议
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function levenshtein(a, b) {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

/**
 * 找最近的候选词
 * @param {string} word
 * @param {string[]} candidates
 * @returns {string|null}
 */
export function suggest(word, candidates) {
  if (!word || candidates.length === 0) return null;
  let best = null;
  let bestDist = Infinity;
  for (const candidate of candidates) {
    const dist = levenshtein(word.toLowerCase(), candidate.toLowerCase());
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  return bestDist <= 3 ? best : null;
}

/**
 * 词法分析
 * @param {string} src
 * @returns {Array<{type:string, value:string, line:number, col:number}>}
 */
export function tokenize(src) {
  const tokens = [];
  let line = 1;
  let col = 1;
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    // 跳过空白
    if (/\s/.test(ch)) {
      if (ch === '\n') {
        line++;
        col = 1;
      } else {
        col++;
      }
      i++;
      continue;
    }

    // 注释(单行 // 或 #)
    if ((ch === '/' && src[i + 1] === '/') || ch === '#') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }

    // 字符串
    if (ch === '"') {
      const startCol = col;
      let value = '';
      i++; col++;
      while (i < src.length) {
        if (src[i] === '\\' && i + 1 < src.length) {
          // 转义
          const next = src[i + 1];
          if (next === '"' || next === '\\' || next === 'n' || next === 't') {
            value += next === 'n' ? '\n' : next === 't' ? '\t' : next;
            i += 2;
            col += 2;
          } else {
            value += '\\' + next;
            i += 2;
            col += 2;
          }
        } else if (src[i] === '"') {
          i++; col++;
          break;
        } else {
          value += src[i];
          i++;
          col++;
        }
      }
      tokens.push({ type: 'STRING', value, line, col: startCol });
      continue;
    }

    // 数字
    if (/[0-9]/.test(ch)) {
      const startCol = col;
      let value = '';
      while (i < src.length && /[0-9]/.test(src[i])) {
        value += src[i];
        i++;
        col++;
      }
      tokens.push({ type: 'NUMBER', value, line, col: startCol });
      continue;
    }

    // 标识符
    if (/[a-z]/.test(ch)) {
      const startCol = col;
      let value = '';
      while (i < src.length && /[a-z0-9-]/.test(src[i])) {
        value += src[i];
        i++;
        col++;
      }
      tokens.push({ type: 'IDENT', value, line, col: startCol });
      continue;
    }

    // 符号
    if (ch === '(' || ch === ')' || ch === ',') {
      tokens.push({ type: ch, value: ch, line, col });
      i++;
      col++;
      continue;
    }

    // 未知字符
    tokens.push({ type: 'UNKNOWN', value: ch, line, col });
    i++;
    col++;
  }

  return tokens;
}

/**
 * 已知原语及其参数要求。
 *
 * 连接词 3 个（all/any/not）+ 原语 12 个。原语表到此满员、永久封版：
 * 表已满员，不再给新原语留位置；新需求一律降级 human（先想怎么让人看一眼，而不是加原语）。
 * 封版的理由是易学：一个行业专家要能在一页纸里把全部原语看完，
 * 表越长，包作者越倾向于"再加一个"而不是"想清楚这条该不该机器判"。
 */
const KNOWN_PROBES = {
  'all': { min: 1, types: ['expr'] },
  'any': { min: 1, types: ['expr'] },
  'not': { min: 1, max: 1, types: ['expr'] },
  'file-exists': { min: 1, max: 1, types: ['string'] },
  'section-filled': { min: 2, max: 2, types: ['string', 'string'] },
  'table-column-filled': { min: 3, max: 3, types: ['string', 'string', 'string'] },
  'count-at-least': { min: 3, max: 3, types: ['string', 'string', 'number'] },
  'regex-hit': { min: 2, max: 3, types: ['string', 'string', 'string'] },
  'lexicon-hit': { min: 2, max: 2, types: ['string', 'string'] },
  'cross-ref': { min: 3, max: 3, types: ['string', 'string', 'string'] },
  'no-placeholder': { min: 1, max: 1, types: ['string'] },
  'fresh-within': { min: 2, max: 2, types: ['string', 'number'] },
  'evidence-attached': { min: 2, max: 2, types: ['string', 'string'] },
  'round-clean': { min: 1, max: 1, types: ['string'] },
  // 第 12 个原语：先问"这条对本项目适用吗"，不适用就整条不适用（na）。
  // 两个参数都必须是表达式 —— 写成字符串就是把条件当文件名，静默判错。
  'applies-if': { min: 2, max: 2, types: ['expr', 'expr'] }
};

/**
 * 语法分析
 * @param {string} src
 * @returns {{ok:true, ast:object}|{ok:false, why:string}}
 */
export function parseProbe(src) {
  const tokens = tokenize(src);
  let pos = 0;

  function peek() {
    return tokens[pos];
  }

  function consume(type) {
    const tok = peek();
    if (!tok || tok.type !== type) {
      return null;
    }
    pos++;
    return tok;
  }

  function parseExpr() {
    const ident = consume('IDENT');
    if (!ident) {
      const tok = peek();
      if (!tok) {
        return { ok: false, why: '表达式不完整' };
      }
      return { ok: false, why: `第 ${tok.line} 行:期望函数名,得到 ${tok.value}` };
    }

    const fn = ident.value;

    // 检查是否为已知原语
    if (!KNOWN_PROBES[fn]) {
      const suggestion = suggest(fn, Object.keys(KNOWN_PROBES));
      const hint = suggestion ? `,是不是想写 ${suggestion}?` : '';
      return { ok: false, why: `第 ${ident.line} 行:${fn} 不是认识的探测方法${hint}` };
    }

    if (!consume('(')) {
      const tok = peek();
      return { ok: false, why: `第 ${ident.line} 行:${fn} 后面要跟左括号` };
    }

    const args = [];
    const spec = KNOWN_PROBES[fn];

    // 解析参数
    while (true) {
      const tok = peek();
      if (!tok) {
        return { ok: false, why: `第 ${ident.line} 行:${fn} 的参数列表没有闭合` };
      }

      if (tok.type === ')') {
        consume(')');
        break;
      }

      if (args.length > 0) {
        if (!consume(',')) {
          return { ok: false, why: `第 ${tok.line} 行:参数之间要用逗号分隔` };
        }
      }

      // 参数可以是字符串、数字或嵌套表达式
      const argTok = peek();
      if (!argTok) {
        return { ok: false, why: `第 ${ident.line} 行:缺少参数` };
      }

      if (argTok.type === 'STRING') {
        consume('STRING');
        args.push({ type: 'string', value: argTok.value });
      } else if (argTok.type === 'NUMBER') {
        consume('NUMBER');
        args.push({ type: 'number', value: parseInt(argTok.value, 10) });
      } else if (argTok.type === 'IDENT') {
        // 嵌套表达式
        const nested = parseExpr();
        if (!nested.ok) return nested;
        args.push({ type: 'expr', value: nested.ast });
      } else {
        return { ok: false, why: `第 ${argTok.line} 行:参数类型错误` };
      }
    }

    // 检查参数个数
    if (spec.min !== undefined && args.length < spec.min) {
      return { ok: false, why: `第 ${ident.line} 行:${fn} 至少需要 ${spec.min} 个参数,只给了 ${args.length} 个` };
    }
    if (spec.max !== undefined && args.length > spec.max) {
      return { ok: false, why: `第 ${ident.line} 行:${fn} 最多 ${spec.max} 个参数,给了 ${args.length} 个` };
    }

    // 检查参数类型(简单检查)
    if (spec.types) {
      for (let i = 0; i < args.length && i < spec.types.length; i++) {
        const expectedType = spec.types[i];
        const actualType = args[i].type;
        if (expectedType === 'string' && actualType !== 'string') {
          return { ok: false, why: `第 ${ident.line} 行:${fn} 的第 ${i + 1} 个参数应该是字符串` };
        }
        if (expectedType === 'number' && actualType !== 'number') {
          return { ok: false, why: `第 ${ident.line} 行:${fn} 的第 ${i + 1} 个参数应该是数字` };
        }
        // applies-if 的两个参数都得是表达式。不查这一条的话，
        // applies-if("a", "b") 会安安静静地过掉解析，到求值时才变成一句
        // 「未实现的原语」——而那时候报的是判定失败，不是配置写错。
        if (expectedType === 'expr' && actualType !== 'expr') {
          return { ok: false, why: `第 ${ident.line} 行:${fn} 的第 ${i + 1} 个参数应该是一个探测表达式,不是${actualType === 'string' ? '字符串' : '数字'}` };
        }
      }
    }

    return { ok: true, ast: { fn, args } };
  }

  const result = parseExpr();
  if (!result.ok) return result;

  // 确保没有多余的 token
  if (peek()) {
    const tok = peek();
    return { ok: false, why: `第 ${tok.line} 行:表达式后面有多余内容` };
  }

  return { ok: true, ast: result.ast };
}
