/**
 * §7.3 的断言：骨架变更只有 applyProposal 一条路径。
 *
 * 这条铁律靠人眼守不住——加个新命令、抄段旧代码，随手一个 writeFileSync 就绕过去了，
 * 而绕过去的表现是"人工确认莫名其妙还在生效"（instanceVersion 没跟着涨），
 * 比直接报错难查得多。所以把 grep 钉成测试。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

/** 该扫哪些目录：产品代码全扫，测试和依赖不算 */
const SCAN_DIRS = ['src', 'bin', 'integrations'];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      walk(p, out);
    } else if (e.name.endsWith('.js')) {
      out.push(p);
    }
  }
  return out;
}

const WRITE_CALLS = /\b(writeFileSync|writeFile|createWriteStream|renameSync|rename|appendFileSync|appendFile|unlinkSync|unlink|rmSync|rm|copyFileSync)\s*\(/;

/** 去掉注释：注释里提一嘴 skeleton.json 是允许的，不算写 */
function stripComments(line) {
  return line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
}

/**
 * 找出所有"往 skeleton.json 写"的行。
 *
 * 不能只按行 grep：真实的写法是先 `const target = statePath(dir, 'skeleton.json')`
 * 再 `fs.writeFileSync(target, …)`，字面量和写调用不在同一行。所以先把绑到骨架路径上的
 * 变量名收集起来（连 `${target}.tmp` 这种派生的一起），再看谁拿它去写。
 */
function findWrites() {
  const hits = [];
  for (const d of SCAN_DIRS) {
    const abs = path.join(ROOT, d);
    if (!fs.existsSync(abs)) continue;
    for (const file of walk(abs)) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      const bound = new Set();

      // 逐行往下走，边收集绑定边看写调用。
      // 必须一遍过而不是两遍：同一个短名（p、target）会在不同函数里指向不同文件，
      // 两遍扫会把 proposals/xx.json 的写当成骨架的写。重新赋值就解绑。
      lines.forEach((raw, i) => {
        const code = stripComments(raw);

        const decl = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=(.*)$/.exec(code);
        if (decl) {
          const [, name, rhs] = decl;
          const derived = [...bound].some((b) => new RegExp(`\\b${b}\\b`).test(rhs));
          if (/skeleton\.json/.test(rhs) || derived) bound.add(name);
          else bound.delete(name); // 换指别的文件了，从此不算骨架
        }

        if (!WRITE_CALLS.test(code)) return;
        const args = code.slice(code.indexOf('(') + 1);
        const touchesSkeleton =
          /skeleton\.json/.test(args) || [...bound].some((b) => new RegExp(`\\b${b}\\b`).test(args));
        if (!touchesSkeleton) return;
        hits.push({ file: path.relative(ROOT, file), line: i + 1, text: raw.trim() });
      });
    }
  }
  return hits;
}

test('§7.3：全仓库只有 recompile.js 写 skeleton.json', () => {
  const hits = findWrites();
  const files = [...new Set(hits.map((h) => h.file))];
  assert.deepEqual(
    files,
    ['src/kernel/recompile.js'],
    `除了 recompile.js 还有别的地方在写 skeleton.json：\n${hits
      .filter((h) => h.file !== 'src/kernel/recompile.js')
      .map((h) => `  ${h.file}:${h.line}  ${h.text}`)
      .join('\n')}`
  );
  assert.ok(hits.length > 0, 'grep 一条都没命中，说明扫的方式坏了，不是真的没人写');
});

test('§7.3：那些写操作都在 applyProposal 函数体内', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/kernel/recompile.js'), 'utf8');
  const lines = src.split('\n');

  // 定位 applyProposal 的行号区间：从 export 那行到下一个顶格 export 之前
  const start = lines.findIndex((l) => /^export function applyProposal\b/.test(l));
  assert.notEqual(start, -1, 'recompile.js 里找不到 applyProposal');
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^export (function|const|class)\b/.test(lines[i])) {
      end = i;
      break;
    }
  }

  const outside = findWrites().filter((h) => h.line < start + 1 || h.line >= end + 1);
  assert.deepEqual(
    outside,
    [],
    `recompile.js 里 applyProposal 之外也在写 skeleton.json：\n${outside
      .map((h) => `  ${h.file}:${h.line}  ${h.text}`)
      .join('\n')}`
  );
});
