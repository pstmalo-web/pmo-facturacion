import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  // Resuelve el alias "@/*" leyendo tsconfig.json (moduleResolution: bundler).
  plugins: [tsconfigPaths()],
  test: {
    // Módulos puros de lib/ — sin DOM, sin red y sin Supabase.
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
