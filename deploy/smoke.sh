#!/usr/bin/env bash
# 部署后的自动检查（项目方案第 11 节，任务书 T24）。从外网按评委的路径走一遍，不登录、不调模型。
# 用法：BASE=https://服务器地址 bash deploy/smoke.sh      全部通过退出码为 0
set -uo pipefail
: "${BASE:?要设 BASE，例如 https://服务器地址}"
fail=0
ok() { echo "通过  $1"; }
bad() { echo "失败  $1"; fail=1; }

code() { curl -s -o /dev/null -w "%{http_code}" --max-time 20 "$@"; }

# 页面：评委会打开的几处
for p in / /samples /samples/offer /check /practice /login /about; do
  c=$(code "$BASE$p")
  [ "$c" = 200 ] && ok "$p 返回 200" || bad "$p 返回 $c"
done

# http 自动跳 https
host=${BASE#https://}
c=$(code "http://$host/")
[ "$c" = 308 ] || [ "$c" = 301 ] && ok "http 跳转 https（$c）" || bad "http 返回 $c，没有跳转"

# 健康检查：法规服务、模型配置、登录配置
h=$(curl -s --max-time 20 "$BASE/api/health")
case "$h" in *'"ok":true'*) ok "健康检查 $h" ;; *) bad "健康检查 $h" ;; esac

# 示例合同录像能取到（示例页回放用，不登录也能看）
c=$(code "$BASE/recordings/offer.json")
[ "$c" = 200 ] && ok "示例录像可下载" || bad "示例录像返回 $c"

# 调模型的接口不登录一律拒绝
for p in /api/review /api/practice /api/ocr; do
  c=$(code -X POST -H "Origin: $BASE" -H "Content-Type: application/json" -d '{}' "$BASE$p")
  [ "$c" = 401 ] && ok "$p 未登录返回 401" || bad "$p 未登录返回 $c"
done

# 证书还剩几天（Let's Encrypt 的 IP 证书约 6 天一换，Caddy 自动续；少于 2 天说明续期出了问题）
end=$(echo | openssl s_client -connect "$host:443" -noservername 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
if [ -n "$end" ]; then
  left=$(( ($(date -d "$end" +%s) - $(date +%s)) / 86400 ))
  [ "$left" -ge 2 ] && ok "证书还有 $left 天到期" || bad "证书只剩 $left 天"
else
  bad "读不到证书"
fi

[ $fail = 0 ] && echo "全部通过" || echo "有检查没通过"
exit $fail
