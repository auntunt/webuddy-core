/**
 * 担架包加载与管理。
 *
 * 包目录结构:
 *   packs/<name>/
 *   ├── pack.json
 *   ├── SKILL.md
 *   ├── probes.md
 *   ├── prompts.md
 *   ├── glossary.json
 *   ├── native-rules.js (仅 native:true 的第一方包)
 *   └── fixtures/
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileSkill } from './skill-compile.js';
import { parseProbe } from './probe-dsl.js';
// 换行统一在读进来的第一时间做，别让 CRLF 流进任何一个 split('\n')
import { normalizeNewlines } from './artifact-io.js';
import { statePath, loadState, saveState } from './state.js';
import { evaluate } from './evaluate.js';

/**
 * 内核自带的术语底表（§14.4）。用 import 读而不是 fs.readFileSync：
 * 这文件跟代码一起发，路径怎么变都跟着走，不用拼 __dirname。
 */
import BASE_GLOSSARY from './glossary-base.json' with { type: 'json' };

/**
 * 加载担架包。
 *
 * @param {string} packDir - 包目录路径
 * @returns {object} {ok, pack?, errors?}
 */
export async function loadPack(packDir) {
  const errors = [];

  // 1. 读取 pack.json
  const packJsonPath = path.join(packDir, 'pack.json');
  if (!fs.existsSync(packJsonPath)) {
    return { ok: false, errors: ['找不到 pack.json'] };
  }

  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(packJsonPath, 'utf8'));
  } catch (e) {
    return { ok: false, errors: [`pack.json 格式错误: ${e.message}`] };
  }

  // 验证必需字段
  if (!meta.name) errors.push('pack.json 缺少 name 字段');
  if (!meta.version) errors.push('pack.json 缺少 version 字段');
  if (!meta.title) errors.push('pack.json 缺少 title 字段');

  // 2. 编译 SKILL.md
  const skillPath = path.join(packDir, 'SKILL.md');
  if (!fs.existsSync(skillPath)) {
    return { ok: false, errors: ['找不到 SKILL.md'] };
  }

  const skillText = normalizeNewlines(fs.readFileSync(skillPath, 'utf8'));
  const { stages, gates, errors: skillErrors } = compileSkill(skillText);
  errors.push(...skillErrors);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  /**
   * 3. 解析 probes.md
   *
   * 小节里表达式之前可以写一行「不过时算: fix」或「不过时算: ask」（I2b）。
   * 它不是原语，是门禁级的映射：探测表达式照旧只答"过 / 不过"，
   * 而"不过"这两个字对人的意思有三种——你做错了（fail）、
   * 你还差一件事没做（fix）、机器看不准你自己看一眼（ask）。
   * 把这个分档放在小节头上而不是塞进表达式，是为了让表达式保持纯粹：
   * 表达式只回答事实，档位归门禁。
   */
  const probes = new Map();
  const probeMiss = new Map();
  const probesPath = path.join(packDir, 'probes.md');
  const MISS_ALLOWED = ['fix', 'ask'];
  if (fs.existsSync(probesPath)) {
    const probesText = normalizeNewlines(fs.readFileSync(probesPath, 'utf8'));
    const probesSections = parseSections(probesText);
    for (const [gateId, body] of Object.entries(probesSections)) {
      const exprLines = [];
      let miss = null;
      let missBad = false;
      for (const line of body.split('\n')) {
        const m = /^不过时算[:：]\s*(\S+)\s*$/.exec(line.trim());
        if (m && exprLines.every((l) => l.trim() === '')) {
          if (!MISS_ALLOWED.includes(m[1])) {
            errors.push(`门禁 ${gateId} 的「不过时算」只认 fix 或 ask，写的是「${m[1]}」`);
            missBad = true;
          } else {
            miss = m[1];
          }
          continue;
        }
        exprLines.push(line);
      }
      const expr = exprLines.join('\n').trim();
      const result = parseProbe(expr);
      if (!result.ok) {
        errors.push(`门禁 ${gateId} 的探测表达式有误: ${result.why}`);
      } else {
        probes.set(gateId, result.ast);
      }
      if (miss && !missBad) probeMiss.set(gateId, miss);
    }
  }

  // 4. 解析 prompts.md
  const prompts = new Map();
  const promptsPath = path.join(packDir, 'prompts.md');
  if (fs.existsSync(promptsPath)) {
    const promptsText = normalizeNewlines(fs.readFileSync(promptsPath, 'utf8'));
    const promptsSections = parseSections(promptsText);
    for (const [gateId, content] of Object.entries(promptsSections)) {
      const prompt = parsePromptSection(gateId, content);
      if (prompt) prompts.set(gateId, prompt);
    }
  }

  /**
   * 5. 加载 glossary.json，叠在内核的 glossary-base.json 之上（§14.4）。
   *
   * base 打底的原因：「门禁」「倒挂」这些词是内核自己造的，每个包都得翻一遍
   * 才不漏，漏一个就在界面上露出一个术语。包里的同名键覆盖 base——
   * 行业里管它叫别的名字时，包说了算。
   */
  let glossary = { ...BASE_GLOSSARY };
  const glossaryPath = path.join(packDir, 'glossary.json');
  if (fs.existsSync(glossaryPath)) {
    try {
      Object.assign(glossary, JSON.parse(fs.readFileSync(glossaryPath, 'utf8')));
    } catch (e) {
      errors.push(`glossary.json 格式错误: ${e.message}`);
    }
  }

  // 6. 加载 native-rules.js (如果有)
  let nativeRules = null;
  let packHooks = { apparentStage: null, upstreamMissing: null };
  const nativePath = path.join(packDir, 'native-rules.js');
  if (fs.existsSync(nativePath)) {
    if (!meta.native) {
      errors.push('pack.json 声明 native:false 但存在 native-rules.js');
    } else {
      try {
        const fileUrl = pathToFileURL(nativePath).href;
        const mod = await import(fileUrl);
        nativeRules = mod.default || mod.RULES || mod;
        /**
         * 包还可以顺便导出两个钩子（§5.2）：apparentStage 与 upstreamMissing。
         *
         * 必须单独接出来：nativeRules 取的是 mod.RULES，那里面只有门禁号，
         * 钩子挂在模块顶层。少接这一步的话，包明明写了钩子而内核永远走通用口径，
         * 而两者都不报错——倒挂检测悄悄退化成"只会漏报"，没人看得出来。
         */
        packHooks = {
          apparentStage: typeof mod.apparentStage === 'function' ? mod.apparentStage : null,
          upstreamMissing: typeof mod.upstreamMissing === 'function' ? mod.upstreamMissing : null,
        };
      } catch (e) {
        errors.push(`加载 native-rules.js 失败: ${e.message}`);
      }
    }
  }

  // 7. 交叉校验
  const autoGates = gates.filter((g) => g.mode === 'auto');
  const humanGates = gates.filter((g) => g.mode === 'human');

  // a) 每条 auto 门禁必须有实现
  for (const g of autoGates) {
    const hasProbe = probes.has(g.id);
    const hasNative = nativeRules && nativeRules[g.id];
    if (!hasProbe && !hasNative) {
      errors.push(`auto 门禁 ${g.id} 缺少探测实现（probes.md 或 native-rules.js）`);
    }
  }

  // b) 每条 human 门禁必须有提问组
  for (const g of humanGates) {
    const hasPrompt = prompts.has(g.id);
    const hasDefault = g.defaultPrompt && g.defaultPrompt.asks.length > 0;
    if (!hasPrompt && !hasDefault) {
      errors.push(`human 门禁 ${g.id} 缺少提问组（prompts.md 或 SKILL.md 提问行）`);
    }
  }

  /**
   * b2) human 门禁的小节里不许写「不过时算」（I2b）。
   *
   * human 门禁根本不走 probes（evaluate.js 判 human 时在 judgeHuman +
   * humanPrecheck 之后就 return 了），写了就是一句永远不生效的配置。
   * 死配置比没配置坏：包作者以为自己改了行为，实际什么都没发生。
   */
  const humanIds = new Set(humanGates.map((g) => g.id));
  for (const id of probeMiss.keys()) {
    if (humanIds.has(id)) {
      errors.push(`门禁 ${id} 是 human 门禁，不走探测表达式，「不过时算」写了也不会生效——删掉这一行`);
    }
  }

  // c) probes.md / prompts.md 出现的 gateId 必须存在
  const gateIds = new Set(gates.map((g) => g.id));
  for (const id of probes.keys()) {
    if (!gateIds.has(id)) {
      errors.push(`probes.md 中的门禁 ${id} 在 SKILL.md 中不存在`);
    }
  }
  for (const id of prompts.keys()) {
    if (!gateIds.has(id)) {
      errors.push(`prompts.md 中的门禁 ${id} 在 SKILL.md 中不存在`);
    }
  }

  // d) lexicon-hit 引用的词表名必须在 pack.json.lexicons 里
  const lexicons = meta.lexicons || {};
  for (const [gateId, ast] of probes) {
    validateLexicons(ast, lexicons, (lex) => {
      errors.push(`门禁 ${gateId} 引用的词表 "${lex}" 在 pack.json.lexicons 中不存在`);
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  /**
   * 8. 合并提问组（prompts.md 整组覆盖缺省）
   *
   * 除 human 门禁外，写了「不过时算: ask」的 auto 门禁也留提问组（I2b）：
   * 它判出 ask 时走的是同一条"等人答"的通道，界面上要有话问。
   * 不留的话，这类门禁在看板上只有一句"你自己看一眼"，看一眼什么全靠猜。
   */
  const finalPrompts = [];
  for (const g of gates) {
    const asksHuman = g.mode === 'human' || probeMiss.get(g.id) === 'ask';
    if (asksHuman) {
      const customPrompt = prompts.get(g.id);
      const prompt = customPrompt || (g.mode === 'human' ? g.defaultPrompt : null);
      if (prompt) finalPrompts.push(prompt);
    }
  }

  // 9. 构建最终 pack 对象并深冻结
  const pack = Object.freeze({
    meta: Object.freeze({ ...meta }),
    stages: Object.freeze(stages.map((s) => Object.freeze({ ...s }))),
    gates: Object.freeze(gates.map((g) => Object.freeze({ ...g }))),
    probes: Object.freeze(probes),
    // 门禁号 → 'fix'|'ask'：表达式没过时该落成哪一档，缺省不在表里 = fail
    probeMiss: Object.freeze(probeMiss),
    prompts: Object.freeze(finalPrompts.map((p) => Object.freeze({ ...p }))),
    glossary: Object.freeze({ ...glossary }),
    lexicons: Object.freeze({ ...lexicons }),
    hints: Object.freeze({ ...meta.hints }),
    // 挂钩没装时该降档的门禁清单，由包声明（见 severity.js 的说明）。
    // 包没写就是空数组：不降任何一条，比误降安全。
    hookDependentGates: Object.freeze([...(meta.hooks?.dependentGates || [])]),
    nativeRules: nativeRules ? Object.freeze(nativeRules) : null,
    // §5.2 的两个可选钩子。包没导出就是 null，内核走通用口径。
    hooks: Object.freeze({ ...packHooks }),
  });

  return { ok: true, pack };
}

/**
 * 解析分节文档（probes.md / prompts.md）。
 * 返回 {gateId: sectionBody, ...}
 */
function parseSections(text) {
  const sections = {};
  const lines = text.split('\n');
  let currentId = null;
  let currentLines = [];

  for (const line of lines) {
    const m = line.match(/^###\s+(\d+\.\d+)/);
    if (m) {
      if (currentId) {
        sections[currentId] = currentLines.join('\n').trim();
      }
      currentId = m[1];
      currentLines = [];
    } else if (currentId) {
      currentLines.push(line);
    }
  }

  if (currentId) {
    sections[currentId] = currentLines.join('\n').trim();
  }

  return sections;
}

/**
 * 解析 prompts.md 小节内容。
 * 格式：
 *   开场: ...
 *   阻断: 是|否
 *   前提: client,deploy
 *   - [key] 问题 | 为何: 原因 | 前提: ...
 */
function parsePromptSection(gateId, content) {
  const lines = content.split('\n');
  let lead = '';
  let blockUntilAnswered = false;
  let needs = [];
  const asks = [];

  for (const line of lines) {
    const leadMatch = line.match(/^开场[:：]\s*(.+)$/);
    const blockMatch = line.match(/^阻断[:：]\s*(是|否)/);
    const needsMatch = line.match(/^前提[:：]\s*(.+)$/);
    const askMatch = line.match(/^-\s*\[([^\]]+)\]\s*([^|]+)(?:\|\s*为何[:：]\s*([^|]+))?(?:\|\s*前提[:：]\s*(.+))?$/);

    if (leadMatch) {
      lead = leadMatch[1].trim();
    } else if (blockMatch) {
      blockUntilAnswered = blockMatch[1] === '是';
    } else if (needsMatch) {
      needs = needsMatch[1].split(/[,，]/).map((n) => n.trim()).filter(Boolean);
    } else if (askMatch) {
      const key = askMatch[1].trim();
      const q = askMatch[2].trim();
      const why = askMatch[3] ? askMatch[3].trim() : '';
      const askNeeds = askMatch[4] ? askMatch[4].split(/[,，]/).map((n) => n.trim()) : undefined;
      asks.push({ key, q, why, needs: askNeeds });
    }
  }

  if (asks.length === 0) return null;

  const [stage] = gateId.split('.');
  return {
    id: gateId,
    stage: Number(stage),
    lead,
    blockUntilAnswered,
    needs,
    asks,
  };
}

/**
 * 递归验证 AST 中的 lexicon-hit 引用。
 */
function validateLexicons(ast, lexicons, onError) {
  if (!ast || typeof ast !== 'object') return;

  if (ast.fn === 'lexicon-hit') {
    const lexName = ast.args[1];
    if (typeof lexName === 'string' && !lexicons[lexName]) {
      onError(lexName);
    }
  }

  if (Array.isArray(ast.args)) {
    for (const arg of ast.args) {
      if (arg && typeof arg === 'object') {
        validateLexicons(arg, lexicons, onError);
      }
    }
  }
}

/**
 * 解析包路径。
 *
 * 顺序: 路径 > 项目已挂载 > 本仓库 packs/ > ~/.webuddy/packs/
 *
 * @param {string} nameOrDir - 包名或路径
 * @returns {string|null} 包目录路径
 */
export function resolvePack(nameOrDir, projectDir = null) {
  // 1. 如果是绝对路径或相对路径
  if (nameOrDir && (nameOrDir.includes('/') || nameOrDir.includes('\\'))) {
    const abs = path.resolve(nameOrDir);
    if (fs.existsSync(path.join(abs, 'pack.json'))) {
      return abs;
    }
    return null;
  }

  /**
   * 1.5 没指定名字时，看这个项目挂载过什么（§3.4 的顺序：路径 > 已挂载 > 本仓库 > 全局）。
   *
   * 这一步不能少：人在项目里跑 check 时不带任何参数，工具得知道他上次挂的是哪个包。
   * 少了它就只能猜一个默认名，而猜错的表现是"检查项全变了"——比报错难查得多。
   */
  if (!nameOrDir && projectDir) {
    const st = loadState(projectDir);
    if (st?.pack) return resolvePack(st.pack, null);
    return null;
  }
  if (!nameOrDir) return null;

  // 2. 本仓库 packs/
  const localPath = path.join(process.cwd(), 'packs', nameOrDir);
  if (fs.existsSync(path.join(localPath, 'pack.json'))) {
    return localPath;
  }

  // 3. ~/.webuddy/packs/
  const globalPath = path.join(process.env.HOME || process.env.USERPROFILE || '', '.webuddy', 'packs', nameOrDir);
  if (fs.existsSync(path.join(globalPath, 'pack.json'))) {
    return globalPath;
  }

  return null;
}

/**
 * 把一套检查清单挂到项目上。
 *
 * state.pack 存的是包名字符串（§2.3 的 schema 就一个 "pack": "<包名>"），
 * 不是 {name, version, dir} 这种对象：resolvePack 会把这个字段原样再喂给自己解一次，
 * 塞对象进去的话下次 check 会死在 nameOrDir.includes 上——而且是挂载之后才死，
 * 挂载当场看起来是成功的。
 *
 * 挂载时给的是路径的话就存路径，好让 fixtures、临时目录这些不在 packs/ 下的包也能挂。
 *
 * @param {string} projectDir - 项目目录
 * @param {string} packRef - 包名或路径
 * @returns {object} {ok, packName?, error?}
 */
export async function mountPack(projectDir, packRef) {
  const packDir = resolvePack(packRef);
  if (!packDir) {
    return { ok: false, error: `找不到这套检查清单：${packRef}` };
  }

  const result = await loadPack(packDir);
  if (!result.ok) {
    return { ok: false, error: `这套检查清单本身有问题，没挂上：\n${result.errors.join('\n')}` };
  }

  const byPath = packRef.includes('/') || packRef.includes('\\');
  const state = loadState(projectDir) || {};
  state.pack = byPath ? packDir : result.pack.meta.name;
  state.packVersion = result.pack.meta.version;
  state.mountedAt = new Date().toISOString();
  saveState(projectDir, state);

  return { ok: true, packName: result.pack.meta.name };
}

/**
 * 拷贝一整个目录。fixtures 源目录只读，判定会往里追加记录，所以先搬走再跑。
 *
 * dot-<名字> 在拷过去的时候还原成 .<名字>：样板项目里有些判据要看隐藏目录
 * （比如"改动有没有存档"要看 .git），但版本管理工具不肯把这种目录当普通文件收进来，
 * 于是仓库里存成 dot-git，拷贝时改回来。包自己声明存哪些，内核只认这条命名约定。
 *
 * 导出是给 webuddy demo 用的（I4a）：演示项目就是把 fixtures/broken 整份搬出来，
 * 搬的时候必须走同一份 dot- 还原规则 —— 两处各写一遍，早晚会漂。
 */
export function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const name = e.name.startsWith('dot-') ? `.${e.name.slice(4)}` : e.name;
    const d = path.join(dst, name);
    if (e.isDirectory()) copyDir(s, d);
    else if (e.isFile()) fs.copyFileSync(s, d);
  }
}

