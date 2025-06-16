import type { Config } from "jest";

const jestConfig: Config = {
  transform: { "\\.[jt]sx?$": ["ts-jest", { useESM: true }] },
  moduleNameMapper: {
    "(.+)\\.js": "$1",
  },
  extensionsToTreatAsEsm: [".ts"],
};

export default jestConfig;
