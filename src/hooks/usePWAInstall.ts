import { useCallback, useEffect, useRef, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const INSTALL_STATE_KEY = "pwa-install-complete";
const DISMISS_STATE_KEY = "pwa-install-dismissed";
const PROMPT_DELAY_MS = 5000;

export function usePWAInstall() {
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const [isPromptVisible, setIsPromptVisible] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const installed = localStorage.getItem(INSTALL_STATE_KEY) === "true";
    const dismissed = sessionStorage.getItem(DISMISS_STATE_KEY) === "true";
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true ||
      document.referrer.includes("android-app://");

    const iosDevice = /iPad|iPhone|iPod/.test(window.navigator.userAgent) && !(window as Window & { MSStream?: unknown }).MSStream;

    setIsInstalled(installed || standalone);
    setIsStandalone(standalone);
    setIsIOS(iosDevice);
    setIsSupported(typeof window !== "undefined" && "BeforeInstallPromptEvent" in window);

    if (installed || standalone || dismissed) return;

    let timeoutId: number | undefined;

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      const promptEvent = event as BeforeInstallPromptEvent;
      deferredPromptRef.current = promptEvent;
      setIsSupported(true);
      timeoutId = window.setTimeout(() => {
        if (!localStorage.getItem(INSTALL_STATE_KEY) && !sessionStorage.getItem(DISMISS_STATE_KEY)) {
          setIsPromptVisible(true);
        }
      }, PROMPT_DELAY_MS);
    };

    const handleAppInstalled = () => {
      localStorage.setItem(INSTALL_STATE_KEY, "true");
      setIsInstalled(true);
      setIsPromptVisible(false);
      deferredPromptRef.current = null;
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, []);

  const hidePrompt = useCallback(() => {
    sessionStorage.setItem(DISMISS_STATE_KEY, "true");
    setIsPromptVisible(false);
  }, []);

  const triggerInstall = useCallback(async () => {
    if (typeof window === "undefined") return false;

    const promptEvent = deferredPromptRef.current;
    if (!promptEvent) {
      if (isIOS) {
        setIsPromptVisible(true);
        return false;
      }
      return false;
    }

    try {
      await promptEvent.prompt();
      const { outcome } = await promptEvent.userChoice;
      if (outcome === "accepted") {
        localStorage.setItem(INSTALL_STATE_KEY, "true");
        setIsInstalled(true);
        setIsPromptVisible(false);
        deferredPromptRef.current = null;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [isIOS]);

  return {
    isPromptVisible,
    isInstalled,
    isStandalone,
    isIOS,
    isSupported,
    triggerInstall,
    hidePrompt,
  };
}
