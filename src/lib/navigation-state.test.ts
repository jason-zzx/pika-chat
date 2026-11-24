// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  MAX_WORKSPACE_TOPICS,
  NAV_STATE_STORAGE_KEY,
  canGoBack,
  clearNavState,
  currentPath,
  exitSettings,
  loadNavState,
  openAssistant,
  openHome,
  openProviderDetail,
  openSettings,
  openTopic,
  promoteDraftToTopic,
  purgeAssistant,
  purgeTopic,
  saveNavState,
  stepBack,
  syncPathname,
} from "./navigation-state";

function createInitialNavState(
  pathname = "/",
  options?: { isMobile?: boolean },
) {
  return syncPathname(openHome(), pathname, options);
}

describe("navigation-state home root & topic traversal", () => {
  it("starts at Home root with cannot go back", () => {
    const state = createInitialNavState("/");
    expect(state).toEqual({
      mode: "app",
      workspaceStack: ["/"],
      settingsStack: null,
      authStack: [],
    });
    expect(canGoBack(state)).toBe(false);
    expect(stepBack(state)).toEqual({ state, target: null });
  });

  it("guarantees Home at index 0 and normalizes query/trailing slash on cold-start deep links", () => {
    const state = createInitialNavState("/assistant/a1/t1/?m=grp1");
    expect(state.workspaceStack).toEqual(["/", "/assistant/a1/t1"]);
    expect(canGoBack(state)).toBe(true);

    const back1 = stepBack(state);
    expect(back1.target).toBe("/");
    expect(back1.state.workspaceStack).toEqual(["/"]);
    expect(canGoBack(back1.state)).toBe(false);
    expect(stepBack(back1.state).target).toBeNull();
  });

  it("walks back through visited topics one by one until Home", () => {
    let state = createInitialNavState("/");
    state = openTopic(state, "a1", "t1", { isMobile: false });
    state = openTopic(state, "a1", "t2", { isMobile: false });
    state = openTopic(state, "a1", "t3", { isMobile: false });
    expect(state.workspaceStack).toEqual([
      "/",
      "/assistant/a1/t1",
      "/assistant/a1/t2",
      "/assistant/a1/t3",
    ]);

    const s1 = stepBack(state);
    expect(s1.target).toBe("/assistant/a1/t2");
    const s2 = stepBack(s1.state);
    expect(s2.target).toBe("/assistant/a1/t1");
    const s3 = stepBack(s2.state);
    expect(s3.target).toBe("/");
    expect(stepBack(s3.state).target).toBeNull();
  });

  it("deduplicates alternating topics via move-to-top to prevent loops", () => {
    let state = createInitialNavState("/");
    state = openTopic(state, "a1", "t1", { isMobile: false });
    state = openTopic(state, "a1", "t2", { isMobile: false });
    state = openTopic(state, "a1", "t1", { isMobile: false });
    expect(state.workspaceStack).toEqual([
      "/",
      "/assistant/a1/t2",
      "/assistant/a1/t1",
    ]);

    const s1 = stepBack(state);
    expect(s1.target).toBe("/assistant/a1/t2");
    expect(stepBack(s1.state).target).toBe("/");
  });

  it("caps workspace topics at MAX_WORKSPACE_TOPICS while preserving Home at index 0", () => {
    let state = createInitialNavState("/");
    for (let i = 1; i <= MAX_WORKSPACE_TOPICS + 5; i += 1) {
      state = openTopic(state, "a1", `t${i}`, { isMobile: false });
    }
    expect(state.workspaceStack).toHaveLength(1 + MAX_WORKSPACE_TOPICS);
    expect(state.workspaceStack[0]).toBe("/");
    expect(state.workspaceStack[1]).toBe("/assistant/a1/t6");
    expect(state.workspaceStack.at(-1)).toBe(
      `/assistant/a1/t${MAX_WORKSPACE_TOPICS + 5}`,
    );
  });
});

describe("navigation-state empty assistant draft split (mobile vs desktop)", () => {
  it("preserves /assistant/:a on desktop/web so Back passes through it before Home", () => {
    let state = createInitialNavState("/");
    state = openAssistant(state, "a1");
    state = openTopic(state, "a1", "t1", { isMobile: false });
    expect(state.workspaceStack).toEqual([
      "/",
      "/assistant/a1",
      "/assistant/a1/t1",
    ]);

    const s1 = stepBack(state);
    expect(s1.target).toBe("/assistant/a1");
    expect(stepBack(s1.state).target).toBe("/");
  });

  it("coalesces /assistant/:a on mobile so Back returns directly from topic to Home", () => {
    let state = createInitialNavState("/");
    state = openAssistant(state, "a1");
    state = openTopic(state, "a1", "t1", { isMobile: true });
    expect(state.workspaceStack).toEqual(["/", "/assistant/a1/t1"]);

    const s1 = stepBack(state);
    expect(s1.target).toBe("/");
    expect(stepBack(s1.state).target).toBeNull();
  });

  it("promotes a first message from Home by pushing topic while keeping Home beneath", () => {
    const promoted = promoteDraftToTopic(createInitialNavState("/"), "a1", "t1");
    expect(promoted.workspaceStack).toEqual(["/", "/assistant/a1/t1"]);
    expect(stepBack(promoted).target).toBe("/");
  });

  it("promotes a first message from an assistant draft by replacing the draft with the topic", () => {
    let state = createInitialNavState("/");
    state = openTopic(state, "a1", "t0", { isMobile: false });
    state = openAssistant(state, "a1");
    const promoted = promoteDraftToTopic(state, "a1", "t1");
    expect(promoted.workspaceStack).toEqual([
      "/",
      "/assistant/a1/t0",
      "/assistant/a1/t1",
    ]);

    const back1 = stepBack(promoted);
    expect(back1.target).toBe("/assistant/a1/t0");
    expect(stepBack(back1.state).target).toBe("/");
  });
});

