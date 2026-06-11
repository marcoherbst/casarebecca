import { createReadStream, statSync } from "node:fs";
import type { ServerResponse } from "node:http";
import path from "node:path";
import {
  type ApiRequest,
  requireMethod,
  requireUser,
  sendError,
} from "../../server/supabaseAuth.js";

const modelPath = path.join(
  process.cwd(),
  "protected-models",
  "casa_rebecca.frag",
);

export default async function handler(req: ApiRequest, res: ServerResponse) {
  try {
    requireMethod(req, res, ["GET", "HEAD"]);
    await requireUser(req);

    const stats = statSync(modelPath);
    res.statusCode = 200;
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Length", stats.size.toString());
    res.setHeader("Content-Type", "application/octet-stream");

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    createReadStream(modelPath).pipe(res);
  } catch (error) {
    sendError(res, error);
  }
}
