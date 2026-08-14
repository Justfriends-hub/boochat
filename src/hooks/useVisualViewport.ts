import { useEffect, useState } from "react";

export function useAppHeight(): number {
  const [appHeight, setAppHeight] = useState<number>(
    typeof window !== "undefined" ? window.innerHeight : 0,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const update = () => {
      const nextHeight = Math.max(
        window.visualViewport?.height ?? window.innerHeight,
        0,
      );
      setAppHeight(nextHeight);
      document.documentElement.style.setProperty("--app-height", `${nextHeight}px`);
    };

    update();
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);

    return () => {
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, []);

  return appHeight;
}

// Tracks the visual viewport bottom offset so the composer can lift with the
// on-screen keyboard on iOS Safari. On Android Chrome the interactive-widget
// meta tag handles this natively, but we still respond to viewport changes.
export function useKeyboardOffset(): number {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const kb = window.innerHeight - vv.height - vv.offsetTop;
      setOffset(Math.max(0, kb));
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return offset;
}
