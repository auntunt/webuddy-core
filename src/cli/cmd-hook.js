/**
 * hook 命令 —— 装/查/跑「改动挂钩」。
 *
 * 用法（§I3a）:
 *   webuddy hook install [--project 目录] [--agent claude|codex] [--dry-run]
 *   webuddy hook status  [--project 目录] [--agent claude|codex] [--json]
 *   webuddy hook run     [--agent 名字]          # 由 agent 调起，人不该手敲
 *
 * 语义移植自 ref/webuddy-console/src/hook-install.js，键名逐字对齐：
 *   hooks.PostToolUse / hooks.Stop / hooks.SessionStart
 *   每个事件下是一组 { hooks: [ { type:'command', command:'…', timeout:5 } ] }
 *
 * 为什么装项目级的 .claude/settings.json 而不是用户全局的 ~/.claude/settings.json：
 * 照抄 ref 的裁量——全局那份是用户自己的，里面通常已经挂着别的东西，往里插一行
 * 出问题时他会先怀疑是所有项目都坏了；项目级只影响这一个目录，删掉就干净了。
 * 顺带的好处是：claude 这条路根本不碰 home，"别写坏用户真实 ~/.claude" 不是靠小心，
 * 是靠根本不去那儿。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { handleHook, readStdin } from '../kernel/hook.js';

/** 本仓库自己的 bin/webuddy.js 绝对路径。写进别人的配置里的就是它。 */
const SELF = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'bin',
  'webuddy.js',
);

/** 挂哪三个事件：改了什么、跑了什么、这一轮结束了。与 ref 的 HOOK_EVENTS 逐字一致。 */
const HOOK_EVENTS = ['PostToolUse', 'Stop', 'SessionStart'];

/**
 * home 目录从哪来：环境变量 WEBUDDY_HOOK_HOME 优先，否则 os.homedir()。
 *
 * 为什么非得是环境变量：测试是 execFile 真起一个进程来跑这条命令的（照 cmd-check
 * 的测法），子进程里既改不了它的 os.homedir()，也塞不进函数参数——能穿过进程边界
 * 的只有 argv 和 env，而 argv 这条路要往冻结的 bin/webuddy.js 里加开关，不许动。
 * 所以留 env 这一个口子：测试指到 mkdtemp 出来的临时家目录，真实使用不设它就是真 home。
 */
function homeDir() {
  return process.env.WEBUDDY_HOOK_HOME || os.homedir();
}

/** 报错三段式（§2.5 铁律 5）：出了什么事 → 可能因为什么 → 怎么办 */
function sayError({ what, why, how }) {
  console.error(`${what}\n可能是因为：${why}\n怎么办：${how}`);
}

/**
 * --agent 归一。对外只收两个词（claude / codex），对内落成两家自己认的名字。
 * claude 写成 claude-code 是因为内核 normalize() 认的就是这个值（见 kernel/hook.js）。
 */
function resolveAgent(raw) {
  const v = String(raw || 'claude').toLowerCase();
  if (v === 'claude' || v === 'claude-code') return { key: 'claude', name: 'claude-code', say: 'Claude Code' };
  if (v === 'codex') return { key: 'codex', name: 'codex', say: 'Codex' };
  return null;
}

/** 装进配置里的那行命令。 */
function hookCommand(agentName, self = SELF) {
  return `node ${JSON.stringify(self)} hook run --agent ${agentName}`;
}

/**
 * 是不是我们那条。认 webuddy.js + hook 两个词，不认完整路径——
 * 仓库搬过目录之后完整路径会变，但那条 hook 还是我们的，不该重复插一遍（ref 原话）。
 */
const isMine = (cmd) => String(cmd).includes('webuddy.js') && String(cmd).includes('hook');

// ── Claude Code：项目级 .claude/settings.json ──────────────────────────────

function claudeFile(projectDir) {
  return path.join(projectDir, '.claude', 'settings.json');
}

/** 读配置。不是合法 JSON 就抛——手写了一半的 settings.json 被覆盖掉是不可原谅的。 */
function readClaudeConf(file) {
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, 'utf8');
  let conf;
  try { conf = JSON.parse(raw); } catch {
    throw new Error(`${file} 不是合法 JSON`);
  }
  if (!conf || typeof conf !== 'object' || Array.isArray(conf)) {
    throw new Error(`${file} 的内容不是一个配置对象`);
  }
  return conf;
}

