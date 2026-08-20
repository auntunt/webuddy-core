import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  parseFrontmatter,
  sectionsOf,
  parseTables,
  isFilled,
  colIndex,
  columnHasBlank,
  countListItems,
  hasMeasurableNumber,
  findBannedWords,
  extractACCodes
} from '../src/kernel/parse.js';

test('parseFrontmatter 解析基本 frontmatter', () => {
  const text = `---
title: 测试文档
date: 2026-08-20
---
# 正文内容`;

  const { meta, body } = parseFrontmatter(text);
  assert.strictEqual(meta.title, '测试文档');
  assert.strictEqual(meta.date, '2026-08-20');
  assert.ok(body.includes('# 正文内容'));
});

test('parseFrontmatter 无 frontmatter', () => {
  const text = '# 直接开始的文档';
  const { meta, body } = parseFrontmatter(text);
  assert.deepStrictEqual(meta, {});
  assert.strictEqual(body, text);
});

test('sectionsOf 提取章节', () => {
  const body = `## 功能描述
这是功能描述的内容。

## 验收标准
这是验收标准的内容。

### 子标题
子内容`;

  const sections = sectionsOf(body);
  assert.strictEqual(sections.size, 3);
  assert.ok(sections.get('功能描述').includes('功能描述的内容'));
  assert.ok(sections.get('验收标准').includes('验收标准的内容'));
});

test('sectionsOf 去除编号前缀', () => {
  const body = `## 1. 第一章
内容一

## 二、第二章
内容二

## 3）第三章
内容三`;

  const sections = sectionsOf(body);
  assert.ok(sections.has('第一章'));
  assert.ok(sections.has('第二章'));
  assert.ok(sections.has('第三章'));
});

test('parseTables 解析表格', () => {
  const body = `## 数据字典

| 字段名 | 类型 | 必填 |
|---|---|---|
| 用户名 | 文本 | 是 |
| 年龄 | 数字 | 否 |

其他内容`;

  const tables = parseTables(body);
  assert.strictEqual(tables.length, 1);
  assert.deepStrictEqual(tables[0].headers, ['字段名', '类型', '必填']);
  assert.strictEqual(tables[0].rows.length, 2);
  assert.strictEqual(tables[0].rows[0][0], '用户名');
});

test('parseTables 跳过占位符行', () => {
  const body = `| 字段 | 类型 |
|---|---|
| <示例> | <示例类型> |
| 真实字段 | 文本 |`;

  const tables = parseTables(body);
  assert.strictEqual(tables[0].rows.length, 1);
  assert.strictEqual(tables[0].rows[0][0], '真实字段');
});

test('isFilled 判断是否已填', () => {
  assert.strictEqual(isFilled('这是有内容的文本'), true);
  assert.strictEqual(isFilled('待填'), false);
  assert.strictEqual(isFilled('TODO'), false);
  assert.strictEqual(isFilled('<示例>'), false);
  assert.strictEqual(isFilled('   '), false);
  assert.strictEqual(isFilled('---'), false);
  assert.strictEqual(isFilled(''), false);
});

test('colIndex 查找列索引', () => {
  const headers = ['字段名', '类型', '是否必填'];
  assert.strictEqual(colIndex(headers, '类型'), 1);
  assert.strictEqual(colIndex(headers, '必填'), 2);
  assert.strictEqual(colIndex(headers, '不存在'), -1);
});

test('columnHasBlank 检测空格', () => {
  const table = {
    headers: ['名称', '值'],
    rows: [
      ['项目1', '值1'],
      ['项目2', ''],
      ['项目3', '值3']
    ]
  };

  assert.strictEqual(columnHasBlank(table, '名称'), false);
  assert.strictEqual(columnHasBlank(table, '值'), true);
});

test('countListItems 计数列表项', () => {
  const text = `
- 第一项
- 第二项
- 第三项

1. 编号项一
2. 编号项二
`;

  const count = countListItems(text);
  assert.strictEqual(count, 5);
});

test('countListItems 忽略占位符', () => {
  const text = `
- 真实项
- <待填>
- <示例>
`;

  const count = countListItems(text);
  assert.strictEqual(count, 1);
});

test('hasMeasurableNumber 检测可测量数字', () => {
  assert.strictEqual(hasMeasurableNumber('响应时间小于 500 毫秒'), false); // 没有常见单位
  assert.strictEqual(hasMeasurableNumber('3 天内完成'), true);
  assert.strictEqual(hasMeasurableNumber('用户增长 20%'), true);
  assert.strictEqual(hasMeasurableNumber('从 100 个降到 50 个'), true);
  assert.strictEqual(hasMeasurableNumber('没有数字'), false);
});

test('findBannedWords 查找禁用词', () => {
  const text = '系统应该友好、快速、稳定地处理用户请求';
  const banned = findBannedWords(text);
  assert.ok(banned.includes('友好'));
  assert.ok(banned.includes('快速'));
  assert.ok(banned.includes('稳定'));
});

test('findBannedWords 无禁用词', () => {
  const text = '系统在 3 秒内返回结果';
  const banned = findBannedWords(text);
  assert.strictEqual(banned.length, 0);
});

test('extractACCodes 提取 AC 编号', () => {
  const text = '参见 AC-001 和 AC-023，另外 AC42 也相关';
  const codes = extractACCodes(text);
  assert.ok(codes.includes('AC-001'));
  assert.ok(codes.includes('AC-023'));
  assert.ok(codes.includes('AC-042'));
});

test('extractACCodes 自动补零', () => {
  const text = 'AC-5 和 AC5 都应该识别';
  const codes = extractACCodes(text);
  assert.ok(codes.includes('AC-005'));
});
