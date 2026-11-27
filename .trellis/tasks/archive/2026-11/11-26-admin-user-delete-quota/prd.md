# 用户管理：超管自设配额、封堵未受保护的 admin 接口、彻底删除用户

## Goal

修正 `/settings/users` 的三处问题：超管无法给自己设存储配额；Better Auth 若干 admin 接口绕过了角色层级钩子（`admin` 可构造请求删除超管）；用户只能封禁、不能彻底删除。

## Background

- **配额被拦是副作用**：`set-quota` 复用 `canAdminister`，`src/lib/auth-hierarchy.ts:93` 的 `target.role === "super_admin"` 拒绝先于按动作分支执行。该规则源自 `08-31-auth-users` PRD 的 D-ROLE-1（防止改角色/封禁/重置密码锁死超管）；配额任务 `09-13-attachment-quota` 未讨论超管或自设配额。
- **不能删除是阶段一的有意延期**：`08-31-auth-users/prd.md:279` 以"会级联的表尚不存在"为由不暴露 `/admin/remove-user`。如今 topics/messages/files/providers/assistants/search-provider 均以 `onDelete: "cascade"` 引用 `users.id`。`.trellis/spec/backend/database-guidelines.md:250` 要求消息数据的级联删除要有明确的产品决定，本任务就是这个决定（用户要求"彻底删除"）。
- **服务端漏洞**：`src/server/auth/hierarchy.ts:24` 的 `PATH_ACTION` 只覆盖 set-role/ban/unban/set-user-password/create-user/update-user；`src/server/auth/index.ts:192` 的 `disabledPaths` 只有 `/sign-up/email`。两个 staff 角色都是 `adminAc`（含 `user: delete/impersonate`），Better Auth 只禁止删除自己。因此 `admin` 当前可以：
  - 调 `/admin/remove-user` 删除超管或其他 admin（级联清空数据，附件 blob 成为孤儿）
  - 调 `/admin/revoke-user-session(s)` 强制登出超管
  - 调 `/admin/impersonate-user` 冒充普通用户（冒充 admin 默认被拒；冒充在 auth-users PRD 中列为不做）
  - 通过 `/admin/update-user` 修改超管的 `username`/`email`/`name`，因为钩子只检查 role/ban 字段（D-ROLE-1 规定本轮不可编辑用户名、邮箱）
- UI（`src/components/admin/AdminUsersScreen.tsx`）只用 listUsers、createUser、setRole、banUser、unbanUser、setUserPassword；native 端和服务端代码都不调用其余 admin 接口（服务端仅 `auth.api.createUser`）。
- `LOCAL_MODE` 下 `/settings/users` 重定向走，本任务不影响 local mode。

## Requirements

**D-PERM-1 — 权限矩阵（已确认）**：删除沿用封禁的层级；配额只对超管放开"对自己"。

| 操作者 → 目标 | 删除 | 配额 |
|---|---|---|
| 超管 → 自己 | ✗ | ✓ |
| 超管 → admin / user | ✓ | ✓ |
| admin → 自己 / 其他 admin / 超管 | ✗ | ✗ |
| admin → user | ✓ | ✓ |
| user → 任何人 | ✗ | ✗ |

服务端强制执行该矩阵，UI 用同一规则决定菜单项是否显示。封禁/解除封禁、改角色、重置密码的行为与权限不变。

**R1 — 超管可给自己设配额**：超管行的操作菜单出现「存储配额」，保存成功并对其上传生效。

**R2 — 服务端关闭未使用的 admin 接口**：`/admin/remove-user`、`/admin/impersonate-user`、`/admin/stop-impersonating`、`/admin/list-user-sessions`、`/admin/revoke-user-session`、`/admin/revoke-user-sessions`、`/admin/update-user` 对任何人返回 404。现有 UI 用到的接口行为不变。

**R3 — 彻底删除用户**：
- 用户行的操作菜单在 D-PERM-1 允许时出现红色「删除」。
- 点击后弹出确认框：说明将永久删除该用户的对话、附件、供应商配置和助手且无法撤销；必须输入该用户的用户名（显示名，`username ?? name`），完全一致时「删除」按钮才可用。
- 删除移除该用户的全部数据：会话、账号、话题/消息、附件（数据库行、存储中的对象、provider 侧的文件引用）、provider 配置、助手、偏好等。被删用户的下一个请求即未认证。
- 附件对象删除失败时不删除该用户，返回错误，管理员可重试；不留下指向不存在对象的行，也不留下孤儿对象。
- 成功后列表刷新，不再显示该用户。

## Acceptance Criteria

- [ ] **AC1** 超管对自己 `PATCH /api/admin/users/<自己>/quota` 返回 200，配额生效；超管行菜单出现「存储配额」。
- [ ] **AC2** admin 对自己、其他 admin、超管设配额返回 403；对 user 仍返回 200。
- [ ] **AC3** R2 列出的 7 个接口对任何调用者（含超管）都返回 404（在 Better Auth router `onRequest` 阶段、读取会话之前拒绝）；listUsers/createUser/setRole/ban/unban/setUserPassword 的现有集成测试仍通过。
- [ ] **AC4** 超管删除 admin 或 user 成功；admin 删除 user 成功。成功后目标用户的 users 行及其话题、消息、files 行全部消失，存储中的附件对象被删除，目标用户原会话的下一个请求被拒绝。
- [ ] **AC5** admin 删除超管、其他 admin 或自己返回 403；超管删除自己返回 403；`user` 角色调用返回 403；不存在的 userId 返回 404。均不改动数据。（完整组合由 `auth-hierarchy.test.ts` 单测覆盖，集成测试验证 `removeUser` 接入了该检查。）
- [ ] **AC6** 存储删除失败时接口返回错误，且目标 users 行仍存在。
- [ ] **AC7** 确认框中未输入或输入不一致时「删除」按钮禁用；输入一致后可提交，成功后列表不再出现该用户。en 与 zh-CN 文案齐全。
- [ ] **AC8** demo 模式的过期访客清理行为不变（现有测试通过）。

## Out of Scope

- 用户自助注销账号（`/delete-user`）
- 删除前导出数据或把数据转移给其他用户
- 编辑用户名/邮箱、冒充登录
- 用户删除后补偿 provider 侧删除失败的重试（provider 配置随用户删除，重试队列中的条目会按 `configMissing` 放弃）
- 删除与目标用户并发上传/生成之间的竞态（已接受）：快照 files 后新产生的附件，其行随级联删除、存储对象残留。目标通常不活跃或已封禁，可先封禁再删除。
- 删除 admin 会连带删除其共享的 provider 配置，其他用户对这些配置的引用被置空（已接受，确认框不额外提示）。
