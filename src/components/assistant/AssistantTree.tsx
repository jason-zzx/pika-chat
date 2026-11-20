"use client";

import {
  ArrowLeftIcon,
  ChevronDownIcon,
  ChevronsUpDownIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PlusIcon,
  StarIcon,
  Trash2Icon,
  UserRoundIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { z } from "zod";

import AssistantEditorDialog from "@/components/assistant/AssistantEditorDialog";
import DeleteAssistantDialog from "@/components/assistant/DeleteAssistantDialog";
import SidebarSearch from "@/components/assistant/SidebarSearch";
import {
  useAssistantTree,
  useFavoriteTopics,
  useSetTopicFavorite,
  useTopicPages,
} from "@/components/assistant/use-assistants";
import EmptyState from "@/components/common/EmptyState";
import PikaMark from "@/components/common/PikaMark";
import CloseOnNavigateLink from "@/components/layout/CloseOnNavigateLink";
import SettingsNav from "@/components/layout/SettingsNav";
import DeleteTopicDialog from "@/components/topic/DeleteTopicDialog";
import RenameTopicDialog from "@/components/topic/RenameTopicDialog";
import { useMinuteClock } from "@/hooks/use-minute-clock";
import { usePikaNative } from "@/hooks/use-pika-native";
import { useStreamingTopics } from "@/lib/streaming-topics";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  assistantDraftHref,
  assistantTopicHref,
  parseAssistantPath,
} from "@/lib/assistant-path";
import type { Assistant } from "@/lib/schemas/assistant";
import type { Topic } from "@/lib/schemas/topic";
import { formatTopicAge } from "@/lib/topic-age";
import { cn } from "@/lib/utils";

type AssistantTreeProps = {
  showUsers: boolean;
  local?: boolean;
};

