import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { getChannel, uploadChannelAvatar, updateChannel } from "@/api/channelsApi";
import { uploadImage, getImageUrl } from "@/lib/imageUpload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/UserAvatar";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/channels/$channelId/settings/appearance")({ component: AppearancePage });

function AppearancePage() {
  const { channelId } = Route.useParams();
  const qc = useQueryClient();
  const { data: channel } = useQuery({ queryKey: ["channel", channelId], queryFn: () => getChannel(channelId) });
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingWallpaper, setUploadingWallpaper] = useState(false);
  const [savingAppearance, setSavingAppearance] = useState(false);
  const [appearanceColor, setAppearanceColor] = useState("#7c3aed");
  const [reactionInput, setReactionInput] = useState("❤️, 👍, 🎉, 😮, 💲");
  const avatarRef = useRef<HTMLInputElement | null>(null);
  const wallpaperRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!channel) return;
    setAppearanceColor(channel.appearanceColor ?? "#7c3aed");
    setReactionInput((channel.allowedReactionEmojis?.length ? channel.allowedReactionEmojis : ["❤️", "👍", "🎉", "😮", "💲"]).join(", "));
  }, [channel]);

  if (!channel) return null;

  const onAvatarUpload = async (file?: File) => {
    if (!file) return;
    setUploadingAvatar(true);
    try {
      await uploadChannelAvatar(channelId, file);
      qc.invalidateQueries({ queryKey: ["channel", channelId] });
      toast.success("Channel avatar updated");
    } catch (err: any) {
      toast.error(err?.message || "Failed to upload avatar");
    } finally {
      setUploadingAvatar(false);
    }
  };

  const onWallpaperUpload = async (file?: File) => {
    if (!file) return;
    setUploadingWallpaper(true);
    try {
      const path = await uploadImage(file, "channel-media", `${channelId}/wallpaper`, { maxDim: 1920 });
      const signedUrl = await getImageUrl("channel-media", path);
      await updateChannel(channelId, { wallpaper: path });
      qc.invalidateQueries({ queryKey: ["channel", channelId] });
      toast.success("Channel wallpaper updated");
    } catch (err: any) {
      toast.error(err?.message || "Failed to upload wallpaper");
    } finally {
      setUploadingWallpaper(false);
    }
  };

  const onSaveAppearance = async () => {
    const sanitized = reactionInput
      .split(",")
      .map((emoji) => emoji.trim())
      .filter(Boolean)
      .slice(0, 10);

    if (sanitized.length === 0) {
      toast.error("At least one reaction emoji is required.");
      return;
    }

    try {
      setSavingAppearance(true);
      await updateChannel(channelId, {
        appearanceColor,
        allowedReactionEmojis: sanitized,
      });
      qc.invalidateQueries({ queryKey: ["channel", channelId] });
      toast.success("Channel appearance updated");
    } catch (err: any) {
      toast.error(err?.message || "Failed to update appearance");
    } finally {
      setSavingAppearance(false);
    }
  };

  return (
    <div className="p-4">
      <h2 className="mb-3 text-lg font-semibold">Appearance</h2>
      <p className="mb-4 text-sm text-muted-foreground">Customize the channel accent color, avatar, wallpaper, and allowed reactions.</p>

      <div className="space-y-6 max-w-2xl">
        {/* Avatar Section */}
        <div className="rounded-xl border p-4 space-y-4">
          <div className="flex items-center gap-4">
            <UserAvatar name={channel.name} src={channel.avatar} size={64} />
            <div>
              <p className="font-semibold">Channel avatar</p>
              <p className="text-xs text-muted-foreground">Recommended: square PNG/JPEG, up to 2MB.</p>
            </div>
          </div>

          <div className="flex gap-2">
            <input
              ref={avatarRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onAvatarUpload(f);
                e.currentTarget.value = "";
              }}
            />
            <Button onClick={() => avatarRef.current?.click()} disabled={uploadingAvatar}>
              {uploadingAvatar ? "Uploading…" : "Upload avatar"}
            </Button>
          </div>
        </div>

        {/* Wallpaper Section */}
        <div className="rounded-xl border p-4 space-y-4">
          <div>
            <p className="font-semibold mb-1">Channel wallpaper</p>
            <p className="text-xs text-muted-foreground">Set a background for the channel header or profiles. Recommended: landscape 1920x1080 or wider, PNG/JPEG.</p>
          </div>

          {channel.wallpaper && (
            <div className="rounded-lg overflow-hidden border">
              <img src={channel.wallpaper} alt="Channel wallpaper" className="w-full h-40 object-cover" />
            </div>
          )}

          <div className="flex gap-2">
            <input
              ref={wallpaperRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onWallpaperUpload(f);
                e.currentTarget.value = "";
              }}
            />
            <Button onClick={() => wallpaperRef.current?.click()} disabled={uploadingWallpaper}>
              {uploadingWallpaper ? "Uploading…" : "Upload wallpaper"}
            </Button>
            {channel.wallpaper && (
              <Button variant="outline" onClick={() => {
                setUploadingWallpaper(true);
                updateChannel(channelId, { wallpaper: null })
                  .then(() => {
                    qc.invalidateQueries({ queryKey: ["channel", channelId] });
                    toast.success("Wallpaper removed");
                  })
                  .catch((err: any) => toast.error(err?.message || "Failed to remove wallpaper"))
                  .finally(() => setUploadingWallpaper(false));
              }} disabled={uploadingWallpaper}>
                Remove
              </Button>
            )}
          </div>
        </div>

        {/* Appearance Settings Section */}
        <div className="rounded-xl border p-4 space-y-4">
          <div>
            <p className="font-semibold mb-1">Channel accent color</p>
            <p className="text-xs text-muted-foreground">Choose any hex color that will be used as the channel highlight color.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <input type="color" value={appearanceColor} onChange={(e) => setAppearanceColor(e.target.value)} className="h-10 w-14 rounded-md border bg-transparent p-1" />
            <Input value={appearanceColor} onChange={(e) => setAppearanceColor(e.target.value)} className="max-w-[180px]" />
            <div className="h-9 w-24 rounded-md border" style={{ backgroundColor: appearanceColor }} />
          </div>
        </div>

        <div className="rounded-xl border p-4 space-y-4">
          <div>
            <p className="font-semibold mb-1">Allowed reaction emojis</p>
            <p className="text-xs text-muted-foreground">Enter the emoji list admins should allow for long-press reactions, separated by commas.</p>
          </div>
          <Input
            value={reactionInput}
            onChange={(e) => setReactionInput(e.target.value)}
            placeholder="❤️, 👍, 🎉, 😮, 💲"
          />
          <div className="flex flex-wrap gap-2 text-lg">
            {reactionInput
              .split(",")
              .map((emoji) => emoji.trim())
              .filter(Boolean)
              .map((emoji, idx) => (
                <span key={`${emoji}-${idx}`} className="rounded-full border bg-muted px-2 py-1 text-sm">{emoji}</span>
              ))}
          </div>
          <Button onClick={onSaveAppearance} disabled={savingAppearance}>
            {savingAppearance ? "Saving…" : "Save appearance settings"}
          </Button>
        </div>
      </div>
    </div>
  );
}
