import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserAvatar } from "@/components/UserAvatar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { InstallButton } from "@/components/InstallButton";
import { useAuth } from "@/hooks/useAuth";
import { FeatureBoundary } from "@/components/FeatureBoundary";
import { listQuickReplies, createQuickReply, deleteQuickReply, updateQuickReply, reorderQuickReplies } from "@/api/quickRepliesApi";
import { useEffect } from "react";
import { signOut, updateProfile } from "@/api/authApi";
import { LogOut, ShieldCheck, Camera, Loader2, Pencil, X, Check } from "lucide-react";
import { normalizeRole } from "@/lib/mockStore";
import { getErrorMessage } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsPage,
  head: () => ({ meta: [{ title: "Settings — boochat" }] }),
});

function QuickRepliesManager({ meId }: { meId: string }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [shortcut, setShortcut] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    listQuickReplies(meId).then((res) => { if (mounted) setItems(res); }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [meId]);

  const refresh = async () => { setLoading(true); const res = await listQuickReplies(meId); setItems(res); setLoading(false); };

  const handleAdd = async () => {
    try {
      await createQuickReply(meId, { shortcut: shortcut.trim(), title: title.trim() || shortcut.trim(), body: body });
      setShortcut(""); setTitle(""); setBody("");
      await refresh();
    } catch (err: any) {
      alert(err.message || String(err));
    }
  };

  const handleDelete = async (id: string) => { if (!confirm("Delete this quick reply?")) return; await deleteQuickReply(id); await refresh(); };

  const move = async (idx: number, dir: -1 | 1) => {
    const next = [...items];
    const ni = idx + dir;
    if (ni < 0 || ni >= next.length) return;
    const tmp = next[idx]; next[idx] = next[ni]; next[ni] = tmp;
    setItems(next);
    await reorderQuickReplies(meId, next.map((x) => x.id));
  };

  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        <Input placeholder="shortcut (e.g. pricing)" value={shortcut} onChange={(e)=>setShortcut(e.target.value)} />
        <Input placeholder="title" value={title} onChange={(e)=>setTitle(e.target.value)} />
        <Input placeholder="body" value={body} onChange={(e)=>setBody(e.target.value)} />
      </div>
      <div className="flex gap-2 mt-2">
        <Button onClick={handleAdd} disabled={loading || items.length >= 50}>Add</Button>
        <div className="text-sm text-muted-foreground self-center">{items.length}/50 used</div>
      </div>

      <div className="mt-3 space-y-2">
        {loading ? <div>Loading…</div> : (
          items.map((it, idx) => (
            <div key={it.id} className="flex items-center justify-between gap-2 border rounded p-2">
              <div className="min-w-0">
                <div className="font-medium truncate">{it.title} <span className="text-xs text-muted-foreground">/{it.shortcut}</span></div>
                <div className="text-sm text-muted-foreground truncate">{it.body}</div>
              </div>
              <div className="flex items-center gap-1">
                <Button size="icon" variant="ghost" onClick={()=>move(idx, -1)} aria-label="Move up">▲</Button>
                <Button size="icon" variant="ghost" onClick={()=>move(idx, 1)} aria-label="Move down">▼</Button>
                <Button size="icon" variant="ghost" onClick={()=>handleDelete(it.id)} aria-label="Delete">✕</Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

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

  // ─── All handlers must be defined BEFORE any conditional return ───────────
  // This prevents React hydration mismatches (#418) where the server renders
  // the loading spinner but the client renders the full page on first paint.

  const handleAvatarChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !me) return;
      e.target.value = "";

      // Revoke any old preview
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);

      const objectUrl = URL.createObjectURL(file);
      setAvatarPreview(objectUrl);
      setAvatarUploading(true);

      try {
        await updateProfile(me.id, { avatarFile: file });
        toast.success("Avatar updated!");
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, "Failed to update avatar"));
        setAvatarPreview(null); // revert preview on failure
      } finally {
        setAvatarUploading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [me?.id, avatarPreview],
  );

  const startEditing = useCallback(() => {
    if (!me) return;
    setDisplayName(me.displayName);
    setBio(me.bio ?? "");
    setEditingProfile(true);
  }, [me]);

  const cancelEditing = useCallback(() => setEditingProfile(false), []);

  const saveProfile = useCallback(async () => {
    if (!me) return;
    setSavingProfile(true);
    try {
      await updateProfile(me.id, { displayName, bio });
      toast.success("Profile updated!");
      setEditingProfile(false);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Failed to save profile"));
    } finally {
      setSavingProfile(false);
    }
  }, [me, displayName, bio]);

  // ─── Loading guard (after hooks, before JSX that depends on `me`) ─────────
  if (!me) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

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
              {/* Camera button — shown on hover when not uploading */}
              {!avatarUploading && (
                <button
                  type="button"
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
                  <Label htmlFor="settings-display-name" className="text-xs text-muted-foreground">
                    Display name
                  </Label>
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
                  <Label htmlFor="settings-bio" className="text-xs text-muted-foreground">
                    Bio
                  </Label>
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
                  <Button
                    size="sm"
                    onClick={saveProfile}
                    disabled={savingProfile}
                    className="h-7 text-xs gap-1"
                  >
                    {savingProfile ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Check className="h-3 w-3" />
                    )}
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={cancelEditing}
                    disabled={savingProfile}
                    className="h-7 text-xs gap-1"
                  >
                    <X className="h-3 w-3" /> Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-lg font-semibold truncate">{me.displayName}</p>
                  <button
                    type="button"
                    onClick={startEditing}
                    aria-label="Edit profile"
                    className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
                <p className="text-sm text-muted-foreground truncate">{me.email}</p>
                {me.bio && (
                  <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{me.bio}</p>
                )}
                <p className="mt-1 text-xs uppercase tracking-wide text-primary">{me.role}</p>
              </div>
            )}
          </div>
        </Card>

        {/* ── Quick Replies (Feature) ── */}
        <FeatureBoundary name="quick_replies">
          {me.isUpgraded ? (
            <Card className="p-4 space-y-3">
              <Label className="text-xs uppercase text-muted-foreground">Quick Replies</Label>
              <QuickRepliesManager meId={me.id} />
            </Card>
          ) : (
            <Card className="p-4">
              <Label className="text-xs uppercase text-muted-foreground">Quick Replies</Label>
              <div className="mt-2 text-sm text-muted-foreground">
                Upgrade to unlock Quick Replies and more — ask an admin to grant the upgrade.
              </div>
            </Card>
          )}
        </FeatureBoundary>

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
        {(normalizeRole(me.role) === "owner") && (
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
