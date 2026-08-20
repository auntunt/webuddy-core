/**
 * OpenAI 兼容中转通道。
 *
 * 只用 fetch，不加依赖。两件事值得先说清楚：
 *
 * 一、结构化输出要能降级。官方接口认 response_format:json_schema，
 *     但多数中转站只认 json_object，还有一批两个都不认。所以先按最严的发，
 *     被拒了就退一档再发，最后一档靠提示词要求纯 JSON、自己从正文里抠。
 *     不降级的话，用户看到的只是「模型返回无法读取」，根本不知道是中转站不支持。
 *
 * 二、错误要说人话。中转站的 401/402/429 对文科生毫无意义，
 *     这里翻译成「密钥不对」「余额不够」「太频繁」。
 */

import { normalizeBase } from './ai-config.js';

const TIMEOUT_MS = 90_000;

/**
 * fetch 失败时 message 只有一句 "fetch failed"，真正的原因在 cause 里。
 * 照原样抛出去，用户看到的是一句他无法采取任何行动的话。
 */
function networkReason(e) {
  const code = e?.cause?.code || e?.code || '';
  const map = {
    ENOTFOUND: '这个网址不存在，检查一下有没有打错',
    ECONNREFUSED: '对方拒绝了连接，地址或端口可能不对',
    ETIMEDOUT: '连接超时，可能是网络不通或者要走代理',
    ECONNRESET: '连接被中断，重试一次看看',
    CERT_HAS_EXPIRED: '对方的安全证书过期了',
    DEPTH_ZERO_SELF_SIGNED_CERT: '对方用的是自签证书，浏览器和这里都不信任',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: '对方的安全证书验不过',
  };
  if (map[code]) return map[code];
  const detail = e?.cause?.message || e?.message || '原因不明';
  return code ? `${detail}（${code}）` : detail;
}

function friendlyError(status, body) {
  const raw = String(body || '').slice(0, 300);
  const detail = raw ? `（接口原话：${raw}）` : '';
  if (status === 401 || status === 403) return `密钥不对或没有权限${detail}`;
  if (status === 402) return `中转站余额不够了${detail}`;
  if (status === 404) return `地址不对：这个中转站上没有这个模型或这个路径${detail}`;
  if (status === 429) return `请求太频繁，等一会儿再点${detail}`;
  if (status >= 500) return `中转站自己出错了${detail}`;
  return `接口返回 ${status}${detail}`;
}

async function callOnce({ baseURL, apiKey, model, prompt, schema, mode }) {
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
  };
  if (mode === 'schema') {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: 'webuddy_recommendation', strict: true, schema },
    };
  } else if (mode === 'json') {
    body.response_format = { type: 'json_object' };
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${normalizeBase(baseURL)}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error(`模型 ${TIMEOUT_MS / 1000} 秒内没有返回`);
    throw new Error(`连不上这个地址：${networkReason(e)}`);
  }
  clearTimeout(timer);

  const text = await res.text();
  if (!res.ok) {
    const err = new Error(friendlyError(res.status, text));
    err.status = res.status;
    err.body = text;
    throw err;
  }
  let wrapper;
  try { wrapper = JSON.parse(text); } catch { throw new Error('中转站返回的不是 JSON'); }
  const content = wrapper.choices?.[0]?.message?.content;
  if (!content) throw new Error('模型没有返回内容');
  return { content, usage: wrapper.usage || null, model: wrapper.model || model };
}

/** 模型有时会在 JSON 外面裹一层 ```json 或者一句寒暄，抠出最外层那个对象。 */
function extractJson(text) {
  const s = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(s); } catch { /* 继续找 */ }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(s.slice(start, end + 1)); } catch { /* 抠不出来 */ }
  }
  throw new Error('模型返回的不是能读的 JSON');
}

/** 这个错误是不是「中转站不支持这种结构化输出」——只有这种才值得降级重试。 */
function isFormatUnsupported(e) {
  if (!e.status) return false;
  if (e.status !== 400 && e.status !== 404 && e.status !== 422) return false;
  return /response_format|json_schema|json_object|schema|not support/i.test(String(e.body || e.message));
}

/**
 * 走中转站要一份结构化建议。
 * 三档依次降级：json_schema → json_object → 纯提示词。
 */
export async function relayStructured({ baseURL, apiKey, model, prompt, schema }) {
  const modes = ['schema', 'json', 'plain'];
  let lastErr = null;
  for (const mode of modes) {
    // 最后一档没有格式约束可用，只能在提示词里再要一次纯 JSON。
    const p = mode === 'plain'
      ? `${prompt}\n\n只输出一个 JSON 对象，不要加解释，不要用 \`\`\` 包裹。`
      : prompt;
    try {
      const out = await callOnce({ baseURL, apiKey, model, prompt: p, schema, mode });
      return {
        value: extractJson(out.content),
        model: out.model,
        // 中转站的计费口径各不相同，这里不猜钱数，只回 token 数。
        usage: out.usage,
        formatMode: mode,
      };
    } catch (e) {
      lastErr = e;
      if (isFormatUnsupported(e)) continue; // 换下一档
      throw e;                              // 密钥、余额、网络这类换档也没用
    }
  }
  throw lastErr || new Error('模型没能生成建议');
}

/**
 * 拉模型清单，给设置页那个下拉框用。
 * 拉不到不算配置错误——不少中转站压根没开 /models，手填模型名照样能用。
 */
export async function relayModels({ baseURL, apiKey }) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20_000);
  try {
    let res;
    try {
      res = await fetch(`${normalizeBase(baseURL)}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: ctl.signal,
      });
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('20 秒内没有返回');
      throw new Error(networkReason(e));
    }
    const text = await res.text();
    if (!res.ok) throw new Error(friendlyError(res.status, text));
    const data = JSON.parse(text);
    const ids = (data.data || data.models || [])
      .map((m) => (typeof m === 'string' ? m : m.id || m.name))
      .filter(Boolean);
    return [...new Set(ids)].sort();
  } finally { clearTimeout(timer); }
}

/** 连通性自检：拿最便宜的一次调用验「地址 + 密钥 + 模型」三件事同时成立。 */
export async function relayPing({ baseURL, apiKey, model }) {
  const out = await callOnce({
    baseURL, apiKey, model, mode: 'plain',
    prompt: '只回复两个字：可用',
    schema: null,
  });
  // 压成一行再截断：模型偶尔会回一整段带换行的话，
  // 原样塞进设置页那一行提示里会把弹窗底部顶变形。
  //
  // 先扒掉 ``` 围栏：这句话是给人看的「通了没有」，
  // 露出一段代码围栏只会让人以为哪里出错了。
  const reply = String(out.content)
    .replace(/```[a-z]*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { reply: reply.length > 40 ? `${reply.slice(0, 40)}…` : reply, model: out.model };
}
