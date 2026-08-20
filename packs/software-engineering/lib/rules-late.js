/**
 * 门禁判定规则（环节四到八）。
 * 与 rules.js 同一套约定，evaluate.js 会把两份合并。
 *
 * 这一半更依赖工程痕迹。注意纪律：
 * 看的是"有没有这个命令""跑起来了没有"，
 * 不是"代码写得好不好"。
 */

import { judgeHumanRecord } from './human-check.js';

const P = 'pass'; const F = 'fail'; const X = 'fix'; const ASK = 'ask'; const NA = 'na';

/** 判据与 rules.js 里的 human 是同一份（human-check.js），不再各留一份副本。 */
function human(f, id) {
  return judgeHumanRecord(f.local.humanChecks[id], f.local.humanChecks, id);
}

/** 读工具自己记的运行结果（检查动作会写进去） */
/**
 * 取"这条命令跑过没有、结果怎样"。
 *
 * 两个来源，优先 webuddy check 自己跑的那次：那是工具亲手跑的，最可信。
 * 没有的话回落到 agent hook 记下的痕迹——人在 Claude Code 里跑了 npm test，
 * 退出码是 0 还是 1 是客观事实，跟谁跑的没关系。
 *
 * 只认带退出码的记录。「跑过但不知道结果」不能算通过，
 * 那正是这条门禁存在的全部意义。
 */
function runResult(f, key) {
  const own = f.local.notes?.runs?.[key];
  if (own) return own;

  const a = f.agent;
  if (!a) return null;
  const hit = key === 'test' ? a.lastTest : key === 'start' ? a.lastStart : null;
  if (!hit) return null;
  return {
    ok: hit.exit === 0,
    date: String(hit.at).slice(0, 10),
    error: hit.exit === 0 ? '' : `退出码 ${hit.exit}`,
    note: `Claude Code 里跑的：${hit.cmd}`,
    passed: null,
    viaAgent: true,
  };
}

/**
 * 违规类门禁的判定。
 *
 * 关键在于第一行：一轮都没经过工具，就不能判「通过」。
 * 工具没看着的时候说"没有违规"，是把"我不知道"写成了"没问题"——
 * 这种不该拿的绿灯，比红灯更贵。所以退回 ask，让人自己去看。
 */
function fromRounds(f, key, ok, bad) {
  const slices = f.local.notes?.slices || [];
  const v = f.local.notes?.violations?.[key] || [];
  if (v.length) return { r: F, detail: bad(v) };
  if (slices.length === 0) {
    return { r: ASK, detail: '这一轮改动工具没在旁边看着，所以判不了，不是判你不合格。你自己把这轮改了哪些地方过一遍；下次让 AI 动手前先在这里开一轮，工具就能替你盯（命令行：webuddy round start）' };
  }
  return { r: P, detail: ok ? ok(slices) : '' };
}

/* ── 门禁 6.5 的四项子判据 ───────────────────────────────────────
 * 原来是 6.5/6.6/6.7/6.8 四道门禁，合成一道了（见 RULES_LATE['6.5']）。
 * 判据本身一项没删，只是不再各占一盏灯。每项返回 {name, r, detail}，
 * name 是报缺口时的前缀，让人知道缺的是哪一项。
 */

/** 出错情况的标准，逐个去追溯表里找有没有配测试 */
function negativeAcTested(f) {
  const name = '出错情况';
  const codes = f.art.spec.features.negativeCodes || [];
  const t = f.art.traceability;
  if (!t.exists) return { name, r: F, detail: '还没有对照表' };
  if (codes.length === 0) return { name, r: F, detail: '验收标准里就没写出错的情况，自然也测不到。先回环节三补「填错了」「没权限」这类标准' };
  const norm = (c) => String(c).replace(/AC-?/i, '').padStart(3, '0');
  const coveredSet = new Set((t.covered || []).map(norm));
  const naked = codes.filter((c) => !coveredSet.has(norm(c)));
  if (naked.length === 0) {
    return { name, r: P, detail: '', note: `${codes.length} 条出错标准都配了测试` };
  }
  return {
    name,
    r: F,
    detail: `有 ${naked.length} 条标准没配测试（${naked.slice(0, 8).join('、')}${naked.length > 8 ? ' 等' : ''}）。正常流程测了、出错的没测，等于只验了用户不会犯错的那一半`,
  };
}

/** 极端数据。有 generate-dims 缓存时用机械匹配，没有时退回静态正则 */
function extremeDataAc(f) {
  const name = '极端数据';
  const t = f.art.spec.features.acText || '';
  if (!t) return { name, r: F, detail: '还没有验收标准' };
  // 清单过期：字典或状态机改过了，旧清单里没有新字段。不许拿旧清单判绿
  if (f.art.dynDimsStale) {
    return {
      name,
      stale: true,
      r: X,
      detail: '数据字典或状态表在生成检查清单之后改过了，旧清单里没有新加的字段。重新运行 webuddy generate-dims，再看这道门禁',
    };
  }
  if (f.art.dynDims) {
    const { naked, generatedAt, rows } = f.art.dynDims;
    const date = (generatedAt || '').slice(0, 10);
    if (naked.length === 0) {
      return { name, r: P, detail: '', note: `动态判据 ${date} 生成，${rows.length} 项全覆盖` };
    }
    const items = naked.slice(0, 5).map((n) => `${n.anchor}：${n.question}`).join('；');
    const more = naked.length > 5 ? ` 等 ${naked.length} 项` : '';
    return { name, r: X, detail: `动态判据（${date} 生成）里有 ${naked.length} 项没被 AC 覆盖${more}。缺口：${items}` };
  }
  const hasBoundary = /为空|空的|超长|截断|最大|最小|极值|至少|超过|重复|上限|0 条|没有任何/.test(t);
  if (!hasBoundary) {
    return { name, r: X, detail: '没看到极端数据的标准。补几条：一条数据都没有、名字特别长、数量填 0、同一张单交两次。也可运行 webuddy generate-dims 生成针对本项目字段的检查清单' };
  }
  return { name, r: P, detail: '', note: '极端数据走的是静态检查，跑 webuddy generate-dims 可逐字段查' };
}

/** 越权：有没有一条标准写「没权限的人会被挡住」 */
function permissionAc(f) {
  const name = '越权';
  const t = f.art.spec.features.acText || '';
  if (!t) return { name, r: F, detail: '还没有验收标准' };
  const hasPermAC = /无权|越权|没有权限|不能查看|不能操作|没有.{0,6}按钮|跳转到登录|只读|不放行/.test(t);
  return hasPermAC
    ? { name, r: P, detail: '' }
    : { name, r: F, detail: '没有一条标准写「没权限的人会被挡住」。补一条，比如「班组长打开别的班组的单，则看不到」。权限是业务系统最容易出事的地方' };
}

