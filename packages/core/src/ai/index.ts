import { env } from "../config/env";
import { resolveAi, type AiProviderName } from "../services/settings";
import { AnthropicVisionProvider } from "./anthropic";
import { FakeVisionProvider, type FakeFaults } from "./fake";
import { OpenAiCompatibleVisionProvider } from "./openai-compatible";
import { RATING_PROMPT_VERSION, VERIFY_PROMPT_VERSION } from "./prompts";
import { AiError, type VisionProvider } from "./types";

export { AiError, RATING_PROMPT_VERSION, VERIFY_PROMPT_VERSION };
export type { VisionProvider };

export interface AiVersions {
  provider: string;
  model: string;
  modelConfigVersion: string;
  verifyPromptVersion: string;
  ratingPromptVersion: string;
}

/** Versions recorded on every evaluation, or null when AI is not configured. */
export async function aiVersions(): Promise<AiVersions | null> {
  const ai = await resolveAi();
  if (!ai.configured || !ai.provider || !ai.model) return null;
  return {
    provider: ai.provider,
    model: ai.model,
    modelConfigVersion: ai.modelConfigVersion,
    verifyPromptVersion: VERIFY_PROMPT_VERSION,
    ratingPromptVersion: RATING_PROMPT_VERSION,
  };
}

export interface ProviderConfig {
  provider: AiProviderName;
  apiKey: string;
  model: string;
  baseUrl: string | null;
  timeoutMs: number;
}

export function providerFromConfig(c: ProviderConfig): VisionProvider {
  if (c.provider === "anthropic") {
    return new AnthropicVisionProvider({ apiKey: c.apiKey, model: c.model, baseURL: c.baseUrl ?? undefined, timeoutMs: c.timeoutMs });
  }
  if (!c.baseUrl) throw new AiError("AI_NOT_CONFIGURED", "OpenAI 兼容协议缺少接口地址");
  return new OpenAiCompatibleVisionProvider({ apiKey: c.apiKey, model: c.model, baseURL: c.baseUrl, timeoutMs: c.timeoutMs });
}

export async function createVisionProvider(faults?: FakeFaults): Promise<VisionProvider> {
  const ai = await resolveAi();
  if (!ai.configured || !ai.provider) {
    throw new AiError("AI_NOT_CONFIGURED", ai.problem ?? `AI 未配置：缺少 ${ai.missing.join(", ")}`);
  }
  if (ai.provider === "fake") {
    if (env().APP_ENV !== "test") throw new AiError("AI_NOT_CONFIGURED", "测试替身只允许在测试环境使用");
    return new FakeVisionProvider(faults ?? { failVerify: async () => false, failRating: async () => false });
  }
  return providerFromConfig({ provider: ai.provider, apiKey: ai.apiKey!, model: ai.model!, baseUrl: ai.baseUrl, timeoutMs: ai.timeoutMs });
}

export interface ConnectionTestResult {
  ok: boolean;
  model: string | null;
  latencyMs: number;
  usage: Record<string, unknown> | null;
  code: string | null;
  message: string;
}

/**
 * One small real request: a plain generated image through the rating prompt.
 * Proves the key, endpoint, model name, image input and structured output all
 * work together. The answer itself (usually "unscorable") is not used.
 */
export async function testConnection(c: ProviderConfig): Promise<ConnectionTestResult> {
  const started = Date.now();
  try {
    const provider = providerFromConfig(c);
    // Loaded lazily: a top-level import of this native external makes the module
    // async under Turbopack, which breaks every route that imports it.
    const { default: sharp } = await import("sharp");
    const data = await sharp({ create: { width: 320, height: 240, channels: 3, background: "#8a8f98" } }).jpeg().toBuffer();
    const call = await provider.ratePhoto({
      placeNameZh: "连接测试",
      placeNameJa: "接続テスト",
      userPhoto: { role: "user", mediaType: "image/jpeg", data },
    });
    return { ok: true, model: call.model, latencyMs: call.latencyMs, usage: call.usage, code: null, message: "连接成功：模型能读取图片并返回符合格式的结果" };
  } catch (error) {
    const code = error instanceof AiError ? error.code : "AI_UNAVAILABLE";
    const message = error instanceof Error ? error.message.slice(0, 300) : "未知错误";
    return { ok: false, model: null, latencyMs: Date.now() - started, usage: null, code, message };
  }
}
