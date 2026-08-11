# GitHub 同步与 VPS 部署流程

本文记录元素化学题库的生产分支、GitHub 同步、VPS 发布、本机 PostgreSQL 和回滚流程。命令默认在 `quiz_app` 仓库中执行。

## 1. 当前生产架构

- `main`：VPS 生产版本，使用 VPS 本机 PostgreSQL。
- `agent/vercel-neon-deployment`：Vercel + Neon 的独立版本，不合并到 `main`。
- 正式域名：`https://chemquiz.dpdns.org/`。
- 应用目录：`/opt/quizapp/current`，它是指向具体 release 的符号链接。
- 本机数据库：PostgreSQL 17，仅通过 `127.0.0.1:5432` 访问。
- 运行环境文件：`/etc/quizapp.env`，不得提交到 Git。
- systemd 服务：`/etc/systemd/system/quizapp.service`。
- Nginx 配置：`/etc/nginx/sites-available/quizapp`。
- 教材页图共享目录：`/opt/quizapp/shared/page-images`。
- 数据库备份由 VPS 提供商每周完成，不安装应用层备份 timer。

仓库内对应的无密钥生产配置位于 `deploy/vps/`。

## 2. 本地工具与安全要求

项目专用工具位于：

```text
A:\ElementChemistry\quiz_app\.tools
```

主要内容：

- `.tools/bin/gh.exe`：GitHub CLI。
- `.tools/gh-config`：项目专用 GitHub CLI 配置。
- `.tools/ssh/evoxt_quizapp_ed25519`：VPS 专用 SSH 密钥。
- `.tools/ssh/evoxt_known_hosts`：固定的 VPS 主机指纹。
- `.tools/deploy`：本地发布包目录。

注意：

- `.tools/`、`.env*`、私钥、数据库连接串和 `/etc/quizapp.env` 必须保持在 Git 忽略范围内。
- 不要在命令输出、日志、提交信息或文档中打印令牌、数据库密码或完整连接串。
- SSH 始终使用 `StrictHostKeyChecking=yes` 和项目提供的 `known_hosts`。
- 工作区存在无关修改时，不使用 `git add -A`；应指定文件，或创建独立 worktree。

## 3. GitHub CLI 登录

项目工具需要显式指定配置目录：

```powershell
$env:GH_CONFIG_DIR='A:\ElementChemistry\quiz_app\.tools\gh-config'
& 'A:\ElementChemistry\quiz_app\.tools\bin\gh.exe' auth status
```

需要重新登录时：

```powershell
$env:GH_CONFIG_DIR='A:\ElementChemistry\quiz_app\.tools\gh-config'
& 'A:\ElementChemistry\quiz_app\.tools\bin\gh.exe' auth login `
  -h github.com -p https -w --insecure-storage
```

`--insecure-storage` 会把令牌写入已被 Git 忽略的 `.tools/gh-config/hosts.yml`。该文件仍按敏感文件处理，不得复制到仓库或发送给他人。

## 4. 分支与提交规则

### 4.1 普通修改

1. 从最新 `main` 创建 `agent/<说明>` 分支。
2. 只提交当前任务涉及的文件。
3. 完成构建、测试和差异检查。
4. 推送并审核后更新 `main`。
5. VPS 只部署已经进入 GitHub `main` 的源码状态。

### 4.2 两套部署不可混合

- `main` 使用 `postgres` + `drizzle-orm/postgres-js` 连接本机 PostgreSQL。
- Vercel 分支可以继续使用 Neon，但不得把 Neon 驱动、Neon 环境配置或 Vercel 专用部署文件合并回 `main`。
- 不要把 Vercel/Neon 分支作为 VPS release 的构建来源。

### 4.3 脏工作区

推荐创建独立 worktree：

```powershell
git worktree add -b agent/<任务名> .\work\<任务名> main
```

这样可以避免将当前工作区的界面、测试或临时文件误提交。

## 5. 颜色数据更新后的校验

运行时颜色数据为：

```text
public/materials.v1.json
```

提交前至少完成：

```powershell
pnpm test
git diff --check
git diff --stat
```

需要确认：

- `materials.v1.json` 能正常解析。
- Next.js 构建通过。
- mhchem 和数据集验证没有失败。
- 白色/无色互斥等题目测试通过。
- 差异中没有 `.env`、`.tools`、数据库文件或无关工作区修改。

## 6. GitHub 同步流程

常规情况下使用 Git：

```powershell
git status -sb
git add -- <明确的文件列表>
git diff --cached --check
git commit -m "<简短说明>"
git push -u origin <分支名>
```

更新生产 `main` 前，应核对远端仓库和提交：

```powershell
$env:GH_CONFIG_DIR='A:\ElementChemistry\quiz_app\.tools\gh-config'
& '.\.tools\bin\gh.exe' api `
  'repos/SawahiM/element-chemistry-quiz/branches/main' `
  --jq '.commit.sha'
