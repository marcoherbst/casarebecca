import { execSync } from "node:child_process";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const getGitInfo = () => {
  try {
    const commitSha =
      process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
      execSync("git rev-parse --short HEAD").toString().trim();
    const branch =
      process.env.VERCEL_GIT_COMMIT_REF ||
      execSync("git rev-parse --abbrev-ref HEAD").toString().trim();
    return { commitSha, branch };
  } catch {
    return { commitSha: "unknown", branch: "main" };
  }
};

const { commitSha, branch } = getGitInfo();

export default defineConfig({
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
  define: {
    "process.env.NEXT_PUBLIC_GIT_COMMIT_SHA": JSON.stringify(commitSha),
    "process.env.NEXT_PUBLIC_GIT_BRANCH": JSON.stringify(branch),
  },
  plugins: [react()],
  build: {
    outDir: "dist-vercel",
    emptyOutDir: true,
  },
});
