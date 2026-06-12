import type { ServerResponse } from "node:http";
import {
  cleanProjectName,
  updateProjectName,
} from "../../server/projectSettings.js";
import {
  type ApiRequest,
  getPathSegmentValue,
  readJsonBody,
  requireAdmin,
  requireMethod,
  sendError,
  sendJson,
} from "../../server/supabaseAuth.js";

export default async function handler(req: ApiRequest, res: ServerResponse) {
  try {
    requireMethod(req, res, ["PATCH"]);
    const { supabase, userId } = await requireAdmin(req);
    const projectId = getPathSegmentValue(
      req,
      "projects",
      "Project id is required.",
    );
    const body = await readJsonBody<{ name?: unknown }>(req);
    const name = cleanProjectName(body.name);
    const project = await updateProjectName(supabase, projectId, name, userId);

    sendJson(res, 200, { project });
  } catch (error) {
    sendError(res, error);
  }
}
