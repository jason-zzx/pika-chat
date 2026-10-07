"use client";

import { SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  useDebouncedValue,
  useSearch,
} from "@/components/assistant/use-search";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useSidebar } from "@/components/ui/sidebar";
import { assistantTopicHref } from "@/lib/assistant-path";
import {
  type MessageHit,
  TITLE_HEAD,
  TITLE_TOTAL,
  type TopicHit,
  windowAroundMatch,
} from "@/lib/schemas/search";
import { writeHitQueue } from "@/lib/search-hit-queue";
import { cn } from "@/lib/utils";
import { useSearchDialogStore } from "@/stores/search-dialog-store";

/** Flat keyboard-navigation sequence: the topic group first, messages after. */
type FlatResult =
  | { kind: "topic"; topic: TopicHit }
  | { kind: "message"; message: MessageHit };

// Wire tokens, not copy — hoisted per the i18n guard's convention.
const RESULTS_ID = "search-palette-results";
const KIND_TOPIC = "topic";
const KIND_MESSAGE = "message";

/** Command-palette search modal, mounted globally in AppShell. Opened from
 * the sidebar entry box or Ctrl/Cmd+K anywhere; selecting a result navigates
 * (a message hit also stashes the same-topic hit queue for in-topic
 * navigation). The data layer is the same debounced `useSearch` the inline
 * sidebar search used. */
