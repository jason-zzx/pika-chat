"use client";

import { RefreshCwIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import SettingsCard from "@/components/settings/SettingsCard";
import SettingsRow from "@/components/settings/SettingsRow";
import SettingsSection from "@/components/settings/SettingsSection";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { usePikaNative } from "@/hooks/use-pika-native";
import { acceleratorFromKey, formatAccelerator } from "@/lib/desktop-hotkey";
import { formatBytes } from "@/lib/files/format";

/**
 * Desktop-only settings and client storage breakdown rendered inside
 * `/settings/general`. Returns `null` in browsers, mobile, and older shells.
 */
export default function DesktopSettingsSection() {
  const native = usePikaNative();
  const desktop = native?.desktop;
  const tDesktop = useTranslations("Settings.General.desktop");
  const tStorage = useTranslations("Settings.General.storage");

  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [usage, setUsage] = useState<DesktopStorageUsage | null>(null);
  const [recording, setRecording] = useState(false);
  const [busyCategory, setBusyCategory] = useState<
    DesktopStorageCategory | "refresh" | null
  >(null);

  useEffect(() => {
    if (!desktop) {
      return;
    }
    let active = true;
    void Promise.all([desktop.getSettings(), desktop.getStorageUsage()]).then(
      ([nextSettings, nextUsage]) => {
        if (!active) {
          return;
        }
        setSettings(nextSettings);
        setUsage(nextUsage);
      },
    );
    return () => {
      active = false;
    };
  }, [desktop]);

  if (!desktop) {
    return null;
  }

  const isMac = desktop.platform === "darwin";

  const onChangeCloseAction = async (value: string | null) => {
    if (value !== "tray" && value !== "quit") {
      return;
    }
    setSettings((prev) => (prev ? { ...prev, closeAction: value } : prev));
    await desktop.setCloseAction(value);
  };

  const onRecordKeyDown = async (
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) => {
    if (!recording) {
      return;
    }
    event.preventDefault();
    if (event.code === "Escape") {
      setRecording(false);
      return;
    }
    const accelerator = acceleratorFromKey(event, isMac);
    if (!accelerator) {
      return;
    }
    const result = await desktop.setHotkey(accelerator);
    setRecording(false);
    if (!result.ok) {
      toast.add({ type: "error", title: tDesktop("hotkeyFailed") });
      return;
    }
    setSettings((prev) => (prev ? { ...prev, hotkey: accelerator } : prev));
  };

  const onClearHotkey = async () => {
    await desktop.setHotkey(null);
    setRecording(false);
    setSettings((prev) => (prev ? { ...prev, hotkey: null } : prev));
  };

  const onRefreshStorage = async () => {
    if (busyCategory) {
      return;
    }
    setBusyCategory("refresh");
    try {
      setUsage(await desktop.getStorageUsage());
    } finally {
      setBusyCategory(null);
    }
  };

  const onClearCategory = async (category: DesktopStorageCategory) => {
    if (busyCategory) {
      return;
    }
    setBusyCategory(category);
    try {
      setUsage(await desktop.clearStorage(category));
      toast.add({ type: "success", title: tStorage("cleared") });
    } finally {
      setBusyCategory(null);
    }
  };

  const hotkeyLabel = recording
    ? tDesktop("hotkeyRecording")
    : settings?.hotkey
      ? formatAccelerator(settings.hotkey, isMac)
      : tDesktop("hotkeyNone");

  const closeAction = settings?.closeAction ?? "tray";
  const closeActionItems: Record<DesktopCloseAction, string> = {
    tray: tDesktop("closeActionTray"),
    quit: tDesktop("closeActionQuit"),
  };

  const storageRows = [
    {
      key: "localData",
      label: tStorage("localData"),
      description: tStorage("localDataDescription"),
      bytes: usage ? usage.localDataBytes : null,
      actionLabel: tStorage("openFolder"),
      disabled: !usage || usage.localDataBytes === 0,
      onAction: () => void desktop.openLocalDataFolder(),
    },
    {
      key: "webCache",
      label: tStorage("webCache"),
      description: tStorage("webCacheDescription"),
      bytes: usage ? usage.webCacheBytes : null,
      actionLabel: tStorage("clearCache"),
      disabled: !usage || usage.webCacheBytes === 0 || busyCategory !== null,
      onAction: () => void onClearCategory("webCache"),
    },
    {
      key: "updaterCache",
      label: tStorage("updaterCache"),
      description: tStorage("updaterCacheDescription"),
      bytes: usage ? usage.updaterCacheBytes : null,
      actionLabel: tStorage("clearCache"),
      disabled:
        !usage || usage.updaterCacheBytes === 0 || busyCategory !== null,
      onAction: () => void onClearCategory("updaterCache"),
    },
    {
      key: "logsAndTemp",
      label: tStorage("logsAndTemp"),
      description: tStorage("logsAndTempDescription"),
      bytes: usage ? usage.logsAndTempBytes : null,
      actionLabel: tStorage("clear"),
      disabled:
        !usage || usage.logsAndTempBytes === 0 || busyCategory !== null,
      onAction: () => void onClearCategory("logsAndTemp"),
    },
  ];

  return (
    <>
      <SettingsSection
        title={tDesktop("title")}
        description={tDesktop("description")}
      >
        <SettingsCard>
          <div className="flex flex-col divide-y divide-border">
            {!isMac ? (
              <SettingsRow
                label={tDesktop("closeAction")}
                description={tDesktop("closeActionDescription")}
                control={
                  <Select
                    value={closeAction}
                    items={closeActionItems}
                    disabled={!settings}
                    onValueChange={(value) => void onChangeCloseAction(value)}
                  >
                    <SelectTrigger
                      aria-label={tDesktop("closeAction")}
                      className="min-w-44"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(closeActionItems).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                }
              />
            ) : null}
            <SettingsRow
              label={tDesktop("hotkey")}
              description={tDesktop("hotkeyDescription")}
              control={
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-w-40 font-mono"
                    title={tDesktop("hotkeyRecord")}
                    disabled={!settings}
                    onClick={() => setRecording(true)}
                    onBlur={() => setRecording(false)}
                    onKeyDown={(event) => void onRecordKeyDown(event)}
                  >
                    {hotkeyLabel}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!settings?.hotkey}
                    onClick={() => void onClearHotkey()}
                  >
                    {tDesktop("hotkeyClear")}
                  </Button>
                </div>
              }
            />
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title={tStorage("title")}
        description={
          usage
            ? tStorage("description", {
                total: formatBytes(
                  usage.localDataBytes +
                    usage.webCacheBytes +
                    usage.updaterCacheBytes +
                    usage.logsAndTempBytes,
                ),
              })
            : tStorage("descriptionLoading")
        }
      >
        <SettingsCard>
          <div className="flex flex-col divide-y divide-border">
            {storageRows.map((row) => (
              <SettingsRow
                key={row.key}
                label={row.label}
                description={row.description}
                control={
                  <div className="flex items-center gap-3">
                    {row.bytes !== null ? (
                      <span className="font-mono text-sm text-muted-foreground tabular-nums">
                        {formatBytes(row.bytes)}
                      </span>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={row.disabled}
                      onClick={row.onAction}
                    >
                      {row.actionLabel}
                    </Button>
                  </div>
                }
              />
            ))}
            <div className="flex justify-end px-5 py-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busyCategory !== null}
                onClick={() => void onRefreshStorage()}
              >
                <RefreshCwIcon aria-hidden="true" />
                {tStorage("refresh")}
              </Button>
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>
    </>
  );
}
