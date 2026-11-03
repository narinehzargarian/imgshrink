import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative paths, so the built site works from any folder, including GitHub Pages.
  base: "./",
  plugins: [react()],
  worker: { format: "es" },
  build: { target: "es2022" },
  test: { include: ["test/unit/**/*.test.ts"] },
});
