import { addSurveyEntry, listSurvey, surveyEntryInputSchema } from "@tsq/core/services/survey";
import { readJson, route } from "@/lib/server/api";
import { requireAdmin } from "@/lib/server/admin";

// Field survey records for one place (GPS samples and observations taken on site).
export const GET = route<{ id: string }>(async ({ params }) => {
  await requireAdmin("content");
  return { data: await listSurvey(params.id) };
});

export const POST = route<{ id: string }>(async ({ req, params }) => {
  const admin = await requireAdmin("content");
  const body = await readJson(req, surveyEntryInputSchema);
  return { status: 201, data: await addSurveyEntry(admin, params.id, body) };
});
