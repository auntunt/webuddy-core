/**
 * 产物侧事实探测：把 artifacts/ 下的十一份产物读成事实。
 *
 * 每个函数只回答"形式上填没填全"，不回答"内容对不对"。
 * 这样非技术人员看到的每一条不通过，都能自己看懂、自己改。
 */

import {
  loadArtifact, loadFrozen, isFilled, colIndex, columnHasBlank,
  countListItems, hasMeasurableNumber, findBannedWords, extractACCodes,
  ALLOWED_FIELD_TYPES, ALLOWED_TEST_LEVELS,
} from './parse.js';
import { anchors, admit, judge, loadCachedDims, anchorFingerprint } from './dynamic-dims.js';
import { STAGES } from './stages.js';

/**
 * 全部产物文件名。从 STAGES 推导，不另立一份清单——
 * 手抄一份的话，环节里加了新产物这边不会跟着变，指引就会说"文件已经有了"。
 */
const ALL_ARTIFACT_FILES = [...new Set(STAGES.flatMap((s) => s.artifacts || []))];

/** 在 sections 里按关键词找一节 */
/**
 * 占位符和填写说明一律先剥掉，再交给规则。
 *
 * 必须在这一层剥。因为很多规则不走 isFilled，而是直接对原文做正则
 * （比如 1.3 找数字、1.6 找"纸/Excel"这些词）。模板里的示例文字
 * 「例：月底汇总从 4 小时降到 10 分钟」恰好能满足这些正则——
 * 结果一张空卡照样拿绿灯，而且是最难发现的那种假绿灯：
 * 文件真的存在、栏目真的有、只是内容是工具自己印上去的。
 */
function strip(body) {
  return body
    .replace(/<!--[\s\S]*?-->/g, '')   // HTML 注释写的"为什么要填这栏"
    .replace(/<[^<>\n]{1,120}>/g, '')  // <例：……> 这类占位符
    .split('\n')
    .filter((l) => l.replace(/[-*\s]/g, '').length > 0)
    .join('\n')
    .trim();
}

function sec(a, ...keys) {
  for (const k of keys) {
    for (const [title, body] of a.sections) {
      if (title.includes(k)) return strip(body);
    }
  }
  return '';
}

/** 环节一：场景卡 */
function probeScopeCard(dir) {
  const a = loadArtifact(dir, '01-scope-card.md');
  if (!a.exists) return { exists: false };
  const user = sec(a, '使用者', '谁用');
  const currentAction = sec(a, '现状', '他现在怎么做', '当前动作');
  // 这一栏模板给的是半句话：「上线后，<谁> 的 <哪个动作> 这个动作被系统替代了」。
  // 占位符剥掉之后剩下的还是模板骨架，不能算填了——
  // 恰恰是这一栏最不能放水，它是验收唯一的客观依据。
  const replacement = sec(a, '一句话', '替代')
    .replace(/上线后|这个动作被系统替代了|的|，|,|。/g, '').trim();
  const metric = sec(a, '成功指标', '怎么算成功');
  const outOfScope = sec(a, '明确不做', '不做');
  const frequency = sec(a, '频率', '使用频率');
  const blocks = { user, currentAction, replacement, metric, outOfScope, frequency };
  return {
    exists: true,
    blocks,
    filledCount: Object.values(blocks).filter(isFilled).length,
    totalBlocks: 6,
    allFilled: Object.values(blocks).every(isFilled),
    outOfScopeCount: countListItems(outOfScope),
    metricMeasurable: hasMeasurableNumber(metric),
    replacementFilled: isFilled(replacement),
    // 岗位不是姓名：出现"经理/主管/总"且带姓氏样式的两三字人名 → 疑似写了人名
    userLooksLikeName: /[张王李赵刘陈杨黄周吴徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廉贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤]\s*(总|经理|老师|先生|女士|哥|姐)/.test(user),
    frequencyHasMagnitude: hasMeasurableNumber(frequency),
    currentActionHasTool: /纸|表格|Excel|excel|微信|电话|口头|钉钉|QQ|邮件|本子|白板|系统|群/.test(currentAction),
  };
}

