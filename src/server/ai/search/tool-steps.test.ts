import { streamText, tool } from "ai";
import {
  convertArrayToReadableStream,
  MockLanguageModelV3,
} from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { stripToolCallMarkupTransform } from "./markup-sanitizer";
import {
  CITATION_DIRECTIVE,
  FORCED_STEP_DIRECTIVE,
  TOOL_TURN_STEP_LIMIT,
  toolTurnStepSettings,
  withCitationDirective,
} from "./tool";

const USAGE = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

/**
 * A model that calls searchWeb on every step unless toolChoice forbids it —
 * the failure mode that left turns dangling on tool results when the step
 * budget ran out before an answer step.
 */
function alwaysSearchesModel() {
  return new MockLanguageModelV3({
    doStream: async (options) => {
      const toolsForbidden =
        typeof options.toolChoice === "object" &&
        options.toolChoice.type === "none";
      if (toolsForbidden) {
        return {
          stream: convertArrayToReadableStream([
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "Here is the answer." },
            { type: "text-end", id: "t1" },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: undefined },
              usage: USAGE,
            },
          ]),
        };
      }
      return {
        stream: convertArrayToReadableStream([
          {
            type: "tool-call",
            toolCallId: `call-${options.prompt.length}`,
            toolName: "searchWeb",
            input: JSON.stringify({ query: "pika chat" }),
          },
          {
            type: "finish",
            finishReason: { unified: "tool-calls", raw: undefined },
            usage: USAGE,
          },
        ]),
      };
    },
  });
}

describe("toolTurnStepSettings", () => {
  it("forces a final no-tools step so a tool-happy model still answers", async () => {
    const model = alwaysSearchesModel();
    const searchWeb = tool({
      description: "search stub",
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => ({ query, results: [] }),
    });

    const result = streamText({
      model,
      prompt: "What is pika chat?",
      tools: { searchWeb },
      ...toolTurnStepSettings(),
    });

    const text = await result.text;
    const steps = await result.steps;

    // Every budgeted step ran (the model would have kept searching) and the
    // turn still ended with an answer instead of dangling on tool results.
    expect(steps).toHaveLength(TOOL_TURN_STEP_LIMIT);
    expect(text).toBe("Here is the answer.");
    // The final step was the forced toolChoice: "none" one.
    const lastCall = model.doStreamCalls.at(-1);
    expect(lastCall?.toolChoice).toEqual({ type: "none" });
    // Earlier steps still offered the tool.
    expect(model.doStreamCalls[0]?.toolChoice).not.toEqual({ type: "none" });
  });

  it("strips tool definitions and appends an answer-now directive on the forced step", async () => {
    const model = alwaysSearchesModel();
    const searchWeb = tool({
      description: "search stub",
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => ({ query, results: [] }),
    });

    const result = streamText({
      model,
      prompt: "What is pika chat?",
      instructions: "Be helpful.",
      tools: { searchWeb },
      ...toolTurnStepSettings(),
    });

    await result.text;

    const lastCall = model.doStreamCalls.at(-1);
    // R9 prevention: no tool definitions are offered on the forced step.
    expect(lastCall?.tools ?? []).toHaveLength(0);
    // The base system prompt carries the appended answer-now directive.
    const system = lastCall?.prompt.find((message) => message.role === "system");
    expect(system?.content).toContain("Be helpful.");
    expect(system?.content).toContain(FORCED_STEP_DIRECTIVE);
    // Earlier steps kept the plain instructions and the tool.
    const firstCall = model.doStreamCalls[0];
    const firstSystem = firstCall?.prompt.find(
      (message) => message.role === "system",
    );
    expect(firstSystem?.content).toBe("Be helpful.");
    expect(firstCall?.tools).toHaveLength(1);
  });

  it("keeps the citation directive on the forced final step (R14)", async () => {
    const model = alwaysSearchesModel();
    const searchWeb = tool({
      description: "search stub",
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => ({ query, results: [] }),
    });

    // As the routes wire it: tool-mode instructions carry the citation
    // directive appended to the assistant's system prompt.
    const result = streamText({
      model,
      prompt: "What is pika chat?",
      instructions: withCitationDirective("Be helpful."),
      tools: { searchWeb },
      ...toolTurnStepSettings(),
    });

    await result.text;

    // The forced answer step is where citations get written, so the
    // directive must survive the step's instructions override.
    const lastCall = model.doStreamCalls.at(-1);
    const lastSystem = lastCall?.prompt.find(
      (message) => message.role === "system",
    );
    expect(lastSystem?.content).toContain(CITATION_DIRECTIVE);
    expect(lastSystem?.content).toContain(FORCED_STEP_DIRECTIVE);
    // Earlier steps carry the directive without the answer-now override.
    const firstSystem = model.doStreamCalls[0]?.prompt.find(
      (message) => message.role === "system",
    );
    expect(firstSystem?.content).toContain(CITATION_DIRECTIVE);
    expect(firstSystem?.content).not.toContain(FORCED_STEP_DIRECTIVE);
  });

  it("strips leaked tool-call markup emitted as text on the forced step", async () => {
    const model = new MockLanguageModelV3({
      doStream: async (options) => {
        const toolsForbidden =
          typeof options.toolChoice === "object" &&
          options.toolChoice.type === "none";
        if (toolsForbidden) {
          // The weak-model failure mode from production: the forced no-tools
          // step emits Hermes-style markup as plain text before answering.
          return {
            stream: convertArrayToReadableStream([
              { type: "text-start", id: "t1" },
              {
                type: "text-delta",
                id: "t1",
                delta: "<tool_call>\n<function=searchWeb>\n<parameter=query>\npika\n</parameter>\n</function>\n</tool_call>",
              },
              { type: "text-delta", id: "t1", delta: "Here is the answer." },
              { type: "text-end", id: "t1" },
              {
                type: "finish",
                finishReason: { unified: "stop", raw: undefined },
                usage: USAGE,
              },
            ]),
          };
        }
        return {
          stream: convertArrayToReadableStream([
            {
              type: "tool-call",
              toolCallId: `call-${options.prompt.length}`,
              toolName: "searchWeb",
              input: JSON.stringify({ query: "pika chat" }),
            },
            {
              type: "finish",
              finishReason: { unified: "tool-calls", raw: undefined },
              usage: USAGE,
            },
          ]),
        };
      },
    });
    const searchWeb = tool({
      description: "search stub",
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => ({ query, results: [] }),
    });

    const result = streamText({
      model,
      prompt: "What is pika chat?",
      tools: { searchWeb },
      ...toolTurnStepSettings(),
      experimental_transform: stripToolCallMarkupTransform(),
    });

    expect(await result.text).toBe("Here is the answer.");
    expect(await result.steps).toHaveLength(TOOL_TURN_STEP_LIMIT);
  });
});
