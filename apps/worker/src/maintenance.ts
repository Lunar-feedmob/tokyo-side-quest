import type { Job } from "bullmq";

// Implemented with the deletion feature (stage E).
export async function maintenanceProcessor(job: Job<{ id: string }>) {
  throw new Error(`maintenance job ${job.name} not implemented yet (${job.data.id})`);
}
