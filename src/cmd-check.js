#!/usr/bin/env node
import { evaluate } from './kernel/evaluate.js';
import { loadPack } from './kernel/pack.js';
import { existsSync } from 'node:fs';

const args = process.argv.slice(2);
let project = null;
let packPath = 'packs/software-engineering';
let scope = null;
let session = null;
let jsonMode = false;
let failOn = 'block';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--project' && args[i + 1]) {
    project = args[i + 1];
    i++;
  } else if (args[i] === '--pack' && args[i + 1]) {
    packPath = args[i + 1];
    i++;
  } else if (args[i] === '--scope' && args[i + 1]) {
    scope = args[i + 1].split(',');
    i++;
  } else if (args[i] === '--session' && args[i + 1]) {
    session = args[i + 1];
    i++;
  } else if (args[i] === '--json') {
    jsonMode = true;
  } else if (args[i] === '--fail-on' && args[i + 1]) {
    failOn = args[i + 1];
    i++;
  }
}

if (!project) {
  console.error('错误: 缺少 --project 参数');
  process.exit(1);
}

if (!existsSync(project)) {
  console.error(`错误: 项目不存在: ${project}`);
  process.exit(1);
}

const { ok, pack, errors } = await loadPack(packPath);
if (!ok) {
  console.error(`错误: 包校验不过: ${errors.join('; ')}`);
  process.exit(1);
}

const scopeParam = scope ? scope.map(s => `gate:${s}`).join(',') : 'all';
const verdict = evaluate(project, pack, { scope: scopeParam, round: session });

if (jsonMode) {
  console.log(JSON.stringify(verdict, null, 2));
} else {
  // 人类可读模式，4 行模板
  const isTTY = process.stdout.isTTY;
  const red = isTTY ? '\x1b[31m' : '';
  const yellow = isTTY ? '\x1b[33m' : '';
  const green = isTTY ? '\x1b[32m' : '';
  const reset = isTTY ? '\x1b[0m' : '';

  console.log(`包: ${pack.title || pack.name}`);
  console.log(`总计 ${verdict.total} 条门禁`);

  const failed = verdict.gates.filter((g) => g.r === 'fail');
  const pending = verdict.gates.filter((g) => g.r === 'pending');

  if (failed.length > 0) {
    console.log(`${red}不通过 ${failed.length} 条${reset}: ${failed.map((g) => g.id).join(', ')}`);
  }
  if (pending.length > 0) {
    console.log(`${yellow}待确认 ${pending.length} 条${reset}: ${pending.map((g) => g.id).join(', ')}`);
  }
  if (failed.length === 0 && pending.length === 0) {
    console.log(`${green}全部通过${reset}`);
  }

  console.log(`详情: ${verdict.summary}`);
}

// 退出码
const severityRank = { block: 3, warn: 2, info: 1 };
const failThreshold = severityRank[failOn] || 3;

const anyFailed = verdict.gates.some((g) => {
  if (g.r !== 'fail') return false;
  const gateSeverity = pack.gates.find((pg) => pg.id === g.id)?.severity || 'warn';
  return severityRank[gateSeverity] >= failThreshold;
});

process.exit(anyFailed ? 1 : 0);
