/**
 * Agent 事件流水：Claude Code / Codex 的 hook 往这里追加一行，探测器把它当痕迹读。
 *
 * 为什么只记"痕迹"不记"结论"：
 * agent 说"需求写完了"不能让第 1 步打钩——那等于把工具变成 agent 乐观情绪的放大器。
 * 所以这里只收四种谁都能复核的事实：什么时候、动了哪个文件、跑了什么命令、退出码几。
 * 判定依旧由 rules 从产物和退出码里算，规则一条都不用改。
 *
 * 为什么是文件不是接口：
 * hook 触发的时候 webuddy 可能没在跑。追加一行文件谁都能做，
 * 要起个服务才能记录的东西，第一次忘开就断了。
 */

import fs from 'node:fs';
import path from 'node:path';

export const EVENTS_FILE = 'events.jsonl';

/** 只留这些字段。多余的键一律丢掉——日志会长期追加，存不认识的东西迟早变成垃圾场。 */
const KEEP = ['at', 'kind', 'file', 'cmd', 'exit', 'agent', 'session'];

/** 认得的事件种类。不在表里的记成 other，不丢弃（宁可多一条不认识的，也别悄悄吞掉）。 */
export const KINDS = new Set(['edit', 'run', 'stop', 'start', 'other']);

function eventsPath(projectDir) {
  return path.join(projectDir, '.webuddy', EVENTS_FILE);
}

/**
 * 追加一条事件。
 *
 * 失败一律不抛：这是被 hook 调用的，写不进去最多少一条痕迹，
 * 但抛出去会让 agent 那一步显示失败，人会以为是自己的代码坏了。
 */
export function appendEvent(projectDir, ev) {
  try {
    const dir = path.join(projectDir, '.webuddy');
    fs.mkdirSync(dir, { recursive: true });
    const row = {};
    for (const k of KEEP) if (ev[k] !== undefined && ev[k] !== null && ev[k] !== '') row[k] = ev[k];
    row.at = row.at || new Date().toISOString();
    row.kind = KINDS.has(row.kind) ? row.kind : 'other';
    fs.appendFileSync(eventsPath(projectDir), `${JSON.stringify(row)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * 读事件流水，只保留最近的若干条。
 *
 * 有上限是因为这个文件只增不减，一个跑了半年的项目可能有几万行，
 * 而判定只关心"最近有没有跑过测试"这类问题，读全部纯属浪费。
 */
export function readEvents(projectDir, { limit = 800 } = {}) {
  let raw;
  try { raw = fs.readFileSync(eventsPath(projectDir), 'utf8'); } catch { return []; }
  const lines = raw.split('\n').filter(Boolean);
  const tail = lines.slice(-limit);
  const out = [];
  for (const l of tail) {
    try {
      const o = JSON.parse(l);
      if (o && typeof o === 'object' && o.at) out.push(o);
    } catch { /* 坏行跳过。半行写入是可能的，不该因此整个文件读不出来 */ }
  }
  return out;
}

/**
 * 把事件流水归纳成事实。返回的是"看得见的痕迹"，不含判断。
 *
 * lastTest 只在退出码为 0 时才算通过——没有退出码的记录一概不算，
 * 因为"跑过但不知道结果"和"跑过并且通过了"之间的差别，正是这条门禁的全部意义。
 *
 * 哪种命令算"跑测试"、哪种算"起服务"，由包声明（pack.hints 的 testCmd/startCmd）。
 * 内核原来把 `npm test|pytest|cargo test|mvn test` 这串写死在这里，
 * 那是软件生态的命令名；换成施工安全包时"跑一遍"根本不是敲命令。
 * 包没声明就一条都不认：漏认只是少一条痕迹，
 * 错认成"测试跑过了"是发假绿灯——宁可漏认不可错认。
 *
 * @param {object[]} events
 * @param {object} hints - pack.hints {testCmd, startCmd}
 */
export function summarizeEvents(events, hints = {}) {
  const testCmd = hints.testCmd ? new RegExp(hints.testCmd) : null;
  const startCmd = hints.startCmd ? new RegExp(hints.startCmd) : null;

  const runs = events.filter((e) => e.kind === 'run' && e.cmd);
  const testRuns = testCmd ? runs.filter((e) => testCmd.test(String(e.cmd))) : [];
  const startRuns = startCmd ? runs.filter((e) => startCmd.test(String(e.cmd))) : [];
  const withExit = (list) => list.filter((e) => Number.isInteger(e.exit));

  const lastOf = (list) => (list.length ? list[list.length - 1] : null);
  const lastTest = lastOf(withExit(testRuns));
  const lastStart = lastOf(withExit(startRuns));

  const edits = events.filter((e) => e.kind === 'edit' && e.file);
  const touched = [...new Set(edits.map((e) => e.file))];

  return {
    count: events.length,
    firstAt: events[0]?.at || null,
    lastAt: events[events.length - 1]?.at || null,
    agents: [...new Set(events.map((e) => e.agent).filter(Boolean))],
    sessions: [...new Set(events.map((e) => e.session).filter(Boolean))].length,
    editCount: edits.length,
    touchedFiles: touched,
    runCount: runs.length,
    testRunCount: testRuns.length,
    lastTest: lastTest ? { at: lastTest.at, cmd: lastTest.cmd, exit: lastTest.exit } : null,
    lastStart: lastStart ? { at: lastStart.at, cmd: lastStart.cmd, exit: lastStart.exit } : null,
  };
}
