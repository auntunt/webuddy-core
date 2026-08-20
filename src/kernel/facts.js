// 事实上下文 - 惰性缓存的产物解析
// 改造自 ref detect.js + probe-artifacts.js

import crypto from 'node:crypto';
import { readArtifact, hashFile } from './artifact-io.js';
import { parseFrontmatter, sectionsOf, parseTables, countListItems } from './parse.js';

/**
 * 创建事实上下文
 * @param {string} dir 项目根目录
 * @param {object} pack 担架包对象
 * @param {object} options {round: RoundData|null}
 * @returns {object} ctx - §4.3 的 ctx 签名
 */
export function createFactContext(dir, pack, options = {}) {
  const cache = new Map();
  const round = options.round || null;

  /**
   * art 函数 - 惰性加载并解析产物
   * @param {string} relPath 相对于项目根的路径
   * @returns {Artifact}
   */
  function art(relPath) {
    if (cache.has(relPath)) {
      return cache.get(relPath);
    }

    const raw = readArtifact(dir, relPath);

    if (raw === null) {
      const artifact = {
        exists: false,
        raw: '',
        meta: {},
        body: '',
        sections: [],
        tables: [],
        lists: [],
        mtime: null
      };
      cache.set(relPath, artifact);
      return artifact;
    }

    const { meta, body } = parseFrontmatter(raw);
    const sectionsMap = sectionsOf(body);
    const sections = [];
    for (const [title, text] of sectionsMap.entries()) {
      sections.push({ title, text });
    }

    const tables = parseTables(body);

    // 简单解析列表
    const lists = [];
    const listItems = [];
    for (const line of body.split('\n')) {
      if (/^\s*(?:[-*+]|\d+[.、)])\s+\S/.test(line)) {
        listItems.push(line.trim());
      }
    }
    if (listItems.length > 0) {
      lists.push({ items: listItems });
    }

    const artifact = {
      exists: true,
      raw,
      meta,
      body,
      sections,
      tables,
      lists,
      mtime: new Date() // 简化版本，实际应从文件系统读取
    };

    cache.set(relPath, artifact);
    return artifact;
  }

  const ctx = {
    dir,
    art,
    lexicons: pack.lexicons || {},
    hints: pack.hints || {},
    round,
    gateId: null // 由 evaluate 调用时设置
  };

  return ctx;
}

/**
 * 计算事实指纹 - 用于骨架重编译触发判据
 * @param {object} ctx 事实上下文
 * @param {string[]} files 要计算指纹的文件列表
 * @returns {string} SHA-256 前 12 位
 */
export function factsFingerprint(ctx, files) {
  const pairs = [];

  for (const file of files) {
    const hash = hashFile(ctx.dir, file);
    if (hash) {
      pairs.push(`${file}:${hash}`);
    }
  }

  pairs.sort();
  const combined = pairs.join('\n');
  const sha256 = crypto.createHash('sha256').update(combined, 'utf8').digest('hex');
  return sha256.substring(0, 12);
}
