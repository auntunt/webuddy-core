/**
 * 严格度计算：gate.severity → effective severity，受 mode 和挂钩状态影响。
 *
 * 门禁上声明的 severity 是天花板，不是最终档位。
 * 学习模式、原型模式会把大半条目降档；挂钩没装时，开发纪律类的也降。
 *
 * 三档：block（真拦）/ warn（红灯但可跳）/ info（灰色提示）。
 */

/**
 * 三种模式。默认 mvp——多数人来这儿是想先做出个能用的东西。
 *
 * learning 只拦核心，full 全开，mvp 在中间：block 和 warn 都算，info 不出声。
 */
export const MODES = [
  { id: 'learning', name: '课程学习', desc: '只拦最核心的十几条，其余都是建议' },
  { id: 'mvp', name: '原型试做', desc: '拦真会出事的，红灯提醒其余的' },
  { id: 'full', name: '正式交付', desc: '全部生效，包括锦上添花的那些' },
];

const MODE_IDS = new Set(MODES.map((m) => m.id));

/** 拿不认识的模式当 mvp。旧的 state.json 没有 mode 字段，走的就是这条。 */
export function normalizeMode(mode) {
  return MODE_IDS.has(mode) ? mode : 'mvp';
}

/**
 * 这个模式下 info 档要不要显示。
 *
 * mvp 下 info 静默：非技术人员看到的红灯已经够多了，
 * 「锦上添花」那几条在做原型阶段只会分散注意力。
 */
export function showsInfo(mode) {
  return normalizeMode(mode) === 'full';
}

/**
 * 挂钩没装时自动降档的那几条。
 *
 * 这几条的判据全要读轮次和 events.jsonl：没装挂钩时永远判不出结果，
 * 让它们一直红着等于制造永远清不掉的错误——那比不检查更坏。
 */
const HOOK_DEPENDENT = new Set(['5.2', '5.3', '5.4', '5.5', '5.7', '5.8']);

/**
 * 学习模式（课程作业）只拦声明为 block 的那些，warn 全降成 info。
 *
 * 这里故意不另列一份「学习模式核心清单」：那份清单跟 stages.js 里
 * 声明 block 的十几条会是同一批，写两遍就等于留了个迟早对不上的隐患。
 * 谁调了某条门禁的档位，学习模式跟着变，这是对的。
 *
 * 课程作业的特征：没有第二个人，没有真数据，目标是学会八步怎么走。
 * 所以「不做一定出事」的照拦，「强烈建议」的全部退成灰字。
 */

/**
 * 这一档在这个模式下算不算数。
 *
 * 算数 = 进分子分母、状态受它影响、界面上列出来。
 * 不算数 = 完全静默，既不拦也不扣分。
 *
 * 只有 info 会被静默，而且只在非 full 模式。为什么要把它从分母里也拿掉：
 * 学习模式下 88 条里有 70 条是 info，留在分母里的话，一个把 18 条核心
 * 全做对的学生看到的是「18/88，20%」——他该做的全做了，却像只走了五分之一。
 * 分母跟「这个模式要求你做什么」对齐，才是诚实的。
 *
 * 这也是 counts 各个桶能加得起来的前提：所有桶用同一个过滤器，
 * 不能状态算一套、百分比算另一套（check/fixtures.mjs 的 sane() 会当场抓到）。
 */
export function isActive(sev, mode) {
  return sev !== 'info' || showsInfo(mode);
}

/**
 * 计算一条门禁的有效严格度。
 *
 * @param {object} gate - 门禁对象，必须含 id 和 severity
 * @param {object} opts - { mode, hookInstalled }
 * @returns {string} 'block' | 'warn' | 'info'
 */
export function effectiveSeverity(gate, { mode = 'mvp', hookInstalled = true } = {}) {
  if (!gate || !gate.severity) {
    throw new Error(`gate 缺 severity 字段：${JSON.stringify(gate)}`);
  }

  const m = normalizeMode(mode);

  // 挂钩降档优先：没装挂钩时，这几条永远判不出结果，降到 info 免得一直红着
  if (!hookInstalled && HOOK_DEPENDENT.has(gate.id)) return 'info';

  // 学习模式：block 照拦，warn 和 info 一律降成灰字建议
  if (m === 'learning') {
    return gate.severity === 'block' ? 'block' : 'info';
  }

  // mvp 和 full：直接用声明档位。两者的差别在 info 显不显示，不在档位本身
  return gate.severity;
}

/**
 * 批量计算。给 evaluate.js 用，一次算完全部门禁的有效档位。
 *
 * @param {Array} gates - ALL_GATES
 * @param {object} opts - { mode, hookInstalled }
 * @returns {Map<string, string>} gateId → effective severity
 */
export function effectiveSeverityMap(gates, opts) {
  const map = new Map();
  for (const g of gates) {
    map.set(g.id, effectiveSeverity(g, opts));
  }
  return map;
}
