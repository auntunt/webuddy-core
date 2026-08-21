/**
 * webuddy open [项目目录]（§14.1）
 *
 * 这是"一个入口"（§2.5 铁律 8）落地的地方：双击一下就到看板，
 * 中间不问端口、不问口令、不让人看见命令行输出。
 *
 * 所以这里有两条不许违反的纪律：
 * 1. 端口占用不报错、不提问，自己 +1 往上找。技术同事不在旁边的时候，
 *    "端口被占了，请换一个"这句话等于把人挡在门外。
 * 2. 传了项目目录就顺手把它加进注册表。让人先跑一条命令加项目、
 *    再跑一条打开看板，是两次机会走错。
 */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createApiServer } from '../server/api.js';
import { addProject } from '../kernel/registry.js';

/** 从 start 起往上试 tries 个端口，返回第一个起得来的 server。 */
async function listenSomewhere(server, start, tries) {
  for (let port = start; port < start + tries; port += 1) {
    const ok = await new Promise((resolve) => {
      const onErr = (e) => {
        server.removeListener('listening', onOk);
        // 只有"被占了"才往下试。别的错（比如没权限绑端口）继续试也是白试，
        // 而且会把真正的原因埋在 20 次重试后面。
        if (e.code === 'EADDRINUSE') resolve(false);
        else resolve(e);
      };
      const onOk = () => {
        server.removeListener('error', onErr);
        resolve(true);
      };
      server.once('error', onErr);
      server.once('listening', onOk);
      server.listen(port, '127.0.0.1');
    });
    if (ok === true) return port;
    if (ok !== false) throw ok;
  }
  return null;
}

/** 用系统默认浏览器打开。打不开不算致命错，把地址印出来让人自己贴。 */
function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start'
      : 'xdg-open';
  try {
    // win 的 start 是 cmd 的内建命令，得借 shell；顺带 start 的第一个参数是窗口标题
    const child = process.platform === 'win32'
      ? spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' })
      : spawn(cmd, [url], { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export async function run(positionals, flags) {
  if (flags.help) {
    console.log(`webuddy open [项目目录] — 打开看板

  不带目录     直接打开看板，看已经加进来的项目
  带一个目录   把这个项目加到看板上，再打开看板

  --port <号码>   从哪个端口开始找，缺省 7810
  --no-browser    只把服务起起来，不动浏览器
  --alias <名字>  给这个项目起个用户认得的名字，比如「望江路项目」；
                  不给就在卡片上显示目录路径，用户看不懂那个`);
    return;
  }

  const target = positionals[0] || null;
  if (target) {
    const abs = path.resolve(target);
    if (!fs.existsSync(abs)) {
      console.error(`找不到 ${abs} 这个文件夹。`);
      console.error('怎么办：确认路径没打错，或者把文件夹拖到终端里让它自己填路径。');
      process.exit(1);
    }
    const r = addProject(abs, flags.alias || '');
    console.log(r.created ? `加进来了：${r.project.alias || r.project.dir}`
      : `本来就在看板上：${r.project.alias || r.project.dir}`);
  }

  const start = Number(flags.port || 7810);
  if (!Number.isInteger(start) || start < 1 || start > 65535) {
    console.error(`--port 得是 1 到 65535 之间的整数，"${flags.port}" 不是。`);
    process.exit(1);
  }

  // 口令每次启动重生成、不落盘。看板同源拿它，不经 URL，所以没有"上次的链接还能用"这回事。
  const token = randomBytes(24).toString('hex');
  const server = createApiServer({ token, allowOrigin: null });

  const port = await listenSomewhere(server, start, 20);
  if (port === null) {
    console.error(`从 ${start} 到 ${start + 19} 这些端口都被别的程序占着。`);
    console.error('怎么办：关掉几个别的程序，或者加上 --port 换一段号码再试，比如 --port 8900。');
    process.exit(1);
  }

  const url = `http://127.0.0.1:${port}`;
  console.log(`看板开着呢：${url}`);
  if (port !== start) console.log(`（${start} 被占了，换到了 ${port}）`);

  if (flags['no-browser']) {
    console.log('没动浏览器。把上面那个地址贴到浏览器里就能看。');
  } else if (!openBrowser(url)) {
    console.log('浏览器没自动打开。把上面那个地址贴到浏览器里就能看。');
  }
  console.log('这个窗口别关，关了看板就打不开了。要关的话按 Ctrl+C。');
}
