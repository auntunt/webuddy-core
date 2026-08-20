#!/usr/bin/env node
import { parseArgs } from 'node:util';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Levenshtein distance for command suggestions
function levenshtein(a, b) {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

function suggest(word, candidates) {
  if (!word || candidates.length === 0) return null;
  let best = null;
  let bestDist = Infinity;
  for (const candidate of candidates) {
    const dist = levenshtein(word.toLowerCase(), candidate.toLowerCase());
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  return bestDist <= 3 ? best : null;
}

const COMMANDS = {
  check: { module: 'cmd-check', subcommands: [] },
  pack: { module: 'cmd-pack', subcommands: ['lint', 'test', 'mount'] },
  round: { module: 'cmd-round', subcommands: ['start', 'end', 'abort', 'status'] },
  evidence: { module: 'cmd-evidence', subcommands: ['add', 'list'] },
  recompile: { module: 'cmd-recompile', subcommands: ['propose', 'apply', 'list'] },
  serve: { module: 'cmd-serve', subcommands: [] },
  open: { module: 'cmd-open', subcommands: [] }
};

// Handle --version / -v before argument parsing
if (process.argv.includes('--version') || process.argv.includes('-v')) {
  const pkgPath = join(__dirname, '../package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  console.log(`webuddy-core ${pkg.version}`);
  process.exit(0);
}

const args = process.argv.slice(2);

// No command - show help
if (args.length === 0) {
  console.log(`webuddy-core - 行业无关的验收内核

常用命令:
  check              运行验收检查
  round              管理轮次(开工、交活)
  evidence           管理凭据文件
  serve              启动 HTTP API 服务

更多命令:
  pack               担架包管理(lint、test、mount)
  recompile          骨架重编译(propose、apply、list)
  open               打开看板

使用 --version 或 -v 查看版本
使用 --help 查看某个命令的详细说明`);
  process.exit(0);
}

const command = args[0];
const subcommand = args[1];

// Unknown command - suggest
if (!COMMANDS[command]) {
  const suggestion = suggest(command, Object.keys(COMMANDS));
  if (suggestion) {
    console.error(`没有 ${command} 这个命令,是不是想打 ${suggestion}?`);
  } else {
    console.error(`未知命令: ${command}`);
    console.error('使用 webuddy 查看可用命令');
  }
  process.exit(1);
}

// Check if command is implemented
const cmdInfo = COMMANDS[command];
const cmdPath = join(__dirname, '../src/cli', `${cmdInfo.module}.js`);

if (!fs.existsSync(cmdPath)) {
  console.error('尚未实现');
  process.exit(2);
}

// Load and run command
try {
  const cmdModule = await import(cmdPath);

  // Parse flags using parseArgs
  const config = {
    strict: true,
    allowPositionals: true,
    options: {}
  };

  // Define common flags
  const commonFlags = {
    help: { type: 'boolean', short: 'h' },
    json: { type: 'boolean' },
    project: { type: 'string' },
    session: { type: 'string' },
    scope: { type: 'string' },
    files: { type: 'string' },
    gate: { type: 'string' },
    port: { type: 'string' },
    token: { type: 'string' },
    'allow-origin': { type: 'string' },
    strict: { type: 'boolean' },
    yes: { type: 'boolean' },
    'fail-on': { type: 'string' },
    'content-file': { type: 'string' }
  };

  config.options = commonFlags;

  let parsed;
  try {
    parsed = parseArgs({ args: args.slice(1), ...config });
  } catch (err) {
    if (err.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') {
      console.error(`未知选项: ${err.message.match(/option '([^']+)'/)?.[1] || '(未知)'}`);
    } else {
      console.error(`参数错误: ${err.message}`);
    }
    process.exit(1);
  }

  // Split --files by comma
  const flags = parsed.values;
  if (flags.files) {
    flags.files = flags.files.split(',').map(f => f.trim()).filter(Boolean);
  }

  const positionals = parsed.positionals;

  await cmdModule.run(positionals, flags);
} catch (err) {
  console.error('执行错误:', err.message);
  if (process.env.DEBUG) {
    console.error(err.stack);
  }
  process.exit(1);
}
