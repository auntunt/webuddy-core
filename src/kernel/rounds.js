/**
 * 轮次与认领锁：会话级轮次管理 + 文件级并发控制。
 *
 * 与 ref round.js 的差异：
 * - 项目级 → 会话级(key = sessionId,多轮并存)
 * - 新增认领锁(claims.json)防止多会话改同一文件
 * - 快照与对比算法语义照抄 ref
 * - 各维度的识别正则改从 pack.hints 读(null = 跳过该维度)
 *
 * 适用边界：文件级认领锁只在多会话共享同一 checkout 时有效。
 * multica 场景下每个任务是隔离的 git worktree，.webuddy/ 不共享——
 * 认领锁不跨任务生效，但 round 快照/反作弊在单任务内仍完整有效。
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { statePath } from './state.js';
import { listFiles, fileExists, readArtifact } from './artifact-io.js';

const CLAIMS_FILE = 'claims.json';
const ROUNDS_DIR = 'rounds';
const CLAIM_TTL_MS = 24 * 60 * 60 * 1000; // 24小时

/** 工具自己写的东西不算改动 */
const OURS = /^\.webuddy\//;

function sha1(s) {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
}

/** 文件指纹 */
function fingerprint(dir, rel) {
  try {
    const content = fs.readFileSync(path.join(dir, rel), 'utf8');
    return sha1(content);
  } catch {
    return null;
  }
}

/**
 * 数测试文件里的用例和断言。
 * 数的是 test( / it( / describe( 和 assert( / expect( / should(
 */
