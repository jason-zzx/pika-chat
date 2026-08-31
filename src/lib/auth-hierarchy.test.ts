import { describe, expect, it } from "vitest";

import { canAdminister, parseActorRole, requestedRoleFromBody } from "./auth-hierarchy";

const superAdmin = { userId: "sa", role: "super_admin" as const };
const admin = { userId: "ad", role: "admin" as const };
const otherAdmin = { userId: "ad2", role: "admin" as const };
const member = { userId: "u", role: "user" as const };

describe("parseActorRole", () => {
  it("prefers super_admin in a comma-separated role string", () => {
    expect(parseActorRole("super_admin,admin")).toBe("super_admin");
    expect(parseActorRole("admin")).toBe("admin");
    expect(parseActorRole("user")).toBe("user");
    expect(parseActorRole(undefined)).toBe("user");
  });

  it("detects super_admin in arrays", () => {
    expect(parseActorRole(["user", "super_admin"])).toBe("super_admin");
    expect(parseActorRole(["admin", "user"])).toBe("admin");
  });
});

describe("requestedRoleFromBody", () => {
  it("matches Better Auth createUser: body.role ?? body.data.role", () => {
    expect(requestedRoleFromBody({ role: "admin" })).toBe("admin");
    expect(
      requestedRoleFromBody({ data: { role: "super_admin", username: "x" } }),
    ).toBe("super_admin");
    expect(
      requestedRoleFromBody({
        role: "user",
        data: { role: "super_admin" },
      }),
    ).toBe("user");
    expect(requestedRoleFromBody({ role: null, data: { role: "admin" } })).toBe(
      "admin",
    );
    expect(requestedRoleFromBody({ data: { username: "x" } })).toBeUndefined();
  });
});

describe("canAdminister", () => {
  it("always rejects requesting role super_admin", () => {
    expect(canAdminister(superAdmin, member, "set-role", "super_admin")).toBe(
      false,
    );
    expect(canAdminister(superAdmin, null, "create-user", "super_admin")).toBe(
      false,
    );
    expect(
      canAdminister(admin, member, "create-user", ["super_admin"]),
    ).toBe(false);
  });

  it("never lets a super_admin be a target of modify actions", () => {
    expect(canAdminister(superAdmin, superAdmin, "set-role", "admin")).toBe(
      false,
    );
    expect(canAdminister(admin, superAdmin, "set-role", "user")).toBe(false);
    expect(canAdminister(admin, superAdmin, "ban")).toBe(false);
    expect(canAdminister(admin, superAdmin, "unban")).toBe(false);
    expect(canAdminister(admin, superAdmin, "set-user-password")).toBe(false);
    expect(canAdminister(superAdmin, superAdmin, "ban")).toBe(false);
    expect(canAdminister(superAdmin, superAdmin, "set-user-password")).toBe(
      false,
    );
  });

  it("rejects self set-role", () => {
    expect(canAdminister(admin, admin, "set-role", "user")).toBe(false);
    expect(canAdminister(superAdmin, superAdmin, "set-role", "admin")).toBe(
      false,
    );
  });

  it("lets an admin act only on a user", () => {
    expect(canAdminister(admin, member, "set-role", "admin")).toBe(true);
    expect(canAdminister(admin, member, "ban")).toBe(true);
    expect(canAdminister(admin, member, "set-user-password")).toBe(true);
    expect(canAdminister(admin, otherAdmin, "set-role", "user")).toBe(false);
    expect(canAdminister(admin, otherAdmin, "ban")).toBe(false);
    expect(canAdminister(admin, otherAdmin, "set-user-password")).toBe(false);
    expect(canAdminister(admin, null, "create-user", "user")).toBe(true);
    expect(canAdminister(admin, null, "create-user", "admin")).toBe(true);
  });

  it("lets a super_admin act on admin and user", () => {
    expect(canAdminister(superAdmin, admin, "set-role", "user")).toBe(true);
    expect(canAdminister(superAdmin, member, "set-role", "admin")).toBe(true);
    expect(canAdminister(superAdmin, admin, "ban")).toBe(true);
    expect(canAdminister(superAdmin, member, "set-user-password")).toBe(true);
    expect(canAdminister(superAdmin, null, "create-user", "admin")).toBe(true);
  });

  it("rejects a user-role actor", () => {
    expect(canAdminister(member, member, "ban")).toBe(false);
    expect(canAdminister(member, null, "create-user", "user")).toBe(false);
  });
});
