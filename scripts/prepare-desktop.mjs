import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const standaloneDir = path.join(root, ".next", "standalone");
const staticSource = path.join(root, ".next", "static");
const staticTarget = path.join(standaloneDir, ".next", "static");
const publicSource = path.join(root, "public");
const publicTarget = path.join(standaloneDir, "public");

if (fs.existsSync(standaloneDir)) {
  console.log("[Desktop-Build] Preparing standalone bundle assets...");

  if (fs.existsSync(staticSource)) {
    fs.cpSync(staticSource, staticTarget, { recursive: true });
    console.log("[Desktop-Build] Copied .next/static -> .next/standalone/.next/static");
  }

  if (fs.existsSync(publicSource)) {
    fs.cpSync(publicSource, publicTarget, { recursive: true });
    console.log("[Desktop-Build] Copied public -> .next/standalone/public");
  }

  // Ensure playwright-core data files (such as browsers.json) are copied
  const pwCoreSources = [
    path.join(root, "node_modules", "playwright-core", "browsers.json"),
  ];

  for (const src of pwCoreSources) {
    if (fs.existsSync(src)) {
      // Find all playwright-core targets in standalone
      const pwTargets = [
        path.join(standaloneDir, "node_modules", "playwright-core", "browsers.json"),
      ];

      // Also check .pnpm paths
      const pnpmDir = path.join(standaloneDir, "node_modules", ".pnpm");
      if (fs.existsSync(pnpmDir)) {
        for (const entry of fs.readdirSync(pnpmDir)) {
          if (entry.startsWith("playwright-core@")) {
            pwTargets.push(path.join(pnpmDir, entry, "node_modules", "playwright-core", "browsers.json"));
          }
        }
      }

      for (const target of pwTargets) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(src, target);
        console.log(`[Desktop-Build] Copied browsers.json -> ${path.relative(standaloneDir, target)}`);
      }
    }
  }

  console.log("[Desktop-Build] Standalone desktop bundle ready.");
} else {
  console.warn("[Desktop-Build] Standalone directory not found. Run `next build` first.");
}
