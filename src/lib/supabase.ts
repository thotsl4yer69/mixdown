import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import Constants from "expo-constants";

const extra = Constants.expoConfig?.extra ?? {};

const url = extra.supabaseUrl as string | undefined;
const anonKey = extra.supabaseAnonKey as string | undefined;
const isPlaceholder = (value: string | undefined) =>
  !value || /^REPLACE_/.test(value) || value.includes("YOUR_SUPABASE");

function assertRuntimeConfig(
  value: string | undefined,
  key: "SUPABASE_URL" | "SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEY",
): asserts value is string {
  if (isPlaceholder(value)) {
    throw new Error(
      `Missing Supabase config. Set ${key} in .env (or Expo env) before running the app.`,
    );
  }
}

assertRuntimeConfig(url, "SUPABASE_URL");
assertRuntimeConfig(anonKey, "SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEY");

/**
 * Single-user app, no auth flow — the anon key plus RLS policies scoped to a
 * fixed owner (see supabase/migrations) is the whole security model. If this
 * ever becomes multi-user, add real auth before anything else.
 */
export const supabase = createClient(url, anonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  db: { schema: "public" },
});
