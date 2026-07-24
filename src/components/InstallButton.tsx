import { Download, Share } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { usePWAInstall } from "@/hooks/usePWAInstall";

export function InstallButton() {
  const { isInstalled, isIOS, triggerInstall } = usePWAInstall();

  if (isInstalled) {
    return <p className="text-sm text-muted-foreground">App is installed 🎉</p>;
  }

  if (isIOS) {
    return (
      <div className="rounded-lg border p-3 text-sm">
        <p className="flex items-center gap-2 font-medium">
          <Share className="h-4 w-4" /> Add to Home Screen
        </p>
        <p className="mt-1 text-muted-foreground">
          Tap the Share button in Safari, then choose "Add to Home Screen".
        </p>
      </div>
    );
  }

  return (
    <Button
      onClick={async () => {
        const accepted = await triggerInstall();
        if (accepted) {
          toast.success("Installing Boochat as an app…");
        } else {
          toast.info("The install prompt is not available right now. Try again from the browser menu.");
        }
      }}
    >
      <Download className="mr-2 h-4 w-4" /> Install App
    </Button>
  );
}
