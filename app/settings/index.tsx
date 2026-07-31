import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { color, lane, radius, scale, space, type } from "../../src/theme/tokens";
import { Fader } from "../../src/components/Fader";
import { supabase } from "../../src/lib/supabase";
import { fetchPrefs, setPref } from "../../src/lib/queue";
import type { Prefs, TopicBucket } from "../../src/lib/types";

interface SourceRow {
  id: string;
  kind: string;
  label: string;
  config: Record<string, unknown>;
  default_bucket: string | null;
  is_nsfw: boolean;
  enabled: boolean;
  last_error: string | null;
}

export default function SettingsScreen() {
  const router = useRouter();
  const [prefs, setPrefsState] = useState<Prefs | null>(null);
  const [buckets, setBuckets] = useState<TopicBucket[]>([]);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [addingSource, setAddingSource] = useState(false);

  const reload = useCallback(async () => {
    const [p, { data: b }, { data: s }] = await Promise.all([
      fetchPrefs(),
      supabase.from("topic_buckets").select("*").order("sort_order"),
      supabase.from("sources").select("id,kind,label,config,default_bucket,is_nsfw,enabled,last_error").order("label"),
    ]);
    setPrefsState(p);
    setBuckets((b ?? []) as TopicBucket[]);
    setSources((s ?? []) as SourceRow[]);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // ---- topic bucket weights --------------------------------------------
  const onBucketChange = (key: string, value: number) => {
    setBuckets((cur) => cur.map((b) => (b.key === key ? { ...b, weight: value } : b)));
  };

  const onBucketCommit = async (key: string, value: number) => {
    await supabase.from("topic_buckets").update({ weight: value }).eq("key", key);
  };

  // ---- prefs -------------------------------------------------------------
  const togglePref = async <K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    if (!prefs) return;
    setPrefsState({ ...prefs, [key]: value });
    await setPref(key, value);
  };

  // ---- sources -------------------------------------------------------------
  const toggleSource = async (id: string, enabled: boolean) => {
    setSources((cur) => cur.map((s) => (s.id === id ? { ...s, enabled } : s)));
    await supabase.from("sources").update({ enabled }).eq("id", id);
  };

  const removeSource = (id: string, label: string) => {
    Alert.alert("Remove source", `Stop polling "${label}"? Already-ingested items stay in your feed.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          await supabase.from("sources").delete().eq("id", id);
          setSources((cur) => cur.filter((s) => s.id !== id));
        },
      },
    ]);
  };

  if (!prefs) return <View style={styles.root} />;

  return (
    <View style={styles.root}>
      <View style={styles.topBar}>
        <Text style={styles.screenTitle}>MIX</Text>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.closeGlyph}>{"\u2715"}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Section title="Topic balance">
          <Text style={styles.sectionHint}>
            Priors for the ranker. It's allowed to drift from these based on what you actually watch —
            control how much with the dial below.
          </Text>
          <View style={styles.faderRow}>
            {buckets.map((b) => (
              <Fader
                key={b.key}
                label={b.label}
                value={b.weight}
                accent={lane[b.lane].accent}
                onChange={(v) => onBucketChange(b.key, v)}
                onCommit={(v) => onBucketCommit(b.key, v)}
              />
            ))}
          </View>
        </Section>

        <Section title="Ranker drift">
          <Text style={styles.sectionHint}>
            0 keeps the ranker close to your sliders. 1 lets it chase what you actually engage with,
            even when that disagrees with them.
          </Text>
          <View style={styles.faderRow}>
            <Fader
              label="DRIFT"
              value={prefs.drift}
              accent={color.text}
              onChange={(v) => setPrefsState({ ...prefs, drift: v })}
              onCommit={(v) => togglePref("drift", v)}
            />
          </View>
        </Section>

        <Section title="Adult content">
          <Row>
            <Text style={styles.rowLabel}>NSFW mode</Text>
            <Switch
              value={prefs.nsfw_mode}
              onValueChange={(v) => togglePref("nsfw_mode", v)}
              trackColor={{ true: color.nsfw, false: color.hairline }}
            />
          </Row>
          <Text style={styles.sectionHint}>
            Fully isolated from the main feed — a separate pool, separate ranking history. Off by
            default on every fresh install.
          </Text>
        </Section>

        <Section title="Autoplay">
          <Row>
            <Text style={styles.rowLabel}>Start videos muted</Text>
            <Switch
              value={prefs.autoplay_muted}
              onValueChange={(v) => togglePref("autoplay_muted", v)}
              trackColor={{ true: color.learn, false: color.hairline }}
            />
          </Row>
        </Section>

        <Section title={`Sources (${sources.length})`}>
          {sources.map((s) => (
            <View key={s.id} style={styles.sourceRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sourceLabel}>{s.label}</Text>
                <Text style={styles.sourceMeta}>
                  {s.kind.toUpperCase()} {s.is_nsfw ? "\u00b7 NSFW" : ""}
                  {s.last_error ? " \u00b7 last poll failed" : ""}
                </Text>
              </View>
              <Switch
                value={s.enabled}
                onValueChange={(v) => toggleSource(s.id, v)}
                trackColor={{ true: color.learn, false: color.hairline }}
              />
              <Pressable onPress={() => removeSource(s.id, s.label)} style={styles.removeBtn} hitSlop={8}>
                <Text style={styles.removeGlyph}>{"\u2715"}</Text>
              </Pressable>
            </View>
          ))}

          {addingSource ? (
            <AddSourceForm
              buckets={buckets}
              onDone={() => {
                setAddingSource(false);
                reload();
              }}
              onCancel={() => setAddingSource(false)}
            />
          ) : (
            <Pressable style={styles.addButton} onPress={() => setAddingSource(true)}>
              <Text style={styles.addButtonText}>+ ADD SOURCE</Text>
            </Pressable>
          )}
        </Section>
      </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

const KINDS = ["rss", "peertube", "reddit", "youtube", "newsapi", "direct"] as const;
const DEFAULT_CONFIG_BY_KIND: Record<(typeof KINDS)[number], string> = {
  rss: '{"url":"https://"}',
  peertube: '{"instance":"tilvids.com","filter":"local"}',
  reddit: '{"subreddit":"programming","listing":"hot"}',
  youtube: '{"handle":"@3blue1brown"}',
  newsapi: '{"endpoint":"everything","q":"technology","language":"en","sortBy":"publishedAt"}',
  direct: '{"url":"https://","media_kind":"mp4"}',
};

function AddSourceForm({
  buckets,
  onDone,
  onCancel,
}: {
  buckets: TopicBucket[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<(typeof KINDS)[number]>("rss");
  const [label, setLabel] = useState("");
  const [configText, setConfigText] = useState(DEFAULT_CONFIG_BY_KIND.rss);
  const [bucket, setBucket] = useState(buckets[0]?.key ?? "");
  const [isNsfw, setIsNsfw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(configText);
    } catch {
      setError("Config must be valid JSON.");
      return;
    }
    if (!label.trim()) {
      setError("Give it a label.");
      return;
    }

    setSaving(true);
    setError(null);
    const { error: dbError } = await supabase.from("sources").insert({
      kind,
      label: label.trim(),
      config,
      default_bucket: bucket || null,
      is_nsfw: isNsfw,
    });
    setSaving(false);

    if (dbError) {
      setError(dbError.message);
      return;
    }
    onDone();
  };

  return (
    <View style={styles.addForm}>
      <View style={styles.kindPicker}>
        {KINDS.map((k) => (
          <Pressable
            key={k}
            style={[styles.kindChip, kind === k && styles.kindChipActive]}
            onPress={() => {
              setKind(k);
              setConfigText((current) =>
                current === DEFAULT_CONFIG_BY_KIND[kind] ? DEFAULT_CONFIG_BY_KIND[k] : current,
              );
            }}
          >
            <Text style={[styles.kindChipText, kind === k && styles.kindChipTextActive]}>
              {k.toUpperCase()}
            </Text>
          </Pressable>
        ))}
      </View>

      <TextInput
        style={styles.input}
        placeholder="Label (e.g. r/programming)"
        placeholderTextColor={color.textFaint}
        value={label}
        onChangeText={setLabel}
      />

      <TextInput
        style={[styles.input, styles.inputMulti]}
        placeholder="Config JSON — shape depends on kind, see docs"
        placeholderTextColor={color.textFaint}
        value={configText}
        onChangeText={setConfigText}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
      />

      <View style={styles.kindPicker}>
        {buckets.map((b) => (
          <Pressable
            key={b.key}
            style={[styles.kindChip, bucket === b.key && styles.kindChipActive]}
            onPress={() => setBucket(b.key)}
          >
            <Text style={[styles.kindChipText, bucket === b.key && styles.kindChipTextActive]}>
              {b.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <Row>
        <Text style={styles.rowLabel}>Mark as NSFW</Text>
        <Switch value={isNsfw} onValueChange={setIsNsfw} trackColor={{ true: color.nsfw, false: color.hairline }} />
      </Row>

      {error && <Text style={styles.formError}>{error}</Text>}

      <View style={styles.formActions}>
        <Pressable style={styles.formCancel} onPress={onCancel}>
          <Text style={styles.formCancelText}>CANCEL</Text>
        </Pressable>
        <Pressable style={styles.formSave} onPress={save} disabled={saving}>
          <Text style={styles.formSaveText}>{saving ? "SAVING\u2026" : "SAVE SOURCE"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.base },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: space.lg,
    paddingTop: space.xxl,
    paddingBottom: space.md,
  },
  screenTitle: { ...type.display, fontSize: scale.lg, color: color.text, letterSpacing: 2 },
  closeGlyph: { color: color.text, fontSize: scale.base },
  scroll: { padding: space.lg, paddingBottom: space.xxl },
  section: { marginBottom: space.xl },
  sectionTitle: { ...type.meta, fontSize: scale.xs, color: color.textDim, marginBottom: space.md },
  sectionHint: { ...type.body, fontSize: scale.sm, color: color.textFaint, marginBottom: space.md, lineHeight: scale.sm * 1.4 },
  faderRow: { flexDirection: "row", flexWrap: "wrap", gap: space.lg, justifyContent: "flex-start" },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: space.sm,
  },
  rowLabel: { ...type.body, fontSize: scale.base, color: color.text },
  sourceRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.hairline,
    gap: space.sm,
  },
  sourceLabel: { ...type.bodyMedium, fontSize: scale.base, color: color.text },
  sourceMeta: { ...type.meta, fontSize: scale.xs, color: color.textFaint, marginTop: 2 },
  removeBtn: { padding: space.xs },
  removeGlyph: { color: color.textFaint, fontSize: scale.sm },
  addButton: {
    marginTop: space.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.hairline,
    borderStyle: "dashed",
    borderRadius: radius.md,
    paddingVertical: space.md,
    alignItems: "center",
  },
  addButtonText: { ...type.meta, fontSize: scale.xs, color: color.learn },
  addForm: {
    marginTop: space.md,
    backgroundColor: color.surface,
    borderRadius: radius.md,
    padding: space.md,
  },
  kindPicker: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginBottom: space.md },
  kindChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.hairline,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  kindChipActive: { borderColor: color.learn, backgroundColor: "rgba(79,209,197,0.12)" },
  kindChipText: { ...type.meta, fontSize: scale.xs, color: color.textDim },
  kindChipTextActive: { color: color.learn },
  input: {
    ...type.body,
    fontSize: scale.base,
    color: color.text,
    backgroundColor: color.surfaceRaised,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    marginBottom: space.md,
  },
  inputMulti: { minHeight: 72, textAlignVertical: "top" },
  formError: { ...type.body, fontSize: scale.sm, color: color.danger, marginBottom: space.sm },
  formActions: { flexDirection: "row", justifyContent: "flex-end", gap: space.md },
  formCancel: { paddingVertical: space.sm, paddingHorizontal: space.md },
  formCancelText: { ...type.meta, fontSize: scale.xs, color: color.textFaint },
  formSave: {
    backgroundColor: color.learn,
    borderRadius: radius.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
  },
  formSaveText: { ...type.meta, fontSize: scale.xs, color: color.base },
});
