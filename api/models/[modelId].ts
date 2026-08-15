import { createReadStream, statSync } from "node:fs";
import type { ServerResponse } from "node:http";
import path from "node:path";
import { getProtectedModel } from "../../modelCatalog.js";
import {
  ApiError,
  type ApiRequest,
  getRequestOrigin,
  requireMethod,
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
    const lastModified = stats.mtime.toUTCString();

    // Model files aren't confidential (auth was intentionally dropped from
    // this route — see AuthShell.tsx) and rarely change, so cache them
    // instead of forcing a full multi-MB re-download on every visit. The
    // URL has no content hash, so this stays conservative (an hour, plus a
    // day of serving stale-while-revalidating) rather than treating the
    // file as permanently immutable.
    if (req.headers["if-modified-since"] === lastModified) {
      res.statusCode = 304;
      res.end();
      return;
    }

    res.statusCode = 200;
    res.setHeader(
      "Cache-Control",
      "public, max-age=3600, stale-while-revalidate=86400",
    );
    res.setHeader("Last-Modified", lastModified);
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
