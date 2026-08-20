import { test } from 'node:test';
import assert from 'node:assert';
import { tokenize, parseProbe, suggest, levenshtein } from '../src/kernel/probe-dsl.js';

// ===== Levenshtein 与 suggest =====

test('levenshtein 计算距离', () => {
  assert.strictEqual(levenshtein('cat', 'cat'), 0);
  assert.strictEqual(levenshtein('cat', 'bat'), 1);
  assert.strictEqual(levenshtein('', 'abc'), 3);
  assert.strictEqual(levenshtein('abc', ''), 3);
});

test('suggest 找最近候选', () => {
  const candidates = ['file-exists', 'section-filled', 'table-column-filled'];
  assert.strictEqual(suggest('file-exist', candidates), 'file-exists');
  assert.strictEqual(suggest('section-fill', candidates), 'section-filled');
  assert.strictEqual(suggest('xyz', candidates), null); // 距离太远
});

// ===== Tokenize =====

test('tokenize 基本 token', () => {
  const tokens = tokenize('file-exists("test.md")');
  assert.strictEqual(tokens.length, 4);
  assert.strictEqual(tokens[0].type, 'IDENT');
  assert.strictEqual(tokens[0].value, 'file-exists');
  assert.strictEqual(tokens[1].type, '(');
  assert.strictEqual(tokens[2].type, 'STRING');
  assert.strictEqual(tokens[2].value, 'test.md');
  assert.strictEqual(tokens[3].type, ')');
});

test('tokenize 数字与逗号', () => {
  const tokens = tokenize('count-at-least("doc.md", "列表项", 5)');
  assert.ok(tokens.some(t => t.type === 'NUMBER' && t.value === '5'));
  assert.ok(tokens.some(t => t.type === ','));
});

test('tokenize 字符串转义', () => {
  const tokens = tokenize('regex-hit("a.md", "say \\"hello\\"")');
  const strToken = tokens.find(t => t.value.includes('hello'));
  assert.ok(strToken);
  assert.ok(strToken.value.includes('"'));
});

test('tokenize 跳过注释', () => {
  const tokens = tokenize('all(\n  // comment\n  file-exists("a")  # another\n)');
  assert.ok(!tokens.some(t => t.value.includes('comment')));
});

test('tokenize 多行', () => {
  const src = `all(
    file-exists("a.md"),
    section-filled("a.md", "标题")
  )`;
  const tokens = tokenize(src);
  assert.ok(tokens.some(t => t.line === 2));
  assert.ok(tokens.some(t => t.line === 3));
});

// ===== ParseProbe 成功解析 =====

test('parseProbe 单个原语', () => {
  const result = parseProbe('file-exists("test.md")');
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.ast.fn, 'file-exists');
  assert.strictEqual(result.ast.args.length, 1);
  assert.strictEqual(result.ast.args[0].type, 'string');
  assert.strictEqual(result.ast.args[0].value, 'test.md');
});

test('parseProbe 多参数', () => {
  const result = parseProbe('count-at-least("doc.md", "列表项", 10)');
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.ast.args.length, 3);
  assert.strictEqual(result.ast.args[2].type, 'number');
  assert.strictEqual(result.ast.args[2].value, 10);
});

test('parseProbe 嵌套表达式', () => {
  const result = parseProbe('all(file-exists("a"), section-filled("a", "标题"))');
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.ast.fn, 'all');
  assert.strictEqual(result.ast.args.length, 2);
  assert.strictEqual(result.ast.args[0].type, 'expr');
  assert.strictEqual(result.ast.args[0].value.fn, 'file-exists');
});

test('parseProbe 三层嵌套', () => {
  const result = parseProbe('any(all(file-exists("a"), file-exists("b")), file-exists("c"))');
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.ast.fn, 'any');
  assert.strictEqual(result.ast.args[0].value.fn, 'all');
});

// ===== ParseProbe 错误处理(8 种语法错误) =====

test('错误1:未知原语', () => {
  const result = parseProbe('file-exist("test.md")');
  assert.strictEqual(result.ok, false);
  assert.ok(result.why.includes('file-exist'));
  assert.ok(result.why.includes('file-exists')); // Levenshtein 建议
});

test('错误2:缺少左括号', () => {
  const result = parseProbe('file-exists"test.md")');
  assert.strictEqual(result.ok, false);
  assert.ok(result.why.includes('左括号'));
});

test('错误3:参数列表未闭合', () => {
  const result = parseProbe('file-exists("test.md"');
  assert.strictEqual(result.ok, false);
  assert.ok(result.why.includes('闭合'));
});

test('错误4:参数个数过少', () => {
  const result = parseProbe('section-filled("test.md")');
  assert.strictEqual(result.ok, false);
  assert.ok(result.why.includes('至少需要'));
});

test('错误5:参数个数过多', () => {
  const result = parseProbe('not(file-exists("a"), file-exists("b"))');
  assert.strictEqual(result.ok, false);
  assert.ok(result.why.includes('最多'));
});

test('错误6:参数类型错误', () => {
  const result = parseProbe('count-at-least("doc.md", "列表项", "abc")');
  assert.strictEqual(result.ok, false);
  assert.ok(result.why.includes('应该是数字'));
});

test('错误7:缺少逗号分隔', () => {
  const result = parseProbe('all(file-exists("a") file-exists("b"))');
  assert.strictEqual(result.ok, false);
  assert.ok(result.why.includes('逗号'));
});

test('错误8:表达式后有多余内容', () => {
  const result = parseProbe('file-exists("test.md") extra');
  assert.strictEqual(result.ok, false);
  assert.ok(result.why.includes('多余'));
});

// ===== 边界情况 =====

test('parseProbe 中文字符串', () => {
  const result = parseProbe('section-filled("需求文档.md", "功能描述")');
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.ast.args[0].value, '需求文档.md');
  assert.strictEqual(result.ast.args[1].value, '功能描述');
});

test('parseProbe 空格与换行', () => {
  const src = `all(
    file-exists("a.md"),
    file-exists("b.md")
  )`;
  const result = parseProbe(src);
  assert.strictEqual(result.ok, true);
});

test('parseProbe not 单参数', () => {
  const result = parseProbe('not(file-exists("bad.md"))');
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.ast.fn, 'not');
  assert.strictEqual(result.ast.args.length, 1);
});
