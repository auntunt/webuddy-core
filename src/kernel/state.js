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

/**
 * 追加一条记录到 records.jsonl
 * @param {string} dir - 项目目录
 * @param {object} record - 记录对象(不含 ts 和 instanceVersion)
 */
export function appendRecord(dir, record) {
  ensureStateDir(dir);
  const recordsPath = statePath(dir, 'records.jsonl');

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
