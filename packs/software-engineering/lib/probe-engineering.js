/**
 * 工程侧事实探测：git、依赖、脚本、测试、部署痕迹。
 *
 * 全部是"看得见的痕迹"，不解释代码在干什么。
 * 比如：有没有测试命令（看 package.json scripts），
 * 而不是：测试写得好不好（那是 human 门禁 6.4）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readIfExists } from './parse.js';

function sh(cmd, args, cwd) {
  try {
    return execFileSync(cmd, args, {
      cwd,
      encoding: 'utf8',
      timeout: 8000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/** 递归列文件，跳过噪音目录。有上限，避免在巨型仓库里卡住。 */
export function listFiles(dir, { limit = 6000 } = {}) {
  const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.venv', '__pycache__', 'vendor', '.turbo', 'target']);
  const out = [];
  const walk = (d, depth) => {
    if (out.length >= limit || depth > 10) return;
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= limit) return;
      if (e.name.startsWith('.') && e.name !== '.frozen' && e.name !== '.env.example') continue;
      if (SKIP.has(e.name)) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      /**
       * 一律用正斜杠记路径。
       *
       * Windows 上 path.relative 给的是 tests\\auth.test.js，而对照表
       * （artifacts/06-traceability.md）里人写的是 tests/auth.test.js ——
       * 两边比不上，6.1 就会把 11 个明明在磁盘上的测试文件全报成"找不到"。
       * 实测这条会让 Windows 上的 pack test 直接判包不合格。
       * 产物文件里的路径永远是正斜杠写法，所以以它为准。
       */
      else out.push(path.relative(dir, full).split(path.sep).join('/'));
    }
  };
  walk(dir, 0);
  return out;
}

const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.py', '.go', '.java', '.rb', '.php', '.rs', '.cs']);
const TEST_HINT = /(^|[\/._-])(test|tests|spec|__tests__|e2e)([\/._-]|$)/i;
/**
 * 手工验收清单也是测试，只是跑它的人是人。
 *
 * 为什么要单独列一类：对照表里「谁来验这条标准」经常填的是一份人工试玩清单
 * （test/browser-acceptance.md 这种），那是端到端验收的正当写法——
 * 不是所有验收标准都能自动化，「焦点外框看得见吗」就只能人看。
 * 之前这类文件不算测试文件，于是 6.1 去磁盘上核对时说它不存在，
 * 而 Claude 明明刚读过它：工具报了个假问题，人只能选择相信谁。
 *
 * 但它不能混进 testFiles：那个被「测试跑没跑」「测试有没有全绿」用着，
 * 一份 md 清单没法 npm test，混进去会让那些检查跟着错。所以分两类。
 */
const MANUAL_TEST_EXT = new Set(['.md', '.markdown', '.txt', '.feature']);

