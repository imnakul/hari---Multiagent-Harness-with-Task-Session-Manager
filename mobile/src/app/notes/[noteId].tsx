import { router, Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

import { useConnection } from "@/features/connection/ConnectionProvider";
import { linkStreamLive, onLinkOutboxSettled } from "@/features/link/linkStream";
import { HeaderButton } from "@/features/files/codeScreen";
import { Markdown } from "@/features/sessions/Markdown";
import { SettingsPage } from "@/features/settings/SettingsUI";
import { parseTags, readNote, saveNote, type Command, type Note } from "@/features/tools/tools";
import { radii, themedStyles, useColors, withAlpha } from "@/ui/theme";

/** Waits this long after the last keystroke before saving, as the desktop does. */
const SAVE_DELAY_MS = 1200;

type Fields = { title: string; body: string; tags: string };
type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "failed"; message: string }
  /** Fork (Hari, L-281): waits in the link outbox; `live` while the link is up and it is on its way. */
  | { kind: "queued"; live: boolean }
  /** Changed on the desktop since this phone read it; `note` is its copy, null if deleted. */
  | { kind: "conflict"; note: Note | null };

const fieldsOf = (note: Note): Fields => ({
  title: note.title,
  body: note.body,
  tags: note.tags.join(", "),
});

// Fork (Hari, L-236): one of the desktop's notes, to read and edit. It opens to
// read (a new note to write); edits save a moment after typing stops. If the
// note changed on the computer since it opened, nothing is overwritten: the
// user picks Reload (the computer's copy) or Keep mine (save over it).
export default function NoteScreen() {
  const styles = useStyles();
  const colors = useColors();
  const { noteId, fresh } = useLocalSearchParams<{ noteId: string; fresh?: string }>();
  const run = useConnection().command as Command;
  const isNew = fresh === "1";
  const [loaded, setLoaded] = useState(isNew);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(isNew);
  const [fields, setFields] = useState<Fields>({ title: "", body: "", tags: "" });
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  /** The desktop's `updatedAt` this phone's copy is based on; null before a new note's first save. */
  const base = useRef<number | null>(null);
  const project = useRef<string | null>(null);
  const latest = useRef(fields);
  const dirty = useRef(false);
  const saving = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const conflict = useRef(false);
  /** Saved, but the note's lasting name isn't set yet; leaving sets it. */
  const unfinalized = useRef(false);
  /** A save went to the outbox: later ones follow it there, in order. */
  const viaQueue = useRef(false);
  /** The outbox item of the last queued save, until the computer answers. */
  const waiting = useRef<string | null>(null);

  useEffect(() => {
    if (isNew) return;
    let live = true;
    readNote(run, noteId).then(
      (note) => {
        if (!live) return;
        base.current = note.updatedAt;
        project.current = note.sourceCwd ?? null;
        latest.current = fieldsOf(note);
        setFields(latest.current);
        setLoaded(true);
      },
      (reason) => live && setLoadError(reason instanceof Error ? reason.message : String(reason)),
    );
    return () => {
      live = false;
    };
  }, [isNew, noteId, run]);

  // Leaving saves what's left, and gives a new note its lasting name.
  const saveRef = useRef<(force?: boolean, finalize?: boolean) => Promise<void>>(async () => {});
  const schedule = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveRef.current(), SAVE_DELAY_MS);
  }, []);
  const save = useCallback(
    async (force = false, finalize = false) => {
      clearTimeout(timer.current);
      const sent = latest.current;
      if (saving.current || (!dirty.current && !force && !(finalize && unfinalized.current))) return;
      if (conflict.current && !force) return;
      // A new note with nothing in it isn't kept.
      if (base.current === null && !sent.title.trim() && !sent.body.trim()) return;
      saving.current = true;
      dirty.current = false;
      setStatus({ kind: "saving" });
      try {
        const saved = await saveNote(run, {
          id: noteId,
          title: sent.title,
          body: sent.body,
          tags: parseTags(sent.tags),
          baseUpdatedAt: base.current,
          force,
          finalize,
          queue: viaQueue.current,
        });
        if (!saved.conflict && saved.queued) {
          // The base stays the computer's copy until the computer has it.
          viaQueue.current = true;
          waiting.current = saved.queued;
          conflict.current = false;
          unfinalized.current = !finalize;
          setStatus({ kind: "queued", live: linkStreamLive() });
        } else if (saved.conflict) {
          dirty.current = true;
          conflict.current = true;
          setStatus({ kind: "conflict", note: saved.note });
        } else {
          base.current = saved.note.updatedAt;
          conflict.current = false;
          unfinalized.current = !finalize;
          setStatus({ kind: "saved" });
        }
      } catch (reason) {
        dirty.current = true;
        setStatus({ kind: "failed", message: reason instanceof Error ? reason.message : String(reason) });
      } finally {
        saving.current = false;
      }
      // Typed while it saved: saved too, once the typing stops.
      if (dirty.current && !conflict.current && latest.current !== sent) schedule();
    },
    [noteId, run, schedule],
  );
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  // Fork (Hari, L-281): the computer's answer to a queued save. Taken: saved.
  // Refused (changed there after this edit, or deleted): the usual choice.
  useEffect(
    () =>
      onLinkOutboxSettled((answer) => {
        const id = waiting.current;
        if (!id) return;
        if (answer.accepted.includes(id)) {
          waiting.current = null;
          setStatus((now) => (now.kind === "queued" ? { kind: "saved" } : now));
          return;
        }
        const refused = answer.rejected.find((entry) => entry.id === id);
        if (!refused) return;
        waiting.current = null;
        conflict.current = true;
        dirty.current = true;
        if (/deleted/i.test(refused.error)) {
          setStatus({ kind: "conflict", note: null });
          return;
        }
        readNote(run, noteId).then(
          (note) => setStatus({ kind: "conflict", note }),
          () => setStatus({ kind: "failed", message: refused.error }),
        );
      }),
    [noteId, run],
  );
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (!conflict.current && (dirty.current || unfinalized.current)) void saveRef.current(false, true);
    },
    [],
  );

  const edit = (change: Partial<Fields>) => {
    latest.current = { ...latest.current, ...change };
    setFields(latest.current);
    dirty.current = true;
    if (!conflict.current) schedule();
  };

  const reload = () => {
    if (status.kind !== "conflict") return;
    if (!status.note) return router.back();
    base.current = status.note.updatedAt;
    viaQueue.current = false;
    latest.current = fieldsOf(status.note);
    setFields(latest.current);
    dirty.current = false;
    conflict.current = false;
    setStatus({ kind: "idle" });
  };

  const done = () => {
    void save(false, true);
    setEditing(false);
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () =>
            !loaded ? null : editing ? (
              <HeaderButton icon="check" label="Done" onPress={done} />
            ) : (
              <HeaderButton icon="edit" label="Edit" onPress={() => setEditing(true)} />
            ),
        }}
      />
      <SettingsPage>
        {loadError ? <Text style={styles.empty}>{loadError}</Text> : null}
        {!loaded && !loadError ? <ActivityIndicator style={styles.loading} color={colors.muted} /> : null}
        {status.kind === "conflict" ? (
          <View style={styles.banner}>
            <Text style={styles.bannerTitle}>
              {status.note ? "Changed on your computer" : "Deleted on your computer"}
            </Text>
            <Text style={styles.bannerText}>
              {status.note
                ? "This note changed on your computer after you opened it. Your edits aren’t saved yet."
                : "This note was deleted on your computer. Your edits aren’t saved yet."}
            </Text>
            <View style={styles.bannerButtons}>
              <BannerButton label={status.note ? "Reload" : "Discard"} onPress={reload} />
              <BannerButton
                label={status.note ? "Keep mine" : "Save again"}
                strong
                onPress={() => void save(true)}
              />
            </View>
          </View>
        ) : null}
        {loaded && editing ? (
          <View style={styles.form}>
            <TextInput
              value={fields.title}
              onChangeText={(title) => edit({ title })}
              placeholder="Title"
              placeholderTextColor={colors.faint}
              style={styles.titleInput}
              maxLength={200}
              autoFocus={isNew}
            />
            <TextInput
              value={fields.tags}
              onChangeText={(tags) => edit({ tags })}
              placeholder="Tags, e.g. idea, ui"
              placeholderTextColor={colors.faint}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.tagsInput}
            />
            <TextInput
              value={fields.body}
              onChangeText={(body) => edit({ body })}
              placeholder="Write in Markdown"
              placeholderTextColor={colors.faint}
              multiline
              scrollEnabled={false}
              textAlignVertical="top"
              style={styles.bodyInput}
            />
          </View>
        ) : loaded ? (
          <Pressable onPress={() => setEditing(true)} style={styles.read}>
            <Text style={styles.title} selectable>
              {fields.title || "Untitled"}
            </Text>
            {fields.tags ? (
              <Text style={styles.tags}>
                {parseTags(fields.tags)
                  .map((tag) => `#${tag}`)
                  .join("  ")}
              </Text>
            ) : null}
            {fields.body.trim() ? (
              <Markdown text={fields.body} />
            ) : (
              <Text style={styles.placeholder}>Empty note. Tap to write.</Text>
            )}
          </Pressable>
        ) : null}
        {loaded ? <Text style={styles.status}>{statusText(status)}</Text> : null}
      </SettingsPage>
    </>
  );
}

