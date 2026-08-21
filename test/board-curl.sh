#!/usr/bin/env bash
# test/board-curl.sh — 看板端点往返测试（§14.5 判据 2）
# 只连 127.0.0.1；服务输出重定向到日志，不占管道
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PORT=${PORT:-9877}
BASE="http://127.0.0.1:${PORT}"
TOKEN="board123"
LOG="$(mktemp -t webuddy-board-log)"
PROJ="$(mktemp -d -t webuddy-board-proj)"
TMP="$(mktemp -d -t webuddy-board-tmp)"
SERVER_PID=""
FAILED=0

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null
    wait "$SERVER_PID" 2>/dev/null
  fi
  # 注册表是用户级的（~/.webuddy/projects.json），临时项目用完要摘掉，
  # 不然下一次跑测试会看到一堆已经删掉的目录
  node -e "
    const { loadRegistry, saveRegistry } = await import('./src/kernel/registry.js');
    const reg = loadRegistry();
    reg.projects = (reg.projects || []).filter((p) => !String(p.dir).includes('webuddy-board-proj'));
    saveRegistry(reg);
  " --input-type=module 2>/dev/null
  rm -rf "$PROJ" "$TMP" "$LOG"
}
trap cleanup EXIT

ok()  { echo "✓ $1"; }
bad() { echo "✗ $1"; FAILED=$((FAILED + 1)); }

# 清单第几版。文件还没有就算第 0 版——pack mount 不建 skeleton.json，
# 第一次 apply 才建，所以"读不到"是正常状态，不是错误。
iv() {
  node -e "
    const fs = require('fs');
    try { console.log(JSON.parse(fs.readFileSync(process.argv[1], 'utf8')).instanceVersion); }
    catch { console.log(0); }
  " "${PROJ}/.webuddy/skeleton.json"
}

expect_status() {
  local want="$1" got="$2" name="$3"
  if [ "$got" = "$want" ]; then ok "${name}（${got}）"; else bad "${name}：期望 ${want}，实际 ${got}"; fi
}

echo "=== 启动看板服务（127.0.0.1:${PORT}）==="
node bin/webuddy.js serve --port "${PORT}" --token "${TOKEN}" > "$LOG" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 40); do
  curl -s -m 2 -o /dev/null "${BASE}/" && break
  sleep 0.25
done
if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  echo "服务没起来，日志："; cat "$LOG"; exit 1
fi
ok "服务已就绪"

CURL="curl -s -m 20"
AUTH="Authorization: Bearer ${TOKEN}"

# 挂一个能查的项目，再加到看板注册表上
node bin/webuddy.js pack mount "$PROJ" construction-safety > /dev/null 2>&1 \
  && ok "项目挂上 construction-safety" || bad "挂载失败"

echo
echo "=== 1. 静态页与 /api/meta（仅同源）==="

# GET / 返回 HTML
ROOT_BODY="$($CURL "${BASE}/")"
ROOT_CT="$($CURL -o /dev/null -w '%{content_type}' "${BASE}/")"
case "$ROOT_BODY" in
  *"<html"*|*"<!doctype"*|*"<div"*) ok "GET / 返回 HTML" ;;
  *) bad "GET / 不是 HTML：$(printf '%s' "$ROOT_BODY" | head -c 80)" ;;
esac
case "$ROOT_CT" in
  text/html*) ok "GET / 的类型是 text/html" ;;
  *) bad "GET / 的类型是 ${ROOT_CT}" ;;
esac

# 静态页不要 Bearer：浏览器加载文档时带不了这个头
S="$($CURL -o /dev/null -w '%{http_code}' "${BASE}/app.js")"
expect_status 200 "$S" "GET /app.js 不用口令也能拿"
S="$($CURL -o /dev/null -w '%{http_code}' "${BASE}/style.css")"
expect_status 200 "$S" "GET /style.css 不用口令也能拿"

# 同源（不带 Origin，等于非浏览器）能拿到口令
META="$($CURL "${BASE}/api/meta")"
case "$META" in
  *"${TOKEN}"*) ok "同源 GET /api/meta 给出口令" ;;
  *) bad "同源 GET /api/meta 没给口令：${META}" ;;
esac
case "$META" in
  *检查项*) ok "/api/meta 随口令带上了术语表" ;;
  *) bad "/api/meta 没带术语表" ;;
esac

