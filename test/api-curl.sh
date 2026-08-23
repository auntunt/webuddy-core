#!/usr/bin/env bash
# test/api-curl.sh — HTTP API 端点完整测试（判据 7）
# 只连 127.0.0.1；服务输出重定向到日志，不占管道
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PORT=${PORT:-9876}
BASE="http://127.0.0.1:$PORT"
TOKEN="test123"
LOG="$(mktemp -t webuddy-api-log.XXXXXX)"
PROJ="$(mktemp -d -t webuddy-api-proj.XXXXXX)"
SERVER_PID=""
FAILED=0

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null
    wait "$SERVER_PID" 2>/dev/null
  fi
  rm -rf "$PROJ" "$LOG"
}
trap cleanup EXIT

ok()   { echo "✓ $1"; }
bad()  { echo "✗ $1"; FAILED=$((FAILED + 1)); }

# 断言 HTTP 状态码
expect_status() {
  local want="$1" got="$2" name="$3"
  if [ "$got" = "$want" ]; then ok "${name}（${got}）"; else bad "${name}：期望 ${want}，实际 ${got}"; fi
}

echo "=== 启动 API 服务（127.0.0.1:${PORT}）==="
node bin/webuddy.js serve --port "$PORT" --token "$TOKEN" --allow-origin '*' > "$LOG" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 40); do
  curl -s -m 2 -o /dev/null "$BASE/v1/packs" && break
  sleep 0.25
done
if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  echo "服务没起来，日志："; cat "$LOG"; exit 1
fi
ok "服务已就绪"

# 挂一个能查的项目：CLI check 没有 --pack（选项表已冻结），所以必须先挂载
node bin/webuddy.js pack mount "$PROJ" construction-safety > /dev/null 2>&1 \
  && ok "项目挂上 construction-safety" || bad "挂载失败"
: > "$PROJ/.webuddy/records.jsonl"

CURL="curl -s -m 20"
AUTH="Authorization: Bearer $TOKEN"
JSON="Content-Type: application/json"

echo ""
echo "=== 鉴权与 CORS（§8.1 三条规矩）==="
S=$($CURL -o /dev/null -w '%{http_code}' "$BASE/v1/packs")
expect_status 401 "$S" "不带口令被拦下"

S=$($CURL -o /dev/null -w '%{http_code}' -H "Authorization: Bearer wrong" "$BASE/v1/packs")
expect_status 401 "$S" "口令不对被拦下"

# 401 先于 CORS：带 Origin 也一样拦
S=$($CURL -o /dev/null -w '%{http_code}' -H "Origin: http://evil.example" "$BASE/v1/packs")
expect_status 401 "$S" "带来源但没口令，照样先报 401"

# OPTIONS 预检不带数据，放在鉴权之前，返回 204 + 三个 Allow 头
HDRS=$($CURL -D - -o /dev/null -X OPTIONS -H "Origin: http://ok.example" "$BASE/v1/check")
S=$(printf '%s' "$HDRS" | head -1 | tr -d '\r' | awk '{print $2}')
expect_status 204 "$S" "OPTIONS 预检放过"
for h in Access-Control-Allow-Origin Access-Control-Allow-Methods Access-Control-Allow-Headers; do
  if printf '%s' "$HDRS" | grep -qi "^$h:"; then ok "预检带上 $h"; else bad "预检少了 $h"; fi
done

echo ""
echo "=== GET /v1/packs ==="
RESP=$($CURL -H "$AUTH" "$BASE/v1/packs")
if printf '%s' "$RESP" | grep -q '"packs"'; then ok "返回担架包列表"; else bad "没有 packs 字段：$RESP"; fi

echo ""
echo "=== POST /v1/check ==="
S=$($CURL -o /dev/null -w '%{http_code}' -X POST -H "$AUTH" -H "$JSON" -d '{}' "$BASE/v1/check")
expect_status 422 "$S" "不说查哪个项目"