/**
 * 算出「该往 hooks 里补哪几个事件」。只算不写，装和 --dry-run 共用这一份，
 * 否则 --dry-run 打出来的和真写下去的迟早对不上，而那种错没人查得动。
 */
function planClaude(projectDir, agentName) {
  const file = claudeFile(projectDir);
  const conf = readClaudeConf(file);
  const hooks = (conf.hooks && typeof conf.hooks === 'object' && !Array.isArray(conf.hooks)) ? conf.hooks : {};
  const cmd = hookCommand(agentName);

  const added = [];
  const fragment = {};
  for (const ev of HOOK_EVENTS) {
    const list = Array.isArray(hooks[ev]) ? hooks[ev] : [];
    if (list.some((g) => (g?.hooks || []).some((h) => isMine(h?.command)))) continue;
    fragment[ev] = [{ hooks: [{ type: 'command', command: cmd, timeout: 5 }] }];
    added.push(ev);
  }
  return { file, conf, hooks, added, fragment, cmd };
}

/** 真写。只加不改：已经有的 hook 一条都不碰。 */
function writeClaude(plan) {
  const conf = plan.conf;
  conf.hooks = plan.hooks;
  for (const ev of plan.added) {
    const list = Array.isArray(conf.hooks[ev]) ? conf.hooks[ev] : [];
    list.push(plan.fragment[ev][0]);
    conf.hooks[ev] = list;
  }
  fs.mkdirSync(path.dirname(plan.file), { recursive: true });
  fs.writeFileSync(plan.file, `${JSON.stringify(conf, null, 2)}\n`, 'utf8');
}

/** 装了没有 + 装的那条还指得对不对。路径漂了要单独说，因为它看起来是装了、其实收不到。 */
function statusClaude(projectDir, agentName) {
  const file = claudeFile(projectDir);
  if (!fs.existsSync(file)) return { file, installed: false, events: [], stale: false, command: null };
  let conf;
  try { conf = readClaudeConf(file); } catch { return { file, installed: false, broken: true, events: [], stale: false, command: null }; }
  const hooks = conf.hooks || {};
  const events = [];
  let command = null;
  for (const ev of HOOK_EVENTS) {
    const list = Array.isArray(hooks[ev]) ? hooks[ev] : [];
    for (const g of list) {
      for (const h of (g?.hooks || [])) {
        if (!isMine(h?.command)) continue;
        events.push(ev);
        command = command || String(h.command);
      }
    }
  }
  const want = hookCommand(agentName);
  return {
    file,
    installed: events.length > 0,
    events,
    command,
    stale: Boolean(command) && !command.includes(JSON.stringify(SELF)),
    want,
  };
}

// ── Codex：~/.codex/config.toml ───────────────────────────────────────────

function codexFile() {
  return path.join(homeDir(), '.codex', 'config.toml');
}

/** Codex 只有一个 notify 位置可挂。数组形式，第一个元素是可执行文件。 */
function codexNotify(self = SELF) {
  return ['node', self, 'hook', 'run', '--agent', 'codex'];
}

function codexLine(self = SELF) {
  return `notify = ${JSON.stringify(codexNotify(self))}\n`;
}

/** 现成的 notify 行（不管是不是我们的）。TOML 只认顶层那一行，所以行级匹配够用。 */
function findCodexNotify(text) {
  const m = /^[ \t]*notify[ \t]*=.*$/m.exec(text || '');
  return m ? m[0] : null;
}

function statusCodex() {
  const file = codexFile();
  if (!fs.existsSync(file)) return { file, installed: false, foreign: false, line: null };
  const text = fs.readFileSync(file, 'utf8');
  const line = findCodexNotify(text);
  if (!line) return { file, installed: false, foreign: false, line: null };
  if (!isMine(line)) return { file, installed: false, foreign: true, line };
  return { file, installed: true, foreign: false, line, stale: !line.includes(SELF) };
}

// ── 三个子命令 ────────────────────────────────────────────────────────────

