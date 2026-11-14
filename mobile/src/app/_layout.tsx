import {
  DarkTheme,
  DefaultTheme,
  Stack,
  ThemeProvider,
  type NativeStackNavigationOptions,
} from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  ConnectionProvider,
  useConnection,
} from "@/features/connection/ConnectionProvider";
import { WorkspaceGate } from "@/features/connection/WorkspaceGate";

import { SessionNotifications } from "@/features/notifications/SessionNotifications";
import { LinkStreamSync } from "@/features/link/LinkStreamSync";
import { NotificationFeedSync } from "@/features/notifications/NotificationFeedSync";
import { PanelActions } from "@/features/notifications/PanelActions";
import { ShareSync } from "@/features/share/ShareSync";
import { PcSync } from "@/features/pc/PcSync";
import { LiveUpdates } from "@/features/liveUpdates/LiveUpdates";
import { HariUpdatePrompt } from "@/features/updates/HariUpdatePrompt";
import { SessionActivity } from "@/features/sessions/SessionActivity";
import { SessionFrame } from "@/features/sessions/SessionScreen";
import { WorkspaceDrawer } from "@/features/workspace/WorkspaceDrawer";
import { WorkspaceProvider } from "@/features/workspace/WorkspaceProvider";
import { WorkspaceLayout } from "@/features/workspace/WorkspaceLayout";
import { Timed } from "@/ui/Timed";
import {
  codeScreenOptions,
  HEADER_OWN_BLUR,
  modalStackOptions,
} from "@/features/files/codeScreen";
import { applySavedAppearance } from "@/features/settings/appearance";
import { modalSheetOptions } from "@/ui/ModalSheet";
import { useLayoutChanging, useMonoOnlyLayout } from "@/features/settings/monoOnly";
import { DitherLoading } from "@/ui/DitherLoading";
import { useState, type ReactElement } from "react";
import { ScenePagerHost } from "@/ui/ScenePager";
import { Backdrop, BackdropReading } from "@/features/wallpaper/Backdrop";
import { isReadingRoute } from "@/features/wallpaper/reading";
import { useNavigationButtons } from "@/ui/systemBars";
import {
  paletteFor,
  useLook,
  useScheme,
  type Palette,
  type Scheme,
} from "@/ui/theme";

// Light or dark as set in settings, or as the phone is.
applySavedAppearance();

const navigationTheme = (scheme: Scheme, colors: Palette) => {
  const base = scheme === "dark" ? DarkTheme : DefaultTheme;
  return {
    ...base,
    colors: {
      ...base.colors,
      background: colors.background,
      card: colors.background,
      primary: colors.accent,
      text: colors.content,
      border: colors.stroke,
    },
  };
};

// A project and its sessions: the native header, transparent over the
// screen's own gradual blur, which softens whatever is under it, scrolling or
// not, and fades out with no hard edge. Its buttons are native items, so they
// morph as a session is pushed.
const nativeHeader = (colors: Palette): NativeStackNavigationOptions => ({
  headerShown: true,
  headerTransparent: true,
  headerShadowVisible: false,
  headerTintColor: colors.content,
  headerBackButtonDisplayMode: "minimal",
  ...HEADER_OWN_BLUR,
  contentStyle: { backgroundColor: colors.page },
});

/** Every screen's options, in each scheme's colours. */
const screenOptions = (colors: Palette) => ({
  nativeHeader: nativeHeader(colors),
  // A session pushes over its project, with the stack's slide and swipe back.
  session: {
    ...nativeHeader(colors),
    animation: "default",
    gestureEnabled: true,
  } satisfies NativeStackNavigationOptions,
  // A Mono's session over its chat: a session's header, presented as a
  // modal the way a file opens.
  sessionSheet: {
    ...nativeHeader(colors),
    presentation: "modal",
    animation: "default",
    gestureEnabled: true,
  } satisfies NativeStackNavigationOptions,
  // A modal sheet with its own stack, as ModalSheet draws it.
  sheet: modalSheetOptions(colors.sheet),
  // Full-screen modals with their own stacks and headers.
  modal: {
    presentation: "modal",
    animation: "default",
    contentStyle: { backgroundColor: colors.sheetPage },
  } satisfies NativeStackNavigationOptions,
  // A modal of one screen, as a modal stack's are: a transparent native
  // header over the sheet's colour, with the screen's own gradual blur.
  page: {
    presentation: "modal",
    animation: "default",
    ...modalStackOptions(colors),
  } satisfies NativeStackNavigationOptions,
  code: codeScreenOptions(colors),
  // Changes over a session: a code screen's modal, on the page's own colour
  // so its bottom blur matches.
  changes: {
    ...codeScreenOptions(colors),
    contentStyle: { backgroundColor: colors.background },
  } satisfies NativeStackNavigationOptions,
});

type NavigationLook = {
  navigation: ReturnType<typeof navigationTheme>;
  screens: ReturnType<typeof screenOptions>;
};

// Built the first time a scheme and look are drawn, and kept, so the
// navigators see the same objects until either changes.
const looks = new Map<Palette, NavigationLook>();

/** The navigation theme and screen options of the scheme and look in use. */
function useNavigationLook(): NavigationLook {
  const scheme = useScheme();
  const colors = paletteFor(scheme, useLook());
  let look = looks.get(colors);
  if (!look) {
    look = {
      navigation: navigationTheme(scheme, colors),
      screens: screenOptions(colors),
    };
    looks.set(colors, look);
  }
  return look;
}

