/**
 * webuddy serve --port 7810 [--token t] [--allow-origin o]（§8.1）
 *
 * token 的生命周期：每次启动重生成、不落盘（借 ref TERM_TOKEN 的语义）。
 * 不落盘是为了让"关掉再开"就等于换锁——面板的 token 由 multica 插件配置注入，
 * 不经 URL，所以没有"上次的链接还能用"这种需求。
 */

import { randomBytes } from 'node:crypto';
import { createApiServer } from '../server/api.js';

export async function run(positionals, flags) {
  if (flags.help) {
    console.log(`webuddy serve — 起一个本地服务，给看板和外部程序调用

  --port <号码>         端口，缺省 7810
  --token <口令>        自己指定口令；不给就每次启动随机生成一个
  --allow-origin <来源> 允许哪个网页来源调用（跨源时才需要）

放行 null origin 时口令必须自己指定。`);
    return;
  }

  const port = Number(flags.port || 7810);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`--port 得是 1 到 65535 之间的整数，"${flags.port}" 不是。`);
    process.exit(1);
  }

  const allowOrigin = flags['allow-origin'] || null;

  // §8.1 第三条：null origin 等于"任何本地文件都能调"，
  // 这时口令再随机生成就没人知道它是什么，只能让人自己定。
  if (allowOrigin === 'null' && !flags.token) {
    console.error('放行 null origin 时口令必须自己指定。');
    console.error('怎么办：加上 --token <你定的口令> 再跑一次。');
    process.exit(1);
  }

  const token = flags.token || randomBytes(24).toString('hex');

  const server = createApiServer({ token, allowOrigin });

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`${port} 这个端口已经被别的程序占着了。`);
      console.error(`怎么办：换一个号码，比如 --port ${port + 1}。`);
    } else {
      console.error(`服务起不来：${e.message}`);
    }
    process.exit(1);
  });

  // 只听 127.0.0.1：这是本机工具，绑 0.0.0.0 等于把判定接口暴露到局域网
  server.listen(port, '127.0.0.1', () => {
    console.log(`服务开着呢：http://127.0.0.1:${port}`);
    console.log(`口令：${token}`);
    if (allowOrigin) console.log(`允许来源：${allowOrigin}`);
    console.log('按 Ctrl+C 关掉。');
  });
}
