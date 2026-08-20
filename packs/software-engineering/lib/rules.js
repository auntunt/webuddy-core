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
  // 环节一没有留 native：1.6 是 human 门禁，而 human 门禁的 native 只有 fail/fix
  // 会被采纳（内核 humanPrecheck），pass/ask 两个分支根本到不了调用点。
  // 原来那条 `currentActionHasTool ? pass : human()` 两个出口都不可达，等于占着名额的死代码。
  // ───────── 环节二 流程与数据建模 ─────────
  // 2.14 交给 DSL：判的是权限表里「删除」那一行有没有哪格填了「能」。
  // ref 在表头摆法认不出来时判 ask，本包改为要求表头能被读出来（table-column-filled）——
  // 读不出来就判不过，让人去把表头写清楚，而不是挂一个含糊的你自己看一眼。


  // ───────── 环节三 规格与验收标准 ─────────
  '3.5': (f) => (f.art.scopeCard.exists && f.art.spec.features.exists ? human(f, '3.5') : { r: F, detail: '缺场景卡或功能清单，无法对照' }),
  // 3.7 原来是 `(f) => human(f, '3.7')`，跟内核对 human 门禁的默认处理逐字同义，
  // 删掉裁决一个字不变。
};
