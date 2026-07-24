import { Download, Share, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePWAInstall } from "@/hooks/usePWAInstall";
import { toast } from "sonner";

export function PWAInstallPrompt() {
  const { isPromptVisible, isInstalled, isStandalone, isIOS, triggerInstall, hidePrompt } = usePWAInstall();

  if (isInstalled || isStandalone || !isPromptVisible) return null;

  const handleInstall = async () => {
    const accepted = await triggerInstall();
    if (accepted) {
      toast.success("Installing Boochat as an app…");
    } else if (!isIOS) {
      toast.info("The install prompt is not available right now. Try again from the browser menu.");
    }
  };

  return (
    <div className="fixed bottom-4 left-4 right-4 z-[60] mx-auto max-w-md rounded-2xl border bg-card/95 p-4 shadow-2xl backdrop-blur-md">
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Smartphone className="h-5 w-5" />
        </div>

        <div className="flex-1 text-sm">
          <p className="font-semibold text-foreground">Install Boochat</p>
          {isIOS ? (
            <p className="mt-1 text-xs text-muted-foreground">
              On iPhone or iPad, tap <Share className="mx-0.5 inline h-3.5 w-3.5" /> Share and choose <span className="font-medium text-foreground">Add to Home Screen</span>.
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              Install this app for a faster, full-screen experience and instant access.
            </p>
          )}
        </div>

        <button
          onClick={hidePrompt}
          className="rounded-full p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          aria-label="Dismiss install prompt"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        {!isIOS ? (
          <Button size="sm" onClick={handleInstall} className="gap-1.5">
            <Download className="h-4 w-4" /> Install
          </Button>
        ) : null}
      </div>
    </div>
  );
}
