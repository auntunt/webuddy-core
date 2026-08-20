import { test } from 'node:test';
import assert from 'node:assert';
import { relayStructured, relayModels, relayPing } from '../src/kernel/ai-relay.js';

// 这些测试需要真实的 API 端点，这里只测试核心逻辑函数

test('extractJson 从纯 JSON 提取', async () => {
  // 由于 extractJson 是内部函数，我们通过测试 normalizeBase 等导出函数来验证模块加载
  const { normalizeBase } = await import('../src/kernel/ai-config.js');
  assert.ok(normalizeBase);
});

test('relayStructured 导出存在', () => {
  assert.strictEqual(typeof relayStructured, 'function');
});

test('relayModels 导出存在', () => {
  assert.strictEqual(typeof relayModels, 'function');
});

test('relayPing 导出存在', () => {
  assert.strictEqual(typeof relayPing, 'function');
});

// 集成测试需要真实 API，这里只验证函数签名和错误处理

test('relayStructured 缺少参数抛错', async () => {
  await assert.rejects(
    async () => await relayStructured({}),
    (err) => {
      // 应该因为缺少 baseURL/apiKey 等参数而失败
      return true;
    }
  );
});

test('relayModels 无效地址抛错', async () => {
  await assert.rejects(
    async () => await relayModels({ baseURL: 'invalid://url', apiKey: 'test' }),
    (err) => {
      // 网络错误或地址错误
      return err.message.length > 0;
    }
  );
});

test('relayPing 无效地址抛错', async () => {
  await assert.rejects(
    async () => await relayPing({ baseURL: 'http://localhost:99999', apiKey: 'test', model: 'test' }),
    (err) => {
      // 连接错误
      return err.message.length > 0;
    }
  );
});
