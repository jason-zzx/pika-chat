import {
  CircleAlertIcon,
  CodeIcon,
  ExternalLinkIcon,
  ScaleIcon,
  TagIcon,
} from "lucide-react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import pkg from "../../../../../package.json";

import PageContainer from "@/components/layout/PageContainer";
import PageHeader from "@/components/layout/PageHeader";
import SettingsCard from "@/components/settings/SettingsCard";
import SettingsSection from "@/components/settings/SettingsSection";
import AboutVersionCard from "@/components/settings/about/AboutVersionCard";
import { resolveActor } from "@/server/auth/actor";
import { isLocalMode } from "@/server/env";

const REPO_URL = "https://github.com/jason-zzx/pika-chat";
const RELEASES_URL = `${REPO_URL}/releases`;
const ISSUES_URL = `${REPO_URL}/issues`;
const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;

// Hoisted external-link tokens so eslint-plugin-i18next does not flag JSX attributes.
const EXTERNAL_LINK_TARGET = "_blank";
const EXTERNAL_LINK_REL = "noreferrer noopener";

const PROJECT_LINKS = [
  {
    href: REPO_URL,
    icon: CodeIcon,
    labelKey: "github",
    descriptionKey: "githubDescription",
  },
  {
    href: RELEASES_URL,
    icon: TagIcon,
    labelKey: "releases",
    descriptionKey: "releasesDescription",
  },
  {
    href: ISSUES_URL,
    icon: CircleAlertIcon,
    labelKey: "issues",
    descriptionKey: "issuesDescription",
  },
] as const;

export const generateMetadata = async () => ({
  title: (await getTranslations("Settings.About"))("title"),
});

export default async function SettingsAboutPage() {
  const actor = await resolveActor(await headers());
  if (!actor) {
    redirect("/sign-in");
  }
  const t = await getTranslations("Settings.About");

  return (
    <PageContainer>
      <PageHeader title={t("title")} description={t("description")} />
      <AboutVersionCard
        version={pkg.version}
        local={isLocalMode()}
        isGuest={actor.isGuest === true}
      />
      <SettingsSection title={t("projectTitle")}>
        <SettingsCard>
          <div className="flex flex-col divide-y divide-border">
            {PROJECT_LINKS.map((item) => {
              const Icon = item.icon;
              return (
                <a
                  key={item.href}
                  href={item.href}
                  target={EXTERNAL_LINK_TARGET}
                  rel={EXTERNAL_LINK_REL}
                  className="group flex items-center justify-between gap-4 px-5 py-4 transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Icon
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
                    />
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <p className="text-sm font-medium">{t(item.labelKey)}</p>
                      <p className="text-sm text-muted-foreground">
                        {t(item.descriptionKey)}
                      </p>
                    </div>
                  </div>
                  <ExternalLinkIcon
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
                  />
                </a>
              );
            })}
          </div>
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title={t("licenseTitle")}>
        <SettingsCard>
          <a
            href={LICENSE_URL}
            target={EXTERNAL_LINK_TARGET}
            rel={EXTERNAL_LINK_REL}
            className="group flex items-center justify-between gap-4 rounded-xl px-5 py-4 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <div className="flex min-w-0 items-center gap-3">
              <ScaleIcon
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
              />
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="text-sm font-medium">{t("licenseName")}</p>
                <p className="text-sm text-muted-foreground">
                  {t("licenseCopyright")}
                </p>
              </div>
            </div>
            <ExternalLinkIcon
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
            />
          </a>
        </SettingsCard>
      </SettingsSection>
    </PageContainer>
  );
}