/** 权限矩阵格子里认「不能」的几种写法。除这些之外的一律当"这个岗位动得了" */
const PERM_DENY = ['不能', '否', 'N', 'n', '×', 'x', 'X', '无', '无权'];
/** 像操作名的词。用来认哪一根轴是操作轴 */
const OP_HINT = /新建|创建|查看|浏览|修改|编辑|删除|导出|导入|提交|审批|审核|批准|作废|指派|派单|确认|关闭|退回|驳回|建档|录入|上传|下载|打印|汇总|统计|归档|停用|结算|付款|领料|盘点/;
/** 像岗位名的词 */
const ROLE_HINT = /(长|员|工|师|主任|经理|主管|管理员|财务|老板|干事|助理|护士|医生|老师|学生|客户|家长)$|角色|岗位|人员|职位/;

/** 表头角标（`角色 \ 操作` 这类）写的是哪一边，认不出来返回 null */
function axisKind(text) {
  const t = (text || '').trim();
  if (!t) return null;
  const role = /角色|岗位|人员|职位|谁/.test(t);
  const op = /操作|权限|功能|动作|事项/.test(t);
  if (role && !op) return 'role';
  if (op && !role) return 'op';
  return null;
}

/**
 * 权限矩阵有两种摆法，两种都得能正确读。
 *
 * 06-产物模板.md 模板五是「角色作行、操作作列」（表头第一格写 `角色 \ 操作`）；
 * scaffold 以前生成的空表是反过来的「操作作行、角色作列」。探测器原来只认后一种，
 * 于是照文档手填的人 roleCount 和 opCount 直接对调：一张 3 角色 × 5 操作的表，
 * 门禁 2.11 念成「5 个岗位 × 3 个操作」。这个工具唯一的产品就是读数，
 * 读数说反了比没有读数更坏——人会照着信。
 *
 * 判断顺序：先认表头第一格的 `行 \ 列` 角标（两份模板都带，最可靠），
 * 再退回数标签——哪边更像操作名（新建、导出、作废）哪边就是操作轴，
 * 还分不出来就再数哪边更像岗位名。三关都过不了返回 null，
 * 由调用方当"判不了"处理，绝不猜一个方向然后当成事实报出去。
 */
function permOrientation(table) {
  if (!table || !table.headers.length) return null;
  const corner = table.headers[0] || '';
  const parts = corner.split(/[\\/／]/).map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    // Markdown 里 `行 \ 列` 是通行写法，左边那半是行的含义
    const rowKind = axisKind(parts[0]);
    const colKind = axisKind(parts[1]);
    if (rowKind === 'role' || colKind === 'op') return 'roles';
    if (rowKind === 'op' || colKind === 'role') return 'ops';
  }
  const solo = axisKind(corner);
  if (solo === 'op') return 'ops';
  if (solo === 'role') return 'roles';
  const rowLabels = table.rows.map((r) => (r[0] || '').trim()).filter(Boolean);
  const colLabels = table.headers.slice(1).map((h) => (h || '').trim()).filter(Boolean);
  const count = (labels, re) => labels.filter((x) => re.test(x)).length;
  const rowOps = count(rowLabels, OP_HINT);
  const colOps = count(colLabels, OP_HINT);
  if (rowOps !== colOps) return rowOps > colOps ? 'ops' : 'roles';
  const rowRoles = count(rowLabels, ROLE_HINT);
  const colRoles = count(colLabels, ROLE_HINT);
  if (rowRoles !== colRoles) return rowRoles > colRoles ? 'roles' : 'ops';
  return null;
}

