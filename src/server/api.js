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
import { fileURLToPath } from 'node:url';
import { evaluate } from '../kernel/evaluate.js';
import { buildVerdict } from '../kernel/verdict.js';
import { loadPack, resolvePack as resolvePackDir } from '../kernel/pack.js';
import { appendRecord, statePath, saveState, loadState } from '../kernel/state.js';
import { roundStatus } from '../kernel/rounds.js';
import BASE_GLOSSARY from '../kernel/glossary-base.json' with { type: 'json' };
import {
  addProject, findProject, scanAll, scanProject,
} from '../kernel/registry.js';
import {
  listProposals, loadProposal, applyProposal, renderProposal, loadSkeleton,
} from '../kernel/recompile.js';
import { saveEvidence, MAX_FILE_BYTES } from '../cli/cmd-evidence.js';

const MAX_BODY = 1_000_000; // 1MB：判定请求只有几个字段，超了就是喂错东西

/** 上传的总量上限。比单文件上限宽，好让"这一个文件太大"能报成 422 三段式而不是"请求体太大" */
const MAX_UPLOAD = 30 * 1024 * 1024;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(HERE, '..', '..', 'web');

const STATIC_FILES = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/style.css': { file: 'style.css', type: 'text/css; charset=utf-8' },
};

/**
 * 同源判据。
 *
 * 没有 Origin 头的是非浏览器请求（curl、命令行）：本机进程本来就能直接读这些文件，
 * 拦它没有意义。有 Origin 的就必须跟 Host 一致——跨站脚本能发请求，
 * 但它的 Origin 是自己那个域名，对不上。
 */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === String(req.headers.host || '');
  } catch {
    return false;
  }
}

/** 原始字节。multipart 里是二进制，转成字符串会毁掉文件内容。 */
function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too-big'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * 手写 multipart 解析（§14.3：零依赖）。
 *
 * 只做一件事：按 boundary 切段，每段读出 name / filename / 原始字节。
 * 不支持嵌套 multipart、不支持 Content-Transfer-Encoding——
 * 浏览器的 FormData 不用这些，支持它们只会多出没人走的分支。
 * 格式不对返回 null，让调用方报一句人能懂的话，而不是抛在半路。
 */
export function parseMultipart(buf, boundary) {
  const delim = Buffer.from(`--${boundary}`);
  const parts = [];
  let i = buf.indexOf(delim);
  if (i < 0) return null;
  i += delim.length;
  while (i < buf.length) {
    if (buf[i] === 0x2d && buf[i + 1] === 0x2d) break;      // 收尾的 --
    if (buf[i] === 0x0d && buf[i + 1] === 0x0a) i += 2;     // 段头前的 CRLF
    else return null;
    const headEnd = buf.indexOf('\r\n\r\n', i);
    if (headEnd < 0) return null;
    const head = buf.slice(i, headEnd).toString('utf8');
    const bodyStart = headEnd + 4;
    const next = buf.indexOf(delim, bodyStart);
    if (next < 0) return null;
    const bodyEnd = Math.max(bodyStart, next - 2);          // 分隔线前那个 CRLF 不算内容
    const nameM = /name="([^"]*)"/.exec(head);
    const fileM = /filename="([^"]*)"/.exec(head);
    parts.push({
      name: nameM ? nameM[1] : '',
      filename: fileM ? fileM[1] : null,
      data: buf.slice(bodyStart, bodyEnd),
    });
    i = next + delim.length;
  }
  return parts;
}

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

/**
 * 用哪套清单。顺序同 §3.4：显式给的 > 项目挂载的 > 兜底 packs/software-engineering。
 *
 * 项目挂载的那一档不能少：看板发来的请求只有 project 一个字段（不问技术参数，
 * §2.5 铁律 6），少了这一档，所有项目都会被拿软件工程清单去量。
 */
