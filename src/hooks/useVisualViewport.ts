import { useEffect, useState } from "react";

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