/** 环节二：流程 / 数据字典 / 状态机 / 权限矩阵 */
function probeModel(dir) {
  const process = loadArtifact(dir, '02-process.md');
  const dict = loadArtifact(dir, '02-dictionary.md');
  const states = loadArtifact(dir, '02-states.md');
  const perms = loadArtifact(dir, '02-permissions.md');

  // 正常流程每步有「谁做什么」
  const flowText = process.exists ? (sec(process, '正常流程', '主流程') || process.body) : '';
  const flowSteps = flowText.split('\n').filter((l) => /^\s*(?:\d+[.、)]|[-*+])\s+\S/.test(l));
  const stepsWithActor = flowSteps.filter((l) => /(→|->|：|:)/.test(l) && l.replace(/^[\s\d.、)\-*+]+/, '').length > 4);
  const exceptions = {
    stuck: isFilled(sec(process, '一直不处理', '超时')),
    wrongInput: isFilled(sec(process, '填错', '改错')),
    cancel: isFilled(sec(process, '取消', '谁能取消')),
  };

  // 数据字典：一个字典里通常有好几个实体，每个实体一张表。
  // 只读第一张表会漏掉后面的实体，所以按表头合并。
  const fieldTables = dict.tables.filter((t) => colIndex(t.headers, '字段', '字段名') !== -1);
  const dictTable = fieldTables.length === 0 ? (dict.tables[0] || null) : {
    headers: fieldTables[0].headers,
    rows: fieldTables.flatMap((t) => {
      // 各表列顺序可能不同，按表头重排到第一张表的列序
      const map = fieldTables[0].headers.map((h) => t.headers.findIndex((x) => x.trim() === h.trim()));
      return t.rows.map((r) => map.map((i) => (i === -1 ? '' : (r[i] || ''))));
    }),
  };
  const dictRows = dictTable?.rows || [];
  const iType = dictTable ? colIndex(dictTable.headers, '类型') : -1;
  const iReq = dictTable ? colIndex(dictTable.headers, '必填') : -1;
  const iWho = dictTable ? colIndex(dictTable.headers, '谁填', '填写人') : -1;
  const iWhen = dictTable ? colIndex(dictTable.headers, '什么时候', '填写时机', '时机') : -1;
  // 缺列要如实报出来，不能让"一个都没查"长得像"查过了没问题"。
  // 原来这两个值在缺列时都取空数组，于是把「类型」这一列整个删掉，
  // badTypes 为空、门禁 2.4「字段类型都在允许清单内」直接判绿——
  // 而隔了四行的 typeBlank 用 columnHasBlank 正确判红。同一个缺列事实，
  // 一条 fail-safe 一条 fail-open，绿的那条会把红的那条洗掉。
  const noTypeCol = dictTable ? iType === -1 : false;
  const badTypes = iType === -1 ? [] : dictRows
    .map((r) => (r[iType] || '').trim())
    .filter((t) => t && !ALLOWED_FIELD_TYPES.includes(t));
  // 门禁 2.3 要的是「有必填标记」，不是「必填这栏有字」。
  // 只查非空的话，写「看情况」「问一下班组长」也算标记好了——
  // 而这一栏的全部用途就是让 AI 知道哪个字段可以留空，
  // 模糊的答案传下去就变成 AI 自己猜，猜的结果没人知道。
  // 所以这里认死两个词：是 / 否（顺带收几种等价写法）。
  const REQ_YES = ['是', '必填', 'Y', 'y', '✓', '√', 'true'];
  const REQ_NO = ['否', '非必填', '选填', 'N', 'n', '-', '×', 'false'];
  const badRequired = iReq === -1 ? [] : dictRows
    .map((r) => (r[iReq] || '').trim())
    .filter((v) => v && !REQ_YES.includes(v) && !REQ_NO.includes(v));

  // 状态机流转表
  const stTable = states.tables.find((t) => colIndex(t.headers, '从', '当前状态') !== -1) || states.tables[0] || null;
  const stRows = stTable?.rows || [];
  const iFrom = stTable ? colIndex(stTable.headers, '从', '当前状态', '原状态') : -1;
  const iTo = stTable ? colIndex(stTable.headers, '到', '目标状态', '新状态') : -1;
  const iActor = stTable ? colIndex(stTable.headers, '谁能', '操作人', '角色') : -1;
  const froms = new Set(iFrom === -1 ? [] : stRows.map((r) => (r[iFrom] || '').trim()).filter(Boolean));
  const tos = new Set(iTo === -1 ? [] : stRows.map((r) => (r[iTo] || '').trim()).filter(Boolean));
  const declaredFinal = (sec(states, '终态', '结束状态') || '')
    .split(/[\n,，、]/).map((s) => s.replace(/[-*+\s]/g, '')).filter(Boolean);
  const allStates = new Set([...froms, ...tos]);
  // 孤岛：既不是起始状态、也没有任何流转能进来
  const startState = (sec(states, '初始状态', '起始') || '').replace(/[-*+\s]/g, '');
  const unreachable = [...allStates].filter((s) => s !== startState && !tos.has(s));
  // 死胡同：非终态但没有出口
  const deadEnd = [...allStates].filter((s) => !froms.has(s) && !declaredFinal.some((f) => f.includes(s) || s.includes(f)));

  // 权限矩阵
  const pTable = perms.tables[0] || null;
  const pRows = pTable?.rows || [];
  const permCells = [];
  if (pTable) {
    for (const r of pRows) {
      for (let c = 1; c < pTable.headers.length; c += 1) permCells.push((r[c] || '').trim());
    }
  }
  const blankPermCells = permCells.filter((v) => !v || v === '-').length;
  const badPermCells = permCells.filter((v) => v && !['能', '不能', '有条件'].includes(v));
  const hasConditional = permCells.some((v) => v === '有条件');
  const conditionsExplained = isFilled(sec(perms, '条件说明', '有条件'));
  const orientation = pTable ? permOrientation(pTable) : null;
  const rowLabelCount = pRows.filter((r) => (r[0] || '').trim()).length;
  const colLabelCount = pTable ? Math.max(0, pTable.headers.length - 1) : 0;
  // 认不出摆法时不猜。roleCount/opCount 留 null，由 2.11 报"判不了"，
  // 总格数照样能数——空格和错词那两条判定不依赖哪根轴是什么。
  const roleCount = orientation === 'roles' ? rowLabelCount : (orientation === 'ops' ? colLabelCount : null);
  const opCount = orientation === 'ops' ? rowLabelCount : (orientation === 'roles' ? colLabelCount : null);

  /**
   * 「有没有人能真删数据」只看删除那一格填的是什么。
   *
   * 原来找不到叫「删除」的行时，会回落成"表头里有没有『删除』两个字"——
   * 于是照 06-产物模板.md 摆表的人（删除是一列，不是一行）全被判成"有岗位能真删"，
   * 而文档正文明写着这一栏基本都填不能。照文档做对了的人拿到红灯，
   * 这比漏判更伤：他会认为工具在乱说，然后开始忽略所有判定。
   * 现在两种摆法都去读那一格的内容，认不出摆法时返回 null（判不了），不返回 false。
   */
  let deleteAllowedSomewhere = false;
  if (!pTable) {
    deleteAllowedSomewhere = false;
  } else if (orientation === null) {
    deleteAllowedSomewhere = null;
  } else {
    const isDeny = (v) => PERM_DENY.includes((v || '').trim());
    const cellsOf = () => {
      if (orientation === 'ops') {
        const row = pRows.find((r) => /删除|删掉|物理删除/.test(r[0] || ''));
        return row ? row.slice(1) : null;
      }
      const c = pTable.headers.findIndex((h) => /删除|删掉|物理删除/.test(h || ''));
      return c === -1 ? null : pRows.map((r) => r[c]);
    };
    const cells = cellsOf();
    // 表里根本没有删除这一项 → 没人能删（等于没给这个权限），不是判不了
    deleteAllowedSomewhere = cells === null
      ? false
      : cells.some((v) => (v || '').trim() && !isDeny(v));
  }

  return {
    process: { exists: process.exists, stepCount: flowSteps.length, stepsWithActor: stepsWithActor.length, exceptions,
      allExceptionsAnswered: Object.values(exceptions).every(Boolean) },
    dictionary: { exists: dict.exists, fieldCount: dictRows.length,
      typeBlank: dictTable ? columnHasBlank(dictTable, '类型') : true,
      requiredBlank: dictTable ? columnHasBlank(dictTable, '必填') : true,
      whoBlank: iWho === -1 ? true : columnHasBlank(dictTable, '谁填', '填写人'),
      whenBlank: iWhen === -1 ? true : columnHasBlank(dictTable, '什么时候', '填写时机', '时机'),
      badTypes,
      badRequired,
      noTypeCol,
      noRequiredCol: dictTable ? iReq === -1 : false,
      relationsDeclared: isFilled(sec(dict, '关联', '实体关系', '关系')) },
    states: { exists: states.exists, transitionCount: stRows.length, stateCount: allStates.size,
      unreachable, deadEnd, finalMarked: declaredFinal.length > 0,
      actorBlank: iActor === -1 ? true : columnHasBlank(stTable, '谁能', '操作人', '角色') },
    permissions: { exists: perms.exists, roleCount, opCount, orientation,
      cellCount: permCells.length,
      blankCells: blankPermCells, badCells: badPermCells,
      hasConditional, conditionsExplained, deleteAllowedSomewhere },
  };
}