async function resolvePack(packRef, projectDir = null) {
  const dir = packRef
    || (projectDir ? resolvePackDir(null, projectDir) : null)
    || 'packs/software-engineering';
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
 * 判定缓存：同一个项目同一个 scope，3 秒内直接回上次结果（§14.2）。
 *
 * 看板每 5 秒轻刷一次，人在页面上连点几下就是几十次判定；
 * 一次判定要读几十个文件。缓存只兜"连点"这个窗口，
 * 3 秒之后照旧现算——项目目录随时被助手改，缓存久了就是在说谎。
 */
const EVAL_CACHE = new Map();
const CACHE_MS = 3000;

function cachedEvaluate(dir, pack, opts) {
  const key = [dir, pack?.meta?.name || '', opts?.scope || 'all', opts?.round?.sessionId || ''].join('|');
  const now = Date.now();
  const hit = EVAL_CACHE.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.value;
  const value = evaluate(dir, pack, opts);
  EVAL_CACHE.set(key, { at: now, value });
  // 缓存只服务"刚才那一下"，不做淘汰策略：过期的键下次命中时被覆盖。
  // 但项目数不设上限，所以超过 200 个键就整体清掉，免得长开的服务一直涨。
  if (EVAL_CACHE.size > 200) EVAL_CACHE.clear();
  return value;
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

    /*
     * 看板这几条不验口令，只验同源（§14.3 的"仅同源"）。
     *
     * 不是放松，是没法验：浏览器加载 / 和 /app.js 时不可能带 Authorization 头，
     * 而页面要先拿到口令才能调别的接口——口令从 /api/meta 出去，
     * 那它自己也不能要口令。这一圈只能靠同源关上：
     * 跨站脚本能发请求，但它的 Origin 对不上 Host，读不到返回值。
     * 除这四条之外的所有接口照旧要 Bearer。
     */
    const OPEN_SAME_ORIGIN = ['/', '/index.html', '/app.js', '/style.css', '/api/meta'];
    if (req.method === 'GET' && OPEN_SAME_ORIGIN.includes(pathname)) {
      if (!sameOrigin(req)) {
        sendError(res, 403, '这个请求不是从看板页面发来的，没执行');
        return;
      }
      if (pathname === '/api/meta') {
        // 术语表随口令一起给：页面要用它把包作者写的原话翻成大白话（§14.4）
        sendJSON(res, 200, { token, glossary: BASE_GLOSSARY });
        return;
      }
      const spec = STATIC_FILES[pathname];
      const file = path.join(WEB_DIR, spec.file);
      if (!fs.existsSync(file)) {
        sendError(res, 404, '看板的页面文件缺了，看板打不开');
        return;
      }
      const body = fs.readFileSync(file);
      res.writeHead(200, {
        'Content-Type': spec.type,
        'Content-Length': body.length,
        'Cache-Control': 'no-store',
      });
      res.end(body);
      return;
    }

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
        const pr = await resolvePack(body.pack, projectDir);
        if (pr.code) { sendError(res, pr.code, pr.why); return; }

        const scope = body.scope || 'all';
        let round = null;
        const sid = body.session || (/^round:(.+)$/.exec(scope)?.[1] ?? null);
        if (sid) {
          const rs = roundStatus(projectDir);
          round = (rs?.rounds || []).find((r) => r.sessionId === sid) || null;
        }

        const evalResult = cachedEvaluate(projectDir, pack_(pr), { scope, round });
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

      /*
       * GET /v1/projects[?project=…]：按该管哪个排序（§14.3）。
       *
       * 带 project 时只扫那一个。项目页要的「现在走到第几步 · 这步叫什么」
       * 只有这条接口给得出（步骤名字在包里，Verdict 里没有），
       * 而 scanAll 会把每个项目都判一遍——开着看板挂五个项目，
       * 每 5 秒判五次是白烧。判定走同一份 3 秒缓存，跟 POST /v1/check 复用同一次计算。
       */
      if (req.method === 'GET' && pathname === '/v1/projects') {
        const only = url.searchParams.get('project');
        const evalOpts = { evaluateFn: (d, p) => cachedEvaluate(d, p, { scope: 'all' }) };
        if (only) {
          const found = findProject(only);
          if (!found) { sendError(res, 404, `${only} 这个项目还没加到看板上`); return; }
          const row = await scanProject(found, evalOpts);
          sendJSON(res, 200, { projects: [row], glossary: BASE_GLOSSARY });
          return;
        }
        const rows = await scanAll(evalOpts);
        sendJSON(res, 200, { projects: rows, glossary: BASE_GLOSSARY });
        return;
      }

      // POST /v1/projects {dir, alias}
      if (req.method === 'POST' && pathname === '/v1/projects') {
        let body = {};
        const raw = await readBody(req);
        if (raw) {
          try { body = JSON.parse(raw); } catch { sendError(res, 422, '请求体不是能读的 JSON'); return; }
        }
        if (!body.dir) {
          sendError(res, 422, '要说清加的是哪个文件夹（dir 填项目目录）');
          return;
        }
        const r = addProject(body.dir, body.alias || '');
        if (!r.ok) { sendError(res, 404, r.why); return; }
        sendJSON(res, 200, { project: r.project, created: r.created });
        return;
      }

      // POST /v1/evidence：仅同源的 multipart 上传（§14.3，唯一允许收文件的口）
      if (req.method === 'POST' && pathname === '/v1/evidence') {
        if (!sameOrigin(req)) {
          // 跨源一律不收文件（§8.1 末句）。这不是 CORS 头能补的事，是不收。
          sendError(res, 403, '这个上传不是从看板页面来的，没收');
          return;
        }
        const ctype = String(req.headers['content-type'] || '');
        const bm = /boundary=("?)([^";]+)\1/.exec(ctype);
        if (!/multipart\/form-data/i.test(ctype) || !bm) {
          sendError(res, 422, '这不是一次文件上传。怎么办：在看板上把文件拖进那个方框里。');
          return;
        }
        let raw;
        try {
          raw = await readRaw(req, MAX_UPLOAD);
        } catch (e) {
          if (e.message === 'too-big') {
            sendError(res, 422, `这一批文件加起来超过 ${Math.round(MAX_UPLOAD / 1024 / 1024)} MB，太多了。怎么办：一次少传几个，或者把照片压小一点。`);
            return;
          }
          throw e;
        }
        const parts = parseMultipart(raw, bm[2]);
        if (!parts) {
          sendError(res, 422, '这次上传的内容读不出来。怎么办：刷新看板页面再拖一次。');
          return;
        }
        const field = (n) => {
          const p = parts.find((x) => x.name === n && x.filename === null);
          return p ? p.data.toString('utf8') : '';
        };
        const projectDir = field('project');
        const gateId = field('gateId');
        if (!projectDir || !gateId) {
          sendError(res, 422, '不知道这些文件是哪个项目哪一条检查的。怎么办：回看板上重新点那一条的上传框。');
          return;
        }
        if (!fs.existsSync(projectDir)) { sendError(res, 404, `找不到 ${projectDir} 这个目录`); return; }
        const files = parts.filter((x) => x.filename);
        if (files.length === 0) {
          sendError(res, 422, '这次没带上文件。怎么办：把照片或文件拖到方框里，或者点方框选文件。');
          return;
        }
        // 一个都不许超限，超了整批不收：收一半会让人以为都传上了
        for (const f of files) {
          if (f.data.length > MAX_FILE_BYTES) {
            sendError(res, 422, `「${f.filename}」有 ${(f.data.length / 1024 / 1024).toFixed(1)} MB，太大了。一个文件最多 ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB。怎么办：照片先压一下，或者分几次传。`);
            return;
          }
        }
        const saved = [];
        for (const f of files) {
          const r = saveEvidence(projectDir, gateId, f.filename, f.data);
          if (!r.ok) { sendError(res, 422, `${r.why}怎么办：${r.how}`); return; }
          saved.push({ gateId, file: r.name, bytes: r.bytes });
        }
        sendJSON(res, 200, { saved });
        return;
      }

      // GET /v1/proposals?project=… ：待处理的建议，大白话正文随行
      if (req.method === 'GET' && pathname === '/v1/proposals') {
        const projectDir = url.searchParams.get('project');
        if (!projectDir) {
          sendError(res, 422, '要说清看哪个项目的建议（project 填项目目录）');
          return;
        }
        if (!fs.existsSync(projectDir)) { sendError(res, 404, `找不到 ${projectDir} 这个目录`); return; }
        const cur = loadSkeleton(projectDir)?.instanceVersion ?? 0;
        const rows = listProposals(projectDir)
          .filter((p) => p.status === 'pending')
          .map((p) => ({
            id: p.id,
            createdAt: p.createdAt,
            // 正文在服务端渲染：渲染规则（改了几条、动了哪几条、后果那句）
            // 只能有一份，前端再拼一遍两边迟早不一样。
            text: renderProposal(p),
            instanceVersion: cur,
          }));
        sendJSON(res, 200, { proposals: rows });
        return;
      }

      // POST /v1/proposals/<id>/apply|reject
      const pm = /^\/v1\/proposals\/([^/]+)\/(apply|reject)$/.exec(pathname);
      if (req.method === 'POST' && pm) {
        const proposalId = decodeURIComponent(pm[1]);
        const action = pm[2];
        let body = {};
        const raw = await readBody(req);
        if (raw) {
          try { body = JSON.parse(raw); } catch { sendError(res, 422, '请求体不是能读的 JSON'); return; }
        }
        const projectDir = body.project;
        if (!projectDir) {
          sendError(res, 422, '要说清是哪个项目的建议（project 填项目目录）');
          return;
        }
        if (!fs.existsSync(projectDir)) { sendError(res, 404, `找不到 ${projectDir} 这个目录`); return; }
        const p = loadProposal(projectDir, proposalId);
        if (!p) { sendError(res, 404, `找不到编号 ${proposalId} 的建议`); return; }

        if (action === 'reject') {
          // 只改 status，不动骨架。放下的建议要留着——
          // 删掉的话下次同样的情况又提一遍，人会以为工具没记住。
          p.status = 'rejected';
          p.rejectedAt = new Date().toISOString();
          const file = statePath(projectDir, 'proposals', `${proposalId}.json`);
          fs.writeFileSync(file, `${JSON.stringify(p, null, 2)}\n`, 'utf8');
          appendRecord(projectDir, { kind: 'proposal-reject', proposalId });
          sendJSON(res, 200, { ok: true, status: 'rejected' });
          return;
        }

        const r = applyProposal(projectDir, proposalId, { approvedBy: body.approvedBy || '看板' });
        if (!r.ok) { sendError(res, 422, r.why); return; }
        EVAL_CACHE.clear();  // 清单换版了，缓存里那份结论按的是旧清单
        sendJSON(res, 200, { ok: true, instanceVersion: r.to ?? (loadSkeleton(projectDir)?.instanceVersion ?? 0) });
        return;
      }

      // POST /v1/answers {project, promptId, answers}
      if (req.method === 'POST' && pathname === '/v1/answers') {
        let body = {};
        const raw = await readBody(req);
        if (raw) {
          try { body = JSON.parse(raw); } catch { sendError(res, 422, '请求体不是能读的 JSON'); return; }
        }
        const projectDir = body.project;
        const promptId = body.promptId;
        if (!projectDir || !promptId) {
          sendError(res, 422, '要说清是哪个项目、哪一条的回答（project 与 promptId）');
          return;
        }
        if (!fs.existsSync(projectDir)) { sendError(res, 404, `找不到 ${projectDir} 这个目录`); return; }
        const ans = body.answers && typeof body.answers === 'object' ? body.answers : {};
        const st = loadState(projectDir) || {};
        const all = st.answers && typeof st.answers === 'object' ? { ...st.answers } : {};
        // 键上带条目号：不同条目会有同名的 key（done、evidence），
        // 平铺存的话后答的会把先答的顶掉。
        for (const k of Object.keys(ans)) all[`${promptId}.${k}`] = ans[k];
        saveState(projectDir, { answers: all });
        appendRecord(projectDir, { kind: 'answers', promptId, keys: Object.keys(ans) });
        EVAL_CACHE.clear();
        sendJSON(res, 200, { ok: true, saved: Object.keys(ans).length });
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