describe("navigation-state settings isolation", () => {
  it("replaces settings tabs in place and returns to the original topic in one step", () => {
    let state = createInitialNavState("/");
    state = openTopic(state, "a1", "t1", { isMobile: false });
    state = openTopic(state, "a1", "t2", { isMobile: false });
    state = openSettings(state, "/settings/general");
    state = openSettings(state, "/settings/models");
    state = openSettings(state, "/settings/about");

    expect(state.settingsStack).toEqual(["/settings/about"]);
    expect(state.workspaceStack).toEqual([
      "/",
      "/assistant/a1/t1",
      "/assistant/a1/t2",
    ]);

    const back1 = stepBack(state);
    expect(back1.target).toBe("/assistant/a1/t2");
    expect(back1.state.settingsStack).toBeNull();

    // Pressing Back further traverses workspace and never re-enters settings.
    const back2 = stepBack(back1.state);
    expect(back2.target).toBe("/assistant/a1/t1");
    const back3 = stepBack(back2.state);
    expect(back3.target).toBe("/");
    expect(stepBack(back3.state).target).toBeNull();
  });

  it("uses 2-step Back for mobile provider detail and 1-step Back on desktop", () => {
    let mobileState = openTopic(createInitialNavState("/"), "a1", "t2", {
      isMobile: true,
    });
    mobileState = openSettings(mobileState, "/settings/providers");
    mobileState = openProviderDetail(mobileState, "cfg1", { isMobile: true });
    expect(mobileState.settingsStack).toEqual([
      "/settings/providers",
      "/settings/providers/cfg1",
    ]);

    const mBack1 = stepBack(mobileState);
    expect(mBack1.target).toBe("/settings/providers");
    expect(mBack1.state.settingsStack).toEqual(["/settings/providers"]);

    const mBack2 = stepBack(mBack1.state);
    expect(mBack2.target).toBe("/assistant/a1/t2");
    expect(mBack2.state.settingsStack).toBeNull();

    let desktopState = openTopic(createInitialNavState("/"), "a1", "t2", {
      isMobile: false,
    });
    desktopState = openSettings(desktopState, "/settings/providers");
    desktopState = openProviderDetail(desktopState, "cfg1", {
      isMobile: false,
    });
    expect(desktopState.settingsStack).toEqual(["/settings/providers/cfg1"]);
    const dBack1 = stepBack(desktopState);
    expect(dBack1.target).toBe("/assistant/a1/t2");
    expect(dBack1.state.settingsStack).toBeNull();
  });

  it("discards settingsStack when jumping from Settings to a topic via SearchDialog", () => {
    let state = openTopic(createInitialNavState("/"), "a1", "t1", {
      isMobile: false,
    });
    state = openSettings(state, "/settings/general");
    state = openTopic(state, "a1", "t3", { isMobile: false });

    expect(state.settingsStack).toBeNull();
    expect(state.workspaceStack).toEqual([
      "/",
      "/assistant/a1/t1",
      "/assistant/a1/t3",
    ]);

    const back1 = stepBack(state);
    expect(back1.target).toBe("/assistant/a1/t1");
    expect(stepBack(back1.state).target).toBe("/");
  });

  it("returns to Home when cold-starting on a settings route", () => {
    const state = createInitialNavState("/settings/general");
    expect(canGoBack(state)).toBe(true);
    const back = stepBack(state);
    expect(back.target).toBe("/");
    expect(back.state.settingsStack).toBeNull();
    expect(canGoBack(back.state)).toBe(false);
  });

  it("exits Settings in one step via exitSettings even from 2-level mobile provider detail", () => {
    let state = openTopic(createInitialNavState("/"), "a1", "t2", {
      isMobile: true,
    });
    state = openSettings(state, "/settings/providers");
    state = openProviderDetail(state, "cfg1", { isMobile: true });

    const exited = exitSettings(state);
    expect(exited.target).toBe("/assistant/a1/t2");
    expect(exited.state.settingsStack).toBeNull();
    expect(exitSettings(exited.state)).toEqual({
      state: exited.state,
      target: null,
    });
  });
});

