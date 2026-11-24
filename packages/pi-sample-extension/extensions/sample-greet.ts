import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const DEFAULT_PREFIX = "Hello";

const SampleGreetParams = Type.Object({
  name: Type.String({ description: "Name to greet." }),
  tone: Type.Optional(
    StringEnum(["friendly", "formal"] as const, {
      description: "Greeting tone.",
    }),
  ),
});

function resolvePrefix(rawPrefix: boolean | string | undefined): string {
  if (typeof rawPrefix === "string") {
    const trimmed = rawPrefix.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return DEFAULT_PREFIX;
}

export default function (pi: ExtensionAPI): void {
  let active = false;

  pi.registerFlag("sample-greet-prefix", {
    description: "Prefix used by the sample_greet tool and /sample-greet command.",
    type: "string",
    default: DEFAULT_PREFIX,
  });

  pi.registerTool({
    name: "sample_greet",
    label: "Sample Greet",
    description: "Format a greeting for a named target using an optional friendly or formal tone.",
    promptSnippet: "Format a greeting for a named target",
    promptGuidelines: [
      "Use sample_greet when the user asks to greet someone with an optional tone.",
    ],
    parameters: SampleGreetParams,
    async execute(_toolCallId, params) {
      const prefix = resolvePrefix(pi.getFlag("sample-greet-prefix"));
      const tone = params.tone ?? "friendly";
      const targetName = params.name.trim() || "there";
      const text =
        tone === "formal"
          ? `${prefix}, ${targetName}. Welcome.`
          : `${prefix}, ${targetName}!`;

      return {
        content: [{ type: "text", text }],
        details: {
          name: params.name,
          tone,
          prefix,
        },
      };
    },
  });

  pi.registerCommand("sample-greet", {
    description: "Show a sample greeting and current --sample-greet-prefix status.",
    handler: async (args, ctx) => {
      const prefix = resolvePrefix(pi.getFlag("sample-greet-prefix"));
      const target = args.trim() || "World";
      const state = active ? "active" : "idle";
      const message = `${prefix}, ${target}! (state=${state}, --sample-greet-prefix=${prefix})`;
      if (ctx.hasUI) {
        ctx.ui.notify(message, "info");
      }
    },
  });

  pi.on("session_start", (_event, _ctx) => {
    active = true;
  });

  pi.on("session_shutdown", (_event, ctx) => {
    active = false;
    if (ctx.hasUI) {
      ctx.ui.setStatus("sample-greet", undefined);
    }
  });
}
