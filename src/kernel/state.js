import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 项目状态目录统一管理
// 禁止在其他文件手拼 .webuddy/ 路径

/**
 * 获取 .webuddy 子路径的绝对路径
 * @param {string} dir - 项目目录
 * @param {...string} segs - 路径段
 * @returns {string} 绝对路径
 */
export function statePath(dir, ...segs) {
  return path.join(dir, '.webuddy', ...segs);
}

/**
 * 这个目录是不是某个担架包自带的示例项目（I1a）。
 *
 * 判据：绝对路径里存在某个祖先目录名叫 fixtures，且这个 fixtures 的上级
 * （包目录本身）或上上级里放着 pack.json —— 例如
 * packs/software-engineering/fixtures/broken，其 fixtures 的上级
 * packs/software-engineering 下有 pack.json。
 *
 * 为什么要认它：这些目录是被 git 跟踪的素材，对它们跑一次 check 就往
 * fixtures/*​/.webuddy/records.jsonl 里追加一条巡检记录，仓库当场变脏；
 * 而示例项目的存在意义是"每次查都得到同一个结论"，留痕对它没有价值。
 *
 * @param {string} dir - 项目目录（相对路径也认，内部会转绝对）
 * @returns {boolean}
 */
export function isPackFixture(dir) {
  let cur = path.resolve(dir);
  while (true) {
    const parent = path.dirname(cur);
    if (parent === cur) return false;
    if (path.basename(cur) === 'fixtures') {
      // 上级 = 包目录（真实布局）；上上级 = 任务书字面写法。两处都认，认岔不会漏。
      if (fs.existsSync(path.join(parent, 'pack.json'))) return true;
      const grand = path.dirname(parent);
      if (grand !== parent && fs.existsSync(path.join(grand, 'pack.json'))) return true;
    }
    cur = parent;
  }
}

/**
 * 确保 .webuddy 目录存在
 */
function ensureStateDir(dir) {
  const stateDir = statePath(dir);
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }
  // 确保子目录
  const subdirs = ['rounds', 'evidence', 'proposals'];
  for (const sub of subdirs) {
    const subDir = statePath(dir, sub);
    if (!fs.existsSync(subDir)) {
      fs.mkdirSync(subDir, { recursive: true });
    }
  }
}

/**
 * 加载项目状态
 * @param {string} dir - 项目目录
 * @returns {object|null} state.json 内容,不存在返回 null
 */
export function loadState(dir) {
  ensureStateDir(dir);
  const statePath_ = statePath(dir, 'state.json');
  if (!fs.existsSync(statePath_)) {
    return null;
  }
  try {
    const content = fs.readFileSync(statePath_, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    throw new Error(`读取 state.json 失败: ${err.message}`);
  }
}

/**
 * 保存项目状态(支持部分更新)
 * @param {string} dir - 项目目录
 * @param {object} patch - 要更新的字段
 */
export function saveState(dir, patch) {
  ensureStateDir(dir);
  const statePath_ = statePath(dir, 'state.json');

  let current = {};
  if (fs.existsSync(statePath_)) {
    try {
      current = JSON.parse(fs.readFileSync(statePath_, 'utf8'));
    } catch (err) {
      // 文件损坏,从头开始
    }
  }

  const updated = { ...current, ...patch };

  // 原子写:临时文件 + rename
  const tmpPath = statePath_ + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(updated, null, 2), 'utf8');
  fs.renameSync(tmpPath, statePath_);
}

/**
 * 读取当前骨架版本
 * @param {string} dir - 项目目录
 * @returns {number} instanceVersion,缺失视为 0
 */
export function getInstanceVersion(dir) {
  const skelPath = statePath(dir, 'skeleton.json');
  if (!fs.existsSync(skelPath)) {
    return 0;
  }
  try {
    const skel = JSON.parse(fs.readFileSync(skelPath, 'utf8'));
    return skel.instanceVersion || 0;
  } catch (err) {
    return 0;
  }
}