S=$($CURL -o /dev/null -w '%{http_code}' -X POST -H "$AUTH" -H "$JSON" -d '{"project":"/tmp/definitely-not-here-42"}' "$BASE/v1/check")
expect_status 404 "$S" "项目目录不存在"

S=$($CURL -o /dev/null -w '%{http_code}' -X POST -H "$AUTH" -H "$JSON" -d "{\"project\":\"$PROJ\",\"pack\":\"packs/nope\"}" "$BASE/v1/check")
expect_status 404 "$S" "担架包找不到"

S=$($CURL -o /dev/null -w '%{http_code}' -X POST -H "$AUTH" -H "$JSON" -d 'not json' "$BASE/v1/check")
expect_status 422 "$S" "请求体不是 JSON"

HTTP_OUT="$PROJ/http-verdict.json"
S=$($CURL -o "$HTTP_OUT" -w '%{http_code}' -X POST -H "$AUTH" -H "$JSON" \
  -d "{\"project\":\"$PROJ\",\"pack\":\"packs/construction-safety\"}" "$BASE/v1/check")
expect_status 200 "$S" "正常项目出结论"
for k in verdict counts blockers humanPending warnings trace inversion instanceVersion; do
  if grep -q "\"$k\"" "$HTTP_OUT"; then ok "结论里有 $k"; else bad "结论里少了 $k"; fi
done

echo ""
echo "=== §8.2：CLI --json 和 HTTP 同一个成型器 ==="
CLI_OUT="$PROJ/cli-verdict.json"
node bin/webuddy.js check --project "$PROJ" --json > "$CLI_OUT" 2>/dev/null
# durationMs / evaluatedAt 天然按时刻走，比对时剔掉
strip() { sed -E 's/"(durationMs|evaluatedAt|at)":[^,}]*/"\1":0/g' "$1"; }
if diff <(strip "$CLI_OUT") <(strip "$HTTP_OUT") > "$PROJ/diff.txt"; then
  ok "两边 JSON 逐字一致（只剔了时间字段）"
else
  bad "两边 JSON 不一致："; head -20 "$PROJ/diff.txt"
fi

echo ""
echo "=== GET /v1/rounds ==="
S=$($CURL -o /dev/null -w '%{http_code}' -H "$AUTH" "$BASE/v1/rounds")
expect_status 422 "$S" "不说查哪个项目"

S=$($CURL -o /dev/null -w '%{http_code}' -H "$AUTH" "$BASE/v1/rounds?project=/tmp/definitely-not-here-42")
expect_status 404 "$S" "项目目录不存在"

RESP=$($CURL -H "$AUTH" "$BASE/v1/rounds?project=$PROJ")
if printf '%s' "$RESP" | grep -q '"rounds"'; then ok "返回轮次列表"; else bad "没有 rounds 字段：$RESP"; fi

echo ""
echo "=== POST /v1/human-confirm ==="
S=$($CURL -o /dev/null -w '%{http_code}' -X POST -H "$AUTH" -H "$JSON" -d '{}' "$BASE/v1/human-confirm")
expect_status 422 "$S" "参数不全"

S=$($CURL -o /dev/null -w '%{http_code}' -X POST -H "$AUTH" -H "$JSON" \
  -d "{\"project\":\"$PROJ\",\"gateId\":\"no-such-gate\",\"pack\":\"packs/construction-safety\"}" "$BASE/v1/human-confirm")
expect_status 404 "$S" "这条检查不在清单里"

echo ""
echo "=== 未知接口 ==="
S=$($CURL -o /dev/null -w '%{http_code}' -H "$AUTH" "$BASE/v1/nonexist")
expect_status 404 "$S" "没有这个接口"

echo ""
if [ "$FAILED" -eq 0 ]; then
  echo "全部通过。"
  exit 0
fi
echo "有 $FAILED 项没过。"
exit 1
