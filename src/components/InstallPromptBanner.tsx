import { useEffect, useState } from "react";
import { Download, Share, X, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function InstallPromptBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [dismissed, setDismissed] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isiOS, setIsiOS] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Check if app is already running in PWA standalone mode
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true ||
      document.referrer.includes("android-app://");
    setIsStandalone(standalone);

    // Check user agent
    const userAgent = window.navigator.userAgent || "";
    const iosDevice = /iPad|iPhone|iPod/.test(userAgent) && !(window as any).MSStream;
    setIsiOS(iosDevice);

    // Check session storage for dismissal
    if (sessionStorage.getItem("pwa_install_banner_dismissed") === "true") {
      setDismissed(true);
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      // Prevent default mini-infobar
      e.preventDefault();
      setDeferredPrompt(e);
    };

    const handleAppInstalled = () => {
      setIsStandalone(true);
      setDeferredPrompt(null);
      toast.success("Meshly app installed successfully!");
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  if (isStandalone || dismissed) {
    return null;
  }

  const dismissBanner = () => {
    setDismissed(true);
    sessionStorage.setItem("pwa_install_banner_dismissed", "true");
  };

  const handleInstallClick = async () => {
    if (!deferredPrompt) {
      toast.info("Opening app installer…");
      return;
    }
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      toast.success("Installing Meshly…");
    }
    setDeferredPrompt(null);
  };

  // On iOS devices
  if (isiOS) {
    return (
      <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md rounded-2xl border bg-card/95 p-4 shadow-xl backdrop-blur-md transition-all animate-in fade-in slide-in-from-bottom-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Smartphone className="h-5 w-5" />
          </div>
          <div className="flex-1 text-sm">
            <p className="font-semibold text-foreground">Install Meshly App</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              To install on iPhone: tap <Share className="inline h-3.5 w-3.5 mx-0.5 text-primary" /> Share, then select <span className="font-medium text-foreground">"Add to Home Screen"</span>.
            </p>
          </div>
          <button
            onClick={dismissBanner}
            className="text-muted-foreground hover:text-foreground p-1 rounded-full hover:bg-muted"
            aria-label="Dismiss banner"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  // On Android or Chrome/Edge Desktop (when prompt is available or fallback)
  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md rounded-2xl border bg-card/95 p-4 shadow-xl backdrop-blur-md transition-all animate-in fade-in slide-in-from-bottom-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Smartphone className="h-5 w-5" />
        </div>
        <div className="flex-1 text-sm">
          <p className="font-semibold text-foreground">Install Meshly App</p>
          <p className="text-xs text-muted-foreground">
            Get the standalone app for offline messaging and instant loading.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleInstallClick} className="gap-1.5 shadow-sm">
            <Download className="h-4 w-4" /> Install
          </Button>
          <button
            onClick={dismissBanner}
            className="text-muted-foreground hover:text-foreground p-1 rounded-full hover:bg-muted"
            aria-label="Dismiss banner"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
