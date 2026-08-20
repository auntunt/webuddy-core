/**
 * pack 命令 - 担架包管理
 *
 * 子命令:
 *   lint <packDir>  - 校验包结构
 *   test <packDir>  - 运行包的 fixtures
 *   mount <project> <packRef> - 挂载包到项目
 */

import { loadPack } from '../kernel/pack.js';

export async function run(positionals, flags) {
  const subcommand = positionals[0];

  if (!subcommand || flags.help) {
    console.log(`pack - 担架包管理

用法:
  webuddy pack lint <packDir>           校验包结构
  webuddy pack test <packDir>           运行包的 fixtures
  webuddy pack mount <project> <pack>   挂载包到项目

选项:
  --strict    严格模式(lint 时检查更多规则)
  --help, -h  显示此帮助`);
    process.exit(0);
  }

  switch (subcommand) {
    case 'lint':
      await lintPack(positionals[1], flags);
      break;
    case 'test':
      await testPack(positionals[1], flags);
      break;
    case 'mount':
      await mountPack(positionals[1], positionals[2], flags);
      break;
    default:
      console.error(`未知子命令: ${subcommand}`);
      console.error('可用: lint, test, mount');
      process.exit(1);
  }
}

async function lintPack(packDir, flags) {
  if (!packDir) {
    console.error('用法: webuddy pack lint <packDir>');
    process.exit(1);
  }

  console.log(`🔍 校验包: ${packDir}`);

  const result = await loadPack(packDir);

  if (!result.ok) {
    console.error(`\n❌ 包校验失败:\n`);
    for (const error of result.errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }

  const pack = result.pack;

  console.log(`\n✅ 包结构有效`);
  console.log(`   名称: ${pack.meta.name}`);
  console.log(`   版本: ${pack.meta.version}`);
  console.log(`   环节: ${pack.stages.length}`);
  console.log(`   门禁: ${pack.gates.length}`);

  if (pack.meta.native) {
    console.log(`   Native 实现: 是`);
  }

  if (flags.strict) {
    console.log(`\n🔬 严格模式检查...`);
    const warnings = [];

    // 检查 probes.md 是否有内容
    if (pack.probes && pack.probes.length === 0 && !pack.native) {
      warnings.push('probes.md 为空且未标记 native:true');
    }

    // 检查 prompts.md 覆盖率
    const gateIds = pack.stages.flatMap(s => s.gates.map(g => g.id));
    const promptGateIds = new Set(pack.prompts.map(p => p.gateId));
    const missingPrompts = gateIds.filter(id => !promptGateIds.has(id));

    if (missingPrompts.length > 0) {
      warnings.push(`${missingPrompts.length} 个门禁缺少 prompts`);
    }

    if (warnings.length > 0) {
      console.log(`\n⚠️  警告:`);
      for (const warning of warnings) {
        console.log(`   - ${warning}`);
      }
    } else {
      console.log(`   ✓ 无警告`);
    }
  }
}

async function testPack(packDir, flags) {
  console.error('pack test 尚未实现 (P2 任务)');
  process.exit(2);
}

async function mountPack(projectDir, packRef, flags) {
  console.error('pack mount 尚未实现 (P1d 实现了 mountPack 函数)');
  process.exit(2);
}
