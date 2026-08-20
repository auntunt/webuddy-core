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
  '4.4': (f) => {
    if (!f.eng.hasGit) return { r: F, detail: '改动还没有存档。让 AI 把项目接上存档工具（git），否则改坏了退不回去——这是最基本的安全网' };
    if (f.eng.commitCount === 0) return { r: F, detail: '存档工具接上了，但一次都没存过。让 AI 存一次档（提交）' };
    return { r: P, detail: `存过 ${f.eng.commitCount} 次档，最近一次 ${f.eng.lastCommitDate}` };
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

  // 4.9/4.10 必须留 native：两条都要出 na / fix，而探测表达式只有 pass 和 fail
  // 两个出口。「还没有组件清单所以不用对照」（na）跟「清单里有不该有的东西」（fail）
  // 是两件事，压成一个 fail 就是把"还没走到"说成"走错了"。
  '4.9': (f) => {
    if (!f.eng.pkg) return { r: NA, detail: '还没有组件清单，无从对照' };
    const OFF_STACK = ['react-redux', 'redux', 'mongoose', 'mongodb', '@apollo/server', 'graphql', 'kubernetes-client', 'styled-components', 'emotion'];
    const found = Object.keys(f.eng.deps).filter((d) => OFF_STACK.some((o) => d === o || d.startsWith(`${o}/`)));
    return found.length === 0
      ? { r: P }
      : { r: X, detail: `AI 用了约定方案之外的组件：${found.join('、')}。不一定错，但得你点头一次——问它一句为什么非要换，理由说不通就让它换回来` };
  },
  // 4.10 交给 DSL：三个约定位置（package.json / src / tests）在不在，file-exists 就够。
  // ref 那条判 fix（摆得不一样是提示不是拦路），而这条门禁在 mvp 下本来就静默，
  // 提示级的差别不影响任何结论——换成两态判定是这一条上最省的选择。


  // ───────── 环节五 分步实现（逐切片，这里判整体状况） ─────────
  // 5.10 原来是 `(f) => human(f, '5.10')`，跟内核默认处理同义，删掉裁决不变。
  // 5.9/5.12 必须留 native：「还没试过」是 fix（去做一件事），「试了没成」是 fail
  // （东西坏了）。这两句对用户的意思完全不同，而 DSL 只能给出其中一种。
  '5.9': (f) => {
    const r = runResult(f, 'start');
    if (!r) return { r: X, detail: '还没试过软件现在能不能跑起来。跑一次 webuddy check 5.9，工具会替你起一次看看' };
    return r.ok ? { r: P } : { r: F, detail: `软件跑不起来了：${r.error || '见日志'}` };
  },
  '5.12': (f) => {
    const r = runResult(f, 'test');
    if (!r) return { r: X, detail: '这一轮改完后还没跑过测试。跑一次 webuddy check 5.12' };
    return r.ok ? { r: P } : { r: F, detail: `有测试没通过：${r.error || '见日志'}` };
  },
  '5.11': (f) => {
    if (f.eng.commitCount === 0) return { r: F, detail: '一次档都还没存过' };
    const ratio = f.eng.commitsWithAC / f.eng.commitCount;
    if (ratio >= 0.7) return { r: P, detail: `${f.eng.commitsWithAC}/${f.eng.commitCount} 次存档写了验收标准编号` };
    if (f.eng.commitsWithAC === 0) return { r: F, detail: '每次存档都没写对应哪条验收标准。以后想查"这处为什么改的"就查不出来了' };
    return { r: X, detail: `只有 ${f.eng.commitsWithAC}/${f.eng.commitCount} 次存档写了编号` };
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
  // 6.10 不留 native：这是 human 门禁，native 只有 fail/fix 会被采纳。
  // 它的 fail 分支要 f.local.notes.security，而全仓库没有任何命令会写这个字段——
  // 分支永久不可达。八条安全底线的清单已经在 SKILL.md 的门禁说明里，
  // 靠人工确认走，不需要占一个 native 名额。

  '6.11': (f) => {
    const problems = [];
    if (f.eng.secretHits.length > 0) problems.push(`${f.eng.secretHits.length} 处密码直接写在代码里`);
    const backdoor = f.local.notes?.violations?.backdoor || [];
    if (backdoor.length > 0) problems.push(`留了不用密码就能进的口子：${backdoor.join('、')}`);
    if (problems.length === 0 && f.eng.codeFileCount === 0) return { r: ASK, detail: '还没有代码，这条现在判不了' };
    return problems.length === 0 ? { r: P } : { r: F, detail: problems.join('；') };
  },

  // ───────── 环节七 上线与上架 ─────────
  '7.10': (f) => {
    const h = f.art.handover;
    if (!h.exists) return { r: F, detail: '还没有交接单。写清四件事：网址怎么访问、新版本怎么发上去、数据怎么备份和恢复、出事找谁（文件在 artifacts/07-handover.md）' };
    if (!h.allFilled) {
      const miss = Object.entries(h.blocks).filter(([, v]) => !v || !v.trim()).map(([k]) => ({ access: '用户从哪打开', deploy: '新版本怎么发上去', backup: '数据怎么备份和恢复', contact: '出事找谁' }[k] || k));
      return { r: F, detail: `交接单这几栏还空着：${miss.join('、')}。这几栏是给接手的人看的，你自己知道不算` };
    }
    return human(f, '7.10');
  },




  // 7.11/7.14/7.15/7.17/7.18 都不留 native：全是 human 门禁，native 里的
  // pass/ask/na 分支到不了调用点（内核只采纳 human 门禁 native 的 fail/fix）。
  // 7.17 的 fail 分支要 notes.usage，没有任何命令会写它，同 6.10。

  // 7.12 必须留 native：还没上线的时候「正式环境是干净的」这句话没有意义，
  // 因为还没有正式环境。这种情况要出 na，DSL 出不了，只能出 fail——
  // 那等于因为"还没上线"就说人家生产数据脏。
  '7.12': (f) => {
    if (!f.art.handover.url) return { r: NA, detail: '还没上线，没有正式环境可查' };
    const h = human(f, '7.12');
    if (h.r !== ASK) return h;
    return { r: ASK, detail: '打开正式系统翻一遍数据，把测试时乱填的单子（张三、测试一下、aaa 这种）删干净，然后在这里确认。用户第一次打开看到假数据，会以为整个系统的数都不能信' };
  },

  // 7.7 必须留 native：「发过测试通知但没收到」是 fail，「还没配过」是 ask。
  // DSL 只有两态，把"还没配"也说成 fail 就是在项目还没走到这一步时先判它不合格。
  '7.7': (f) => {
    const r = runResult(f, 'alert');
    if (r?.ok) return { r: P, detail: `${r.date} 出事通知能收到，试过了` };
    if (r && !r.ok) return { r: F, detail: `告警测试发送失败：${r.error || '见日志'}。出事没人知道，跟没有告警一样` };
    const h = human(f, '7.7');
    if (h.r !== ASK) return h;
    return { r: ASK, detail: '配一个出事通知（短信、邮件或企微），配完发一条测试通知确认真能收到，然后在这里确认。出事没人知道跟没有监控一样' };
  },

  // ───────── 环节七「演示就绪」批（7.19-7.21）─────────
  // 判据纪律同前：看的是"有没有这个文件/这个地址打开过没有"，不评价演示做得好不好。
  // 7.21 必须留 native：「还没打开看过」是 fix，「打开了打不开」是 fail。
  '7.21': (f) => {
    const r = runResult(f, 'demoUrl');
    if (r?.ok) return { r: P, detail: `${r.date} 演示地址打开看过（${r.note || '返回正常'}）` };
    if (r && !r.ok) return { r: F, detail: `演示地址打不开：${r.error || '见日志'}` };
    return { r: X, detail: '演示地址还没真打开看过。用给别人看时的那个地址打开一次，跑 webuddy check demoUrl --url <地址>，工具会替你留痕' };
  },


  // ───────── 环节八 运行与迭代 ─────────

  /**
   * 8.5 改了数据表结构就回环节二先改数据字典。
   *
   * 这条必须是 native，不能走 DSL：ref 在「上线后还没改过东西」时判 na，
   * 而 DSL 只有 pass|fail 两态，给不出 na。翻成
   * all(file-exists(字典), file-exists(变更记录)) 之后判据被抽空成了
   * 「两个文件都在就算过」——改了表结构没同步字典照样判绿，
   * 正是这条门禁要防的事。
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

  /**
   * 8.4 / 8.6 / 8.7 和 8.5 是同一个理由留 native：环节八的门禁全部要先分清
   * 「还没进运行阶段」和「进了但做得不对」。前者是 na，后者是 fail/fix。
   * 上线后一次都没改过东西的项目，如果这三条判 fail，一个刚上线的项目会被
   * 说成三条不合格；判 pass 又是假绿。两种都错，只有 na 是对的。
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
};
