# Browser acceptance — 2026-09-10

Method: `agent-browser` (headless Chrome via CDP), session `i18n-accept`, logged in as `admin` against the dev server on `http://localhost:3000` (serving the `feat/i18n-guard` working tree). Screenshots in this directory.

## Verified (all passed)

| Check | Result |
|---|---|
| Locale switcher (Settings → General → 语言) | Selecting English re-rendered nav/heading/controls instantly with **no reload**, URL stayed `/settings/general`; after `reload` the page stayed English (cookie persisted); switching back to 简体中文 re-rendered instantly. |
| zh-CN visual pass | `sign-in` 登录/用户名或邮箱/密码/立即注册; chat 新话题 / 消息 / 发送 / 新建助手 / 切换侧边栏 / 主题：跟随系统 / admin 的账户菜单; settings nav 通用/账户/服务商/搜索/用户; 账户 当前密码/新密码/修改密码; 服务商 添加服务商/名称/基础 URL/API 密钥/共享给实例/创建/你的服务商; 搜索 回退顺序/保存/删除; 用户 注册/关闭注册/创建用户/角色/创建; assistant editor 名称/表情/系统提示词/默认模型/保存/关闭; account menu 退出登录. No English copy found except library/data exceptions below. |
| Error path | Wrong password on sign-in → `用户名、邮箱或密码无效`, byte-identical to `Errors.auth.signInFailed` in the catalog. |
| Sign-out redirect | Account menu → 退出登录 → `/sign-in` in the current locale. |

## Findings and fixes (all fixed and re-verified in the browser)

1. **Admin role select showed the raw token** — `AdminUsersScreen` used a bare `<SelectValue />`, so the trigger rendered `user` while the popup options were already localized. Fixed by passing `items={{ user: t("roleUser"), admin: t("roleAdmin") }}` to the Select (Base UI renders the selected item's label when `items` is provided). Re-verified: trigger now shows `普通用户`.
2. **Emoji picker visible placeholder was English** — frimousse's `Search` defaults to `placeholder="Search…"`; the app only set `aria-label`. Fixed by also passing `placeholder={t("searchEmoji")}` at the call site. Re-verified: `搜索表情`.
3. **Emoji category headers and emoji names were English** — frimousse defaults to the `en` dataset. Fixed by passing `locale` (`zh-CN → zh`, otherwise `en`) to the picker root; the library then fetches the matching emojibase dataset. Re-verified: category `笑脸`, emoji names `嘿嘿/哈哈/大笑/…`.

Post-fix gates: `pnpm lint` ✅, `pnpm typecheck` ✅, `pnpm test` 81 files / 566 tests ✅, `pnpm build` ✅.

## Accepted non-issues (by design / third-party data)

- `Pika chat` brand is intentionally identical across locales (proper noun).
- Assistant/topic/user names are stored data, not catalog copy (e.g. the older seeded assistant is still named "Assistant"; new installs seed a localized default).
- Error toasts (e.g. provider failures) were not triggered in this pass — their localization is covered by unit tests and the envelope contract; the sign-in error path above exercises the same client resolver.

## Evidence

`01-settings-general-zh.png` · `02-account-zh.png` · `03-providers-zh.png` · `04-search-zh.png` · `05-users-zh.png` (shows the pre-fix raw `user` label) · `06-chat-zh.png` · `07-emoji-picker-zh.png` (pre-fix: "Search…", "Smileys & emotion") · `08-emoji-picker-zh-fixed.png` (post-fix: 搜索表情, 笑脸).
