"use client";

import {
  ArrowLeftIcon,
  MoreHorizontalIcon,
  PlusIcon,
  Trash2Icon,
  UserRoundIcon,
} from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import AssistantEditorDialog from "@/components/assistant/AssistantEditorDialog";
import DeleteAssistantDialog from "@/components/assistant/DeleteAssistantDialog";
import {
  useAssistantTree,
  useCreateTopic,
} from "@/components/assistant/use-assistants";
import EmptyState from "@/components/common/EmptyState";
import CloseOnNavigateLink from "@/components/layout/CloseOnNavigateLink";
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
import { apiErrorMessage } from "@/lib/api/error-message";
import type { Assistant } from "@/lib/schemas/assistant";
import type { Topic } from "@/lib/schemas/topic";

export default function AssistantTree() {
  const tree = useAssistantTree();
  const createTopic = useCreateTopic();
  const router = useRouter();
  const params = useParams<{ topicId?: string }>();
  const topicId =
    typeof params.topicId === "string" ? params.topicId : undefined;

  const assistants = tree.data?.assistants ?? [];
  const topicAssistantId = assistants.find((assistant) =>
    assistant.topics.some((topic) => topic.id === topicId),
  )?.id;

  const [pane, setPane] = useState<"list" | string | null>(null);
  const viewingId = pane === "list" ? undefined : (pane ?? topicAssistantId);
  const viewing = assistants.find((assistant) => assistant.id === viewingId);

  const [editor, setEditor] = useState<Assistant | "create" | null>(null);
  const [deleteAssistant, setDeleteAssistant] = useState<Assistant | null>(
    null,
  );
  const [renameTopic, setRenameTopic] = useState<Topic | null>(null);
  const [deleteTopic, setDeleteTopic] = useState<Topic | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);

  const isLastAssistant = assistants.length === 1;

  function leaveIfViewingTopic(ids: string[]) {
    if (topicId && ids.includes(topicId)) {
      router.push("/");
    }
  }

  async function onNewTopic(assistant: Assistant) {
    setTreeError(null);
    try {
      const created = await createTopic.mutateAsync({
        assistantId: assistant.id,
      });
      setPane(assistant.id);
      router.push(`/t/${created.id}`);
    } catch (caught) {
      setTreeError(apiErrorMessage(caught, "Unable to create topic"));
    }
  }

  return (
    <>
      <SidebarHeader>
        {viewing ? (
          <div className="flex items-center gap-1 px-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Back to assistants"
              onClick={() => setPane("list")}
            >
              <ArrowLeftIcon />
            </Button>
            <span aria-hidden="true" className="shrink-0">
              {viewing.icon}
            </span>
            <span className="truncate font-semibold tracking-tight">
              {viewing.name}
            </span>
          </div>
        ) : (
          <div className="flex h-8 items-center px-2">
            <CloseOnNavigateLink href="/">pika-chat</CloseOnNavigateLink>
          </div>
        )}
      </SidebarHeader>
      <SidebarContent>
        {tree.isPending ? (
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
            creating={createTopic.isPending}
            isLastAssistant={isLastAssistant}
            onNewTopic={() => void onNewTopic(viewing)}
            onEdit={() => setEditor(viewing)}
            onDelete={() => setDeleteAssistant(viewing)}
            onRenameTopic={setRenameTopic}
            onDeleteTopic={setDeleteTopic}
          />
        ) : (
          <AssistantList
            assistants={assistants}
            onOpen={(assistant) => setPane(assistant.id)}
            onCreate={() => setEditor("create")}
          />
        )}
        {treeError ? (
          <p className="px-2 pb-2 text-sm text-destructive">{treeError}</p>
        ) : null}
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
          setPane("list");
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
    <SidebarGroup>
      <SidebarGroupLabel>Assistants</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
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
        <div className="pt-1">
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
  creating,
  isLastAssistant,
  onNewTopic,
  onEdit,
  onDelete,
  onRenameTopic,
  onDeleteTopic,
}: {
  assistant: Assistant;
  activeTopicId: string | undefined;
  creating: boolean;
  isLastAssistant: boolean;
  onNewTopic: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRenameTopic: (topic: Topic) => void;
  onDeleteTopic: (topic: Topic) => void;
}) {
  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                disabled={creating}
                onClick={onNewTopic}
              >
                <PlusIcon />
                <span>{creating ? "Creating…" : "New topic"}</span>
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
      <SidebarGroup>
        <SidebarGroupLabel>Topics</SidebarGroupLabel>
        <SidebarGroupContent>
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
                    href={`/t/${topic.id}`}
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
