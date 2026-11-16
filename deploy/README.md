# 部署

目标机器：Ubuntu 24.04、x86_64、Node 24（装在 `/usr/local/bin/node`）。服务器上不构建、不装 npm 依赖，产物在本机打好再传上去。

## 结构

| 路径（服务器） | 内容 |
|---|---|
| `/opt/presign/web/` | Next.js standalone，`presign-web` 服务，监听 127.0.0.1:3000 |
| `/opt/presign/mcp/` | 劳动法规 MCP 服务单文件 `server.mjs`、法规库、向量模型，`presign-mcp` 服务，监听 127.0.0.1:3101 |
| `/etc/presign/env` | 模型密钥、评审账号、会话密钥。属主 `presign`，权限 600，不进仓库 |
| `/var/lib/presign/` | 用量库（只有次数、token、耗时） |
| `/etc/caddy/Caddyfile` | 反向代理，内容同本目录的 `Caddyfile` |

## 步骤

1. 本机打包（在 `presign/` 下）：`bash deploy/pack.sh`，得到 `deploy/build/presign.tar.gz`（约 33MB）。
2. 上传到服务器 `/tmp/`。网络不稳时可以先 `split -b 1M` 切块逐个传，服务器上 `cat` 拼回去，用 `sha256sum` 和本机比对。
3. 服务器上：
   ```bash
   useradd --system --home-dir /opt/presign --shell /usr/sbin/nologin presign   # 第一次
   mkdir -p /opt/presign /var/lib/presign /etc/presign && chown presign:presign /var/lib/presign
   rm -rf /opt/presign/web /opt/presign/mcp && tar -xzf /tmp/presign.tar.gz -C /opt/presign && chmod -R a+rX /opt/presign
   cp presign-web.service presign-mcp.service /etc/systemd/system/ && systemctl daemon-reload
   systemctl enable --now presign-mcp presign-web
   ```
4. Caddy 要 2.10 以上才能签 IP 地址证书，Ubuntu 源里是 2.6.2，所以加 Caddy 官方 apt 源（第一次）。先看公钥指纹，应为 `6576 0C51 EDEA 2017 CEA2 CA15 155B 6D79 CA56 EA34`（Caddy Web Server）：
   ```bash
   curl -1sSf -o /tmp/caddy.key https://dl.cloudsmith.io/public/caddy/stable/gpg.key
   gpg --show-keys --with-fingerprint /tmp/caddy.key
   gpg --dearmor < /tmp/caddy.key > /usr/share/keyrings/caddy-stable-archive-keyring.gpg
   echo "deb [signed-by=/usr/share/keyrings/caddy-stable-archive-keyring.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main" > /etc/apt/sources.list.d/caddy-stable.list
   apt-get update && apt-get install -y -o Dpkg::Options::=--force-confold caddy && caddy version
   caddy validate --adapter caddyfile --config Caddyfile && cp Caddyfile /etc/caddy/Caddyfile && systemctl reload caddy
   ```
   重载后 Caddy 自己向 Let's Encrypt 申请证书（10-31 用了 6 秒），`journalctl -u caddy | grep "certificate obtained"` 能看到。证书有效期约 6 天，Caddy 到期前自动续，续期要 80 和 443 端口都开着。换服务器或换域名时改 `Caddyfile` 里的地址。
5. `/etc/presign/env` 按 `.env.example` 填，至少要有 `LLM_MAIN_*`、`LLM_ALT_*`、`SESSION_SECRET`（`openssl rand -hex 32`）、`JUDGE_ACCOUNTS`（本机 `npm run account:hash -- 用户名` 生成）。改完 `systemctl restart presign-web`。
6. 检查：`systemctl is-active presign-mcp presign-web caddy`；`curl -I https://<服务器地址>/` 返回 200；`http://` 返回 308 跳到 https；不带登录 `POST /api/review` 返回 401；`echo | openssl s_client -connect <服务器地址>:443 -noservername | openssl x509 -noout -issuer -dates` 看证书签发方和有效期。

## 只更新网站

法规服务没改时只换 `web/`，包小一半（11-01 是 11.6MB），法规服务也不用重启。`deploy/push-web.sh` 把下面几步连起来做（打包、切块上传、比对 sha256、替换、重启）：

```bash
DEPLOY_HOST=root@<服务器地址> DEPLOY_KEY=<SSH 私钥路径> bash deploy/push-web.sh
```

手动做的话：

```bash
bash deploy/pack.sh && tar -czf deploy/build/web.tar.gz -C deploy/build web   # 本机
# 传到服务器 /tmp/ 并比对 sha256 后：
cd /opt/presign && rm -rf web.prev && mv web web.prev && tar -xzf /tmp/web.tar.gz -C /opt/presign web && chmod -R a+rX web && systemctl restart presign-web
```

上一版留在 `/opt/presign/web.prev`，新版有问题时 `rm -rf web && mv web.prev web && systemctl restart presign-web` 换回去。

## 在服务器上测模型接口速度

服务器上没有 npm 依赖，本机用打包脚本里的同一版 esbuild 把探测脚本打成单文件再传：

```bash
npx -y esbuild@0.25.11 scripts/probe-speed.ts --bundle --platform=node --format=esm --target=node24 \
  --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" \
  --outfile=deploy/build/probe-speed.mjs
# 传到服务器 /tmp/ 后：
cd /tmp && node --env-file=/etc/presign/env probe-speed.mjs
```

`--env-file` 直接读服务器上的密钥文件，不用复制。脚本只打印接口域名和模型名。

## 还没做

- `/api/health` 和部署后自动检查脚本（项目方案第 11 节）。
