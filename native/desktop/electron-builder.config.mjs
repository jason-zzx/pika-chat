import { readFileSync } from "node:fs";

const rootPackage = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

/** @type {import("electron-builder").Configuration} */
export default {
  appId: "io.github.jason-zzx.pika-chat",
  productName: "Pika Chat",
  directories: { output: "release", buildResources: "assets" },
  files: ["dist/**", "package.json"],
  extraResources: [
    { from: "server", to: "server" },
    { from: "server/node_modules", to: "server/node_modules" },
  ],
  extraMetadata: { version: rootPackage.version },
  artifactName: "pika-chat-${version}-${os}-${arch}.${ext}",
  // Only used to generate updater metadata; CI publishes through the GitHub Release job.
  publish: { provider: "github", owner: "jason-zzx", repo: "pika-chat" },
  win: {
    // electron-builder has no top-level `zip` config section, so give Windows the `-portable` name here and keep NSIS on the standard pattern below.
    artifactName: "pika-chat-${version}-${os}-${arch}-portable.${ext}",
    target: [
      { target: "zip", arch: ["x64"] },
      { target: "nsis", arch: ["x64"] },
    ],
  },
  nsis: {
    artifactName: "pika-chat-${version}-${os}-${arch}.${ext}",
    oneClick: false,
    perMachine: false,
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    installerSidebar: "installerSidebar.bmp",
    uninstallerSidebar: "installerSidebar.bmp",
    installerHeader: "installerHeader.bmp",
    include: "installer.nsh",
  },
  mac: {
    target: [{ target: "dmg", arch: ["x64", "arm64"] }],
    category: "public.app-category.productivity",
    // Ad-hoc signature: no certificate, but Apple Silicon refuses to run code with a broken one, and
    // `identity: null` skips signing after the bundle has been modified. Ad-hoc code has no team ID,
    // so the hardened runtime's library validation would block Electron's own frameworks.
    identity: "-",
    hardenedRuntime: false,
  },
  linux: {
    target: [
      { target: "AppImage", arch: ["x64"] },
      { target: "deb", arch: ["x64"] },
      { target: "rpm", arch: ["x64"] },
    ],
    // Name the .desktop file after package.json desktopName, which Electron uses as the Wayland
    // app_id / X11 WM_CLASS, so the running window is associated with its launcher entry.
    syncDesktopName: true,
    category: "Network;Chat",
    maintainer: "jason-zzx <zxzhukke@gmail.com>",
    synopsis: "Desktop app for Pika Chat",
    icon: "icons",
  },
};
