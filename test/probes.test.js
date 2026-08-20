import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { evalProbe } from '../src/kernel/probes.js';
import { parseProbe } from '../src/kernel/probe-dsl.js';
import { statePath } from '../src/kernel/state.js';

// 辅助函数:创建测试环境
function setupTestEnv() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-probes-'));

  // 创建 art 函数(简化版)
  const art = (relPath) => {
    const fullPath = path.join(tmpDir, relPath);
    if (!fs.existsSync(fullPath)) {
      return { exists: false, raw: '', sections: [], tables: [], lists: [] };
    }

    const raw = fs.readFileSync(fullPath, 'utf8');
    const sections = [];
    const tables = [];
    const lists = [];

    // 简单解析 sections
    const sectionRegex = /^##\s+(.+)$/gm;
    let match;
    while ((match = sectionRegex.exec(raw)) !== null) {
      const title = match[1].trim();
      const start = match.index + match[0].length;
      const nextMatch = sectionRegex.exec(raw);
      const end = nextMatch ? nextMatch.index : raw.length;
      sectionRegex.lastIndex = nextMatch ? nextMatch.index : raw.length;

      const text = raw.substring(start, end).trim();
      sections.push({ title, text });
    }

    // 简单解析表格
    const lines = raw.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('|')) {
        const headers = lines[i].split('|').map(h => h.trim()).filter(Boolean);
        if (i + 1 < lines.length && lines[i + 1].includes('---')) {
          const rows = [];
          for (let j = i + 2; j < lines.length && lines[j].includes('|'); j++) {
            const row = lines[j].split('|').map(c => c.trim()).filter(Boolean);
            rows.push(row);
          }
          tables.push({ name: `表${tables.length + 1}`, headers, rows });
        }
      }
    }

    // 简单解析列表
    const listRegex = /^[-*]\s+(.+)$/gm;
    const items = [];
    while ((match = listRegex.exec(raw)) !== null) {
      items.push(match[1].trim());
    }
    if (items.length > 0) {
      lists.push({ items });
    }

    return { exists: true, raw, sections, tables, lists };
  };

  const ctx = {
    dir: tmpDir,
    art,
    lexicons: {
      'boundary': ['为空', '超长', '重复', '并发', '非法'],
      'security': ['加密', '认证', '权限']
    },
    hints: {},
    round: null,
    gateId: 'test-gate'
  };

  return { tmpDir, ctx };
}

function exec(dsl, ctx) {
  const parsed = parseProbe(dsl);
  assert.strictEqual(parsed.ok, true, `DSL 解析失败: ${parsed.why}`);
  return evalProbe(parsed.ast, ctx);
}

// ===== file-exists =====

