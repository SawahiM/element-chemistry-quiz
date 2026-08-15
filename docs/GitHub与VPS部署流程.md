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
```

上述 `git` 命令只处理本地工作区。远端分支发布、PR 查询和创建必须使用项目内 GitHub CLI；自动化环境不得改用 PATH 中的系统 Git、Windows Credential Manager 或其他全局凭据。多文件发布可由项目 GitHub CLI 通过 Git Data API 创建 blobs、tree、commit 和 branch ref，再创建 PR。若项目 GitHub CLI 不可用或认证失效，应停止同步并修复项目工具，不能回退到系统 Git。

在 GitHub 审核并合并 PR。合并后再更新本地基线：

```powershell
git switch main
git pull --ff-only
git branch -d agent/<任务名>
```

禁止使用 `git add -A` 混入无关文件，也不要从未同步的旧分支创建新任务。

### 项目 GitHub CLI 与凭据

项目 GitHub CLI 位于 `.tools/bin/gh.exe`，独立配置位于 `.tools/gh-config`。所有 GitHub 认证和远端操作都必须显式使用这两个项目路径：

```powershell
$env:GH_CONFIG_DIR='A:\ElementChemistry\quiz_app\.tools\gh-config'
& '.\.tools\bin\gh.exe' auth status
```

例如查询仓库和 PR：

```powershell
& '.\.tools\bin\gh.exe' repo view --json nameWithOwner,defaultBranchRef
& '.\.tools\bin\gh.exe' pr list --state open
```

不要调用系统安装目录中的 Git 或 GitHub CLI，不要把令牌写入 remote URL、命令参数、文档、日志或提交信息。项目 GitHub CLI 操作失败时应保留当前本地提交并报告错误，不得临时创建 askpass 脚本或切换到系统凭据继续推送。

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
- Windows + pnpm 下 standalone 跟踪可能遗漏的运行时依赖

不要把教材页图复制进 release。打包后计算 SHA-256；上传到 VPS 后再次计算，哈希不一致时停止部署。

### 4.1 Windows standalone 依赖完整性

本项目已在两次部署中复现同一问题：Windows 上由 pnpm 安装依赖后生成的 `.next/standalone` 没有完整跟踪 Linux 运行时所需的顶层包。缺少 `@swc/helpers` 时服务会报找不到 `_interop_require_default`，补齐后还可能继续暴露缺少 `@next/env`。因此不能把“`next build` 成功”视为发布包可启动，也不要等 VPS 报错后逐个猜包。

从 `.next/standalone` 建立 stage 后，必须从当前锁定的本地 `node_modules` 递归复制以下运行时包的真实内容到 stage 的 `node_modules`；不得只留下指向工作区或 pnpm store 的 junction、symlink：

```text
@next/env
@swc/helpers
drizzle-orm
katex
postgres
react-markdown
rehype-katex
remark-gfm
remark-math
```

`next`、`react`、`react-dom` 通常已经由 standalone 收集，但仍须以实际 stage 为准。以后 `package.json` 新增生产依赖时，应同时检查它是否出现在 stage 中；凡运行时会直接或间接加载、而 standalone 未收集的包，都要加入上述清单。可以与 VPS 当前已验证 release 的顶层 `node_modules` 目录比较，但旧 release 只能作为补充依据，不能替代本机启动验证。

打包前至少确认：

```powershell
$requiredRuntimePackages = @(
  '@next/env', '@swc/helpers', 'drizzle-orm', 'katex', 'postgres',
  'react-markdown', 'rehype-katex', 'remark-gfm', 'remark-math'
)
foreach ($package in $requiredRuntimePackages) {
  $manifest = Join-Path $stage "node_modules/$package/package.json"
  if (-not (Test-Path -LiteralPath $manifest)) {
    throw "发布包缺少运行时依赖：$package"
  }
}
```

这里的 `$stage` 必须是即将压缩的发布包根目录，而不是仓库根目录。

### 4.2 上传前本机启动发布包

压缩和上传前，必须直接以 stage 中的 `server.js` 启动一次，而不是从源码目录运行 `next start`。使用一个未占用的临时端口（例如 3101），至少检查：

```text
GET /                   -> 200
GET /materials.v1.json -> 200
GET /test/result       -> 200
```

启动进程的工作目录必须是 `$stage`。检查完成后只终止该次启动得到的确切进程；任何 `MODULE_NOT_FOUND`、500 或进程提前退出都必须停止打包，回到 4.1 补齐依赖并重新从干净 stage 构建。不得把修补过的旧 archive 继续上传，也不得跳过本机验证直接依赖 VPS 冒烟测试。

## 5. 安装与切换

1. 检查 `/opt/quizapp` 磁盘空间。
2. 创建唯一的新目录：`/opt/quizapp/releases/<日期-提交>`。
3. 解压发布包，链接 `public/page-images` 到共享页图目录。
4. 将文件所有者设为 `quizapp:quizapp`。
5. 使用 `/etc/quizapp.env` 在 3001 端口启动临时服务。
6. 临时服务验证通过后，停止它并原子更新 `/opt/quizapp/current`。
7. 重启 `quizapp.service`，确认应用和 PostgreSQL 均为 `active`。

即使 4.2 的本机发布包验证已经通过，也不能省略 VPS 的 3001 验证：本机验证负责发现包内依赖缺失，VPS 验证还负责确认 Linux 运行时、生产环境变量、本机 PostgreSQL 和共享页图均可用。

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
- [ ] stage 已显式包含运行时依赖清单，且不存在指向本地 pnpm store 的失效链接。
- [ ] 已从 stage 根目录本机启动 `server.js`，关键路由通过且无 `MODULE_NOT_FOUND`。
- [ ] 发布包本地与 VPS SHA-256 一致。
- [ ] 3001 端口冒烟测试通过。
- [ ] `current` 已原子切换。
- [ ] 应用、数据库、认证、颜色数据和页图均正常。
- [ ] 未提交密钥，未重新引入 Vercel/Neon 配置。
- [ ] 临时包已删除，至少保留一个可回滚 release。
