/**
 * 多项目注册表（§14.3 的 /v1/projects 背后）。
 *
 * 一个人同时带三四个项目是常态，
 * 而"哪个项目现在卡住了"这个问题人自己答不上来——
 * 因为卡住的那个恰恰是你最近没打开的那个。
 *
 * 注册表只存路径和别名，不存进度。进度每次现算：
 * 项目目录随时被助手改动，缓存的进度一定是错的。
 *
 * 从 ref/webuddy-console/src/registry.js 移植，改了两处：
 * 1. 进度用内核的 evaluate + buildVerdict（§5.4 形状），不是 ref 的 detect/evaluate；
 * 2. 用哪套清单从项目 state 里读（ref 只有一套写死的软件工程清单）。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { evaluate } from './evaluate.js';
import { buildVerdict } from './verdict.js';
import { loadPack, resolvePack } from './pack.js';
import { loadSkeleton } from './recompile.js';
// 项目内的 .webuddy/ 路径一律经 statePath 拼（铁律）。
// 注册表自己那份在 ~/.webuddy/ 下，不是项目状态，所以不走它。
import { statePath } from './state.js';

const HOME = os.homedir();
export const CONFIG_DIR = path.join(HOME, '.webuddy');
export const REGISTRY_FILE = path.join(CONFIG_DIR, 'projects.json');

function ensureDir() {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

export function loadRegistry() {
  try {
    const data = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
    if (!Array.isArray(data.projects)) return { projects: [] };
    return data;
  } catch {
    // 读不出来就当空的：注册表坏了不该让人连看板都打不开
    return { projects: [] };
  }
}

export function saveRegistry(reg) {
  ensureDir();
  const tmp = `${REGISTRY_FILE}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(reg, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, REGISTRY_FILE);
}

/** 加一个项目。同一个目录只登记一次，重复加只更新别名。 */
export function addProject(dir, alias) {
  const abs = path.resolve(dir);
  if (!fs.existsSync(abs)) {
    return { ok: false, why: `找不到 ${abs} 这个目录` };
  }
  const reg = loadRegistry();
  const found = reg.projects.find((p) => p.dir === abs);
  if (found) {
    if (alias && alias !== found.alias) {
      found.alias = alias;
      saveRegistry(reg);
    }
    return { ok: true, project: found, created: false };
  }
  const project = {
    id: `p${Date.now().toString(36)}`,
    alias: alias || path.basename(abs),
    dir: abs,
    addedAt: new Date().toISOString().slice(0, 10),
  };
  reg.projects.push(project);
  saveRegistry(reg);
  return { ok: true, project, created: true };
}

export function removeProject(key) {
  const reg = loadRegistry();
  const before = reg.projects.length;
  const abs = key ? path.resolve(key) : '';
  reg.projects = reg.projects.filter((p) => p.id !== key && p.alias !== key && p.dir !== abs);
  saveRegistry(reg);
  return before - reg.projects.length;
}

export function findProject(key) {
  if (!key) return null;
  const reg = loadRegistry();
  const abs = path.resolve(key);
  return reg.projects.find((p) => p.id === key || p.alias === key || p.dir === abs) || null;
}

/**
 * 扫一个项目，返回卡片要的四样 + 完整结论。
 *
 * 每次现算，不缓存：项目目录随时被助手改，缓存的进度一定是错的。
 * 出任何岔子都返回一行能显示的东西（error 字段），不抛——
 * 一个项目坏了不该让整张列表打不开。
 */
export async function scanProject(project, { evaluateFn = evaluate } = {}) {
  const base = { id: project.id, alias: project.alias, dir: project.dir };
  if (!fs.existsSync(project.dir)) {
    return { ...base, error: '这个项目的文件夹已经不在了' };
  }
  try {
    const packDir = resolvePack(null, project.dir);
    if (!packDir) {
      return { ...base, error: '这个项目还没挂上检查清单' };
    }
    const loaded = await loadPack(packDir);
    if (!loaded.ok) {
      return { ...base, error: '这个项目用的检查清单本身有问题' };
    }
    const pack = loaded.pack;
    // 判定函数可换：serve 那边传一个带 3 秒缓存的（§14.2 的轻刷新），
    // 缺省就是纯的 evaluate，命令行和测试走这条。
    const ev = evaluateFn(project.dir, pack);
    const verdict = buildVerdict(ev, pack);
    const stages = pack.stages || [];
    const cur = stages.find((s) => s.id === ev.currentStage) || null;
    const skel = loadSkeleton(project.dir);

    return {
      ...base,
      verdict,
      stage: {
        current: ev.currentStage,
        name: cur?.name || '',
        oneLiner: cur?.oneLiner || '',
        total: stages.length,
      },
      // 提案有没有待处理的，决定项目页的建议区出不出现
      pendingProposals: countPending(project.dir),
      instanceVersion: skel?.instanceVersion ?? 0,
    };
  } catch (e) {
    return { ...base, error: `这个项目查不动：${e.message}` };
  }
}

function countPending(dir) {
  try {
    const d = statePath(dir, 'proposals');
    if (!fs.existsSync(d)) return 0;
    let n = 0;
    for (const f of fs.readdirSync(d)) {
      if (!f.endsWith('.json')) continue;
      try {
        const p = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
        if (p.status === 'pending') n += 1;
      } catch {
        // 坏文件不算待处理
      }
    }
    return n;
  } catch {
    return 0;
  }
}

/**
 * 该管哪个排前面。
 *
 * 排序依据不是进度而是紧急度：顺序反了 > 有必须先做的事 > 有还没做到的 > 其它。
 * 进度最靠后的项目不一定最该管——这是 ref 里踩明白的：
 * 按进度排，永远是那个快完工的项目占着第一屏，而真出事的是被忘了两周的那个。
 */
function urgency(row) {
  if (row.error) return 100;
  const v = row.verdict;
  let u = 0;
  const gap = v.inversion?.gap ?? 0;
  if (gap >= 2) u += 40;
  else if (gap >= 1) u += 20;
  if (v.blockers.length > 0) u += 25;
  if (v.warnings.some((w) => w.severity === 'high')) u += 20;
  if (v.counts.failNow > 0) u += Math.min(15, v.counts.failNow);
  if (v.warnings.some((w) => w.kind === 'stalled')) u += 8;
  if (v.humanPending.length > 0) u += 5;
  return u;
}

/** 扫全部项目，按该管哪个排序。 */
export async function scanAll(opts = {}) {
  const reg = loadRegistry();
  const rows = [];
  for (const p of reg.projects) {
    const row = await scanProject(p, opts);
    rows.push({ ...row, urgency: urgency(row) });
  }
  return rows.sort((a, b) => b.urgency - a.urgency || a.alias.localeCompare(b.alias));
}
