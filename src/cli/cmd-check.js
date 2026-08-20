/**
 * check 命令 - 运行项目验收检查
 *
 * 用法:
 *   webuddy check [项目目录]
 *   webuddy check --json
 *
 * 选项:
 *   --json      以 JSON 格式输出结果
 *   --mode      验收模式: learning/mvp/full
 *   --pack      使用的担架包 (默认: software-engineering)
 */

import path from 'node:path';
import { loadPack } from '../kernel/pack.js';
import { loadState } from '../kernel/state.js';
import { evaluate } from '../kernel/evaluate.js';
import { computeVerdict } from '../kernel/verdict.js';

export async function run(positionals, flags) {
  const projectDir = positionals[0] || process.cwd();
  const packName = flags.pack || 'software-engineering';
  const jsonOutput = flags.json || false;

  // 1. 加载担架包
  const packDir = path.join(process.cwd(), 'packs', packName);
  const packResult = await loadPack(packDir);

  if (!packResult.ok) {
    if (jsonOutput) {
      console.log(JSON.stringify({ error: '加载担架包失败', details: packResult.errors }, null, 2));
    } else {
      console.error('❌ 加载担架包失败:');
      for (const err of packResult.errors) {
        console.error(`  ${err}`);
      }
    }
    process.exit(1);
  }

  const pack = packResult.pack;

  // 2. 加载项目状态 (facts)
  //
  // loadState 在项目还没初始化过时返回 null,不是抛错。这是最常见的一种情况
  // (人刚建好目录就跑 check),所以它必须给一句人话,而不是崩在 state.facts 上。
  let facts;
  let state;
  try {
    state = loadState(projectDir);
  } catch (e) {
    const msg = {
      what: `读不了 ${projectDir} 里的记录文件。`,
      why: e.message,
      how: '这个文件是 .webuddy/state.json。如果是刚才手工改坏的,改回去;不确定就把它删掉重新开始。',
    };
    if (jsonOutput) {
      console.log(JSON.stringify({ error: 'state-unreadable', ...msg }, null, 2));
    } else {
      console.error(`${msg.what}\n原因:${msg.why}\n怎么办:${msg.how}`);
    }
    process.exit(1);
  }

  if (!state) {
    const msg = {
      what: `${projectDir} 还没开始记录,没什么可查的。`,
      why: '这个目录下没有 .webuddy/state.json,说明这个项目还没在本工具里开过工。',
      how: '先在这个目录下把项目初始化一次,再回来跑检查。',
    };
    if (jsonOutput) {
      console.log(JSON.stringify({ error: 'not-initialized', ...msg }, null, 2));
    } else {
      console.error(`${msg.what}\n原因:${msg.why}\n怎么办:${msg.how}`);
    }
    process.exit(1);
  }

  facts = state.facts || {};
  // 补充基础信息
  facts.dir = projectDir;
  facts.name = path.basename(projectDir);
  facts.scannedAt = new Date().toISOString();
  facts.local = state.local || {};

  // 3. 构建 context (stages, gates, rules, maps)
  const context = {
    stages: pack.stages,
    gates: pack.gates,
    rules: pack.rules || {},
    gateById: new Map(pack.gates.map(g => [g.id, g])),
    stageById: new Map(pack.stages.map(s => [s.id, s])),
  };

  // 4. 运行判定
  const evalResult = evaluate(facts, context);

  // 5. 计算最终判定
  const verdict = computeVerdict(evalResult);

  // 6. 输出结果
  if (jsonOutput) {
    // JSON 输出：完整结构化数据
    const output = {
      project: {
        dir: evalResult.dir,
        name: evalResult.name,
        scannedAt: evalResult.scannedAt,
      },
      mode: evalResult.mode,
      verdict: verdict,
      stages: evalResult.stages,
      counts: evalResult.counts,
      verdicts: evalResult.verdicts.map(v => ({
        id: v.id,
        result: v.r,
        severity: v.severity,
        detail: v.detail,
        stage: v.gate.stage,
      })),
    };
    console.log(JSON.stringify(output, null, 2));
  } else {
    // 人类可读输出
    console.log(`\n项目: ${evalResult.name}`);
    console.log(`模式: ${evalResult.mode}`);
    console.log(`当前环节: ${verdict.currentStage} - ${verdict.stageName}`);
    console.log(`状态: ${verdict.message}`);
    console.log(`完成度: ${verdict.progress}%`);
    console.log(`\n统计:`);
    console.log(`  通过: ${verdict.stats.pass}/${verdict.stats.total}`);
    console.log(`  不通过: ${verdict.stats.fail}`);
    console.log(`  待改: ${verdict.stats.fix}`);
    console.log(`  待确认: ${verdict.stats.ask}`);
    console.log(`  不适用: ${verdict.stats.na}`);

    if (verdict.blocking > 0) {
      console.log(`\n⚠️  ${verdict.blocking} 条阻断项需要处理`);
    }

    // 显示各环节状态
    console.log(`\n环节状态:`);
    for (const stage of evalResult.stages) {
      const icon = stage.state === 'passed' ? '✓' :
                   stage.state === 'blocked' ? '✗' :
                   stage.state === 'fixing' ? '⚠' :
                   stage.state === 'waiting' ? '?' :
                   stage.state === 'notyet' ? '·' : '○';
      console.log(`  ${icon} 环节${stage.id} ${stage.name}: ${stage.passed}/${stage.total} (${stage.percent}%)`);
    }
  }

  // 根据结果设置退出码
  process.exit(verdict.blocking > 0 ? 1 : 0);
}
