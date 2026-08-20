import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  readAiConfig,
  writeAiConfig,
  publicAiConfig,
  isReady,
  normalizeBase,
  CHANNELS
} from '../src/kernel/ai-config.js';

test('normalizeBase 补全协议', () => {
  assert.strictEqual(normalizeBase('api.example.com'), 'https://api.example.com/v1');
  assert.strictEqual(normalizeBase('http://api.example.com'), 'http://api.example.com/v1');
});

test('normalizeBase 保留 v1', () => {
  assert.strictEqual(normalizeBase('https://api.example.com/v1'), 'https://api.example.com/v1');
  assert.strictEqual(normalizeBase('https://api.example.com/v2'), 'https://api.example.com/v2');
});

test('normalizeBase 去除尾斜杠', () => {
  assert.strictEqual(normalizeBase('https://api.example.com/'), 'https://api.example.com/v1');
  assert.strictEqual(normalizeBase('https://api.example.com/v1/'), 'https://api.example.com/v1');
});

test('normalizeBase 去除完整路径', () => {
  assert.strictEqual(
    normalizeBase('https://api.example.com/v1/chat/completions'),
    'https://api.example.com/v1'
  );
});

test('normalizeBase 空输入', () => {
  assert.strictEqual(normalizeBase(''), '');
  assert.strictEqual(normalizeBase(null), '');
});

test('readAiConfig 文件不存在返回默认值', () => {
  // 读取不存在的配置应该返回默认值
  // 由于 ai-config 使用 os.homedir()，我们无法轻易 mock，
  // 所以这个测试只验证默认值的结构
  const config = readAiConfig();
  assert.ok(config.channel);
  assert.strictEqual(typeof config.baseURL, 'string');
  assert.strictEqual(typeof config.apiKey, 'string');
  assert.strictEqual(typeof config.model, 'string');
  assert.ok(Array.isArray(config.knownModels));
});

test('writeAiConfig 保存配置', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-ai-'));
  const origHome = process.env.HOME;
  try {
    process.env.HOME = tmpHome;
    const saved = writeAiConfig({
      channel: 'openai-compat',
      baseURL: 'https://api.example.com',
      apiKey: 'sk-test123',
      model: 'gpt-4'
    });

    assert.strictEqual(saved.channel, 'openai-compat');
    assert.strictEqual(saved.baseURL, 'https://api.example.com');
    assert.strictEqual(saved.apiKey, 'sk-test123');
    assert.strictEqual(saved.model, 'gpt-4');

    const read = readAiConfig();
    assert.strictEqual(read.apiKey, 'sk-test123');
  } finally {
    process.env.HOME = origHome;
    fs.rmSync(tmpHome, { recursive: true });
  }
});

test('writeAiConfig 保留原有密钥', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-ai-'));
  const origHome = process.env.HOME;
  try {
    process.env.HOME = tmpHome;
    writeAiConfig({ apiKey: 'sk-original' });
    // 不传 apiKey 应该保留原值
    const updated = writeAiConfig({ model: 'gpt-3.5' });
    assert.strictEqual(updated.apiKey, 'sk-original');
    assert.strictEqual(updated.model, 'gpt-3.5');
  } finally {
    process.env.HOME = origHome;
    fs.rmSync(tmpHome, { recursive: true });
  }
});

test('writeAiConfig 清空密钥', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-ai-'));
  const origHome = process.env.HOME;
  try {
    process.env.HOME = tmpHome;
    writeAiConfig({ apiKey: 'sk-original' });
    // 空字符串清空密钥
    const updated = writeAiConfig({ apiKey: '' });
    assert.strictEqual(updated.apiKey, '');
  } finally {
    process.env.HOME = origHome;
    fs.rmSync(tmpHome, { recursive: true });
  }
});

test('writeAiConfig 修剪空白', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-ai-'));
  const origHome = process.env.HOME;
  try {
    process.env.HOME = tmpHome;
    const saved = writeAiConfig({
      baseURL: '  https://api.example.com  ',
      model: '  gpt-4  '
    });
    assert.strictEqual(saved.baseURL, 'https://api.example.com');
    assert.strictEqual(saved.model, 'gpt-4');
  } finally {
    process.env.HOME = origHome;
    fs.rmSync(tmpHome, { recursive: true });
  }
});

test('writeAiConfig 限制 knownModels 数量', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-ai-'));
  const origHome = process.env.HOME;
  try {
    process.env.HOME = tmpHome;
    const models = Array.from({ length: 300 }, (_, i) => `model-${i}`);
    const saved = writeAiConfig({ knownModels: models });
    assert.strictEqual(saved.knownModels.length, 200);
  } finally {
    process.env.HOME = origHome;
    fs.rmSync(tmpHome, { recursive: true });
  }
});

test('publicAiConfig 不暴露密钥', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-ai-'));
  const origHome = process.env.HOME;
  try {
    process.env.HOME = tmpHome;
    writeAiConfig({ apiKey: 'sk-secret' });
    const pub = publicAiConfig();
    assert.strictEqual(pub.hasKey, true);
    assert.strictEqual(pub.apiKey, undefined);
  } finally {
    process.env.HOME = origHome;
    fs.rmSync(tmpHome, { recursive: true });
  }
});

test('publicAiConfig 包含 channels 列表', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-ai-'));
  const origHome = process.env.HOME;
  try {
    process.env.HOME = tmpHome;
    const pub = publicAiConfig();
    assert.ok(Array.isArray(pub.channels));
    assert.ok(pub.channels.length > 0);
    assert.ok(pub.channels.some(c => c.id === 'claude-cli'));
  } finally {
    process.env.HOME = origHome;
    fs.rmSync(tmpHome, { recursive: true });
  }
});

test('isReady claude-cli 总是就绪', () => {
  assert.strictEqual(isReady({ channel: 'claude-cli' }), true);
});

test('isReady openai-compat 需要完整配置', () => {
  assert.strictEqual(isReady({
    channel: 'openai-compat',
    baseURL: '',
    apiKey: '',
    model: ''
  }), false);

  assert.strictEqual(isReady({
    channel: 'openai-compat',
    baseURL: 'https://api.example.com',
    apiKey: 'sk-test',
    model: 'gpt-4'
  }), true);
});

test('CHANNELS 包含预期通道', () => {
  assert.ok(CHANNELS['claude-cli']);
  assert.ok(CHANNELS['openai-compat']);
  assert.strictEqual(CHANNELS['claude-cli'].needsKey, false);
  assert.strictEqual(CHANNELS['openai-compat'].needsKey, true);
});
