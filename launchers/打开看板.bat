@echo off
rem 双击这个文件就能打开看板（Windows 版）。
rem
rem 第一行 chcp 65001 是把这个窗口切成 UTF-8 显示。不切的话下面的中文全是乱码，
rem 用户看到一屏问号，比什么都不显示更慌。这个文件本身也必须存成 UTF-8。
chcp 65001 >nul
setlocal

echo.
echo   WeBuddy 正在启动……
echo.

rem ── 找代码在哪儿 ──
rem 双击时当前目录未必是这个文件所在的目录，所以用 %~dp0（本文件所在路径）定位。
rem 拷到桌面用的时候文件跟代码分开了，这时靠 WEBUDDY_HOME 指路。
set "HERE=%~dp0"
set "ROOT="
if defined WEBUDDY_HOME if exist "%WEBUDDY_HOME%\bin\webuddy.js" set "ROOT=%WEBUDDY_HOME%"
if not defined ROOT if exist "%HERE%bin\webuddy.js" set "ROOT=%HERE%"
if not defined ROOT if exist "%HERE%..\bin\webuddy.js" set "ROOT=%HERE%.."
if not defined ROOT (
  echo   找不到 WeBuddy 的程序文件，看板打不开。
  echo.
  echo   怎么办：把这句话转给帮你装的技术同事——
  echo     「打开看板.bat 找不到 bin\webuddy.js。请把它放回 webuddy-core
  echo       目录（或它的 launchers 子目录）里，或者设一个 WEBUDDY_HOME
  echo       环境变量指向那个目录。」
  echo.
  pause
  exit /b 1
)
cd /d "%ROOT%" || exit /b 1

rem ── 找 node ──
rem Windows 的安装包会把 node 写进系统 PATH，所以一般能直接找到。
rem 找不到就是真没装（或者装完没重开窗口 —— PATH 的改动对已开的窗口不生效）。
where node >nul 2>nul
if errorlevel 1 (
  echo   这台电脑上还没装 Node，WeBuddy 需要它才能跑。
  echo.
  echo   怎么装：
  echo     1^) 用浏览器打开  https://nodejs.org
  echo     2^) 点写着「LTS」的那个绿色大按钮，下载安装包
  echo     3^) 双击下载好的文件，一路点「下一步」装完
  echo     4^) 回来再双击一次这个「打开看板」
  echo.
  echo   LTS 是长期支持版，比另一个按钮稳。装的时候不用改任何选项。
  echo   如果你刚装完还是这句话，把这个窗口关掉重新双击一次就好。
  echo.
  rem 双击运行时窗口会立刻消失，用户看不到上面这些话。停住等他按一下键。
  pause
  exit /b 1
)

rem 版本太老也得说清楚，不然报出来的是一句看不懂的语法错
for /f "delims=" %%v in ('node -p "process.versions.node.split(\".\")[0]" 2^>nul') do set "MAJOR=%%v"
if not defined MAJOR set "MAJOR=0"
if %MAJOR% LSS 20 (
  echo   这台电脑上的 Node 是第 %MAJOR% 版，太老了，WeBuddy 要第 20 版以上。
  echo.
  echo   怎么办：用浏览器打开 https://nodejs.org ，点「LTS」那个绿色大按钮
  echo           下载装一遍（会覆盖旧的），再双击一次这个「打开看板」。
  echo.
  pause
  exit /b 1
)

rem ── 起看板 ──
rem 端口占用不在这里处理：open 命令会自己往后找空端口，
rem 在批处理里再探一遍等于两套逻辑，迟早对不上。
echo   这个窗口关掉，看板就停了。想继续用就把它留着，缩到一边去。
echo.
node bin\webuddy.js open

rem 看板停了（或者根本没起来）之后，别让窗口一闪就没。
rem 出错信息要留在屏幕上，否则用户只知道"点了没反应"。
echo.
echo   看板已停止。
pause
endlocal
