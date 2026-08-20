/**
 * 软件工程包的 native 判定（§10.1 步骤 3：ref 的 92 条全量接过来）。
 *
 * 这里是个转接层，不是重写层。判据本体在 lib/rules.js + lib/rules-late.js，
 * 每一条的函数体与 ref/webuddy-console/src/ 下同名文件逐字相同——故意不动一个字：
 *   逐条重敲 1000 行判据，抄错一个字段名（f.art.model.process.stepCount
 *   写成 stepsCount）就是一条静默判错的门禁，而单测很难发现，
 *   因为它照样返回一个合法的五态结果。原样接过来，判定语义天然与 ref 一致，
 *   §5.5 条件 3 的逐字段对拍才有意义。
 *
 * 两个 lib 文件现在不再与 ref 逐字节相同：P3a–P3d 按 §10.2「同一提交内完成」
 * 把能用 DSL 表达的条目整条删掉了（ref 侧 31+61=92 条，这里剩 1+19=20 条；
 * 删除清单见 native-删除清单.stage-*.txt）。留下的每一条仍是原文，
 * 删掉的那些不改写、不注释掉——注释掉的判据没人敢删，会一直烂在文件里。
 *
 * 签名适配：内核给判定函数的是 ctx（§4.3），ref 的判据吃的是 f（事实集）。
 * 转换在 lib/facts.js，一次判定只装配一次事实。
 *
 * P3a–P3d 已把其中能用 DSL 表达的搬进 probes.md，native 收口在 20 条（硬上限 ≤20，
 * 正好用满）。删的是下面 RULE_SOURCE 背后两个 lib 文件里的条目，不是这个转接层。
 */

import { RULES as EARLY } from './lib/rules.js';
import { RULES_LATE as LATE } from './lib/rules-late.js';
import { buildFacts } from './lib/facts.js';


/**
 * 留下来的 native 判据表（环节 1-4 在 rules.js，5-8 在 rules-late.js）。
 * 拆成两个文件是 ref 的历史分法，本包不合并：合并等于改动上千行，
 * 再对拍就说不清差异是移植带来的还是合并带来的。
 */
const RULE_SOURCE = { ...EARLY, ...LATE };

/**
 * 把一条 ref 判据包成内核认的形状。
 *
 * 内核只认 {r, detail|say, how?, evidence?}；ref 返回 {r, detail}，
 * 正好对上，所以原样透出。判据抛错的兜底在内核的 judgeGate 里，
 * 这里不再套一层 try/catch——套了的话内核那句「工具自己出错了」永远不会出现，
 * 而它是唯一会把出错的门禁号说给人听的地方。
 */
function adapt(fn) {
  return function nativeRule(ctx) {
    const f = buildFacts(ctx);
    return fn(f);
  };
}

export const RULES = Object.fromEntries(
  Object.entries(RULE_SOURCE).map(([id, fn]) => [id, adapt(fn)])
);

/**
 * 工程看起来干到哪一步了（内核的 apparentStage 钩子，§5.2）。
 *
 * 逐字照搬 ref evaluate.js 的同名函数。内核不认识"部署脚本""追溯表"，
 * 这些标志物是软件工程专有的，所以必须由包来答。
 */
export function apparentStage(ctx) {
  const f = buildFacts(ctx);
  const e = f.eng;
  if (f.art.operate.issues.exists && f.art.operate.issues.count > 0) return 8;
  if (f.art.handover.url) return 7;
  if (e.hasDeployScript || e.hasCaddyOrNginx) return 7;
  // 要看表里有没有行，不是看文件在不在：空模板也"存在"，
  // 光凭它把工程判到环节 6，会让刚建好的项目第一眼就看到假倒挂警告。
  if (f.art.traceability.rowCount > 0) return 6;
  if (e.testFileCount > 0 && e.codeFileCount > 10) return 5;
  if (e.codeFileCount > 3) return 5;
  // 有 package.json 或 git 但一行代码都没有——不算工程开工了。
  if ((e.pkg || e.hasGit) && e.codeFileCount > 0) return 4;
  return 1;
}

/**
 * 倒挂时前面缺的窟窿（内核的 upstreamMissing 钩子，§5.2）。
 *
 * 每项自带 file：不许由下游拿 stage.artifacts[0] 去猜——环节二有四份产物，
 * 猜出来的永远是第一份，于是"补权限表"会指到流程说明那个文件上。
 * 指错文件比不指文件坏：人打开一看里面根本没有要他补的那一栏。
 */
export function upstreamMissing(ctx) {
  const f = buildFacts(ctx);
  const a = f.art;
  // 只有真写了东西才谈倒挂。三五个文件是脚手架，不算。
  if (f.eng.codeFileCount < 5) return [];

  const missing = [];
  if (!a.scopeCard.exists) {
    missing.push({
      what: '场景卡', stage: 1, file: 'artifacts/01-scope-card.md',
      why: '不知道这系统替代谁的哪个动作，验收的时候没有依据',
    });
  }
  if (!a.model.process.exists) {
    missing.push({
      what: '流程说明', stage: 2, file: 'artifacts/02-process.md',
      why: '不知道这件事从头到尾几步、每步谁做，代码里的分支就没有对照',
    });
  }
  if (!a.model.dictionary.exists) {
    missing.push({
      what: '数据字典', stage: 2, file: 'artifacts/02-dictionary.md',
      why: '不知道存哪些栏、什么类型，数据表结构只能靠代码反推',
    });
  }
  if (!a.spec.exists) {
    missing.push({
      what: '验收标准', stage: 3, file: 'artifacts/03-spec.md',
      why: '没有验收标准，写完了没人能说它算不算做完',
    });
  }
  return missing;
}