/** 环节三：功能清单 + 非功能要求 */
function probeSpec(dir, scopeCard) {
  const feat = loadArtifact(dir, '03-features.md');
  const nf = loadArtifact(dir, '03-nonfunctional.md');
  // 占位符和填写说明先剥掉。模板里的 AC-001 示例带着「给定/当/则」三段，
  // 不剥的话一个字没填的空模板会被判成"2 条标准全部格式完整"——
  // 而验收标准是整个方法论的地基，这一栏最不能放水。
  const body = strip(feat.body || '');
  const acCodes = extractACCodes(body);

  /**
   * 逐条验收标准：拆成块，检查给定/当/则三段。
   *
   * 只有标题行（### AC-009 ...）能开一个新块。正文里顺带引用别的编号
   * （「这一条由 AC-009 单独验证」）不算——那是一句话，不是一条标准。
   *
   * 原来这里是「任何一行只要含 AC 编号就开新块」，后果是引用句会把真正的
   * 标准顶掉：被引用的那条只剩下一句引用文字，三段判定必然不通过，
   * 于是文件写得好好的却报「AC-009 三段没写全」。更麻烦的是它跟顺序有关——
   * 引用句出现在真标题之后才会踩雷，在之前就被真标题覆盖回来了，
   * 所以同一份文件里有的条目误报、有的不报，看不出规律。
   */
  const acBlocks = [];
  const lines = body.split('\n');
  let cur = null;
  for (const line of lines) {
    const acInHeading = /^#{1,6}\s.*?\bAC-?\d{1,4}\b/i.exec(line);
    if (acInHeading) {
      if (cur) acBlocks.push(cur);
      cur = { code: (line.match(/\bAC-?\d{1,4}\b/i) || [''])[0], text: line };
      continue;
    }
    if (!cur) continue;
    // 表格行里也会出现编号（功能清单那张表），那不是标准正文，但要留在正文里
    cur.text += `\n${line}`;
    // 遇到下一个标题（不带 AC 编号的，比如 ## 另一节）就收尾
    if (/^#{1,6}\s/.test(line)) { acBlocks.push(cur); cur = null; }
  }
  if (cur) acBlocks.push(cur);

  const incompleteAC = acBlocks.filter((b) => !(/给定|Given/i.test(b.text) && /当|When/i.test(b.text) && /则|Then/i.test(b.text)))
    .map((b) => b.code);
  const bannedHits = [];
  for (const b of acBlocks) {
    const hits = findBannedWords(b.text);
    if (hits.length) bannedHits.push({ code: b.code, words: hits });
  }
  const negativeBlocks = acBlocks.filter((b) => /不能|拒绝|失败|报错|无权|超过|为空|重复|非法|不允许|提示/.test(b.text));
  const negativeCount = negativeBlocks.length;
  // 6.5 需要知道：异常路径的 AC 编号是哪些，才能和追溯表交叉核。
  // 只数「有几条异常标准」而不查对照表有没有测试，是 B-6 漏洞的根源。
  const negativeCodes = negativeBlocks.map((b) => b.code).filter(Boolean);

  // 功能清单里每个功能有没有 AC
  const featTable = feat.tables[0] || null;
  const featureRows = featTable?.rows || [];
  const iAC = featTable ? colIndex(featTable.headers, '验收标准', '标准编号', 'AC') : -1;
  const featuresWithoutAC = iAC === -1
    ? featureRows.map((r) => r[0]).filter(Boolean)
    : featureRows.filter((r) => !isFilled(r[iAC] || '')).map((r) => r[0]);

  // 范围偷偷扩张：验收标准里出现了场景卡「明确不做」里的关键词
  const outOfScopeTerms = (scopeCard?.blocks?.outOfScope || '')
    .split('\n').map((l) => l.replace(/^[\s\-*+\d.、)]+/, '').trim())
    .filter((t) => t.length >= 2 && t.length <= 12);
  const scopeViolations = [];
  for (const term of outOfScopeTerms) {
    const key = term.replace(/[（(].*?[)）]/g, '').slice(0, 8);
    if (key.length >= 2 && body.includes(key)) scopeViolations.push(key);
  }

  // 非功能七项
  const nfItems = ['数据量', '响应', '保留', '可用', '终端', '网络', '语言'];
  const nfFilled = nfItems.map((k) => ({ k, filled: isFilled(sec(nf, k)) }));

  return {
    features: { exists: feat.exists, acCount: acCodes.length, acCodes, incompleteAC, bannedHits,
      negativeCount, negativeCodes, featureCount: featureRows.length, featuresWithoutAC, scopeViolations,
      // 标准正文。给"有没有某类场景"这种判定用——只做关键词匹配，不理解语义。
      acText: acBlocks.map((b) => b.text).join('\n'),
      acBlocks,
      inRange: acCodes.length >= 20 && acCodes.length <= 100 },
    nonFunctional: { exists: nf.exists, items: nfFilled, missing: nfFilled.filter((x) => !x.filled).map((x) => x.k) },
  };
}

