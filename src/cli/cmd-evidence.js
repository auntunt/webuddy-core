/**
 * webuddy evidence add|list —— 证明文件（§8.1）。
 *
 * 这条是给技术同事和助手用的。不会用终端的人走看板的拖拽上传（§14.3），
 * 两条路落到同一个地方：.webuddy/evidence/<门禁号>/，都留一条 evidence-add。
 */

import fs from 'node:fs';
import path from 'node:path';
import { statePath, appendRecord } from '../kernel/state.js';
import { loadPack, resolvePack } from '../kernel/pack.js';

/** 单个文件上限 20MB，跟看板上传端点同一个数（§14.3） */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

function fail(msg, why, how) {
  console.error(msg);
  if (why) console.error(why);
  if (how) console.error(`怎么办：${how}`);
  process.exit(1);
}

function human(bytes) {
  if (bytes < 1024) return `${bytes} 字节`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 不带路径分隔符、不带 .. 的安全文件名。撞名的加 -2、-3。 */
export function safeName(dir, original) {
  const base = path.basename(String(original)).replace(/[/\\]/g, '_') || 'file';
  if (!fs.existsSync(path.join(dir, base))) return base;
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  for (let i = 2; i < 1000; i += 1) {
    const cand = `${stem}-${i}${ext}`;
    if (!fs.existsSync(path.join(dir, cand))) return cand;
  }
  return `${stem}-${Date.now()}${ext}`;
}

/**
 * 把一份文件收进某条检查的证明里。看板的上传端点也调这个，
 * 所以它收的是内容而不是路径——HTTP 那边根本没有本地文件。
 */
export function saveEvidence(projectDir, gateId, filename, buffer) {
  if (buffer.length > MAX_FILE_BYTES) {
    return {
      ok: false,
      why: `「${filename}」有 ${human(buffer.length)}，太大了。`,
      how: `一个文件最多 ${human(MAX_FILE_BYTES)}。照片可以先压一下，或者分几次传。`,
    };
  }
  const dir = statePath(projectDir, 'evidence', gateId);
  fs.mkdirSync(dir, { recursive: true });
  const name = safeName(dir, filename);
  fs.writeFileSync(path.join(dir, name), buffer);
  appendRecord(projectDir, {
    kind: 'evidence-add',
    gateId,
    file: name,
    bytes: buffer.length,
  });
  return { ok: true, name, bytes: buffer.length };
}

/** 列某条检查（或全部）已有的证明文件 */
export function listEvidence(projectDir, gateId = null) {
  const root = statePath(projectDir, 'evidence');
  if (!fs.existsSync(root)) return [];
  const gates = gateId ? [gateId] : fs.readdirSync(root).sort();
  const out = [];
  for (const g of gates) {
    const d = path.join(root, g);
    if (!fs.existsSync(d) || !fs.statSync(d).isDirectory()) continue;
    for (const f of fs.readdirSync(d).sort()) {
      const st = fs.statSync(path.join(d, f));
      if (!st.isFile()) continue;
      out.push({ gateId: g, file: f, bytes: st.size, at: st.mtime.toISOString() });
    }
  }
  return out;
}

export async function run(positionals, flags) {
  const sub = positionals[0];
  const projectDir = path.resolve(flags.project || process.cwd());

  if (flags.help || !sub) {
    console.log(`webuddy evidence — 给某条检查留证明文件

  evidence add <检查项编号> <文件…>
  evidence list [检查项编号] [--json]

不会用命令行的话，在看板上把文件拖进去就行。`);
    return;
  }

  if (!fs.existsSync(projectDir)) {
    fail(`找不到 ${projectDir} 这个目录。`, '', '换一个 --project 再来。');
  }

  if (sub === 'list') {
    const rows = listEvidence(projectDir, positionals[1] || null);
    if (flags.json) {
      console.log(JSON.stringify({ evidence: rows }, null, 2));
      return;
    }
    if (rows.length === 0) {
      console.log('还没有任何证明文件。');
      console.log('怎么办：跑 webuddy evidence add <检查项编号> <文件>，或者在看板上把文件拖进去。');
      return;
    }
    let cur = '';
    for (const r of rows) {
      if (r.gateId !== cur) {
        cur = r.gateId;
        console.log(`${cur}：`);
      }
      console.log(`  ${r.file}（${human(r.bytes)}）`);
    }
    return;
  }

  if (sub === 'add') {
    const gateId = positionals[1];
    const files = positionals.slice(2);
    if (!gateId) {
      fail('不知道这些文件是给哪一条检查的。', '', '写成 webuddy evidence add 3.2 照片.jpg。');
    }
    if (files.length === 0) {
      fail('没说要传哪个文件。', '', `写成 webuddy evidence add ${gateId} 照片.jpg。`);
    }

    // 这条检查在不在清单里：编号打错了得当场说，不然文件收下了却没人看
    const packDir = resolvePack(null, projectDir);
    if (packDir) {
      const loaded = await loadPack(packDir);
      if (loaded.ok && !loaded.pack.gates.some((g) => g.id === gateId)) {
        fail(
          `这份清单里没有 ${gateId} 这条检查。`,
          '编号可能打错了。',
          '跑一次 webuddy check 看看有哪些条目。'
        );
      }
    }

    let n = 0;
    for (const f of files) {
      const src = path.resolve(f);
      if (!fs.existsSync(src) || !fs.statSync(src).isFile()) {
        fail(`找不到 ${f} 这个文件。`, '', '看一下路径对不对，或者换成绝对路径。');
      }
      const r = saveEvidence(projectDir, gateId, path.basename(src), fs.readFileSync(src));
      if (!r.ok) fail(r.why, '', r.how);
      console.log(`收下了：${r.name}（${human(r.bytes)}）`);
      n += 1;
    }
    console.log(`${gateId} 现在有 ${listEvidence(projectDir, gateId).length} 份证明文件了。`);
    if (n > 0) console.log('接着跑一次 webuddy check，看这一条过不过。');
    return;
  }

  fail(`没有 evidence ${sub} 这个用法。`, '', '可用：add、list。');
}
