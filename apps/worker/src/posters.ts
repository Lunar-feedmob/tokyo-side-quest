import { UnrecoverableError, type Job } from "bullmq";
import { markPosterFailed, renderPoster } from "@tsq/core/services/posters";

export async function posterProcessor(job: Job<{ id: string }>) {
  try {
    return await renderPoster(job.data.id);
  } catch (error) {
    if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
      await markPosterFailed(job.data.id, "RENDER_FAILED");
      throw new UnrecoverableError(error instanceof Error ? error.message : "render failed");
    }
    throw error;
  }
}
