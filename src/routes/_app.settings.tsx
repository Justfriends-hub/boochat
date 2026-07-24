import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserAvatar } from "@/components/UserAvatar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { InstallButton } from "@/components/InstallButton";
import { useAuth } from "@/hooks/useAuth";
import { signOut, updateProfile } from "@/api/authApi";
import { LogOut, ShieldCheck, Camera, Loader2, Pencil, X, Check } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsPage,
  head: () => ({ meta: [{ title: "Settings — Meshly" }] }),
});

function SettingsPage() {
  const me = useAuth();
  const nav = useNavigate();
  const avatarFileRef = useRef<HTMLInputElement>(null);

  // Avatar upload state
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  // Inline profile edit state
  const [editingProfile, setEditingProfile] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  if (!me) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !me) return;
    e.target.value = "";

    // Show local preview immediately
    const objectUrl = URL.createObjectURL(file);
    setAvatarPreview(objectUrl);
    setAvatarUploading(true);

    try {
      await updateProfile(me.id, { avatarFile: file });
      toast.success("Avatar updated!");
    } catch (err: any) {
      toast.error(err.message || "Failed to update avatar");
      setAvatarPreview(null); // revert preview on failure
    } finally {
      setAvatarUploading(false);
    }
  };

  const startEditing = () => {
    setDisplayName(me.displayName);
    setBio(me.bio ?? "");
    setEditingProfile(true);
  };

  const cancelEditing = () => {
    setEditingProfile(false);
  };

  const saveProfile = async () => {
    if (!me) return;
    setSavingProfile(true);
    try {
      await updateProfile(me.id, { displayName, bio });
      toast.success("Profile updated!");
      setEditingProfile(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to save profile");
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex h-16 items-center justify-between border-b bg-card px-4">
        <h1 className="text-xl font-semibold">Settings</h1>
        <ThemeToggle />
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-2xl w-full mx-auto">
        {/* ── Profile card ── */}
        <Card className="p-4">
          <div className="flex items-center gap-4">
            {/* Avatar with camera overlay */}
            <div className="relative shrink-0 group">
              <input
                ref={avatarFileRef}
                type="file"
                accept="image/*"
                hidden
                aria-hidden="true"
                onChange={handleAvatarChange}
              />
              <UserAvatar
                name={me.displayName}
                src={avatarPreview ?? me.avatar}
                size={72}
                online
              />
              {/* Upload spinner */}
              {avatarUploading && (
                <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50">
                  <Loader2 className="h-6 w-6 animate-spin text-white" />
                </div>
              )}
              {/* Camera button — always shown on hover */}
              {!avatarUploading && (
                <button
                  onClick={() => avatarFileRef.current?.click()}
                  aria-label="Change avatar"
                  className="absolute inset-0 flex items-center justify-center rounded-full bg-black/0 group-hover:bg-black/40 transition-colors"
                >
                  <Camera className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              )}
            </div>

            {/* Name / email / bio — or edit form */}
            {editingProfile ? (
              <div className="flex-1 space-y-2">
                <div>
                  <Label htmlFor="settings-display-name" className="text-xs text-muted-foreground">Display name</Label>
                  <Input
                    id="settings-display-name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="h-8 text-sm mt-0.5"
                    maxLength={64}
                    autoFocus
                  />
                </div>
                <div>
                  <Label htmlFor="settings-bio" className="text-xs text-muted-foreground">Bio</Label>
                  <Input
                    id="settings-bio"
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    className="h-8 text-sm mt-0.5"
                    maxLength={160}
                    placeholder="Tell us about yourself…"
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" onClick={saveProfile} disabled={savingProfile} className="h-7 text-xs gap-1">
                    {savingProfile ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={cancelEditing} disabled={savingProfile} className="h-7 text-xs gap-1">
                    <X className="h-3 w-3" /> Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-lg font-semibold truncate">{me.displayName}</p>
                  <button
                    onClick={startEditing}
                    aria-label="Edit profile"
                    className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
                <p className="text-sm text-muted-foreground truncate">{me.email}</p>
                {me.bio && <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{me.bio}</p>}
                <p className="mt-1 text-xs uppercase tracking-wide text-primary">{me.role}</p>
              </div>
            )}
          </div>
        </Card>

        {/* ── Appearance ── */}
        <Card className="p-4 space-y-3">
          <Label className="text-xs uppercase text-muted-foreground">Appearance</Label>
          <div className="flex items-center justify-between">
            <p className="text-sm">Theme</p>
            <ThemeToggle />
          </div>
        </Card>

        {/* ── App ── */}
        <Card className="p-4 space-y-3">
          <Label className="text-xs uppercase text-muted-foreground">App</Label>
          <InstallButton />
        </Card>

        {/* ── Admin panel (admin only) ── */}
        {me.role === "admin" && (
          <Card className="p-4">
            <Button
              variant="outline"
              className="w-full"
              onClick={() =>
                nav({
                  to: "/admin",
                  search: {
                    tab: "users",
                    au_user: "",
                    au_action: "",
                    au_from: "",
                    au_to: "",
                    bo_user: "",
                    bo_kind: "",
                    bo_from: "",
                    bo_to: "",
                  },
                })
              }
            >
              <ShieldCheck className="mr-2 h-4 w-4" /> Open Admin Panel
            </Button>
          </Card>
        )}

        {/* ── Sign out ── */}
        <Button
          variant="destructive"
          className="w-full"
          onClick={async () => {
            await signOut();
            nav({ to: "/auth/login" });
          }}
        >
          <LogOut className="mr-2 h-4 w-4" /> Sign out
        </Button>
      </div>
    </div>
  );
}
