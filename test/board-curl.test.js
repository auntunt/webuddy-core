/**
 * 把 test/board-curl.sh 挂进 node:test（§14.5 判据 2）。
 *
 * 为什么要这一层壳：判据 10 写的是 `node --test test/board*` 全绿，
 * 而这个通配符会把 test/board-curl.sh 也交给 node 当模块加载 ——
 * 实测 `node --test test/board-curl.sh` 报 ERR_UNKNOWN_FILE_EXTENSION，
 * 加不加引号都一样（node 自己展开通配符时同样不筛扩展名）。
 * .sh 不可能被 node 当模块跑，所以改由这个 .test.js 去 spawn bash：
 * `node --test test/board*.test.js` 与不带参数的 `node --test` 都会覆盖端点往返，
 * 端点检查因此进了判据 1 的那一趟，不再只靠单独敲一条 bash 命令。
 *
 * 断言只有一条：脚本自己的退出码。里面 60 多条检查各自打印 ✓，
 * 哪条红了脚本会打印出来并非零退出——重复一遍那些断言等于维护两份同样的东西。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const HERE = import.meta.dirname;
const ROOT = path.join(HERE, '..');

test('看板端点往返（test/board-curl.sh）', () => {
  const r = spawnSync('bash', [path.join(HERE, 'board-curl.sh')], {
    cwd: ROOT,
    encoding: 'utf8',
    // 起服务 + 传 21MB 大文件，慢是正常的；卡死的话别让它拖着整个测试跑不完
    timeout: 180_000,
  });

  if (r.error) assert.fail(`跑不起来 board-curl.sh：${r.error.message}`);

  // 红了就把脚本的输出原样贴出来。摘要成一句"端点检查失败"的话，
  // 得再手敲一遍 bash 才知道是哪一条，那这层壳就是纯添麻烦。
  assert.equal(
    r.status, 0,
    `board-curl.sh 没过（退出码 ${r.status}）：\n${r.stdout || ''}\n${r.stderr || ''}`
  );
});
