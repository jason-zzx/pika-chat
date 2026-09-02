"use client";

import {
  ArrowLeftIcon,
  MoreHorizontalIcon,
  PlusIcon,
  Trash2Icon,
  UserRoundIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import AssistantEditorDialog from "@/components/assistant/AssistantEditorDialog";
import DeleteAssistantDialog from "@/components/assistant/DeleteAssistantDialog";
import { useAssistantTree } from "@/components/assistant/use-assistants";
import EmptyState from "@/components/common/EmptyState";
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

  function leaveIfViewingTopic(ids: string[]) {
    if (topicId && ids.includes(topicId)) {
      router.push("/");
    }
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
          <div className="flex h-8 min-w-0 items-center overflow-hidden px-2">
            <CloseOnNavigateLink href="/">pika-chat</CloseOnNavigateLink>
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
        onDeleted={(assistant) => {
          leaveIfViewingTopic(assistant.topics.map((topic) => topic.id));
        }}
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
        onDeleted={(id) => {
          leaveIfViewingTopic([id]);
        }}
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
    <SidebarGroup className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <SidebarGroupLabel>Assistants</SidebarGroupLabel>
      <SidebarGroupContent className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <SidebarMenu className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
          {assistants.map((assistant) => (
            <SidebarMenuItem key={assistant.id}>
              <SidebarMenuButton
                onClick={() => onOpen(assistant)}
                aria-label={`Open ${assistant.name}`}
              >
                <span aria-hidden="true">{assistant.icon}</span>
                <span className="truncate">{assistant.name}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
        <div className="shrink-0 pt-1">
          <Button
            type="button"
            variant="ghost"
            className="w-full justify-start"
            onClick={onCreate}
          >
            <PlusIcon aria-hidden="true" />
            New assistant
          </Button>
        </div>
      </SidebarGroupContent>
    </SidebarGroup>
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
  return (
    <>
      <SidebarGroup className="shrink-0">
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Link href={assistantDraftHref(assistant.id)} />}
              >
                <PlusIcon />
                <span>New topic</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={onEdit}>
                <UserRoundIcon />
                <span>Profile</span>
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
      <SidebarGroup className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <SidebarGroupLabel>Topics</SidebarGroupLabel>
        <SidebarGroupContent className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
          {assistant.topics.length === 0 ? (
            <EmptyState
              title="No topics yet"
              description="Start a conversation in this assistant."
            />
          ) : (
            <SidebarMenu>
              {assistant.topics.map((topic) => (
                <SidebarMenuItem key={topic.id}>
                  <SidebarNavLink
                    href={assistantTopicHref(assistant.id, topic.id)}
                    isActive={topic.id === activeTopicId}
                  >
                    <span className="truncate">{topic.title}</span>
                  </SidebarNavLink>
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
                      <DropdownMenuItem onClick={() => onRenameTopic(topic)}>
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => onDeleteTopic(topic)}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          )}
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}
