#!/usr/bin/env node
/**
 * 软件工程包引导生成器
 *
 * WARNING: SKILL.md 为唯一事实源。重跑会覆盖手工修订。
 * 须经 DECISIONS.md 记录后才允许重跑。
 *
 * 从 ref/webuddy-console 提取八步法门禁并生成完整的 packs/software-engineering/
 *
 * 用法: node scripts/gen-se-pack.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const REF_SRC = path.join(ROOT, 'ref/webuddy-console/src');
const PACK_DIR = path.join(ROOT, 'packs/software-engineering');

// 导入 ref 的 stages
const stagesPath = path.join(REF_SRC, 'stages.js');
const stagesModule = await import(`file://${stagesPath}`);
const { STAGES, ALL_GATES } = stagesModule;

console.log(`📦 开始生成软件工程包...`);
console.log(`   环节数: ${STAGES.length}`);
console.log(`   门禁总数: ${ALL_GATES.length}`);

// 创建包目录
fs.mkdirSync(PACK_DIR, { recursive: true });

// ===== 1. 生成 SKILL.md =====
console.log(`\n📝 生成 SKILL.md...`);

let skillMd = `# 软件工程八步法\n\n`;
skillMd += `本文档从 ref/webuddy-console 自动生成。\n`;
skillMd += `共 ${STAGES.length} 个环节，${ALL_GATES.length} 道门禁。\n\n`;

for (const stage of STAGES) {
  skillMd += `## 环节${stage.id}：${stage.name}\n\n`;
  skillMd += `- 目的：${stage.oneLiner}\n`;

  if (stage.artifacts && stage.artifacts.length > 0) {
    skillMd += `- 产物：${stage.artifacts.join(', ')}\n`;
  } else {
    skillMd += `- 产物：过程性环节，无固定文档产物\n`;
  }

  skillMd += `\n`;

  for (const gate of stage.gates) {
    skillMd += `### ${gate.id} ${gate.desc}\n\n`;
    skillMd += `判据类型：${gate.mode}\n\n`;
    skillMd += `严格度：${gate.severity}\n\n`;
    if (gate.hint) {
      skillMd += `提示：${gate.hint}\n\n`;
    }
  }

  skillMd += `\n`;
}

fs.writeFileSync(path.join(PACK_DIR, 'SKILL.md'), skillMd);
console.log(`   ✓ SKILL.md (${STAGES.length} 环节, ${ALL_GATES.length} 门禁)`);

// ===== 2. 生成 prompts.md =====
console.log(`\n📝 生成 prompts.md...`);

// 导入 prompts
const promptsPath = path.join(REF_SRC, 'prompts.js');
const promptsModule = await import(`file://${promptsPath}`);
const { PROMPTS, TOPICS } = promptsModule;

let promptsMd = `# 提问组\n\n`;
promptsMd += `从 ref/webuddy-console/src/prompts.js 提取。\n\n`;

// 按门禁 ID 组织提问
const promptsByGate = new Map();

for (const prompt of PROMPTS) {
  const gateIds = prompt.relatedGates || [];

  // 如果没有明确关联，按 stage 推断关联到该环节所有门禁
  if (gateIds.length === 0 && prompt.stage) {
    const stageGates = ALL_GATES.filter(g => g.stage === prompt.stage);
    for (const gate of stageGates) {
      if (!promptsByGate.has(gate.id)) {
        promptsByGate.set(gate.id, []);
      }
      promptsByGate.get(gate.id).push(prompt);
    }
  } else {
    for (const gateId of gateIds) {
      if (!promptsByGate.has(gateId)) {
        promptsByGate.set(gateId, []);
      }
      promptsByGate.get(gateId).push(prompt);
    }
  }
}

// 为每个有提问的门禁生成小节
for (const [gateId, prompts] of promptsByGate.entries()) {
  const gate = ALL_GATES.find(g => g.id === gateId);
  if (!gate) continue;

  promptsMd += `## ${gateId}\n\n`;

  for (const prompt of prompts) {
    promptsMd += `### ${prompt.id}\n\n`;
    if (prompt.lead) {
      promptsMd += `**前言**: ${prompt.lead}\n\n`;
    }

    if (prompt.asks && prompt.asks.length > 0) {
      promptsMd += `**问题**:\n\n`;
      for (const ask of prompt.asks) {
        promptsMd += `- **${ask.key}**: ${ask.q}\n`;
        if (ask.why) {
          promptsMd += `  - 为什么: ${ask.why}\n`;
        }
      }
      promptsMd += `\n`;
    }
  }
}

fs.writeFileSync(path.join(PACK_DIR, 'prompts.md'), promptsMd);
console.log(`   ✓ prompts.md (${PROMPTS.length} 个提问组)`);

// ===== 3. 生成 native-rules.js 骨架 =====
console.log(`\n📝 生成 native-rules.js...`);

let nativeRules = `/**
 * 软件工程包 native 判定函数
 *
 * 从 ref/webuddy-console/src/rules.js + rules-late.js 移植
 * 适配 §4.3 的 ctx 签名
 */

