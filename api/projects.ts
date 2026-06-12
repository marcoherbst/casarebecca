import type { ServerResponse } from "node:http";
import { listProjectSettings } from "../server/projectSettings.js";
import {
  type ApiRequest,
  requireMethod,
  requireUser,
  sendError,
  sendJson,
} from "../server/supabaseAuth.js";

export default async function handler(req: ApiRequest, res: ServerResponse) {
  try {
    requireMethod(req, res, ["GET"]);
    const { supabase } = await requireUser(req);
    const projects = await listProjectSettings(supabase);

    sendJson(res, 200, { projects });
  } catch (error) {
    sendError(res, error);
  }
}
