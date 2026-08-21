/**
 * 看板渲染检查（§14.5 判据 1 与判据 3）。
 *
 * 验的是"这一行会显示哪几个字"和"点几下能点到"，都是文本/结构问题，
 * 所以不开浏览器：真实的 web/app.js 跑在 test/dom-shim.mjs 上，
 * 喂 §5.4 形状的 verdict，把渲染结果读成文本再断言。
 *
 * 断言打在会发货的那份 app.js 上，不复制任何渲染逻辑——
 * 照着重写一份来测，测过了也说明不了什么。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './load-app.mjs';

/** §2.5 铁律 2 的禁词表。人读的一个字都不许出现。 */
const BANNED = ['JSON', 'HTTP', 'token', 'CLI', 'verdict', 'pack', 'fixture', 'hash',
  'undefined', 'null'];

/** 一个正常在跑的项目：一条拦路的、两条要回答的、一条提醒。 */
function verdictNormal() {
  return {
    verdict: 'blocked',
    pack: { name: 'construction-safety', version: '1.0.0' },
    instanceVersion: 3,
    counts: { pass: 12, na: 2, fix: 1, fail: 1, ask: 2, failNow: 1, fixNow: 1, askNow: 2 },
    inversion: null,
    blockers: [{
      id: '3.2',
      stage: 3,
      severity: 'high',
      say: '脚手架验收单还没签，这一步的门禁过不去',
      how: '让安全员把验收单签了，扫描件放到项目里的 docs/scaffold-check.pdf',
      evidence: 'docs/scaffold-check.pdf',
    }],
    humanPending: [
      {
        id: '3.5',
        stage: 3,
        lead: '这一条要现场看过才能算，机器看不出来',
        asks: [
          { key: 'done', q: '临边防护装齐了吗？', why: '需要确认' },
          { key: 'evidence', q: '拍一张现场照片留档', why: '需要留档' },
        ],
        needsEvidence: true,
      },
      { id: '4.1', stage: 4, lead: '这一步的班前会开了吗', asks: [] },
    ],
    warnings: [{ kind: 'stalled', severity: 'mid', headline: '这个项目 5 天没动了' }],
    trace: {
      evaluatedAt: '2026-08-20T02:00:00.000Z',
      scope: 'all',
      durationMs: 42,
      factsFingerprint: 'abc123def456',
    },
  };
}

/** 顺序反了的项目。判据 1 要求第二行含「顺序反了」。 */
function verdictInverted() {
  const v = verdictNormal();
  v.inversion = {
    gap: 7,
    currentStage: 1,
    apparentStage: 8,
    // 包作者写的原话里带术语「倒挂」，看板要靠 glossary 翻成「顺序反了」。
    say: '活已经干到第 8 步了，但第 1 步还缺 3 份该先说清的东西，这是倒挂',
  };
  return v;
}

/** 什么都不缺的项目。用来验空状态文案。 */
function verdictClean() {
  return {
    verdict: 'pass',
    pack: { name: 'construction-safety', version: '1.0.0' },
    instanceVersion: 3,
    counts: { pass: 20, na: 0, fix: 0, fail: 0, ask: 0, failNow: 0, fixNow: 0, askNow: 0 },
    inversion: null,
    blockers: [],
    humanPending: [],
    warnings: [],
    trace: {
      evaluatedAt: '2026-08-20T02:00:00.000Z', scope: 'all', durationMs: 8, factsFingerprint: 'f',
    },
  };
}

const STAGE = { current: 3, name: '主体施工', oneLiner: '按图施工，边做边验', total: 6 };

/**
 * 装一份带术语表的 app。
 *
 * GLOSSARY 是 app.js 顶层的 let，vm 里改不到——所以用 runInContext 赋值，
 * 走的正是页面上 boot() 拿到 /api/meta 之后做的同一件事。
 */
