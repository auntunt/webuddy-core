/**
 * I5：CI 文件里写了什么，就得真有什么。
 *
 * 这个文件不跑 CI，只静态读一遍 .github/workflows/ci.yml。
 * 要防的是"yml 写了没验"这一类事故：yml 只有推上去才跑，
 * 而本地这一趟检查是照它逐条复跑的——两边一旦对不上，
 * 本地全绿而 CI 全红，人却以为是 CI 坏了。
 *
 * 不引 YAML 解析器（零依赖铁律），只按缩进认几个键，够用就行。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const YML = path.resolve('.github/workflows/ci.yml');
const src = fs.readFileSync(YML, 'utf8');
/** 去掉注释行再看，免得注释里提了一句就算"在位" */
const code = src.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

describe('.github/workflows/ci.yml（§I5）', () => {
  test('文件在位，且是这个仓库的 CI', () => {
    assert.ok(fs.existsSync(YML));
    assert.match(code, /^name:\s*CI$/m);
  });

  test('两个系统 × 两个 Node 版本的 matrix 都在', () => {
    assert.match(code, /^\s*matrix:\s*$/m, '没有 matrix');
    assert.match(code, /^\s*os:\s*\[ubuntu-latest,\s*macos-latest\]\s*$/m);
    assert.match(code, /^\s*node:\s*\[20,\s*22\]\s*$/m);
    assert.match(code, /runs-on:\s*\$\{\{\s*matrix\.os\s*\}\}/);
    assert.match(code, /node-version:\s*\$\{\{\s*matrix\.node\s*\}\}/);
  });

  test('六个步骤一个不少，顺序也跟本地那一趟一致', () => {
    const steps = [...code.matchAll(/^\s*-\s*name:\s*(\S+)\s*$/gm)].map((m) => m[1]);
    assert.deepEqual(steps, [
      'checkout', 'setup-node', 'clone-ref', 'unit-tests', 'pack-test', 'pack-lint', 'kernel-purity',
    ], `步骤对不上：${steps.join(' → ')}`);
  });

  test('每一步跑的命令，本地都能原样跑', () => {
    assert.match(code, /git clone --depth 1 https:\/\/github\.com\/auntunt\/webuddy-console\.git \.ref\/webuddy-console/);
    assert.match(code, /ln -s \.ref ref/);
    assert.match(code, /^\s*run:\s*node --test\s*$/m);
    assert.match(code, /pack test "packs\/\$p"/);
    assert.match(code, /pack lint "packs\/\$p" --strict/);
    // 三个包都得跑到，不能只跑软件工程那一个
    for (const p of ['software-engineering', 'construction-safety', 'financial-audit']) {
      assert.ok(code.includes(p), `${p} 没进 CI`);
    }
  });

  test('内核纯净那一步看的是命中计数，不是 grep 的退出码', () => {
    // grep 找不到东西时退出码是 1。直接 `grep …` 会让"干净"变成"失败"，
    // 而加 `|| true` 又会让"脏了"变成"通过"——两种写法都是反的。
    assert.match(code, /grep -rEc[^\n]*src\/kernel\//);
    assert.match(code, /test "\$hits" -eq 0/);
    assert.doesNotMatch(code, /grep[^\n]*\|\|\s*true/);
  });

  test('CI 里的禁词表跟终局判据 6 那条 grep 逐字一致', () => {
    const m = /grep -rEc "([^"]+)" src\/kernel\//.exec(code);
    assert.ok(m, 'CI 里找不到内核纯净那条 grep');
    assert.equal(m[1], '八步|场景卡|scope-card|01-scope|TEST_HINT|SCHEMA_HINT|software');
  });
});
