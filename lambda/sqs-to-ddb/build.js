import { build } from "esbuild";

build({
  entryPoints: ["index.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  outfile: "dist/index.mjs",
  external: ["aws-sdk"], // Optional if you're not bundling AWS SDK
}).catch(() => process.exit(1));
