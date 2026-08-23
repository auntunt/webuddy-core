/**
 * demo 命令 —— 给人造一个练手用的项目。
 *
 * 为什么要有这个：一个第一次打开看板的人，面前是空的。空白页教不会任何东西，
 * 而拿真项目练手他不敢点——怕点坏。演示项目解决的就是这件事：
 * 它是包自带的"故意留了错"的样板项目的一份拷贝，红灯是真的，修好了会真的灭，
 * 而且怎么点都碰不到他的真项目。
 *
 * 用法：webuddy demo <包名> [目标目录]
 * 缺省目标目录是家目录下的 webuddy-demo-<包名>。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { resolvePack, loadPack, mountPack, copyDir } from '../kernel/pack.js';
import { addProject } from '../kernel/registry.js';
import { run as openBoard } from './cmd-open.js';

/** 报错三段式（§2.5 铁律 5）：出了什么事 → 可能因为什么 → 怎么办 */
function sayError({ what, why, how }) {
  console.error(what);
  console.error(`可能是因为：${why}`);
  console.error(`怎么办：${how}`);
}

export async function run(positionals, flags) {
  if (flags.help) {
    console.log(`webuddy demo <检查清单名> [放哪儿] — 造一个练手用的演示项目

  这会拷一份"故意留了错"的样板项目出来，挂上检查清单，加到看板上，然后打开看板。
  拷出来的是一份独立的副本，怎么改都影响不到别的项目。

  放哪儿      不写就放在 ${path.join(os.homedir(), 'webuddy-demo-<检查清单名>')}
  --no-browser  只把看板服务起起来，不动浏览器
  --port <号码> 从哪个端口开始找，缺省 7810`);
    return;
  }

  const packRef = positionals[0];
  if (!packRef) {
    sayError({
      what: '不知道要拿哪套检查清单来做演示项目。',
      why: '命令后面得跟一个检查清单的名字，现在什么都没跟。',
      how: '跑 webuddy demo software-engineering 这样，名字看 packs/ 目录下有哪几个。',
    });
    process.exit(1);
  }

  const packDir = resolvePack(packRef);
  if (!packDir) {
    sayError({
      what: `没有「${packRef}」这套检查清单。`,
      why: '名字打错了，或者这套清单还没装到这台电脑上。',
      how: '看一眼 packs/ 目录下有哪几个，照着目录名再打一次。',
    });
    process.exit(1);
  }

  const loaded = await loadPack(packDir);
  if (!loaded.ok) {
    sayError({
      what: '这套检查清单本身有问题，做不出演示项目。',
      why: loaded.errors.join('；'),
      how: `打开 ${packDir} 按上面每一条改，改完再跑一次。`,
    });
    process.exit(1);
  }
  const packName = loaded.pack.meta.name;

  const brokenSrc = path.join(packDir, 'fixtures', 'broken');
  if (!fs.existsSync(brokenSrc)) {
    sayError({
      what: `「${packName}」这套清单没带练习用的样板项目，做不出演示。`,
      why: `${brokenSrc} 这个目录不在——演示项目就是拿它拷一份出来的。`,
      how: '换一套带样板项目的清单，或者让写这套清单的人补上 fixtures/broken/。',
    });
    process.exit(1);
  }

  const target = path.resolve(positionals[1] || path.join(os.homedir(), `webuddy-demo-${packName}`));

  /**
   * 已经有了就报错，不覆盖。
   *
   * 覆盖是破坏性操作：人跑第二次 demo 多半是因为忘了跑过，
   * 而上一次的演示项目里可能已经有他改了一半的东西。
   * 说清楚后果、把选择权还给他（§2.5 铁律 7）。
   */
  if (fs.existsSync(target)) {
    sayError({
      what: `${target} 这个文件夹已经有了，没敢往里写。`,
      why: '上次做过一个同名的演示项目；直接盖掉的话，你在里面改过的东西就没了。',
      how: `想接着用上次那个就跑 webuddy open ${target}；想重来一个就先把这个文件夹删掉，或者换个地方：webuddy demo ${packRef} <另一个文件夹>。`,
    });
    process.exit(1);
  }

  copyDir(brokenSrc, target);

  const mounted = await mountPack(target, packRef);
  if (!mounted.ok) {
    sayError({
      what: '演示项目拷出来了，但没挂上检查清单。',
      why: mounted.error,
      how: `跑一次 webuddy pack mount ${target} ${packRef} 补上，再跑 webuddy open ${target}。`,
    });
    process.exit(1);
  }

  const added = addProject(target, `演示项目（${packName}）`);
  if (!added.ok) {
    sayError({
      what: '演示项目做好了，但没能加到看板上。',
      why: added.why,
      how: `跑一次 webuddy open ${target} 手动加进去。`,
    });
    process.exit(1);
  }

  console.log('');
  console.log(`给你准备了一个故意留了错的练习项目：${target}`);
  console.log('看板上红着的就是要修的。');
  console.log('修一条，红灯就灭一条。');
  console.log('');

  /**
   * 一个入口（§2.5 铁律 8）：做完直接把看板打开，不让人再敲第二条命令。
   * 别名带过去，免得 cmd-open 再登记一次时把卡片名写成目录路径 —— 用户看不懂那个。
   */
  await openBoard([target], { ...flags, alias: flags.alias || added.project.alias });
}
