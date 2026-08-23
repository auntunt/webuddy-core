# webuddy-core

行业无关的验收内核 + 可插拔担架包。判定归规则（纯函数），LLM 只做辅助且 fail-closed。

零依赖：纯 Node ≥20，`dependencies` 与 `devDependencies` 恒为空。不用 `npm install`。

这份文件只写怎么装、怎么用。设计裁量看 `DECISIONS.md`，各包的门禁与覆盖率看
`packs/<包名>/README.md`，跟 Multica 对接看 `integrations/multica/联调手册.md`。

---

## 角色分界

**首次接入由技术同事做一次**：装 Node、挂检查清单、把项目加进看板、把「打开看板」
拷到用户桌面。

**日常回路由用户自己在看板里做，零终端、零术语**：看进度、看卡在哪、答提问、
传凭据、采纳建议。用户是行业专家、计算机小白——他不该见到命令行，也不该见到
「门禁」「阻断」这类词。

---

## 零、直接下载现成的程序（不用装 Node）

发版时会在 [Releases](https://github.com/auntunt/webuddy-core/releases) 上挂三个文件，
下哪个看用户的电脑：

| 电脑 | 下这个 |
| --- | --- |
| Mac（M1/M2/M3/M4 等 M 系列芯片） | `WeBuddy-macos-arm64.zip` |
| Windows 64 位（近十年的机器基本都是） | `WeBuddy-windows-x64.exe` |
| Windows 32 位（老机器；在「系统信息」里写着 x86） | `WeBuddy-windows-x86.exe` |

里面已经带了 Node 运行时和三套检查清单，用户的电脑上什么都不用先装。
第一次打开会自己把程序装到系统的应用数据目录下（Mac 在
`~/Library/Application Support/WeBuddy/`，Windows 在 `%LOCALAPPDATA%\WeBuddy\`），
之后每次打开都是秒开。

### 第一次打开会被系统拦一下，这是正常的

程序没有买苹果和微软的开发者签名证书，所以两个系统都会先拦一道。**这不是程序有毒，
是没花钱买证书。** 得教用户这么绕过去（或者由技术同事在他机器上做一次）：

- **Mac**：不要双击。在 `WeBuddy.app` 上**点右键 → 打开**，弹出的框里再点一次「打开」。
  这一步只需要做一次，之后双击就行。
- **Windows**：双击后如果出现蓝色的「Windows 已保护你的电脑」，点里面那行小字
  **「更多信息」**，然后点 **「仍要运行」**。同样只需要做一次。

想彻底没有这一步，得买证书（苹果开发者账号一年 99 美元，Windows 代码签名证书一年
几百到上千元不等），那是另一件事。

### 卸载

删掉下载来的那个文件，再删掉上面说的那个应用数据目录就干净了。检查清单的软链接在
`~/.webuddy/packs/` 下，一并删掉即可；用户自己的项目文件夹不受影响。

## 一、技术同事：首次接入（一次性）

```sh
# 1. 装 Node ≥20（有了就跳过）
node --version

# 2. 给项目挂一份检查清单
node bin/webuddy.js pack mount <项目目录> packs/construction-safety

# 3. 把项目加进看板，顺手起看板
node bin/webuddy.js open <项目目录>
```

第 3 步会占一个端口（默认 7810，被占了自动往后找），并用系统默认浏览器打开看板。
`--no-browser` 只起服务不开浏览器，`--port <号码>` 换一段端口，`--alias <名字>`
给项目起个用户认得的名字（比如「望江路项目」）。

现成的三个包：

| 目录 | 行业 |
|---|---|
| `packs/software-engineering` | 软件工程 |
| `packs/construction-safety` | 施工安全 |
| `packs/financial-audit` | 财务审计 |

## 二、技术同事：把「打开看板」放到用户桌面

用户不该敲命令。`launchers/` 下有两个双击就能用的文件，选对应系统的那个：

- macOS：`launchers/打开看板.command`
- Windows：`launchers/打开看板.bat`

两种放法：

**放法 A：连着代码一起放**（推荐，最不容易坏）
把整个 webuddy-core 目录放到一个固定位置，然后在桌面建一个指向 launchers
里那个文件的替身（mac：右键 → 制作替身，把替身拖到桌面；win：右键 → 发送到 →
桌面快捷方式）。

**放法 B：只把启动文件拷到桌面**
直接把 `打开看板.command`（或 `.bat`）拷到桌面，再给用户的登录环境设一个
`WEBUDDY_HOME` 环境变量指向 webuddy-core 目录。不设的话双击会报「找不到
WeBuddy 的程序文件」，并告诉用户把哪句话转给你。

mac 上拷过去之后确认它还是可执行的：

```sh
chmod +x ~/Desktop/打开看板.command
```

第一次双击 macOS 可能拦一下（网上下载的文件）。右键 → 打开，点「打开」，
之后就不再问了。

用户那边看到的：双击 → 终端窗口弹出来说一句「看板开着呢」→ 浏览器自动打开看板。
那个窗口关了看板就停，所以告诉他缩到一边别关。Node 没装或者版本太老，
窗口里会用大白话写去哪下、点哪个按钮，并且停住不消失。

## 三、日常：用户在看板里做什么

看板从上往下五块，对着「我现在在哪、卡在哪、下一步做什么」：

1. **三问**：走到第几步、卡在哪一条、下一步做什么。
2. **拦着你的事**：每条都写「怎么办」，要看文件的直接告诉他看项目里的哪个文件。
3. **要你回答**：一条一张卡，答完点「我确认做了」。需要交照片或扫描件的那些，
   卡里就嵌着一个框，照片拖进去即可。
4. **建议**：清单本身要改的时候才出现，「采纳」「先不用」两个按钮。采纳前会说清
   后果——清单变成第几版、之前答过的要重新答。
5. **谁在干活**：有助手在改文件时显示，没有就说没有。

页面每 5 秒自己刷新，不用手动点。

---

## 命令行（技术同事用）

```sh
node bin/webuddy.js --version                       # 版本
node bin/webuddy.js check <项目目录>                 # 检查一遍，人读
node bin/webuddy.js check <项目目录> --json          # 同一份结论，给机器/CI
node bin/webuddy.js open [项目目录]                  # 起看板并打开浏览器
node bin/webuddy.js serve --token <口令>             # 只起服务（给 CI / Multica）
node bin/webuddy.js evidence add <检查项编号> <文件…>  # 命令行补凭据
node bin/webuddy.js pack test <包目录>               # 包自测
node bin/webuddy.js pack lint <包目录> --strict      # 包体检
```

`check --json` 与 `POST /v1/check` 的输出逐字节相同，可以直接进 CI diff。
接口清单见 `integrations/multica/联调手册.md`。

## 跑测试

```sh
node --test                     # 全部（含看板端点往返，会在 127.0.0.1 起临时服务）
node --test test/board*.test.js # 只跑看板那部分
bash test/api-curl.sh           # 单独跑接口往返
bash test/board-curl.sh         # 单独跑看板端点往返
```

`node:test` 是 Node 自带的，不用装任何东西。测试只连 127.0.0.1，只在系统临时目录
里建文件。
