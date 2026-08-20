/**
 * 大模型接入配置。
 *
 * 两种通道：
 *   claude-cli    —— 本机装好的 Claude Code，不用填密钥，但要求本机能直连官方接口
 *   openai-compat —— 任何「OpenAI 兼容」的中转地址，填地址 + 密钥 + 模型名
 *
 * 存在 ~/.webuddy/ai.json，权限 0600。密钥只出不进：读接口一律只回
 * hasKey 布尔值，不回原文——看板是个 HTTP 服务，密钥进了响应就进了浏览器
 * 缓存和各种日志，再也收不回来。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CONFIG_DIR = path.join(os.homedir(), '.webuddy');
const FILE = path.join(CONFIG_DIR, 'ai.json');

export const CHANNELS = {
  'claude-cli': { name: '本机 Claude Code', needsKey: false },
  'openai-compat': { name: '中转接口（OpenAI 兼容）', needsKey: true },
};

/** 常见中转站都按 OpenAI 那套路径走，这里只存到 /v1 为止，后面自己拼。 */
const DEFAULTS = {
  channel: 'claude-cli',
  baseURL: '',
  apiKey: '',
  model: '',
  // 上次成功拉取到的模型清单。存下来是为了断网时下拉框里还有东西可选，
  // 而不是变成一个空框让人以为配置丢了。
  knownModels: [],
};

export function readAiConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { ...DEFAULTS, ...raw };
  } catch { return { ...DEFAULTS }; }
}

/**
 * 保存。patch 里没给 apiKey 就保留原有的——
 * 前端永远拿不到密钥原文，如果不这样，用户每改一次模型名都得重新贴一遍密钥。
 */
export function writeAiConfig(patch) {
  const cur = readAiConfig();
  const next = { ...cur };
  for (const k of ['channel', 'baseURL', 'model']) {
    if (patch[k] !== undefined) next[k] = String(patch[k] || '').trim();
  }
  if (Array.isArray(patch.knownModels)) next.knownModels = patch.knownModels.slice(0, 200);
  // 空字符串是「清空密钥」，undefined 是「这次不改密钥」。两件事必须分开。
  if (patch.apiKey !== undefined) next.apiKey = String(patch.apiKey).trim();
  if (!CHANNELS[next.channel]) next.channel = 'claude-cli';

  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(FILE, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  // 已经存在的文件 writeFileSync 不会改权限，显式再收一次。
  try { fs.chmodSync(FILE, 0o600); } catch { /* 某些文件系统不支持，不致命 */ }
  return next;
}

/** 给界面看的版本：绝不含密钥原文。 */
export function publicAiConfig() {
  const c = readAiConfig();
  return {
    channel: c.channel,
    baseURL: c.baseURL,
    model: c.model,
    knownModels: c.knownModels,
    hasKey: Boolean(c.apiKey),
    channels: Object.entries(CHANNELS).map(([id, v]) => ({ id, ...v })),
    ready: isReady(c),
  };
}

/** 这套配置现在能不能真的发出去一次请求。 */
export function isReady(c = readAiConfig()) {
  if (c.channel === 'openai-compat') return Boolean(c.baseURL && c.apiKey && c.model);
  return true; // claude-cli 能不能用要现场找二进制，那件事由 recommend.js 判
}

/** 把用户贴进来的地址补齐成可以拼路径的形态。中转站的文档五花八门，
 *  有人给 https://x.com，有人给 https://x.com/v1，还有人直接给带
 *  /chat/completions 的完整地址——都得能用。 */
export function normalizeBase(input) {
  let s = String(input || '').trim().replace(/\s+/g, '');
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  s = s.replace(/\/+$/, '');
  s = s.replace(/\/chat\/completions$/i, '');
  if (!/\/v\d+$/i.test(s)) s = `${s}/v1`;
  return s;
}
