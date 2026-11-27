# Design

## 1. 权限规则（`src/lib/auth-hierarchy.ts`）

- `AdminAction` 增加 `"remove-user"`。
- `:93` 的 `if (target.role === "super_admin") return false;` 改为
  `return action === "set-quota" && actor.userId === target.userId;`
  只有一个超管，所以"超管目标 + set-quota + 本人"就是"超管自设配额"。admin 对超管仍被拒。
- `remove-user` 不需要专门分支，直接走现有层级（与 ban 相同）：超管 → admin/user ✓，admin → user ✓，自己（admin 或超管）都会被前面的规则拒绝。
- R2 关闭 `/admin/update-user` 后，`updateUserPayload` 不再有调用方，删除。

## 2. 关闭接口（`src/server/auth/index.ts`、`src/server/auth/hierarchy.ts`）

- `disabledPaths` 增加 R2 的 7 个路径。Better Auth 在 router `onRequest` 阶段对这些路径返回 404（`better-auth/dist/api/index.mjs:169`），对插件接口同样生效；服务端 `auth.api.*` 调用不受影响。
- `hierarchy.ts`：从 `PATH_ACTION` 删除 `/admin/update-user`，删除 `rejectUpdateUser` 和 `HookAction` 里的 `"update-user"` 分支。`remove-user` 不进钩子，接口直接关掉。

## 3. 删除用户（项目自有接口）

选择自建接口，而不是放开 Better Auth 的 `/admin/remove-user`：
- 附件对象和 provider 引用的清理必须在删 user 行之前完成（`deleteProviderFileReferences` 需要该用户的 provider 配置），而 Better Auth 的 `deleteUser` 在事务里执行，database hook 中做网络 I/O 违反 `database-guidelines.md`。
- 与配额接口同形：`requireAdmin` + `canAdminister` 在 service 里把关。

**共享删除逻辑**：把 `src/server/services/demo-cleanup.service.ts` 循环体（逐个 `storage.delete` → 删 files 行 → `deleteProviderFileReferences`，全部成功才删 user 行）提取为 `src/server/services/user-delete.service.ts` 的 `deleteUserAccount(userId): Promise<boolean>`，返回是否已删除。demo 清理与管理员删除复用它，demo 清理行为不变。

**管理员入口**：同文件的 `removeUser(userId, actor)`：
1. 读目标（`id, role`），不存在 → `AppError("NOT_FOUND", 404, "auth.userNotFound")`。
2. `canAdminister(actor, target, "remove-user")` 为 false → `AppError("FORBIDDEN", 403, "auth.targetNotAllowed")`。
3. `deleteUserAccount` 返回 false → `AppError("INTERNAL", 500, "auth.userDeleteFailed")`（新增 Errors key，en + zh-CN）。
4. 成功记 `logger.info({ userId: actor.userId, targetUserId }, "user deleted")`。

user 行删除会级联删除 sessions、accounts、topics → messages、provider 配置、助手、偏好等。

**路由**：`src/app/api/admin/users/[userId]/route.ts` 导出 `DELETE`（`withErrorHandling`、`requireAdmin`、`requireParam`），成功返回 204。

**客户端**：`src/lib/api/admin-users.ts` 增加 `deleteAdminUser(userId)`，沿用 `user-quota.ts` 的 fetch + `parseJson` 错误管道（204 无 body，按 `parseJson` 的约定处理）。

## 4. UI（`src/components/admin/AdminUsersScreen.tsx`）

- `showDelete = canAdminister(actor, target, "remove-user")`，并入菜单显示条件；菜单项 `variant="destructive"`，放在最后。
- 新增同文件内的 `DeleteUserDialog`（与 `ResetPasswordDialog` 同级），基于 `src/components/ui/alert-dialog.tsx`，参考 `src/components/topic/DeleteTopicDialog.tsx`：说明文案 + 输入框，`input === label` 时删除按钮才可用；pending 时禁用；错误经 `apiErrorMessage` 显示；成功后关闭并 `invalidate()`。
- 超管自设配额无需改 UI：`showQuota` 已由 `canAdminister` 计算。
- 文案加入 `messages/en.json`、`messages/zh-CN.json` 的 `Admin` 命名空间。

## 5. 测试

- `src/lib/auth-hierarchy.test.ts`：按 D-PERM-1 补 set-quota / remove-user 矩阵。
- `src/app/api/admin/users/[userId]/quota/route.test.ts`：超管自设 200；admin 自设 403。
- `src/server/auth/auth.integration.test.ts`：7 个接口返回 404（从 `adminEndpoints` 列表移除这些项，因为 404 是纯文本 body）；`update-user` 相关断言改为 404。
- 新增 `user-delete.service.integration.test.ts`：AC4/AC5 的成功和拒绝组合，用 `src/test-utils/in-memory-file-storage.ts` 断言对象已删除。AC6 若现有存储注入点可替换为 delete 抛错的实现则覆盖，否则在报告中说明。
- `demo-cleanup.service.integration.test.ts` 保持通过。

## 6. Spec 更新（Phase 3.3）

- `auth-guidelines.md`：角色表加删除/配额列；记录关闭的接口及原因；删去 update-user 钩子的说明。
- `database-guidelines.md:250`：注明管理员删除用户是已获批准的消息数据级联删除路径。

## 验证命令

`pnpm lint`、`pnpm typecheck`、`pnpm test`，以及相关集成测试（以 `package.json` 实际脚本为准）。

## 回滚

纯代码改动，无 schema 变更、无迁移。整体回滚这次提交即可恢复原行为（包括原漏洞）。
