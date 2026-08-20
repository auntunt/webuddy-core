#!/usr/bin/env bash
set -e

# test/api-curl.sh — API 端点完整测试

echo "=== 启动 API 服务 ==="
node server/start.js --port 9876 --token test123 --allow-origin '*' &
SERVER_PID=$!
sleep 2

BASE="http://localhost:9876"
TOKEN="test123"

echo ""
echo "=== 测试 1: 无 token 应返回 401 ==="
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/v1/packs")
if [ "$STATUS" = "401" ]; then
  echo "✓ 401 正确"
else
  echo "✗ 期望 401，实际 $STATUS"
  kill $SERVER_PID
  exit 1
fi

echo ""
echo "=== 测试 2: 错误 token 应返回 401 ==="
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer wrong" "$BASE/v1/packs")
if [ "$STATUS" = "401" ]; then
  echo "✓ 401 正确"
else
  echo "✗ 期望 401，实际 $STATUS"
  kill $SERVER_PID
  exit 1
fi

echo ""
echo "=== 测试 3: OPTIONS 预检 ==="
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X OPTIONS "$BASE/v1/packs")
if [ "$STATUS" = "204" ]; then
  echo "✓ 204 正确"
else
  echo "✗ 期望 204，实际 $STATUS"
  kill $SERVER_PID
  exit 1
fi

echo ""
echo "=== 测试 4: GET /v1/packs ==="
RESP=$(curl -s -H "Authorization: Bearer $TOKEN" "$BASE/v1/packs")
echo "$RESP" | grep -q '"packs"'
if [ $? -eq 0 ]; then
  echo "✓ 返回包列表"
  echo "$RESP" | head -5
else
  echo "✗ 未返回预期字段"
  kill $SERVER_PID
  exit 1
fi

echo ""
echo "=== 测试 5: POST /v1/check 缺少 project 应返回 422 ==="
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}' "$BASE/v1/check")
if [ "$STATUS" = "422" ]; then
  echo "✓ 422 正确"
else
  echo "✗ 期望 422，实际 $STATUS"
  kill $SERVER_PID
  exit 1
fi

echo ""
echo "=== 测试 6: POST /v1/check 不存在的项目应返回 404 ==="
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"project":"/tmp/nonexist"}' "$BASE/v1/check")
if [ "$STATUS" = "404" ]; then
  echo "✓ 404 正确"
else
  echo "✗ 期望 404，实际 $STATUS"
  kill $SERVER_PID
  exit 1
fi

echo ""
echo "=== 测试 7: POST /v1/check 正常项目 ==="
mkdir -p /tmp/test-proj/.webuddy
echo '[]' > /tmp/test-proj/.webuddy/records.jsonl
RESP=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"project":"/tmp/test-proj","pack":"packs/construction-safety"}' "$BASE/v1/check")
echo "$RESP" | grep -q '"total"'
if [ $? -eq 0 ]; then
  echo "✓ 返回 verdict"
  echo "$RESP" | head -5
else
  echo "✗ 未返回预期字段"
  kill $SERVER_PID
  exit 1
fi

echo ""
echo "=== 测试 8: GET /v1/rounds 缺少 project 应返回 422 ==="
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" "$BASE/v1/rounds")
if [ "$STATUS" = "422" ]; then
  echo "✓ 422 正确"
else
  echo "✗ 期望 422，实际 $STATUS"
  kill $SERVER_PID
  exit 1
fi

echo ""
echo "=== 测试 9: GET /v1/rounds 正常项目 ==="
RESP=$(curl -s -H "Authorization: Bearer $TOKEN" "$BASE/v1/rounds?project=/tmp/test-proj")
echo "$RESP" | grep -q '"rounds"'
if [ $? -eq 0 ]; then
  echo "✓ 返回轮次列表"
else
  echo "✗ 未返回预期字段"
  kill $SERVER_PID
  exit 1
fi

echo ""
echo "=== 测试 10: POST /v1/human-confirm 缺少参数应返回 422 ==="
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}' "$BASE/v1/human-confirm")
if [ "$STATUS" = "422" ]; then
  echo "✓ 422 正确"
else
  echo "✗ 期望 422，实际 $STATUS"
  kill $SERVER_PID
  exit 1
fi

echo ""
echo "=== 测试 11: 404 端点 ==="
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" "$BASE/v1/nonexist")
if [ "$STATUS" = "404" ]; then
  echo "✓ 404 正确"
else
  echo "✗ 期望 404，实际 $STATUS"
  kill $SERVER_PID
  exit 1
fi

echo ""
echo "=== 清理 ==="
kill $SERVER_PID
rm -rf /tmp/test-proj
echo "✓ 所有测试通过"
