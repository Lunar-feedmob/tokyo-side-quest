import Anthropic from "@anthropic-ai/sdk";
import {
  photoRatingJsonSchema,
  photoRatingOutputSchema,
  placeVerificationJsonSchema,
  placeVerificationOutputSchema,
} from "../contracts/ai";
import {
  INVALID_OUTPUT_REASK,
  RATING_SYSTEM_PROMPT,
  rateUserText,
  VERIFY_SYSTEM_PROMPT,
  verifyUserText,
} from "./prompts";
import { callStructured, type RawModelReply } from "./structured";
import { AiError, type RateInput, type VerifyInput, type VisionImage, type VisionProvider } from "./types";

// Models that accept the server-side refusal fallback ("default" routing).
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export class AnthropicVisionProvider implements VisionProvider {
  readonly name = "anthropic";
  readonly model: string;
  private readonly client: Anthropic;

  constructor(opts: { apiKey: string; model: string; baseURL?: string; timeoutMs: number }) {
    this.model = opts.model;
    // Retries are owned by the job queue so each attempt is logged; the SDK does not retry on its own.
    this.client = new Anthropic({ apiKey: opts.apiKey, baseURL: opts.baseURL, timeout: opts.timeoutMs, maxRetries: 0 });
  }

  verifyPlace(input: VerifyInput, signal?: AbortSignal) {
    const images = [input.userPhoto, ...input.references];
    return callStructured(placeVerificationOutputSchema, (reask) =>
      this.send({
        system: VERIFY_SYSTEM_PROMPT,
        images,
        text: verifyUserText(input),
        schema: placeVerificationJsonSchema,
        reask,
        signal,
      }),
    );
  }

  ratePhoto(input: RateInput, signal?: AbortSignal) {
    return callStructured(photoRatingOutputSchema, (reask) =>
      this.send({
        system: RATING_SYSTEM_PROMPT,
        images: [input.userPhoto],
        text: rateUserText(input),
        schema: photoRatingJsonSchema,
        reask,
        signal,
      }),
    );
  }

  private async send(req: {
    system: string;
    images: VisionImage[];
    text: string;
    schema: Record<string, unknown>;
    reask: boolean;
    signal?: AbortSignal;
  }): Promise<RawModelReply> {
    const content: Anthropic.Beta.BetaContentBlockParam[] = [
      ...req.images.map(
        (img): Anthropic.Beta.BetaImageBlockParam => ({
          type: "image",
          source: { type: "base64", media_type: img.mediaType, data: img.data.toString("base64") },
        }),
      ),
      { type: "text", text: req.reask ? `${req.text}\n\n${INVALID_OUTPUT_REASK}` : req.text },
    ];
    const useFallback = FALLBACK_MODELS.has(this.model);

    try {
      const response = await this.client.beta.messages.create(
        {
          model: this.model,
          max_tokens: 16000,
          system: req.system,
          messages: [{ role: "user", content }],
          output_config: { effort: "medium", format: { type: "json_schema", schema: req.schema } },
          ...(useFallback ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
        },
        { signal: req.signal },
      );

      if (response.stop_reason === "refusal") {
        return { text: null, model: response.model, usage: usageOf(response.usage), refused: true };
      }
      if (response.stop_reason === "max_tokens") {
        return { text: null, model: response.model, usage: usageOf(response.usage) };
      }
      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      return { text, model: response.model, usage: usageOf(response.usage) };
    } catch (error) {
      throw classify(error);
    }
  }
}

function usageOf(usage: Anthropic.Beta.BetaUsage): Record<string, unknown> {
  return {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? null,
  };
}

function classify(error: unknown): AiError {
  if (error instanceof AiError) return error;
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new AiError("AI_TIMEOUT", "AI 服务请求超时");
  if (error instanceof Anthropic.APIUserAbortError) return new AiError("AI_TIMEOUT", "AI 请求已取消或超时");
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new AiError("AI_AUTH", "AI 服务鉴权失败，请检查 AI_API_KEY");
  }
  if (error instanceof Anthropic.RateLimitError) return new AiError("AI_RATE_LIMITED", "AI 服务限流");
  if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.NotFoundError) {
    return new AiError("AI_BAD_REQUEST", `AI 请求被拒绝：${(error as Error).message.slice(0, 200)}`);
  }
  if (error instanceof Anthropic.APIConnectionError) return new AiError("AI_UNAVAILABLE", "无法连接 AI 服务");
  if (error instanceof Anthropic.APIError) {
    return new AiError("AI_UNAVAILABLE", `AI 服务错误 ${error.status ?? ""}`.trim());
  }
  return new AiError("AI_UNAVAILABLE", error instanceof Error ? error.message.slice(0, 200) : "未知 AI 错误");
}