# 静态页与 /api/meta 都不设 CORS 头（§14.3 仅同源）
H="$($CURL -D - -o /dev/null "${BASE}/api/meta")"
case "$H" in
  *[Aa]ccess-[Cc]ontrol-[Aa]llow-[Oo]rigin*) bad "/api/meta 漏了 CORS 头，跨源脚本读得到口令" ;;
  *) ok "/api/meta 不设任何 CORS 头" ;;
esac

echo
echo "=== 2. 跨源被拒 ==="

S="$($CURL -o /dev/null -w '%{http_code}' -H 'Origin: http://evil.example' "${BASE}/api/meta")"
expect_status 403 "$S" "跨源 GET /api/meta 被拒"
S="$($CURL -o /dev/null -w '%{http_code}' -H 'Origin: http://evil.example' "${BASE}/")"
expect_status 403 "$S" "跨源 GET / 被拒"
BODY="$($CURL -H 'Origin: http://evil.example' "${BASE}/api/meta")"
case "$BODY" in
  *"${TOKEN}"*) bad "跨源被拒的响应里居然还带着口令" ;;
  *) ok "跨源被拒时不漏口令" ;;
esac

# 伪造口令：数据端点一律 401
S="$($CURL -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer wrong' "${BASE}/v1/projects")"
expect_status 401 "$S" "假口令读项目列表被拒"
S="$($CURL -o /dev/null -w '%{http_code}' "${BASE}/v1/projects")"
expect_status 401 "$S" "不带口令读项目列表被拒"

echo
echo "=== 3. 项目加进看板、读回摘要 ==="

S="$($CURL -o /dev/null -w '%{http_code}' -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{}' "${BASE}/v1/projects")"
expect_status 422 "$S" "加项目不给目录回 422"

ADD="$($CURL -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"dir\":\"${PROJ}\",\"alias\":\"望江路项目\"}" "${BASE}/v1/projects")"
case "$ADD" in
  *望江路项目*) ok "POST /v1/projects 把项目加进来了" ;;
  *) bad "加项目失败：${ADD}" ;;
esac

LIST="$($CURL -H "$AUTH" "${BASE}/v1/projects")"
case "$LIST" in
  *望江路项目*) ok "GET /v1/projects 列表里有它" ;;
  *) bad "列表里没有刚加的项目：$(printf '%s' "$LIST" | head -c 200)" ;;
esac
case "$LIST" in
  *'"stage"'*) ok "列表带上了第几步（三问第一问要用）" ;;
  *) bad "列表里没有 stage，看板画不出「现在走到第几步」" ;;
esac

ONE="$($CURL -H "$AUTH" "${BASE}/v1/projects?project=${PROJ}")"
case "$ONE" in
  *望江路项目*) ok "单项目查询（轻刷新走这条）能读回来" ;;
  *) bad "单项目查询失败：$(printf '%s' "$ONE" | head -c 200)" ;;
esac
S="$($CURL -o /dev/null -w '%{http_code}' -H "$AUTH" "${BASE}/v1/projects?project=/nope/nothing/here")"
expect_status 404 "$S" "查一个没加过的项目回 404"

echo
echo "=== 4. 上传一张假照片，evidence list 看得见 ==="

PHOTO="${TMP}/现场照片.jpg"
# 造一张有 JPEG 头的小文件。名字带中文和空格，正好验一遍文件名处理
printf '\xff\xd8\xff\xe0假的照片内容' > "$PHOTO"

UP="$($CURL -X POST -H "$AUTH" \
  -F "project=${PROJ}" -F 'gateId=3.5' -F "files=@${PHOTO}" \
  "${BASE}/v1/evidence")"
case "$UP" in
  *现场照片*) ok "multipart 上传收下了这张照片" ;;
  *) bad "上传失败：${UP}" ;;
esac

EV="$(node bin/webuddy.js evidence list --project "$PROJ" 2>&1)"
case "$EV" in
  *现场照片*) ok "evidence list 里看得见（往返打通）" ;;
  *) bad "evidence list 里看不见：${EV}" ;;
esac

# 落盘位置只经 state.js 拼，抽查一下真在那儿
if [ -f "${PROJ}/.webuddy/evidence/3.5/现场照片.jpg" ]; then
  ok "文件落在 .webuddy/evidence/3.5/ 下"
else
  bad "文件没落到该去的地方：$(ls -R "${PROJ}/.webuddy/evidence" 2>&1 | head -5)"
fi

# 一次传两个也要都收下
printf '\xff\xd8\xff\xe0第二张' > "${TMP}/second.jpg"
UP2="$($CURL -X POST -H "$AUTH" \
  -F "project=${PROJ}" -F 'gateId=3.5' -F "files=@${PHOTO}" -F "files=@${TMP}/second.jpg" \
  "${BASE}/v1/evidence")"
