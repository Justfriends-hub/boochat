import React, { useState, useEffect } from 'react';
import { Users, TrendingUp, Megaphone } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Skeleton } from '@/components/ui/skeleton';
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { ensureSupabase } from '@/lib/supabaseClient';

interface ChannelData {
  id: string;
  name: string;
  real_members: number;
  boosted_count: number;
  visible_total: number;
}

const chartConfig: ChartConfig = {
  real_members: { label: 'Real Members', color: 'hsl(142 70% 49%)' },
  boosted_count: { label: 'Boosted', color: 'hsl(200 80% 55%)' },
};

export function ChannelOverview({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const supabase = ensureSupabase();
  const [channels, setChannels] = useState<ChannelData[]>([]);
  const [viewMode, setViewMode] = useState<string>('total');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchChannels();
  }, []);

  const fetchChannels = async () => {
    setLoading(true);
    const { data: chats, error: chatsError } = await supabase
      .from('channels')
      .select('id, name');

    if (chatsError || !chats) {
      console.error('[ChannelOverview] Failed to load channels', chatsError);
      setChannels([]);
      setLoading(false);
      return;
    }

    const channelData = await Promise.all(
      (chats as any).map(async (chat: any) => {
        const { count: realMembers } = await supabase
          .from('channel_members')
          .select('*', { count: 'exact', head: true })
          .eq('channel_id', chat.id);

        let boostCount = 0;
        const { data: boostData, error: boostError } = await supabase.rpc('get_visible_boost', { _chat_id: chat.id, _kind: 'any' }).catch((e) => ({ data: 0, error: e }));
        if (!boostError && boostData) {
          boostCount = (boostData as number) || 0;
        } else {
          console.warn('[ChannelOverview] get_visible_boost failed, falling back to manual boost totals', boostError);
          const { data: settingRows, error: settingsError } = await supabase
            .from('channel_settings')
            .select('boost_target')
            .eq('chat_id', chat.id);
          const { data: postBoostRows, error: postBoostError } = await supabase
            .from('post_boosts')
            .select('boost_target')
            .eq('chat_id', chat.id);
          if (!settingsError && settingRows) {
            boostCount += (settingRows as any[])
              .map((row) => Number(row.boost_target) || 0)
              .reduce((sum, value) => sum + value, 0);
          }
          if (!postBoostError && postBoostRows) {
            boostCount += (postBoostRows as any[])
              .map((row) => Number(row.boost_target) || 0)
              .reduce((sum, value) => sum + value, 0);
          }
        }

        return {
          id: chat.id,
          name: chat.name || 'Unnamed Channel',
          real_members: realMembers || 0,
          boosted_count: boostCount,
          visible_total: (realMembers || 0) + boostCount,
        };
      })
    );

    setChannels(channelData as ChannelData[]);
    setLoading(false);
  };

  const getDisplayCount = (ch: ChannelData) => {
    switch (viewMode) {
      case 'real':
        return ch.real_members;
      case 'boosted':
        return ch.boosted_count;
      default:
        return ch.visible_total;
    }
  };

  const totalRealMembers = channels.reduce((sum, c) => sum + c.real_members, 0);
  const totalVisible = channels.reduce((sum, c) => sum + c.visible_total, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="bg-card border-border">
          <CardContent className="p-4 text-center">
            <Megaphone className="w-5 h-5 text-primary mx-auto mb-1" />
            {loading ? (
              <Skeleton className="h-8 w-12 mx-auto" />
            ) : (
              <div className="text-2xl font-bold text-foreground">{channels.length}</div>
            )}
            <div className="text-xs text-muted-foreground">Channels</div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-4 text-center">
            <Users className="w-5 h-5 text-online mx-auto mb-1" />
            {loading ? (
              <Skeleton className="h-8 w-16 mx-auto" />
            ) : (
              <div className="text-2xl font-bold text-foreground">{totalRealMembers.toLocaleString()}</div>
            )}
            <div className="text-xs text-muted-foreground">Real Members</div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-4 text-center">
            <TrendingUp className="w-5 h-5 text-primary mx-auto mb-1" />
            {loading ? (
              <Skeleton className="h-8 w-16 mx-auto" />
            ) : (
              <div className="text-2xl font-bold text-foreground">{totalVisible.toLocaleString()}</div>
            )}
            <div className="text-xs text-muted-foreground">Visible Total</div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <h3 className="text-sm font-medium text-foreground mb-3">Subscriber Breakdown</h3>
          {loading ? (
            <Skeleton className="h-48 w-full" />
          ) : channels.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/50 p-8 text-center text-sm text-muted-foreground">
              No channels found yet. Create a channel to begin monitoring subscriber activity.
            </div>
          ) : (
            <ChartContainer config={chartConfig} className="h-48 w-full">
              <BarChart data={channels} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(210 11% 25%)" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'hsl(210 12% 55%)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'hsl(210 12% 55%)' }} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="real_members" fill="hsl(142 70% 49%)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="boosted_count" fill="hsl(200 80% 55%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      {isSuperAdmin && (
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">View:</span>
          <ToggleGroup type="single" value={viewMode} onValueChange={(v) => v && setViewMode(v)} className="bg-secondary rounded-lg p-0.5">
            <ToggleGroupItem value="total" className="text-xs h-7 px-3 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">Total</ToggleGroupItem>
            <ToggleGroupItem value="real" className="text-xs h-7 px-3 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">Real</ToggleGroupItem>
            <ToggleGroupItem value="boosted" className="text-xs h-7 px-3 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">Boosted</ToggleGroupItem>
          </ToggleGroup>
        </div>
      )}

      <Card className="bg-card border-border">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="w-10 h-10 rounded-full" />
                  <Skeleton className="h-4 w-24 flex-1" />
                  <Skeleton className="h-4 w-12" />
                  <Skeleton className="h-4 w-12" />
                </div>
              ))}
            </div>
          ) : channels.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No channel analytics are available yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-xs text-muted-foreground">Channel</TableHead>
                  <TableHead className="text-xs text-muted-foreground text-right">Real</TableHead>
                  <TableHead className="text-xs text-muted-foreground text-right">Boosted</TableHead>
                  <TableHead className="text-xs text-muted-foreground text-right">
                    {viewMode === 'real' ? 'Real' : viewMode === 'boosted' ? 'Boosted' : 'Total'}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {channels.map((channel) => (
                  <TableRow key={channel.id} className="border-border">
                    <TableCell className="font-medium text-sm">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                          <Megaphone className="w-4 h-4 text-primary" />
                        </div>
                        {channel.name}
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-sm text-online">{channel.real_members.toLocaleString()}</TableCell>
                    <TableCell className="text-right text-sm text-primary">{channel.boosted_count.toLocaleString()}</TableCell>
                    <TableCell className="text-right text-sm font-bold">{getDisplayCount(channel).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
