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
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileSkill } from './skill-compile.js';
import { parseProbe } from './probe-dsl.js';
import { statePath, loadState, saveState } from './state.js';

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

  const skillText = fs.readFileSync(skillPath, 'utf8');
  const { stages, gates, errors: skillErrors } = compileSkill(skillText);
  errors.push(...skillErrors);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // 3. 解析 probes.md
  const probes = new Map();
  const probesPath = path.join(packDir, 'probes.md');
  if (fs.existsSync(probesPath)) {
    const probesText = fs.readFileSync(probesPath, 'utf8');
    const probesSections = parseSections(probesText);
    for (const [gateId, expr] of Object.entries(probesSections)) {
      const result = parseProbe(expr);
      if (!result.ok) {
        errors.push(`门禁 ${gateId} 的探测表达式有误: ${result.why}`);
      } else {
        probes.set(gateId, result.ast);
      }
    }
  }

  // 4. 解析 prompts.md
  const prompts = new Map();
  const promptsPath = path.join(packDir, 'prompts.md');
  if (fs.existsSync(promptsPath)) {
    const promptsText = fs.readFileSync(promptsPath, 'utf8');
    const promptsSections = parseSections(promptsText);
    for (const [gateId, content] of Object.entries(promptsSections)) {
      const prompt = parsePromptSection(gateId, content);
      if (prompt) prompts.set(gateId, prompt);
    }
  }

  // 5. 加载 glossary.json
  let glossary = {};
  const glossaryPath = path.join(packDir, 'glossary.json');
  if (fs.existsSync(glossaryPath)) {
    try {
      glossary = JSON.parse(fs.readFileSync(glossaryPath, 'utf8'));
    } catch (e) {
      errors.push(`glossary.json 格式错误: ${e.message}`);
    }
  }

  // 6. 加载 native-rules.js (如果有)
  let nativeRules = null;
  const nativePath = path.join(packDir, 'native-rules.js');
  if (fs.existsSync(nativePath)) {
    if (!meta.native) {
      errors.push('pack.json 声明 native:false 但存在 native-rules.js');
    } else {
      try {
        const fileUrl = pathToFileURL(nativePath).href;
        const mod = await import(fileUrl);
        nativeRules = mod.default || mod.RULES || mod;
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

  // 8. 合并提问组（prompts.md 整组覆盖缺省）
  const finalPrompts = [];
  for (const g of gates) {
    if (g.mode === 'human') {
      const customPrompt = prompts.get(g.id);
      const prompt = customPrompt || g.defaultPrompt;
      if (prompt) finalPrompts.push(prompt);
    }
  }

  // 9. 构建最终 pack 对象并深冻结
  const pack = Object.freeze({
    meta: Object.freeze({ ...meta }),
    stages: Object.freeze(stages.map((s) => Object.freeze({ ...s }))),
    gates: Object.freeze(gates.map((g) => Object.freeze({ ...g }))),
    probes: Object.freeze(probes),
    prompts: Object.freeze(finalPrompts.map((p) => Object.freeze({ ...p }))),
    glossary: Object.freeze({ ...glossary }),
    lexicons: Object.freeze({ ...lexicons }),
    hints: Object.freeze({ ...meta.hints }),
    nativeRules: nativeRules ? Object.freeze(nativeRules) : null,
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
export function resolvePack(nameOrDir) {
  // 1. 如果是绝对路径或相对路径
  if (nameOrDir.includes('/') || nameOrDir.includes('\\')) {
    const abs = path.resolve(nameOrDir);
    if (fs.existsSync(path.join(abs, 'pack.json'))) {
      return abs;
    }
    return null;
  }

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
 * 挂载包到项目。
 *
 * @param {string} projectDir - 项目目录
 * @param {string} packRef - 包名或路径
 * @returns {object} {ok, packName?, error?}
 */
export async function mountPack(projectDir, packRef) {
  const packDir = resolvePack(packRef);
  if (!packDir) {
    return { ok: false, error: `找不到担架包: ${packRef}` };
  }

  const result = await loadPack(packDir);
  if (!result.ok) {
    return { ok: false, error: `加载担架包失败:\n${result.errors.join('\n')}` };
  }

  const state = loadState(projectDir) || {};
  state.pack = {
    name: result.pack.meta.name,
    version: result.pack.meta.version,
    dir: packDir,
  };
  saveState(projectDir, state);

  return { ok: true, packName: result.pack.meta.name };
}

/**
 * 运行包的 fixtures 测试（实装在 P2，依赖 evaluate）。
 *
 * @param {string} packDir - 包目录路径
 * @returns {object} {ok, results?, errors?}
 */
export function runPackFixtures(packDir) {
  // P2 实装占位
  return { ok: false, errors: ['runPackFixtures 在 P2 实装'] };
}