case "$UP2" in
  *second.jpg*) ok "一次传两个都收下了" ;;
  *) bad "多文件上传丢了东西：${UP2}" ;;
esac

echo
echo "=== 5. 恶意输入：超大文件、跨源上传、缺参数 ==="

# 21MB：超过单文件 20MB 上限
BIG="${TMP}/太大的文件.bin"
node -e "require('fs').writeFileSync(process.argv[1], Buffer.alloc(21*1024*1024, 97))" "$BIG"
BIGR="$($CURL -m 60 -w '\n%{http_code}' -X POST -H "$AUTH" \
  -F "project=${PROJ}" -F 'gateId=3.5' -F "files=@${BIG}" "${BASE}/v1/evidence")"
BIGS="$(printf '%s' "$BIGR" | tail -1)"
BIGB="$(printf '%s' "$BIGR" | sed '$d')"
expect_status 422 "$BIGS" "超 20MB 上传被拒"
# 三段式：说清什么事（多大）+ 上限多少 + 怎么办
case "$BIGB" in
  *太大*) ok "报错说了这文件太大" ;;
  *) bad "报错没说太大：${BIGB}" ;;
esac
case "$BIGB" in
  *MB*) ok "报错带了具体数字" ;;
  *) bad "报错没带数字：${BIGB}" ;;
esac
case "$BIGB" in
  *怎么办*) ok "报错说了怎么办（三段式齐了）" ;;
  *) bad "报错没说怎么办：${BIGB}" ;;
esac
if [ -f "${PROJ}/.webuddy/evidence/3.5/太大的文件.bin" ]; then
  bad "被拒的大文件居然落盘了"
else
  ok "被拒的大文件没落盘"
fi

S="$($CURL -o /dev/null -w '%{http_code}' -X POST -H "$AUTH" -H 'Origin: http://evil.example' \
  -F "project=${PROJ}" -F 'gateId=3.5' -F "files=@${PHOTO}" "${BASE}/v1/evidence")"
expect_status 403 "$S" "跨源上传被拒"

S="$($CURL -o /dev/null -w '%{http_code}' -X POST -H "$AUTH" \
  -F "project=${PROJ}" -F "files=@${PHOTO}" "${BASE}/v1/evidence")"
expect_status 422 "$S" "不说是哪一条检查的上传被拒"

S="$($CURL -o /dev/null -w '%{http_code}' -X POST -H "$AUTH" \
  -H 'Content-Type: application/json' -d '{"project":"x"}' "${BASE}/v1/evidence")"
expect_status 422 "$S" "不是文件上传的请求被拒"

echo
echo "=== 6. 回答存得下 ==="

ANS="$($CURL -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"project\":\"${PROJ}\",\"promptId\":\"3.5\",\"answers\":{\"done\":\"装齐了\",\"evidence\":\"照片已传\"}}" \
  "${BASE}/v1/answers")"
# 响应是缩进过的 JSON，别按 "ok":true 这种紧挨着的写法去匹配
case "$ANS" in
  *'"ok"'*true*) ok "POST /v1/answers 存下了" ;;
  *) bad "存回答失败：${ANS}" ;;
esac
case "$(cat "${PROJ}/.webuddy/state.json")" in
  *"3.5.done"*) ok "回答按「条目号.键」存，不同条目的同名键不会互相顶掉" ;;
  *) bad "回答没按条目号存：$(cat "${PROJ}/.webuddy/state.json")" ;;
esac

echo
echo "=== 7. 采纳建议后清单版本 +1 ==="

# 造一条待处理的建议。propose 要调模型，这里直接落一份文件——
# 验的是 apply 这条路，不是模型那条路。
node -e "
  const fs = await import('node:fs');
  const { statePath } = await import('./src/kernel/state.js');
  const dir = process.argv[1];
  const rec = {
    id: 'test-proposal-1',
    proposal: { na: ['4.1'], restore: [], dims: [] },
    premises: { forClient: null, toDeploy: null },
    dropped: [],
    reasoning: '这个项目不涉及深基坑，把那一条标成不适用',
    fingerprint: 'test',
    packName: 'construction-safety',
    packVersion: '1.0.0',
    baseInstanceVersion: 0,
    status: 'pending',
    createdAt: '2026-08-20T02:00:00.000Z',
  };
  fs.writeFileSync(statePath(dir, 'proposals', 'test-proposal-1.json'),
    JSON.stringify(rec, null, 2) + '\n', 'utf8');
