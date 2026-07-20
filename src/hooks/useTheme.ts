import { useEffect, useState } from "react";

type Theme = "light" | "dark";

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("light");
  useEffect(() => {
    const stored = (localStorage.getItem("chatapp.theme") as Theme | null);
    const initial: Theme = stored || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    apply(initial);
    setThemeState(initial);
  }, []);
  const apply = (t: Theme) => {
    document.documentElement.classList.toggle("dark", t === "dark");
  };
  const setTheme = (t: Theme) => {
    apply(t);
    localStorage.setItem("chatapp.theme", t);
    setThemeState(t);
  };
  const toggle = () => setTheme(theme === "dark" ? "light" : "dark");
  return { theme, setTheme, toggle };
}
