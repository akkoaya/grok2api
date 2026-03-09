# Cloudflare Workers 部署指南

本文档说明如何将 grok2api 部署到 Cloudflare Workers，以及如何与现有 Docker 部署并行使用。

---

## 目录

1. [前置条件](#1-前置条件)
2. [GitHub Secrets 配置](#2-github-secrets-配置)
3. [部署方式](#3-部署方式)
4. [D1 数据库管理](#4-d1-数据库管理)
5. [本地开发](#5-本地开发)
6. [模型目录同步](#6-模型目录同步)
7. [项目文件说明](#7-项目文件说明)

---

## 1. 前置条件

- 一个 [Cloudflare 账户](https://dash.cloudflare.com/sign-up)
- Node.js >= 20
- Python >= 3.12（CI 和本地同步检查用）
- GitHub 仓库的管理员权限（用于配置 Secrets）

## 2. GitHub Secrets 配置

进入 GitHub 仓库 → **Settings** → **Secrets and variables** → **Actions**，添加以下两个 Secret：

| Secret 名称 | 获取方式 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare Dashboard → My Profile → API Tokens → Create Token → 选择 **Edit Cloudflare Workers** 模板，确保权限包含 `Workers Scripts:Edit`、`D1:Edit`、`Workers KV Storage:Edit` |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Dashboard → 任意域名概览页右侧，或 Workers & Pages 页面的 URL 中 `/accounts/<这里就是>/...` |

> Docker 部署使用的 `GITHUB_TOKEN` 由 GitHub 自动提供，无需手动配置。

## 3. 部署方式

### 3.1 自动部署（推送触发）

- **推送到 `main` 分支**：同时触发 Cloudflare Workers 部署和 Docker 镜像构建
- **推送版本 tag（`v*`）**：仅触发 Docker 镜像构建

### 3.2 手动部署（workflow_dispatch）

进入 GitHub 仓库 → **Actions** → **Deploy to Cloudflare Workers** → **Run workflow**：

| 选项 | 效果 |
|---|---|
| `cloudflare` | 仅部署到 Cloudflare Workers |
| `docker` | 仅构建并推送 Docker 镜像 |
| `both` | 两者都执行 |

### 3.3 部署流程详解

```
workflow_dispatch / push
        │
        ▼
┌──────────────────────┐
│ validate-model-catalog│  ← 检查 Python 与 Worker 模型列表是否一致
└──────────┬───────────┘
           │
     ┌─────┴──────┐
     ▼            ▼
┌──────────┐ ┌───────────┐
│ deploy-  │ │ build-    │
│cloudflare│ │ docker    │  ← 两个 job 并行执行
└──────────┘ └─────┬─────┘
                   ▼
             ┌───────────┐
             │merge-docker│
             │ manifests  │  ← 合并 amd64/arm64 镜像
             └───────────┘
```

**deploy-cloudflare 内部步骤**：
1. 安装 Node.js 依赖（`npm ci`）
2. TypeScript 类型检查（`npm run typecheck`）
3. 通过 Cloudflare API 自动创建或查找 D1 数据库和 KV 命名空间
4. 生成 `wrangler.ci.toml`（替换占位符 ID 为真实资源 ID）
5. 验证配置（US 区域、assets 绑定、BUILD_SHA）
6. 应用 D1 数据库迁移
7. 部署 Worker

> D1 数据库和 KV 命名空间在首次部署时会自动创建，后续部署复用已有资源。

## 4. D1 数据库管理

Worker 部署后，需要向 D1 数据库中写入数据才能正常使用。

### 4.1 添加 API Key（用于鉴权）

客户端请求需要在 `Authorization: Bearer <key>` 中携带有效的 API Key。通过 Cloudflare Dashboard 或 wrangler 添加：

```bash
# 使用 wrangler 执行远程 SQL
npx wrangler d1 execute grok2api --remote --command \
  "INSERT INTO api_keys (key) VALUES ('sk-your-api-key-here');"
```

或者在 Cloudflare Dashboard → D1 → grok2api 数据库 → Console 中执行 SQL。

### 4.2 添加 Token（Grok 凭证）

Worker 使用 D1 中 `tokens` 表的 cookie 向 Grok 上游发起请求：

```bash
npx wrangler d1 execute grok2api --remote --command \
  "INSERT INTO tokens (cookie, pool) VALUES ('你的grok_cookie值', 'ssoBasic');"
```

- `pool` 字段对应模型档位：`ssoBasic`（基础模型）或 `ssoSuper`（超级模型如 grok-4-heavy）
- Worker 会在同一 pool 内的 token 之间轮询使用

### 4.3 查看 Token 状态

```bash
npx wrangler d1 execute grok2api --remote --command \
  "SELECT id, pool, status, fail_count, updated_at FROM tokens;"
```

### 4.4 禁用/启用 Token

```bash
# 禁用
npx wrangler d1 execute grok2api --remote --command \
  "UPDATE tokens SET status = 'disabled' WHERE id = 1;"

# 重新启用
npx wrangler d1 execute grok2api --remote --command \
  "UPDATE tokens SET status = 'active', fail_count = 0 WHERE id = 1;"
```

## 5. 本地开发

### 5.1 安装依赖

```bash
npm install
```

### 5.2 启动本地开发服务器

```bash
npm run dev
```

wrangler 会在本地创建 D1 和 KV 的模拟环境。首次启动后需要手动初始化本地数据库：

```bash
# 应用迁移到本地 D1
npx wrangler d1 migrations apply DB --local

# 插入测试用 API Key
npx wrangler d1 execute grok2api --local --command \
  "INSERT INTO api_keys (key) VALUES ('sk-test');"

# 插入测试用 Token
npx wrangler d1 execute grok2api --local --command \
  "INSERT INTO tokens (cookie, pool) VALUES ('test-cookie', 'ssoBasic');"
```

### 5.3 测试请求

```bash
# 健康检查（无需鉴权）
curl http://localhost:8787/health

# 模型列表
curl http://localhost:8787/v1/models \
  -H "Authorization: Bearer sk-test"

# Chat 请求
curl http://localhost:8787/v1/chat/completions \
  -H "Authorization: Bearer sk-test" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "grok-4",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": false
  }'
```

### 5.4 TypeScript 类型检查

```bash
npm run typecheck
```

## 6. 模型目录同步

Python 后端（`app/services/grok/services/model.py`）和 Worker（`src/index.ts`）各自维护一份模型列表。CI 会自动检查两者是否一致。

### 添加新模型的步骤

1. 在 `app/services/grok/services/model.py` 的 `MODELS` 列表中添加新的 `ModelInfo`
2. 在 `src/index.ts` 的 `MODEL_CATALOG` 数组中（`__MODEL_CATALOG_START__` 和 `__MODEL_CATALOG_END__` 之间）添加对应条目
3. 确保两边的 `model_id`（Python）/ `id`（TypeScript）完全一致，且顺序相同
4. 本地验证：

```bash
python scripts/check_model_catalog_sync.py
```

输出 `OK: N models in sync` 即表示通过。

## 7. 项目文件说明

| 文件 | 用途 |
|---|---|
| `wrangler.toml` | Workers 配置模板（占位符 ID，CI 自动替换） |
| `src/index.ts` | Worker 入口，API 代理逻辑 |
| `migrations/0001_init.sql` | D1 初始化表结构 |
| `package.json` | Node.js 依赖（wrangler、typescript） |
| `tsconfig.json` | TypeScript 编译配置 |
| `scripts/check_model_catalog_sync.py` | 模型目录一致性检查 |
| `app/static/` | Workers Sites 静态资源目录（当前为占位） |
| `.github/workflows/docker.yml` | 统一部署工作流（Cloudflare + Docker） |

### Worker API 端点

| 端点 | 方法 | 鉴权 | 说明 |
|---|---|---|---|
| `/health` | GET | 否 | 健康检查，返回 `build_sha` |
| `/v1/models` | GET | 是 | 返回可用模型列表（OpenAI 格式） |
| `/v1/chat/completions` | POST | 是 | Chat 请求代理，支持流式（SSE）和非流式 |
