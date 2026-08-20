#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { createServer } from './api.js';

const args = process.argv.slice(2);
let port = 3000;
let token = null;
let allowOrigin = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) {
    port = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--token' && args[i + 1]) {
    token = args[i + 1];
    i++;
  } else if (args[i] === '--allow-origin' && args[i + 1]) {
    allowOrigin = args[i + 1];
    i++;
  }
}

// 生成 token（如未指定）
if (!token) {
  token = randomBytes(16).toString('hex');
}

// 校验: --allow-origin null 需要显式 --token
if (allowOrigin === 'null' && process.argv.includes('--allow-origin') && !process.argv.includes('--token')) {
  console.error('错误: --allow-origin null 时必须显式指定 --token');
  process.exit(1);
}

const server = createServer({ token, allowOrigin });

server.listen(port, () => {
  console.log(`✓ API 服务运行于 http://localhost:${port}`);
  console.log(`✓ Bearer token: ${token}`);
  if (allowOrigin) {
    console.log(`✓ CORS 允许来源: ${allowOrigin}`);
  }
});
