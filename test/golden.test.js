/**
 * golden 文件回归测试（§5.5）。
 *
 * golden 文件只有在有人真去比对时才有价值。生成脚本本身不构成回归保护:
 * 它每次都用当前代码重算一遍,判定错了它照样把错的结果写下去。
 * 这个测试是另一半——拿冻结的 golden 和现在的 evaluate 输出对齐。
 *
 * 判定逻辑变了而 golden 没变,这里会红。此时先想清楚是判定改对了还是改坏了:
 * 改对了才重新生成 golden(scripts/generate-golden.js),改坏了就修代码。
 * 别为了让这个测试变绿而直接重跑生成脚本——那等于把回归保护关掉。
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPack } from '../src/kernel/pack.js';
import { evaluate } from '../src/kernel/evaluate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const packDir = path.join(projectRoot, 'packs/software-engineering');
const fixturesDir = path.join(packDir, 'fixtures');
const goldenDir = path.join(projectRoot, 'test/golden');

/** 和 scripts/generate-golden.js 的 serializable() 必须一致,否则两边永远对不上。 */
function serializable(result) {
  const { verdictById, verdicts, ...rest } = result;
  return {
    ...rest,
    verdicts: verdicts.map(({ gate, ...v }) => ({ ...v, stage: gate.stage })),
  };
}

describe('golden 回归', () => {
  let context;

  before(async () => {
    const packResult = await loadPack(packDir);
    assert.ok(packResult.ok, `加载包失败: ${(packResult.errors || []).join('; ')}`);
    const pack = packResult.pack;
    context = {
      stages: pack.stages,
      gates: pack.gates,
      rules: pack.nativeRules || {},
      gateById: new Map(pack.gates.map((g) => [g.id, g])),
      stageById: new Map(pack.stages.map((s) => [s.id, s])),
    };
  });

  const goldenFiles = fs.existsSync(goldenDir)
    ? fs.readdirSync(goldenDir).filter((f) => f.endsWith('.json'))
    : [];

  it('golden 目录不是空的', () => {
    // 一个空目录会让下面的用例一条都不跑,而测试报告全绿。
    assert.ok(goldenFiles.length > 0, 'test/golden/ 里没有 golden 文件');
  });

  for (const file of goldenFiles) {
    const name = file.replace(/\.json$/, '');

    it(`${name} 的判定输出和 golden 一致`, () => {
      const factsPath = path.join(fixturesDir, name, 'facts.json');
      assert.ok(fs.existsSync(factsPath), `golden ${file} 找不到对应的 fixture: ${factsPath}`);

      const facts = JSON.parse(fs.readFileSync(factsPath, 'utf8'));
      const golden = JSON.parse(fs.readFileSync(path.join(goldenDir, file), 'utf8'));

      const actual = serializable(evaluate(facts, context));

      // scannedAt 由 fixture 固定,不是当前时间,所以可以整体比对
      assert.deepStrictEqual(actual, golden);
    });
  }

  it('golden 里的 verdicts 是实数据,不是空壳', () => {
    // 曾经 verdictById(Map)被 JSON.stringify 写成 {},在 golden 里躺着一个
    // 对任何回归都不敏感的字段。这条用例盯的就是那类"看着有、其实是空的"字段。
    for (const file of goldenFiles) {
      const golden = JSON.parse(fs.readFileSync(path.join(goldenDir, file), 'utf8'));
      assert.ok(Array.isArray(golden.verdicts), `${file} 的 verdicts 不是数组`);
      assert.ok(golden.verdicts.length > 0, `${file} 的 verdicts 是空的`);
      assert.ok(!('verdictById' in golden), `${file} 还留着 verdictById(Map 落盘只会是 {})`);
      for (const v of golden.verdicts) {
        assert.ok(v.id, `${file} 有一条 verdict 没有 id`);
        assert.ok(v.r, `${file} 的 ${v.id} 没有判定结果`);
      }
    }
  });
});
