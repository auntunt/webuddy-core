/**
 * HTTP API（§8.1）：零依赖 http.createServer。
 *
 * 与 CLI 共用同一条判定链：evaluate → buildVerdict。
 * 两边都不许各拼一套 JSON——CI 里 `webuddy check --json` 和 POST /v1/check
 * 的输出要能直接 diff，一旦有一边自己组装字段，diff 就永远不空。
 *
 * 鉴权与 CORS 三条（§8.1，新设计，不照抄 ref）：
 *   1. CORS 只控制浏览器放行，不豁免鉴权：所有 origin（含 null）一律要
 *      Authorization: Bearer <token>，401 优先于 CORS 报错。
 *   2. OPTIONS 预检命中 --allow-origin 时返回 204 + 三个 Allow 头。
 *   3. --allow-origin null 必须与显式 --token 同给（校验在 cmd-serve）。
 *
 * 机器输出不过 applyGlossary（§铁律）：--json / HTTP 是给程序看的，
 * 术语替换只在人读界面做。
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { evaluate } from '../kernel/evaluate.js';
import { buildVerdict } from '../kernel/verdict.js';
import { loadPack } from '../kernel/pack.js';
import { appendRecord, statePath } from '../kernel/state.js';
import { roundStatus } from '../kernel/rounds.js';

const MAX_BODY = 1_000_000; // 1MB：判定请求只有几个字段，超了就是喂错东西

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('请求体太大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJSON(res, status, data) {
  // 尾部换行：CLI 用 console.log 输出，两边要能逐字节 diff
  const body = JSON.stringify(data, null, 2) + '\n';
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** 错误 body 一律 {error: 大白话}（§8.1） */
function sendError(res, status, message) {
  sendJSON(res, status, { error: message });
}

/** 挂过担架没有：没挂就没有可查的东西，这是 404 而不是空结果 */
function isMounted(dir) {
  return fs.existsSync(statePath(dir, 'records.jsonl'))
    || fs.existsSync(statePath(dir, 'state.json'));
}

async function resolvePack(packRef) {
  const dir = packRef || 'packs/software-engineering';
  if (!fs.existsSync(dir)) {
    return { code: 404, why: `找不到 ${dir} 这个检查清单` };
  }
  const r = await loadPack(dir);
  if (!r.ok) {
    return { code: 422, why: `这个检查清单本身有问题：${(r.errors || []).join('；')}` };
  }
  return { pack: r.pack };
}

/**
 * 建服务。token 从外面传进来（每次启动重生成、不落盘的生命周期归 cmd-serve）。
 */
