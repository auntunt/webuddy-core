#!/bin/bash
#
# 双击这个文件就能打开看板。
#
# 为什么单独做一个文件：目标用户不知道什么是终端。
# 让他"打开终端 → cd 到目录 → 敲一条命令 → 记住端口 → 在浏览器输地址"，
# 他在第一步就放弃了，后面的检查清单做得再细都没人看见。
# macOS 上 .command 文件双击就会在终端里执行，这是最短的一条路。
#
# 装法（技术同事做一次）：把这个文件拷到用户桌面，或者拷到 webuddy-core
# 目录里再拖个替身到桌面。它靠 WEBUDDY_HOME 或自身位置找代码，见下面。

echo ""
echo "  WeBuddy 正在启动……"
echo ""

# ── 找代码在哪儿 ──
# 双击时终端的当前目录是用户的家目录，不是这个文件所在的目录，所以必须自己定位。
# 拷到桌面用的时候文件跟代码分开了，这时靠 WEBUDDY_HOME 指路。
HERE="$(cd "$(dirname "$0")" && pwd)"
if [ -n "${WEBUDDY_HOME:-}" ] && [ -f "$WEBUDDY_HOME/bin/webuddy.js" ]; then
  ROOT="$WEBUDDY_HOME"
elif [ -f "$HERE/bin/webuddy.js" ]; then
  ROOT="$HERE"
elif [ -f "$HERE/../bin/webuddy.js" ]; then
  ROOT="$(cd "$HERE/.." && pwd)"
else
  echo "  找不到 WeBuddy 的程序文件，看板打不开。"
  echo ""
  echo "  怎么办：把这句话转给帮你装的技术同事——"
  echo "    「打开看板.command 找不到 bin/webuddy.js。请把它放回 webuddy-core"
  echo "      目录（或它的 launchers/ 子目录）里，或者设一个 WEBUDDY_HOME"
  echo "      环境变量指向那个目录。」"
  echo ""
  read -r -p "  按回车键关闭…" _
  exit 1
fi
cd "$ROOT" || exit 1

# ── 找 node ──
# 双击启动的终端是非交互 shell，不读 .zshrc，所以 nvm / Homebrew 装的 node
# 不在 PATH 里。直接 command -v node 会失败，然后用户看到 "command not found: node"，
# 而他电脑上明明装了 node。所以要把常见位置补进 PATH 再找。
PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if [ -d "$HOME/.nvm/versions/node" ]; then
  # nvm 可能装了好几个版本，用版本号最大的那个
  NVM_NEWEST="$(ls -1 "$HOME/.nvm/versions/node" 2>/dev/null | sort -V | tail -1)"
  [ -n "$NVM_NEWEST" ] && PATH="$HOME/.nvm/versions/node/$NVM_NEWEST/bin:$PATH"
fi
export PATH

if ! command -v node >/dev/null 2>&1; then
  echo "  这台电脑上还没装 Node，WeBuddy 需要它才能跑。"
  echo ""
  echo "  怎么装："
  echo "    1) 用浏览器打开  https://nodejs.org"
  echo "    2) 点写着「LTS」的那个绿色大按钮，下载安装包"
  echo "    3) 双击下载好的文件，一路点「继续」装完"
  echo "    4) 回来再双击一次这个「打开看板」"
  echo ""
  echo "  LTS 是长期支持版，比另一个按钮稳。装的时候不用改任何选项。"
  echo ""
  echo "  这个窗口可以关掉了。"
  echo ""
  # 双击运行时窗口会立刻消失，用户看不到上面这些话。停住等他按一下键。
  read -r -p "  按回车键关闭…" _
  exit 1
fi

# 版本太老也得说清楚，不然报出来的是一句看不懂的语法错
MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$MAJOR" -lt 20 ] 2>/dev/null; then
  echo "  这台电脑上的 Node 是第 ${MAJOR} 版，太老了，WeBuddy 要第 20 版以上。"
  echo ""
  echo "  怎么办：用浏览器打开 https://nodejs.org ，点「LTS」那个绿色大按钮"
  echo "          下载装一遍（会覆盖旧的），再双击一次这个「打开看板」。"
  echo ""
  read -r -p "  按回车键关闭…" _
  exit 1
fi

# ── 起看板 ──
# 端口占用不在这里处理：open 命令会自己往后找空端口，
# 在 shell 里再探一遍等于两套逻辑，迟早对不上。
echo "  这个窗口关掉，看板就停了。想继续用就把它留着，缩到一边去。"
echo ""
node bin/webuddy.js open

# 看板停了（或者根本没起来）之后，别让窗口一闪就没。
# 出错信息要留在屏幕上，否则用户只知道"点了没反应"。
echo ""
read -r -p "  看板已停止。按回车键关闭这个窗口…" _
