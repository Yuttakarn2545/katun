import { Config } from "@remotion/cli/config";

// โค้ดใน packages/core เขียน import แบบ ESM (./schema.js ชี้ไฟล์ .ts) ให้ webpack ของ Remotion หาไฟล์ .ts ได้
Config.overrideWebpackConfig((config) => ({
  ...config,
  resolve: {
    ...config.resolve,
    extensionAlias: { ".js": [".ts", ".tsx", ".js"] },
  },
}));
