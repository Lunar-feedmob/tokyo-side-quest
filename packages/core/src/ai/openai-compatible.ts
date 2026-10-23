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

/**
 * For non-Anthropic vision models exposed through an OpenAI-style
 * /chat/completions endpoint (many hosted providers support this shape).
 */
export class OpenAiCompatibleVisionProvider implements VisionProvider {
  readonly name = "openai-compatible";
  readonly model: string;

  constructor(private readonly opts: { apiKey: string; model: string; baseURL: string; timeoutMs: number }) {
    this.model = opts.model;
  }

  verifyPlace(input: VerifyInput, signal?: AbortSignal) {
    return callStructured(placeVerificationOutputSchema, (reask) =>
      this.send(VERIFY_SYSTEM_PROMPT, [input.userPhoto, ...input.references], verifyUserText(input), "place_verification", placeVerificationJsonSchema, reask, signal),
    );
  }

  ratePhoto(input: RateInput, signal?: AbortSignal) {
    return callStructured(photoRatingOutputSchema, (reask) =>
      this.send(RATING_SYSTEM_PROMPT, [input.userPhoto], rateUserText(input), "photo_rating", photoRatingJsonSchema, reask, signal),
    );
  }

  private async send(
    system: string,
    images: VisionImage[],
    text: string,
    schemaName: string,
    schema: Record<string, unknown>,
    reask: boolean,
    signal?: AbortSignal,
  ): Promise<RawModelReply> {
    const timeout = AbortSignal.timeout(this.opts.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await fetch(`${this.opts.baseURL.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        signal: combined,
        headers: { "content-type": "application/json", authorization: `Bearer ${this.opts.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: system },
            {
              role: "user",
              content: [
                ...images.map((img) => ({
                  type: "image_url",
                  image_url: { url: `data:${img.mediaType};base64,${img.data.toString("base64")}` },
                })),
                { type: "text", text: reask ? `${text}\n\n${INVALID_OUTPUT_REASK}` : text },
              ],
            },
          ],
          response_format: { type: "json_schema", json_schema: { name: schemaName, strict: true, schema } },
        }),
      });
    } catch (error) {
      if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new AiError("AI_TIMEOUT", "AI 服务请求超时");
      }
      throw new AiError("AI_UNAVAILABLE", "无法连接 AI 服务");
    }

    if (res.status === 401 || res.status === 403) throw new AiError("AI_AUTH", "AI 服务鉴权失败，请检查 AI_API_KEY");
    if (res.status === 429) throw new AiError("AI_RATE_LIMITED", "AI 服务限流");
    if (res.status >= 400 && res.status < 500) {
      throw new AiError("AI_BAD_REQUEST", `AI 请求被拒绝（HTTP ${res.status}）`);
    }
    if (!res.ok) throw new AiError("AI_UNAVAILABLE", `AI 服务错误（HTTP ${res.status}）`);

    const body = (await res.json()) as {
      model?: string;
      usage?: Record<string, unknown>;
      choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
    };
    const choice = body.choices?.[0];
    return {
      text: choice?.message?.content ?? null,
      model: body.model ?? this.model,
      usage: body.usage ?? null,
      refused: Boolean(choice?.message?.refusal) || choice?.finish_reason === "content_filter",
    };
  }
}