export function createApiServer({ token, allowOrigin = null } = {}) {
  if (!token) throw new Error('createApiServer 要一个 token');

  return http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://127.0.0.1');
    } catch {
      sendError(res, 404, '这个地址读不出来');
      return;
    }
    const pathname = url.pathname;

    // 预检：不带 Authorization 也要能过，否则浏览器连正式请求都发不出去。
    // 这不是鉴权豁免——预检不返回任何数据。
    if (req.method === 'OPTIONS') {
      if (allowOrigin) {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': allowOrigin,
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Allow-Methods': 'GET, POST',
        });
      } else {
        res.writeHead(204);
      }
      res.end();
      return;
    }

    // 401 优先于 CORS：跨源与否都得先有口令
    const auth = req.headers.authorization || '';
    const given = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!given || given !== token) {
      if (allowOrigin) res.setHeader('Access-Control-Allow-Origin', allowOrigin);
      sendError(res, 401, '口令不对，或者没带口令');
      return;
    }

    if (allowOrigin) res.setHeader('Access-Control-Allow-Origin', allowOrigin);

    try {
      // POST /v1/check
      if (req.method === 'POST' && pathname === '/v1/check') {
        let body = {};
        const raw = await readBody(req);
        if (raw) {
          try { body = JSON.parse(raw); } catch { sendError(res, 422, '请求体不是能读的 JSON'); return; }
        }
        const projectDir = body.project;
        if (!projectDir) {
          sendError(res, 422, '要说清查的是哪个项目（project 填项目目录）');
          return;
        }
        if (!fs.existsSync(projectDir)) {
          sendError(res, 404, `找不到 ${projectDir} 这个目录`);
          return;
        }
        if (!isMounted(projectDir)) {
          sendError(res, 404, `${projectDir} 还没挂上检查清单，没有可查的东西`);
          return;
        }
        const pr = await resolvePack(body.pack);
        if (pr.code) { sendError(res, pr.code, pr.why); return; }

        const scope = body.scope || 'all';
        let round = null;
        const sid = body.session || (/^round:(.+)$/.exec(scope)?.[1] ?? null);
        if (sid) {
          const rs = roundStatus(projectDir);
          round = (rs?.rounds || []).find((r) => r.sessionId === sid) || null;
        }

        const evalResult = evaluate(projectDir, pack_(pr), { scope, round });
        const verdict = buildVerdict(evalResult, pack_(pr));

        // records 落盘归调用层（§铁律：evaluate 是纯函数）
        try {
          appendRecord(projectDir, {
            kind: 'evaluate',
            scope,
            counts: verdict.counts,
            verdict: verdict.verdict,
            gateIds: {
              fail: evalResult.gates.filter((v) => v.r === 'fail').map((v) => v.id),
              ask: evalResult.gates.filter((v) => v.r === 'ask').map((v) => v.id),
            },
          });
        } catch {
          // 记不下留痕不该让人看不到结论
        }

        sendJSON(res, 200, verdict);
        return;
      }

      // GET /v1/rounds?project=…
      if (req.method === 'GET' && pathname === '/v1/rounds') {
        const projectDir = url.searchParams.get('project');
        if (!projectDir) {
          sendError(res, 422, '要说清查的是哪个项目（project 填项目目录）');
          return;
        }
        if (!fs.existsSync(projectDir)) {
          sendError(res, 404, `找不到 ${projectDir} 这个目录`);
          return;
        }
        // 跟 /v1/packs 一样包一层：裸数组以后加不了字段
        sendJSON(res, 200, { rounds: roundStatus(projectDir) });
        return;
      }

      // POST /v1/human-confirm {project, gateId, note}
      if (req.method === 'POST' && pathname === '/v1/human-confirm') {
        let body = {};
        const raw = await readBody(req);
        if (raw) {
          try { body = JSON.parse(raw); } catch { sendError(res, 422, '请求体不是能读的 JSON'); return; }
        }
        const projectDir = body.project;
        const gateId = body.gateId;
        if (!projectDir) {
          sendError(res, 422, '要说清确认的是哪个项目（project 填项目目录）');
          return;
        }
        if (!gateId) {
          sendError(res, 422, '要说清确认的是哪一条检查（gateId）');
          return;
        }
        if (!fs.existsSync(projectDir)) {
          sendError(res, 404, `找不到 ${projectDir} 这个目录`);
          return;
        }
        const pr = await resolvePack(body.pack);
        if (pr.code) { sendError(res, pr.code, pr.why); return; }

        const gate = (pack_(pr).gates || []).find((g) => g.id === gateId);
        if (!gate) {
          sendError(res, 404, `这份清单里没有 ${gateId} 这条检查`);
          return;
        }

        // appendRecord 自带当前 instanceVersion：清单以后改了，这条确认自动失效
        appendRecord(projectDir, {
          kind: 'human-confirm',
          gateId,
          result: 'pass',
          by: body.by || 'api',
          note: body.note || '',
        });

        // 重判该门禁，把结论回给调用方
        const evalResult = evaluate(projectDir, pack_(pr), { scope: `gate:${gateId}` });
        const verdict = buildVerdict(evalResult, pack_(pr));
        sendJSON(res, 200, verdict);
        return;
      }

      // GET /v1/packs
      if (req.method === 'GET' && pathname === '/v1/packs') {
        const packsDir = path.resolve(process.cwd(), 'packs');
        const packs = [];
        if (fs.existsSync(packsDir)) {
          for (const ent of fs.readdirSync(packsDir, { withFileTypes: true })) {
            if (!ent.isDirectory()) continue;
            const metaPath = path.join(packsDir, ent.name, 'pack.json');
            if (!fs.existsSync(metaPath)) continue;
            try {
              const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
              packs.push({
                name: meta.name || ent.name,
                version: meta.version || '',
                title: meta.title || '',
                path: `packs/${ent.name}`,
              });
            } catch {
              // 坏包不该让整张列表打不开
            }
          }
        }
        sendJSON(res, 200, { packs });
        return;
      }

      sendError(res, 404, `没有 ${req.method} ${pathname} 这个接口`);
    } catch (e) {
      sendError(res, 500, `服务这边出错了：${e.message}`);
    }
  });
}

/** resolvePack 的结果取包对象 */
function pack_(pr) {
  return pr.pack;
}
