import { useEffect, type ReactNode } from "react";

/** React Native's Modal, reporting its close as the real one does once it's gone. */
export function MockModal({
  visible,
  children,
  onDismiss,
  role,
}: {
  visible: boolean;
  children?: ReactNode;
  onDismiss?: () => void;
  role?: string;
}) {
  useEffect(() => {
    if (!visible) onDismiss?.();
  }, [visible, onDismiss]);
  return visible ? <section role={role}>{children}</section> : null;
}

/** The same, marked as a dialog. */
export function DialogModal(props: Parameters<typeof MockModal>[0]) {
  return <MockModal {...props} role="dialog" />;
}
