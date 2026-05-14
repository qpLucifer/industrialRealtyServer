# industrial-realty-server · CI/CD

对应工作流：`.github/workflows/deploy-industrial-realty-server.yml`。

## 做什么

`main` 分支 **push** → GitHub 打包 `package.json`、`package-lock.json`、`src`、`scripts`、`deploy`（**无 node_modules**）→ **SCP** 到 `/tmp` → **SSH** 解压到 `SERVER_API_APP_DIR` → 可选写入 `.env` → `npm ci --omit=dev` → `pm2 delete` 后 `pm2 start src/index.js`。服务器**不需要 Git**。

## GitHub Secrets

**Settings → Secrets and variables → Actions**：

| Secret | 必填 | 说明 |
|--------|------|------|
| `ALIYUN_HOST` | 是 | 服务器 IP 或域名 |
| `ALIYUN_USER` | 是 | SSH 用户 |
| `ALIYUN_SSH_PORT` | 是 | SSH 端口，**只填数字**（默认 `22`） |
| `ALIYUN_SSH_KEY` | 是 | SSH **私钥全文**（含 `BEGIN`/`END`） |
| `SERVER_API_APP_DIR` | 是 | 部署目录；不存在会自动 `mkdir -p` |
| `SERVER_API_PM2_NAME` | 是 | PM2 应用名（与 `pm2 start --name` 一致） |
| `SERVER_DOTENV_B64` | 否 | 有则每次部署解码写入 `.env`；无则用服务器已有 `.env` |

**`SERVER_DOTENV_B64`**（Linux/macOS）：`printf '%s' "$(cat .env)" | base64 -w0`，整段粘贴到 Secret。勿把 `.env` 提交到 Git。

## SSH 端口与密钥（简要）

- **端口**：默认 `22`；可查 `grep -E '^Port' /etc/ssh/sshd_config` 或 `sudo ss -tlnp | grep sshd`。宝塔 / 云安全组须放行；Secret 里**只填数字**。
- **密钥**：`ssh-keygen -t ed25519 -f ~/.ssh/gha_aliyun -N ""` → 公钥整行追加到部署用户的 `~/.ssh/authorized_keys` → 私钥全文（含 `BEGIN`/`END`）粘贴到 `ALIYUN_SSH_KEY` → 本地 `ssh -i ~/.ssh/gha_aliyun -p PORT user@host "echo ok"` 通过后再保存 Secrets。

## 服务器环境

工作流会补 **PATH**（含宝塔常见 Node 路径）。部署用户下须能执行 `node`、`npm`、`pm2`（宝塔安装 Node / PM2 管理器即可）。

首次：准备数据库等，见 `.env.example`；任选服务器手写 `.env` 或 Secret `SERVER_DOTENV_B64`。

## 排错

- **`node`/`pm2` 找不到**：宝塔 Node 是否安装；用同一用户 SSH 登录执行 `command -v node pm2`。
- **进程起不来**：看 Actions 里 `pm2 logs`；查 `.env`、数据库、端口。
- **依赖安装失败**：`package-lock.json` 是否提交；服务器 Node 主版本建议与 GitHub（当前 Node 22）一致。
