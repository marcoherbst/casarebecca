import type { ServerResponse } from "node:http";
import {
  ApiError,
  type ApiRequest,
  invitationSummary,
  isPendingInvitation,
  mergeRoleMetadata,
  parseRole,
  readJsonBody,
  requireAdmin,
  requireMethod,
  sendError,
  sendJson,
  userSummary,
} from "../server/supabaseAuth.js";

export default async function handler(req: ApiRequest, res: ServerResponse) {
  try {
    requireMethod(req, res, ["GET", "POST"]);

    if (req.method === "GET") {
      const { supabase } = await requireAdmin(req);
      const { data, error } = await supabase.auth.admin.listUsers({
        page: 1,
        perPage: 100,
      });

      if (error) {
        throw new ApiError(500, error.message);
      }

      sendJson(res, 200, {
        invitations: data.users
          .filter(isPendingInvitation)
          .map(invitationSummary),
        users: data.users.map(userSummary),
      });
      return;
    }

    const { supabase } = await requireAdmin(req);
    const body = await readJsonBody<{ email?: unknown; role?: unknown }>(req);
    const email = typeof body.email === "string" ? body.email.trim() : "";
    if (!email) {
      throw new ApiError(400, "Email is required.");
    }

    const role = parseRole(body.role ?? "user");
    const { data: users, error: listError } =
      await supabase.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });

    if (listError) {
      throw new ApiError(500, listError.message);
    }

    const existingUser = users.users.find(
      (user) => user.email?.toLowerCase() === email.toLowerCase(),
    );

    if (existingUser) {
      const { data: updated, error: updateError } =
        await supabase.auth.admin.updateUserById(existingUser.id, {
          app_metadata: mergeRoleMetadata(existingUser.app_metadata, role),
        });

      if (updateError || !updated.user) {
        throw new ApiError(
          500,
          updateError?.message ?? "User role could not be saved.",
        );
      }

      sendJson(res, 200, { user: userSummary(updated.user) });
      return;
    }

    const { data, error } = await supabase.auth.admin.createUser({
      app_metadata: { role },
      email,
      email_confirm: true,
    });

    if (error || !data.user) {
      throw new ApiError(400, error?.message ?? "User could not be added.");
    }

    sendJson(res, 201, { user: userSummary(data.user) });
  } catch (error) {
    sendError(res, error);
  }
}