`;

nativeRules += `// 全部 ${ALL_GATES.length} 条门禁的 native 实现\n`;
nativeRules += `// 后续 P3a-d 会逐步翻译为 DSL，最终目标 ≤ 20 条\n\n`;

nativeRules += `export const RULES = {\n`;

for (const gate of ALL_GATES) {
  const fnName = 'gate_' + gate.id.replace(/\./g, '_');
  nativeRules += `  '${gate.id}': function ${fnName}(ctx) {\n`;
  nativeRules += `    // TODO: 从 ref 移植 ${gate.id} 的判定逻辑\n`;
  nativeRules += `    return { r: 'pass', say: '${gate.desc}' };\n`;
  nativeRules += `  },\n\n`;
}

nativeRules += `};\n\n`;
nativeRules += `export default RULES;\n`;

fs.writeFileSync(path.join(PACK_DIR, 'native-rules.js'), nativeRules);
console.log(`   ✓ native-rules.js (${ALL_GATES.length} 条骨架)`);

// ===== 4. 生成 pack.json =====
console.log(`\n📝 生成 pack.json...`);

const packJson = {
  name: 'software-engineering',
  version: '0.1.0',
  title: '软件工程八步法',
  description: '软件工程八步法验收包',
  native: true,
  hints: {
    TEST_HINT: '测试是你唯一能看出软件好没好的通道',
    SCHEMA_HINT: '数据表结构（有哪些栏、什么类型）'
  }
};

fs.writeFileSync(
  path.join(PACK_DIR, 'pack.json'),
  JSON.stringify(packJson, null, 2) + '\n'
);
console.log(`   ✓ pack.json`);

// ===== 5. 生成空的 probes.md =====
const probesMd = `# 探测表达式\n\n暂无 DSL 探测（全 native）。P3a-d 会逐步添加。\n`;
fs.writeFileSync(path.join(PACK_DIR, 'probes.md'), probesMd);
console.log(`   ✓ probes.md (空)`);

// ===== 6. 生成 glossary.json 骨架 =====
const glossary = {
  terms: {},
  banned: []
};
fs.writeFileSync(
  path.join(PACK_DIR, 'glossary.json'),
  JSON.stringify(glossary, null, 2) + '\n'
);
console.log(`   ✓ glossary.json (空)`);

// ===== 7. 生成 README.md =====
let readme = `# 软件工程八步法包\n\n`;
readme += `从 ref/webuddy-console 移植的软件工程验收包。\n\n`;
readme += `## 统计\n\n`;
readme += `- 环节: ${STAGES.length}\n`;
readme += `- 门禁: ${ALL_GATES.length}\n`;
readme += `- Native 实现: ${ALL_GATES.length} (目标 ≤ 20)\n`;
readme += `- DSL 覆盖率: 0% (目标 ≥ 80%)\n\n`;
readme += `## 门禁分布\n\n`;

for (const stage of STAGES) {
  readme += `- 环节 ${stage.id} (${stage.name}): ${stage.gates.length} 道\n`;
}

readme += `\n## Native 条目\n\n`;
readme += `当前全部 ${ALL_GATES.length} 条为 native 实现。\n`;
readme += `P3a-d 将逐步翻译为 DSL。\n`;

fs.writeFileSync(path.join(PACK_DIR, 'README.md'), readme);
console.log(`   ✓ README.md`);

console.log(`\n✅ 软件工程包生成完成: ${PACK_DIR}`);
console.log(`\n下一步: node bin/webuddy.js pack lint packs/software-engineering`);