" --input-type=module "$PROJ" && ok "造了一条待处理建议" || bad "造建议失败"

PL="$($CURL -H "$AUTH" "${BASE}/v1/proposals?project=${PROJ}")"
case "$PL" in
  *test-proposal-1*) ok "GET /v1/proposals 列出待处理的" ;;
  *) bad "建议列表读不到：${PL}" ;;
esac
# 大白话 diff 随行（renderProposal 在服务端渲染，前端不再拼一遍）
case "$PL" in
  *'"text"'*) ok "建议带着大白话说明" ;;
  *) bad "建议没带说明文本：${PL}" ;;
esac
case "$PL" in
  *不适用*|*不用做*|*跳过*) ok "说明里说清了要改什么" ;;
  *) bad "说明看不出要改什么：$(printf '%s' "$PL" | head -c 300)" ;;
esac

BEFORE="$(iv)"

AP="$($CURL -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"project\":\"${PROJ}\",\"approvedBy\":\"看板\"}" \
  "${BASE}/v1/proposals/test-proposal-1/apply")"
case "$AP" in
  *'"ok"'*true*) ok "POST /v1/proposals/<id>/apply 生效了" ;;
  *) bad "采纳失败：${AP}" ;;
esac
AFTER="$(iv)"
if [ "$AFTER" = "$((BEFORE + 1))" ]; then
  ok "清单版本从 ${BEFORE} 涨到 ${AFTER}（+1）"
else
  bad "版本没按 +1 涨：${BEFORE} → ${AFTER}"
fi

# 采纳过的不该再出现在待处理列表里
PL2="$($CURL -H "$AUTH" "${BASE}/v1/proposals?project=${PROJ}")"
case "$PL2" in
  *test-proposal-1*) bad "采纳过的建议还挂在待处理列表里" ;;
  *) ok "采纳过的建议从待处理列表里消失了" ;;
esac
# 再点一次不该把版本再涨一遍
$CURL -X POST -H "$AUTH" -H 'Content-Type: application/json' -d "{\"project\":\"${PROJ}\"}" \
  "${BASE}/v1/proposals/test-proposal-1/apply" > /dev/null
AGAIN="$(iv)"
if [ "$AGAIN" = "$AFTER" ]; then ok "重复采纳不会再涨一版"; else bad "重复采纳把版本涨到了 ${AGAIN}"; fi

echo
echo "=== 8. 先不用（reject）==="

node -e "
  const fs = await import('node:fs');
  const { statePath } = await import('./src/kernel/state.js');
  const dir = process.argv[1];
  fs.writeFileSync(statePath(dir, 'proposals', 'test-proposal-2.json'), JSON.stringify({
    id: 'test-proposal-2',
    proposal: { na: ['5.1'], restore: [], dims: [] },
    premises: {}, dropped: [], reasoning: '再来一条',
    fingerprint: 'test', packName: 'construction-safety', packVersion: '1.0.0',
    baseInstanceVersion: 1, status: 'pending', createdAt: '2026-08-20T03:00:00.000Z',
  }, null, 2) + '\n', 'utf8');
" --input-type=module "$PROJ"

VBEFORE="$(iv)"
RJ="$($CURL -X POST -H "$AUTH" -H 'Content-Type: application/json' -d "{\"project\":\"${PROJ}\"}" \
  "${BASE}/v1/proposals/test-proposal-2/reject")"
case "$RJ" in
  *'"ok"'*true*) ok "POST /v1/proposals/<id>/reject 记下了" ;;
  *) bad "先不用失败：${RJ}" ;;
esac
VAFTER="$(iv)"
if [ "$VAFTER" = "$VBEFORE" ]; then ok "先不用不碰清单版本"; else bad "先不用居然改了版本：${VBEFORE} → ${VAFTER}"; fi
if [ -f "${PROJ}/.webuddy/proposals/test-proposal-2.json" ]; then
  ok "拒掉的建议留着底（下次同样的情况不再提一遍）"
else
  bad "拒掉的建议被删了"
fi

S="$($CURL -o /dev/null -w '%{http_code}' -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"project\":\"${PROJ}\"}" "${BASE}/v1/proposals/no-such-proposal/apply")"
case "$S" in
  404|422) ok "采纳一条不存在的建议被拒（${S}）" ;;
  *) bad "采纳不存在的建议返回了 ${S}" ;;
esac

echo
if [ "$FAILED" -eq 0 ]; then
  echo "全部通过。"
else
  echo "有 ${FAILED} 条没过。"
  exit 1
fi
