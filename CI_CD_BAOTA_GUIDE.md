# GitHub + 宝塔 CI/CD（测试环境）

这份配置用于你当前仓库的两个项目：

- `admin-web`：推送后自动构建并发布静态文件到宝塔站点目录
- `industrial-realty-server`：推送后自动拉取并重启 PM2 进程

## 1) 服务器一次性准备（宝塔 + SSH）

1. 登录宝塔面板，确认安装：
   - `Nginx`
   - `PM2 管理器`（宝塔软件商店）
   - `Node.js 运行环境`（建议 LTS）
2. 在服务器终端执行（若未安装）：
   - `git --version`
   - `node -v`
   - `npm -v`
3. 生成一对仅用于 GitHub Action 连接服务器的 SSH key：
   - `ssh-keygen -t ed25519 -C "github-action-deploy" -f ~/.ssh/github_action_deploy`
4. 将公钥加入服务器本机登录用户（如 `root` 或你自己的部署用户）：
   - `cat ~/.ssh/github_action_deploy.pub >> ~/.ssh/authorized_keys`
   - `chmod 600 ~/.ssh/authorized_keys`

## 2) 宝塔中创建测试站点与后端进程

### A. 前端站点（admin-web）

1. 宝塔 -> 网站 -> 添加站点（测试域名）
2. 站点根目录建议设为：
   - `/www/wwwroot/admin-web-test`
3. `Nginx` 配置建议包含 SPA 回退（在站点配置里）：

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

> 前端工作流会把 `admin-web/dist` 同步到这个目录。

### B. 后端服务（industrial-realty-server）

1. 在服务器上准备代码目录（示例）：
   - `/www/wwwroot/industrial-realty-hifi/industrial-realty-server`
2. 首次手动拉代码：
   - `git clone <你的仓库地址> /www/wwwroot/industrial-realty-hifi`
3. 准备环境变量文件：
   - `industrial-realty-server/.env`
4. 首次手动启动（只做一次）：
   - `cd /www/wwwroot/industrial-realty-hifi/industrial-realty-server`
   - `npm ci`
   - `pm2 start src/index.js --name industrial-realty-server-test`
   - `pm2 save`
5. 宝塔放行对应后端端口（如 3000）并在 Nginx 反代到该端口。

## 3) GitHub 仓库 Secrets 配置

进入 GitHub 仓库 -> `Settings` -> `Secrets and variables` -> `Actions` -> `New repository secret`，添加：

- `ALIYUN_HOST`：服务器公网 IP
- `ALIYUN_SSH_PORT`：SSH 端口（默认 `22`）
- `ALIYUN_USER`：SSH 用户名（如 `root`）
- `ALIYUN_SSH_KEY`：`~/.ssh/github_action_deploy` 私钥全文
- `DEPLOY_BRANCH`：要部署的分支（当前工作流默认是 `main`）
- `SERVER_ADMIN_APP_DIR`：`admin-web` 在服务器代码目录（例如 `/www/wwwroot/industrial-realty-hifi/admin-web`）
- `SERVER_ADMIN_PUBLIC_DIR`：前端站点根目录（例如 `/www/wwwroot/admin-web-test`）
- `SERVER_API_APP_DIR`：后端代码目录（例如 `/www/wwwroot/industrial-realty-hifi/industrial-realty-server`）
- `SERVER_API_PM2_NAME`：后端 PM2 名称（例如 `industrial-realty-server-test`）

## 4) 工作流触发规则（已在仓库中配置）

- 前端：`.github/workflows/deploy-admin-web.yml`
  - 当 `main` 分支有 `admin-web/**` 变更时触发
- 后端：`.github/workflows/deploy-industrial-realty-server.yml`
  - 当 `main` 分支有 `industrial-realty-server/**` 变更时触发

## 5) 你需要确认的服务器目录映射

当前脚本假设：

- `admin-web` 代码目录下有 `deploy/deploy-test.sh`
- `industrial-realty-server` 代码目录下有 `deploy/deploy-test.sh`

并且 GitHub Action 通过 SSH 在服务器执行：

- `bash "$SERVER_ADMIN_APP_DIR/deploy/deploy-test.sh"`
- `bash "$SERVER_API_APP_DIR/deploy/deploy-test.sh"`

因此，服务器上的代码目录要和你填的 Secret 一致。

## 6) 常见问题排查

- `Permission denied (publickey)`：
  - 检查 `ALIYUN_SSH_KEY` 是否完整、对应公钥是否在 `authorized_keys`
- `npm ci` 失败：
  - 检查服务器 Node 版本与本地是否兼容
- 前端访问 404：
  - 检查站点根目录是否是 `SERVER_ADMIN_PUBLIC_DIR`
  - 检查 Nginx 是否配置 SPA 回退
- 后端未重启：
  - `pm2 list` 看 `SERVER_API_PM2_NAME` 是否一致

## 7) 你可能会想改的地方

- 如果你想用 `test` 分支自动部署：
  - 把两个工作流 `branches: [main]` 改成 `branches: [test]`
  - 同时把 `DEPLOY_BRANCH` secret 改成 `test`