async function bootApp(glossary) {
  const vm = (await import('node:vm')).default;
  const ctx = loadApp();
  const base = JSON.parse(
    await (await import('node:fs/promises')).readFile(
      new URL('../src/kernel/glossary-base.json', import.meta.url), 'utf8',
    ),
  );
  const g = Object.assign({}, base, glossary || {});
  vm.runInContext(`GLOSSARY = ${JSON.stringify(g)};`, ctx);
  return ctx;
}

/** 一整页的渲染文本。禁词扫描按这个来。 */
function pageText(ctx, sels) {
  const parts = [];
  for (const s of sels) {
    const n = ctx.__mount(s);
    if (n) parts.push(n.text());
  }
  return parts.join(' \n ');
}

const PROJECT_SELS = ['#a-where', '#a-stuck', '#a-next', '#blockers', '#humans',
  '#zone-prop', '#props', '#rounds', '#pname', '#crumb'];

/** 画满一整个项目页。返回 ctx，挂载点用 __mount 取。 */
async function renderProject(v, opts) {
  const o = opts || {};
  const ctx = await bootApp(o.glossary);
  ctx.drawAsk3(v, o.stage === undefined ? STAGE : o.stage);
  ctx.drawBlockers(v);
  ctx.drawHumans(v, o.handlers || {});
  ctx.drawProps(o.proposals || [], o.handlers || {});
  ctx.drawRounds(o.rounds || []);
  return ctx;
}

test('三问区三行俱在且非空', async () => {
  const ctx = await renderProject(verdictNormal());
  for (const sel of ['#a-where', '#a-stuck', '#a-next']) {
    const line = ctx.__mount(sel).text();
    assert.ok(line.length > 0, `${sel} 是空的，三问区少一行`);
  }
  assert.match(ctx.__mount('#a-where').text(), /现在走到：第 3 步 · 主体施工/);
  assert.match(ctx.__mount('#a-stuck').text(), /脚手架验收单/);
  assert.match(ctx.__mount('#a-next').text(), /安全员/);
});

test('三问区在 stage 缺失时也不留空行', async () => {
  const ctx = await renderProject(verdictNormal(), { stage: null });
  for (const sel of ['#a-where', '#a-stuck', '#a-next']) {
    assert.ok(ctx.__mount(sel).text().length > 0, `${sel} 是空的`);
  }
  assert.match(ctx.__mount('#a-where').text(), /还没开始/);
});

test('顺序反了的项目：第二行含「顺序反了」，第三行说回哪一步', async () => {
  const ctx = await renderProject(verdictInverted());
  const stuck = ctx.__mount('#a-stuck').text();
  assert.match(stuck, /顺序反了/, `第二行没说顺序反了：${stuck}`);
  assert.doesNotMatch(stuck, /倒挂/, '「倒挂」没被术语表翻掉');
  assert.match(ctx.__mount('#a-next').text(), /回去把第 1 步/);
});

test('每条红灯卡都含「怎么办」', async () => {
  const v = verdictNormal();
  v.blockers.push({ id: '5.1', stage: 5, severity: 'mid', say: '塔吊月检记录缺一份', how: '' });
  const ctx = await renderProject(v);
  const cards = ctx.__mount('#blockers').children;
  assert.equal(cards.length, 2);
  for (const c of cards) {
    assert.match(c.text(), /怎么办：/, `这张红灯卡没写怎么办：${c.text()}`);
    // how 为空也要有兜底的一句，不能渲染成"怎么办："后面没字
    assert.match(c.text(), /怎么办：\S/, '「怎么办」后面是空的');
  }
});

test('红灯卡的文件说成「项目里的 xxx」，不露路径细节', async () => {
  const ctx = await renderProject(verdictNormal());
  const t = ctx.__mount('#blockers').text();
  assert.match(t, /项目里的 docs\/scaffold-check\.pdf/);
});