/** 巡检快照最多留多少条（I1c）。到顶之后每写一条就丢掉最旧的一条。 */
const EVALUATE_KEEP = 200;

/**
 * 把 records.jsonl 里最旧的 evaluate 记录削到只剩 keep-1 条，给新的那条腾位置。
 * 其余 kind 一条不动、相对顺序不变。
 *
 * 原子性：先写同目录下的临时文件再 rename —— 同一文件系统内 rename 是原子的，
 * 中途断电要么是旧文件要么是新文件，不会出现写了一半的 JSONL。
 */
function rotateEvaluates(recordsPath, keep) {
  if (!fs.existsSync(recordsPath)) return;

  const lines = fs.readFileSync(recordsPath, 'utf8').split('\n').filter((l) => l.trim());

  const evalAt = [];
  for (let i = 0; i < lines.length; i++) {
    let kind = null;
    try { kind = JSON.parse(lines[i]).kind; } catch { kind = null; }
    // 读不动的行不算 evaluate，也不删 —— 看不懂的东西更不该被悄悄扔掉。
    if (kind === 'evaluate') evalAt.push(i);
  }
  if (evalAt.length < keep) return;

  const drop = new Set(evalAt.slice(0, evalAt.length - (keep - 1)));
  const kept = lines.filter((_, i) => !drop.has(i));

  const tmp = `${recordsPath}.rotating-${process.pid}`;
  fs.writeFileSync(tmp, kept.length ? `${kept.join('\n')}\n` : '', 'utf8');
  fs.renameSync(tmp, recordsPath);
}

/**
 * 追加一条记录到 records.jsonl
 * @param {string} dir - 项目目录
 * @param {object} record - 记录对象(不含 ts 和 instanceVersion)
 */
export function appendRecord(dir, record) {
  ensureStateDir(dir);
  const recordsPath = statePath(dir, 'records.jsonl');

  // 巡检快照（kind:'evaluate'）是每查一次追一条，长期用没有上限。
  // 只有它可以滚动：别的 kind 记的是"谁在哪天确认了什么、改了什么",
  // 那是产品本身，删一条就再也说不清当时发生过什么。
  if (record && record.kind === 'evaluate') {
    rotateEvaluates(recordsPath, EVALUATE_KEEP);
  }

  const fullRecord = {
    ts: new Date().toISOString(),
    instanceVersion: getInstanceVersion(dir),
    ...record
  };

  const line = JSON.stringify(fullRecord) + '\n';
  fs.appendFileSync(recordsPath, line, 'utf8');
}

/**
 * 读取 records.jsonl,支持过滤
 * @param {string} dir - 项目目录
 * @param {object} options - 过滤选项 {kind?, gateId?}
 * @returns {Array<object>} 记录数组,按时间顺序
 */
export function readRecords(dir, options = {}) {
  const recordsPath = statePath(dir, 'records.jsonl');
  if (!fs.existsSync(recordsPath)) {
    return [];
  }

  const content = fs.readFileSync(recordsPath, 'utf8');
  const lines = content.split('\n').filter(l => l.trim());

  const records = [];
  for (const line of lines) {
    try {
      const record = JSON.parse(line);

      // 过滤
      if (options.kind && record.kind !== options.kind) continue;
      if (options.gateId && record.gateId !== options.gateId) continue;

      records.push(record);
    } catch (err) {
      // 跳过损坏行
    }
  }

  return records;
}

/**
 * 获取指定门禁的最近一次 human-confirm 记录
 * @param {string} dir - 项目目录
 * @param {string} gateId - 门禁 ID
 * @returns {object|null} 最近的确认记录,无则返回 null
 */
export function getLatestHumanConfirm(dir, gateId) {
  const records = readRecords(dir, { kind: 'human-confirm', gateId });
  if (records.length === 0) return null;
  // 返回最后一条
  return records[records.length - 1];
}
