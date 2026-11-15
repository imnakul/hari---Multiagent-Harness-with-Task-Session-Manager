// Fork (Hari, L-303): Expo Router's entry, plus the share sheet's background
// task (Headless JS), which Android runs with no window when Hari's code
// isn't running. Loaded only when the task runs.
import "expo-router/entry";
import { AppRegistry } from "react-native";

AppRegistry.registerHeadlessTask("HariShareSend", () => async () => {
  const { runShareTask } = await import("./src/features/share/shareHeadless");
  await runShareTask();
});