/** 环节六：追溯对照表 */
function probeTraceability(dir, acCodes) {
  const a = loadArtifact(dir, '06-traceability.md');
  if (!a.exists) return { exists: false, covered: [], uncovered: acCodes, blankRows: 0, badLevels: [] };
  const t = a.tables.find((x) => colIndex(x.headers, '验收标准', 'AC') !== -1) || a.tables[0] || null;
  if (!t) return { exists: true, covered: [], uncovered: acCodes, blankRows: 0, badLevels: [] };
  const iAC = colIndex(t.headers, '验收标准', 'AC', '标准编号');
  const iTest = colIndex(t.headers, '测试', '测试文件', '用例');
  const iLevel = colIndex(t.headers, '层级', '级别');
  const iResult = colIndex(t.headers, '结果', '状态');
  const covered = [];
  let blankRows = 0;
  const badLevels = [];
  const failing = [];
  // 表里点名的测试文件，原样收着。对照表是全项目唯一一处「文档指名道姓提到代码」的地方，
  // 所以它也是唯一能把文档和磁盘对起来的地方——这一步只比文件名，不看文件内容，
  // 不违反规则二（判据不许靠读代码）：数文件在不在，人自己也能数。
  const declaredTests = [];
  for (const r of t.rows) {
    const ac = (r[iAC] || '').trim();
    const test = iTest === -1 ? '' : (r[iTest] || '').trim();
    const level = iLevel === -1 ? '' : (r[iLevel] || '').trim();
    const result = iResult === -1 ? '' : (r[iResult] || '').trim();
    if (!isFilled(ac) || !isFilled(test) || (iLevel !== -1 && !isFilled(level))) blankRows += 1;
    if (level && !ALLOWED_TEST_LEVELS.includes(level)) badLevels.push(level);
    if (isFilled(ac) && isFilled(test)) covered.push(ac.match(/AC-?\d{1,4}/i)?.[0]?.replace(/AC-?/i, 'AC-') || ac);
    if (result && /红|失败|未过|fail/i.test(result)) failing.push(ac);
    // 一格里可能写了好几个文件（逗号或分号隔开）
    if (isFilled(test)) {
      for (const one of test.split(/[,，;；\s]+/)) {
        const name = one.trim();
        // 只认像文件路径的写法。写「见单元测试」这种就不算点名，不去磁盘上找。
        if (name && /\.[a-z]{1,5}$/i.test(name)) declaredTests.push({ ac, file: name });
      }
    }
  }
  const norm = (c) => c.replace(/AC-?/i, '').padStart(3, '0');
  const coveredSet = new Set(covered.map(norm));
  return {
    exists: true,
    rowCount: t.rows.length,
    covered,
    uncovered: acCodes.filter((c) => !coveredSet.has(norm(c))),
    blankRows,
    badLevels,
    failing,
    declaredTests,
  };
}

