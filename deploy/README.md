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
   apt-get install -y caddy && cp Caddyfile /etc/caddy/Caddyfile && systemctl reload caddy
   ```
4. `/etc/presign/env` 按 `.env.example` 填，至少要有 `LLM_MAIN_*`、`LLM_ALT_*`、`SESSION_SECRET`（`openssl rand -hex 32`）、`JUDGE_ACCOUNTS`（本机 `npm run account:hash -- 用户名` 生成）。改完 `systemctl restart presign-web`。
5. 检查：`systemctl is-active presign-mcp presign-web caddy`；`curl http://127.0.0.1:3000/` 返回 200；不带登录 `POST /api/review` 返回 401。

## 还没做

- HTTPS：Ubuntu 软件源里的 Caddy 是 2.6.2，签不了 IP 地址证书。登录 Cookie 带 Secure，HTTPS 之前登录用不了，只能看示例合同。
- `/api/health` 和部署后自动检查脚本（项目方案第 11 节）。
