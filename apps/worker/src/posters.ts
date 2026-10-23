import type { Job } from "bullmq";

// Implemented with the poster feature (stage E).
export async function posterProcessor(job: Job<{ id: string }>) {
  throw new Error(`poster rendering not implemented yet (${job.data.id})`);
}
