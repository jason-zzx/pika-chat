"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import {
  useDebouncedValue,
  useSearch,
} from "@/components/assistant/use-search";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { assistantTopicHref } from "@/lib/assistant-path";
import {
  type MessageHit,
  TITLE_HEAD,
  TITLE_TOTAL,
  windowAroundMatch,
} from "@/lib/schemas/search";

type SearchResultsProps = {
  /** Already-trimmed, non-empty query. */
  query: string;
  /** Result click: the parent clears the query so the tree comes back. */
  onNavigate: () => void;
};

/** Result list that replaces the assistant tree while a search is active.
 * The fetch is debounced; the pane itself swaps in on the raw query so the
 * box feels immediate. */
export default function SearchResults({
  query,
  onNavigate,
}: SearchResultsProps) {
  const t = useTranslations("Search.sidebar");
  const debounced = useDebouncedValue(query, 300);
  const search = useSearch(debounced);
  const { setOpenMobile } = useSidebar();

  function handleNavigate() {
    setOpenMobile(false);
    onNavigate();
  }

  const topics = search.data?.topics ?? [];
  const messages = search.data?.messages ?? [];

  return (
    <SidebarGroup className="flex min-h-0 flex-1 flex-col overflow-hidden group-data-[collapsible=icon]:p-1.5">
      <SidebarGroupContent className="thin-scrollbar min-h-0 min-w-0 flex-1 overflow-x-clip overflow-y-auto">
        {debounced !== query || search.isPending ? (
          <p className="px-2 py-1 text-sm text-muted-foreground">
            {t("searching")}
          </p>
        ) : topics.length === 0 && messages.length === 0 ? (
          <p className="px-2 py-1 text-sm text-muted-foreground">
            {t("noResults", { query })}
          </p>
        ) : (
          <>
            {topics.length > 0 ? (
              <div>
                <SidebarGroupLabel>{t("topicsGroup")}</SidebarGroupLabel>
                <SidebarMenu>
                  {topics.map((topic) => (
                    <SidebarMenuItem
                      key={topic.id}
                      className="min-w-0 overflow-hidden"
                    >
                      <SidebarMenuButton
                        render={
                          <Link
                            href={assistantTopicHref(
                              topic.assistantId,
                              topic.id,
                            )}
                          />
                        }
                        onClick={handleNavigate}
                      >
                        <span className="truncate">
                          <HighlightedTitle title={topic.title} query={query} />
                        </span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </div>
            ) : null}
            {messages.length > 0 ? (
              <div>
                <SidebarGroupLabel>{t("messagesGroup")}</SidebarGroupLabel>
                <SidebarMenu>
                  {messages.map((hit) => (
                    <SidebarMenuItem
                      key={hit.messageId}
                      className="min-w-0 overflow-hidden"
                    >
                      <SidebarMenuButton
                        render={<Link href={messageHitHref(hit)} />}
                        onClick={handleNavigate}
                        className="h-auto flex-col items-start gap-0.5 py-1.5"
                      >
                        <span className="w-full truncate text-xs text-muted-foreground">
                          {hit.topicTitle}
                        </span>
                        <span className="line-clamp-2 w-full whitespace-normal text-sm">
                          <HighlightedText text={hit.snippet} query={query} />
                        </span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </div>
            ) : null}
          </>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function messageHitHref(hit: MessageHit): string {
  const base = assistantTopicHref(hit.assistantId, hit.topicId);
  return `${base}?m=${encodeURIComponent(hit.groupId)}`;
}

/** Wraps the first case-insensitive occurrence of the query in `<mark>` by
 * splitting the string — never dangerouslySetInnerHTML. */
function HighlightedText({ text, query }: { text: string; query: string }) {
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) {
    return text;
  }
  return (
    <>
      {text.slice(0, index)}
      <mark className="bg-transparent font-semibold text-primary underline decoration-primary/40 decoration-2 underline-offset-2">
        {text.slice(index, index + query.length)}
      </mark>
      {text.slice(index + query.length)}
    </>
  );
}

function HighlightedTitle({ title, query }: { title: string; query: string }) {
  return (
    <HighlightedText
      text={windowAroundMatch(title, query, { head: TITLE_HEAD, total: TITLE_TOTAL })}
      query={query}
    />
  );
}
