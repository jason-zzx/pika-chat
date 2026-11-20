"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";

import { topicKeys } from "@/components/chat/use-chat-history";

import {
  createAssistant,
  deleteAssistant,
  listAssistantTree,
  updateAssistant,
} from "@/lib/api/assistant";
import {
  deleteTopic,
  listFavoriteTopics,
  listTopicPage,
  renameTopic,
  setTopicFavorite,
} from "@/lib/api/topic";
import type {
  AssistantTree,
  CreateAssistantInput,
  UpdateAssistantInput,
} from "@/lib/schemas/assistant";
import type {
  FavoriteTopics,
  RenameTopicInput,
  SetTopicFavoriteInput,
  TopicPage,
} from "@/lib/schemas/topic";

export const assistantKeys = {
  all: ["assistants"] as const,
  tree: () => [...assistantKeys.all, "tree"] as const,
  topics: (assistantId: string) =>
    [...assistantKeys.all, "topics", assistantId] as const,
  topicPages: (assistantId: string) =>
    [...assistantKeys.topics(assistantId), "pages"] as const,
  favoriteTopics: (assistantId: string) =>
    [...assistantKeys.topics(assistantId), "favorites"] as const,
};

type TopicPages = InfiniteData<TopicPage, string | null>;

export function useTopicPages(assistantId: string) {
  return useInfiniteQuery({
    queryKey: assistantKeys.topicPages(assistantId),
    queryFn: ({ pageParam }) => listTopicPage(assistantId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useFavoriteTopics(assistantId: string) {
  return useQuery({
    queryKey: assistantKeys.favoriteTopics(assistantId),
    queryFn: () => listFavoriteTopics(assistantId),
  });
}

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
  const queryClient = useQueryClient();
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
      void queryClient.invalidateQueries({ queryKey: topicKeys.all });
    },
  });
}

export function useSetTopicFavorite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      assistantId: string;
      input: SetTopicFavoriteInput;
    }) => setTopicFavorite(id, input),
    onMutate: async (variables) => {
      const pagesKey = assistantKeys.topicPages(variables.assistantId);
      const favoritesKey = assistantKeys.favoriteTopics(variables.assistantId);
      await queryClient.cancelQueries({ queryKey: pagesKey });
      await queryClient.cancelQueries({ queryKey: favoritesKey });
      const previousPages = queryClient.getQueryData<TopicPages>(pagesKey);
      const previousFavorites =
        queryClient.getQueryData<FavoriteTopics>(favoritesKey);
      const topic = [
        ...(previousPages?.pages.flatMap((page) => page.topics) ?? []),
        ...(previousFavorites?.topics ?? []),
      ].find((candidate) => candidate.id === variables.id);
      if (!topic) {
        return { previousPages, previousFavorites };
      }
      const moved = { ...topic, isFavorite: variables.input.favorite };
      const byRecency = (a: { updatedAt: Date }, b: { updatedAt: Date }) =>
        b.updatedAt.getTime() - a.updatedAt.getTime();

      queryClient.setQueryData<TopicPages>(pagesKey, (data) => {
        if (!data) {
          return data;
        }
        const pages = data.pages.map((page) => ({
          ...page,
          topics: page.topics.filter((candidate) => candidate.id !== moved.id),
        }));
        if (moved.isFavorite) {
          return { ...data, pages };
        }
        // Older than everything loaded while more pages exist: a later page
        // returns it, so it is not inserted here.
        const target = pages.findIndex((page) => {
          const last = page.topics.at(-1);
          return (
            page.nextCursor === null ||
            (last !== undefined &&
              moved.updatedAt.getTime() >= last.updatedAt.getTime())
          );
        });
        return {
          ...data,
          pages: pages.map((page, index) =>
            index === target
              ? { ...page, topics: [...page.topics, moved].sort(byRecency) }
              : page,
          ),
        };
      });
      queryClient.setQueryData<FavoriteTopics>(favoritesKey, (data) => {
        if (!data) {
          return data;
        }
        const rest = data.topics.filter((candidate) => candidate.id !== moved.id);
        return {
          topics: moved.isFavorite ? [...rest, moved].sort(byRecency) : rest,
        };
      });
      return { previousPages, previousFavorites };
    },
    onError: (_error, variables, context) => {
      if (!context) {
        return;
      }
      const favoritesKey = assistantKeys.favoriteTopics(variables.assistantId);
      const isFavoriteNow = queryClient
        .getQueryData<FavoriteTopics>(favoritesKey)
        ?.topics.some((topic) => topic.id === variables.id);
      // Only roll back while the optimistic value is still the one we wrote;
      // a newer mutation has since won and rolling back would undo it.
      if (isFavoriteNow !== variables.input.favorite) {
        return;
      }
      queryClient.setQueryData(
        assistantKeys.topicPages(variables.assistantId),
        context.previousPages,
      );
      queryClient.setQueryData(favoritesKey, context.previousFavorites);
    },
    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({
        queryKey: assistantKeys.topics(variables.assistantId),
      });
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