export default function AssistantTree({
  showUsers,
  local = false,
}: AssistantTreeProps) {
  const tree = useAssistantTree();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("Layout");
  const tRoot = useTranslations("RootLayout");
  const tServer = useTranslations("Layout.desktopServer");
  const native = usePikaNative();
  const { assistantId: pathAssistantId, topicId } = parseAssistantPath(pathname);
  const isSettings = pathname === "/settings" || pathname.startsWith("/settings/");

  const assistants = tree.data?.assistants ?? [];
  const viewingId = pathAssistantId;
  const viewing = assistants.find((assistant) => assistant.id === viewingId);

  const [editor, setEditor] = useState<Assistant | "create" | null>(null);
  const [deleteAssistant, setDeleteAssistant] = useState<Assistant | null>(
    null,
  );
  const [renameTopic, setRenameTopic] = useState<Topic | null>(null);
  const [deleteTopic, setDeleteTopic] = useState<Topic | null>(null);

  const isLastAssistant = assistants.length === 1;

  function leaveIfViewingAssistant(assistant: Assistant) {
    if (pathAssistantId === assistant.id) {
      router.push("/");
    }
  }

  function leaveForNewTopicIfViewing(id: string) {
    if (topicId !== id) {
      return;
    }
    router.push(
      pathAssistantId ? assistantDraftHref(pathAssistantId) : "/",
    );
  }

  return (
    <>
      <SidebarHeader className="overflow-hidden">
        {isSettings ? (
          <PaneHeader
            title={t("settingsNav.label")}
            onBack={() => router.push("/")}
          />
        ) : viewing ? (
          <PaneHeader
            title={viewing.name}
            icon={viewing.icon}
            onBack={() => router.push("/")}
          />
        ) : native ? (
          <SidebarMenuButton
            tooltip={native.serverName}
            aria-label={tServer("switchAria", { name: native.serverName })}
            className="px-2.5 py-0 font-semibold tracking-tight md:px-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-1! [&>svg:first-child]:size-6"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              native.showServerMenu({ x: rect.left, y: rect.bottom });
            }}
          >
            <PikaMark className="size-6" />
            <span className="flex-1 truncate group-data-[collapsible=icon]:sr-only">
              {native.serverName}
            </span>
            <ChevronsUpDownIcon
              className="text-muted-foreground group-data-[collapsible=icon]:hidden"
              aria-hidden="true"
            />
          </SidebarMenuButton>
        ) : (
          <div className="flex h-10 min-w-0 items-center overflow-hidden px-2.5 md:h-8 md:px-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
            <CloseOnNavigateLink href="/">
              <PikaMark className="size-6" />
              <span className="truncate group-data-[collapsible=icon]:sr-only">
                {tRoot("title")}
              </span>
            </CloseOnNavigateLink>
          </div>
        )}
      </SidebarHeader>
      {isSettings ? null : <SidebarSearch />}
      <SidebarContent className="overflow-hidden">
        {isSettings ? (
          <SettingsNav showUsers={showUsers} local={local} />
        ) : tree.isPending ? (
          <SidebarGroup className="group-data-[collapsible=icon]:p-1.5">
            <SidebarGroupContent>
              <LoadingRows showIcon />
            </SidebarGroupContent>
          </SidebarGroup>
        ) : tree.isError ? (
          <EmptyState
            title={t("tree.loadFailedTitle")}
            description={t("tree.loadFailedDescription")}
          />
        ) : viewing ? (
          <AssistantPane
            assistant={viewing}
            activeTopicId={topicId}
            isLastAssistant={isLastAssistant}
            onEdit={() => setEditor(viewing)}
            onDelete={() => setDeleteAssistant(viewing)}
            onRenameTopic={setRenameTopic}
            onDeleteTopic={setDeleteTopic}
          />
        ) : (
          <AssistantList
            assistants={assistants}
            onOpen={(assistant) => router.push(assistantDraftHref(assistant.id))}
            onCreate={() => setEditor("create")}
          />
        )}
      </SidebarContent>
      {editor !== null ? (
        <AssistantEditorDialog
          key={editor === "create" ? "create" : editor.id}
          open
          onOpenChange={(open) => {
            if (!open) {
              setEditor(null);
            }
          }}
          assistant={editor === "create" ? null : editor}
        />
      ) : null}
      <DeleteAssistantDialog
        open={deleteAssistant !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteAssistant(null);
          }
        }}
        assistant={deleteAssistant}
        onDeleted={leaveIfViewingAssistant}
      />
      <RenameTopicDialog
        key={renameTopic?.id ?? "rename-closed"}
        open={renameTopic !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRenameTopic(null);
          }
        }}
        topic={renameTopic}
      />
      <DeleteTopicDialog
        open={deleteTopic !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTopic(null);
          }
        }}
        topic={deleteTopic}
        onDeleted={leaveForNewTopicIfViewing}
      />
    </>
  );
}