```

Windows Git 若出现 `SEC_E_NO_CREDENTIALS`，不要把令牌写进 remote URL。优先修复 GitHub CLI 凭据助手；确需使用 GitHub Git Data API 时，必须：

- 以当前远端 `main` 为父提交；
- 上传完整 blob 并校验 blob SHA；
- 创建 tree 和 commit；
- 使用 `force=false` 快进分支；
- 更新后再次读取远端分支 SHA 和文件 blob SHA。

## 7. 构建 VPS release

`next.config.ts` 必须包含：

```ts
{
  output: "standalone",
  outputFileTracingRoot: process.cwd(),
  turbopack: { root: process.cwd() },
}
```

这可以避免在嵌套 worktree 中把 standalone 根目录识别错误。

构建：

```powershell
pnpm install --frozen-lockfile
pnpm test
```

发布包以 `.next/standalone` 为根，并加入：

- `.next/static`
- `public/` 中除 `page-images` 之外的文件

不要把 137 MB 教材页图复制进每个 release。新 release 应链接：

```text
/opt/quizapp/shared/page-images
```

打包后计算 SHA-256，上传至 VPS `/tmp`，再比较服务器端 SHA-256。哈希不一致时不得解压或切换。

## 8. VPS release 安装

每次使用唯一且可读的 release 名称，例如：

```text
/opt/quizapp/releases/20260812-main-postgres-v2
```

基本步骤：

1. 确认目标目录不存在。
2. 确认磁盘空间足够容纳“上传包 + 解压目录”。
3. 解压到新的 release 目录。
4. 创建 `public/page-images` 到共享页图目录的符号链接。
5. 将文件所有者设为 `quizapp:quizapp`。
6. 检查 `server.js`、`.next`、`node_modules` 和 `public/materials.v1.json`。

不要覆盖当前 release，也不要在验证前删除旧 release。

## 9. 切换前冒烟测试

正式服务使用 3000 端口。新 release 先通过临时 systemd 单元在 3001 端口运行，并使用本机 PostgreSQL 环境文件。

至少检查：

```text
GET /                         -> 200
GET /api/auth/session        -> 未登录时 401
GET /materials.v1.json       -> 200
GET /page-images/pdf_0001.jpeg -> 200
```

`/api/auth/session` 返回预期的 401，说明路由和数据库查询均已工作；连接失败通常返回 500。

若启动日志出现缺失模块：

- 先确认 `outputFileTracingRoot` 和 `turbopack.root`；
- PostgreSQL 驱动使用无传递依赖的 `postgres`，不要重新引入 Neon 驱动；
- 不要在缺少依赖时切换正式 symlink。

## 10. 原子切换

冒烟测试通过后：

1. 停止临时 3001 单元。
2. 创建指向新 release 的临时 symlink。
3. 使用原子重命名替换 `/opt/quizapp/current`。
4. `systemctl restart quizapp`。
5. 验证 `quizapp` 和 `postgresql` 均为 `active`。

不要直接删除或覆盖 `/opt/quizapp/current` 指向的目录。

## 11. PostgreSQL 注意事项

- 正式进程的 `DATABASE_URL` 必须指向 `127.0.0.1`，不能包含 `neon.tech`。
- PostgreSQL 只监听本机，不向公网开放 5432。
- `quizapp` 使用独立数据库角色，不使用 `postgres` 超级用户运行应用。
- 迁移数据后比较四张表的记录数：`users`、`auth_sessions`、`user_data`、`history_records`。
- 用户 ID、密码哈希、会话哈希、时间戳和历史记录 ID 必须原样迁移。
- VPS 提供商负责每周备份；不要安装额外的应用备份 timer。

## 12. 线上验证

切换后从 VPS 和公网两侧检查：

```text
systemctl is-active quizapp
systemctl is-active postgresql
readlink -f /opt/quizapp/current
```

公网检查：

- 首页返回 200。
- `/api/auth/session` 未登录时返回 401。
- `materials.v1.json` 的 SHA-256 与本地构建完全一致。
- 教材页图能够下载。
- 正在运行进程的 `DATABASE_URL` 类型为本机 PostgreSQL。
- 数据表记录数与切换前一致。

验证通过后删除 `/tmp` 中的上传包，并运行 `apt-get clean`。不要删除当前 release、共享页图或数据库数据目录。

## 13. 磁盘空间

该 VPS 磁盘较小，必须注意：

- 每次部署前后运行 `df -h /opt/quizapp`。
- 页图只保存一份并由 release 共享。
- 上传包验证并解压后及时从 `/tmp` 删除。
- APT 安装后清理下载缓存和可重新生成的索引。
- 至少保留一个已验证的旧 release，其他旧 release 删除前必须确认不再被 `current` 指向。

磁盘可用空间不足时停止部署，不要通过删除数据库或当前 release 强行腾挪。

## 14. 回滚

切换失败且尚未产生新用户数据时：

1. 将 `/opt/quizapp/current` 原子切回旧 release。
2. 恢复与该 release 匹配的环境配置。
3. 重启 `quizapp`。
4. 重新验证首页、认证接口和颜色数据。

已经在本机 PostgreSQL 产生新数据后，不应直接恢复到 Neon 环境，否则会发生数据分叉。此时应修复应用 release，继续使用本机 PostgreSQL，或使用 VPS 提供商快照整体回滚。

## 15. 发布完成检查表

- [ ] 源码来自 GitHub `main`。
- [ ] 无关工作区修改未提交。
- [ ] 构建和全部测试通过。
- [ ] 发布包 SHA-256 一致。
- [ ] 3001 端口冒烟测试通过。
- [ ] `current` 指向新 release。
- [ ] `quizapp` 与 `postgresql` 为 active。
- [ ] 运行进程连接 `127.0.0.1` PostgreSQL。
- [ ] 四张业务表记录数一致。
- [ ] 首页、认证接口、颜色数据和页图在线验证通过。
- [ ] 未安装应用层数据库备份 timer。
- [ ] 临时包已清理，磁盘空间可接受。
- [ ] Vercel/Neon 分支未合并到 `main`。
