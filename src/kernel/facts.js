// 事实上下文 - 惰性缓存的产物解析
// 改造自 ref detect.js + probe-artifacts.js

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
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
   * 这次判定实际读过哪些文件。
   * factsFingerprint 不传 files 时就用它——指纹要能反映"判定依据变了没有"，
   * 而判定依据就是读过的这些文件，不是项目里全部文件。
   */
  const touched = new Set();

  /**
   * art 函数 - 惰性加载并解析产物
   * @param {string} relPath 相对于项目根的路径
   * @returns {Artifact}
   */
  function art(relPath) {
    if (cache.has(relPath)) {
      return cache.get(relPath);
    }
    touched.add(relPath);

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

    /**
     * mtime 要读真的文件时间。
     * 早先这里写的是 new Date()（"简化版本"），后果是 fresh-within 这个原语
     * 永远算出"0 天前"——一份两年没动的交底记录也判通过，那条门禁等于不存在。
     * 读不到就是 null，让 fresh-within 自己去说"这文件还没有"。
     */
    let mtime = null;
    try {
      mtime = fs.statSync(path.join(dir, relPath)).mtime;
    } catch {
      mtime = null;
    }

    const artifact = {
      exists: true,
      raw,
      meta,
      body,
      sections,
      tables,
      lists,
      mtime,
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
    gateId: null, // 由 evaluate 调用时设置
    touchedFiles: () => [...touched].sort(),
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
  // 不传（或传空）时用这次判定实际读过的文件：指纹的意义是"判定依据变了没有"
  const list = files && files.length > 0 ? files : (ctx.touchedFiles?.() || []);

  for (const file of list) {
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
