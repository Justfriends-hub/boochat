import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Share } from "lucide-react";
import { toast } from "sonner";

export function InstallButton() {
  const [prompt, setPrompt] = useState<any>(null);
  const [installed, setInstalled] = useState(false);
  const isiOS = typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);

  useEffect(() => {
    const onPrompt = (e: any) => { e.preventDefault(); setPrompt(e); };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) {
    return <p className="text-sm text-muted-foreground">App is installed 🎉</p>;
  }

  if (isiOS) {
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
        if (!prompt) {
          toast.info("Install prompt not available yet. Try again from the browser menu.");
          return;
        }
        prompt.prompt();
        const { outcome } = await prompt.userChoice;
        if (outcome === "accepted") toast.success("Installing…");
        setPrompt(null);
      }}
    >
      <Download className="mr-2 h-4 w-4" /> Install App
    </Button>
  );
}
