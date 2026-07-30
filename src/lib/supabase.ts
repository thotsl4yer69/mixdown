import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import Constants from "expo-constants";

const extra = Constants.expoConfig?.extra ?? {};

const url = extra.supabaseUrl as string | undefined;
const anonKey = extra.supabaseAnonKey as string | undefined;

if (!url || !anonKey) {
  throw new Error(
    "Missing supabaseUrl / supabaseAnonKey in app.json `expo.extra`. " +
      "Set them from your Supabase project settings before running the app.",
  );
}

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
