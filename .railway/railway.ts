// Railway project config (Infrastructure as Code). Declares only the web and api services of this repo.
// Partial file: it should manage just what is declared here and leave gateway, telegram-bot, backup and Postgres alone.
// Not declared (they stay in Railway): variables, the public domain (vertexhash.com), the api's generated domain, healthcheck.
// Mirrors the live settings of 21 Nov 2026. NOT APPLIED: preview first with `railway config plan` and
// read the counts, "destroy" must be 0 and nothing may change besides what you expect.
import { defineRailway, github, project, service } from "railway/iac";

export const partial = "cloud-project";

// Same lists as railway.web.json / railway.api.json; tests/railway-watch.test.mjs keeps all three in step with the real files.
const WEB_WATCH = [
  "/app/(app)/**",
  "/app/(plain)/**",
  "/app/(site)/**",
  "/app/status/**",
  "/app/healthz/**",
  "/app/icons/**",
  "/app/tonconnect-manifest.json/**",
  "/app/*.js",
  "/app/*.css",
  "/components/**",
  "/public/**",
  "/middleware.js",
  "/instrumentation.js",
  "/lib/*.js",
  "/lib/i18n/**",
  "/next.config.mjs",
  "/jsconfig.json",
  "/package.json",
  "/package-lock.json",
  "/Dockerfile",
  "/scripts/**",
];
const API_WATCH = [
  "/app/api/**",
  "/lib/server/**",
  "/lib/*.js",
  "/lib/i18n/**",
  "/middleware.js",
  "/instrumentation.js",
  "/next.config.mjs",
  "/jsconfig.json",
  "/package.json",
  "/package-lock.json",
  "/Dockerfile",
  "/scripts/**",
];

export default defineRailway(() => {
  // checkSuites: a deploy waits for CI to pass.
  const repo = () => github("allocsys/cloud-project", { branch: "main", checkSuites: true });

  // Pages (APP_ROLE=web).
  const web = service("frontend", {
    source: repo(),
    build: { builder: "RAILPACK", buildEnvironment: "V3", watchPatterns: WEB_WATCH },
    replicas: { iad: 1 },
    networking: { privateNetworkEndpoint: "cloud-project-staging" },
  });

  // API and tickers (APP_ROLE=api). Reached through the Worker (API_ORIGIN) and the private address.
  const api = service("api", {
    source: repo(),
    build: { builder: "RAILPACK", buildEnvironment: "V3", watchPatterns: API_WATCH },
    replicas: { iad: 1 },
  });

  return project("endearing-achievement", { resources: [web, api] });
});
