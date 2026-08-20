import http from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluate } from '../src/kernel/evaluate.js';
import { loadPack } from '../src/kernel/pack.js';
import { appendRecord } from '../src/kernel/state.js';
import { roundStatus } from '../src/kernel/rounds.js';
import { readdirSync, existsSync } from 'node:fs';

/**
 * server/api.js — 零依赖 HTTP API
 *
 * 端点:
 *   POST /v1/check         — 运行判定，返回 buildVerdict 结果
 *   GET  /v1/rounds        — 查询轮次状态
 *   POST /v1/human-confirm — 记录人工确认并重判该门禁
 *   GET  /v1/packs         — 列出可用的包
 *
 * 鉴权: Authorization: Bearer <token>
 * CORS: --allow-origin 控制预检响应，但所有 origin 均需鉴权
 */

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data, null, 2) + '\n');
}

function sendError(res, status, message) {
  sendJSON(res, status, { error: message });
}

export function createServer({ token, allowOrigin }) {
  return http.createServer(async (req, res) => {
    const { method, url } = req;
    const parsedUrl = new URL(url, 'http://localhost');
    const pathname = parsedUrl.pathname;

    // CORS 预检
    if (method === 'OPTIONS') {
      if (allowOrigin) {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': allowOrigin,
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Allow-Methods': 'GET, POST',
        });
        res.end();
      } else {
        res.writeHead(204);
        res.end();
      }
      return;
    }

    // 鉴权优先于 CORS 报错
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ') || auth.slice(7) !== token) {
      sendError(res, 401, '无效或缺失的 token');
      return;
    }

    // CORS 响应头（仅在鉴权通过后）
    if (allowOrigin) {
      res.setHeader('Access-Control-Allow-Origin', allowOrigin);
    }

    try {
      // POST /v1/check
      if (method === 'POST' && pathname === '/v1/check') {
        const body = await parseBody(req);
        const { project, pack: packPath, scope } = body;

        if (!project) {
          sendError(res, 422, '缺少 project 参数');
          return;
        }

        if (!existsSync(project)) {
          sendError(res, 404, `项目不存在: ${project}`);
          return;
        }

        const packDir = packPath || 'packs/software-engineering';
        const { ok, pack, errors } = await loadPack(packDir);
        if (!ok) {
          sendError(res, 422, `包校验不过: ${errors.join('; ')}`);
          return;
        }

        const verdict = evaluate(project, pack, { scope });

        sendJSON(res, 200, verdict);
        return;
      }

      // GET /v1/rounds?project=...
      if (method === 'GET' && pathname === '/v1/rounds') {
        const project = parsedUrl.searchParams.get('project');
        if (!project) {
          sendError(res, 422, '缺少 project 参数');
          return;
        }

        if (!existsSync(project)) {
          sendError(res, 404, `项目不存在: ${project}`);
          return;
        }

        const rounds = roundStatus(project);
        sendJSON(res, 200, { rounds });
        return;
      }

      // POST /v1/human-confirm
      if (method === 'POST' && pathname === '/v1/human-confirm') {
        const body = await parseBody(req);
        const { project, gateId, note } = body;

        if (!project || !gateId) {
          sendError(res, 422, '缺少 project 或 gateId 参数');
          return;
        }

        if (!existsSync(project)) {
          sendError(res, 404, `项目不存在: ${project}`);
          return;
        }

        // 记录确认
        appendRecord(project, {
          kind: 'human-confirm',
          gateId,
          result: 'pass',
          by: 'api',
          note: note || '',
        });

        // 重新判定该门禁
        const packDir = 'packs/software-engineering'; // 默认包
        const { ok, pack, errors } = await loadPack(packDir);
        if (!ok) {
          sendError(res, 422, `包校验不过: ${errors.join('; ')}`);
          return;
        }

        const verdict = evaluate(project, pack, { scope: `gate:${gateId}` });
        const gate = verdict.gates.find((g) => g.id === gateId);

        if (!gate) {
          sendError(res, 404, `门禁不存在: ${gateId}`);
          return;
        }

        sendJSON(res, 200, { gateId, result: gate.r, say: gate.say });
        return;
      }

      // GET /v1/packs
      if (method === 'GET' && pathname === '/v1/packs') {
        const packsDir = resolve(process.cwd(), 'packs');
        if (!existsSync(packsDir)) {
          sendJSON(res, 200, { packs: [] });
          return;
        }

        const entries = readdirSync(packsDir, { withFileTypes: true });
        const packs = [];

        for (const ent of entries) {
          if (!ent.isDirectory()) continue;
          const packJsonPath = resolve(packsDir, ent.name, 'pack.json');
          if (!existsSync(packJsonPath)) continue;

          try {
            const meta = JSON.parse(readFileSync(packJsonPath, 'utf8'));
            packs.push({
              name: meta.name,
              version: meta.version,
              title: meta.title,
              path: `packs/${ent.name}`,
            });
          } catch {
            // 跳过损坏的包
          }
        }

        sendJSON(res, 200, { packs });
        return;
      }

      // 404
      sendError(res, 404, `端点不存在: ${method} ${pathname}`);
    } catch (e) {
      console.error('Internal error:', e);
      sendError(res, 500, '服务器内部错误');
    }
  });
}
