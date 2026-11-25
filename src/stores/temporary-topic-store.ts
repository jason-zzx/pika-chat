import { create } from "zustand";

type TemporaryTopicState = {
  temporaryTopicId: string | null;
  /** Incremented by same-route leave triggers (New topic, home logo, header
   * toggle) so active temporary chats tear down without changing pathname. */
  leaveRequestCount: number;
  setTemporaryTopic: (topicId: string | null) => void;
  /** Atomically clears the active id only when it still matches `topicId`. */
  consumeTemporaryTopic: (topicId: string) => boolean;
  /** Requests immediate teardown of any active temporary chat or draft. */
  requestLeaveTemporaryTopic: () => void;
};

export const useTemporaryTopicStore = create<TemporaryTopicState>(
  (set, get) => ({
    temporaryTopicId: null,
    leaveRequestCount: 0,
    setTemporaryTopic: (temporaryTopicId) => set({ temporaryTopicId }),
    consumeTemporaryTopic: (topicId) => {
      if (get().temporaryTopicId !== topicId) {
        return false;
      }
      set({ temporaryTopicId: null });
      return true;
    },
    requestLeaveTemporaryTopic: () =>
      set((state) => ({ leaveRequestCount: state.leaveRequestCount + 1 })),
  }),
);
