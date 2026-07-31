import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ShieldCheck,
  Users,
  MessageCircle,
  Lock,
  Trash2,
  Plus,
  Link as LinkIcon,
  Shield,
  Settings,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import SettingsGroup from "@/components/settings/SettingsGroup";
import SettingsRow from "@/components/settings/SettingsRow";
import {
  addChannelToCommunity,
  deleteChannel,
  demoteChannelAdmin,
  getChannel,
  getChannelAdmins,
  getChannelRecentActions,
  getChannelStatistics,
  getChannelSubscribers,
  getRemovedMembers,
  promoteToChannelAdmin,
  setChannelDiscussion,
  unbanChannelMember,
  updateChannel,
  updateChannelSettings,
} from "@/api/channelsApi";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { UserAvatar } from "@/components/UserAvatar";
import { timeAgo } from "@/lib/format";

export const Route = createFileRoute("/_app/channels/$channelId/settings")({
  component: ChannelSettingsPage,
  head: () => ({ meta: [{ title: "Channel Settings — boochat" }] }),
});

function ChannelSettingsPage() {
  const { channelId } = Route.useParams();
  const me = useAuth();
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [discussionChatId, setDiscussionChatId] = useState("");
  const [communityInput, setCommunityInput] = useState("");
  const [subscriberSearch, setSubscriberSearch] = useState("");
  const [subscriberCursor, setSubscriberCursor] = useState(0);
  const [savingIdentity, setSavingIdentity] = useState(false);
  const [savingDiscussion, setSavingDiscussion] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [addingCommunity, setAddingCommunity] = useState(false);
  const [savingAutoTranslate, setSavingAutoTranslate] = useState(false);
  const [savingDirectMessages, setSavingDirectMessages] = useState(false);
  const [deletingChannel, setDeletingChannel] = useState(false);

  const { data: channel } = useQuery({
    queryKey: ["channel", channelId],
    queryFn: () => getChannel(channelId),
  });

  const { data: admins = [] } = useQuery({
    queryKey: ["channel-admins", channelId],
    queryFn: () => getChannelAdmins(channelId),
    enabled: !!channel,
  });

  const { data: subscriberPage } = useQuery({
    queryKey: ["channel-subscribers", channelId, subscriberSearch, subscriberCursor],
    queryFn: () => getChannelSubscribers(channelId, {
      search: subscriberSearch,
      cursor: subscriberCursor,
    }),
    enabled: !!channel,
  });

  const { data: stats } = useQuery({
    queryKey: ["channel-statistics", channelId],
    queryFn: () => getChannelStatistics(channelId),
    enabled: !!channel,
  });

  const { data: removedMembers = [] } = useQuery({
    queryKey: ["channel-removed-members", channelId],
    queryFn: () => getRemovedMembers(channelId),
    enabled: !!channel,
  });

  const { data: recentActions = [] } = useQuery({
    queryKey: ["channel-recent-actions", channelId],
    queryFn: () => getChannelRecentActions(channelId),
    enabled: !!channel,
  });

  useEffect(() => {
    if (!channel) return;
    setName(channel.name);
    setDescription(channel.description ?? "");
    setDiscussionChatId(channel.discussionChatId ?? "");
    setCommunityInput(channel.communityId ?? "");
  }, [channel]);

  useEffect(() => {
    setSubscriberCursor(0);
  }, [subscriberSearch, channelId]);

  const isOwner = channel?.ownerId === me?.id;
  const isAdmin = !!channel?.adminIds.includes(me?.id ?? "");
  const canManage = isOwner || isAdmin;
  const canDelete = isOwner;

  const isChildSettingsRoute = useRouterState({
    select: (s) =>
      s.location.pathname.startsWith(`/channels/${channelId}/settings/`) &&
      !s.location.pathname.endsWith(`/channels/${channelId}/settings`),
  });

  const subscriberCount = subscriberPage?.total ?? channel?.memberIds.length ?? 0;
  const subscriberList = subscriberPage?.subscribers ?? [];
  const nextSubscriberCursor = subscriberPage?.nextCursor ?? null;

  const helperText = useMemo(() => {
    if (!channel) return "";
    if (channel.visibility === "private") {
      return "Private channels are invite-only; subscribers must be approved by an owner or admin.";
    }
    return "Public channels can be joined by anyone with the link.";
  }, [channel]);

  const handleSaveIdentity = async () => {
    if (!channel || !canManage) return;
    setSavingIdentity(true);
    try {
      await updateChannel(channel.id, { name: name.trim(), description: description.trim() });
      qc.invalidateQueries({ queryKey: ["channel", channelId] });
      toast.success("Channel identity saved.");
    } catch (err: any) {
      toast.error(err.message || "Unable to save channel details.");
    } finally {
      setSavingIdentity(false);
    }
  };

  const handleSaveChannelType = async (nextVisibility: "public" | "private") => {
    if (!channel || !canManage) return;
    setSavingSettings(true);
    try {
      await updateChannel(channel.id, { visibility: nextVisibility });
      qc.invalidateQueries({ queryKey: ["channel", channelId] });
      toast.success(`Channel type updated to ${nextVisibility}.`);
    } catch (err: any) {
      toast.error(err.message || "Unable to update channel type.");
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSaveDiscussion = async () => {
    if (!channel || !canManage) return;
    setSavingDiscussion(true);
    try {
      await setChannelDiscussion(channel.id, discussionChatId.trim() || null);
      qc.invalidateQueries({ queryKey: ["channel", channelId] });
      toast.success("Discussion thread updated.");
    } catch (err: any) {
      toast.error(err.message || "Unable to update discussion link.");
    } finally {
      setSavingDiscussion(false);
    }
  };

  const handleToggleAutoTranslate = async () => {
    if (!channel || !canManage) return;
    setSavingAutoTranslate(true);
    try {
      await updateChannelSettings(channel.id, { autoTranslateEnabled: !channel.autoTranslateEnabled });
      qc.invalidateQueries({ queryKey: ["channel", channelId] });
      toast.success(`Auto-translate ${channel.autoTranslateEnabled ? "disabled" : "enabled"}.`);
    } catch (err: any) {
      toast.error(err.message || "Unable to update auto-translate.");
    } finally {
      setSavingAutoTranslate(false);
    }
  };

  const handleToggleDirectMessages = async () => {
    if (!channel || !canManage) return;
    setSavingDirectMessages(true);
    try {
      await updateChannelSettings(channel.id, { allowDirectMessages: !channel.allowDirectMessages });
      qc.invalidateQueries({ queryKey: ["channel", channelId] });
      toast.success(`Direct messages ${channel.allowDirectMessages ? "disabled" : "enabled"}.`);
    } catch (err: any) {
      toast.error(err.message || "Unable to update direct messages.");
    } finally {
      setSavingDirectMessages(false);
    }
  };

  const handleAddCommunity = async () => {
    if (!channel || !canManage || !communityInput.trim()) return;
    setAddingCommunity(true);
    try {
      await addChannelToCommunity(channel.id, communityInput.trim());
      qc.invalidateQueries({ queryKey: ["channel", channelId] });
      toast.success("Channel linked to community.");
    } catch (err: any) {
      toast.error(err.message || "Unable to add channel to community.");
    } finally {
      setAddingCommunity(false);
    }
  };

  const handleUnbanMember = async (userId: string) => {
    if (!channel || !canManage) return;
    try {
      await unbanChannelMember(channel.id, userId);
      qc.invalidateQueries({ queryKey: ["channel-removed-members", channelId] });
      toast.success("Member has been restored.");
    } catch (err: any) {
      toast.error(err.message || "Unable to restore member.");
    }
  };

  const handleDeleteChannel = async () => {
    if (!channel || !canDelete) return;
    setDeletingChannel(true);
    try {
      await deleteChannel(channel.id);
      qc.invalidateQueries({ queryKey: ["channels"] });
      toast.success("Channel deleted.");
    } catch (err: any) {
      toast.error(err.message || "Unable to delete channel.");
    } finally {
      setDeletingChannel(false);
    }
  };

  const handlePromoteAdmin = async (userId: string) => {
    if (!channel || !canManage) return;
    try {
      await promoteToChannelAdmin(channel.id, userId);
      qc.invalidateQueries({ queryKey: ["channel-admins", channelId] });
      qc.invalidateQueries({ queryKey: ["channel", channelId] });
      toast.success("Channel admin added.");
    } catch (err: any) {
      toast.error(err.message || "Unable to promote admin.");
    }
  };

  const handleDemoteAdmin = async (userId: string) => {
    if (!channel || !canManage) return;
    try {
      await demoteChannelAdmin(channel.id, userId);
      qc.invalidateQueries({ queryKey: ["channel-admins", channelId] });
      qc.invalidateQueries({ queryKey: ["channel", channelId] });
      toast.success("Channel admin removed.");
    } catch (err: any) {
      toast.error(err.message || "Unable to remove admin.");
    }
  };

  if (!me || !channel) {
    return null;
  }

  return (
    <div className="flex flex-1 flex-col bg-background">
      <div className="flex items-center gap-2 border-b bg-card px-3 py-3">
        <Link to="/channels/$channelId" params={{ channelId }} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to channel
        </Link>
        <div className="ml-auto inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-primary" /> {isOwner ? "Owner" : isAdmin ? "Admin" : "Subscriber"}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {isChildSettingsRoute ? (
          <Outlet />
        ) : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Channel identity</CardTitle>
                <CardDescription>Update the channel name, description, and discussion link.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4">
                  <UserAvatar name={channel.name} src={channel.avatar} size={54} />
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">{channel.name}</p>
                    <p className="text-xs text-muted-foreground">Channel owner: {channel.ownerId === me.id ? "You" : channel.ownerId}</p>
                  </div>
                </div>
                <div className="grid gap-3">
                  <div className="grid gap-1">
                    <Label htmlFor="channel-name">Channel name</Label>
                    <Input
                      id="channel-name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      disabled={!canManage}
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="channel-description">Description</Label>
                    <Textarea
                      id="channel-description"
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      rows={3}
                      disabled={!canManage}
                    />
                  </div>
                </div>
              </CardContent>
              <CardFooter className="flex flex-col gap-2 sm:flex-row sm:justify-between">
                <p className="text-xs text-muted-foreground">Changes apply immediately across the channel.</p>
                <Button onClick={handleSaveIdentity} disabled={!canManage || savingIdentity}>
                  {savingIdentity ? "Saving…" : "Save identity"}
                </Button>
              </CardFooter>
            </Card>

            <SettingsGroup>
              <Link to={( `/channels/${channelId}/settings/channel-type` as any )} className="no-underline">
                <SettingsRow
                  icon={Zap}
                  iconBg="bg-blue-500"
                  label="Channel type"
                  value={channel.visibility}
                />
              </Link>

              <Link to={( `/channels/${channelId}/settings/discussion` as any )} className="no-underline">
                <SettingsRow
                  icon={MessageCircle}
                  iconBg="bg-green-500"
                  label="Discussion"
                  value={channel.discussionChatId ? "Linked" : "Add"}
                />
              </Link>

              <Link to={( `/channels/${channelId}/settings/statistics` as any )} className="no-underline">
                <SettingsRow
                  icon={ShieldCheck}
                  iconBg="bg-rose-500"
                  label="Reactions"
                  value={`${stats?.likes ?? 0}`}
                />
              </Link>

              <Link to={( `/channels/${channelId}/settings/appearance` as any )} className="no-underline">
                <SettingsRow
                  icon={Settings}
                  iconBg="bg-orange-500"
                  label="Appearance"
                />
              </Link>

              <SettingsRow
                icon={Lock}
                iconBg="bg-purple-500"
                label="Auto-translate messages"
                toggle={{ checked: !!channel.autoTranslateEnabled, onChange: () => handleToggleAutoTranslate(), disabled: !canManage }}
              />

              <Link to={( `/channels/${channelId}/settings/direct-messages` as any )} className="no-underline">
                <SettingsRow
                  icon={MessageCircle}
                  iconBg="bg-indigo-500"
                  label="Direct messages"
                  value={channel.allowDirectMessages ? "On" : "Off"}
                />
              </Link>
            </SettingsGroup>

            <Card>
              <CardHeader>
                <CardTitle>Core settings</CardTitle>
                <CardDescription>Control access, discussion, translation, and messenger options.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium">Channel type</p>
                      <p className="text-xs text-muted-foreground">Public channels are discoverable. Private channels require approval.</p>
                    </div>
                    <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">{channel.visibility}</span>
                  </div>
                  <RadioGroup value={channel.visibility} onValueChange={(value) => handleSaveChannelType(value as "public" | "private")}> 
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors hover:border-primary/70">
                        <RadioGroupItem value="public" id="visibility-public" />
                        <div>
                          <p className="font-semibold">Public</p>
                          <p className="text-sm text-muted-foreground">Anyone with the link can join.</p>
                        </div>
                      </label>
                      <label className="flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors hover:border-primary/70">
                        <RadioGroupItem value="private" id="visibility-private" />
                        <div>
                          <p className="font-semibold">Private</p>
                          <p className="text-sm text-muted-foreground">Membership must be approved by a channel admin.</p>
                        </div>
                      </label>
                    </div>
                  </RadioGroup>
                </div>

                <div className="grid gap-3">
                  <div className="grid gap-1">
                    <Label htmlFor="discussion-chat-id">Discussion chat</Label>
                    <Input
                      id="discussion-chat-id"
                      value={discussionChatId}
                      onChange={(event) => setDiscussionChatId(event.target.value)}
                      placeholder="Linked chat ID or leave blank"
                      disabled={!canManage}
                    />
                  </div>
                  <Button onClick={handleSaveDiscussion} disabled={!canManage || savingDiscussion}>
                    {savingDiscussion ? "Saving…" : "Save discussion"}
                  </Button>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-2 rounded-xl border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">Auto-translate</p>
                        <p className="text-xs text-muted-foreground">Translate channel posts automatically for members.</p>
                      </div>
                      <Switch checked={channel.autoTranslateEnabled} onCheckedChange={handleToggleAutoTranslate} disabled={!canManage || savingAutoTranslate} />
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 rounded-xl border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">Direct messages</p>
                        <p className="text-xs text-muted-foreground">Allow members to message the channel owner or admins.</p>
                      </div>
                      <Switch checked={channel.allowDirectMessages} onCheckedChange={handleToggleDirectMessages} disabled={!canManage || savingDirectMessages} />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Appearance</CardTitle>
                <CardDescription>Theme and display options are not yet persisted in this release.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                  Channel color themes will be added in a future update. For now, the channel keeps its current avatar and description styling.
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Stats</CardTitle>
                <CardDescription>{helperText}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-xl border bg-muted p-4">
                    <p className="text-sm text-muted-foreground">Subscribers</p>
                    <p className="mt-2 text-xl font-semibold">{subscriberCount}</p>
                  </div>
                  <div className="rounded-xl border bg-muted p-4">
                    <p className="text-sm text-muted-foreground">Views</p>
                    <p className="mt-2 text-xl font-semibold">{stats?.views ?? 0}</p>
                  </div>
                  <div className="rounded-xl border bg-muted p-4">
                    <p className="text-sm text-muted-foreground">Reactions</p>
                    <p className="mt-2 text-xl font-semibold">{stats?.likes ?? 0}</p>
                  </div>
                </div>
                <div className="rounded-xl border p-3 bg-card">
                  <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Growth</p>
                  {stats?.growth.length ? (
                    <div className="mt-3 grid gap-2">
                      {stats.growth.slice(-5).map((row) => (
                        <div key={row.date} className="flex items-center justify-between text-sm">
                          <span>{row.date}</span>
                          <span className="font-semibold">{row.members}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-muted-foreground">No growth data yet.</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Administrators</CardTitle>
                <CardDescription>Grant or revoke channel admin access. <Link to={( `/channels/${channelId}/settings/administrators` as any )} className="ml-2 text-sm">Manage</Link></CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {admins.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No admins yet.</p>
                ) : (
                  <div className="space-y-3">
                    {admins.slice(0,3).map((admin) => (
                      <div key={admin.userId} className="flex items-center gap-3 rounded-xl border p-3">
                        <UserAvatar name={admin.displayName} src={admin.avatar} size={32} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{admin.displayName}</p>
                          <p className="text-xs text-muted-foreground">{admin.email || admin.userId}</p>
                        </div>
                        {admin.userId !== channel.ownerId && (
                          <Button
                            size="sm"
                            variant={admin.isAdmin ? "outline" : "default"}
                            onClick={() => (admin.isAdmin ? handleDemoteAdmin(admin.userId) : handlePromoteAdmin(admin.userId))}
                          >
                            {admin.isAdmin ? "Demote" : "Promote"}
                          </Button>
                        )}
                      </div>
                    ))}
                    {admins.length > 3 ? <Link to={( `/channels/${channelId}/settings/administrators` as any )} className="text-sm">View all</Link> : null}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Subscribers</CardTitle>
                <CardDescription>Search members and review who can see channel posts. <Link to={( `/channels/${channelId}/settings/subscribers` as any )} className="ml-2 text-sm">Manage</Link></CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Input
                  placeholder="Search subscribers"
                  value={subscriberSearch}
                  onChange={(event) => setSubscriberSearch(event.target.value)}
                />
                <div className="space-y-2">
                  {subscriberList.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No subscribers found.</p>
                  ) : (
                    subscriberList.slice(0,4).map((subscriber) => (
                      <div key={subscriber.userId} className="flex items-center gap-3 rounded-xl border p-3">
                        <UserAvatar name={subscriber.displayName} src={subscriber.avatar} size={32} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{subscriber.displayName}</p>
                          <p className="text-xs text-muted-foreground">{subscriber.email || subscriber.userId}</p>
                        </div>
                        {subscriber.isAdmin ? (
                          <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">Admin</span>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
                {nextSubscriberCursor !== null ? (
                  <Button variant="outline" onClick={() => setSubscriberCursor(nextSubscriberCursor)}>
                    Load more
                  </Button>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Removed members</CardTitle>
                <CardDescription>Restore previously removed subscribers.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {removedMembers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No removed members.</p>
                ) : (
                  removedMembers.map((member) => (
                    <div key={`${member.userId}-${member.removedAt}`} className="flex items-center gap-3 rounded-xl border p-3">
                      <div className="flex-1 min-w-0">
                        <p className="truncate font-medium">{member.displayName ?? member.userId}</p>
                        <p className="text-xs text-muted-foreground">Removed by {member.removedBy ?? "unknown"} · {timeAgo(member.removedAt)}</p>
                      </div>
                      <Button size="sm" onClick={() => handleUnbanMember(member.userId)}>
                        Restore
                      </Button>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent actions</CardTitle>
                <CardDescription>Audit events tied to this channel.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {recentActions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No recent actions yet.</p>
                ) : (
                  recentActions.slice(0, 6).map((action: any) => (
                    <div key={action.id} className="rounded-xl border p-3">
                      <p className="text-sm font-medium">{action.action}</p>
                      <p className="text-xs text-muted-foreground">By {action.adminId ?? "system"} · {timeAgo(action.createdAt)}</p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Communities</CardTitle>
                <CardDescription>Link the channel to a community by ID.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-xl border bg-muted p-3 text-sm text-muted-foreground">
                  {channel.communityId ? (
                    <>
                      Channel is currently linked to community <span className="font-semibold text-foreground">{channel.communityId}</span>.
                    </>
                  ) : (
                    "This channel is not linked to a community yet."
                  )}
                </div>
                <div className="grid gap-2">
                  <Input
                    placeholder="Community ID"
                    value={communityInput}
                    onChange={(event) => setCommunityInput(event.target.value)}
                    disabled={!canManage}
                  />
                  <Button onClick={handleAddCommunity} disabled={!canManage || addingCommunity || !communityInput.trim()}>
                    {addingCommunity ? "Saving…" : channel.communityId ? "Update community" : "Link community"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="border-destructive">
              <CardHeader>
                <CardTitle>Danger zone</CardTitle>
                <CardDescription>Delete the channel and all channel data.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-xl border border-dashed border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive-foreground">
                  Deleting a channel removes posts, memberships, removed member logs, join requests, and community links.
                </div>
                <Button variant="destructive" onClick={handleDeleteChannel} disabled={!canDelete || deletingChannel}>
                  {deletingChannel ? "Deleting…" : "Delete channel"}
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