/** 乱跳状态：单据能不能从任意状态跳到任意状态 */
function illegalStateAc(f) {
  const name = '乱跳状态';
  const s = f.art.model.states;
  if (!s.exists) return { name, r: F, detail: '还没写单据的流转规则，没有依据判什么算乱跳' };
  const t = f.art.spec.features.acText || '';
  const hasIllegal = /非法|不允许|不能从|直接跳|不可点|状态.{0,8}(不能|拒绝)|已.{1,4}(不能|请走)/.test(t);
  return hasIllegal
    ? { name, r: P, detail: '' }
    : { name, r: X, detail: '没有「单据不能乱跳状态」的标准。补一条，比如「已汇总的单，则不能再作废」' };
}

export const RULES_LATE = {
  // ───────── 环节四 工程地基 ─────────
  '4.1': (f) => {
    if (!f.eng.pkg) return { r: F, detail: '项目地基还没搭：缺 package.json，它是记录这个项目用了哪些现成组件、怎么启动的清单' };
    if (!f.eng.hasStartScript) return { r: F, detail: '没有「一步把软件跑起来」的办法。让 AI 在 package.json 里加一条启动命令（dev 或 start）' };
    const r = runResult(f, 'start');
    if (r) return r.ok ? { r: P, detail: `${r.date} 验证过` } : { r: F, detail: `启动失败：${r.error || '见日志'}` };
    return { r: X, detail: '启动的办法有了，但还没真起来看过一次。让工具试着起一次，成了这条就过（命令行：webuddy check 4.1）' };
  },
  '4.2': (f) => {
    if (!f.eng.pkg) return { r: F, detail: '项目地基还没搭：缺 package.json' };
    if (!f.eng.hasTestScript) return { r: F, detail: '没有「一步跑完全部测试」的办法。这条不过，后面整个环节六都是空的——你就没有任何办法知道软件好没好' };
    if (f.eng.testFileCount === 0) return { r: F, detail: '有跑测试的命令，但一个测试都还没写' };
    const r = runResult(f, 'test');
    if (r) return r.ok ? { r: P, detail: `${r.date} ${f.eng.testFileCount} 个测试文件` } : { r: F, detail: `测试跑不通：${r.error || '见日志'}` };
    return { r: X, detail: `有 ${f.eng.testFileCount} 个测试文件但还没跑过` };
  },
  '4.3': (f) => (f.eng.agentRuleFile
    ? { r: P, detail: `已有 ${f.eng.agentRuleFile}` }
    : { r: F, detail: '缺一份写给 AI 看的项目规矩文件（CLAUDE.md）。没有它，AI 每开一轮都不知道这个项目的边界在哪' }),
  '4.4': (f) => {
    if (!f.eng.hasGit) return { r: F, detail: '改动还没有存档。让 AI 把项目接上存档工具（git），否则改坏了退不回去——这是最基本的安全网' };
    if (f.eng.commitCount === 0) return { r: F, detail: '存档工具接上了，但一次都没存过。让 AI 存一次档（提交）' };
    return { r: P, detail: `存过 ${f.eng.commitCount} 次档，最近一次 ${f.eng.lastCommitDate}` };
  },
  '4.5': (f) => {
    if (!f.eng.pkg) return { r: F, detail: '项目地基还没搭：缺 package.json' };
    const bad = f.eng.rangeDeps;
    if (bad.length === 0) return { r: P, detail: `${f.eng.depCount} 个现成组件都锁定了版本` };
    return { r: F, detail: `${bad.length} 个现成组件没锁版本，写成了「这一系列的最新版」：${bad.slice(0, 4).join('、')}${bad.length > 4 ? ' 等' : ''}。让 AI 改成固定版本号（去掉 ^ 和 ~），否则换台电脑装到的是新版，同样的代码就跑不起来` };
  },
  '4.6': (f) => {
    const problems = [];
    if (f.eng.envCommitted) problems.push('装密码的配置文件（.env）跟着代码一起存档了，密码等于公开了');
    if (f.eng.secretHits.length > 0) {
      const s = f.eng.secretHits.slice(0, 3).map((h) => `${h.file}:${h.line}（${h.kind}）`).join('，');
      problems.push(`密码直接写在代码里了：${s}${f.eng.secretHits.length > 3 ? ` 等 ${f.eng.secretHits.length} 处` : ''}。让 AI 挪到单独的配置文件里`);
    }
    if (!f.eng.hasEnvExample && f.eng.codeFileCount > 5) problems.push('缺一份配置样例（.env.example），换个人接手不知道要填哪些东西才能跑');
    // 一行代码都还没有的时候，"配置分离做得好"是句空话。
    if (problems.length === 0 && f.eng.codeFileCount === 0) return { r: ASK, detail: '还没有代码，这条现在判不了' };
    if (problems.length === 0) return { r: P };
    return { r: F, detail: problems.join('；') };
  },
  '4.7': (f) => {
    const r = runResult(f, 'db');
    if (r) return r.ok ? { r: P, detail: `${r.date} 连接正常` } : { r: F, detail: `存数据的地方连不上：${r.error || '见日志'}` };
    if (!f.eng.hasSchema) return { r: F, detail: '还没在代码里建好数据表。数据字典里那些栏，要变成数据库里真实的表' };
    return { r: X, detail: '数据表建好了，但还没试过能不能真连上' };
  },
  '4.8': (f) => {
    const r = runResult(f, 'coldstart');
    if (r) return r.ok ? { r: P, detail: `${r.date} 在空白环境里装起来了` } : { r: F, detail: `在空白环境里装不起来：${r.error || '见日志'}` };
    if (f.eng.hasDockerCompose) return { r: X, detail: '一键装环境的配置有了，但还没在一台空白电脑上真试过。这是及格线第二条的预演' };
    return { r: F, detail: '没有一键装环境的配置（docker-compose）。现在只在你自己电脑上能跑，换个人就装不起来' };
  },
  '4.9': (f) => {
    if (!f.eng.pkg) return { r: NA, detail: '还没有组件清单，无从对照' };
    const OFF_STACK = ['react-redux', 'redux', 'mongoose', 'mongodb', '@apollo/server', 'graphql', 'kubernetes-client', 'styled-components', 'emotion'];
    const found = Object.keys(f.eng.deps).filter((d) => OFF_STACK.some((o) => d === o || d.startsWith(`${o}/`)));
    return found.length === 0
      ? { r: P }
      : { r: X, detail: `AI 用了约定方案之外的组件：${found.join('、')}。不一定错，但得你点头一次——问它一句为什么非要换，理由说不通就让它换回来` };
  },
  /**
   * 4.10 文件摆放跟模板一致。
   *
   * 以前这条只数文件总数（fileCount > 0 就算过），
   * 一个只放了 readme.txt 的目录也判通过——除了空目录恒为真，等于没判。
   * 现在按"约定目录在不在"判：这是不读代码就能查的结构事实。
   * 缺目录只报待改不报不通过：目录结构是约定，不是及格线，
   * 说清缺哪个让人补，比一刀切判死更有用。
   */
  '4.10': (f) => {
    if (f.eng.fileCount === 0) return { r: F, detail: '项目文件夹是空的，一个文件都还没有' };
    const miss = [];
    if (!f.eng.hasSrcDir) miss.push('src/（放代码）');
    if (!f.eng.hasTestDir) miss.push('tests/（放测试）');
    if (!f.eng.pkg) miss.push('package.json（记依赖和命令）');
    if (miss.length === 0) return { r: P, detail: `目录结构齐了，共 ${f.eng.fileCount} 个文件` };
    return {
      r: X,
      detail: `文件摆得跟约定不一样，缺：${miss.join('、')}。摆放一致的意义是换个人接手能猜到东西在哪，也让 AI 少问你"放哪里"`,
    };
  },

  // ───────── 环节五 分步实现（逐切片，这里判整体状况） ─────────
  '5.1': (f) => {
    const slices = f.local.notes?.slices || [];
    if (slices.length === 0) return { r: ASK, detail: '还没开始一小步一小步地做，或者做了但没记下来，所以这条现在判不了。往后每开始一小步，先说清这一步做哪条验收标准' };
    const noAC = slices.filter((s) => !s.ac).length;
    return noAC === 0 ? { r: P, detail: `${slices.length} 小步都说清了做哪条验收标准` } : { r: F, detail: `${noAC} 小步没说清做的是哪条验收标准。出问题的时候不知道该照哪条对` };
  },
  '5.2': (f) => {
    const slices = f.local.notes?.slices || [];
    if (slices.length === 0) return { r: ASK, detail: '还没有一轮记录，所以这条判不了。做法是：让 AI 动手前先说它打算怎么改，你看过一遍再放它动手，那段话就是这一轮的计划（命令行：webuddy round start --plan "..."）' };
    const noPlan = slices.filter((s) => !s.plan).length;
    return noPlan === 0
      ? { r: P, detail: `${slices.length} 轮都是先说计划再动手` }
      : { r: X, detail: `${noPlan} 轮是直接开始改的。让 AI 先说它打算改哪里，你看一眼再放它动手——这一眼是你唯一能拦住它的地方` };
  },
  '5.3': (f) => fromRounds(f, 'outOfDeclaredScope', null,
    (v) => `AI 动了这一轮没说要动的文件：${v.slice(0, 5).join('、')}${v.length > 5 ? ' 等' : ''}`),
  '5.4': (f) => fromRounds(f, 'newDeps', null,
    (v) => `AI 自己装了没说过的现成组件：${v.join('、')}。这是你自己发现不了的事，所以工具必须拦一次`),
  '5.5': (f) => fromRounds(f, 'schemaChanged', null,
    (v) => `数据表结构被改了：${v.join('、')}。要改就回环节二先改数据字典——不是不让改，是别绕过文档偷偷改`),
  '5.6': (f) => fromRounds(f, 'testsTampered', null,
    (v) => `原来的测试被改动了：${v.join('、')}。改测试让它变绿是最省力的作弊，也是最贵的——你的仪表盘就是它`),
  '5.7': (f) => {
    // 「只做一件事」的判据：一轮只声明一条验收标准。
    // 不去数改了几个功能——那要读代码。声明了两条以上，就是自己承认了做了多件事。
    const slices = f.local.notes?.slices || [];
    if (slices.length === 0) return { r: ASK, detail: '还没有一轮记录，这条现在判不了' };
    const multi = slices.filter((s) => (s.ac || '').split(/[,，、\s]+/).filter(Boolean).length > 1);
    return multi.length === 0
      ? { r: P, detail: '每轮只做一条验收标准' }
      : { r: X, detail: `${multi.length} 轮一次做了好几条标准（${multi[0].ac}）。出问题的时候你分不清是哪一条弄坏的` };
  },
  '5.8': (f) => {
    const v = f.local.notes?.violations?.driveByRefactor || [];
    // 这条判待改不判不通过：顺手重构是风险，但不像改测试那样是作弊
    if (v.length) return { r: X, detail: `AI 顺手改了 ${v.length} 个跟这轮无关的文件：${v.slice(0, 5).join('、')}。它说的"顺便优化一下"是风险不是好事——那些地方没有测试盯着` };
    return fromRounds(f, 'driveByRefactor', null, null);
  },
  '5.9': (f) => {
    const r = runResult(f, 'start');
    if (!r) return { r: X, detail: '还没试过软件现在能不能跑起来' };
    return r.ok ? { r: P } : { r: F, detail: `软件跑不起来了：${r.error || '见日志'}` };
  },
  '5.10': (f) => human(f, '5.10'),
  '5.11': (f) => {
    if (f.eng.commitCount === 0) return { r: F, detail: '一次档都还没存过' };
    const ratio = f.eng.commitsWithAC / f.eng.commitCount;
    if (ratio >= 0.7) return { r: P, detail: `${f.eng.commitsWithAC}/${f.eng.commitCount} 次存档写了验收标准编号` };
    if (f.eng.commitsWithAC === 0) return { r: F, detail: '每次存档都没写对应哪条验收标准。以后想查"这处为什么改的"就查不出来了' };
    return { r: X, detail: `只有 ${f.eng.commitsWithAC}/${f.eng.commitCount} 次存档写了编号` };
  },
  '5.12': (f) => {
    const r = runResult(f, 'test');
    if (!r) return { r: X, detail: '这一轮改完后还没跑过测试' };
    return r.ok ? { r: P } : { r: F, detail: `有测试没通过：${r.error || '见日志'}` };
  },

  // ───────── 环节六 验证与质量门禁 ─────────
  '6.1': (f) => {
    const t = f.art.traceability;
    const acCount = f.art.spec.features.acCount;
    if (acCount === 0) return { r: F, detail: '还没有验收标准，无从对照' };
    if (!t.exists) return { r: F, detail: '还没有对照表。列一张表：每条验收标准一行，写清它由哪个测试负责验（文件在 artifacts/06-traceability.md）' };
    if (t.uncovered.length > 0) {
      return { r: F, detail: `${t.uncovered.length} 条标准还没人管：${t.uncovered.slice(0, 8).join('、')}${t.uncovered.length > 8 ? ' 等' : ''}。让 AI 给每条补一个测试` };
    }
    /**
     * 到这里对照表说"每条标准都有测试管"。这句话以前就直接算过了——
     * 于是把整个 tests/ 删干净，这条照样报「26 条标准都配了测试」。
     * 文档自己证明自己，是这个工具最贵的一种失灵：它唯一的产品就是读数。
     *
     * 所以再去磁盘上核一遍表里点名的文件在不在。只比文件名，不看文件内容——
     * 规则二禁的是「靠读代码判断」，数文件在不在不需要读懂任何一行，
     * 人自己去 tests/ 底下看一眼就能复核，有异议能指着目录反驳工具。
     */
    const declared = t.declaredTests || [];
    if (!declared.length) {
      return { r: ASK, detail: `${acCount} 条标准在表里都填了测试，但「测试文件」那栏没写具体文件名（写的是「见单元测试」这类），没法核对到底有没有这些测试。把那一栏改成真实文件路径，比如 tests/order.test.js` };
    }
    // 手工验收清单也算，见 probe-engineering 里 manualTestFiles 的说明：
    // 「焦点外框看得见吗」这类标准只能人验，一份 md 清单就是它的测试。
    const onDisk = new Set([...(f.eng.testFiles || []), ...(f.eng.manualTestFiles || [])]);
    const tail = (p) => p.replace(/^\.?\//, '').split('/').pop();
    const diskTails = new Set([...onDisk].map(tail));
    const missing = [...new Set(declared
      .filter((d) => !onDisk.has(d.file.replace(/^\.?\//, '')) && !diskTails.has(tail(d.file)))
      .map((d) => d.file))];
    if (missing.length) {
      /**
       * 说「这个文件不存在」的时候，必须把自己是怎么找的一起交出来。
       *
       * 踩过的坑：这条曾经把一份真实存在的 test/browser-acceptance.md 报成不存在，
       * 因为收集测试文件时只认代码后缀，.md 不在名单里。屏幕上于是出现两种说法——
       * 工具说「实际没有这个文件」，agent 说「我这轮已经读过它」。
       * 人手上没有第三个依据，只能在两个说法之间猜谁对，而工具的语气更硬。
       *
       * 所以报缺失时连「我扫到的测试文件是这些」一起打出来。人扫一眼就能判：
       * 名单里没有但目录里明明有 → 是工具的筛选规则漏了，该信 agent；
       * 名单和目录一致 → 真没有这个文件，该信工具。
       * 这样判断依据在页面上，不在谁的语气里。
       */
      const seen = [...onDisk];
      const sawWhat = seen.length
        ? `我在项目里扫到的测试文件是：${seen.slice(0, 8).join('、')}${seen.length > 8 ? ` 等 ${seen.length} 个` : ''}`
        : '我在项目里没扫到任何测试文件';
      return {
        r: F,
        detail: `对照表点名了 ${new Set(declared.map((d) => d.file)).size} 个测试文件，其中 ${missing.length} 个我找不到：${missing.slice(0, 5).join('、')}${missing.length > 5 ? ' 等' : ''}。${sawWhat}。如果这个文件其实就在那儿，那是我漏了（可以让 AI 直接说「文件存在，是工具漏了」），别按我说的改；如果确实没有，要么补上测试，要么把表改成实话`,
      };
    }
    return { r: P, detail: `${acCount} 条标准都配了测试，点名的 ${new Set(declared.map((d) => d.file)).size} 个测试文件在项目里都找得到` };
  },
  '6.2': (f) => {
    const r = runResult(f, 'test');
    if (!r) return { r: F, detail: '一次测试都还没跑过。测试是你唯一能看出软件好没好的通道，不跑就等于闭着眼上线' };
    if (!r.ok) return { r: F, detail: `有测试没通过：${r.error || '见日志'}。带着没过的测试上线，等于知道有毛病还往前走` };
    // 一次跑绿的结果会一直留在记录里。测试后来被删光了，这条还照样念那句"全绿"——
    // 报的是一个已经不成立的旧结论。所以过一道最起码的核对：现在磁盘上还有测试文件吗。
    // 只数文件个数，不看内容。
    if ((f.eng.testFileCount || 0) === 0) {
      return { r: ASK, detail: `记录里 ${r.date} 那次是全绿的，但现在项目里一个测试文件都没有了。这句"全绿"说的是当时，不是现在。补回测试再跑一次（命令行：webuddy check test）` };
    }
    return { r: P, detail: `${r.date} 全绿${r.passed ? `（${r.passed} 条）` : ''}，现在项目里有 ${f.eng.testFileCount} 个测试文件` };
  },
  '6.3': (f) => {
    const t = f.art.traceability;
    if (!t.exists) return { r: F, detail: '还没有对照表' };
    // 「0 行完整」是真的，也是没用的。空表通过意味着一条标准都没被验证过。
    if (!t.rowCount) return { r: F, detail: '对照表还是空的。每条验收标准都要写清由哪个测试负责验' };
    const bad = [];
    if (t.blankRows > 0) bad.push(`${t.blankRows} 行有空格`);
    if (t.badLevels.length > 0) bad.push(`「层级」这栏只能填 单元 / 集成 / 端到端（分别是：只测一小块、测几块连起来、当成真人从头点一遍），现在填的是：${[...new Set(t.badLevels)].join('、')}`);
    return bad.length === 0 ? { r: P, detail: `${t.rowCount} 行完整` } : { r: F, detail: bad.join('；') };
  },
  '6.4': (f) => human(f, '6.4'),
  /**
   * 6.5 测过出错和极端的情况。
   *
   * 这一条原来是四条：6.5 异常、6.6 极端数据、6.7 越权、6.8 乱跳状态。
   * 2026-08-14 合成一条。合并的理由不是判据变松了——四项判据一项没删，
   * 全在下面逐项跑——而是四盏灯对非技术人员是同一件事：「不顺利的情况也要测」。
   * 拆成四条时他看到的是四个分不清差别的红灯，不知道先修哪个。
   *
   * 判定：四项逐个查，缺口合起来报。取最严的那档当结论——
   * 有 fail 就 fail，否则有 fix 就 fix，全过才 pass。
   * 缺口逐条列出来，所以合并没有让人损失「到底缺哪一项」这个信息。
   */
  '6.5': (f) => {
    const subs = [negativeAcTested(f), extremeDataAc(f), permissionAc(f), illegalStateAc(f)];

    // 判不了的（清单过期之类）优先说出来：拿判不了当通过是这套工具最不该犯的错
    const stale = subs.find((s) => s.stale);
    if (stale) return { r: X, detail: stale.detail };

    const bad = subs.filter((s) => s.r !== P);
    if (bad.length === 0) {
      return { r: P, detail: `出错、极端、越权、乱跳状态四项都有标准且配了测试${subs[0].note ? '（' + subs[0].note + '）' : ''}` };
    }
    const worst = bad.some((s) => s.r === F) ? F : X;
    const lines = bad.map((s) => `${s.name}：${s.detail}`);
    const okCount = subs.length - bad.length;
    return {
      r: worst,
      detail: `${okCount > 0 ? `四项里过了 ${okCount} 项，还缺 ${bad.length} 项。` : '四项都还没覆盖。'}${lines.join('；')}`,
    };
  },
  /**
   * 6.9 本轮无测试文件被实现动作修改。
   *
   * 5.6 和 6.9 的差别在于时间范围：
   *   5.6 是全程累计——只要发生过就一直是红的，不能用"现在没事"来洗。
   *   6.9 是本轮——「本轮」的意思是"最近一次 round end 之后到现在"。
   *       之所以不是"全程"：5.6 已经拦住了，6.9 再重复一遍就是同一个红灯亮两次。
   *       重复的红灯会让人开始忽略所有红灯——这是比漏掉一条更贵的损失。
   *
   * 实现：violations.testsTampered 记的是历史累计，
   * violationsAt.testsTampered 记的是这批违规最近一次出现的时间。
   * 最近一条 slice 的 endedAt 是当前轮次收工时间。
   * 违规时间早于最后一条 slice，则本轮是干净的（历史上那次已由 5.6 处理）。
   * 两个时间戳缺任何一个都判不了本轮，走 ask——判不了要说判不了。
   */
  '6.9': (f) => {
    const slices = f.local.notes?.slices || [];
    if (slices.length === 0) {
      return { r: ASK, detail: '这一轮改动工具没在旁边看着，所以判不了。下次让 AI 动手前先在这里开一轮（命令行：webuddy round start）' };
    }
    const v = f.local.notes?.violations?.testsTampered || [];
    // 没有违规记录，就没有"本轮"要分辨的东西，时间戳缺不缺都不影响结论。
    if (!v.length) return { r: P, detail: '本轮没有测试文件被改小或删掉' };
    const lastSliceAt = slices[slices.length - 1].endedAt;
    const violatedAt = f.local.notes?.violationsAt?.testsTampered;
    /**
     * 少一个时间戳就判不了"是不是本轮"，这时候要说判不了，不能说没事。
     *
     * 原来这里直接 `violatedAt > lastSliceAt`。JS 里任何字符串跟 undefined 比大小
     * 恒为 false，于是老轮次记录（slice 里没写 endedAt）一旦有测试被改动，
     * 这条就直落绿灯——同一时刻 5.6 判红、告警报"测试被改动"，6.9 却说本轮干净。
     * 一块仪表盘上两个针指反方向，人会挑他愿意信的那个看。
     */
    if (!lastSliceAt || !violatedAt) {
      return { r: ASK, detail: `有测试文件被改小或删掉了（${v.join('、')}），但这次改动没留下时间，分不出是这一轮干的还是以前的。自己看一眼这几个文件现在对不对，然后确认` };
    }
    // 有违规记录，且违规时间在最后一条 slice 完成之后 → 就是本轮干的
    if (violatedAt > lastSliceAt) {
      return { r: F, detail: `这一轮又有测试被改动了：${v.join('、')}。改测试让它变绿是最省力的作弊，也是最贵的——你的仪表盘就是它` };
    }
    return { r: P, detail: '本轮没有测试文件被改小或删掉' };
  },
  '6.10': (f) => {
    // 这八条的名字要用后果说，不用手段说。「SQL 参数化」他不知道是什么，
    // 「防数据库被套话」他知道那是坏事，也知道该去问 AI 有没有做。
    const NAMES = {
      auth: '改数据前必须先登录', filter: '每人只看得到自己该看的数据', sqlParam: '防数据库被套话',
      escape: '防页面被塞进恶意脚本', hashPwd: '密码存成不可还原的乱码', upload: '上传限类型和大小',
      session: '久不操作自动退出', errorMsg: '报错不把内部细节抖出去',
    };
    const items = f.local.notes?.security;
    // 没有记录时走人工确认，不是直接判红。
    // 这八条得看代码才知道做没做，而规则二不许判据依赖读代码——所以工具本来就判不了它。
    // 原来这里没记录就判 F，而全仓库没有任何命令会写 notes.security：
    // 门禁永远过不去，人做完八条也还是红的。那是一条永久的假警报，
    // 一条假警报够让人开始忽略后面所有的警报。
    if (!items) {
      const h = human(f, '6.10');
      if (h.r !== ASK) return h;
      return { r: ASK, detail: `把这八条逐条发给 AI，问它做没做、做在哪，看过回答再确认：${Object.values(NAMES).join('、')}` };
    }
    const missing = Object.keys(NAMES).filter((k) => items[k] !== true);
    if (missing.length === 0) return { r: P, detail: '八条底线全过' };
    return { r: F, detail: `安全底线还差 ${missing.length} 条：${missing.map((k) => NAMES[k]).join('、')}。把这几条原话发给 AI，让它逐条改并说明改在哪` };
  },
  '6.11': (f) => {
    const problems = [];
    if (f.eng.secretHits.length > 0) problems.push(`${f.eng.secretHits.length} 处密码直接写在代码里`);
    const backdoor = f.local.notes?.violations?.backdoor || [];
    if (backdoor.length > 0) problems.push(`留了不用密码就能进的口子：${backdoor.join('、')}`);
    if (problems.length === 0 && f.eng.codeFileCount === 0) return { r: ASK, detail: '还没有代码，这条现在判不了' };
    return problems.length === 0 ? { r: P } : { r: F, detail: problems.join('；') };
  },

  // ───────── 环节七 上线与上架 ─────────
  '7.1': (f) => {
    const r = runResult(f, 'liveUrl');
    const url = f.art.handover.url;
    if (!url) return { r: F, detail: '交接单里还没写用户该打开哪个网址' };
    if (r) return r.ok ? { r: P, detail: `${url} 能打开（${r.date}）` } : { r: F, detail: `${url} 打不开：${r.error || ''}` };
    return { r: X, detail: `网址写了（${url}），但还没真打开看过一次` };
  },
  '7.2': (f) => {
    if (!f.eng.hasDeployScript) return { r: F, detail: '没有「一步把新版本发上去」的办法。现在发版要一步步手工操作，换个人就发不上去' };
    const r = runResult(f, 'deploy');
    return r?.ok ? { r: P, detail: `${r.date} 发版成功` } : { r: X, detail: '发版的办法有了，但还没成功跑过一次' };
  },
  '7.3': (f) => {
    if (!f.eng.hasRollbackScript) return { r: F, detail: '没有「退回上一版」的办法。新版本发坏了就只能带着毛病硬撑' };
    const r = runResult(f, 'rollback');
    return r?.ok ? { r: P, detail: `${r.date} 退回上一版试过了` } : { r: F, detail: '退回上一版的办法写了，但没真试过。没试过的等于没有' };
  },
  /**
   * 7.4 是及格线第二条本身：换个人照文档也能装起来。
   *
   * 这条以前只看交接单里有没有"换人"两个字加一个日期，
   * 结果手打八个字就能让整条及格线变绿——这正是工具最该拦的那种作假。
   * 现在改成：交接单的痕迹只是入场券，还得有第二个人的名字，
   * 而且必须由人明确确认过一次（人确认会记名字和日期，可复核）。
   * 判据依旧不读代码：看的是"有没有另一个人的署名"，不是"部署脚本写得好不好"。
   */
  '7.4': (f) => {
    const h = f.art.handover;
    if (!h.exists) return { r: F, detail: '还没有交接单，这条无从谈起（文件在 artifacts/07-handover.md）' };
    if (!f.eng.hasDeployScript) {
      return { r: F, detail: '没有"一条命令把它装起来"的办法。换人部署这件事的前提是有个能照着敲的命令，不然文档写得再细也是口述' };
    }
    if (!h.otherPersonDeployed) {
      return { r: F, detail: '交接单的"部署方式"里还没有别人照文档装成功的记录。要写清：谁装的（名字）、哪天装的、装的过程中哪一步文档没说清楚' };
    }
    if (!h.otherPersonNamed) {
      return { r: F, detail: '记录里没有第二个人的名字，只写了"换人复核"这类字眼。及格线要的是"另一个具体的人做成了这件事"，名字得落到纸面上，将来才有人可问' };
    }
    // 走到这里痕迹齐了，但"照文档装起来"这件事本身只有在场的人知道，
    // 所以最后一步交给人确认，不让工具替人点头。
    return human(f, '7.4');
  },
  '7.5': (f) => {
    if (!f.eng.hasBackupScript) return { r: F, detail: '还没有自动备份数据的办法' };
    const r = runResult(f, 'backup');
    return r?.ok ? { r: P, detail: `${r.date} 备份在正常跑` } : { r: F, detail: '备份的办法有了，但没确认它真在按时跑。没跑的备份等于没备份' };
  },
  /**
   * 7.6 是及格线第三条本身：数据能恢复。
   *
   * 这条以前只看交接单里有没有"演练"两个字加一个日期。
   * 手打「演练 恢复成功 2026-08-02」就能让第三条及格线变绿，
   * 而那个目录里可能连备份脚本都没有——这是整个工具最严重的一个洞。
   *
   * 现在要三样东西同时成立：
   *   1. 有 restore 命令（不然"恢复"只是个说法）
   *   2. 这条命令真的跑通过一次（webuddy check restore，或 agent 痕迹里的退出码）
   *   3. 交接单里写下了演练记录，人确认过
   * 备份跑通不算恢复跑通：备份文件可能是空的、格式可能是错的，
   * 只有真读回来过才知道。这一条上不留任何纸面通道。
   */
  '7.6': (f) => {
    if (!f.eng.hasBackupScript) return { r: F, detail: '还没有备份数据的办法，恢复无从谈起' };
    const d = f.art.handover.restoreDrill;
    if (!d.exists) {
      return { r: F, detail: '交接单的"备份与恢复"栏还没有演练记录。这是及格线第三条，不接受纸面通过。要写四件事：哪天演练的、删了什么、多久恢复回来的、恢复后抽查了哪几条数据（写出具体那条单据的内容）' };
    }
    // 07-门禁清单.md:231 的加固要求：条数对得上不代表内容对得上，
    // 要抽几条比对字段值，对不上直接不通过。
    // 所以这里逐项查四个要素，缺哪样说哪样——不合并成一句"记录不完整"。
    const miss = [];
    if (!d.hasDate) miss.push('哪天演练的');
    if (!d.hasElapsed) miss.push('从发现到恢复可用花了多久');
    if (!d.hasSample) miss.push('恢复后抽查了哪几条数据（要写出具体单据，比如"7-28 的领料单 6 条明细"，不能只写"数据都在"）');
    if (miss.length) {
      return { r: X, detail: `演练记录还缺：${miss.join('；')}。缺了这些，将来出事的人照着这段字恢复不出来` };
    }
    if (d.countOnly) {
      return { r: F, detail: '演练记录只对了条数，没比对内容。条数对得上不代表内容对得上——恢复出来的可能是空字段或乱码。抽两三条把字段值也核一遍，对不上直接算没过' };
    }
    // 记录齐了，但"恢复出来的东西真的对"只有在场的人能确认，工具不替人点头。
    return human(f, '7.6');
  },
  /**
   * 7.7 监控告警配置且通道验证。
   *
   * 以前：没有 alert runResult 就直接判 F，而 webuddy 没有任何命令写这个 runResult——
   * 于是这条永远是红的，配了告警也还是红的。永久假警报，比没警报更贵。
   *
   * 告警通道是不是真能发出去，工具没法替人试：它不知道那个手机号收没收到短信。
   * 所以改成：有 runResult 且 ok → 自动通过（工具真跑过 webuddy check alert）；
   * 没有 → 交给人确认，人确认了留名字和日期，可复核。
   * 这和 7.8、7.17 的处理逻辑一致。
   */
  '7.7': (f) => {
    const r = runResult(f, 'alert');
    if (r?.ok) return { r: P, detail: `${r.date} 出事通知能收到，试过了` };
    if (r && !r.ok) return { r: F, detail: `告警测试发送失败：${r.error || '见日志'}。出事没人知道，跟没有告警一样` };
    const h = human(f, '7.7');
    if (h.r !== ASK) return h;
    return { r: ASK, detail: '配一个出事通知（短信、邮件或企微），配完发一条测试通知确认真能收到，然后在这里确认。出事没人知道跟没有监控一样' };
  },
  '7.8': (f) => {
    const manual = f.local.notes?.manualPath;
    // 手册在哪、里面有没有命令行，工具都无从知道：它不在 artifacts 里，是用户自己放的文件。
    // 原来没记录就判 F，而全仓库没有任何命令会写 notes.manualPath——写完手册也还是红的。
    // 所以没记录时交给人确认，别拿一条过不去的红灯冒充"还没做"。
    if (!manual) {
      const h = human(f, '7.8');
      if (h.r !== ASK) return h;
      return { r: ASK, detail: '写份使用手册给用户，然后自己翻一遍：里面不该出现要敲的命令或代码，全写成「点哪里、填什么」。翻过了再确认' };
    }
    const hasTech = f.local.notes?.manualHasTechTerms;
    return hasTech ? { r: F, detail: '手册里出现了要敲的命令或代码。看手册的人不会敲命令，得全改成「点哪里、填什么」' } : { r: P };
  },
  '7.9': (f) => human(f, '7.9'),
  '7.10': (f) => {
    const h = f.art.handover;
    if (!h.exists) return { r: F, detail: '还没有交接单。写清四件事：网址怎么访问、新版本怎么发上去、数据怎么备份和恢复、出事找谁（文件在 artifacts/07-handover.md）' };
    if (!h.allFilled) {
      const miss = Object.entries(h.blocks).filter(([, v]) => !v || !v.trim()).map(([k]) => ({ access: '用户从哪打开', deploy: '新版本怎么发上去', backup: '数据怎么备份和恢复', contact: '出事找谁' }[k] || k));
      return { r: F, detail: `交接单这几栏还空着：${miss.join('、')}。这几栏是给接手的人看的，你自己知道不算` };
    }
    return human(f, '7.10');
  },
  '7.11': (f) => (f.art.handover.trainingRecorded ? { r: P } : human(f, '7.11')),
  /**
   * 7.12 正式系统里没有测试数据。
   *
   * 以前只要交接单里写了个网址就直接判通过——
   * "写了个网址"和"库里没有张三李四测试单"之间没有任何关系，
   * 这条从来不会 fail，等于摆设。
   *
   * 工具没法连进客户的库去查数据，所以这条不该假装能自动判。
   * 改成：没痕迹时交给人确认——人确认会留名字和日期，可复核。
   * 这比"有网址就算过"诚实，也符合规则二：判据是人看一眼库，不是读代码。
   *
   * 那个"有越界痕迹就判红"的分支已经删掉了。它读 notes.violations.testDataInProd，
   * 而全仓库没有任何地方写这个键——跟 7.8 原来读 notes.manualPath 是同一个病：
   * 一段永远不执行的判定，看着像有自动检查在兜底，其实一行都没跑。
   * 留着它比没有更坏：写规则的人会以为这条已经有客观判据，不再去补真正的检查。
   * 库里有没有测试数据，只有人打开系统看得出来，所以这条只有人工确认一条路。
   */
  '7.12': (f) => {
    // 还没上线的时候，"生产环境是干净的"没有意义——因为还没有生产环境。
    if (!f.art.handover.url) return { r: NA, detail: '还没上线，没有正式环境可查' };
    const h = human(f, '7.12');
    if (h.r !== ASK) return h;
    return { r: ASK, detail: '打开正式系统翻一遍数据，把测试时乱填的单子（张三、测试一下、aaa 这种）删干净，然后在这里确认。用户第一次打开看到假数据，会以为整个系统的数都不能信' };
  },
  '7.13': (f) => {
    const url = f.art.handover.url;
    if (!url) return { r: F, detail: '还没有访问网址' };
    return f.art.handover.isHttps
      ? { r: P }
      : { r: F, detail: '网址是 http 开头，浏览器会显示「不安全」。数据在网上是裸着传的，用户的密码也一样。要换成 https（免费证书够用）' };
  },
  '7.14': (f) => {
    const exposure = f.local.answers?.['pre-deploy-compliance']?.exposure;
    if (!exposure) return { r: ASK, detail: '要先知道一件事才能判：这系统给谁访问？只有单位内部员工，还是外面的人也能打开？只在内网用的话，这条大概率不适用' };
    // "只有内部员工，外部完全打不开" 这种答法里也有"外部"两个字，
    // 所以先看有没有明确的否定说法，再看有没有对外的说法。
    const deniesExternal = /外部.{0,6}(打不开|不能|无法|访问不了|进不来)|不对(公网|外网|外部)|仅(内网|内部)|只(有|在|限).{0,6}(内网|内部|员工)/.test(exposure);
    const claimsExternal = /(公众|外部客户|对外开放|公网可访问|互联网)/.test(exposure) && !deniesExternal;
    if (deniesExternal && !claimsExternal) return { r: NA, detail: '只在单位内部网络用、外面打不开，所以不用办网站备案' };
    return human(f, '7.14');
  },
  '7.15': (f) => {
    const a = f.local.answers?.['pre-deploy-compliance']?.dataResidency;
    if (!a) return { r: ASK, detail: '要先知道一件事才能判：数据存在国内还是国外？也就是租的服务器在哪个国家。这条内网项目也要答' };
    // 这一条内网项目也要过。只要答案里明确了位置，就算说清了。
    if (/境外|海外|国外|AWS|aws|GCP|Azure|新加坡|香港|美国/.test(a)) {
      return human(f, '7.15');
    }
    if (/境内|国内|自建|自己机房|本地|内网/.test(a)) return { r: P, detail: `数据存在国内：${a}` };
    return human(f, '7.15');
  },
  '7.16': (f) => {
    const a = f.local.answers?.['pre-deploy-people']?.oldProcessClose;
    if (!a) return { r: F, detail: '旧办法的关闭日期还没定。纸单还在收、Excel 还在传，新系统一定没人用' };
    // 要的是一个具体日期，"尽快""上线后"都不算
    const hasDate = /\d{4}[-/年]\s*\d{1,2}|\d{1,2}\s*月\s*\d{1,2}/.test(a);
    return hasDate ? { r: P, detail: `关闭时间：${a}` } : { r: X, detail: `"${a}" 不是一个具体日期。要写成 2026-09-01 这样` };
  },
  '7.17': (f) => {
    const u = f.local.notes?.usage;
    // "有几个人真的用过"只有人去数得出来，工具看不见生产库。
    // 原来没记录就一直挂 ASK，而 ASK 会让环节七停在 waiting——
    // 当前环节就永远卡在七，环节八根本轮不到。没有任何命令会写 notes.usage，
    // 也就没有任何办法把它清掉。所以给一条人工确认的出口。
    if (!u) {
      const h = human(f, '7.17');
      if (h.r !== ASK) return h;
      return { r: ASK, detail: '上线一周后去数一下：除你之外还有几个人真的用过、录了多少条数据。数完再确认。只有你自己用过就不算上线成功' };
    }
    if (u.distinctUsers >= 2) return { r: P, detail: `${u.distinctUsers} 个人用过，共 ${u.records || '?'} 条记录` };
    return { r: F, detail: '只有你自己登录过。按六步排查：他知道吗 / 会用吗 / 旧办法还能用吗 / 比原来麻烦吗 / 敢用吗 / 才是场景选错' };
  },

  // ───────── 环节七「演示就绪」批（7.18-7.21）─────────
  // 判据纪律同前：看的是"有没有这个文件/这个地址打开过没有"，不评价演示做得好不好。
  '7.18': (f) => {
    const h = human(f, '7.18');
    if (h.r !== ASK) return h;
    return { r: ASK, detail: '写一小段演示脚本（文件在 artifacts/07-demo-script.md，模板用 webuddy new 演示脚本 生成）：打开哪个页面、点哪几下、每步说什么，3 分钟内走完。写好后在这里确认' };
  },
  '7.19': (f) => {
    if (f.eng.hasSeedScript) return { r: P, detail: '演示数据有准备办法（单独一份数据文件或一键生成）' };
    return { r: F, detail: '演示数据还没准备好。让 AI 做一份演示数据：单独存一个文件，或者一个一键生成的小脚本，演示前跑一下就能用' };
  },
  '7.20': (f) => {
    const h = human(f, '7.20');
    if (h.r !== ASK) return h;
    return { r: ASK, detail: '把演示数据翻一遍：真实姓名、手机号、密码、客户的真单子都不能出现，换成编的。确认干净后在这里留痕' };
  },
  '7.21': (f) => {
    const r = runResult(f, 'demoUrl');
    if (r?.ok) return { r: P, detail: `${r.date} 演示地址打开看过（${r.note || '返回正常'}）` };
    if (r && !r.ok) return { r: F, detail: `演示地址打不开：${r.error || '见日志'}` };
    return { r: X, detail: '演示地址还没真打开看过。用给别人看时的那个地址打开一次，跑 webuddy check demoUrl --url <地址>，工具会替你留痕' };
  },

  // ───────── 环节八 运行与迭代 ─────────
  '8.1': (f) => {
    const i = f.art.operate.issues;
    if (!i.exists) return { r: F, detail: '还没有问题本子。用户反馈的每个问题记一行：谁提的、什么问题、多急、处理完没有（文件在 artifacts/08-issues.md）' };
    return i.count > 0 ? { r: P, detail: `记了 ${i.count} 条` } : { r: X, detail: '本子建了但一条都没记。上线后一个问题都没有，通常不是做得好，是没人在用' };
  },
  '8.2': (f) => {
    const i = f.art.operate.issues;
    if (!i.exists) return { r: F, detail: '还没有问题本子' };
    // 零条问题时"都分级了"成立但无意义。8.1 已经在管台账有没有在用，
    // 这里判不适用，别拿空表换绿灯。
    if (!i.count) return { r: NA, detail: '本子还没记东西' };
    return i.ungraded === 0 ? { r: P } : { r: F, detail: `${i.ungraded} 条问题没标多急。四档：紧急当天办 / 重要三天内 / 一般下个版本 / 属于新需求的进下一轮场景卡` };
  },
  '8.3': (f) => {
    const c = f.art.operate.changes;
    if (!c.exists) return { r: F, detail: '还没有变更记录。上线后每改一次记一行：哪天改的、改了什么、对应哪条验收标准（文件在 artifacts/08-changes.md）' };
    if (c.count === 0) return { r: NA, detail: '还没改过东西' };
    return c.unlinked === 0 ? { r: P, detail: `${c.count} 次改动都写清了对应哪条验收标准` } : { r: F, detail: `${c.unlinked} 次改动没写对应哪条验收标准。以后想查这处为什么改，查不出来` };
  },
  /**
   * 8.4 需求没有走 bug 流程被顺手改掉。
   *
   * 判据依赖台账里那一列能区分「需求」和「缺陷」。
   * 这一列不存在时，以前会算出 requestsInBugFlow=0 然后判绿——
   * 那是把"我没法查"说成了"查过没问题"，正是这套门禁最该避免的一种绿灯。
   */
  '8.4': (f) => {
    const iss = f.art.operate.issues;
    if (!iss.exists || !iss.count) {
      return { r: NA, detail: '本子还没记东西，还没真进运行阶段' };
    }
    if (iss.noKindCol) {
      return { r: ASK, detail: '台账里没有能分出「这是故障」还是「这是新想法」的那一栏，所以这条判不了。在台账加一列「类型」，填缺陷 / 使用问题 / 需求' };
    }
    const n = iss.requestsInBugFlow;
    return n === 0
      ? { r: P }
      : { r: F, detail: `${n} 条其实是「想加个新功能」，被当成故障顺手改掉了。这是系统烂掉的起点——新功能要进下一轮场景卡重新走一遍，别插队` };
  },
  /**
   * 8.5 / 8.6 / 8.7 都判"上线之后每次改动有没有守规矩"。
   *
   * 这三条原来读 `notes.releases`，而全仓库没有任何代码写这个字段——
   * 于是永远是空数组，永远判 na，三条门禁一起变成摆设。
   * fixture 里那几条 releases 是手写进 state.json 的，工具自己从来不产生。
   *
   * 改成读学员真的在填的那份产物：变更记录（artifacts/08-changes.md）。
   * 06-产物模板.md 的变更记录本来就有「是否动数据模型／测试是否全绿／是否已备份」三列，
   * 正好对上这三条门禁。这样判据是"表里这一列填了什么"，
   * 不读代码、可复核、而且学员填的东西第一次真的被用上了。
   *
   * 空表判 na（还没改过东西），有行但列缺了判 fail——
   * 不能因为"没记录"就算通过，那正是原来那个洞。
   */
  '8.5': (f) => {
    const v = f.local.notes?.violations?.schemaChangedInOps || [];
    if (v.length) return { r: F, detail: `数据表结构直接改了，没回环节二先改数据字典：${v.join('、')}。文档跟实际一旦对不上，以后没人敢动这个系统` };
    const c = f.art.operate.changes;
    if (!c.exists || c.count === 0) return { r: NA, detail: '上线后还没改过东西' };
    if (c.noSchemaCol) return { r: F, detail: '变更记录里没有「是否动数据模型」这一列。改了表结构却不回去改数据字典，是系统烂掉最常见的一条路，所以这一列必须记。补上这列，每次发版填是或否' };
    if (c.schemaChangedNoModelUpdate > 0) {
      return { r: F, detail: `有 ${c.schemaChangedNoModelUpdate} 次改了数据表结构，但没标明回环节二先更新数据字典。要么补上"已同步数据字典"，要么现在回去把字典改对` };
    }
    return { r: P, detail: `${c.count} 次改动都记了动没动数据模型` };
  },
  '8.6': (f) => {
    const c = f.art.operate.changes;
    if (!c.exists || c.count === 0) return { r: NA, detail: '上线后还没改过东西' };
    if (c.noTestCol) return { r: F, detail: '变更记录里没有「测试是否全绿」这一列。上线之后每改一次都得先跑测试，不记就没人知道有没有跑。补上这列' };
    if (c.notGreen > 0) return { r: F, detail: `${c.notGreen} 次发版前测试没全绿就发上去了。测试是你唯一能看出改动有没有弄坏别的地方的通道` };
    if (c.testBlank > 0) return { r: X, detail: `${c.testBlank} 次发版的「测试是否全绿」栏空着。空着等于没跑——跑一次填上，或者写清为什么这次不用跑` };
    return { r: P, detail: `${c.count} 次发版前测试都全过` };
  },
  '8.7': (f) => {
    const c = f.art.operate.changes;
    if (!c.exists || c.count === 0) return { r: NA, detail: '上线后还没改过东西' };
    if (c.noBackupCol) return { r: F, detail: '变更记录里没有「是否已备份」这一列。发版前先备份是改坏了还能退回去的唯一保障，必须每次记' };
    if (c.notBackedUp > 0) return { r: F, detail: `${c.notBackedUp} 次发版前没先备份。改坏了数据就找不回来了` };
    if (c.backupBlank > 0) return { r: X, detail: `${c.backupBlank} 次发版的「是否已备份」栏空着。空着就当没备份，补填一下` };
    return { r: P, detail: `${c.count} 次发版前都先备份了` };
  },
  '8.8': (f) => {
    const i = f.art.operate.issues;
    if (!i.exists) return { r: F, detail: '还没有问题本子' };
    if (!i.count) return { r: NA, detail: '本子还没记东西' };
    return i.open === 0 ? { r: P } : { r: X, detail: `${i.open} 条问题还挂着没处理完。对一下有没有超过当初标的时限（紧急当天、重要三天）` };
  },
  '8.9': (f) => human(f, '8.9'),
  '8.10': (f) => human(f, '8.10'),
};
