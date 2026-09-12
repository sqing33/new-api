# 上游合并 + classic UI 功能补充完整方案

## 现状（已核实）

- 分叉点 `3a9f41ee8`：本地 99 提交、上游 69 提交。上游在分叉点前已删除 `web/classic`，本次合并对 classic **零冲突**。
- 本地已删除上游新 UI `web/src`（仅剩 2 个孤儿文件），Dockerfile 只构建 classic。
- 上游 `.github/workflows`、Dockerfile、makefile 未动 —— 本地 CI/构建无冲突。
- 冲突面：约 35 个双方都改的 Go 文件 + `go.mod/go.sum` 并集 + `AGENTS.md`/`web/package.json` 小冲突。
- classic 技术栈：React 18 + Semi Design + Vite + JSX；上游新功能页面需按其 API 契约用 Semi Design 重写。

## Phase 1：安全网

- 确认工作区干净，打备份标签 `backup/pre-upstream-merge-20260912`。

## Phase 2：全量合并 `git merge upstream/main --no-ff --no-commit`

路径解决策略：
1. `web/src/**`（含 2 个本地孤儿文件）→ 全部 `git rm`，维持 UI 已移除状态。
2. `web/classic/**` → 保留本地（上游无改动）。
3. web 根配置、`.github/`、Dockerfile、makefile → 取本地。
4. `go.mod`/`go.sum` → 手工并集（上游加 go-oidc/oauth2/go-jose + 版本升级；本地加 gin-contrib/sessions 系）。
5. `AGENTS.md`、`docs/`、`i18n/locales/`、`pkg/billingexpr/` → 取上游并手工并入本地文档。
6. 约 35 个双方修改的 Go 文件 → 以上游重构为基底、重新施加本地功能（SenseNova/MiniMax 适配、多 key 严格优先级与恢复、套餐额度查询、模型单双接口开关、输出速度列、perf_metrics、theme 兼容、codex oauth、classic 会话 cookie 回退）。逐文件先 `git log <file>` 查本地脉络再手解。

## Phase 3：后端验证（合并提交前）

- `go build ./...`、`go vet ./...`；`cd relaykit && GOWORK=off go build ./...`（硬性要求）。
- 后端测试（跳过所有 Claude 相关包的 test，只编译，遵守 AGENTS.md 禁令）。
- 三数据库迁移验证（AGENTS.md 强制）：Docker 起真实 SQLite + MySQL(≥5.7.8) + PostgreSQL(≥9.6)，各跑"全新库启动×2（幂等）"+"从合并前版本升级"两条路径；重点验证 options 表主键重建（上游新迁移）与本地 token/唯一约束/prefill 迁移叠加后的数据与约束完整性。版本、命令、结果记录进交付说明。
- 完成合并提交（直接落 main）。

## Phase 4：classic UI 功能移植（合并后独立提交，按工作量从小到大分四批）

**批次 A —— 小改进套件（工作量小）**
- 兑换码：批量删除、导出文件对话框（API：redemption batch/delete + export）。
- 使用日志：分组可搜索筛选、额度详情气泡（quota-details-popover）、额度调整展示。
- 令牌页：桌面端额度并排展示 cell。
- dashboard：管理员更新提醒。

**批次 B —— 账号安全中心 + 审计日志**
- 新页面 `/console/security`（Semi Design 重写）：访问令牌管理、2FA 绑定/备份码、账号绑定、改密、账号注销。
- 新页面 `/console/audit`（管理员）：审计日志查看器（筛选栏 + 详情弹窗）。
- 登录页接入统一登录验证（OTP 挑战）、2FA、Passkey 流程，保持本地 legacy cookie 会话回退兼容。

**批次 C —— 渠道与模型管理增强**
- 渠道编辑：多 key 选择策略编辑、上游模型发现/选择、渠道插件扩展面板、渠道类型徽章。
- 模型管理：厂商管理对话框、模型元数据编辑/同步、价格同步对话框。

**批次 D —— 表达式计费编辑/展示（工作量最大）**
- 定价页：billing-expression 展示（缓存价格单元格、任务价、条件可视化）。
- 系统设置：计费时长编辑器、模型定价 sheet 重写、旧价格转表达式草稿。
- 前置阅读 `pkg/billingexpr/expr.md`（AGENTS.md 强制）。

每批通用要求：Semi Design 组件、`useTranslation()` + classic i18n 文件加 key、对接合并后真实 API 路由（以 `router/api-router.go` 合并结果为准）、批次结束跑 `bun run build`（web/classic）验证。

## Phase 5：冒烟与收尾

- 启动服务：classic 登录、渠道 CRUD、日志/审计页、一次真实 relay 请求。
- 推送 origin；交付说明记录合并范围、DB 验证结果、classic 已补/未补功能清单。

## 回滚

- 合并失败：`git merge --abort`；已提交：`git reset --hard backup/pre-upstream-merge-20260912`。
- UI 移植各批次独立提交，可单独 revert。