test('每个可空区域的空状态文案俱在', async () => {
  const ctx = await renderProject(verdictClean());
  assert.match(ctx.__mount('#blockers').text(), /没有拦着你的事。/);
  assert.match(ctx.__mount('#humans').text(), /现在没有要你回答的事。/);
  assert.match(ctx.__mount('#rounds').text(), /现在没有助手在干活。/);
  // 建议区没有建议时整区藏起来，不留一块空白
  assert.equal(ctx.__mount('#zone-prop').hidden, true);
  assert.equal(ctx.__mount('#props').children.length, 0);
});

test('项目列表空的时候给的是怎么办，不是一片空白', async () => {
  const ctx = await bootApp();
  ctx.drawList([], {});
  const empty = ctx.__mount('#list-empty');
  assert.equal(empty.hidden, false);
  assert.ok(empty.text().length > 20, '空状态只有一句干话');
  assert.match(empty.text(), /技术同事/);
  assert.equal(ctx.__mount('#cards').children.length, 0);
});

test('要你回答的卡：确认按钮存在，且带一个选填备注框', async () => {
  const ctx = await renderProject(verdictNormal());
  const cards = ctx.__mount('#humans').children;
  assert.equal(cards.length, 2);
  const card = cards[0];
  const btns = card.children.filter((c) => c.tagName === 'BUTTON');
  assert.equal(btns.length, 1, '确认按钮不是一个');
  assert.ok(btns[0].text().length > 0, '按钮上没字');
  assert.equal(typeof btns[0].onclick, 'function', '按钮没绑上点击');
  const notes = card.children.filter((c) => c.dataset.role === 'note');
  assert.equal(notes.length, 1, 'note 输入框缺了');
  // 「不写也行」得写在界面上：不说清就变成必填，人会卡在这儿
  assert.match(card.text(), /不写也行/);
  // 每一问一个框，问题原文也要显示出来
  const tas = card.children.filter((c) => c.tagName === 'TEXTAREA');
  assert.equal(tas.length, 2);
  assert.deepEqual(tas.map((t) => t.dataset.key), ['done', 'evidence']);
  assert.match(card.text(), /临边防护装齐了吗？/);
});

test('要交文件的那条，上传框嵌在同一张卡里', async () => {
  const ctx = await renderProject(verdictNormal());
  const cards = ctx.__mount('#humans').children;
  const drops = cards[0].children.filter((c) => c.className.includes('drop'));
  assert.equal(drops.length, 1, '需要留档的条目没有上传框');
  assert.match(drops[0].text(), /把照片或文件拖到这里/);
  // 触屏上拖不动，得同时给文件选择框
  const picks = drops[0].children.filter((c) => c.dataset.role === 'pick');
  assert.equal(picks.length, 1);
  // 不需要留档的那条不该冒出个上传框来
  const other = cards[1].children.filter((c) => c.className.includes('drop'));
  assert.equal(other.length, 0);
});

test('采纳按钮的确认框把后果说清了（§2.5 铁律 7）', async () => {
  let warned = '';
  const ctx = await bootApp();
  // confirm 的原话拿出来看。load-app 里的 confirm 恒真，这里换成录音的。
  const vm = (await import('node:vm')).default;
  vm.runInContext('confirm = function (m) { globalThis.__warn = m; return false; };', ctx);
  ctx.drawProps([{ id: '2026-08-20T02-00-00-000Z', instanceVersion: 3, text: '建议把第 3 步的检查项从 4 条改成 5 条' }], {
    onApply: () => { throw new Error('确认框点了取消，不该往下走'); },
  });
  const card = ctx.__mount('#props').children[0];
  const take = card.children.find((c) => c.className.includes('take'));
  assert.ok(take, '采纳按钮缺了');
  take.onclick();
  warned = ctx.__warn || '';
  assert.match(warned, /第 4 版/, '没说清单会变成第几版');
  assert.match(warned, /重新答/, '没说之前的确认要重新答');
  // 有建议的时候这一区要露出来
  assert.equal(ctx.__mount('#zone-prop').hidden, false);
  assert.match(card.text(), /先不用/, '缺了「先不用」这条退路');
});

