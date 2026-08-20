/**
 * 本包自己的事实装配（原 ref detect.js 的职责）。
 *
 * 为什么在包里而不在内核里：eng/art 这两坨事实全是行业专有的——
 * 「场景卡有没有六栏」「有没有部署脚本」这类问题只有软件工程包问得出来。
 * 内核只给 ctx（dir / art(rel) / lexicons / hints / round / gateId），
 * 包想要更多事实自己去扫，扫出来的形状内核一个字都不认识。
 *
 * 判定函数吃的 f 就是这里产出的：{dir, name, scannedAt, eng, art, local, agent}，
 * 与 ref rules.js 逐字段同名——移植 92 条判据时才不用逐条改写取值路径。
 */

import fs from 'node:fs';
import path from 'node:path';
import { probeEngineering } from './probe-engineering.js';
import { probeArtifacts } from './probe-artifacts.js';
import { readEvents, summarizeEvents } from './events.js';
import { readIfExists } from './parse.js';

/** 一次判定内只装配一次：92 条判据共用同一份事实，重复扫盘没有意义。 */
const cache = new WeakMap();

/**
 * 人工确认只认一处：records.jsonl 里的 human-confirm 条目。
 *
 * 状态文件里那份旧的确认表不读。同一件事有两个存法，迟早会出现两边不一致
 * 而谁也说不清该信哪份的局面；确认是一件"什么时候、谁、凭什么"的事，
 * 只能记在带时间戳、只追加的流水里。
 *
 * 注意：需要人看的那类门禁根本走不到这里（内核先返回了），
 * 这里只服务自动判据里"实在探测不出来就问人"的兜底路径。
 */
function loadHumanChecks(projectDir) {
  const out = {};

  const lines = readIfExists(path.join(projectDir, '.webuddy', 'records.jsonl'));
  if (lines) {
    for (const line of lines.split('\n')) {
      if (!line.trim()) continue;
      let r;
      try {
        r = JSON.parse(line);
      } catch {
        continue; // 坏行跳过：一行坏了不该让整份记录作废
      }
      if (r.kind !== 'human-confirm' || !r.gateId) continue;
      // 同一条门禁确认多次时后一次覆盖前一次：人改主意以后一次为准，
      // 不是历史上确认过就永久算过。
      out[r.gateId] = {
        result: r.result === 'pass' ? '通过' : r.result === 'fix' ? '待改' : '不通过',
        date: typeof r.ts === 'string' ? r.ts.slice(0, 10) : '',
        by: r.by || '你',
        how: r.note || '',
      };
    }
  }

  return out;
}

/**
 * 读项目本地状态里判据要用的部分。
 *
 * mode / naGates 不在这里读：档位归内核的 severity.js，需求裁剪归 skeleton.json。
 * 判据函数不该看见这两样——它只回答"过没过"，不回答"该不该拦"。
 */
function loadLocal(projectDir) {
  const humanChecks = loadHumanChecks(projectDir);
  const raw = readIfExists(path.join(projectDir, '.webuddy', 'state.json'));
  const empty = {
    humanChecks,
    answers: {},
    notes: {},
    acknowledgedWarns: {},
    premises: null,
    projectDescription: '',
  };
  if (!raw) return empty;
  try {
    const s = JSON.parse(raw);
    return {
      humanChecks,
      answers: s.answers || {},
      notes: s.notes || {},
      acknowledgedWarns: s.acknowledgedWarns || {},
      // 只认数组。写成别的都回落到 null，也就是「不知道，全问」。
      premises: Array.isArray(s.premises) ? s.premises : null,
      projectDescription: s.projectDescription || '',
    };
  } catch {
    return empty;
  }
}

/**
 * 装配事实集。
 *
 * @param {object} ctx - 内核给的 ctx（§4.3）
 * @returns {object} f = {dir, name, scannedAt, eng, art, local, agent}
 */
export function buildFacts(ctx) {
  if (cache.has(ctx)) return cache.get(ctx);

  const abs = path.resolve(ctx.dir);
  if (!fs.existsSync(abs)) throw new Error(`项目目录不存在：${abs}`);

  const f = {
    dir: abs,
    name: path.basename(abs),
    scannedAt: new Date().toISOString(),
    eng: probeEngineering(abs),
    art: probeArtifacts(abs),
    local: loadLocal(abs),
    // agent 痕迹读不到就是空的——少一类痕迹只会让判定回落到原来的样子，不会算错。
    agent: summarizeEvents(readEvents(abs)),
  };

  cache.set(ctx, f);
  return f;
}
