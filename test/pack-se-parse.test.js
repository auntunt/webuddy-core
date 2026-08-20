/**
 * 软件工程包自己的文本解析：可测量单位、禁用形容词、AC- 编号。
 *
 * 这三样为什么在包里测、不在内核里测：
 * 它们认识的是软件工程的词。"分钟/小时/条/人/%"是这一行写指标的习惯单位，
 * "友好/快速/稳定"是这一行验收标准里最常见的空话，AC- 是这一行给验收标准编号的写法。
 * 换成施工安全包，这三份清单全都要换。所以内核只留 findWords（词表由包传进来），
 * 具体清单和测试都归包。
 */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  ALLOWED_FIELD_TYPES,
  BANNED_WORDS,
  ALLOWED_TEST_LEVELS,
  hasMeasurableNumber,
  findBannedWords,
  extractACCodes
} from '../packs/software-engineering/lib/parse.js';

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

test('禁用词表不含「及时」', () => {
  // 「及时处理」「及时通知」在业务文档里是正常中文，
  // 加进词表会打掉大量没问题的验收标准（见 lib/parse.js 里的说明）。
  assert.ok(!BANNED_WORDS.includes('及时'));
  assert.strictEqual(BANNED_WORDS.length, 22);
});

test('字段类型和测试层级清单是包自己的', () => {
  assert.ok(ALLOWED_FIELD_TYPES.includes('长文本'));
  assert.deepStrictEqual(ALLOWED_TEST_LEVELS, ['单元', '集成', '端到端']);
});
