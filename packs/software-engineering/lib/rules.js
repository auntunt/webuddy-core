/**
 * 门禁判定规则：事实集 → 每条门禁的结论。
 *
 * 每条规则返回三种之一（07-门禁清单.md 规定，不打分）：
 *   'pass'    通过
 *   'fix'     待改（能过，但要先改）
 *   'fail'    不通过
 * 另有 'na' 不适用、'ask' 需要人确认（auto 判不了的）。
 *
 * detail 字段是给非技术人员看的具体原因，必须说清"哪里"和"怎么改"。
 */

import { ALLOWED_FIELD_TYPES } from './parse.js';
import { judgeHumanRecord } from './human-check.js';

const P = 'pass'; const F = 'fail'; const X = 'fix'; const ASK = 'ask'; const NA = 'na';

/**
 * 人工门禁项：查本地状态里有没有记过。没记过就是 ask，不算 fail。
 * 记过了还要看这条记录本身信不信得过（日期、凭据），判据见 human-check.js。
 */
function human(f, id) {
  return judgeHumanRecord(f.local.humanChecks[id], f.local.humanChecks, id);
}

export const RULES = {
  // ───────── 环节一 场景定义 ─────────
  '1.5': (f) => (f.art.scopeCard.userLooksLikeName
    ? { r: X, detail: '使用者写成了人名。改成岗位，比如「车间班组长」' }
    : { r: P }),
  '1.6': (f) => (f.art.scopeCard.currentActionHasTool ? { r: P } : human(f, '1.6')),
  // ───────── 环节二 流程与数据建模 ─────────
  '2.1': (f) => {
    const p = f.art.model.process;
    if (!p.exists) return { r: F, detail: '还没有流程说明。把这件事从头到尾分成几步，每步写清谁做什么（文件在 artifacts/02-process.md）' };
    if (p.stepCount === 0) return { r: F, detail: '流程里没有列出步骤' };
    const gap = p.stepCount - p.stepsWithActor;
    return gap === 0 ? { r: P, detail: `${p.stepCount} 步全部写了谁做什么` } : { r: F, detail: `${gap} 步没写清谁做什么` };
  },
  '2.2': (f) => {
    const e = f.art.model.process.exceptions || {};
    if (!f.art.model.process.exists) return { r: F, detail: '还没有流程说明' };
    const miss = [];
    if (!e.stuck) miss.push('一直不处理怎么办');
    if (!e.wrongInput) miss.push('填错了怎么改');
    if (!e.cancel) miss.push('谁能取消');
    return miss.length === 0 ? { r: P } : { r: F, detail: `这几个异常没回答：${miss.join('、')}` };
  },
  '2.4': (f) => {
    const d = f.art.model.dictionary;
    const bad = d.badTypes || [];
    if (!d.exists) return { r: F, detail: '还没有数据字典' };
    // 一个字段都没写的时候，"类型都在清单内"成立但没有意义。
    if (!d.fieldCount) return { r: F, detail: '数据字典还没有字段' };
    // 压根没有「类型」这一列时，"没有非法类型"是真的——因为一个类型都没写。
    // 这里判红不判"要人确认"：列在不在，工具看得一清二楚，不存在判不了；
    // 而且这是人自己动手就能补的事。判绿是绝对不行的，
    // 那等于告诉他"类型都填对了"，他就不会再回来看这一栏。
    if (d.noTypeCol) {
      return { r: F, detail: `数据字典缺「类型」这一列，所以没法看类型填得对不对。给表加一列「类型」，每个字段填一个：${ALLOWED_FIELD_TYPES.join(' ')}` };
    }
    // 报错要顺手给出合法值。只说"用了清单外的类型"，人得回去翻文档才知道能填什么。
    if (bad.length === 0) return { r: P };
    return { r: F, detail: `用了清单外的类型：${[...new Set(bad)].join('、')}。只能用：${ALLOWED_FIELD_TYPES.join(' ')}` };
  },
  '2.6': (f) => {
    const d = f.art.model.dictionary;
    if (!d.exists) return { r: F, detail: '还没有数据字典' };
    return d.relationsDeclared ? { r: P } : { r: X, detail: '没写清两类数据之间的关系。比如「一张领料单配多条物料明细」，还是「一个人能领多类物料、一类物料也能给多个人」' };
  },
  '2.7': (f) => {
    const s = f.art.model.states;
    if (!s.exists) return { r: F, detail: '还没写单据的流转规则。列一张表：从哪个状态、到哪个状态、谁能做这一步。比如「待审 → 已批，科长」（文件在 artifacts/02-states.md）' };
    // 空表上"没有进不去的状态"是真的，但毫无意义——一个状态都还没写。
    if (!s.transitionCount) return { r: F, detail: '流转表还是空的。至少写一行：从哪个状态、到哪个状态、谁能做这一步' };
    return s.unreachable.length === 0
      ? { r: P }
      : { r: F, detail: `这几个状态谁也走不进去，写了等于没有：${s.unreachable.join('、')}。补一行说清从哪个状态能到它` };
  },
  '2.8': (f) => {
    const s = f.art.model.states;
    if (!s.exists) return { r: F, detail: '还没写单据的流转规则' };
    if (!s.transitionCount) return { r: F, detail: '流转表还是空的' };
    return s.deadEnd.length === 0
      ? { r: P }
      : { r: F, detail: `单子走到这几个状态就卡住出不来了：${s.deadEnd.join('、')}。要么给它写个下一步，要么标明「到这儿就算办完了」` };
  },
  '2.11': (f) => {
    const p = f.art.model.permissions;
    if (!p.exists) return { r: F, detail: '还没有权限表。画一张表：左边列岗位，上面列操作（看、填、改、批、导出），每一格填能 / 不能 / 有条件（文件在 artifacts/02-permissions.md）' };
    // 0 个格子的矩阵当然"无空格"。这种绿灯比红灯有害。
    if (!p.cellCount) return { r: F, detail: '权限表还没列操作。先把要管的操作写出来：看、填、改、批、导出、作废' };
    if (p.blankCells > 0) return { r: F, detail: `权限表有 ${p.blankCells} 格是空的。空着的格上线后就成了默认允许，每格都要填：能 / 不能 / 有条件` };
    if (p.badCells.length > 0) return { r: F, detail: `有 ${p.badCells.length} 格填了别的词。只能填这三个：能 / 不能 / 有条件` };
    // 认不出哪边是岗位、哪边是操作时不许报数。报反了（把 3 个岗位念成 5 个）
    // 人是照着信的，而这工具唯一的产品就是读数。
    if (p.roleCount === null || p.opCount === null) {
      return { r: ASK, detail: '每一格都填了，但看不出这张表哪边是岗位、哪边是操作，所以数不出个数。在表头第一格写上「角色 \\ 操作」（表示一行一个岗位、一列一个操作），或者反过来写「操作 \\ 角色」' };
    }
    return { r: P, detail: `${p.roleCount} 个岗位 × ${p.opCount} 个操作，一格没漏` };
  },
  '2.14': (f) => {
    const p = f.art.model.permissions;
    if (!p.exists) return { r: F, detail: '还没有权限表' };
    // 矩阵还没填的时候，"没人能删"是因为一个操作都没写，不是因为设计得好。
    if (!p.cellCount) return { r: F, detail: '权限表还是空的。先把岗位和操作填上，每格填能 / 不能 / 有条件' };
    // 摆法认不出来，就不知道该看哪一格的删除权限。这时候说"没人能删"是替用户
    // 编了个好消息——删数据这件事上，编好消息的代价是数据真的没了。
    if (p.deleteAllowedSomewhere === null) {
      return { r: ASK, detail: '看不出这张表哪边是岗位、哪边是操作，所以查不到「删除」那一格填的是什么。在表头第一格写上「角色 \\ 操作」，然后自己确认一遍：有没有哪个岗位能真删数据' };
    }
    if (!p.deleteAllowedSomewhere) return { r: P, detail: '没有角色能真删数据' };
    const rec = f.local.humanChecks['2.14'];
    if (rec) return human(f, '2.14');
    return { r: ASK, detail: '权限表里有岗位能真删数据。这不一定错，但值得你看一眼：业务系统里删掉就找不回来，通常改成「作废」更稳——单子还在，只是不算了' };
  },

  // ───────── 环节三 规格与验收标准 ─────────
  '3.5': (f) => (f.art.scopeCard.exists && f.art.spec.features.exists ? human(f, '3.5') : { r: F, detail: '缺场景卡或功能清单，无法对照' }),
  '3.7': (f) => human(f, '3.7'),
  '3.9': (f) => {
    const n = f.art.spec.features.acCount;
    if (n === 0) return { r: F, detail: '还没有验收标准' };
    if (n < 20) return { r: X, detail: `只有 ${n} 条，通常是想漏了（参考区间 20–100）。这条只提示，不阻断` };
    if (n > 100) return { r: X, detail: `有 ${n} 条，通常是范围没收住。回去看场景卡的「明确不做」。这条只提示，不阻断` };
    return { r: P, detail: `${n} 条，在合理区间` };
  },
};
