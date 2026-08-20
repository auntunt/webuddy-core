#!/usr/bin/env node
/**
 * 生成 golden 文件：从 pack fixtures 运行判定，保存结果到 test/golden/
 *
 * §5.5 golden 文件要求：
 * 1. 从 pack fixtures 生成（不是手写）
 * 2. 每个 fixture 一个 .json 文件
 * 3. 包含完整的 evaluate 输出
 * 4. 用于回归测试
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPack } from '../src/kernel/pack.js';
import { evaluate } from '../src/kernel/evaluate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

/**
 * 把 EvalResult 转成能落盘比对的形状。
 *
 * 两件事必须在这儿做掉,否则 golden 文件是废的:
 *
 * 1. verdictById 是 Map。JSON.stringify 把 Map 写成 {},于是 golden 里躺着一个
 *    永远是空对象的字段——它对任何回归都不敏感,判定错成什么样它都是 {}。
 *    它本来就是 verdicts 的索引,没有独立信息,直接不落盘。
 *
 * 2. 每条 verdict 里挂着整个 gate 对象(desc/defaultPrompt 全在)。那是包的内容,
 *    不是判定结果:改一句门禁描述就会让所有 golden 文件失效,而判定一个字没变。
 *    golden 只留 gate.stage(判定要用它分环节),其余按 id 回包里查。
 */
function serializable(result) {
  const { verdictById, verdicts, ...rest } = result;
  return {
    ...rest,
    verdicts: verdicts.map(({ gate, ...v }) => ({ ...v, stage: gate.stage })),
  };
}

async function generateGoldenFiles() {
  const packDir = path.join(projectRoot, 'packs/software-engineering');
  const fixturesDir = path.join(packDir, 'fixtures');
  const goldenDir = path.join(projectRoot, 'test/golden');

  // 确保 golden 目录存在
  if (!fs.existsSync(goldenDir)) {
    fs.mkdirSync(goldenDir, { recursive: true });
  }

  console.log('🔨 生成 golden 文件...\n');

  // 加载包
  const packResult = await loadPack(packDir);
  if (!packResult.ok) {
    console.error('❌ 加载包失败:');
    for (const err of packResult.errors) {
      console.error(`  ${err}`);
    }
    process.exit(1);
  }

  const pack = packResult.pack;

  // 构建 context
  const context = {
    stages: pack.stages,
    gates: pack.gates,
    rules: pack.nativeRules || {},
    gateById: new Map(pack.gates.map(g => [g.id, g])),
    stageById: new Map(pack.stages.map(s => [s.id, s])),
  };

  // 检查 fixtures 目录
  if (!fs.existsSync(fixturesDir)) {
    console.log('⚠️  没有 fixtures 目录');
    process.exit(0);
  }

  const entries = fs.readdirSync(fixturesDir, { withFileTypes: true });
  const fixtureDirs = entries.filter(e => e.isDirectory()).map(e => e.name);

  let generated = 0;

  for (const fixtureName of fixtureDirs) {
    const fixtureDir = path.join(fixturesDir, fixtureName);
    const factsPath = path.join(fixtureDir, 'facts.json');

    if (!fs.existsSync(factsPath)) {
      console.log(`⚠️  跳过 ${fixtureName}: 缺少 facts.json`);
      continue;
    }

    // 加载 facts
    const facts = JSON.parse(fs.readFileSync(factsPath, 'utf8'));

    // 运行 evaluate
    const result = evaluate(facts, context);

    // 保存到 golden 目录
    const goldenPath = path.join(goldenDir, `${fixtureName}.json`);
    fs.writeFileSync(goldenPath, JSON.stringify(serializable(result), null, 2) + '\n');

    console.log(`✓ ${fixtureName} → test/golden/${fixtureName}.json`);
    generated++;
  }

  console.log(`\n✅ 生成了 ${generated} 个 golden 文件`);
}

generateGoldenFiles().catch(err => {
  console.error('❌ 生成失败:', err);
  process.exit(1);
});