/* ---------- 禁词扫描（§2.5 铁律 2）---------- */

/**
 * 禁词不区分大小写地扫。结论/清单这些词的中文对应物已经在 glossary 里，
 * 会漏出来的通常是英文原词——那正是"术语零暴露"要拦的东西。
 */
function scanBanned(text) {
  const hits = [];
  const low = text.toLowerCase();
  for (const w of BANNED) {
    if (low.includes(w.toLowerCase())) hits.push(w);
  }
  return hits;
}

test('项目页全页渲染文本对禁词表零命中', async () => {
  const ctx = await renderProject(verdictNormal(), {
    proposals: [{
      id: '2026-08-20T02-00-00-000Z',
      instanceVersion: 3,
      text: '建议把第 3 步的检查项从 4 条改成 5 条\n\n点头之后，你之前做过的人工确认要重新看一遍。',
    }],
    rounds: [{
      sessionId: 'a1',
      gateId: '3.5',
      files: ['src/a.js', 'src/b.js'],
      startedAt: '2026-08-20T01:00:00.000Z',
      endedAt: null,
      violations: [{ dim: 'tests', kind: 'testsTampered', say: '现场记录的条目从 12 条变成 9 条' }],
    }],
  });
  const t = pageText(ctx, PROJECT_SELS);
  assert.deepEqual(scanBanned(t), [], `页面上漏出了术语：${t}`);
  // 顺手确认扫的不是空字符串，不然这条断言等于没测
  assert.ok(t.length > 100, '页面文本太短，八成没渲染上');
});

test('顺序反了的页面也不漏术语', async () => {
  const ctx = await renderProject(verdictInverted());
  assert.deepEqual(scanBanned(pageText(ctx, PROJECT_SELS)), []);
});

test('空项目页、空列表页都不漏术语', async () => {
  const a = await renderProject(verdictClean());
  assert.deepEqual(scanBanned(pageText(a, PROJECT_SELS)), []);
  const b = await bootApp();
  b.drawList([], {});
  assert.deepEqual(scanBanned(pageText(b, ['#cards', '#list-empty'])), []);
});

test('项目列表页：正常项目和坏项目都不漏术语，且都给出要紧的事', async () => {
  const ctx = await bootApp();
  ctx.drawList([
    {
      id: 'p1', alias: '望江路项目', dir: '/tmp/p1', stage: STAGE, verdict: verdictNormal(),
    },
    // 挂不上清单的项目。这一条最容易漏出技术原话，所以专门喂一句带术语的
    { id: 'p2', alias: '滨河路项目', dir: '/tmp/p2', error: '这个项目还没挂上门禁清单' },
  ], {});
  const cards = ctx.__mount('#cards').children;
  assert.equal(cards.length, 2);
  for (const c of cards) {
    assert.ok(c.text().includes('进去看'), '卡上没有进去看');
    assert.ok(c.text().length > 10, `这张卡几乎是空的：${c.dump()}`);
  }
  assert.match(cards[1].text(), /检查清单/, '「门禁清单」没被术语表翻掉');
  assert.deepEqual(scanBanned(pageText(ctx, ['#cards'])), []);
});

test('日期一律相对时间，正文不出现绝对时间戳（§14.4）', async () => {
  const ctx = await bootApp();
  const hourAgo = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
  ctx.drawRounds([{ sessionId: 'a1', files: ['x.js'], startedAt: hourAgo, endedAt: null }]);
  const t = ctx.__mount('#rounds').text();
  assert.match(t, /3 小时前/);
  assert.doesNotMatch(t, /\d{4}-\d{2}-\d{2}/, '正文里出现了绝对日期');
  assert.doesNotMatch(t, /[0-9a-f]{12}/, '正文里出现了一长串编号');
});

