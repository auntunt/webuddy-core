/**
 * pack 命令 - 担架包管理
 *
 * 子命令:
 *   lint <packDir>  - 校验包结构
 *   test <packDir>  - 运行包的 fixtures
 *   mount <project> <packRef> - 挂载包到项目
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadPack, runPackFixtures, mountPack as mount } from '../kernel/pack.js';

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

/**
 * 拿包自带的两个样板项目试一遍这个包。
 *
 * 判定逻辑全在内核的 runPackFixtures 里（§11.2），这里只负责把它说的话印出来。
 * 命令行不重写一份判据：包自测在命令行和在服务端得是同一个结论，
 * 两处各写一套，迟早出现「命令行说过了、界面上说没过」这种没人能解释的情况。
 */
async function testPack(packDir, flags) {
  if (!packDir) {
    console.error('用法: webuddy pack test <包目录>');
    process.exit(1);
  }

  console.log(`拿样板项目试一遍这个包：${packDir}`);

  const { ok, report } = await runPackFixtures(packDir);

  console.log('');
  for (const line of report) console.log(line);

  if (ok) {
    console.log('\n这个包过了自测：该过的过了，该红的红了');
    process.exit(0);
  }
  console.log('\n这个包没过自测，上面每条都得处理完再用');
  process.exit(1);
}

/** 把一个包挂到项目上。真正的写入在内核的 mountPack 里，这里只翻译成人话。 */
async function mountPack(projectDir, packRef, flags) {
  if (!projectDir || !packRef) {
    console.error('用法: webuddy pack mount <项目目录> <包目录或包名>');
    process.exit(1);
  }
  if (!fs.existsSync(projectDir)) {
    console.error(`找不到这个项目目录：${projectDir}`);
    process.exit(1);
  }

  const r = await mount(projectDir, packRef);
  if (!r.ok) {
    console.error(r.error);
    process.exit(1);
  }
  console.log(`挂上了：${projectDir} 现在用「${r.packName}」这套检查清单`);
  console.log('下一步跑 webuddy check，看看现在到哪一步了');
  process.exit(0);
}
