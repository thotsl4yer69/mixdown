import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import Constants from "expo-constants";

const extra = Constants.expoConfig?.extra ?? {};

const url = extra.supabaseUrl as string | undefined;
const anonKey = extra.supabaseAnonKey as string | undefined;
const isPlaceholder = (value: string | undefined) =>
  !value || /^REPLACE_/.test(value) || value.includes("YOUR_SUPABASE");

// Keep the root layout renderable when a local/fresh install has not been
// configured yet. Requests will fail normally and the feed can show its
// existing error state instead of crashing during module evaluation.
const clientUrl = isPlaceholder(url) ? "https://invalid.supabase.local" : url!;
const clientAnonKey = isPlaceholder(anonKey) ? "missing-supabase-key" : anonKey!;

/**
 * Single-user app, no auth flow — the client uses the Supabase anon/publishable key.
 * RLS is enabled, but policies are currently permissive for the `anon` role (see supabase/migrations/0003_rls.sql).
 * If this ever becomes multi-user, add real auth and tighten policies before sharing access.
 */
export const supabase = createClient(clientUrl, clientAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  db: { schema: "public" },
});
