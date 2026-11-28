import { Icon } from "@/ui/Icon";
import { LiquidView } from "@/ui/LiquidView";
import { themedStyles, useColors } from "@/ui/theme";

export const PLUS_SIZE = 48;

/** Fork (Hari, L-412): the Sessions and Monos tabs' new button, beside the arc for the right thumb. */
export function PlusButton({ label, onPress }: { label: string; onPress: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <LiquidView
      onPress={onPress}
      accessibilityLabel={label}
      borderRadius={16}
      pressedScale={0.92}
      haptics
      innerStyle={styles.button}
    >
      <Icon name="add" size={22} color={colors.accent} />
    </LiquidView>
  );
}

const useStyles = themedStyles(() => ({
  button: { width: PLUS_SIZE, height: PLUS_SIZE },
}));