describe("navigation-state auth stack", () => {
  it("treats /sign-in and /setup as auth roots and pops sub-pages back to /sign-in", () => {
    const signIn = createInitialNavState("/sign-in");
    expect(signIn.mode).toBe("auth");
    expect(canGoBack(signIn)).toBe(false);
    expect(stepBack(signIn).target).toBeNull();

    const setup = createInitialNavState("/setup");
    expect(setup.mode).toBe("auth");
    expect(canGoBack(setup)).toBe(false);

    const twoFactor = syncPathname(signIn, "/two-factor");
    expect(twoFactor.authStack).toEqual(["/sign-in", "/two-factor"]);
    expect(canGoBack(twoFactor)).toBe(true);

    const backToSignIn = stepBack(twoFactor);
    expect(backToSignIn.target).toBe("/sign-in");
    expect(canGoBack(backToSignIn.state)).toBe(false);

    const coldSignUp = createInitialNavState("/sign-up");
    expect(coldSignUp.authStack).toEqual(["/sign-in", "/sign-up"]);
    expect(stepBack(coldSignUp).target).toBe("/sign-in");
  });
});

describe("navigation-state stale-route purges & syncPathname", () => {
  it("purges a deleted topic being viewed and falls back to the assistant draft or Home", () => {
    let state = createInitialNavState("/");
    state = openTopic(state, "a1", "t1", { isMobile: false });
    state = openTopic(state, "a1", "t2", { isMobile: false });

    const afterDelete = purgeTopic(state, "t2", "/assistant/a1");
    expect(currentPath(afterDelete)).toBe("/assistant/a1");
    expect(afterDelete.workspaceStack).toEqual([
      "/",
      "/assistant/a1/t1",
      "/assistant/a1",
    ]);

    expect(purgeTopic(state, "t2", "/").workspaceStack).toEqual(["/"]);
  });

  it("purges a deleted non-active topic without changing the current route", () => {
    let state = createInitialNavState("/");
    state = openTopic(state, "a1", "t1", { isMobile: false });
    state = openTopic(state, "a1", "t2", { isMobile: false });

    const afterDelete = purgeTopic(state, "t1", "/assistant/a1");
    expect(currentPath(afterDelete)).toBe("/assistant/a1/t2");
    expect(afterDelete.workspaceStack).toEqual(["/", "/assistant/a1/t2"]);
  });

  it("purges all routes of a deleted assistant", () => {
    let state = createInitialNavState("/");
    state = openTopic(state, "a1", "t1", { isMobile: false });
    state = openTopic(state, "a2", "t2", { isMobile: false });

    const nonViewing = purgeAssistant(state, "a1");
    expect(currentPath(nonViewing)).toBe("/assistant/a2/t2");
    expect(nonViewing.workspaceStack).toEqual(["/", "/assistant/a2/t2"]);

    const viewing = purgeAssistant(nonViewing, "a2");
    expect(viewing.workspaceStack).toEqual(["/"]);
    expect(canGoBack(viewing)).toBe(false);
  });

  it("adjusts provider detail stack depth when viewport crosses mobile breakpoint", () => {
    const desktopCold = createInitialNavState("/settings/providers/cfg1", {
      isMobile: false,
    });
    expect(desktopCold.settingsStack).toEqual(["/settings/providers/cfg1"]);

    const upgradedToMobile = syncPathname(
      desktopCold,
      "/settings/providers/cfg1",
      { isMobile: true },
    );
    expect(upgradedToMobile.settingsStack).toEqual([
      "/settings/providers",
      "/settings/providers/cfg1",
    ]);

    const backToDesktop = syncPathname(
      upgradedToMobile,
      "/settings/providers/cfg1",
      { isMobile: false },
    );
    expect(backToDesktop.settingsStack).toEqual(["/settings/providers/cfg1"]);
  });
});

describe("navigation-state sessionStorage persistence", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("round-trips valid state, clears storage, and rejects corrupt JSON", () => {
    let state = openTopic(createInitialNavState("/"), "a1", "t1", {
      isMobile: false,
    });
    state = openSettings(state, "/settings/files");

    saveNavState(state);
    expect(loadNavState()).toEqual(state);

    clearNavState();
    expect(loadNavState()).toBeNull();

    window.sessionStorage.setItem(NAV_STATE_STORAGE_KEY, "{not-json");
    expect(loadNavState()).toBeNull();
  });

  it("sanitizes invariants when loading valid-schema tampered state", () => {
    window.sessionStorage.setItem(
      NAV_STATE_STORAGE_KEY,
      JSON.stringify({
        mode: "app",
        workspaceStack: [
          "/assistant/a1/t1",
          "/settings/general",
          "/sign-in",
          "/assistant/a1/t1",
        ],
        settingsStack: ["/settings/providers", "/settings/providers/cfg1"],
        authStack: ["/sign-in"],
      }),
    );

    expect(loadNavState()).toEqual({
      mode: "app",
      workspaceStack: ["/", "/assistant/a1/t1"],
      settingsStack: ["/settings/providers", "/settings/providers/cfg1"],
      authStack: [],
    });
  });
});