test('file-exists: 文件存在', () => {
  const { tmpDir, ctx } = setupTestEnv();
  try {
    fs.writeFileSync(path.join(tmpDir, 'test.md'), 'content');
    const result = exec('file-exists("test.md")', ctx);
    assert.strictEqual(result.r, 'pass');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('file-exists: 文件不存在', () => {
  const { tmpDir, ctx } = setupTestEnv();
  try {
    const result = exec('file-exists("missing.md")', ctx);
    assert.strictEqual(result.r, 'fail');
    assert.ok(result.detail.includes('找不到'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('file-exists: glob 通配符', () => {
  const { tmpDir, ctx } = setupTestEnv();
  try {
    fs.mkdirSync(path.join(tmpDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'docs', 'readme.md'), 'x');
    const result = exec('file-exists("docs/*.md")', ctx);
    assert.strictEqual(result.r, 'pass');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

// ===== section-filled =====

test('section-filled: 节存在且已填写', () => {
  const { tmpDir, ctx } = setupTestEnv();
  try {
    fs.writeFileSync(path.join(tmpDir, 'doc.md'), '## 功能描述\n\n这是一个详细的功能描述内容，超过十个字。');
    const result = exec('section-filled("doc.md", "功能描述")', ctx);
    assert.strictEqual(result.r, 'pass');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('section-filled: 节为空', () => {
  const { tmpDir, ctx } = setupTestEnv();
  try {
    fs.writeFileSync(path.join(tmpDir, 'doc.md'), '## 功能描述\n\n待填\n\n## 其他');
    const result = exec('section-filled("doc.md", "功能描述")', ctx);
    assert.strictEqual(result.r, 'fail');
    assert.ok(result.detail.includes('是空的'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('section-filled: 文件不存在', () => {
  const { tmpDir, ctx } = setupTestEnv();
  try {
    const result = exec('section-filled("missing.md", "标题")', ctx);
    assert.strictEqual(result.r, 'fail');
    assert.ok(result.detail.includes('还没有'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

// ===== no-placeholder =====

test('no-placeholder: 无占位符', () => {
  const { tmpDir, ctx } = setupTestEnv();
  try {
    fs.writeFileSync(path.join(tmpDir, 'doc.md'), '这是完整的内容，已经全部写好了。');
    const result = exec('no-placeholder("doc.md")', ctx);
    assert.strictEqual(result.r, 'pass');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('no-placeholder: 有占位符', () => {
  const { tmpDir, ctx } = setupTestEnv();
  try {
    fs.writeFileSync(path.join(tmpDir, 'doc.md'), '内容\n待填\nTODO: 完成这部分\n<补充说明>');
    const result = exec('no-placeholder("doc.md")', ctx);
    assert.strictEqual(result.r, 'fail');
    assert.ok(result.detail.includes('处'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('no-placeholder: 文件不存在', () => {
  const { tmpDir, ctx } = setupTestEnv();
  try {
    const result = exec('no-placeholder("missing.md")', ctx);
    assert.strictEqual(result.r, 'fail');
    assert.ok(result.detail.includes('还没有'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

// ===== regex-hit =====

test('regex-hit: 匹配成功', () => {
  const { tmpDir, ctx } = setupTestEnv();
  try {
    fs.writeFileSync(path.join(tmpDir, 'doc.md'), '项目使用 React 框架');
    const result = exec('regex-hit("doc.md", "React", "React框架")', ctx);
    assert.strictEqual(result.r, 'pass');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('regex-hit: 匹配失败', () => {
  const { tmpDir, ctx } = setupTestEnv();
  try {
    fs.writeFileSync(path.join(tmpDir, 'doc.md'), '项目使用 Vue 框架');
    const result = exec('regex-hit("doc.md", "React", "React框架")', ctx);
    assert.strictEqual(result.r, 'fail');
    assert.ok(result.detail.includes('没找到'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('regex-hit: 文件不存在', () => {
  const { tmpDir, ctx } = setupTestEnv();
  try {
    const result = exec('regex-hit("missing.md", "test")', ctx);
    assert.strictEqual(result.r, 'fail');
    assert.ok(result.detail.includes('还没有'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

// ===== lexicon-hit =====

test('lexicon-hit: 命中词表', () => {
  const { tmpDir, ctx } = setupTestEnv();
  try {
    fs.writeFileSync(path.join(tmpDir, 'doc.md'), '输入为空时返回错误');
    const result = exec('lexicon-hit("doc.md", "boundary")', ctx);
    assert.strictEqual(result.r, 'pass');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('lexicon-hit: 未命中', () => {
  const { tmpDir, ctx } = setupTestEnv();
  try {
    fs.writeFileSync(path.join(tmpDir, 'doc.md'), '正常流程处理');
    const result = exec('lexicon-hit("doc.md", "boundary")', ctx);
    assert.strictEqual(result.r, 'fail');
    assert.ok(result.detail.includes('没提到'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('lexicon-hit: 文件不存在', () => {
  const { tmpDir, ctx } = setupTestEnv();
  try {
    const result = exec('lexicon-hit("missing.md", "boundary")', ctx);
    assert.strictEqual(result.r, 'fail');
    assert.ok(result.detail.includes('还没有'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

// ===== count-at-least =====

test('count-at-least: 列表项足够', () => {
  const { tmpDir, ctx } = setupTestEnv();
  try {
    fs.writeFileSync(path.join(tmpDir, 'doc.md'), '- 项目1\n- 项目2\n- 项目3\n- 项目4\n- 项目5');
    const result = exec('count-at-least("doc.md", "列表项", 3)', ctx);
    assert.strictEqual(result.r, 'pass');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('count-at-least: 列表项不足', () => {
  const { tmpDir, ctx } = setupTestEnv();
  try {
    fs.writeFileSync(path.join(tmpDir, 'doc.md'), '- 项目1\n- 项目2');
    const result = exec('count-at-least("doc.md", "列表项", 5)', ctx);
    assert.strictEqual(result.r, 'fail');
    assert.ok(result.detail.includes('只有 2 条'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('count-at-least: 文件不存在', () => {
  const { tmpDir, ctx } = setupTestEnv();
  try {
    const result = exec('count-at-least("missing.md", "列表项", 3)', ctx);
    assert.strictEqual(result.r, 'fail');
    assert.ok(result.detail.includes('还没有'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

// ===== fresh-within =====

test('fresh-within: 文件新鲜', () => {
  const { tmpDir, ctx } = setupTestEnv();
  try {
    fs.writeFileSync(path.join(tmpDir, 'log.txt'), 'recent');
    const result = exec('fresh-within("log.txt", 30)', ctx);
    assert.strictEqual(result.r, 'pass');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('fresh-within: 文件不存在', () => {
  const { tmpDir, ctx } = setupTestEnv();
  try {
    const result = exec('fresh-within("old.txt", 1)', ctx);
    assert.strictEqual(result.r, 'fail');
    assert.ok(result.detail.includes('找不到'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

// ===== evidence-attached =====

test('evidence-attached: 有凭据', () => {
  const { tmpDir, ctx } = setupTestEnv();
  try {
    const evidenceDir = statePath(tmpDir, 'evidence', 'test-gate');
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(path.join(evidenceDir, 'photo.jpg'), 'fake');
    const result = exec('evidence-attached("test-gate", "photo")', ctx);
    assert.strictEqual(result.r, 'pass');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('evidence-attached: 无凭据', () => {
  const { tmpDir, ctx } = setupTestEnv();
  try {
    const result = exec('evidence-attached("test-gate", "photo")', ctx);
    assert.strictEqual(result.r, 'fail');
    assert.ok(result.detail.includes('上传'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

// ===== round-clean =====

test('round-clean: 无轮次', () => {
  const { tmpDir, ctx } = setupTestEnv();
  try {
    const result = exec('round-clean("files")', ctx);
    assert.strictEqual(result.r, 'pass');
    assert.ok(result.detail.includes('未开轮次'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('round-clean: 有违规', () => {
  const { tmpDir, ctx } = setupTestEnv();
  try {
    ctx.round = {
      violations: [
        { dim: 'files', say: 'src/util.js 未认领但被修改' },
        { dim: 'tests', say: '测试用例减少了 3 条' }
      ]
    };
    const result = exec('round-clean("files")', ctx);
    assert.strictEqual(result.r, 'fail');
    assert.ok(result.detail.includes('未认领'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('round-clean: 无违规', () => {
  const { tmpDir, ctx } = setupTestEnv();
  try {
    ctx.round = { violations: [] };
    const result = exec('round-clean("files")', ctx);
    assert.strictEqual(result.r, 'pass');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

// ===== 连接词 =====

test('all: 全部通过', () => {
  const { tmpDir, ctx } = setupTestEnv();
  try {
    fs.writeFileSync(path.join(tmpDir, 'a.md'), 'x');
    fs.writeFileSync(path.join(tmpDir, 'b.md'), 'y');
    const result = exec('all(file-exists("a.md"), file-exists("b.md"))', ctx);
    assert.strictEqual(result.r, 'pass');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('all: 短路失败', () => {
  const { tmpDir, ctx } = setupTestEnv();
  try {
    fs.writeFileSync(path.join(tmpDir, 'a.md'), 'x');
    const result = exec('all(file-exists("a.md"), file-exists("missing.md"))', ctx);
    assert.strictEqual(result.r, 'fail');
    assert.ok(result.detail.includes('missing.md'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('any: 有一个通过', () => {
  const { tmpDir, ctx } = setupTestEnv();
  try {
    fs.writeFileSync(path.join(tmpDir, 'a.md'), 'x');
    const result = exec('any(file-exists("missing.md"), file-exists("a.md"))', ctx);
    assert.strictEqual(result.r, 'pass');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('any: 全部失败', () => {
  const { tmpDir, ctx } = setupTestEnv();
  try {
    const result = exec('any(file-exists("a.md"), file-exists("b.md"), file-exists("c.md"))', ctx);
    assert.strictEqual(result.r, 'fail');
    // 拼前两个
    assert.ok(result.detail.includes('a.md'));
    assert.ok(result.detail.includes('b.md'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('not: 翻转通过', () => {
  const { tmpDir, ctx } = setupTestEnv();
  try {
    const result = exec('not(file-exists("missing.md"))', ctx);
    assert.strictEqual(result.r, 'pass');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('not: 翻转失败', () => {
  const { tmpDir, ctx } = setupTestEnv();
  try {
    fs.writeFileSync(path.join(tmpDir, 'exists.md'), 'x');
    const result = exec('not(file-exists("exists.md"))', ctx);
    assert.strictEqual(result.r, 'fail');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});
