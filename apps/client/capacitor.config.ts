import type { CapacitorConfig } from "@capacitor/cli";
const config: CapacitorConfig = {
  appId: "dev.yamide.app",
  appName: "YAMIDE",
  webDir: "dist",
  server: { androidScheme: "https", cleartext: true },
  android: { allowMixedContent: true },
};
export default config;