export default function SearchDialog() {
  const t = useTranslations("Search.palette");
  const tSidebar = useTranslations("Search.sidebar");
  const open = useSearchDialogStore((state) => state.open);
  const setOpen = useSearchDialogStore((state) => state.setOpen);
  const router = useRouter();
  const { setOpenMobile } = useSidebar();
  const inputRef = useRef<HTMLInputElement>(null);
  const activeItemRef = useRef<HTMLButtonElement | null>(null);

  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const debounced = useDebouncedValue(trimmed, 300);
  const search = useSearch(debounced);
  const [activeIndex, setActiveIndex] = useState(0);

  // Ctrl/Cmd+K opens the palette from anywhere; when it is already open the
  // shortcut just refocuses the input. Same window-keydown pattern as the
  // sidebar's Ctrl/Cmd+B.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        if (useSearchDialogStore.getState().open) {
          inputRef.current?.focus();
        } else {
          setOpen(true);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setOpen]);

  const topics = search.data?.topics ?? [];
  const messages = search.data?.messages ?? [];
  const results: FlatResult[] = [
    ...topics.map((topic): FlatResult => ({ kind: "topic", topic })),
    ...messages.map((message): FlatResult => ({ kind: "message", message })),
  ];

  // A new result set restarts keyboard navigation at the first row.
  const [prevDebounced, setPrevDebounced] = useState(debounced);
  if (prevDebounced !== debounced) {
    setPrevDebounced(debounced);
    setActiveIndex(0);
  }
  const clampedIndex = Math.min(activeIndex, Math.max(0, results.length - 1));
  // The exact condition under which the result LIST is rendered below
  // (searching/empty states replace it). Keyboard selection is gated on
  // this so Enter can never pick an invisible stale result (keepPreviousData
  // keeps the previous query's data alive during the debounce window).
  const listReady =
    trimmed.length > 0 && debounced === trimmed && !search.isPending;

  // Keep the keyboard-active row in view while arrowing through the list.
  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [clampedIndex]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setQuery("");
      setActiveIndex(0);
    }
  }

  function selectResult(result: FlatResult) {
    handleOpenChange(false);
    setOpenMobile(false);
    if (result.kind === "topic") {
      router.push(
        assistantTopicHref(result.topic.assistantId, result.topic.id),
      );
      return;
    }
    const { message } = result;
    // Same-topic hits ride along so the chat view can offer prev/next
    // navigation; a single hit needs no queue. API order is createdAt desc
    // — reversed to reading order (oldest first): the newest message sits
    // at the page bottom, so desc would make "prev" jump DOWN the page.
    const hits = messages
      .filter((hit) => hit.topicId === message.topicId)
      .map((hit) => hit.groupId)
      .reverse();
    if (hits.length >= 2) {
      writeHitQueue({
        topicId: message.topicId,
        hits,
        current: message.groupId,
      });
    }
    router.push(messageHitHref(message));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!listReady) {
      // No visible list: leave arrows as cursor movement and Enter inert.
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      const result = results[clampedIndex];
      if (result) {
        event.preventDefault();
        selectResult(result);
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="top-[15%] -translate-y-0 gap-2 sm:max-w-lg"
        showCloseButton={false}
        // The sidebar entry opens this dialog ON FOCUS. Base UI's default
        // focus return would put focus right back on that entry on close,
        // instantly reopening the dialog — the visible symptom was
        // overlay-click/Esc/result-select all failing to close. Never
        // return focus here; the entries are reachable again by Tab.
        finalFocus={false}
      >
        <DialogTitle className="sr-only">{t("openSearch")}</DialogTitle>
        <div className="relative">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={inputRef}
            role="combobox"
            // Expanded whenever the result region (searching / empty /
            // results) is shown, not only when hits exist — tying it to
            // results.length flickers it false on every fetch.
            aria-expanded={query.trim().length > 0}
            aria-controls={RESULTS_ID}
            aria-activedescendant={
              results.length > 0
                ? `search-palette-result-${clampedIndex}`
                : undefined
            }
            value={query}
            placeholder={tSidebar("placeholder")}
            aria-label={tSidebar("placeholder")}
            className="pl-8"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        {trimmed.length > 0 ? (
          <div className="thin-scrollbar max-h-[50vh] min-h-0 overflow-y-auto">
            {debounced !== trimmed || search.isPending ? (
              <p className="px-2 py-1 text-sm text-muted-foreground">
                {tSidebar("searching")}
              </p>
            ) : results.length === 0 ? (
              <p className="px-2 py-1 text-sm text-muted-foreground">
                {tSidebar("noResults", { query: trimmed })}
              </p>
            ) : (
              <ul role="listbox" id={RESULTS_ID}>
                {topics.length > 0 ? (
                  <li
                    aria-hidden="true"
                    className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground"
                  >
                    {tSidebar("topicsGroup")}
                  </li>
                ) : null}
                {topics.map((topic, index) => (
                  <ResultItem
                    key={topic.id}
                    index={index}
                    activeIndex={clampedIndex}
                    activeRef={activeItemRef}
                    onSelect={() => selectResult({ kind: KIND_TOPIC, topic })}
                  >
                    <span className="w-full truncate text-sm">
                      <HighlightedTitle title={topic.title} query={trimmed} />
                    </span>
                  </ResultItem>
                ))}
                {messages.length > 0 ? (
                  <li
                    aria-hidden="true"
                    className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground"
                  >
                    {tSidebar("messagesGroup")}
                  </li>
                ) : null}
                {messages.map((hit, index) => (
                  <ResultItem
                    key={hit.messageId}
                    index={topics.length + index}
                    activeIndex={clampedIndex}
                    activeRef={activeItemRef}
                    onSelect={() => selectResult({ kind: KIND_MESSAGE, message: hit })}
                  >
                    <span className="w-full truncate text-xs text-muted-foreground">
                      {hit.topicTitle}
                    </span>
                    <span className="line-clamp-2 w-full whitespace-normal text-sm">
                      <HighlightedText text={hit.snippet} query={trimmed} />
                    </span>
                  </ResultItem>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ResultItem({
  index,
  activeIndex,
  activeRef,
  onSelect,
  children,
}: {
  index: number;
  activeIndex: number;
  activeRef: RefObject<HTMLButtonElement | null>;
  onSelect: () => void;
  children: ReactNode;
}) {
  const active = index === activeIndex;
  return (
    <li
      role="option"
      id={`search-palette-result-${index}`}
      aria-selected={active}
    >
      <button
        type="button"
        ref={active ? activeRef : undefined}
        className={cn(
          "flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left",
          active && "bg-accent",
        )}
        onClick={onSelect}
      >
        {children}
      </button>
    </li>
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