/** 两个集合的差集，两个方向都要，因为多红和少红都是不合格。 */
function setDiff(a, b) {
  return [...a].filter((x) => !b.has(x)).sort();
}

/**
 * 跑包自带的样板项目，看这个包判得准不准（§11.2）。
 *
 * 两个样板一正一反：
 *   good/   —— 一个什么都做齐了的项目，现在该管的一条都不该红
 *   broken/ —— 一个故意留了错的项目，红的必须正好是 expected.json 里点名的那几条
 *
 * broken 要求"正好"，不是"至少"：少红了是漏报，多红了是误报，
 * 后者更该拦——一个动不动就报错的包，人第三次以后就不看它说什么了。
 *
 * 两个样板都先整份拷到临时目录再判，判完删掉：判定要往 .webuddy/ 里追加留痕，
 * 落回源目录会让下次跑的结果跟这次不一样，那就不是测试了。
 *
 * @param {string} packDir - 包目录路径
 * @returns {Promise<object>} {ok, report:string[]}
 */
export async function runPackFixtures(packDir) {
  const report = [];
  const fixturesDir = path.join(packDir, 'fixtures');

  if (!fs.existsSync(fixturesDir)) {
    return { ok: false, report: [`这个包没有 fixtures/ 目录，没法自测。至少要有 fixtures/good/ 和 fixtures/broken/ 两个样板项目`] };
  }

  const loaded = await loadPack(packDir);
  if (!loaded.ok) {
    return { ok: false, report: [`包本身就加载不起来，先修这个：`, ...loaded.errors.map((e) => `  ${e}`)] };
  }
  const pack = loaded.pack;

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'webuddy-fixtures-'));
  let ok = true;

  try {
    // ---- good/：现在该管的一条都不该红 ----
    const goodSrc = path.join(fixturesDir, 'good');
    if (!fs.existsSync(goodSrc)) {
      ok = false;
      report.push('缺 fixtures/good/：需要一个"什么都做齐了"的样板项目，用来证明这个包不会冤枉好项目');
    } else {
      const goodDir = path.join(work, 'good');
      copyDir(goodSrc, goodDir);
      const r = evaluate(goodDir, pack);
      const hard = r.hardFailsNow || [];

      if (r.counts.failNow === 0 && hard.length === 0) {
        report.push(`good/ 通过：${r.counts.total} 条检查里现在该管的全过了`);
      } else {
        ok = false;
        report.push(`good/ 没通过：这个样板项目本该全过，但有 ${r.counts.failNow} 条现在该管的没过`);
        for (const v of hard) {
          report.push(`  拦路的 ${v.id}：${v.say}`);
        }
        for (const v of (r.gates || []).filter((g) => g.r === 'fail' && g.severity !== 'block')) {
          report.push(`  没过的 ${v.id}：${v.say}`);
        }
        report.push('  要么样板项目还缺东西，要么这条判据判错了');
      }
      if (r.counts.askNow > 0) {
        ok = false;
        report.push(`good/ 还剩 ${r.counts.askNow} 条要人确认。样板项目要把这些预置在 fixtures/good/.webuddy/records.jsonl 里，不然自测每次都停在这儿`);
        for (const v of (r.gates || []).filter((g) => g.r === 'ask')) {
          report.push(`  等确认的 ${v.id}：${v.say}`);
        }
      }
    }

    // ---- broken/：红的必须正好是点名的那几条 ----
    const brokenSrc = path.join(fixturesDir, 'broken');
    if (!fs.existsSync(brokenSrc)) {
      ok = false;
      report.push('缺 fixtures/broken/：需要一个"故意留了错"的样板项目，用来证明这个包真的查得出问题');
    } else {
      const expectedPath = path.join(brokenSrc, 'expected.json');
      if (!fs.existsSync(expectedPath)) {
        ok = false;
        report.push('fixtures/broken/ 少了 expected.json。里面写清该红哪几条，格式：{"mustFail":["1.2","3.1"]}');
      } else {
        let expected = null;
        try {
          expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));
        } catch (e) {
          ok = false;
          report.push(`fixtures/broken/expected.json 不是合法的 JSON（${e.message}）`);
        }

        if (expected) {
          const must = new Set(Array.isArray(expected.mustFail) ? expected.mustFail : []);
          if (must.size === 0) {
            ok = false;
            report.push('fixtures/broken/expected.json 的 mustFail 是空的。空清单等于什么都不验，把该红的门禁号列出来');
          }

          const brokenDir = path.join(work, 'broken');
          copyDir(brokenSrc, brokenDir);
          const r = evaluate(brokenDir, pack);
          const actual = new Set((r.gates || []).filter((g) => g.r === 'fail').map((g) => g.id));

          const missed = setDiff(must, actual);
          const extra = setDiff(actual, must);

          if (missed.length === 0 && extra.length === 0) {
            report.push(`broken/ 通过：该红的 ${must.size} 条正好全红，没多也没少`);
          } else {
            ok = false;
            if (missed.length) {
              report.push(`broken/ 漏报 ${missed.length} 条：${missed.join('、')} 本该判不通过，实际没红`);
            }
            if (extra.length) {
              report.push(`broken/ 误报 ${extra.length} 条：${extra.join('、')} 不在该红的名单里，却判了不通过`);
              report.push('  误报比漏报更要紧：包老是报错，人很快就不看它说什么了');
            }
          }
        }
      }
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }

  return { ok, report };
}
