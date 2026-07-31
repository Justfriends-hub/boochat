import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  getChannelAdmins,
  promoteToChannelAdmin,
  demoteChannelAdmin,
  getChannel,
} from "@/api/channelsApi";
import { UserAvatar } from "@/components/UserAvatar";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_app/channels/$channelId/settings/administrators")({
  component: AdministratorsPage,
});

function AdministratorsPage() {
  const { channelId } = Route.useParams();
  const qc = useQueryClient();
  const me = useAuth();

  const { data: channel } = useQuery({ queryKey: ["channel", channelId], queryFn: () => getChannel(channelId) });
  const { data: admins = [] } = useQuery({ queryKey: ["channel-admins", channelId], queryFn: () => getChannelAdmins(channelId), enabled: !!channel });

  const promote = async (userId: string) => {
    if (!channel) return;
    try {
      await promoteToChannelAdmin(channel.id, userId);
      qc.invalidateQueries({ queryKey: ["channel-admins", channelId] });
      qc.invalidateQueries({ queryKey: ["channel", channelId] });
      toast.success("Promoted to admin");
    } catch (err: any) {
      toast.error(err.message || "Unable to promote");
    }
  };

  const demote = async (userId: string) => {
    if (!channel) return;
    try {
      await demoteChannelAdmin(channel.id, userId);
      qc.invalidateQueries({ queryKey: ["channel-admins", channelId] });
      qc.invalidateQueries({ queryKey: ["channel", channelId] });
      toast.success("Demoted from admin");
    } catch (err: any) {
      toast.error(err.message || "Unable to demote");
    }
  };

  if (!me || !channel) return null;

  return (
    <div className="p-4">
      <div className="mb-4">
        <Link to="/channels/$channelId/settings" params={{ channelId }} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
      </div>
      <h2 className="mb-3 text-lg font-semibold">Administrators</h2>
      <p className="mb-4 text-sm text-muted-foreground">Manage channel administrators.</p>
      <div className="space-y-3">
        {admins.length === 0 ? (
          <p className="text-sm text-muted-foreground">No admins yet.</p>
        ) : (
          admins.map((a) => (
            <div key={a.userId} className="flex items-center gap-3 rounded-xl border p-3">
              <UserAvatar name={a.displayName} src={a.avatar} size={36} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{a.displayName}</div>
                <div className="text-xs text-muted-foreground">{a.email || a.userId}</div>
              </div>
              {a.userId !== channel.ownerId && (
                <Button size="sm" variant={a.isAdmin ? "outline" : "default"} onClick={() => (a.isAdmin ? demote(a.userId) : promote(a.userId))}>
                  {a.isAdmin ? "Demote" : "Promote"}
                </Button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
