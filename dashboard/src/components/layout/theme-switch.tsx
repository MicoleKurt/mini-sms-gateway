"use client";

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { PresetGroup, type Preset } from "@/components/ui/preset-group";

type ThemeChoice = "light" | "dark" | "system";

const OPTIONS: readonly Preset<ThemeChoice>[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

const subscribeToNothing = () => () => {};

/** True after hydration. The stored theme is only known in the browser. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
}

function isThemeChoice(value: string | undefined): value is ThemeChoice {
  return OPTIONS.some((option) => option.value === value);
}

/** Light, Dark or System. Until hydration none is shown as current, so server and client HTML agree. */
export function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  const hydrated = useHydrated();
  const current = hydrated && isThemeChoice(theme) ? theme : null;

  return <PresetGroup label="Theme" options={OPTIONS} value={current} onChange={setTheme} />;
}