function countCases(dir, rel) {
  try {
    const raw = fs.readFileSync(path.join(dir, rel), 'utf8');
    const cases = raw.match(/(^|[^\w.])(test|it|describe)\s*(\.\s*\w+\s*)?\(/g);
    const asserts = raw.match(/(^|[^\w.])(assert|expect|should)\s*(\.\s*\w+\s*)?\(/g);
    return { cases: cases ? cases.length : 0, asserts: asserts ? asserts.length : 0 };
  } catch {
    return null;
  }
}

/**
 * 拍快照：文件指纹 + 依赖清单 + 测试用例数。
 *
 * @param {string} dir - 项目目录
 * @param {object} hints - pack.hints {testFile, schemaFile}
 * @returns {object} {at, files, cases, deps}
 */
export function snapshot(dir, hints = {}) {
  const files = listFiles(dir, '.').filter((f) => !OURS.test(f));
  const prints = {};
  const cases = {};

  const testHint = hints.testFile ? new RegExp(hints.testFile) : null;

  for (const f of files) {
    const p = fingerprint(dir, f);
    if (p) prints[f] = p;
    if (p && testHint && testHint.test(f)) {
      cases[f] = countCases(dir, f);
    }
  }

  // 读取依赖
  const pkgPath = path.join(dir, 'package.json');
  let deps = [];
  try {
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      deps = Object.keys(allDeps).sort();
    }
  } catch {
    deps = [];
  }

  return {
    at: new Date().toISOString(),
    files: prints,
    cases,
    deps,
  };
}

/** 两张快照对比 */
function diffFiles(before, after) {
  const added = [];
  const changed = [];
  const removed = [];

  for (const f of Object.keys(after.files)) {
    if (!(f in before.files)) added.push(f);
    else if (before.files[f] !== after.files[f]) changed.push(f);
  }

  for (const f of Object.keys(before.files)) {
    if (!(f in after.files)) removed.push(f);
  }

  return {
    added: added.sort(),
    changed: changed.sort(),
    removed: removed.sort(),
  };
}

/** 申报范围匹配：支持整目录（结尾带 /）和精确文件名 */
function inScope(rel, declared) {
  return declared.some((d) => {
    const norm = d.replace(/^\.\//, '').trim();
    if (!norm) return false;
    if (norm.endsWith('/')) return rel === norm.slice(0, -1) || rel.startsWith(norm);
    return rel === norm;
  });
}

/**
 * 读取认领锁。
 *
 * @param {string} dir - 项目目录
 * @returns {object} {sessionId: {files, startedAt, label}}
 */
function loadClaims(dir) {
  const claimsPath = statePath(dir, CLAIMS_FILE);
  try {
    return JSON.parse(fs.readFileSync(claimsPath, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * 保存认领锁（原子写）。
 */
function saveClaims(dir, claims) {
  const claimsPath = statePath(dir, CLAIMS_FILE);
  const tmp = `${claimsPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(claims, null, 2), 'utf8');
  fs.renameSync(tmp, claimsPath);
}

/**
 * 认领文件。
 *
 * @param {string} dir - 项目目录
 * @param {string} sessionId - 会话 ID
 * @param {string[]} files - 要认领的文件列表
 * @returns {object} {ok, conflicts?, say?}
 */
export function claim(dir, sessionId, files) {
  const claims = loadClaims(dir);
  const now = Date.now();
  const conflicts = [];

  // 检查活跃认领
  for (const [sid, claim] of Object.entries(claims)) {
    if (sid === sessionId) continue;

    const age = now - new Date(claim.startedAt).getTime();
    const isActive = age < CLAIM_TTL_MS;

    if (isActive) {
      const overlap = files.filter((f) => claim.files.includes(f));
      if (overlap.length > 0) {
        for (const file of overlap) {
          conflicts.push({
            file,
            holder: sid,
            label: claim.label || sid,
          });
        }
      }
    }
  }

  if (conflicts.length > 0) {
    const fileList = conflicts.map((c) => c.file).join(', ');
    const holder = conflicts[0].label;
    return {
      ok: false,
      conflicts,
      say: `${fileList} ${holder}正在动，等它这一轮结束，或换别的文件`,
    };
  }

  // 写入认领
  claims[sessionId] = {
    files,
    startedAt: new Date().toISOString(),
    label: sessionId,
  };
  saveClaims(dir, claims);

  return { ok: true };
}

/**
 * 释放认领。
 */
function releaseClaim(dir, sessionId) {
  const claims = loadClaims(dir);
  delete claims[sessionId];
  saveClaims(dir, claims);
}

/**
 * 开始轮次。
 *
 * @param {string} dir - 项目目录
 * @param {string} sessionId - 会话 ID
 * @param {object} opts - {files, gateId, hints}
 * @returns {object} {ok, error?}
 */
export function startRound(dir, sessionId, { files = [], gateId = '', hints = {} } = {}) {
  // 先认领文件
  const claimResult = claim(dir, sessionId, files);
  if (!claimResult.ok) {
    return { ok: false, error: claimResult.say };
  }

  // 拍快照
  const snap = snapshot(dir, hints);

  const round = {
    sessionId,
    gateId,
    files,
    startedAt: new Date().toISOString(),
    snapshot: snap,
    endedAt: null,
    endSnapshot: null,
    violations: [],
  };

  // 保存轮次
  const roundPath = statePath(dir, ROUNDS_DIR, `${sessionId}.json`);
  const roundDir = path.dirname(roundPath);
  if (!fs.existsSync(roundDir)) {
    fs.mkdirSync(roundDir, { recursive: true });
  }
  fs.writeFileSync(roundPath, JSON.stringify(round, null, 2), 'utf8');

  return { ok: true, sessionId, fileCount: Object.keys(snap.files).length };
}

/**
 * 结束轮次。
 *
 * @param {string} dir - 项目目录
 * @param {string} sessionId - 会话 ID
 * @param {object} opts - {hints}
 * @returns {object} {ok, violations?, error?}
 */
export function endRound(dir, sessionId, { hints = {} } = {}) {
  const roundPath = statePath(dir, ROUNDS_DIR, `${sessionId}.json`);
  if (!fs.existsSync(roundPath)) {
    return { ok: false, error: `会话 ${sessionId} 没有开着的轮次` };
  }

  const round = JSON.parse(fs.readFileSync(roundPath, 'utf8'));
  if (round.endedAt) {
    return { ok: false, error: `会话 ${sessionId} 的轮次已经结束` };
  }

  // 拍结束快照
  const after = snapshot(dir, hints);
  const before = round.snapshot;
  const d = diffFiles(before, after);
  const touched = [...d.added, ...d.changed, ...d.removed];

  const violations = [];
  const testHint = hints.testFile ? new RegExp(hints.testFile) : null;
  const schemaHint = hints.schemaFile ? new RegExp(hints.schemaFile) : null;

  // 检测违规
  // 1. outOfDeclaredScope & driveByRefactor
  if (round.files.length > 0) {
    const outOfScope = touched.filter((f) => !inScope(f, round.files));
    if (outOfScope.length > 0) {
      violations.push({
        dim: 'files',
        kind: 'outOfDeclaredScope',
        say: `没认领的 ${outOfScope.join(', ')} 也被改了`,
      });
    }

    const driveBy = outOfScope.filter((f) =>
      !testHint?.test(f) && /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte|py|go|java|rb|php|rs|cs)$/.test(f)
    );
    if (driveBy.length > 0) {
      violations.push({
        dim: 'files',
        kind: 'driveByRefactor',
        say: `顺手改了没认领的 ${driveBy.join(', ')}`,
      });
    }
  }

  // 2. newDeps
  const beforeDeps = new Set(before.deps);
  const newDeps = after.deps.filter((x) => !beforeDeps.has(x));
  if (newDeps.length > 0) {
    violations.push({
      dim: 'deps',
      kind: 'newDeps',
      say: `新装了依赖: ${newDeps.join(', ')}`,
    });
  }

  // 3. schemaChanged
  if (schemaHint) {
    const schemaChanged = touched.filter((f) => schemaHint.test(f));
    if (schemaChanged.length > 0) {
      violations.push({
        dim: 'schema',
        kind: 'schemaChanged',
        say: `数据模型文件被改: ${schemaChanged.join(', ')}`,
      });
    }
  }

  // 4. testsTampered
  if (testHint) {
    const beforeCases = before.cases || {};
    const afterCases = after.cases || {};
    const shrank = (f) => {
      const b = beforeCases[f];
      const a = afterCases[f];
      if (!b || !a) return true;
      return a.cases < b.cases || a.asserts < b.asserts;
    };

    const testsTampered = [
      ...d.removed.filter((f) => testHint.test(f)),
      ...d.changed.filter((f) => testHint.test(f) && shrank(f)),
    ];

    if (testsTampered.length > 0) {
      const examples = testsTampered.slice(0, 2);
      const detail = examples.map((f) => {
        const b = beforeCases[f];
        const a = afterCases[f] || { cases: 0, asserts: 0 };
        if (d.removed.includes(f)) {
          return `${f} 被删除了`;
        }
        const caseDiff = b.cases - a.cases;
        const assertDiff = b.asserts - a.asserts;
        if (caseDiff > 0) {
          return `${f} 的用例从 ${b.cases} 条变成 ${a.cases} 条，少了 ${caseDiff} 条`;
        }
        if (assertDiff > 0) {
          return `${f} 的断言从 ${b.asserts} 条变成 ${a.asserts} 条，少了 ${assertDiff} 条`;
        }
        return `${f} 测试被改动`;
      }).join('；');

      violations.push({
        dim: 'tests',
        kind: 'testsTampered',
        say: detail,
      });
    }
  }

  // 更新轮次
  round.endedAt = after.at;
  round.endSnapshot = after;
  round.violations = violations;
  fs.writeFileSync(roundPath, JSON.stringify(round, null, 2), 'utf8');

  // 释放认领
  releaseClaim(dir, sessionId);

  return { ok: true, violations };
}

/**
 * 中止轮次。
 *
 * @param {string} dir - 项目目录
 * @param {string} sessionId - 会话 ID
 * @returns {object} {ok, error?}
 */
export function abortRound(dir, sessionId) {
  const roundPath = statePath(dir, ROUNDS_DIR, `${sessionId}.json`);
  if (!fs.existsSync(roundPath)) {
    return { ok: false, error: `会话 ${sessionId} 没有开着的轮次` };
  }

  const round = JSON.parse(fs.readFileSync(roundPath, 'utf8'));
  round.endedAt = new Date().toISOString();
  round.aborted = true;
  fs.writeFileSync(roundPath, JSON.stringify(round, null, 2), 'utf8');

  // 释放认领
  releaseClaim(dir, sessionId);

  return { ok: true };
}

/**
 * 轮次状态。
 *
 * @param {string} dir - 项目目录
 * @returns {object[]} 轮次列表
 */
export function roundStatus(dir) {
  const roundsDir = statePath(dir, ROUNDS_DIR);
  if (!fs.existsSync(roundsDir)) {
    return [];
  }

  const files = fs.readdirSync(roundsDir).filter((f) => f.endsWith('.json'));
  const rounds = [];

  for (const file of files) {
    try {
      const round = JSON.parse(fs.readFileSync(path.join(roundsDir, file), 'utf8'));
      rounds.push({
        sessionId: round.sessionId,
        gateId: round.gateId,
        files: round.files,
        startedAt: round.startedAt,
        endedAt: round.endedAt,
        aborted: round.aborted || false,
        violations: round.violations || [],
      });
    } catch {
      // 跳过损坏的文件
    }
  }

  return rounds;
}
