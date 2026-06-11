import type { ServerResponse } from "node:http";
import {
  ApiError,
  type ApiRequest,
  getUserIdFromPath,
  mergeRoleMetadata,
  parseRole,
  readJsonBody,
  requireAdmin,
  requireMethod,
  sendError,
  sendJson,
  userSummary,
} from "../../server/supabaseAuth.js";

export default async function handler(req: ApiRequest, res: ServerResponse) {
  try {
    requireMethod(req, res, ["PATCH", "DELETE"]);
    const { supabase, userId: callerUserId } = await requireAdmin(req);
    const targetUserId = getUserIdFromPath(req, "users");

    if (req.method === "DELETE") {
      if (targetUserId === callerUserId) {
        throw new ApiError(400, "You cannot remove your own account.");
      }

      const { error } = await supabase.auth.admin.deleteUser(targetUserId);
      if (error) {
        throw new ApiError(500, error.message);
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    const body = await readJsonBody<{ role?: unknown }>(req);
    const role = parseRole(body.role);
    const { data: target, error: getError } =
      await supabase.auth.admin.getUserById(targetUserId);

    if (getError || !target.user) {
      throw new ApiError(404, getError?.message ?? "User not found.");
    }

    const { data: updated, error: updateError } =
      await supabase.auth.admin.updateUserById(targetUserId, {
        app_metadata: mergeRoleMetadata(target.user.app_metadata, role),
      });

    if (updateError || !updated.user) {
      throw new ApiError(
        500,
        updateError?.message ?? "Could not update role.",
      );
    }

    sendJson(res, 200, { user: userSummary(updated.user) });
  } catch (error) {
    sendError(res, error);
  }
}