/* ---------- 点击深度（§14.5 判据 3、§2.5 铁律 3）---------- */

/**
 * 找出所有挂了交互的节点，返回它们距 root 的层数（root 的直接孩子算 1 层）。
 *
 * 数的是"从这一区的根往下几层才碰到能点的东西"。三个主要动作
 * （确认 / 上传 / 采纳）都必须 ≤2：卡片一层，按钮一层。
 * 超了就意味着有个"先点开详情"之类的中间层，那一层会把人挡在外面。
 */
function interactiveDepths(root) {
  const out = [];
  const walk = (n, d) => {
    for (const c of n.children) {
      if (c.isInteractive) out.push({ depth: d, tag: c.tagName, cls: c.className, text: c.text() });
      walk(c, d + 1);
    }
  };
  walk(root, 1);
  return out;
}

test('确认按钮距根 ≤2 层', async () => {
  const ctx = await renderProject(verdictNormal(), { handlers: { onConfirm: () => {} } });
  const hits = interactiveDepths(ctx.__mount('#humans'))
    .filter((h) => h.tag === 'BUTTON' && h.cls.includes('confirm'));
  assert.ok(hits.length >= 1, '找不到确认按钮');
  for (const h of hits) {
    assert.ok(h.depth <= 2, `确认按钮在第 ${h.depth} 层，点得太深`);
  }
});

test('上传框距根 ≤2 层', async () => {
  const ctx = await renderProject(verdictNormal(), { handlers: { onUpload: () => {} } });
  const hits = interactiveDepths(ctx.__mount('#humans'))
    .filter((h) => h.cls.includes('drop') || h.tag === 'INPUT');
  const drop = hits.filter((h) => h.cls.includes('drop'));
  assert.equal(drop.length, 1, '上传框不是一个');
  assert.ok(drop[0].depth <= 2, `上传框在第 ${drop[0].depth} 层`);
  // 框里那个文件选择框会再深一层，那是框自己的内部件，不算一次点击
  const pick = hits.filter((h) => h.tag === 'INPUT');
  assert.ok(pick.length >= 1, '缺文件选择框');
  assert.ok(pick[0].depth <= 3, `文件选择框在第 ${pick[0].depth} 层`);
});

test('采纳按钮距根 ≤2 层', async () => {
  const ctx = await bootApp();
  ctx.drawProps([{ id: 'x', instanceVersion: 1, text: '建议加一条检查项' }], { onApply: () => {} });
  const hits = interactiveDepths(ctx.__mount('#props')).filter((h) => h.tag === 'BUTTON');
  assert.equal(hits.length, 2, '采纳 / 先不用 应该正好两个按钮');
  for (const h of hits) {
    assert.ok(h.depth <= 2, `${h.text} 在第 ${h.depth} 层，点得太深`);
  }
});

test('项目卡整张就是一个按钮，一下点进去', async () => {
  const ctx = await bootApp();
  let opened = null;
  ctx.drawList([{ id: 'p1', alias: '望江路项目', dir: '/tmp/p1', stage: STAGE, verdict: verdictClean() }], {
    onOpen: (id, dir) => { opened = [id, dir]; },
  });
  const hits = interactiveDepths(ctx.__mount('#cards'));
  assert.equal(hits.length, 1, '一张卡上不该有第二个能点的东西');
  assert.equal(hits[0].depth, 1);
  assert.equal(hits[0].tag, 'BUTTON');
  ctx.__mount('#cards').children[0].onclick();
  assert.deepEqual(opened, ['p1', '/tmp/p1']);
});

