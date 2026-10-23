import type { z } from "zod";
import { AiError, type ProviderCall } from "./types";

export interface RawModelReply {
  text: string | null;
  model: string;
  usage: Record<string, unknown> | null;
  refused?: boolean;
}

/**
 * Calls the model, then parses and schema-validates its JSON. Invalid output
 * gets exactly one controlled re-ask (spec §9.3 item 7); a second failure is a
 * technical error, never a business verdict.
 */
export async function callStructured<S extends z.ZodType>(
  schema: S,
  send: (reask: boolean) => Promise<RawModelReply>,
): Promise<ProviderCall<z.infer<S>>> {
  const started = Date.now();
  let requests = 0;
  let lastProblem = "";
  const usages: Record<string, unknown>[] = [];
  let model = "";

  for (const reask of [false, true]) {
    requests += 1;
    const reply = await send(reask);
    model = reply.model;
    if (reply.usage) usages.push(reply.usage);
    if (reply.refused) {
      throw new AiError("AI_REFUSED", "模型拒绝处理该请求", Date.now() - started);
    }
    if (!reply.text) {
      lastProblem = "empty response";
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(stripFence(reply.text));
    } catch {
      lastProblem = "response is not valid JSON";
      continue;
    }
    const parsed = schema.safeParse(json);
    if (parsed.success) {
      return {
        output: parsed.data,
        model,
        latencyMs: Date.now() - started,
        usage: usages.length === 1 ? (usages[0] ?? null) : { requests: usages },
        requests,
      };
    }
    lastProblem = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
  }
  throw new AiError("AI_OUTPUT_INVALID", `模型输出无法通过校验：${lastProblem}`, Date.now() - started);
}

function stripFence(text: string): string {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(trimmed);
  return fence?.[1] ?? trimmed;
}
