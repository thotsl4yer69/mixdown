const fs = require("node:fs");
const path = require("node:path");

const baseConfig = require("./app.json");

function parseDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .reduce((env, line) => {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("#")) {
        return env;
      }

      const separatorIndex = trimmed.indexOf("=");

      if (separatorIndex === -1) {
        return env;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      let value = trimmed.slice(separatorIndex + 1).trim();

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      env[key] = value;
      return env;
    }, {});
}

function readConfigValue(envFile, ...keys) {
  for (const key of keys) {
    const value = process.env[key] ?? envFile[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

module.exports = () => {
  const config = JSON.parse(JSON.stringify(baseConfig.expo ?? {}));
  const envFile = parseDotEnv(path.join(__dirname, ".env"));
  const extra = { ...(config.extra ?? {}) };

  const supabaseUrl = readConfigValue(
    envFile,
    "SUPABASE_URL",
    "EXPO_PUBLIC_SUPABASE_URL",
  );
  const supabaseAnonKey = readConfigValue(
    envFile,
    "SUPABASE_ANON_KEY",
    "SUPABASE_PUBLISHABLE_KEY",
    "EXPO_PUBLIC_SUPABASE_ANON_KEY",
    "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  );
  const easProjectId = readConfigValue(envFile, "EAS_PROJECT_ID");

  if (supabaseUrl) {
    extra.supabaseUrl = supabaseUrl;
  }

  if (supabaseAnonKey) {
    extra.supabaseAnonKey = supabaseAnonKey;
  }

  if (easProjectId) {
    extra.eas = {
      ...(extra.eas ?? {}),
      projectId: easProjectId,
    };
  }

  config.extra = extra;
  return config;
};
