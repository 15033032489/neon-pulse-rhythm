import { mkdir, writeFile } from "node:fs/promises";

const serverDirectory = new URL("../dist/server/", import.meta.url);
const workerEntry = new URL("index.js", serverDirectory);

const workerSource = `export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/") {
      url.pathname = "/index.html";
    }

    if (env && env.ASSETS) {
      const response = await env.ASSETS.fetch(new Request(url, request));
      if (response.status !== 404) return response;

      url.pathname = "/index.html";
      return env.ASSETS.fetch(new Request(url, request));
    }

    return new Response("Site assets are not available.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
};
`;

await mkdir(serverDirectory, { recursive: true });
await writeFile(workerEntry, workerSource, "utf8");
