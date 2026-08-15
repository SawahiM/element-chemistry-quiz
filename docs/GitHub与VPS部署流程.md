# GitHub 同步与 VPS 部署

本文只记录当前仍在使用的流程。命令默认在 `A:\ElementChemistry\quiz_app` 执行。

## 1. 生产基线

- GitHub `main` 是唯一维护的生产分支。
- 正式站点：`https://chemquiz.dpdns.org/`。
- VPS 当前版本：`/opt/quizapp/current`，指向 `/opt/quizapp/releases/<版本>`。
- 服务：`quizapp.service`；反向代理：Nginx。
- 数据库：VPS 本机 PostgreSQL 17，仅监听 `127.0.0.1:5432`。
- 环境文件：`/etc/quizapp.env`，不得提交到 Git。
- 教材页图：`/opt/quizapp/shared/page-images`，所有 release 共用。

仓库中的无密钥生产配置位于 `deploy/vps/`。不要重新引入 Vercel、Neon 或 GitHub Pages 专用部署配置。

## 2. GitHub 同步

普通任务直接在仓库根目录创建分支，不再使用 `work/`：

```powershell
git fetch origin
git switch main
git merge --ff-only origin/main
git switch -c agent/<任务名>
```

只暂存本任务文件，然后验证并推送：

```powershell
git status -sb
git add -- <文件列表>
git diff --cached --check
git commit -m "<简短说明>"
pnpm test
git push -u origin HEAD
```

在 GitHub 审核并合并 PR。合并后更新本地基线：

```powershell
git switch main
git pull --ff-only
git branch -d agent/<任务名>
```

禁止使用 `git add -A` 混入无关文件，也不要从未同步的旧分支创建新任务。

### GitHub 凭据

项目 GitHub CLI 位于 `.tools/bin/gh.exe`，配置位于 `.tools/gh-config`。检查登录：

```powershell
$env:GH_CONFIG_DIR='A:\ElementChemistry\quiz_app\.tools\gh-config'
& '.\.tools\bin\gh.exe' auth status
```

若普通 Git 无法读取该项目凭据，为当前仓库重新登记凭据助手：

```powershell
git config --local credential.https://github.com.helper `
  '!f() { GH_CONFIG_DIR=A:/ElementChemistry/quiz_app/.tools/gh-config A:/ElementChemistry/quiz_app/.tools/bin/gh.exe auth git-credential "$@"; }; f'
```

不要把令牌写入 remote URL、文档、日志或提交信息。

## 3. 提交前验证

```powershell
pnpm install --frozen-lockfile
pnpm test
git diff --check
git diff --stat origin/main...HEAD
```

确认差异中没有 `.env`、`.tools`、数据库文件、构建输出或临时文件。颜色数据变更还应确认 `public/materials.v1.json`、mhchem 校验及颜色互斥测试均通过。

## 4. 构建发布包

只从已经进入 GitHub `main` 的提交构建。`next.config.ts` 必须保持 standalone 输出配置：

```ts
{
  output: "standalone",
  outputFileTracingRoot: process.cwd(),
  turbopack: { root: process.cwd() },
}
```

发布包以 `.next/standalone` 为根，并补充：

- `.next/static`
- `public/` 中除 `page-images` 外的文件

不要把教材页图复制进 release。打包后计算 SHA-256；上传到 VPS 后再次计算，哈希不一致时停止部署。

## 5. 安装与切换

1. 检查 `/opt/quizapp` 磁盘空间。
2. 创建唯一的新目录：`/opt/quizapp/releases/<日期-提交>`。
3. 解压发布包，链接 `public/page-images` 到共享页图目录。
4. 将文件所有者设为 `quizapp:quizapp`。
5. 使用 `/etc/quizapp.env` 在 3001 端口启动临时服务。
6. 临时服务验证通过后，停止它并原子更新 `/opt/quizapp/current`。
7. 重启 `quizapp.service`，确认应用和 PostgreSQL 均为 `active`。

切换前至少验证：

```text
GET /                           -> 200
GET /api/auth/session          -> 未登录时 401
GET /materials.v1.json         -> 200
GET /page-images/pdf_0001.jpeg -> 200
```

预期的 401 表明认证路由与数据库查询正常；500 通常表示应用或数据库连接失败。验证失败时不要切换 `current`，也不要覆盖旧 release。

## 6. 上线检查与回滚

切换后确认：

- 正式域名首页正常。
- `quizapp` 与 `postgresql` 为 `active`。
- `readlink -f /opt/quizapp/current` 指向新 release。
- 运行进程连接本机 PostgreSQL，而非外部数据库。
- `materials.v1.json` 哈希与本地构建一致。
- 登录、历史记录和教材页图可用。

失败时把 `current` 原子切回上一个已验证 release，恢复匹配的环境配置并重启服务。不要删除当前 release、共享页图或 PostgreSQL 数据目录。至少保留一个已验证的旧 release；确认新版本稳定后再删除上传包和更早的 release。

## 7. 完成检查表

- [ ] 源码来自 GitHub `main`。
- [ ] 构建、测试和差异检查通过。
- [ ] 发布包本地与 VPS SHA-256 一致。
- [ ] 3001 端口冒烟测试通过。
- [ ] `current` 已原子切换。
- [ ] 应用、数据库、认证、颜色数据和页图均正常。
- [ ] 未提交密钥，未重新引入 Vercel/Neon 配置。
- [ ] 临时包已删除，至少保留一个可回滚 release。
