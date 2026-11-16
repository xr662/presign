#!/usr/bin/env bash
# 只更新服务器上的网站（法规服务没改时用）。在 presign/ 下运行：
#   DEPLOY_HOST=root@服务器地址 DEPLOY_KEY=~/.ssh/私钥 bash deploy/push-web.sh
# 步骤：打包 → 切成 1MB 小块逐个上传（整包传会断，交接文档第 5 节）→ 服务器上拼回、比对 sha256 →
# 换掉 /opt/presign/web（上一版留在 web.prev）→ 重启 presign-web → 本机检查首页。
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DEPLOY_HOST:?要设 DEPLOY_HOST，例如 root@服务器地址}"
: "${DEPLOY_KEY:?要设 DEPLOY_KEY，SSH 私钥路径}"
SSH=(ssh -i "$DEPLOY_KEY" -o ConnectTimeout=15)
SCP=(scp -i "$DEPLOY_KEY" -q -o ConnectTimeout=15)

bash deploy/pack.sh
tar -czf deploy/build/web.tar.gz -C deploy/build web
SUM=$(sha256sum deploy/build/web.tar.gz | cut -d' ' -f1)
rm -rf deploy/build/parts && mkdir deploy/build/parts
split -b 1M -d deploy/build/web.tar.gz deploy/build/parts/web.part.

"${SSH[@]}" "$DEPLOY_HOST" 'rm -rf /tmp/webparts && mkdir /tmp/webparts'
for f in deploy/build/parts/*; do
  for t in 1 2 3 4 5; do
    "${SCP[@]}" "$f" "$DEPLOY_HOST:/tmp/webparts/" && break
    echo "重传 $f（第 $t 次）"
    [ "$t" = 5 ] && { echo "上传失败：$f"; exit 1; }
  done
done

"${SSH[@]}" "$DEPLOY_HOST" "set -e
cat /tmp/webparts/web.part.* > /tmp/web.tar.gz
[ \"\$(sha256sum /tmp/web.tar.gz | cut -d' ' -f1)\" = '$SUM' ] || { echo 'sha256 不一致，没有替换'; exit 1; }
cd /opt/presign && rm -rf web.prev && mv web web.prev
tar -xzf /tmp/web.tar.gz -C /opt/presign web && chmod -R a+rX web
systemctl restart presign-web && sleep 3 && systemctl is-active presign-web
rm -rf /tmp/webparts /tmp/web.tar.gz"
rm -rf deploy/build/parts
echo "已部署 web.tar.gz（sha256 ${SUM:0:16}…），上一版在 /opt/presign/web.prev"
