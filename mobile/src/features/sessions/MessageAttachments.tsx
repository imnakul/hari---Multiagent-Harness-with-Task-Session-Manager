import { Image } from "expo-image";
import { use, useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useConnection } from "@/features/connection/ConnectionProvider";
import type { SentAttachment } from "@/features/workspace/types";
import { Icon } from "@/ui/Icon";
import { themedStyles, useColors, withAlpha } from "@/ui/theme";

import { loadAttachmentImage, type AttachmentImageSize } from "./attachmentImages";
import { TranscriptConversation } from "./transcriptConversation";

const TILE = 72;

type ImageState =
  | { status: "loading" }
  | { status: "ready"; uri: string }
  | { status: "error"; message: string };

function useAttachmentImage(
  messageId: string,
  file: SentAttachment,
  size: AttachmentImageSize,
): ImageState {
  const conversationId = use(TranscriptConversation);
  const { command } = useConnection();
  const key = `${conversationId ?? ""}\n${messageId}\n${file.id}\n${size}`;
  // The result is kept with the request it answers, so a recycled row shows
  // loading for its new image rather than the previous one.
  const [settled, setSettled] = useState<{ key: string; state: ImageState } | null>(null);
  useEffect(() => {
    if (!conversationId) return;
    let disposed = false;
    loadAttachmentImage(command, conversationId, messageId, file.id, size).then(
      (uri) => {
        if (!disposed) setSettled({ key, state: { status: "ready", uri } });
      },
      (reason: unknown) => {
        if (!disposed)
          setSettled({
            key,
            state: {
              status: "error",
              message: reason instanceof Error ? reason.message : "Couldn't load this image.",
            },
          });
      },
    );
    return () => {
      disposed = true;
    };
  }, [command, conversationId, messageId, file.id, size, key]);
  if (!conversationId) return { status: "error", message: "Open this chat on its own to see images." };
  return settled?.key === key ? settled.state : { status: "loading" };
}

/**
 * Fork (Hari, L-268): the files a message was sent with. Images show as
 * thumbnails that open full screen; other files show their name. A desktop
 * too old to list them sends only a count, shown as before.
 */
export function MessageAttachments({
  messageId,
  count,
  files,
}: {
  messageId: string;
  count: number;
  files?: SentAttachment[];
}) {
  const styles = useStyles();
  const [opened, setOpened] = useState<SentAttachment | null>(null);
  if (!files?.length) {
    return (
      <Text style={styles.count}>{count === 1 ? "1 attachment" : `${count} attachments`}</Text>
    );
  }
  return (
    <View style={styles.row}>
      {files.map((file) =>
        file.kind === "image" ? (
          <ImageTile key={file.id} messageId={messageId} file={file} onOpen={() => setOpened(file)} />
        ) : (
          <FileChip key={file.id} file={file} />
        ),
      )}
      {opened ? (
        <ImageViewer messageId={messageId} file={opened} onClose={() => setOpened(null)} />
      ) : null}
    </View>
  );
}

function ImageTile({
  messageId,
  file,
  onOpen,
}: {
  messageId: string;
  file: SentAttachment;
  onOpen: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const image = useAttachmentImage(messageId, file, "thumb");
  if (image.status === "error") {
    return (
      <View
        style={[styles.tile, styles.tileEmpty]}
        accessible
        accessibilityLabel={`${file.name}: ${image.message}`}
      >
        <Icon name="image" size={22} color={colors.faint} />
      </View>
    );
  }
  return (
    <Pressable
      onPress={onOpen}
      disabled={image.status !== "ready"}
      accessibilityRole="imagebutton"
      accessibilityLabel={`Open image ${file.name}`}
      accessibilityState={{ busy: image.status === "loading" }}
      style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
    >
      {image.status === "ready" ? (
        <Image
          source={{ uri: image.uri }}
          contentFit="cover"
          cachePolicy="memory"
          transition={150}
          style={StyleSheet.absoluteFill}
          accessible={false}
        />
      ) : null}
    </Pressable>
  );
}

function FileChip({ file }: { file: SentAttachment }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.chip} accessible accessibilityLabel={`Attached file ${file.name}`}>
      <Icon name="file" size={16} color={colors.muted} />
      <Text style={styles.chipName} numberOfLines={1} ellipsizeMode="middle">
        {file.name}
      </Text>
    </View>
  );
}

function ImageViewer({
  messageId,
  file,
  onClose,
}: {
  messageId: string;
  file: SentAttachment;
  onClose: () => void;
}) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const full = useAttachmentImage(messageId, file, "full");
  // The thumbnail is already cached, so it fills the screen while the larger one loads.
  const thumb = useAttachmentImage(messageId, file, "thumb");
  const uri = full.status === "ready" ? full.uri : thumb.status === "ready" ? thumb.uri : null;
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={styles.viewer}>
        {uri ? (
          <Image
            source={{ uri }}
            contentFit="contain"
            cachePolicy="memory"
            style={styles.viewerImage}
            accessibilityLabel={file.name}
          />
        ) : null}
        <View style={[styles.viewerBar, { paddingTop: insets.top + 8 }]}>
          <Text style={styles.viewerName} numberOfLines={1} ellipsizeMode="middle">
            {file.name}
          </Text>
          <Pressable
            onPress={onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Close image"
            style={({ pressed }) => [styles.viewerClose, pressed && styles.tilePressed]}
          >
            <Icon name="close" size={20} color="#ffffff" />
          </Pressable>
        </View>
        {full.status === "error" && !uri ? (
          <Text style={[styles.viewerError, { bottom: insets.bottom + 32 }]} accessibilityRole="alert">
            {full.message}
          </Text>
        ) : null}
      </View>
    </Modal>
  );
}

const useStyles = themedStyles((colors) => ({
  count: {
    color: colors.muted,
    fontSize: 13,
    marginBottom: 4,
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 2,
    marginBottom: 6,
  },
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: 10,
    borderCurve: "continuous",
    overflow: "hidden",
    backgroundColor: colors.fill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.stroke,
  },
  tileEmpty: {
    alignItems: "center",
    justifyContent: "center",
  },
  tilePressed: {
    opacity: 0.7,
    transform: [{ scale: 0.96 }],
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: 200,
    minHeight: 32,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderCurve: "continuous",
    backgroundColor: colors.fill,
  },
  chipName: {
    flexShrink: 1,
    color: colors.content,
    fontSize: 13,
  },
  viewer: {
    flex: 1,
    backgroundColor: "#000000",
  },
  viewerImage: {
    flex: 1,
  },
  viewerBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 8,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },
  viewerName: {
    flex: 1,
    color: "#ffffff",
    fontSize: 15,
  },
  viewerClose: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
    backgroundColor: withAlpha("#ffffff", 0.14),
  },
  viewerError: {
    position: "absolute",
    left: 24,
    right: 24,
    color: "#ffffff",
    fontSize: 14,
    textAlign: "center",
  },
}));
