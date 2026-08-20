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
import { loadPack } from '../kernel/pack.js';
import { evaluate } from '../kernel/evaluate.js';

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
  if (!packDir) {
    console.error('用法: webuddy pack test <packDir>');
    process.exit(1);
  }

  console.log(`🧪 运行包测试: ${packDir}`);

  // 1. 加载包
  const result = await loadPack(packDir);
  if (!result.ok) {
    console.error(`\n❌ 加载包失败:\n`);
    for (const error of result.errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }

  const pack = result.pack;

  // 2. 查找 fixtures 目录
  const fixturesDir = path.join(packDir, 'fixtures');
  if (!fs.existsSync(fixturesDir)) {
    console.log(`\n⚠️  未找到 fixtures 目录，跳过测试`);
    process.exit(0);
  }

  // 3. 运行 fixtures
  const fixtureResults = await runPackFixtures(packDir, pack);

  // 4. 输出结果
  console.log(`\n测试结果:`);
  console.log(`  总计: ${fixtureResults.total}`);
  console.log(`  通过: ${fixtureResults.passed}`);
  console.log(`  失败: ${fixtureResults.failed}`);

  if (fixtureResults.failures.length > 0) {
    console.log(`\n失败的测试:`);
    for (const failure of fixtureResults.failures) {
      console.error(`  ❌ ${failure.name}: ${failure.reason}`);
    }
    process.exit(1);
  } else {
    console.log(`\n✅ 所有测试通过`);
    process.exit(0);
  }
}

async function mountPack(projectDir, packRef, flags) {
  console.error('pack mount 尚未实现 (P1d 实现了 mountPack 函数)');
  process.exit(2);
}

/**
 * 运行担架包的 fixtures 测试。
 *
 * §11.2 runPackFixtures：
 * - 遍历 fixtures/ 目录下的每个子目录
 * - 每个子目录是一个测试用例，包含 facts.json 和 expected.json
 * - 调用 evaluate() 运行判定
 * - 对比实际输出和期望输出
 *
 * @param {string} packDir - 包目录
 * @param {object} pack - 已加载的包对象
 * @returns {object} { total, passed, failed, failures: [{name, reason}] }
 */
async function runPackFixtures(packDir, pack) {
  const fixturesDir = path.join(packDir, 'fixtures');
  const entries = fs.readdirSync(fixturesDir, { withFileTypes: true });
  const fixtureDirs = entries.filter(e => e.isDirectory()).map(e => e.name);

  const results = {
    total: fixtureDirs.length,
    passed: 0,
    failed: 0,
    failures: [],
  };

  // 构建 context
  const context = {
    stages: pack.stages,
    gates: pack.gates,
    rules: pack.nativeRules || {},
    gateById: new Map(pack.gates.map(g => [g.id, g])),
    stageById: new Map(pack.stages.map(s => [s.id, s])),
  };

  for (const fixtureName of fixtureDirs) {
    const fixtureDir = path.join(fixturesDir, fixtureName);
    const factsPath = path.join(fixtureDir, 'facts.json');
    const expectedPath = path.join(fixtureDir, 'expected.json');

    // 检查必需文件
    if (!fs.existsSync(factsPath)) {
      results.failed++;
      results.failures.push({
        name: fixtureName,
        reason: '缺少 facts.json',
      });
      continue;
    }

    if (!fs.existsSync(expectedPath)) {
      results.failed++;
      results.failures.push({
        name: fixtureName,
        reason: '缺少 expected.json',
      });
      continue;
    }

    // 加载 facts 和期望结果
    let facts, expected;
    try {
      facts = JSON.parse(fs.readFileSync(factsPath, 'utf8'));
      expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));
    } catch (e) {
      results.failed++;
      results.failures.push({
        name: fixtureName,
        reason: `JSON 解析失败: ${e.message}`,
      });
      continue;
    }

    // 运行 evaluate
    let actual;
    try {
      actual = evaluate(facts, context);
    } catch (e) {
      results.failed++;
      results.failures.push({
        name: fixtureName,
        reason: `evaluate() 失败: ${e.message}`,
      });
      continue;
    }

    // 对比结果
    const mismatch = compareResults(actual, expected);
    if (mismatch) {
      results.failed++;
      results.failures.push({
        name: fixtureName,
        reason: mismatch,
      });
    } else {
      results.passed++;
    }
  }

  return results;
}

/**
 * 对比实际结果和期望结果。
 * 返回不匹配的描述，或 null 表示匹配。
 */
function compareResults(actual, expected) {
  // 对比关键字段
  const fieldsToCheck = ['currentStage', 'mode', 'hookInstalled'];

  for (const field of fieldsToCheck) {
    if (expected[field] !== undefined && actual[field] !== expected[field]) {
      return `${field} 不匹配: 期望 ${JSON.stringify(expected[field])}, 实际 ${JSON.stringify(actual[field])}`;
    }
  }

  // 对比 counts
  if (expected.counts) {
    for (const [key, value] of Object.entries(expected.counts)) {
      if (actual.counts[key] !== value) {
        return `counts.${key} 不匹配: 期望 ${value}, 实际 ${actual.counts[key]}`;
      }
    }
  }

  // 对比 verdicts（如果指定了）
  if (expected.verdicts) {
    for (const expectedVerdict of expected.verdicts) {
      const actualVerdict = actual.verdicts.find(v => v.id === expectedVerdict.id);
      if (!actualVerdict) {
        return `缺少判定 ${expectedVerdict.id}`;
      }
      if (expectedVerdict.r && actualVerdict.r !== expectedVerdict.r) {
        return `判定 ${expectedVerdict.id} 结果不匹配: 期望 ${expectedVerdict.r}, 实际 ${actualVerdict.r}`;
      }
    }
  }

  return null;
}