export async function run(positionals, flags) {
  const sub = positionals[0];

  // run 单独走，且它自己包死所有异常——见 cmdRun 顶上的三条铁约束。
  if (sub === 'run') return cmdRun(positionals, flags);

  const agent = resolveAgent(flags.agent);
  if (!agent) {
    sayError({
      what: `--agent 不认识 "${flags.agent}" 这个值。`,
      why: '目前只支持两个：claude（Claude Code）和 codex（Codex）。',
      how: '改成 --agent claude 或 --agent codex，不写就是 claude。',
    });
    process.exit(2);
  }

  if (sub === 'install') return cmdInstall(positionals, flags, agent);
  if (sub === 'status') return cmdStatus(positionals, flags, agent);

  sayError({
    what: sub ? `hook 没有 "${sub}" 这个用法。` : 'hook 后面得再跟一个词，说清是要装、要查、还是在收事件。',
    why: 'hook 只有三种用法：install（装上）、status（查装没装）、run（由 agent 自动调起，人不用敲）。',
    how: '想装就跑 webuddy hook install；想看装没装就跑 webuddy hook status。',
  });
  process.exit(1);
}

/**
 * hook run —— agent 把事件从 stdin 喂进来，这里转交内核记一行痕迹。
 *
 * 三条铁的约束，因为这段代码跑在别人的 agent 里（与 kernel/hook.js 同源）：
 *   1. 永远退出 0。hook 非 0 退出会让 agent 那一步显示失败，
 *      人会以为是自己代码坏了，然后去查一个根本不存在的 bug。
 *      所以这里把所有异常自己吞掉——漏出去会被 bin 最外层的 catch 接住并 exit 1。
 *   2. 不联网。只往本地文件追加一行就走，几毫秒。
 *   3. 认不出格式就静默退出，一个字都不打印。各家 payload 结构会变，
 *      变了应该是少记一条，不是每次动手都在 agent 面前弹一个错。
 */
async function cmdRun(positionals, flags) {
  try {
    // Codex 的 notify 不走 stdin，它把那坨 JSON 当命令行参数递过来。
    // stdin 空就退回去看第二个位置参数，两家用同一条命令就够了。
    const raw = readStdin() || positionals[1] || '';
    const r = handleHook(raw, { agent: flags.agent || '' });
    if (process.env.WEBUDDY_HOOK_DEBUG) process.stderr.write(`${JSON.stringify(r)}\n`);
  } catch (e) {
    if (process.env.WEBUDDY_HOOK_DEBUG) process.stderr.write(`hook 出错但已忽略：${e.message}\n`);
  }
  process.exit(0);
}

function cmdInstall(positionals, flags, agent) {
  const dry = Boolean(flags['dry-run']);
  const projectDir = path.resolve(flags.project || positionals[1] || process.cwd());

  if (agent.key === 'codex') return installCodex(dry);

  let plan;
  try {
    plan = planClaude(projectDir, agent.name);
  } catch (e) {
    sayError({
      what: `${claudeFile(projectDir)} 读不出来，没敢往里写。`,
      why: `${e.message}；常见原因是手工改过或者上次写到一半断了。`,
      how: '用编辑器打开它，把括号引号补齐（或者先把它挪走），再跑一次 webuddy hook install。你的文件我一个字都没动。',
    });
    process.exit(1);
  }

  // --dry-run：只把「会写进去的那一段」原样打到 stdout，一个字节都不落盘。
  // 人话说明走 stderr，这样 webuddy hook install --dry-run | ... 拿到的是干净 JSON。
  if (dry) {
    console.log(JSON.stringify({ hooks: plan.fragment }, null, 2));
    console.error(plan.added.length
      ? `上面这段会合并进 ${plan.file}，加 ${plan.added.length} 个挂钩。现在什么都没写。去掉 --dry-run 才真装。`
      : `${plan.file} 里三个挂钩都已经在了，真跑一次也不会有任何改动。`);
    return;
  }

  if (!plan.added.length) {
    console.log(`${projectDir} 已经装过了，没重复加。`);
    console.log(`配置在 ${plan.file}。想看收到了什么，跑 webuddy hook status。`);
    return;
  }

  writeClaude(plan);
  console.log(`装好了：${projectDir}`);
  console.log(`配置写在 ${plan.file}，加了 ${plan.added.join('、')} 共 ${plan.added.length} 个挂钩。`);
  console.log('这个目录里下次让 Claude Code 动手，改了哪个文件、跑了什么命令就会自动记下来。');
  console.log('想确认真的在收，跑一次 webuddy hook status。');
}

