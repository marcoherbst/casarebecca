import type { ServerResponse } from "node:http";
import {
  type ApiRequest,
  requireMethod,
  requireUser,
  sendError,
  sendJson,
  userSummary,
} from "../server/supabaseAuth.js";

export default async function handler(req: ApiRequest, res: ServerResponse) {
  try {
    requireMethod(req, res, ["GET"]);
    const { user } = await requireUser(req);
    sendJson(res, 200, { user: userSummary(user) });
  } catch (error) {
    sendError(res, error);
  }
}
