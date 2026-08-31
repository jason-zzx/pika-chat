import "server-only";

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { requireActor } from "@/server/auth/actor";
import { updateInstanceSettings } from "@/server/services/instance-settings.service";
import { newId } from "@/lib/id";
import {
  adminCredentials,
  authGet,
  authPost,
  cookiesFrom,
  getInstance,
  jsonRequest,
  otherAdminCredentials,
  patchAdminSettings,
  postRegistration,
  postSetup,
  readJson,
  staffAdminCredentials,
  userCredentials,
} from "@/server/auth/auth-test-helpers";
import { getDb } from "@/server/db/client";
import {
  APP_SETTINGS_ROW_ID,
  accounts,
  appSettings,
  sessions,
  users,
  verifications,
} from "@/server/db/schema";

const db = getDb();

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null) {
    return value as Record<string, unknown>;
  }
  throw new Error("expected an object");
}

function readUserId(value: unknown): string {
  const userId = asObject(value).userId;
  if (typeof userId === "string") {
    return userId;
  }
  throw new Error("expected userId");
}

function readNestedUserId(value: unknown): string {
  const user = asObject(value).user;
  const id = asObject(user).id;
  if (typeof id === "string") {
    return id;
  }
  throw new Error("expected user.id");
}

function expectForbiddenCode(payload: Record<string, unknown>): void {
  const nested = payload.error;
  const nestedCode =
    typeof nested === "object" &&
    nested !== null &&
    "code" in nested &&
    typeof nested.code === "string"
      ? nested.code
      : "";
  const code = typeof payload.code === "string" ? payload.code : nestedCode;
  expect(code).toBe("FORBIDDEN");
}

async function adminCreateUser(
  cookie: string,
  input: {
    username: string;
    email: string;
    password: string;
    role: "admin" | "user";
  },
): Promise<Response> {
  return authPost(
    jsonRequest("/api/auth/admin/create-user", {
      cookie,
      body: {
        email: input.email,
        password: input.password,
        name: input.username,
        role: input.role,
        data: { username: input.username },
      },
    }),
  );
}

const promoteMigrationPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../db/migrations/0002_promote_first_user_to_super_admin.sql",
);

async function resetAuthState(): Promise<void> {
  await db.delete(sessions);
  await db.delete(accounts);
  await db.delete(verifications);
  await db.delete(users);
  await db
    .update(appSettings)
    .set({ allowRegistration: false, updatedAt: new Date() })
    .where(eq(appSettings.id, APP_SETTINGS_ROW_ID));
}

async function setupAdmin(): Promise<{ cookie: string; token: string | null }> {
  const response = await postSetup(jsonRequest("/api/setup", { body: adminCredentials }));
  expect(response.status).toBe(201);
  return {
    cookie: cookiesFrom(response),
    token: response.headers.get("set-auth-token"),
  };
}

async function signInEmail(
  email: string,
  password: string,
): Promise<Response> {
  return authPost(
    jsonRequest("/api/auth/sign-in/email", { body: { email, password } }),
  );
}

async function signInUsername(
  username: string,
  password: string,
): Promise<Response> {
  return authPost(
    jsonRequest("/api/auth/sign-in/username", { body: { username, password } }),
  );
}

const adminEndpoints: { method: string; path: string; body?: unknown }[] = [
  { method: "GET", path: "/api/auth/admin/list-users" },
  { method: "GET", path: "/api/auth/admin/get-user?id=not-a-real-id" },
  {
    method: "POST",
    path: "/api/auth/admin/create-user",
    body: {
      email: "other@example.com",
      password: "password1",
      name: "other",
      role: "user",
      data: { username: "otheruser" },
    },
  },
  {
    method: "POST",
    path: "/api/auth/admin/set-role",
    body: { userId: "not-a-real-id", role: "admin" },
  },
  {
    method: "POST",
    path: "/api/auth/admin/ban-user",
    body: { userId: "not-a-real-id" },
  },
  {
    method: "POST",
    path: "/api/auth/admin/unban-user",
    body: { userId: "not-a-real-id" },
  },
  {
    method: "POST",
    path: "/api/auth/admin/set-user-password",
    body: { userId: "not-a-real-id", newPassword: "password2" },
  },
  {
    method: "POST",
    path: "/api/auth/admin/update-user",
    body: { userId: "not-a-real-id", data: { name: "nope" } },
  },
  {
    method: "POST",
    path: "/api/auth/admin/list-user-sessions",
    body: { userId: "not-a-real-id" },
  },
  {
    method: "POST",
    path: "/api/auth/admin/revoke-user-session",
    body: { sessionToken: "not-a-real-token" },
  },
  {
    method: "POST",
    path: "/api/auth/admin/revoke-user-sessions",
    body: { userId: "not-a-real-id" },
  },
  {
    method: "POST",
    path: "/api/auth/admin/impersonate-user",
    body: { userId: "not-a-real-id" },
  },
  {
    method: "POST",
    path: "/api/auth/admin/remove-user",
    body: { userId: "not-a-real-id" },
  },
];