/**
 * 上面那些用的是手写 verdict，形状对不对由 §5.4 保证；
 * 这一条走真路：真包 + 真项目目录 → evaluate → buildVerdict → 渲染。
 *
 * 单独写一条是因为 needsEvidence 这一位要穿过四道手（SKILL.md 的「需要凭据:」→
 * skill-compile → evaluate 的门禁结论 → buildVerdict 的 humanPending），
 * 中间任何一道漏掉，手写 fixture 照样绿，而真实页面上就是没有上传框——
 * 人答完字找不着地方交照片，这一条永远差着凭据。
 */
test('真项目算出来的待答条目，要交文件的那条带上传框', async () => {
  const path = (await import('node:path')).default;
  const { loadPack } = await import('../src/kernel/pack.js');
  const { evaluate } = await import('../src/kernel/evaluate.js');
  const { buildVerdict } = await import('../src/kernel/verdict.js');

  const HERE = path.dirname(new URL(import.meta.url).pathname);
  const res = await loadPack(path.join(HERE, '..', 'packs', 'construction-safety'));
  assert.equal(res.ok, true, `包没加载起来：${(res.errors || []).join('；')}`);

  const dir = path.join(HERE, 'fixtures', 'golden-src', 'construction-project');
  const er = evaluate(dir, res.pack, { mode: 'mvp' });
  const v = buildVerdict(er, res.pack, { evaluatedAt: '2026-08-20T00:00:00.000Z' });

  const want = v.humanPending.filter((h) => h.needsEvidence);
  assert.ok(want.length >= 1, '这个包里明明有写「需要凭据」的条目，算出来一条都没标上');

  const ctx = await bootApp();
  ctx.drawHumans(v, { onConfirm: () => {}, onUpload: () => {} });
  const cards = ctx.__mount('#humans').children;
  assert.equal(cards.length, v.humanPending.length);

  for (let i = 0; i < cards.length; i += 1) {
    const id = v.humanPending[i].id;
    const drops = interactiveDepths(cards[i]).filter((h) => h.cls.includes('drop'));
    if (v.humanPending[i].needsEvidence) {
      assert.equal(drops.length, 1, `第 ${id} 条要交文件，卡上却没有上传框`);
      assert.ok(cards[i].text().includes('把照片或文件拖到这里'), `第 ${id} 条没写怎么交文件`);
    } else {
      assert.equal(drops.length, 0, `第 ${id} 条不用交文件，卡上却多了个上传框`);
    }
  }
});

test('真项目算出来的整页，禁词零命中', async () => {
  const path = (await import('node:path')).default;
  const { loadPack } = await import('../src/kernel/pack.js');
  const { evaluate } = await import('../src/kernel/evaluate.js');
  const { buildVerdict } = await import('../src/kernel/verdict.js');

  const HERE = path.dirname(new URL(import.meta.url).pathname);
  const res = await loadPack(path.join(HERE, '..', 'packs', 'construction-safety'));
  assert.equal(res.ok, true);
  const dir = path.join(HERE, 'fixtures', 'golden-src', 'construction-project');
  const er = evaluate(dir, res.pack, { mode: 'mvp' });
  const v = buildVerdict(er, res.pack, { evaluatedAt: '2026-08-20T00:00:00.000Z' });

  // 术语表用包自己那份叠在 base 上，跟页面 boot() 拿到的一样
  const glossary = JSON.parse(await (await import('node:fs/promises')).readFile(
    path.join(HERE, '..', 'packs', 'construction-safety', 'glossary.json'), 'utf8'));
  const ctx = await bootApp(glossary);
  ctx.drawAsk3(v, { current: er.currentStage, name: '主体施工', oneLiner: '按图施工', total: 3 });
  ctx.drawBlockers(v);
  ctx.drawHumans(v, {});
  const txt = pageText(ctx, ['#a-where', '#a-stuck', '#a-next', '#blockers', '#humans']);
  const hit = BANNED.filter((w) => txt.toLowerCase().includes(w.toLowerCase()));
  assert.deepEqual(hit, [], `真项目页面上冒出了这些词：${hit.join('、')}\n---\n${txt}`);
});
