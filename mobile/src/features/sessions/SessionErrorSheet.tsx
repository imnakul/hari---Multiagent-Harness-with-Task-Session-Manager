import { BottomSheet, RNHostView } from "@expo/ui";
import { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useConnection } from "@/features/connection/ConnectionProvider";
import { Icon } from "@/ui/Icon";
import { useWorkspace } from "@/features/workspace/WorkspaceProvider";
import { LiquidView } from "@/ui/LiquidView";
import { themedStyles, useColors, withAlpha } from "@/ui/theme";

import { sessionErrorContent } from "./sessionError";

/** One sheet per transcript, outside the virtualized rows so it stays mounted. */
export function SessionErrorSheet({
  message,
  isPresented,
  onDismiss,
  conversationId,
}: {
  message: string;
  isPresented: boolean;
  onDismiss: () => void;
  /** Offers Stop Claude for an Interactive Claude refusal (L-235). */
  conversationId?: string;
}) {
  const colors = useColors();
  const styles = useStyles();
  const { width, height } = useWindowDimensions();
  const { bottom } = useSafeAreaInsets();
  const content = sessionErrorContent(message);
  const { stop } = useWorkspace();
  const { command } = useConnection();
  const terminalId = content.stopClaude && isPresented ? conversationId : undefined;
  // Fork (Hari, L-304): Claude's native terminal on the computer, its last
  // lines read every 1.5 s while the sheet is up. Null until the first read,
  // and when the computer has no terminal (or predates this).
  const [terminal, setTerminal] = useState<{ id: string; lines: string[] } | null>(null);
  const [acting, setActing] = useState(false);
  useEffect(() => {
    if (!terminalId) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        const answer = await command<{ terminal?: { lines?: unknown } | null }>("session.terminal", {
          conversationId: terminalId,
        });
        const lines = answer.terminal?.lines;
        if (live) setTerminal(Array.isArray(lines) ? { id: terminalId, lines: lines.map(String) } : null);
      } catch {
        if (live) setTerminal(null);
      }
      if (live) timer = setTimeout(read, 1500);
    };
    void read();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [terminalId, command]);
  const shown = terminal && terminal.id === terminalId ? terminal.lines : null;
  const act = (method: string, params: object, after?: () => void) => {
    if (!conversationId || acting) return;
    setActing(true);
    command(method, { conversationId, ...params })
      .then(() => after?.())
      .catch((reason: unknown) =>
        Alert.alert("Couldn’t do that", reason instanceof Error ? reason.message : String(reason)),
      )
      .finally(() => setActing(false));
  };
  const stopClaude = content.stopClaude && conversationId
    ? () => Alert.alert(
        "Stop Claude?",
        "Anything Claude is doing on your computer right now is cancelled.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Stop Claude",
            style: "destructive",
            onPress: () => {
              onDismiss();
              stop(conversationId).catch((reason: unknown) =>
                Alert.alert("Could not stop", reason instanceof Error ? reason.message : String(reason)),
              );
            },
          },
        ],
      )
    : undefined;
  return (
    <BottomSheet
      isPresented={isPresented}
      onDismiss={onDismiss}
      contentPadding={0}
      containerColor={colors.sheet}
    >
      <RNHostView matchContents={{ vertical: true }}>
        <View style={[styles.sheet, { width, paddingBottom: Math.max(bottom, 16) + 8 }]}>
          <View style={styles.badge}>
            <Icon name={content.stopClaude ? "computer" : content.recovery ? "lock" : "chat"} size={30} color={colors.accent} />
          </View>
          <Text accessibilityRole="header" style={styles.title}>{content.title}</Text>
          <ScrollView
            style={[styles.details, { maxHeight: height * 0.35 }]}
            contentContainerStyle={styles.detailsContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.message} selectable>{content.message}</Text>
            {content.recovery ? (
              <View style={styles.recovery}>
                <Icon name="computer" size={22} color={colors.muted} />
                <View style={styles.recoveryText}>
                  <Text style={styles.recoveryTitle}>{content.recoveryTitle}</Text>
                  <Text style={styles.recoveryMessage}>{content.recovery}</Text>
                </View>
              </View>
            ) : null}
            {shown ? (
              <View accessibilityLabel="Claude’s terminal on your computer" style={styles.terminal}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <Text selectable style={styles.terminalText}>
                    {shown.length ? shown.join("\n") : " "}
                  </Text>
                </ScrollView>
              </View>
            ) : null}
          </ScrollView>
          {shown ? (
            <View style={styles.keys}>
              {(["escape", "enter"] as const).map((key) => (
                <LiquidView
                  key={key}
                  onPress={() => act("session.terminalKey", { key })}
                  accessibilityLabel={key === "escape" ? "Press Esc" : "Press Enter"}
                  pressedScale={1.03}
                  style={styles.key}
                  innerStyle={styles.buttonSurface}
                >
                  <Text style={styles.buttonLabel}>{key === "escape" ? "Esc" : "Enter"}</Text>
                </LiquidView>
              ))}
            </View>
          ) : null}
          {shown ? (
            <LiquidView
              onPress={() => act("session.terminalReturn", {}, onDismiss)}
              accessibilityLabel="Return to chat"
              pressedScale={1.03}
              style={[styles.button, styles.stopButton]}
              innerStyle={styles.buttonSurface}
            >
              <Text style={[styles.buttonLabel, { color: colors.accent }]}>Return to chat</Text>
            </LiquidView>
          ) : null}
          {stopClaude ? (
            <LiquidView
              onPress={stopClaude}
              accessibilityLabel="Stop Claude"
              pressedScale={1.03}
              style={[styles.button, styles.stopButton]}
              innerStyle={styles.buttonSurface}
            >
              <Text style={[styles.buttonLabel, { color: colors.deletions }]}>Stop Claude</Text>
            </LiquidView>
          ) : null}
          <LiquidView
            onPress={onDismiss}
            accessibilityLabel="Got it"
            pressedScale={1.03}
            style={styles.button}
            innerStyle={styles.buttonSurface}
          >
            <Text style={styles.buttonLabel}>Got it</Text>
          </LiquidView>
        </View>
      </RNHostView>
    </BottomSheet>
  );
}

