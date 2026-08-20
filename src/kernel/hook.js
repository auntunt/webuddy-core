/**
 * hook 接收端：Claude Code / Codex 把事件从 stdin 喂进来，这里归一化成一行痕迹。
 *
 * 三条铁的约束，因为这段代码跑在别人的 agent 里：
 *   1. 永远退出 0。hook 非 0 退出会让 agent 那一步显示失败，
 *      人会以为是自己代码坏了，然后来查一个根本不存在的 bug。
 *   2. 不联网、不重扫、不算判定。只追加一行就走，几毫秒。
 *   3. 认不出格式就静默退出。各家 hook 的 payload 结构会变，
 *      变了应该是少记一条，不是每次动手都报一个错。
 */

import fs from 'node:fs';
import path from 'node:path';
import { appendEvent } from './events.js';

/** 读 stdin，最多等 2 秒。hook 是同步阻塞 agent 的，不能在这儿卡住。 */
export function readStdin({ fd = 0, max = 1024 * 512 } = {}) {
  try {
    const buf = fs.readFileSync(fd);
    return buf.slice(0, max).toString('utf8');
  } catch {
    return '';
  }
}

/**
 * 只认自己的标志物 .webuddy/ —— 一个登记过的项目一定有它（webuddy init 建的）。
 * 这一条跟行业无关，所以可以写在内核里。
 */
const OWN_MARK = '.webuddy';

/**
 * 定位这次事件属于哪个项目。
 *
 * 顺序是：cwd 自己有 .webuddy/（或调用方额外给的标志物）> 放弃。
 * 最后一档很重要：认不出来就什么都不写，
 * 否则在随便一个临时目录动手就会撒下一个 .webuddy/，用户迟早在某个目录里发现它然后不信任这个工具。
 *
 * 为什么只认 .webuddy/：这里原来还认 package.json / pyproject.toml / go.mod / Cargo.toml，
 * 那是四个软件生态的工程文件名，内核不该认识它们（换成施工安全包时一个都不会出现）。
 * 而 hook 跑的时候还没加载任何包，读不到 pack.hints——鸡生蛋的问题。
 * 解法是把判断收窄到"我们自己留下的记号"：没 init 过的目录本来就不该被写入。
 * 别的标志物由调用方按需传（marks），比如 CLI 已知当前包时可以把 pack.hints.rootMarks 传进来。
 *
 * @param {string} cwd
 * @param {object} opts - {marks: string[]} 额外的标志物文件名，来自包
 */
export function resolveProjectDir(cwd, { marks = [] } = {}) {
  if (!cwd) return null;
  let abs;
  try { abs = fs.realpathSync(path.resolve(cwd)); } catch { return null; }

  const looksRoot = [OWN_MARK, ...marks].some((n) => n && fs.existsSync(path.join(abs, n)));
  return looksRoot ? abs : null;
}

/** 各家的工具名 → 我们的四种事件。认不出的归 other。 */
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'apply_patch', 'edit_file', 'str_replace_editor']);
const RUN_TOOLS = new Set(['Bash', 'BashOutput', 'shell', 'run_command', 'local_shell_call', 'exec_command']);

/**
 * 把一坨 payload 归一化。
 *
 * 各家字段名不一样，而且还在变，所以每个字段都按"几个候选位置里哪个有就用哪个"来取，
 * 取不到就留空。这里宁可字段少，也不要猜——猜出来的退出码会变成假绿灯。
 */
export function normalize(payload, { agent = '' } = {}) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const ti = p.tool_input || p.toolInput || p.input || p.arguments || {};
  const tr = p.tool_response || p.toolResult || p.result || p.output || {};
  const tool = p.tool_name || p.toolName || p.tool || p.name || '';
  const hookEvent = p.hook_event_name || p.hookEventName || p.event || p.type || '';

  const cwd = p.cwd || p.workdir || p.working_directory || ti.cwd || process.cwd();
  const session = p.session_id || p.sessionId || p.conversation_id || '';
  const who = agent || p.agent || (p.transcript_path ? 'claude-code' : '') || '';

  let kind = 'other';
  if (EDIT_TOOLS.has(tool)) kind = 'edit';
  else if (RUN_TOOLS.has(tool)) kind = 'run';
  else if (/^(Stop|SessionEnd|session_end|turn_end)$/i.test(hookEvent)) kind = 'stop';
  else if (/^(SessionStart|session_start|UserPromptSubmit)$/i.test(hookEvent)) kind = 'start';

  const file = ti.file_path || ti.path || ti.filePath || ti.notebook_path || '';
  const cmd = ti.command || ti.cmd || ti.script || '';

  // 退出码要能是 0，所以不能用 || 兜底。0 恰恰是最有价值的那个值。
  const exitRaw = [tr.exit_code, tr.exitCode, tr.status, tr.code, p.exit_code]
    .find((v) => Number.isInteger(v));
  const exit = Number.isInteger(exitRaw) ? exitRaw : undefined;

  return {
    kind,
    cwd,
    session,
    agent: who,
    at: new Date().toISOString(),
    file: file ? path.basename(String(file)) : '',
    // 命令可能很长，也可能带密钥（curl -H Authorization…）。只留前 200 字符，
    // 判定只需要认出这是不是测试命令，不需要完整还原它。
    cmd: cmd ? String(cmd).slice(0, 200) : '',
    exit,
  };
}

/**
 * hook 主流程。返回 {written, dir, kind} 供测试断言，真实调用一律忽略返回值。
 */
export function handleHook(rawText, { agent = '', marks = [] } = {}) {
  let payload = null;
  try { payload = JSON.parse(rawText); } catch { return { written: false, why: 'stdin 不是 JSON' }; }

  const ev = normalize(payload, { agent });
  const dir = resolveProjectDir(ev.cwd, { marks });
  if (!dir) return { written: false, why: '认不出是哪个项目' };

  const ok = appendEvent(dir, ev);
  return { written: ok, dir, kind: ev.kind };
}
