import type { Job } from "bullmq";
import { completePhotoDeletion, completeVisitorDeletion } from "@tsq/core/services/deletion";

export async function maintenanceProcessor(job: Job<{ id: string }>) {
  switch (job.name) {
    case "photo-delete":
      return completePhotoDeletion(job.data.id);
    case "visitor-delete":
      return completeVisitorDeletion(job.data.id);
    default:
      throw new Error(`unknown maintenance job ${job.name}`);
  }
}
