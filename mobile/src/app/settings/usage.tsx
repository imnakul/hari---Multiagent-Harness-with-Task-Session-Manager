import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { useConnection } from "@/features/connection/ConnectionProvider";
import { AccountUsage } from "@/features/models/AccountPicker";
import type { AccountUsageSnapshot } from "@/features/models/useAccountUsage";
import { SettingsPage } from "@/features/settings/SettingsUI";
import { useWorkspace } from "@/features/workspace/WorkspaceProvider";
import { Icon } from "@/ui/Icon";
import { radii, themedStyles, useColors } from "@/ui/theme";

type UsageProvider = {
  provider: string;
  label: string;
  accounts: { id: string; label: string; usage: AccountUsageSnapshot }[];
};

/**
 * Fork (Hari, L-296): Settings → Usage. Every provider and account with
 * usage on the computer — 5-hour, weekly and (Command Code, OpenCode Go)
 * monthly — with a refresh button and pull to refresh.
 */
export default function UsageScreen() {
  const colors = useColors();
  const styles = useStyles();
  const { command, connected } = useConnection();
  const projectId = useWorkspace().projects[0]?.id;
  const [providers, setProviders] = useState<UsageProvider[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    (refresh: boolean) => {
      if (!projectId) {
        setError("Open a project on the computer to see usage.");
        return;
      }
      setLoading(true);
      setError(null);
      command<{ providers: UsageProvider[] }>("usage.all", { projectId, ...(refresh ? { refresh: true } : {}) })
        .then((answer) => setProviders(Array.isArray(answer.providers) ? answer.providers : []))
        .catch((reason: unknown) => {
          const message = reason instanceof Error ? reason.message : String(reason);
          setError(
            message === "Unsupported mobile operation"
              ? "Update the desktop app to show usage here."
              : "Couldn't load usage. Try again.",
          );
        })
        .finally(() => setLoading(false));
    },
    [command, projectId],
  );

  useEffect(() => {
    if (!connected) return;
    // The first read starts after this render, not inside it.
    const timer = setTimeout(() => load(false), 0);
    return () => clearTimeout(timer);
  }, [connected, load]);

  return (
    <SettingsPage onRefresh={() => load(true)} refreshing={loading && providers !== null}>
      <View style={styles.top}>
        <Text style={styles.intro}>Plan usage from the computer’s signed-in providers.</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh usage"
          disabled={loading}
          onPress={() => load(true)}
          hitSlop={8}
          style={({ pressed }) => [styles.refresh, pressed && { opacity: 0.6 }]}
        >
          {loading ? (
            <ActivityIndicator size="small" color={colors.muted} />
          ) : (
            <Icon name="refresh" size={18} color={colors.muted} />
          )}
        </Pressable>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!connected && !providers ? <Text style={styles.intro}>Connect to your computer to see usage.</Text> : null}
      {providers && providers.length === 0 ? (
        <Text style={styles.intro}>No provider with usage is signed in on the computer.</Text>
      ) : null}
      {providers?.map((provider) => (
        <View key={provider.provider}>
          <Text style={styles.heading}>{provider.label}</Text>
          <View style={styles.card}>
            {provider.accounts.map((account, index) => (
              <View key={account.id}>
                {index > 0 ? <View style={styles.divider} /> : null}
                <View style={styles.account}>
                  {provider.accounts.length > 1 || account.label !== provider.label ? (
                    <View style={styles.accountTitle}>
                      <Text style={styles.name} numberOfLines={1}>
                        {account.label}
                      </Text>
                      <Text style={styles.status}>{account.usage.status.label}</Text>
                    </View>
                  ) : null}
                  <AccountUsage snapshot={account.usage} loading={loading} failed={false} />
                </View>
              </View>
            ))}
          </View>
        </View>
      ))}
    </SettingsPage>
  );
}

const useStyles = themedStyles((colors) => ({
  top: { flexDirection: "row", alignItems: "center", gap: 12, marginHorizontal: 16, marginTop: 8 },
  intro: { flex: 1, color: colors.muted, fontSize: 13, lineHeight: 18, marginHorizontal: 16, marginTop: 8 },
  refresh: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  error: { color: colors.deletions, fontSize: 13, marginHorizontal: 16, marginTop: 12 },
  heading: { color: colors.muted, fontSize: 15, marginTop: 24, marginBottom: 8, marginLeft: 16 },
  card: { backgroundColor: colors.surface, borderRadius: radii.card, paddingHorizontal: 16 },
  account: { paddingVertical: 12, gap: 8 },
  accountTitle: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { flex: 1, color: colors.content, fontSize: 15 },
  status: { color: colors.muted, fontSize: 12 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.stroke },
}));