const useStyles = themedStyles((colors) => ({
  sheet: {
    alignItems: "center",
    paddingTop: 32,
    paddingHorizontal: 24,
  },
  badge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: withAlpha(colors.accent, 0.09),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(colors.accent, 0.16),
    marginBottom: 20,
  },
  title: {
    color: colors.content,
    fontSize: 24,
    fontWeight: "600",
    textAlign: "center",
  },
  details: {
    alignSelf: "stretch",
    marginTop: 10,
    marginBottom: 24,
  },
  detailsContent: {
    gap: 24,
  },
  message: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 23,
    textAlign: "center",
  },
  recovery: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 16,
    borderRadius: 18,
    borderCurve: "continuous",
    backgroundColor: withAlpha(colors.content, 0.04),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.stroke,
  },
  recoveryText: {
    flex: 1,
    gap: 5,
  },
  recoveryTitle: {
    color: colors.content,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
  },
  recoveryMessage: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  button: {
    alignSelf: "stretch",
  },
  stopButton: {
    marginBottom: 10,
  },
  terminal: {
    padding: 12,
    borderRadius: 14,
    borderCurve: "continuous",
    backgroundColor: withAlpha(colors.content, 0.05),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.stroke,
  },
  terminalText: {
    color: colors.content,
    fontFamily: "monospace",
    fontSize: 11,
    lineHeight: 15,
  },
  keys: {
    flexDirection: "row",
    alignSelf: "stretch",
    gap: 10,
    marginBottom: 10,
  },
  key: {
    flex: 1,
  },
  buttonSurface: {
    minHeight: 52,
    paddingVertical: 14,
    paddingHorizontal: 24,
  },
  buttonLabel: {
    color: colors.content,
    fontSize: 16,
    fontWeight: "600",
  },
}));