export default function RootLayout() {
  const scheme = useScheme();
  useNavigationButtons(scheme);
  return (
    <KeyboardProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <ThemeProvider value={useNavigationLook().navigation}>
          <SafeAreaProvider>
            <ConnectionProvider>
              <StatusBar style={scheme === "dark" ? "light" : "dark"} />
              <WorkspaceGate>
                <LinkedWorkspace />
              </WorkspaceGate>
            </ConnectionProvider>
          </SafeAreaProvider>
        </ThemeProvider>
      </GestureHandlerRootView>
    </KeyboardProvider>
  );
}

function LinkedWorkspace() {
  const connection = useConnection();
  const { screens } = useNavigationLook();
  // Monos only: no drawer, and the frame stands aside for the list and for
  // each chat's own frame.
  const [monoOnly] = useMonoOnlyLayout();
  // Switching layouts: covered while the app starts over in the new one.
  const changing = useLayoutChanging();
  const [covered, setCovered] = useState(changing);
  if (changing && !covered) setCovered(true);
  return (
    <WorkspaceProvider key={connection.pairing?.desktop.deviceId}>
      <SessionNotifications />
      {/* Fork (Hari, L-275): the desktop bell's history. */}
      <NotificationFeedSync />
      {/* Fork (Hari, L-278): Approve, Deny and Reply on those notifications. */}
      <PanelActions />
      {/* Fork (Hari, L-277): the always-open event stream to the computer. */}
      <LinkStreamSync />
      {/* Fork (Hari, L-279): Share with the computer (after the stream). */}
      <ShareSync />
      {/* Fork (Hari, L-280): Find my phone, phone stats, Wake-on-LAN cards. */}
      <PcSync />
      <LiveUpdates />
      <HariUpdatePrompt />
      <SessionActivity />
      <WorkspaceLayout sidebar={!monoOnly}>
        <ScenePagerHost drawer={monoOnly ? undefined : <WorkspaceDrawer />}>
          <Timed id="persistent frame">
            <SessionFrame standAside={monoOnly}>
              {/* A native stack: sessions push over their project, and the
                  code screens, Changes, settings, the model picker and the project
                  picker present
                  over the rest as native modals; everything else swaps in place,
                  as a plain slot did. */}
              <Stack
                screenOptions={{ headerShown: false, animation: "none" }}
                screenLayout={WallpaperLayout}
              >
                {/* Monos only: the list and each chat under native headers, a
                    chat pushing over the list as a session does over its
                    project, its buttons morphing as it goes. */}
                <Stack.Screen
                  name="index"
                  options={monoOnly ? screens.nativeHeader : {}}
                />
                <Stack.Screen
                  name="mono/[monoId]"
                  options={monoOnly ? screens.session : {}}
                />
                <Stack.Screen name="file" options={screens.code} />
                <Stack.Screen name="document" options={screens.code} />
                <Stack.Screen name="diff" options={screens.code} />
                <Stack.Screen
                  name="project/[projectId]/index"
                  options={screens.nativeHeader}
                />
                <Stack.Screen
                  name="project/[projectId]/session/[sessionId]"
                  options={screens.session}
                />
                <Stack.Screen name="session" options={screens.sessionSheet} />
                <Stack.Screen name="projects" options={screens.modal} />
                <Stack.Screen name="settings" options={screens.modal} />
                <Stack.Screen name="mono-new" options={screens.page} />
                <Stack.Screen name="mono-profile/[monoId]" options={screens.sheet} />
                <Stack.Screen name="models" options={screens.modal} />
                {/* Fork (Hari, L-236): the desktop's Tasks and Notes. */}
                <Stack.Screen name="tasks" options={screens.modal} />
                <Stack.Screen name="notes" options={screens.modal} />
                {/* Fork (Hari, L-275): the desktop bell's history. */}
                <Stack.Screen name="notifications" options={screens.modal} />
                <Stack.Screen name="share" options={screens.modal} />
                <Stack.Screen name="computer" options={screens.modal} />
                <Stack.Screen name="changes" options={screens.changes} />
              </Stack>
            </SessionFrame>
          </Timed>
        </ScenePagerHost>
      </WorkspaceLayout>
      {covered ? (
        <DitherLoading leaving={!changing} onGone={() => setCovered(false)} />
      ) : null}
    </WorkspaceProvider>
  );
}

// Drawn on solid sheets: code and Changes. Modals with stacks of their own
// draw it behind each of their screens instead (see sheetScreenLayout).
const SOLID_ROUTES = new Set([
  "file",
  "document",
  "diff",
  "changes",
  "settings",
  "projects",
  "models",
  "tasks",
  "notes",
  "notifications",
  "mono-profile/[monoId]",
]);

/**
 * Fork (Hari, L-245): each screen over its own copy of the wallpaper, so a
 * screen pushed over another covers it as a solid page would. Screens are
 * clear (`page` in ui/theme) only while a wallpaper is set; without one,
 * Backdrop draws nothing.
 */
function WallpaperLayout({
  route,
  children,
}: {
  route: { name: string };
  children: ReactElement;
}) {
  if (SOLID_ROUTES.has(route.name)) return children;
  const reading = isReadingRoute(route.name);
  return (
    <BackdropReading value={reading}>
      <Backdrop reading={reading} />
      {children}
    </BackdropReading>
  );
}
