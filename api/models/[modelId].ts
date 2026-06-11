import { createReadStream, statSync } from "node:fs";
import type { ServerResponse } from "node:http";
import path from "node:path";
import { getProtectedModel } from "../../modelCatalog.js";
import {
  ApiError,
  type ApiRequest,
  getRequestOrigin,
  requireMethod,
  requireUser,
  sendError,
} from "../../server/supabaseAuth.js";

function getModelIdFromPath(req: ApiRequest) {
  const origin = getRequestOrigin(req);
  const pathname = new URL(req.url ?? "", origin).pathname;
  const parts = pathname.split("/").filter(Boolean);
  const index = parts.indexOf("models");
  const value = index >= 0 ? parts[index + 1] : "";

  if (!value) {
    throw new ApiError(400, "Model id is required.");
  }

  return decodeURIComponent(value);
}

export default async function handler(req: ApiRequest, res: ServerResponse) {
  try {
    requireMethod(req, res, ["GET", "HEAD"]);
    await requireUser(req);

    const modelId = getModelIdFromPath(req);
    const model = getProtectedModel(modelId);

    if (!model) {
      throw new ApiError(404, "Model not found.");
    }

    const modelPath = path.join(
      process.cwd(),
      "protected-models",
      model.fragmentFileName,
    );
    const stats = statSync(modelPath);

    res.statusCode = 200;
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Length", stats.size.toString());
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("X-Model-Name", model.projectName);

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    createReadStream(modelPath).pipe(res);
  } catch (error) {
    sendError(res, error);
  }
}
