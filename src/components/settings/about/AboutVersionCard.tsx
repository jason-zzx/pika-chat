"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import PikaMark from "@/components/common/PikaMark";
import SettingsBadge from "@/components/settings/SettingsBadge";
import SettingsCard from "@/components/settings/SettingsCard";
import SettingsRow from "@/components/settings/SettingsRow";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { usePikaNative } from "@/hooks/use-pika-native";
import { copyTextToClipboard } from "@/lib/clipboard";

type AboutVersionCardProps = {
  version: string;
  local?: boolean;
  isGuest?: boolean;
};

const COPIED_FEEDBACK_MS = 2000;

function formatVersion(version: string): string {
  return version.startsWith("v") ? version : `v${version}`;
}

/**
 * Brand and version summary card for /settings/about. Kept as a client leaf so
 * native shells can also surface their client version alongside the server
 * version without pulling the rest of the About page into the client bundle.
 */
export default function AboutVersionCard({
  version,
  local = false,
  isGuest = false,
}: AboutVersionCardProps) {
  const t = useTranslations("Settings.About");
  const tRoot = useTranslations("RootLayout");
  const native = usePikaNative();
  const [copied, setCopied] = useState(false);
  const copiedTimeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => window.clearTimeout(copiedTimeoutRef.current);
  }, []);

  const displayVersion = formatVersion(version);
  const clientVersion =
    !local && native?.appVersion ? formatVersion(native.appVersion) : null;
  const modeLabel = local
    ? t("localMode")
    : isGuest
      ? t("demoMode")
      : null;

  async function onCopyVersion() {
    const payload = clientVersion
      ? t("copyPayloadSplit", {
          app: tRoot("title"),
          serverVersion: displayVersion,
          clientVersion,
        })
      : t("copyPayloadSingle", {
          app: tRoot("title"),
          version: displayVersion,
        });
    const ok = await copyTextToClipboard(payload);
    if (!ok) {
      toast.add({ type: "error", title: t("copyFailed") });
      return;
    }
    setCopied(true);
    window.clearTimeout(copiedTimeoutRef.current);
    copiedTimeoutRef.current = window.setTimeout(
      () => setCopied(false),
      COPIED_FEEDBACK_MS,
    );
  }

  return (
    <SettingsCard>
      <div className="flex flex-col divide-y divide-border">
        <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3.5">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/40">
              <PikaMark className="size-7" />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-base font-semibold tracking-tight">
                  {tRoot("title")}
                </p>
                {modeLabel ? (
                  <SettingsBadge dot={false}>{modeLabel}</SettingsBadge>
                ) : null}
              </div>
              <p className="text-sm text-muted-foreground">
                {tRoot("description")}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit shrink-0"
            onClick={() => void onCopyVersion()}
          >
            {copied ? (
              <>
                <CheckIcon aria-hidden="true" />
                {t("copied")}
              </>
            ) : (
              <>
                <CopyIcon aria-hidden="true" />
                {t("copyVersion")}
              </>
            )}
          </Button>
        </div>
        <SettingsRow
          label={clientVersion ? t("serverVersion") : t("version")}
          control={
            <span className="font-mono text-sm text-muted-foreground tabular-nums">
              {displayVersion}
            </span>
          }
        />
        {clientVersion ? (
          <SettingsRow
            label={t("clientVersion")}
            control={
              <span className="font-mono text-sm text-muted-foreground tabular-nums">
                {clientVersion}
              </span>
            }
          />
        ) : null}
      </div>
    </SettingsCard>
  );
}