/** 环节七：交接清单 */
function probeHandover(dir) {
  const a = loadArtifact(dir, '07-handover.md');
  if (!a.exists) return { exists: false, blocks: {}, filledCount: 0 };
  const blocks = {
    access: sec(a, '访问', '地址', '账号'),
    deploy: sec(a, '部署', '怎么部'),
    backup: sec(a, '备份', '恢复'),
    contact: sec(a, '联系', '找谁', '支持'),
  };
  const url = (blocks.access.match(/https?:\/\/[^\s)）"']+/) || [null])[0];
  return {
    exists: true,
    blocks,
    filledCount: Object.values(blocks).filter(isFilled).length,
    allFilled: Object.values(blocks).every(isFilled),
    url,
    isHttps: url ? url.startsWith('https://') : false,
    restoreDrillRecorded: /演练|恢复.*(成功|完成|通过)/.test(blocks.backup) && /\d{4}[-/年]\d{1,2}/.test(blocks.backup),
    // 及格线第三条的判据要素。07-门禁清单.md:231 要求加固：
    // 光对条数不够，得抽几条比对字段值，对不上直接不通过。
    // 所以这里把演练记录拆成四个可分别检查的要素，让门禁能说清缺哪一样。
    restoreDrill: (() => {
      const b = blocks.backup || '';
      const exists = /演练|真删|删了再恢复|恢复.{0,6}(成功|完成|通过|演练)/.test(b);
      return {
        exists,
        hasDate: /\d{4}[-/年]\d{1,2}[-/月]?\d{0,2}/.test(b),
        hasElapsed: /(耗时|花了|用了|历时|分钟|小时)/.test(b),
        // 抽查证据：要指认到具体单据/字段/条目，而不是"数据都在"。
        hasSample: /(核对|比对|抽查|逐条|对照)/.test(b) && /(单|表|条|张|记录|字段|明细|账|号)/.test(b),
        // 只数条数、没比内容——这是文档点名要拦的那种"看起来演练过了"。
        countOnly: /(条数|数量|总数|行数)\s*(对得上|一致|相同|正确|没错)/.test(b)
          && !/(字段|内容|明细|逐条比对|值)/.test(b),
      };
    })(),
    otherPersonDeployed: /换人|另一人|第二人|他人|复核|签字/.test(blocks.deploy) && /\d{4}[-/年]\d{1,2}/.test(blocks.deploy),
    // 及格线第二条要求"另一个具体的人"，不是泛泛的"换人复核"。
    // 判据是：部署记录里有没有落下一个可指认的人。
    // 三种常见写法都收：「由张工独立完成」「操作人：李明」「换人部署（王强）」。
    // 这只是入场券——"照文档真能装起来"最终还是要人确认（human(f,'7.4')）。
    otherPersonNamed: /(?:装的人|部署人|谁装的|操作人|执行人|验证人|完成人)\s*[：:]\s*\S{2,}/.test(blocks.deploy)
      || /由\s*[^，。；\n]{0,8}?[一-龥]{2,4}(?:工程师|工|师|经理|同学|老师)?\s*(?:按|照|独立|完成|执行|操作|部署|装)/.test(blocks.deploy)
      || /(?:换人|另一人|第二人|他人)[^，。\n]{0,8}[（(【\[][^\s）)】\]]{2,}/.test(blocks.deploy),
    trainingRecorded: /培训/.test(a.body) && /\d{4}[-/年]\d{1,2}/.test(a.body),
  };
}

/** 环节八：问题台账 + 变更记录 */
function probeOperate(dir) {
  const issues = loadArtifact(dir, '08-issues.md');
  const changes = loadArtifact(dir, '08-changes.md');
  const it = issues.tables[0] || null;
  const ct = changes.tables[0] || null;
  const iGrade = it ? colIndex(it.headers, '分级', '级别', '等级') : -1;
  const iStatus = it ? colIndex(it.headers, '状态', '处理') : -1;
  // 「需求」这个值写在哪一列，两份模板不一样：
  // scaffold 生成的台账单开一列「类型」；06-产物模板.md 模板九把「需求」当成分级的第四档。
  // 只找「类型」的话，照文档填的人这一列就是 -1，requestsInBugFlow 恒为 0，
  // 门禁 8.4 于是恒绿——一条永远不会响的警报，比没有这条门禁更坏。
  // 所以先找类型，找不到就回落到分级；两个都没有时如实报出来（noKindCol），
  // 由 8.4 判 ask，不判 pass。
  const iKindOwn = it ? colIndex(it.headers, '类型', '分类') : -1;
  const iKind = iKindOwn !== -1 ? iKindOwn : iGrade;
  const iDeal = it ? colIndex(it.headers, '处理', '处置', '结论') : -1;
  const iLink = ct ? colIndex(ct.headers, '关联', '验收标准', 'AC') : -1;
  // 变更记录的三列，对应门禁 8.5 / 8.6 / 8.7。
  const iSchema = ct ? colIndex(ct.headers, '数据模型', '数据结构', '动数据', '表结构') : -1;
  const iTest = ct ? colIndex(ct.headers, '测试', '全绿') : -1;
  const iBackup = ct ? colIndex(ct.headers, '备份') : -1;
  const issueRows = it?.rows || [];
  const changeRows = ct?.rows || [];
  return {
    issues: {
      exists: issues.exists,
      count: issueRows.length,
      ungraded: iGrade === -1 ? issueRows.length : issueRows.filter((r) => !isFilled(r[iGrade] || '')).length,
      open: iStatus === -1 ? 0 : issueRows.filter((r) => /未|待|进行/.test(r[iStatus] || '')).length,
      // 台账里根本没有能区分「需求」和「缺陷」的那一列。
      // 这时 8.4 判不了，得说判不了，不能说没问题。
      noKindCol: iKind === -1,
      // 「需求」出现在台账里本身不算错——错的是把它当 bug 在这条流程里改掉。
      // 只做格式判断：处置栏写了转出去向、且状态已收口，就算正确路由。
      requestsInBugFlow: iKind === -1 ? 0 : issueRows.filter((r) => {
        if (!/需求|新功能/.test(r[iKind] || '')) return false;
        const done = iDeal === -1 ? '' : (r[iDeal] || '');
        const st = iStatus === -1 ? '' : (r[iStatus] || '');
        const routed = /转|下一轮|下一批|场景卡|另立|本轮不做|不做/.test(done);
        const closed = /关闭|转出|已收/.test(st);
        return !(routed && closed);
      }).length,
    },
    changes: {
      exists: changes.exists,
      count: changeRows.length,
      unlinked: iLink === -1 ? changeRows.length : changeRows.filter((r) => !isFilled(r[iLink] || '')).length,
      // 门禁 8.5 / 8.6 / 8.7 的判据。
      // 这三条原来读 notes.releases——一个全仓库没人写的字段，于是恒判 na。
      // 现在读学员真在填的变更记录三列（06-产物模板.md 里本来就有这三列）。
      // 「列不存在」和「填了否」要分开报：一个是记录方式不对，一个是真违规。
      noSchemaCol: iSchema === -1,
      noTestCol: iTest === -1,
      noBackupCol: iBackup === -1,
      schemaChangedNoModelUpdate: iSchema === -1 ? 0 : changeRows.filter((r) => {
        const v = r[iSchema] || '';
        if (!/是|有|改了|动了|Y/i.test(v) || /否|没|无|N\b/i.test(v)) return false;
        // 动了数据模型，就要能看出"回去改过字典了"。
        return !/(同步|已改|已更新|字典|数据字典|环节二)/.test(changeRows.flat().join(' ')) && !/(同步|已更新|字典)/.test(v);
      }).length,
      notGreen: iTest === -1 ? 0 : changeRows.filter((r) => /否|没|失败|红|未过|N\b/i.test(r[iTest] || '')).length,
      testBlank: iTest === -1 ? 0 : changeRows.filter((r) => !isFilled(r[iTest] || '')).length,
      notBackedUp: iBackup === -1 ? 0 : changeRows.filter((r) => /否|没|无|未|N\b/i.test(r[iBackup] || '')).length,
      backupBlank: iBackup === -1 ? 0 : changeRows.filter((r) => !isFilled(r[iBackup] || '')).length,
    },
  };
}

export function probeArtifacts(dir) {
  const scopeCard = probeScopeCard(dir);
  const model = probeModel(dir);
  const spec = probeSpec(dir, scopeCard);
  const traceability = probeTraceability(dir, spec.features.acCodes);
  const handover = probeHandover(dir);
  const operate = probeOperate(dir);

  // 动态判据：读缓存，机械匹配。缓存不存在则 dynDims = null（门禁 6.5 退回静态正则）。
  //
  // 缓存过期必须单独认一次。字典加了一栏、状态机多了一个状态之后，旧清单还在，
  // 逐条检查照样跑得出结果——只是新加的那一栏根本没人问过它的极端情况。
  // 这种绿灯比红灯危险：它是工具自己印上去的，而人看不出清单是哪天生成的。
  // 所以指纹一不对就退回静态，并且把"该重新生成"这件事往上传。
  let dynDims = null;
  let dynDimsStale = false;
  const cached = loadCachedDims(dir);
  if (cached) {
    const nowFp = anchorFingerprint(dir);
    // 老缓存没有指纹字段。当过期处理——宁可多提示一次重新生成。
    if (!cached.anchorFingerprint || cached.anchorFingerprint !== nowFp) {
      dynDimsStale = true;
    } else {
      const a = anchors(dir);
      const { kept, dropped } = admit(cached.items, a);
      const { rows, naked } = judge(kept, spec.features.acBlocks);
      dynDims = { rows, naked, dropped, generatedAt: cached.generatedAt };
    }
  }

  // 哪些产物文件真的在盘上。指引层要用它——文件不存在时不能叫人"打开"它，
  // 得先叫人生成模板。判定层不看这个（门禁自己有 exists 判据）。
  //
  // 存成数组不存成 Set：这份事实集会整个 JSON 化发给浏览器，
  // Set 过 JSON.stringify 会变成 {}，静默丢内容。数组过去还是数组。
  const present = ALL_ARTIFACT_FILES.filter((f) => loadArtifact(dir, f).exists);

  return {
    scopeCard, model, spec, traceability, handover, operate,
    frozen: loadFrozen(dir), dynDims, dynDimsStale, present,
  };
}
