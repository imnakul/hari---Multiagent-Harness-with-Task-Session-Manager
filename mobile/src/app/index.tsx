import { Redirect, router } from "expo-router";
import { useConnection } from "@/features/connection/ConnectionProvider";
import { readLastPlace } from "@/features/workspace/lastPlace";
import { Pressable, Text, View } from "react-native";
import { useWorkspace } from "@/features/workspace/WorkspaceProvider";
import { SessionScreen } from "@/features/sessions/SessionScreen";
import { useConnectionStyles } from "@/features/connection/ConnectScreen";
import { useAppLayout } from "@/features/settings/appLayout";
import { readTabsMemory, tabRoute } from "@/features/tabs/tabsMemory";
import { MonoHome } from "@/features/workspace/MonoHome";
export default function Index() {
  const [layout] = useAppLayout();
  // Monos only: the list of them, each chat pushed over it.
  if (layout === "monos")
    return <MonoHome />;
  if (layout === "tabs") return <TabsIndex />;
  return <WorkspaceIndex />;
}

/** Fork (Hari, L-412): the Tabs layout opens on the tab left last, else Sessions. */
function TabsIndex() {
  const fingerprint = useConnection().pairing?.desktop.fingerprint ?? "";
  const { tab } = readTabsMemory(fingerprint);
  return <Redirect href={`/(tabs)/${tabRoute(tab)}`} />;
}

function WorkspaceIndex() {
  const styles = useConnectionStyles();
  const { projects, monos } = useWorkspace();
  // Back where the user last was, while it is still on the phone.
  const last = readLastPlace(useConnection().pairing?.desktop.fingerprint);
  if (last?.kind === "project" && projects.some((project) => project.id === last.id))
    return (
      <Redirect href={{ pathname: "/project/[projectId]", params: { projectId: last.id } }} />
    );
  if (last?.kind === "mono" && monos.some((mono) => mono.id === last.id))
    return <Redirect href={{ pathname: "/mono/[monoId]", params: { monoId: last.id } }} />;
  if (projects[0])
    return (
      <Redirect
        href={{
          pathname: "/project/[projectId]",
          params: { projectId: projects[0].id },
        }}
      />
    );
  if (monos[0])
    return (
      <Redirect
        href={{ pathname: "/mono/[monoId]", params: { monoId: monos[0].id } }}
      />
    );
  return (
    <SessionScreen title="Workspace">
      <View style={[styles.screen, { justifyContent: "center", gap: 24 }]}>
        <Text style={styles.title}>Make yourself at home.</Text>
        <Text style={styles.subtitle}>
          Choose the projects and monos you want on your phone.
        </Text>
        <Pressable
          style={styles.primary}
          onPress={() => router.push("/settings")}
        >
          <Text style={styles.primaryLabel}>Choose workspace</Text>
        </Pressable>
      </View>
    </SessionScreen>
  );
}
