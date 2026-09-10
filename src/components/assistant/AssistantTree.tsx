"use client";

import {
  ArrowLeftIcon,
  ChevronDownIcon,
  MoreHorizontalIcon,
  PlusIcon,
  StarIcon,
  Trash2Icon,
  UserRoundIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useId, useState, useSyncExternalStore } from "react";
import { z } from "zod";

import AssistantEditorDialog from "@/components/assistant/AssistantEditorDialog";
import DeleteAssistantDialog from "@/components/assistant/DeleteAssistantDialog";
import { useAssistantTree, useSetTopicFavorite } from "@/components/assistant/use-assistants";
import EmptyState from "@/components/common/EmptyState";
import PikaMark from "@/components/common/PikaMark";
import CloseOnNavigateLink from "@/components/layout/CloseOnNavigateLink";
import SettingsNav from "@/components/layout/SettingsNav";
import SidebarNavLink from "@/components/layout/SidebarNavLink";
import DeleteTopicDialog from "@/components/topic/DeleteTopicDialog";
import RenameTopicDialog from "@/components/topic/RenameTopicDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  assistantDraftHref,
  assistantTopicHref,
  parseAssistantPath,
} from "@/lib/assistant-path";
import type { Assistant } from "@/lib/schemas/assistant";
import type { Topic } from "@/lib/schemas/topic";
import { cn } from "@/lib/utils";

type AssistantTreeProps = {
  showUsers: boolean;
};

