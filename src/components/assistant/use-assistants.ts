"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createAssistant,
  deleteAssistant,
  listAssistantTree,
  updateAssistant,
} from "@/lib/api/assistant";
import {
  deleteTopic,
  renameTopic,
  setTopicFavorite,
} from "@/lib/api/topic";
import type {
  AssistantTree,
  CreateAssistantInput,
  UpdateAssistantInput,
} from "@/lib/schemas/assistant";
import type {
  RenameTopicInput,
  SetTopicFavoriteInput,
} from "@/lib/schemas/topic";

export const assistantKeys = {
  all: ["assistants"] as const,
  tree: () => [...assistantKeys.all, "tree"] as const,
};

export function useAssistantTree() {
  return useQuery({
    queryKey: assistantKeys.tree(),
    queryFn: listAssistantTree,
  });
}

function useInvalidateAssistantTree() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: assistantKeys.all });
}

export function useCreateAssistant() {
  const invalidate = useInvalidateAssistantTree();
  return useMutation({
    mutationFn: (input: CreateAssistantInput) => createAssistant(input),
    onSuccess: () => {
      void invalidate();
    },
  });
}

export function useUpdateAssistant() {
  const invalidate = useInvalidateAssistantTree();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: UpdateAssistantInput;
    }) => updateAssistant(id, input),
    onSuccess: () => {
      void invalidate();
    },
  });
}

export function useSetAssistantDefaultModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      defaultProviderConfigId,
      defaultModelId,
    }: {
      id: string;
      defaultProviderConfigId: string;
      defaultModelId: string;
    }) =>
      updateAssistant(id, {
        defaultProviderConfigId,
        defaultModelId,
      }),
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: assistantKeys.tree() });
      const previous = queryClient.getQueryData<AssistantTree>(
        assistantKeys.tree(),
      );
      if (previous) {
        queryClient.setQueryData<AssistantTree>(assistantKeys.tree(), {
          ...previous,
          assistants: previous.assistants.map((assistant) =>
            assistant.id === variables.id
              ? {
                  ...assistant,
                  defaultProviderConfigId: variables.defaultProviderConfigId,
                  defaultModelId: variables.defaultModelId,
                }
              : assistant,
          ),
        });
      }
      return { previous };
    },
    onError: (_error, variables, context) => {
      if (!context?.previous) {
        return;
      }
      const current = queryClient.getQueryData<AssistantTree>(
        assistantKeys.tree(),
      );
      const currentAssistant = current?.assistants.find(
        (assistant) => assistant.id === variables.id,
      );
      const stillThisMutation =
        currentAssistant?.defaultProviderConfigId ===
          variables.defaultProviderConfigId &&
        currentAssistant?.defaultModelId === variables.defaultModelId;
      if (!stillThisMutation) {
        return;
      }
      queryClient.setQueryData(assistantKeys.tree(), context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: assistantKeys.all });
    },
  });
}

export function useDeleteAssistant() {
  const invalidate = useInvalidateAssistantTree();
  return useMutation({
    mutationFn: (id: string) => deleteAssistant(id),
    onSuccess: () => {
      void invalidate();
    },
  });
}

export function useRenameTopic() {
  const invalidate = useInvalidateAssistantTree();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: RenameTopicInput;
    }) => renameTopic(id, input),
    onSuccess: () => {
      void invalidate();
    },
  });
}

export function useSetTopicFavorite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: SetTopicFavoriteInput }) =>
      setTopicFavorite(id, input),
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: assistantKeys.tree() });
      const previous = queryClient.getQueryData<AssistantTree>(
        assistantKeys.tree(),
      );
      if (previous) {
        queryClient.setQueryData<AssistantTree>(assistantKeys.tree(), {
          ...previous,
          assistants: previous.assistants.map((assistant) => ({
            ...assistant,
            topics: assistant.topics.map((topic) =>
              topic.id === variables.id
                ? { ...topic, isFavorite: variables.input.favorite }
                : topic,
            ),
          })),
        });
      }
      return { previous };
    },
    onError: (_error, variables, context) => {
      if (!context?.previous) {
        return;
      }
      const current = queryClient.getQueryData<AssistantTree>(
        assistantKeys.tree(),
      );
      const currentTopic = current?.assistants
        .flatMap((assistant) => assistant.topics)
        .find((topic) => topic.id === variables.id);
      // Only roll back while the optimistic value is still the one we wrote;
      // a newer mutation has since won and rolling back would undo it.
      if (currentTopic?.isFavorite !== variables.input.favorite) {
        return;
      }
      queryClient.setQueryData(assistantKeys.tree(), context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: assistantKeys.all });
    },
  });
}

export function useDeleteTopic() {
  const invalidate = useInvalidateAssistantTree();
  return useMutation({
    mutationFn: (id: string) => deleteTopic(id),
    onSuccess: () => {
      void invalidate();
    },
  });
}