function statusText(status: Status) {
  switch (status.kind) {
    case "saving":
      return "Saving…";
    case "saved":
      return "Saved on your computer";
    case "queued":
      return status.live
        ? "Sending to your computer…"
        : "Saved on this phone. Goes to your computer when it’s connected.";
    case "failed":
      return `Not saved: ${status.message}`;
    default:
      return "";
  }
}

function BannerButton({ label, strong, onPress }: { label: string; strong?: boolean; onPress: () => void }) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.bannerButton, strong && styles.bannerButtonStrong, pressed && { opacity: 0.7 }]}
    >
      <Text style={[styles.bannerButtonText, strong && styles.bannerButtonTextStrong]}>{label}</Text>
    </Pressable>
  );
}

const useStyles = themedStyles((colors) => ({
  loading: { marginTop: 32 },
  empty: { color: colors.muted, fontSize: 15, textAlign: "center", marginTop: 32 },
  banner: {
    marginTop: 8,
    marginBottom: 12,
    padding: 14,
    gap: 6,
    borderRadius: radii.card,
    borderCurve: "continuous",
    backgroundColor: withAlpha(colors.caution, 0.12),
  },
  bannerTitle: { color: colors.content, fontSize: 16, fontWeight: "600" },
  bannerText: { color: colors.muted, fontSize: 14, lineHeight: 19 },
  bannerButtons: { flexDirection: "row", gap: 8, marginTop: 6 },
  bannerButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radii.pill,
    backgroundColor: withAlpha(colors.content, 0.08),
  },
  bannerButtonStrong: { backgroundColor: colors.accent },
  bannerButtonText: { color: colors.content, fontSize: 15, fontWeight: "600" },
  bannerButtonTextStrong: { color: "#ffffff" },
  form: { gap: 4, paddingHorizontal: 4 },
  titleInput: { color: colors.content, fontSize: 24, fontWeight: "700", paddingVertical: 6 },
  tagsInput: { color: colors.muted, fontSize: 15, paddingVertical: 6 },
  bodyInput: { color: colors.content, fontSize: 16, lineHeight: 23, minHeight: 240, paddingVertical: 8 },
  read: { gap: 10, paddingHorizontal: 4 },
  title: { color: colors.content, fontSize: 24, fontWeight: "700" },
  tags: { color: colors.muted, fontSize: 14 },
  placeholder: { color: colors.faint, fontSize: 16 },
  status: { color: colors.faint, fontSize: 12, marginTop: 16, paddingHorizontal: 4 },
}));