export function probeEngineering(projectDir) {
  const files = listFiles(projectDir);
  const codeFiles = files.filter((f) => CODE_EXT.has(path.extname(f)) && !TEST_HINT.test(f));
  const testFiles = files.filter((f) => TEST_HINT.test(f) && CODE_EXT.has(path.extname(f)));
  const manualTestFiles = files.filter((f) => TEST_HINT.test(f) && MANUAL_TEST_EXT.has(path.extname(f)));

  // ── git ──
  const gitDir = path.join(projectDir, '.git');
  const hasGit = fs.existsSync(gitDir);
  const commitCount = hasGit ? Number(sh('git', ['rev-list', '--count', 'HEAD'], projectDir) || 0) : 0;
  const gitLog = hasGit ? (sh('git', ['log', '--pretty=%H%x09%ad%x09%s', '--date=short', '-n', '400'], projectDir) || '') : '';
  const commits = gitLog ? gitLog.split('\n').filter(Boolean).map((l) => {
    const [hash, date, ...rest] = l.split('\t');
    return { hash, date, subject: rest.join('\t') };
  }) : [];
  const lastCommitDate = commits[0]?.date || null;
  const dirty = hasGit ? Boolean(sh('git', ['status', '--porcelain'], projectDir)) : false;

  // ── package.json / 依赖 ──
  const pkgRaw = readIfExists(path.join(projectDir, 'package.json'));
  let pkg = null;
  try { pkg = pkgRaw ? JSON.parse(pkgRaw) : null; } catch { pkg = null; }
  const scripts = pkg?.scripts || {};
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const rangeDeps = Object.entries(deps)
    .filter(([, v]) => typeof v === 'string' && /^[\^~]|^\*$|^>=|^<|\s-\s/.test(v))
    .map(([k, v]) => `${k}@${v}`);

  // ── 关键命令是否存在 ──
  const hasStartScript = Boolean(scripts.dev || scripts.start || scripts.serve);
  const hasTestScript = Boolean(scripts.test || scripts['test:unit'] || scripts.vitest);
  // 个人项目常常没有 npm scripts，只有 deploy.sh / rollback.sh 这类脚本文件。
  // 只认 package.json 的话，门禁 7.2/7.3 在这类项目里永远红着（见 .webuddy/state.json 的历史）。
  const hasDeployScript = Boolean(scripts.deploy || scripts['deploy:prod'] || files.some((f) => /^deploy\.(sh|js|ts|py|mjs)$/i.test(f)));
  const hasBackupScript = Boolean(scripts.backup || files.some((f) => /backup.*\.(sh|js|ts|py)$/i.test(f)));
  const hasRollbackScript = Boolean(scripts.rollback || files.some((f) => /rollback.*\.(sh|js|ts|py)$/i.test(f)));
  // 演示数据准备办法：seed 脚本 / seed 目录 / demo 数据文件，三样有一样就算有（门禁 7.19）
  const hasSeedScript = Boolean(
    scripts.seed || scripts['db:seed']
    || files.some((f) => /(^|\/)(seed|seeds)\//i.test(f))
    || files.some((f) => /seed\.(sql|py|js|ts|sh|json)$/i.test(f))
    || files.some((f) => /demo[-_]?data/i.test(f))
  );

  // ── 目录结构（门禁 4.10）──
  // 只查约定目录在不在，不评价里面怎么组织的。
  // 这是"判据不读代码"的典型：看路径，不看内容。
  const hasSrcDir = files.some((f) => /^(src|app|lib)\//.test(f));
  const hasTestDir = files.some((f) => /^(tests?|__tests__|spec)\//.test(f));

  // ── agent 约束文件（门禁 4.3）──
  const agentRuleFile = ['CLAUDE.md', 'AGENTS.md', '.cursorrules', 'GEMINI.md']
    .map((n) => ({ n, c: readIfExists(path.join(projectDir, n)) }))
    .find((x) => x.c && x.c.trim().length > 50);

  // ── 环境配置分离 & 硬编码密钥（门禁 4.6 / 6.11）──
  const hasEnvExample = files.some((f) => /^\.env\.example$|^\.env\.sample$/.test(f));
  const envCommitted = hasGit
    ? Boolean(sh('git', ['ls-files', '.env', '.env.local', '.env.production'], projectDir))
    : files.some((f) => /^\.env(\.|$)/.test(f) && !/example|sample/.test(f));
  const secretHits = scanSecrets(projectDir, codeFiles);

  // ── 数据库 / 数据模型（门禁 4.7 / 5.5）──
  const schemaFiles = files.filter((f) => /(schema\.prisma|migrations?\/|\.sql$|models?\.(py|ts|js)$)/i.test(f));
  const hasSchema = schemaFiles.length > 0;

  // ── 部署与运行痕迹（环节七）──
  const hasDockerCompose = files.some((f) => /^docker-compose(\.\w+)?\.ya?ml$/i.test(f));
  const hasDockerfile = files.some((f) => /^Dockerfile/i.test(f));
  const hasCI = files.some((f) => /^\.github\/workflows\/.*\.ya?ml$|^\.gitlab-ci\.yml$/i.test(f));
  const hasCaddyOrNginx = files.some((f) => /Caddyfile|nginx\.conf/i.test(f));

  // ── 交付记录（工具自己维护的目录）──
  //
  // gates/records.jsonl 是只写的留痕账本，不参与任何门禁判定。
  //
  // 这里以前把它读出来挂成 facts.eng.gateRecords，但全仓库没有一个消费者。
  // 之所以不该有消费者：records.jsonl 是无保护的 append-only 文件，谁都能手写一行 JSON 进去。
  // 一旦让它反向回填 humanChecks（"记录里写着 7.4 通过了，那就算通过"），
  // 那 webuddy confirm 这条唯一受控的写入路径就白设了——
  // 手写一行字就能把及格线点绿，正是这套门禁最该拦的作假方式。
  // 所以它的定位只能是事后复核用的账本：人看，工具不看。
  const gatesDir = path.join(projectDir, 'gates');
  const exceptionsRaw = readIfExists(path.join(gatesDir, 'exceptions.md'));

  // ── 提交信息里的 AC 编号（门禁 5.11）──
  const commitsWithAC = commits.filter((c) => /\bAC-?\d{1,4}\b/i.test(c.subject)).length;

  return {
    files,
    fileCount: files.length,
    codeFileCount: codeFiles.length,
    testFileCount: testFiles.length,
    testFiles,
    // 只给「表里点名的文件在不在」这类核对用，不参与「测试跑没跑」
    manualTestFiles,
    hasGit,
    commitCount,
    commits,
    lastCommitDate,
    dirty,
    commitsWithAC,
    pkg,
    scripts,
    deps,
    depCount: Object.keys(deps).length,
    rangeDeps,
    hasStartScript,
    hasTestScript,
    hasDeployScript,
    hasBackupScript,
    hasRollbackScript,
    hasSeedScript,
    hasSrcDir,
    hasTestDir,
    agentRuleFile: agentRuleFile?.n || null,
    hasEnvExample,
    envCommitted,
    secretHits,
    hasSchema,
    schemaFiles,
    hasDockerCompose,
    hasDockerfile,
    hasCI,
    hasCaddyOrNginx,
    hasExceptions: Boolean(exceptionsRaw && exceptionsRaw.trim().length > 30),
  };
}

/**
 * 硬编码密钥扫描（门禁 4.6 / 6.11）。
 * 只做形态匹配，不解释代码。命中就报路径和行号，不回显密钥值本身。
 */
const SECRET_PATTERNS = [
  { name: '密码字面量', re: /(password|passwd|pwd)\s*[:=]\s*["'][^"'{$\s]{6,}["']/i },
  { name: '密钥字面量', re: /(secret|api[_-]?key|access[_-]?token|private[_-]?key)\s*[:=]\s*["'][^"'{$\s]{12,}["']/i },
  { name: '数据库连接串带密码', re: /(postgres|mysql|mongodb|redis):\/\/[^:\s"']+:[^@\s"']{4,}@/i },
  { name: '云厂商密钥', re: /\b(AKIA[0-9A-Z]{16}|LTAI[0-9A-Za-z]{12,}|sk-[A-Za-z0-9]{20,})\b/ },
];

function scanSecrets(projectDir, codeFiles) {
  const hits = [];
  const targets = codeFiles.slice(0, 800);
  for (const rel of targets) {
    const raw = readIfExists(path.join(projectDir, rel));
    if (!raw || raw.length > 400_000) continue;
    const lines = raw.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.length > 500) continue;
      if (/example|sample|placeholder|dummy|test|fake|xxx|your[_-]?/i.test(line)) continue;
      for (const p of SECRET_PATTERNS) {
        if (p.re.test(line)) {
          hits.push({ file: rel, line: i + 1, kind: p.name });
          break;
        }
      }
      if (hits.length >= 40) return hits;
    }
  }
  return hits;
}
