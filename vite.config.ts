import { execSync } from "node:child_process";
import vinext from "vinext";
import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import hostingConfig from "./.openai/hosting.json" with { type: "json" };
import { sites } from "./build/sites-vite-plugin.ts";

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

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig({
  define: {
    "process.env.NEXT_PUBLIC_GIT_COMMIT_SHA": JSON.stringify(commitSha),
    "process.env.NEXT_PUBLIC_GIT_BRANCH": JSON.stringify(branch),
  },
  plugins: [
    vinext(),
    sites(),
    cloudflare({
      viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
      config: localBindingConfig,
    }),
  ],
});
