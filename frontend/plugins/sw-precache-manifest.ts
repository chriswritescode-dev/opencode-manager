import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";

const SW_FILENAME = "sw.js";
const PRECACHE_DIR_PREFIXES = ["assets/"];
const PRECACHE_ROOT_FILES = [
  "index.html",
  "manifest.json",
  "favicon.svg",
  "icons/icon-192x192.png",
];

async function collectFiles(dir: string, base = dir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) return collectFiles(absolute, base);
      return [path.relative(base, absolute)];
    })
  );
  return files.flat();
}

function toUrl(relativePath: string): string {
  return "/" + relativePath.split(path.sep).join("/");
}

function isPrecacheTarget(relativePath: string): boolean {
  const url = toUrl(relativePath);
  if (url === `/${SW_FILENAME}` || url.endsWith(".map")) return false;
  if (PRECACHE_ROOT_FILES.includes(relativePath)) return true;
  return PRECACHE_DIR_PREFIXES.some((prefix) => url.startsWith(`/${prefix}`));
}

export function swPrecacheManifest(): Plugin {
  let outDir = "";

  return {
    name: "sw-precache-manifest",
    apply: "build",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      const swPath = path.join(outDir, SW_FILENAME);
      let swSource: string;
      try {
        swSource = await readFile(swPath, "utf-8");
      } catch {
        throw new Error(`[sw-precache-manifest] ${SW_FILENAME} not found in ${outDir}`);
      }

      const relativePaths = (await collectFiles(outDir)).filter(isPrecacheTarget).sort();

      const hash = createHash("sha256");
      const urls: string[] = [];
      for (const relativePath of relativePaths) {
        const content = await readFile(path.join(outDir, relativePath));
        const url = toUrl(relativePath);
        urls.push(url);
        hash.update(url);
        hash.update(content);
      }

      if (!urls.includes("/index.html")) {
        throw new Error("[sw-precache-manifest] index.html missing from build output");
      }

      const buildHash = hash.digest("hex").slice(0, 16);
      const header =
        `self.__SW_BUILD_HASH__=${JSON.stringify(buildHash)};` +
        `self.__SW_PRECACHE__=${JSON.stringify(urls)};\n`;

      await writeFile(swPath, header + swSource);
    },
  };
}
