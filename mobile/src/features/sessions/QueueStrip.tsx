import * as Haptics from "expo-haptics";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";

import { useConnection } from "@/features/connection/ConnectionProvider";
import type { QueueAction, QueueState } from "@/features/workspace/types";
import { useWorkspace } from "@/features/workspace/WorkspaceProvider";
import { Icon, type IconName } from "@/ui/Icon";
import { LiquidView } from "@/ui/LiquidView";
import { radii, themedStyles, useColors, withAlpha } from "@/ui/theme";

type Message = QueueState["messages"][number];

// Fork (Hari, L-238): the desktop's message queue, above the phone's composer
// as on the desktop: each waiting message with edit, send now and delete, and
// a Resume line when the queue is paused or held. The desktop decides; this
// sends the same actions its own buttons do.
export function QueueStrip({ conversationId, queue }: { conversationId: string; queue: QueueState }) {
  const styles = useStyles();
  const colors = useColors();
  const { connected } = useConnection();
  const { changeQueue } = useWorkspace();
  const [editingId, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const steering = queue.status === "steering";
  // A steer closes the edit box, as on the desktop.
  const editing = steering ? null : editingId;
  const editingMessage = queue.messages.find((message) => message.id === editing);
  // The message left the queue (sent, or deleted on the computer) mid-edit:
  // keep the text on screen and say why it can't be saved.
  const gone = editing !== null && !editingMessage;

  const run = async (key: string, action: QueueAction, messageId?: string, text?: string) => {
    if (busy.current) return false;
    busy.current = true;
    setWorking(key);
    setError(null);
    try {
      await changeQueue(conversationId, action, messageId, text);
      void Haptics.selectionAsync();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return false;
    } finally {
      busy.current = false;
      setWorking(null);
    }
  };

  const save = async (message: Message | undefined) => {
    if (!message) return;
    if (await run(`edit:${message.id}`, "edit", message.id, draft)) setEditing(null);
  };

  const paused = queue.status === "paused";
  const held = queue.status === "held";
  const failed = queue.messages.some((message) => message.error);
  const notice = steering
    ? "Stopping the current turn before steering"
    : held
      ? queue.holdReason || "Queue held because the last turn failed"
      : paused
        ? failed
          ? "A message couldn’t be sent"
          : queue.steer === null
            ? "Messages paused"
            : "Queue paused because you interrupted"
        : queue.steer === null
          ? queue.sendingId
            ? "Sending…"
            : "Waiting to send"
          : null;
  const offline = !connected;
  const sendLabel = queue.steer === "send-now" ? "Send now" : "Steer";

  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(140)}
      layout={LinearTransition.duration(180)}
      style={styles.card}
      accessibilityLabel="Queued messages"
    >
      <LiquidView fill row={false} borderRadius={radii.row + 6} style={StyleSheet.absoluteFill}>
        <View />
      </LiquidView>
      {notice ? (
        <View style={styles.notice} accessibilityLiveRegion="polite">
          <Text style={styles.noticeText} numberOfLines={2}>
            {notice}
          </Text>
          {paused || held ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={failed && paused ? "Retry the queue" : "Resume the queue"}
              disabled={offline || working !== null}
              onPress={() => void run("resume", "resume")}
              hitSlop={8}
              style={[styles.resume, (offline || working !== null) && styles.dimmed]}
            >
              <Text style={styles.resumeText}>
                {working === "resume" ? "Resuming…" : failed && paused ? "Retry" : "Resume"}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {queue.messages.map((message, index) => {
        const sending = steering || queue.sendingId === message.id;
        const locked = offline || sending || working !== null;
        if (editing === message.id)
          return (
            <View key={message.id} style={[styles.row, index > 0 && styles.divider]}>
              <EditBox
                draft={draft}
                onChange={setDraft}
                saving={working === `edit:${message.id}`}
                disabled={offline || sending || (!draft.trim() && message.attachments === 0)}
                onSave={() => void save(message)}
                onCancel={() => {
                  setEditing(null);
                  setError(null);
                }}
              />
            </View>
          );
        return (
          <View key={message.id} style={[styles.row, index > 0 && styles.divider]}>
            <Icon name="list" size={14} color={colors.faint} />
            <View style={styles.rowText}>
              <Text style={styles.label} numberOfLines={2}>
                {message.label}
              </Text>
              {message.error ? (
                <Text style={styles.rowError} numberOfLines={2}>
                  {message.error}
                </Text>
              ) : sending ? (
                <Text style={styles.rowHint}>Sending…</Text>
              ) : null}
            </View>
            {message.canEdit ? (
              <RowButton
                icon="edit"
                label="Edit queued message"
                disabled={locked}
                onPress={() => {
                  setEditing(message.id);
                  setDraft(message.text);
                  setError(null);
                }}
              />
            ) : null}
            {queue.steer ? (
              <RowButton
                icon="send"
                label={`${sendLabel}: ${message.label}`}
                disabled={locked}
                busy={working === `steer:${message.id}`}
                onPress={() => void run(`steer:${message.id}`, "steer", message.id)}
              />
            ) : null}
            <RowButton
              icon="trash"
              label="Delete queued message"
              disabled={locked}
              busy={working === `delete:${message.id}`}
              onPress={() => void run(`delete:${message.id}`, "delete", message.id)}
            />
          </View>
        );
      })}
      {gone ? (
        <View style={[styles.row, queue.messages.length > 0 && styles.divider]}>
          <EditBox
            draft={draft}
            onChange={setDraft}
            saving={false}
            disabled
            onSave={() => {}}
            onCancel={() => setEditing(null)}
          />
        </View>
      ) : null}
      {gone ? (
        <Text style={styles.error}>
          This message was sent or removed on your computer. Copy your text if you need it.
        </Text>
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : offline ? (
        <Text style={styles.error}>Reconnect to your computer to change the queue.</Text>
      ) : null}
    </Animated.View>
  );
}

function EditBox({
  draft,
  onChange,
  saving,
  disabled,
  onSave,
  onCancel,
}: {
  draft: string;
  onChange: (text: string) => void;
  saving: boolean;
  disabled: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.edit}>
      <TextInput
        value={draft}
        onChangeText={onChange}
        autoFocus
        multiline
        accessibilityLabel="Edit queued message"
        placeholderTextColor={colors.faint}
        style={styles.editInput}
        maxLength={100_000}
      />
      <View style={styles.editButtons}>
        <Pressable accessibilityRole="button" onPress={onCancel} hitSlop={8} style={styles.editButton}>
          <Text style={styles.editButtonText}>Cancel</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={disabled || saving}
          onPress={onSave}
          hitSlop={8}
          style={[styles.editButton, styles.saveButton, (disabled || saving) && styles.dimmed]}
        >
          <Text style={[styles.editButtonText, styles.saveText]}>{saving ? "Saving…" : "Save"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function RowButton({
  icon,
  label,
  disabled,
  busy,
  onPress,
}: {
  icon: IconName;
  label: string;
  disabled: boolean;
  busy?: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.button, pressed && styles.pressed, disabled && !busy && styles.dimmed]}
    >
      <Icon name={icon} size={17} color={busy ? colors.accent : colors.muted} />
    </Pressable>
  );
}

const useStyles = themedStyles((colors) => ({
  card: {
    marginHorizontal: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: radii.row + 6,
    borderCurve: "continuous",
    overflow: "hidden",
  },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 36,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.stroke,
  },
  noticeText: { flex: 1, color: colors.muted, fontSize: 13 },
  resume: { paddingHorizontal: 4, paddingVertical: 6 },
  resumeText: { color: colors.accent, fontSize: 14, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.stroke },
  rowText: { flex: 1, minWidth: 0, paddingVertical: 6, gap: 2 },
  label: { color: colors.content, fontSize: 14, lineHeight: 19 },
  rowHint: { color: colors.muted, fontSize: 12 },
  rowError: { color: colors.deletions, fontSize: 12 },
  button: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
  },
  pressed: { backgroundColor: withAlpha(colors.content, 0.08) },
  dimmed: { opacity: 0.4 },
  edit: { flex: 1, paddingVertical: 8, gap: 8 },
  editInput: {
    color: colors.content,
    fontSize: 15,
    lineHeight: 20,
    maxHeight: 140,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radii.row,
    backgroundColor: withAlpha(colors.content, 0.06),
  },
  editButtons: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  editButton: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radii.pill,
    backgroundColor: withAlpha(colors.content, 0.08),
  },
  saveButton: { backgroundColor: colors.accent },
  editButtonText: { color: colors.content, fontSize: 14, fontWeight: "600" },
  saveText: { color: "#ffffff" },
  error: { color: colors.muted, fontSize: 12, paddingVertical: 6 },
}));
