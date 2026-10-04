import { main } from "../desktop/main";

void main().catch((err) => {
  console.error("[Desktop-Host] Failed to launch desktop app:", err);
  process.exit(1);
});

