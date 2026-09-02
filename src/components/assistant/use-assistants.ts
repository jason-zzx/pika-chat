"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createAssistant,
  deleteAssistant,
  listAssistantTree,
  updateAssistant,
} from "@/lib/api/assistant";
import { deleteTopic, renameTopic } from "@/lib/api/topic";
import type {
  CreateAssistantInput,
  UpdateAssistantInput,
} from "@/lib/schemas/assistant";
import type { RenameTopicInput } from "@/lib/schemas/topic";

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

export function useDeleteTopic() {
  const invalidate = useInvalidateAssistantTree();
  return useMutation({
    mutationFn: (id: string) => deleteTopic(id),
    onSuccess: () => {
      void invalidate();
    },
  });
}