export default function AssistantTree({ showUsers }: AssistantTreeProps) {
  const tree = useAssistantTree();
  const router = useRouter();
  const pathname = usePathname();
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
    if (topicId && assistant.topics.some((topic) => topic.id === topicId)) {
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
          <PaneHeader title="Settings" onBack={() => router.push("/")} />
        ) : viewing ? (
          <PaneHeader
            title={viewing.name}
            icon={viewing.icon}
            onBack={() => router.push("/")}
          />
        ) : (
          <div className="flex h-8 min-w-0 items-center overflow-hidden px-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
            <CloseOnNavigateLink href="/">
              <PikaMark className="size-6" />
              <span className="truncate group-data-[collapsible=icon]:sr-only">
                Pika chat
              </span>
            </CloseOnNavigateLink>
          </div>
        )}
      </SidebarHeader>
      <SidebarContent className="overflow-hidden">
        {isSettings ? (
          <SettingsNav showUsers={showUsers} />
        ) : tree.isPending ? (
          <LoadingRows />
        ) : tree.isError ? (
          <EmptyState
            title="Unable to load assistants"
            description="Refresh the page to try again."
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
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1 overflow-hidden px-1 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:items-center">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Back to assistants"
        onClick={onBack}
      >
        <ArrowLeftIcon />
      </Button>
      {icon ? (
        <span aria-hidden="true" className="shrink-0">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 truncate font-semibold tracking-tight group-data-[collapsible=icon]:sr-only">
        {title}
      </span>
    </div>
  );
}

function LoadingRows() {
  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <div className="flex flex-col gap-2 px-2 py-1">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-4/5" />
          <Skeleton className="h-8 w-3/5" />
        </div>
      </SidebarGroupContent>
    </SidebarGroup>
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
  return (
    <SidebarGroup className="flex min-h-0 flex-1 flex-col overflow-hidden group-data-[collapsible=icon]:p-1.5">
      <SidebarGroupLabel>Assistants</SidebarGroupLabel>
      <SidebarGroupContent className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <SidebarMenu className="thin-scrollbar min-h-0 min-w-0 flex-1 overflow-x-clip overflow-y-auto">
          {assistants.map((assistant) => (
            <SidebarMenuItem key={assistant.id} className="min-w-0 overflow-hidden">
              <SidebarMenuButton
                onClick={() => onOpen(assistant)}
                aria-label={`Open ${assistant.name}`}
              >
                <span aria-hidden="true">{assistant.icon}</span>
                <span className="truncate group-data-[collapsible=icon]:hidden">
                  {assistant.name}
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
        <div className="shrink-0 pt-1">
          <Button
            type="button"
            variant="ghost"
            className="w-full justify-start group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
            aria-label="New assistant"
            onClick={onCreate}
          >
            <PlusIcon aria-hidden="true" />
            <span className="group-data-[collapsible=icon]:hidden">New assistant</span>
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
  const sections = useSyncExternalStore(
    subscribeTopicSections,
    topicSectionsSnapshot,
    topicSectionsServerSnapshot,
  );

  function toggleSection(key: keyof TopicSections) {
    setTopicSections({ ...sections, [key]: !sections[key] });
  }

  // Both lists keep the server's `updatedAt` desc order; favorites are only
  // lifted into their own subsection, never duplicated.
  const favoriteTopics = assistant.topics.filter((topic) => topic.isFavorite);
  const otherTopics = assistant.topics.filter((topic) => !topic.isFavorite);

  return (
    <>
      <SidebarGroup className="shrink-0 group-data-[collapsible=icon]:p-1.5">
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem className="min-w-0 overflow-hidden">
              <SidebarMenuButton
                render={<Link href={assistantDraftHref(assistant.id)} />}
                aria-label="New topic"
              >
                <PlusIcon />
                <span className="group-data-[collapsible=icon]:hidden">New topic</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem className="min-w-0 overflow-hidden">
              <SidebarMenuButton onClick={onEdit} aria-label="Profile">
                <UserRoundIcon />
                <span className="group-data-[collapsible=icon]:hidden">Profile</span>
              </SidebarMenuButton>
              <SidebarMenuAction
                showOnHover
                disabled={isLastAssistant}
                aria-label="Delete"
                onClick={onDelete}
              >
                <Trash2Icon />
              </SidebarMenuAction>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      <SidebarGroup className="flex min-h-0 flex-1 flex-col overflow-hidden group-data-[collapsible=icon]:p-1.5">
        <SidebarGroupContent className="thin-scrollbar min-h-0 min-w-0 flex-1 overflow-x-clip overflow-y-auto">
          {favoriteTopics.length > 0 ? (
            <div>
              <SectionToggle
                label="Favorite"
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
              label="Topics"
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
                {assistant.topics.length === 0 ? (
                  <EmptyState
                    title="No topics yet"
                    description="Start a conversation in this assistant."
                  />
                ) : otherTopics.length > 0 ? (
                  <SidebarMenu>
                    {otherTopics.map((topic) => (
                      <TopicRow
                        key={topic.id}
                        topic={topic}
                        assistantId={assistant.id}
                        isActive={topic.id === activeTopicId}
                        onRename={onRenameTopic}
                        onDelete={onDeleteTopic}
                      />
                    ))}
                  </SidebarMenu>
                ) : null}
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

function TopicRow({
  topic,
  assistantId,
  isActive,
  onRename,
  onDelete,
}: {
  topic: Topic;
  assistantId: string;
  isActive: boolean;
  onRename: (topic: Topic) => void;
  onDelete: (topic: Topic) => void;
}) {
  const setFavorite = useSetTopicFavorite();

  function toggleFavorite() {
    setFavorite.mutate({
      id: topic.id,
      input: { favorite: !topic.isFavorite },
    });
  }

  return (
    <SidebarMenuItem className="min-w-0 overflow-hidden">
      <SidebarNavLink
        href={assistantTopicHref(assistantId, topic.id)}
        isActive={isActive}
      >
        <span className="truncate">{topic.title}</span>
        {/* Reserves room for the star action next to the "..." trigger. */}
        <span aria-hidden="true" className="w-6 shrink-0" />
      </SidebarNavLink>
      <SidebarMenuAction
        className="right-7"
        showOnHover={!topic.isFavorite}
        aria-label={`${topic.isFavorite ? "Unfavorite" : "Favorite"} ${topic.title}`}
        onClick={toggleFavorite}
      >
        <StarIcon
          aria-hidden="true"
          className={cn(topic.isFavorite && "fill-current")}
        />
      </SidebarMenuAction>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <SidebarMenuAction
              showOnHover
              aria-label={`Actions for ${topic.title}`}
            />
          }
        >
          <MoreHorizontalIcon aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="right">
          <DropdownMenuItem onClick={toggleFavorite}>
            <StarIcon
              aria-hidden="true"
              className={cn(topic.isFavorite && "fill-current")}
            />
            {topic.isFavorite ? "Unfavorite" : "Favorite"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onRename(topic)}>
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() => onDelete(topic)}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}