describe("auth", () => {
  beforeEach(async () => {
    await resetAuthState();
  });

  afterAll(async () => {
    await resetAuthState();
  });

  it("GET /api/auth/ok responds", async () => {
    const response = await authGet(jsonRequest("/api/auth/ok"));
    expect(response.status).toBe(200);
  });

  it("creates the first admin once, then refuses a crafted second call", async () => {
    const first = await postSetup(jsonRequest("/api/setup", { body: adminCredentials }));
    expect(first.status).toBe(201);
    const body = await readJson(first);
    expect(body).toMatchObject({
      email: adminCredentials.email,
      username: adminCredentials.username,
    });
    expect(cookiesFrom(first).length).toBeGreaterThan(0);

    const [created] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.email, adminCredentials.email));
    expect(created?.role).toBe("super_admin");

    const second = await postSetup(
      jsonRequest("/api/setup", {
        body: {
          username: "intruder",
          email: "intruder@example.com",
          password: "password1",
        },
      }),
    );
    expect(second.status).toBe(403);
    const error = await readJson(second);
    expect(error).toMatchObject({
      error: { code: "FORBIDDEN" },
    });
  });

  it("signs in with username and with email", async () => {
    await setupAdmin();

    const byUsername = await signInUsername(
      adminCredentials.username,
      adminCredentials.password,
    );
    const byEmail = await signInEmail(
      adminCredentials.email,
      adminCredentials.password,
    );
    expect(byUsername.status).toBe(200);
    expect(byEmail.status).toBe(200);

    const usernameBody = await readJson(byUsername);
    const emailBody = await readJson(byEmail);
    expect(readNestedUserId(usernameBody)).toBe(readNestedUserId(emailBody));
  });

  it("returns identical failures for a wrong password and an unknown identifier", async () => {
    await setupAdmin();

    const wrongPassword = await signInEmail(
      adminCredentials.email,
      "wrong-password",
    );
    const unknownEmail = await signInEmail("nobody@example.com", "wrong-password");
    expect(wrongPassword.status).toBe(unknownEmail.status);
    expect(await wrongPassword.text()).toBe(await unknownEmail.text());

    const wrongUsernamePassword = await signInUsername(
      adminCredentials.username,
      "wrong-password",
    );
    const unknownUsername = await signInUsername("nobody", "wrong-password");
    expect(wrongUsernamePassword.status).toBe(unknownUsername.status);
    expect(await wrongUsernamePassword.text()).toBe(await unknownUsername.text());
  });

  it("blocks registration while the toggle is off and 404s the raw sign-up route", async () => {
    await setupAdmin();

    const registration = await postRegistration(
      jsonRequest("/api/registration", { body: userCredentials }),
    );
    expect(registration.status).toBe(403);
    expect(await readJson(registration)).toMatchObject({
      error: { code: "FORBIDDEN" },
    });

    const raw = await authPost(
      jsonRequest("/api/auth/sign-up/email", {
        body: {
          email: userCredentials.email,
          password: userCredentials.password,
          name: userCredentials.username,
        },
      }),
    );
    expect(raw.status).toBe(404);

    const remaining = await db.select({ id: users.id }).from(users);
    expect(remaining).toHaveLength(1);
  });

  it("honors the registration toggle at runtime without a restart", async () => {
    const { cookie } = await setupAdmin();

    const enabled = await patchAdminSettings(
      jsonRequest("/api/admin/settings", {
        method: "PATCH",
        cookie,
        body: { allowRegistration: true },
      }),
    );
    expect(enabled.status).toBe(200);

    const created = await postRegistration(
      jsonRequest("/api/registration", { body: userCredentials }),
    );
    expect(created.status).toBe(201);
    const createdBody = await readJson(created);
    const [member] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, readUserId(createdBody)));
    expect(member?.role).toBe("user");

    const disabled = await patchAdminSettings(
      jsonRequest("/api/admin/settings", {
        method: "PATCH",
        cookie,
        body: { allowRegistration: false },
      }),
    );
    expect(disabled.status).toBe(200);

    const blocked = await postRegistration(
      jsonRequest("/api/registration", {
        body: {
          username: "latecomer",
          email: "late@example.com",
          password: "password1",
        },
      }),
    );
    expect(blocked.status).toBe(403);
  });

  it("rejects a user-role caller from every admin endpoint", async () => {
    const { cookie: adminCookie } = await setupAdmin();
    await patchAdminSettings(
      jsonRequest("/api/admin/settings", {
        method: "PATCH",
        cookie: adminCookie,
        body: { allowRegistration: true },
      }),
    );
    const registered = await postRegistration(
      jsonRequest("/api/registration", { body: userCredentials }),
    );
    expect(registered.status).toBe(201);
    const createdBody = await readJson(registered);
    const memberCookie = cookiesFrom(registered);

    for (const endpoint of adminEndpoints) {
      const response = await (endpoint.method === "GET" ? authGet : authPost)(
        jsonRequest(endpoint.path, {
          method: endpoint.method,
          cookie: memberCookie,
          body: endpoint.body,
        }),
      );
      expect(response.status, endpoint.path).toBeGreaterThanOrEqual(400);
      expect(response.status, endpoint.path).toBeLessThan(500);
      const payload = asObject(await readJson(response));
      const code = typeof payload.code === "string" ? payload.code : "";
      const message =
        typeof payload.message === "string" ? payload.message.toLowerCase() : "";
      expect(
        code === "FORBIDDEN" ||
          message.includes("not allowed") ||
          message.includes("forbidden"),
        `${endpoint.path} => ${JSON.stringify(payload)}`,
      ).toBe(true);
    }

    const settingsPatch = await patchAdminSettings(
      jsonRequest("/api/admin/settings", {
        method: "PATCH",
        cookie: memberCookie,
        body: { allowRegistration: true },
      }),
    );
    expect(settingsPatch.status).toBe(403);

    await expect(
      updateInstanceSettings(
        { allowRegistration: true },
        { userId: readUserId(createdBody), role: "user" },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("resolves the same Actor from a bearer token as from the session cookie", async () => {
    const { cookie, token } = await setupAdmin();
    expect(token).toBeTruthy();

    const cookieActor = await requireActor(
      jsonRequest("/api/instance", { cookie }).headers,
    );
    const bearerActor = await requireActor(
      jsonRequest("/api/instance", { bearer: token ?? "" }).headers,
    );
    expect(bearerActor).toEqual(cookieActor);
    expect(cookieActor.role).toBe("super_admin");
  });

  it("rejects the banned user's next request", async () => {
    const { cookie: adminCookie } = await setupAdmin();
    await patchAdminSettings(
      jsonRequest("/api/admin/settings", {
        method: "PATCH",
        cookie: adminCookie,
        body: { allowRegistration: true },
      }),
    );
    const registered = await postRegistration(
      jsonRequest("/api/registration", { body: userCredentials }),
    );
    const member = await readJson(registered);
    const memberCookie = cookiesFrom(registered);

    const before = await authGet(
      jsonRequest("/api/auth/get-session", { cookie: memberCookie }),
    );
    expect(before.status).toBe(200);
    expect(await readJson(before)).not.toBeNull();

    const banned = await authPost(
      jsonRequest("/api/auth/admin/ban-user", {
        cookie: adminCookie,
        body: { userId: readUserId(member) },
      }),
    );
    expect(banned.status).toBe(200);

    const after = await authGet(
      jsonRequest("/api/auth/get-session", { cookie: memberCookie }),
    );
    const afterBody = await readJson(after);
    expect(afterBody).toBeNull();

    await expect(
      requireActor(jsonRequest("/", { cookie: memberCookie }).headers),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("changes password only when the current password is correct", async () => {
    const { cookie } = await setupAdmin();

    const wrongCurrent = await authPost(
      jsonRequest("/api/auth/change-password", {
        cookie,
        body: {
          currentPassword: "not-the-password",
          newPassword: "password2",
        },
      }),
    );
    expect(wrongCurrent.status).toBeGreaterThanOrEqual(400);

    const changed = await authPost(
      jsonRequest("/api/auth/change-password", {
        cookie,
        body: {
          currentPassword: adminCredentials.password,
          newPassword: "password2",
        },
      }),
    );
    expect(changed.status).toBe(200);

    const oldPassword = await signInEmail(
      adminCredentials.email,
      adminCredentials.password,
    );
    expect(oldPassword.status).toBe(401);

    const newPassword = await signInEmail(adminCredentials.email, "password2");
    expect(newPassword.status).toBe(200);
  });

  it("lets an admin create an account that can sign in", async () => {
    const { cookie } = await setupAdmin();
    const created = await authPost(
      jsonRequest("/api/auth/admin/create-user", {
        cookie,
        body: {
          email: userCredentials.email,
          password: userCredentials.password,
          name: userCredentials.username,
          role: "user",
          data: { username: userCredentials.username },
        },
      }),
    );
    expect(created.status).toBe(200);

    const signedIn = await signInUsername(
      userCredentials.username,
      userCredentials.password,
    );
    expect(signedIn.status).toBe(200);
  });

  it("stores auth ids as UUIDv7 on snake_case plural tables", async () => {
    await setupAdmin();
    const rows = await db.select({ id: users.id }).from(users);
    const id = rows[0]?.id;
    expect(id).toBeDefined();
    expect(id?.[14]).toBe("7");
  });

  it("GET /api/instance returns only needsSetup and allowRegistration", async () => {
    const empty = await getInstance(jsonRequest("/api/instance"));
    expect(empty.status).toBe(200);
    expect(await readJson(empty)).toEqual({
      needsSetup: true,
      allowRegistration: false,
    });

    await setupAdmin();
    const ready = await getInstance(jsonRequest("/api/instance"));
    expect(await readJson(ready)).toEqual({
      needsSetup: false,
      allowRegistration: false,
    });
  });

  it("rejects set-role targeting super_admin, requesting super_admin, or self-demotion", async () => {
    const { cookie: superCookie } = await setupAdmin();
    const createdAdmin = await adminCreateUser(superCookie, {
      ...staffAdminCredentials,
      role: "admin",
    });
    expect(createdAdmin.status).toBe(200);
    const adminId = readNestedUserId(await readJson(createdAdmin));
    const createdMember = await adminCreateUser(superCookie, {
      ...userCredentials,
      role: "user",
    });
    expect(createdMember.status).toBe(200);
    const memberId = readNestedUserId(await readJson(createdMember));

    const [superRow] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, adminCredentials.email));
    const superId = superRow?.id;
    if (typeof superId !== "string") {
      throw new Error("expected super admin id");
    }

    const targetSuper = await authPost(
      jsonRequest("/api/auth/admin/set-role", {
        cookie: superCookie,
        body: { userId: superId, role: "admin" },
      }),
    );
    expect(targetSuper.status).toBe(403);
    expectForbiddenCode(asObject(await readJson(targetSuper)));

    const requestSuper = await authPost(
      jsonRequest("/api/auth/admin/set-role", {
        cookie: superCookie,
        body: { userId: memberId, role: "super_admin" },
      }),
    );
    expect(requestSuper.status).toBe(403);
    expectForbiddenCode(asObject(await readJson(requestSuper)));

    const createSuper = await authPost(
      jsonRequest("/api/auth/admin/create-user", {
        cookie: superCookie,
        body: {
          email: "second-super@example.com",
          password: "password1",
          name: "secondsuper",
          role: "super_admin",
          data: { username: "secondsuper" },
        },
      }),
    );
    expect(createSuper.status).toBe(403);
    expectForbiddenCode(asObject(await readJson(createSuper)));

    const createSuperViaData = await authPost(
      jsonRequest("/api/auth/admin/create-user", {
        cookie: superCookie,
        body: {
          email: "third-super@example.com",
          password: "password1",
          name: "thirdsuper",
          data: { username: "thirdsuper", role: "super_admin" },
        },
      }),
    );
    expect(createSuperViaData.status).toBe(403);
    expectForbiddenCode(asObject(await readJson(createSuperViaData)));

    const updateToSuper = await authPost(
      jsonRequest("/api/auth/admin/update-user", {
        cookie: superCookie,
        body: { userId: memberId, data: { role: "super_admin" } },
      }),
    );
    expect(updateToSuper.status).toBe(403);
    expectForbiddenCode(asObject(await readJson(updateToSuper)));

    const signedInAdmin = await signInEmail(
      staffAdminCredentials.email,
      staffAdminCredentials.password,
    );
    expect(signedInAdmin.status).toBe(200);
    const adminCookie = cookiesFrom(signedInAdmin);

    const selfDemote = await authPost(
      jsonRequest("/api/auth/admin/set-role", {
        cookie: adminCookie,
        body: { userId: adminId, role: "user" },
      }),
    );
    expect(selfDemote.status).toBe(403);
    expectForbiddenCode(asObject(await readJson(selfDemote)));
  });

  it("forbids an admin from modifying another admin or the super_admin, but allows acting on a user", async () => {
    const { cookie: superCookie } = await setupAdmin();
    const createdAdmin = await adminCreateUser(superCookie, {
      ...staffAdminCredentials,
      role: "admin",
    });
    expect(createdAdmin.status).toBe(200);
    const createdOtherAdmin = await adminCreateUser(superCookie, {
      ...otherAdminCredentials,
      role: "admin",
    });
    expect(createdOtherAdmin.status).toBe(200);
    const otherAdminId = readNestedUserId(await readJson(createdOtherAdmin));
    const createdMember = await adminCreateUser(superCookie, {
      ...userCredentials,
      role: "user",
    });
    expect(createdMember.status).toBe(200);
    const memberId = readNestedUserId(await readJson(createdMember));

    const [superRow] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, adminCredentials.email));
    const superId = superRow?.id;
    if (typeof superId !== "string") {
      throw new Error("expected super admin id");
    }

    const signedInAdmin = await signInEmail(
      staffAdminCredentials.email,
      staffAdminCredentials.password,
    );
    const adminCookie = cookiesFrom(signedInAdmin);

    for (const [label, body] of [
      [
        "set-role other admin",
        { path: "/api/auth/admin/set-role", payload: { userId: otherAdminId, role: "user" } },
      ],
      [
        "set-role super_admin",
        { path: "/api/auth/admin/set-role", payload: { userId: superId, role: "user" } },
      ],
      [
        "ban other admin",
        { path: "/api/auth/admin/ban-user", payload: { userId: otherAdminId } },
      ],
      [
        "ban super_admin",
        { path: "/api/auth/admin/ban-user", payload: { userId: superId } },
      ],
      [
        "reset other admin",
        {
          path: "/api/auth/admin/set-user-password",
          payload: { userId: otherAdminId, newPassword: "password2" },
        },
      ],
      [
        "reset super_admin",
        {
          path: "/api/auth/admin/set-user-password",
          payload: { userId: superId, newPassword: "password2" },
        },
      ],
    ] as const) {
      const response = await authPost(
        jsonRequest(body.path, { cookie: adminCookie, body: body.payload }),
      );
      expect(response.status, label).toBe(403);
      expectForbiddenCode(asObject(await readJson(response)));
    }

    const setUserRole = await authPost(
      jsonRequest("/api/auth/admin/set-role", {
        cookie: adminCookie,
        body: { userId: memberId, role: "admin" },
      }),
    );
    expect(setUserRole.status).toBe(200);

    const revert = await authPost(
      jsonRequest("/api/auth/admin/set-role", {
        cookie: superCookie,
        body: { userId: memberId, role: "user" },
      }),
    );
    expect(revert.status).toBe(200);

    const banUser = await authPost(
      jsonRequest("/api/auth/admin/ban-user", {
        cookie: adminCookie,
        body: { userId: memberId },
      }),
    );
    expect(banUser.status).toBe(200);

    const unbanUser = await authPost(
      jsonRequest("/api/auth/admin/unban-user", {
        cookie: adminCookie,
        body: { userId: memberId },
      }),
    );
    expect(unbanUser.status).toBe(200);

    const resetUser = await authPost(
      jsonRequest("/api/auth/admin/set-user-password", {
        cookie: adminCookie,
        body: { userId: memberId, newPassword: "password2" },
      }),
    );
    expect(resetUser.status).toBe(200);

    const updateOtherAdmin = await authPost(
      jsonRequest("/api/auth/admin/update-user", {
        cookie: adminCookie,
        body: { userId: otherAdminId, data: { role: "user" } },
      }),
    );
    expect(updateOtherAdmin.status).toBe(403);
    expectForbiddenCode(asObject(await readJson(updateOtherAdmin)));
  });

  it("forbids ban and admin password-reset against the super_admin", async () => {
    const { cookie: superCookie } = await setupAdmin();
    const createdAdmin = await adminCreateUser(superCookie, {
      ...staffAdminCredentials,
      role: "admin",
    });
    expect(createdAdmin.status).toBe(200);

    const [superRow] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, adminCredentials.email));
    const superId = superRow?.id;
    if (typeof superId !== "string") {
      throw new Error("expected super admin id");
    }

    const signedInAdmin = await signInEmail(
      staffAdminCredentials.email,
      staffAdminCredentials.password,
    );
    const adminCookie = cookiesFrom(signedInAdmin);

    const ban = await authPost(
      jsonRequest("/api/auth/admin/ban-user", {
        cookie: adminCookie,
        body: { userId: superId },
      }),
    );
    expect(ban.status).toBe(403);
    expectForbiddenCode(asObject(await readJson(ban)));

    const reset = await authPost(
      jsonRequest("/api/auth/admin/set-user-password", {
        cookie: adminCookie,
        body: { userId: superId, newPassword: "password2" },
      }),
    );
    expect(reset.status).toBe(403);
    expectForbiddenCode(asObject(await readJson(reset)));

    const updateBan = await authPost(
      jsonRequest("/api/auth/admin/update-user", {
        cookie: adminCookie,
        body: { userId: superId, data: { banned: true } },
      }),
    );
    expect(updateBan.status).toBe(403);
    expectForbiddenCode(asObject(await readJson(updateBan)));

    const ownPassword = await authPost(
      jsonRequest("/api/auth/change-password", {
        cookie: superCookie,
        body: {
          currentPassword: adminCredentials.password,
          newPassword: "password2",
        },
      }),
    );
    expect(ownPassword.status).toBe(200);

    const oldPassword = await signInEmail(
      adminCredentials.email,
      adminCredentials.password,
    );
    expect(oldPassword.status).toBe(401);
    const newPassword = await signInEmail(adminCredentials.email, "password2");
    expect(newPassword.status).toBe(200);
  });

  it("promotes the earliest user to super_admin when none exists", async () => {
    const earlier = new Date("2026-01-01T00:00:00.000Z");
    const later = new Date("2026-06-01T00:00:00.000Z");
    const firstId = newId();
    const secondId = newId();
    await db.insert(users).values([
      {
        id: firstId,
        name: "legacy",
        email: "legacy@example.com",
        username: "legacy",
        role: "admin",
        emailVerified: false,
        banned: false,
        createdAt: earlier,
        updatedAt: earlier,
      },
      {
        id: secondId,
        name: "later",
        email: "later@example.com",
        username: "later",
        role: "user",
        emailVerified: false,
        banned: false,
        createdAt: later,
        updatedAt: later,
      },
    ]);

    const contents = readFileSync(promoteMigrationPath, "utf8")
      .split("\n")
      .filter((line) => !line.startsWith("--") && line.trim().length > 0)
      .join("\n");
    await db.execute(sql.raw(contents));

    const rows = await db
      .select({ id: users.id, role: users.role })
      .from(users);
    const byId = new Map(rows.map((row) => [row.id, row.role]));
    expect(byId.get(firstId)).toBe("super_admin");
    expect(byId.get(secondId)).toBe("user");

    await db.execute(sql.raw(contents));
    const again = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, secondId));
    expect(again[0]?.role).toBe("user");
  });
});
