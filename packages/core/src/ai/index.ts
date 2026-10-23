import { capabilities, env } from "../config/env";
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
export function aiVersions(): AiVersions | null {
  const caps = capabilities();
  if (!caps.ai.configured || !caps.ai.provider || !caps.ai.model) return null;
  return {
    provider: caps.ai.provider,
    model: caps.ai.provider === "fake" ? "fake-vision-1" : caps.ai.model,
    modelConfigVersion: env().AI_MODEL_CONFIG_VERSION,
    verifyPromptVersion: VERIFY_PROMPT_VERSION,
    ratingPromptVersion: RATING_PROMPT_VERSION,
  };
}

export function createVisionProvider(faults?: FakeFaults): VisionProvider {
  const e = env();
  const caps = capabilities(e);
  if (!caps.ai.configured) {
    throw new AiError("AI_NOT_CONFIGURED", `AI 未配置：缺少 ${caps.ai.missing.join(", ")}`);
  }
  switch (e.AI_PROVIDER) {
    case "anthropic":
      return new AnthropicVisionProvider({
        apiKey: e.AI_API_KEY!,
        model: e.AI_VISION_MODEL!,
        baseURL: e.AI_API_BASE_URL,
        timeoutMs: e.AI_TIMEOUT_MS,
      });
    case "openai-compatible":
      return new OpenAiCompatibleVisionProvider({
        apiKey: e.AI_API_KEY!,
        model: e.AI_VISION_MODEL!,
        baseURL: e.AI_API_BASE_URL!,
        timeoutMs: e.AI_TIMEOUT_MS,
      });
    case "fake":
      if (e.APP_ENV !== "test") throw new AiError("AI_NOT_CONFIGURED", "测试替身只允许在测试环境使用");
      return new FakeVisionProvider(faults ?? { failVerify: async () => false, failRating: async () => false });
    default:
      throw new AiError("AI_NOT_CONFIGURED", "AI 未配置");
  }
}