function PaneHeader({
  title,
  icon,
  onBack,
}: {
  title: string;
  icon?: string;
  onBack: () => void;
}) {
  const t = useTranslations("Layout");
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5 overflow-hidden px-1 text-base md:gap-1 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:items-center">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="size-9 md:size-7 [&_svg]:size-5 md:[&_svg]:size-4"
        aria-label={t("tree.backToAssistants")}
        onClick={onBack}
      >
        <ArrowLeftIcon />
      </Button>
      {icon ? (
        <span aria-hidden="true" className="shrink-0">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate font-semibold tracking-tight group-data-[collapsible=icon]:sr-only">
        {title}
      </span>
    </div>
  );
}

const LOADING_ROW_WIDTHS = ["w-3/4", "w-3/5", "w-2/3", "w-1/2"] as const;

function LoadingRows({ showIcon = false }: { showIcon?: boolean }) {
  return (
    <SidebarMenu aria-hidden="true">
      {LOADING_ROW_WIDTHS.map((widthClass, index) => (
        <SidebarMenuItem key={index}>
          <div className="flex h-10 items-center justify-between gap-2.5 px-2.5 md:h-8 md:gap-2 md:px-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
            <div className="flex min-w-0 flex-1 items-center gap-2.5 md:gap-2 group-data-[collapsible=icon]:flex-none group-data-[collapsible=icon]:justify-center">
              {showIcon ? (
                <Skeleton className="size-4.5 shrink-0 rounded-sm md:size-4" />
              ) : null}
              <Skeleton
                className={cn(
                  "h-4 rounded-sm group-data-[collapsible=icon]:hidden",
                  widthClass,
                )}
              />
            </div>
            {showIcon ? null : (
              <Skeleton className="h-3 w-7 shrink-0 rounded-sm opacity-60 group-data-[collapsible=icon]:hidden" />
            )}
          </div>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}

function AssistantList({
  assistants,
  onOpen,
  onCreate,
}: {
  assistants: Assistant[];
  onOpen: (assistant: Assistant) => void;
  onCreate: () => void;
}) {
  const t = useTranslations("Layout");
  return (
    <SidebarGroup className="flex min-h-0 flex-1 flex-col overflow-hidden group-data-[collapsible=icon]:p-1.5">
      <SidebarGroupLabel>{t("tree.assistants")}</SidebarGroupLabel>
      <SidebarGroupContent className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <SidebarMenu className="thin-scrollbar min-h-0 min-w-0 flex-1 overflow-x-clip overflow-y-auto">
          {assistants.map((assistant) => (
            <SidebarMenuItem key={assistant.id} className="min-w-0 overflow-hidden">
              <SidebarMenuButton
                onClick={() => onOpen(assistant)}
                aria-label={t("tree.openAssistant", { name: assistant.name })}
              >
                <span aria-hidden="true">{assistant.icon}</span>
                <span className="truncate group-data-[collapsible=icon]:hidden">
                  {assistant.name}
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
        <div className="shrink-0 pt-2 md:pt-1">
          <Button
            type="button"
            variant="ghost"
            className="h-10 w-full justify-start gap-2.5 px-2.5 text-base md:h-8 md:gap-2 md:px-2 md:text-sm [&_svg]:size-4.5 md:[&_svg]:size-4 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
            aria-label={t("tree.newAssistant")}
            onClick={onCreate}
          >
            <PlusIcon aria-hidden="true" />
            <span className="group-data-[collapsible=icon]:hidden">
              {t("tree.newAssistant")}
            </span>
          </Button>
        </div>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/** Collapse state of the Favorite and Topics sections — two peers, each
 * with its own toggle. Global: one state shared by every assistant's pane,
 * persisted in localStorage. Not Zustand — it is view-local chrome, not
 * server state. */
const TOPIC_SECTIONS_KEY = "pika.sidebar.topic-sections";

type TopicSections = { topics: boolean; favorites: boolean };

const topicSectionsSchema = z.object({
  topics: z.boolean().default(true),
  favorites: z.boolean().default(true),
});

const DEFAULT_TOPIC_SECTIONS: TopicSections = {
  topics: true,
  favorites: true,
};

function parseTopicSections(raw: string): TopicSections {
  try {
    return topicSectionsSchema.parse(JSON.parse(raw));
  } catch {
    return DEFAULT_TOPIC_SECTIONS;
  }
}

const sectionListeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedSections: TopicSections = DEFAULT_TOPIC_SECTIONS;

function subscribeTopicSections(listener: () => void): () => void {
  sectionListeners.add(listener);
  return () => {
    sectionListeners.delete(listener);
  };
}

/** Cached by the raw stored string so the snapshot identity is stable. */
function topicSectionsSnapshot(): TopicSections {
  if (typeof window === "undefined") {
    return DEFAULT_TOPIC_SECTIONS;
  }
  const raw = window.localStorage.getItem(TOPIC_SECTIONS_KEY);
  if (raw === cachedRaw) {
    return cachedSections;
  }
  cachedRaw = raw;
  cachedSections =
    raw === null ? DEFAULT_TOPIC_SECTIONS : parseTopicSections(raw);
  return cachedSections;
}

// SSR and the hydration render both come from the default; the persisted
// value is adopted right after hydration, so there is no mismatch.
function topicSectionsServerSnapshot(): TopicSections {
  return DEFAULT_TOPIC_SECTIONS;
}

function setTopicSections(next: TopicSections): void {
  cachedSections = next;
  cachedRaw = JSON.stringify(next);
  try {
    window.localStorage.setItem(TOPIC_SECTIONS_KEY, cachedRaw);
  } catch {
    // Storage can be unavailable (private mode, quota). The toggle still
    // works for this session, so swallowing is the right call here.
  }
  for (const listener of sectionListeners) {
    listener();
  }
}

function collapseContainer(open: boolean): string {
  return cn(
    "grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
    open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
  );
}

function AssistantPane({
  assistant,
  activeTopicId,
  isLastAssistant,
  onEdit,
  onDelete,
  onRenameTopic,
  onDeleteTopic,
}: {
  assistant: Assistant;
  activeTopicId: string | undefined;
  isLastAssistant: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onRenameTopic: (topic: Topic) => void;
  onDeleteTopic: (topic: Topic) => void;
}) {
  const topicsContentId = useId();
  const favoritesContentId = useId();
  const t = useTranslations("Layout");
  const sections = useSyncExternalStore(
    subscribeTopicSections,
    topicSectionsSnapshot,
    topicSectionsServerSnapshot,
  );
  const streamingTopics = useStreamingTopics();

  function toggleSection(key: keyof TopicSections) {
    setTopicSections({ ...sections, [key]: !sections[key] });
  }

  const pages = useTopicPages(assistant.id);
  const favorites = useFavoriteTopics(assistant.id);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const favoriteTopics = favorites.data?.topics ?? [];
  const otherTopics = pages.data?.pages.flatMap((page) => page.topics) ?? [];
  const loadedPages = pages.data?.pages.length ?? 0;
  const fetchNextPage = pages.fetchNextPage;
  const canAutoLoad =
    sections.topics &&
    pages.hasNextPage &&
    !pages.isFetching &&
    !pages.isFetchNextPageError;

  // Recreated after every loaded page: a fresh observe() reports the
  // sentinel's current state, so a page shorter than the viewport keeps loading.
  // Gated on isFetching, not isFetchingNextPage: fetchNextPage cancels an
  // in-flight refetch of the loaded pages (cancelRefetch defaults to true).
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !canAutoLoad) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void fetchNextPage();
        }
      },
      { root: scrollRef.current, rootMargin: "0px 0px 200px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [canAutoLoad, loadedPages, fetchNextPage]);

  return (
    <>
      <SidebarGroup className="shrink-0 group-data-[collapsible=icon]:p-1.5">
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem className="min-w-0 overflow-hidden">
              <SidebarMenuButton
                render={<Link href={assistantDraftHref(assistant.id)} />}
                tooltip={t("tree.newTopic")}
                aria-label={t("tree.newTopic")}
              >
                <PlusIcon />
                <span className="group-data-[collapsible=icon]:hidden">
                  {t("tree.newTopic")}
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem className="min-w-0 overflow-hidden">
              <SidebarMenuButton
                onClick={onEdit}
                tooltip={t("tree.profile")}
                aria-label={t("tree.profile")}
                className="group-hover/menu-item:bg-sidebar-accent group-hover/menu-item:text-sidebar-accent-foreground"
              >
                <UserRoundIcon />
                <span className="group-data-[collapsible=icon]:hidden">
                  {t("tree.profile")}
                </span>
              </SidebarMenuButton>
              <SidebarMenuAction
                showOnHover
                disabled={isLastAssistant}
                className="rounded-full text-sidebar-foreground/60 hover:bg-destructive/15 hover:text-destructive disabled:pointer-events-none disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-sidebar-foreground/60"
                aria-label={t("tree.delete")}
                onClick={onDelete}
              >
                <Trash2Icon />
              </SidebarMenuAction>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      <SidebarGroup className="flex min-h-0 flex-1 flex-col overflow-hidden group-data-[collapsible=icon]:hidden">
        <SidebarGroupContent
          ref={scrollRef}
          className="thin-scrollbar flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-x-clip overflow-y-auto md:gap-1"
        >
          {favoriteTopics.length > 0 ? (
            <div>
              <SectionToggle
                label={t("tree.favoritesSection")}
                open={sections.favorites}
                controls={favoritesContentId}
                onToggle={() => toggleSection("favorites")}
              />
              <div
                id={favoritesContentId}
                className={collapseContainer(sections.favorites)}
                aria-hidden={!sections.favorites}
                inert={!sections.favorites}
              >
                <div className="min-h-0 overflow-hidden">
                  <SidebarMenu>
                    {favoriteTopics.map((topic) => (
                      <TopicRow
                        key={topic.id}
                        topic={topic}
                        assistantId={assistant.id}
                        isActive={topic.id === activeTopicId}
                        streaming={streamingTopics.has(topic.id)}
                        onRename={onRenameTopic}
                        onDelete={onDeleteTopic}
                      />
                    ))}
                  </SidebarMenu>
                </div>
              </div>
            </div>
          ) : null}
          <div>
            <SectionToggle
              label={t("tree.topicsSection")}
              open={sections.topics}
              controls={topicsContentId}
              onToggle={() => toggleSection("topics")}
            />
            <div
              id={topicsContentId}
              className={collapseContainer(sections.topics)}
              aria-hidden={!sections.topics}
              inert={!sections.topics}
            >
              <div className="min-h-0 overflow-hidden">
                {pages.isPending ? (
                  <LoadingRows />
                ) : !pages.data ? (
                  <EmptyState
                    title={t("tree.loadFailedTitle")}
                    description={t("tree.loadFailedDescription")}
                  />
                ) : otherTopics.length === 0 && favorites.data?.topics.length === 0 ? (
                  <EmptyState
                    title={t("tree.noTopicsTitle")}
                    description={t("tree.noTopicsDescription")}
                  />
                ) : (
                  <>
                    <SidebarMenu>
                      {otherTopics.map((topic) => (
                        <TopicRow
                          key={topic.id}
                          topic={topic}
                          assistantId={assistant.id}
                          isActive={topic.id === activeTopicId}
                          streaming={streamingTopics.has(topic.id)}
                          onRename={onRenameTopic}
                          onDelete={onDeleteTopic}
                        />
                      ))}
                    </SidebarMenu>
                    {pages.hasNextPage ? <div ref={sentinelRef} aria-hidden="true" className="h-px" /> : null}
                    {pages.isFetchingNextPage ? (
                      <div className="flex justify-center py-2">
                        <Loader2Icon
                          aria-hidden="true"
                          className="size-4 animate-spin text-muted-foreground"
                        />
                      </div>
                    ) : null}
                    {pages.isFetchNextPageError ? (
                      <div className="flex items-center justify-between gap-2 px-2 py-1 text-xs text-muted-foreground">
                        <span>{t("tree.loadMoreFailed")}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => void fetchNextPage()}
                        >
                          {t("tree.retry")}
                        </Button>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}

/** Section label + collapse chevron, shared by the Favorite and Topics
 * sections so the two peers cannot drift apart in styling. */
function SectionToggle({
  label,
  open,
  controls,
  onToggle,
}: {
  label: string;
  open: boolean;
  controls: string;
  onToggle: () => void;
}) {
  return (
    <SidebarGroupLabel
      className="w-full justify-between group-data-[collapsible=icon]:hidden"
      render={
        <button
          type="button"
          aria-expanded={open}
          aria-controls={controls}
          onClick={onToggle}
        />
      }
    >
      <span>{label}</span>
      <CollapseChevron open={open} />
    </SidebarGroupLabel>
  );
}

function CollapseChevron({ open }: { open: boolean }) {
  return (
    <ChevronDownIcon
      aria-hidden="true"
      className={cn(
        "size-4 shrink-0 transition-transform duration-200 motion-reduce:transition-none",
        open ? "rotate-180" : "rotate-0",
      )}
    />
  );
}

const AGE_DATE_FORMAT = { year: "numeric", month: "2-digit" } as const;
const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_PX = 10;

function TopicAgeLabel({ updatedAt }: { updatedAt: Date }) {
  const t = useTranslations("Layout.tree.age");
  const format = useFormatter();
  const age = formatTopicAge(updatedAt, useMinuteClock());
  return (
    <span
      aria-hidden="true"
      className="shrink-0 text-xs text-muted-foreground tabular-nums"
    >
      {age.unit === "date"
        ? format.dateTime(updatedAt, AGE_DATE_FORMAT)
        : t(age.unit, { n: age.n })}
    </span>
  );
}

function TopicRow({
  topic,
  assistantId,
  isActive,
  streaming,
  onRename,
  onDelete,
}: {
  topic: Topic;
  assistantId: string;
  isActive: boolean;
  streaming?: boolean;
  onRename: (topic: Topic) => void;
  onDelete: (topic: Topic) => void;
}) {
  const setFavorite = useSetTopicFavorite();
  const t = useTranslations("Layout");
  const { setOpenMobile } = useSidebar();
  const [menuOpen, setMenuOpen] = useState(false);
  const [openedByLongPress, setOpenedByLongPress] = useState(false);
  const titleRef = useRef<HTMLSpanElement>(null);
  const touchPress = useRef<{ x: number; y: number; timer: number } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    return () => window.clearTimeout(touchPress.current?.timer);
  }, []);

  function toggleFavorite() {
    setFavorite.mutate({
      id: topic.id,
      assistantId,
      input: { favorite: !topic.isFavorite },
    });
  }

  function endTouchPress() {
    window.clearTimeout(touchPress.current?.timer);
    touchPress.current = null;
  }

  const actionClass =
    "relative top-auto right-auto translate-y-0 rounded-full text-sidebar-foreground/60 transition-colors hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground aria-expanded:bg-sidebar-foreground/10 aria-expanded:text-sidebar-foreground md:w-6";

  return (
    <SidebarMenuItem
      className="min-w-0 overflow-hidden"
      onPointerDown={(event) => {
        if (event.pointerType !== "touch") {
          return;
        }
        suppressClick.current = false;
        endTouchPress();
        touchPress.current = {
          x: event.clientX,
          y: event.clientY,
          timer: window.setTimeout(() => {
            suppressClick.current = true;
            setOpenedByLongPress(true);
            setMenuOpen(true);
          }, LONG_PRESS_MS),
        };
      }}
      onPointerMove={(event) => {
        const press = touchPress.current;
        if (
          press &&
          Math.hypot(event.clientX - press.x, event.clientY - press.y) >
            LONG_PRESS_MOVE_PX
        ) {
          endTouchPress();
        }
      }}
      onPointerUp={endTouchPress}
      onPointerCancel={endTouchPress}
      onClickCapture={(event) => {
        if (suppressClick.current) {
          suppressClick.current = false;
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onContextMenu={(event) => {
        if (touchPress.current) {
          event.preventDefault();
        }
      }}
    >
      <Tooltip
        onOpenChange={(open, details) => {
          const title = titleRef.current;
          if (open && title && title.scrollWidth <= title.clientWidth) {
            details.cancel();
          }
        }}
      >
        <SidebarMenuButton
          render={
            <TooltipTrigger
              delay={500}
              render={
                <Link
                  href={assistantTopicHref(assistantId, topic.id)}
                  aria-current={isActive ? "page" : undefined}
                />
              }
            />
          }
          isActive={isActive}
          // The overlay actions take no width, so drop the menu-action
          // right padding; the row keeps its hover look while the pointer
          // is on the overlay or its menu is open.
          className="group-has-data-[sidebar=menu-action]/menu-item:pr-2.5 group-hover/menu-item:bg-sidebar-accent group-hover/menu-item:text-sidebar-accent-foreground group-has-aria-expanded/menu-item:bg-sidebar-accent group-has-aria-expanded/menu-item:text-sidebar-accent-foreground md:group-has-data-[sidebar=menu-action]/menu-item:pr-2 [@media(hover:none)]:[-webkit-touch-callout:none] [@media(hover:none)]:select-none"
          onClick={() => setOpenMobile(false)}
        >
          <span ref={titleRef} className="flex-1 truncate">
            {topic.title}
          </span>
          {streaming ? (
            // A background stream (send or regenerate) is still writing to
            // this topic; decorative — the row link itself stays the action.
            <Loader2Icon
              aria-hidden="true"
              className="size-4 shrink-0 animate-spin text-muted-foreground md:size-3.5"
            />
          ) : (
            <TopicAgeLabel updatedAt={topic.updatedAt} />
          )}
        </SidebarMenuButton>
        {/* Popover tokens (same surface as the row menu) instead of the
            primitive's inverted foreground bubble; [&>div] is the arrow. */}
        <TooltipContent
          side="right"
          sideOffset={8}
          className="max-w-72 rounded-lg bg-popover px-2.5 py-1.5 text-xs leading-relaxed text-popover-foreground shadow-md ring-1 ring-foreground/10 wrap-break-word [&>div]:hidden"
        >
          {topic.title}
        </TooltipContent>
      </Tooltip>
      {/* Overlay: takes no layout width, so the title never reflows on hover. */}
      <div className="absolute inset-y-0 right-0 flex items-center gap-0.5 rounded-r-md bg-sidebar-accent pr-1 opacity-0 before:pointer-events-none before:absolute before:inset-y-0 before:right-full before:w-6 before:bg-linear-to-l before:from-sidebar-accent before:to-transparent group-has-focus-visible/menu-item:opacity-100 group-hover/menu-item:opacity-100 has-aria-expanded:opacity-100 group-data-[collapsible=icon]:hidden [@media(hover:none)]:invisible">
        <SidebarMenuAction
          className={actionClass}
          aria-label={
            topic.isFavorite
              ? t("tree.unfavoriteNamed", { title: topic.title })
              : t("tree.favoriteNamed", { title: topic.title })
          }
          onClick={toggleFavorite}
        >
          <StarIcon
            aria-hidden="true"
            className={cn(topic.isFavorite && "fill-current")}
          />
        </SidebarMenuAction>
        <DropdownMenu
          open={menuOpen}
          onOpenChange={setMenuOpen}
          // Drop the long-press header only once the exit animation is
          // done; dropping it on close shrinks the menu mid-animation.
          onOpenChangeComplete={(open) => {
            if (!open) {
              setOpenedByLongPress(false);
            }
          }}
        >
          <DropdownMenuTrigger
            render={
              <SidebarMenuAction
                className={actionClass}
                aria-label={t("tree.actionsFor", { title: topic.title })}
              />
            }
          >
            <MoreHorizontalIcon aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="right">
            {openedByLongPress ? (
              <>
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="line-clamp-3 max-w-64 break-words">
                    {topic.title}
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
              </>
            ) : null}
            <DropdownMenuItem onClick={toggleFavorite}>
              <StarIcon
                aria-hidden="true"
                className={cn(topic.isFavorite && "fill-current")}
              />
              {topic.isFavorite ? t("tree.unfavorite") : t("tree.favorite")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onRename(topic)}>
              {t("tree.rename")}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={() => onDelete(topic)}
            >
              {t("tree.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </SidebarMenuItem>
  );
}