/** Codex 那边只有 ~/.codex/config.toml 一个位置，所以它必须碰 home（claude 那条路不碰）。 */
function installCodex(dry) {
  const st = statusCodex();
  const line = codexLine();

  if (dry) {
    // 打的是 JSON，因为要写进去的是 TOML 的 notify 这一个键，值就是这个数组。
    console.log(JSON.stringify({ notify: codexNotify() }, null, 2));
    console.error(st.installed
      ? `${st.file} 里已经挂着了，真跑一次也不会有任何改动。`
      : `会往 ${st.file} 里加一行 notify。现在什么都没写。去掉 --dry-run 才真装。`);
    return;
  }

  if (st.installed) {
    console.log('Codex 已经装过了，没重复加。');
    console.log(`配置在 ${st.file}。`);
    return;
  }
  if (st.foreign) {
    sayError({
      what: `${st.file} 里已经有一行 notify 了，不是我们这条，没敢覆盖。`,
      why: 'Codex 只允许一个 notify，你那行是另一个工具（或你自己）挂上去的，改掉它等于把那个工具弄哑。',
      how: `确认那行不要了，就手工把它换成：${line.trim()}；还要留着的话，Codex 这边就先别装了，Claude Code 那边不受影响。`,
    });
    process.exit(1);
  }

  // 顶层键必须写在任何 [表] 之前，所以插在文件最前面——这是唯一永远合法的位置。
  const old = fs.existsSync(st.file) ? fs.readFileSync(st.file, 'utf8') : '';
  fs.mkdirSync(path.dirname(st.file), { recursive: true });
  fs.writeFileSync(st.file, line + old, 'utf8');
  console.log('装好了：Codex');
  console.log(`配置写在 ${st.file}，加了 1 行 notify。`);
  console.log('下次用 Codex 动手，痕迹就会自动记下来。');
}

function cmdStatus(positionals, flags, agent) {
  const projectDir = path.resolve(flags.project || positionals[1] || process.cwd());
  const st = agent.key === 'codex' ? statusCodex() : statusClaude(projectDir, agent.name);

  if (flags.json) {
    console.log(JSON.stringify({ agent: agent.name, projectDir, ...st }, null, 2));
    return;
  }

  if (st.broken) {
    console.log(`${agent.say} 的挂钩：看不出装没装。`);
    console.log(`${st.file} 不是合法 JSON，先把它修好，再跑 webuddy hook install。`);
    return;
  }
  if (st.foreign) {
    console.log(`${agent.say} 的挂钩：没装。`);
    console.log(`${st.file} 里那行 notify 是别人的，我们没往上盖。`);
    return;
  }
  if (!st.installed) {
    // 空状态即引导（§2.5 铁律 4）：不能只说"没装"，得说下一步敲什么。
    console.log(`${agent.say} 的挂钩：还没装。`);
    console.log(`所以这个项目现在收不到"改了哪个文件、跑了什么命令"的痕迹。`);
    console.log(`装上就一条命令：webuddy hook install${agent.key === 'codex' ? ' --agent codex' : ''}`);
    return;
  }

  if (agent.key === 'codex') {
    console.log(`${agent.say} 的挂钩：装好了。`);
    console.log(`配置在 ${st.file}。`);
    if (st.stale) {
      console.log('但它指的不是现在这个 webuddy 目录，痕迹会记不下来。');
      console.log(`怎么办：把那行换成 ${codexLine().trim()}`);
    }
    return;
  }

  console.log(`${agent.say} 的挂钩：装好了，${st.events.length} 个事件（${st.events.join('、')}）。`);
  console.log(`配置在 ${st.file}。`);
  if (st.stale) {
    console.log('但它指的不是现在这个 webuddy 目录，所以痕迹记不下来：');
    console.log(`  配置里写的是：${st.command}`);
    console.log(`  现在应该是：  ${st.want}`);
    console.log('怎么办：把配置里那条删掉，再跑一次 webuddy hook install。');
  } else {
    console.log('指的路径是对的，让 agent 动一次手就能收到痕迹了。');
  }
}
