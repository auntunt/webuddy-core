// 产物文件读写
// 简化版本 - 只提供基础的文件操作，不包含表单化读写

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * 把换行统一成 \n。
 *
 * 为什么必须在读进来的第一时间就抹平：本仓库所有解析器都是 split('\n') 起手
 * （小节、表格、列表、门禁表、提问组），CRLF 会给每一行尾巴上留一个 \r，
 * 于是 /^###\s+(\d+\.\d+)$/ 这类带 $ 的正则全部失配。
 *
 * 这不是"照顾 Windows 开发机"的小事——目标用户里就有人用记事本写
 * artifacts 下的产物，记事本存出来的就是 CRLF。不抹平的话，
 * 同一份内容在他机器上判不通过、在别人机器上判通过，而工具说不出为什么。
 * 实测：把包与项目整份转成 CRLF 之后 loadPack 直接失败，报「环节数少于 3 个」。
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeNewlines(text) {
  return typeof text === 'string' ? text.replace(/\r\n/g, '\n') : text;
}

/**
 * 读取产物文件，相对于项目根目录
 * @param {string} projectDir 项目根目录
 * @param {string} relPath 相对路径
 * @returns {string|null} 文件内容，不存在返回 null
 */
export function readArtifact(projectDir, relPath) {
  try {
    const fullPath = path.join(projectDir, relPath);
    const st = fs.statSync(fullPath);
    if (!st.isFile()) return null;
    return normalizeNewlines(fs.readFileSync(fullPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 写入产物文件（原子写）
 * @param {string} projectDir 项目根目录
 * @param {string} relPath 相对路径
 * @param {string} content 内容
 */
export function writeArtifact(projectDir, relPath, content) {
  const fullPath = path.join(projectDir, relPath);
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // 原子写:临时文件 + rename
  const tmpPath = fullPath + '.tmp';
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, fullPath);
}

/**
 * 计算文件 SHA-1 哈希
 * @param {string} projectDir 项目根目录
 * @param {string} relPath 相对路径
 * @returns {string|null} 哈希值，文件不存在返回 null
 */
export function hashFile(projectDir, relPath) {
  const content = readArtifact(projectDir, relPath);
  if (content === null) return null;
  return crypto.createHash('sha1').update(content, 'utf8').digest('hex');
}

/**
 * 列出目录下的文件
 * @param {string} projectDir 项目根目录
 * @param {string} relDir 相对目录路径
 * @param {object} options {recursive: boolean}
 * @returns {string[]} 相对路径列表
 */
export function listFiles(projectDir, relDir, options = {}) {
  const fullDir = path.join(projectDir, relDir);
  if (!fs.existsSync(fullDir)) return [];

  const results = [];

  function walk(dir, prefix) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (options.recursive) {
            walk(fullPath, relPath);
          }
        } else if (entry.isFile()) {
          results.push(relPath);
        }
      }
    } catch (err) {
      // 忽略读取错误
    }
  }

  walk(fullDir, '');
  return results.sort();
}

/**
 * 检查文件是否存在
 * @param {string} projectDir 项目根目录
 * @param {string} relPath 相对路径
 * @returns {boolean}
 */
export function fileExists(projectDir, relPath) {
  try {
    const fullPath = path.join(projectDir, relPath);
    const st = fs.statSync(fullPath);
    return st.isFile();
  } catch {
    return false;
  }
}

/**
 * 获取文件修改时间
 * @param {string} projectDir 项目根目录
 * @param {string} relPath 相对路径
 * @returns {Date|null}
 */
export function getMtime(projectDir, relPath) {
  try {
    const fullPath = path.join(projectDir, relPath);
    const st = fs.statSync(fullPath);
    return st.mtime;
  } catch {
    return null;
  }
}
