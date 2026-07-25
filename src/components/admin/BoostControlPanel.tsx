import React, { useState, useEffect } from 'react';
import { TrendingUp, Zap, Clock, Target } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Progress } from '@/components/ui/progress';
import { Calendar } from '@/components/ui/calendar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { ensureSupabase } from '@/lib/supabaseClient';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface ChannelSetting {
  boost_target: number;
  boost_kind: 'subscribers' | 'posts' | 'likes' | 'views';
  boost_mode: 'instant' | 'gradual';
  boost_start_time: string | null;
  boost_end_time: string | null;
}

export function BoostControlPanel() {
  const supabase = ensureSupabase();
  const me = useAuth();
  const [channels, setChannels] = useState<{ id: string; name: string }[]>([]);
  const [selectedChannel, setSelectedChannel] = useState('');
  const [targetCount, setTargetCount] = useState('');
  const [boostKind, setBoostKind] = useState<'subscribers' | 'posts' | 'likes' | 'views'>('subscribers');
  const [boostMode, setBoostMode] = useState<'instant' | 'gradual'>('gradual');
  const [durationHours, setDurationHours] = useState([24] as number[]);
  const [applying, setApplying] = useState(false);
  const [scheduleDate, setScheduleDate] = useState<Date | undefined>(undefined);
  const [settings, setSettings] = useState<ChannelSetting | null>(null);
  const [posts, setPosts] = useState<{ id: string; content?: string }[]>([]);
  const [selectedMessage, setSelectedMessage] = useState('');
  const [reaction, setReaction] = useState('');
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [loadingChannels, setLoadingChannels] = useState(true);

  useEffect(() => {
    fetchChannels();
  }, []);

  useEffect(() => {
    if (selectedChannel) {
      loadChannelSettings(selectedChannel);
    } else {
      setSettings(null);
    }
  }, [selectedChannel]);

  useEffect(() => {
    const fetchPosts = async () => {
      if (!selectedChannel) return setPosts([]);
      try {
        const { data } = await supabase
          .from('channel_posts')
          .select('id, body')
          .eq('channel_id', selectedChannel)
          .order('created_at', { ascending: false })
          .limit(50);
        setPosts((data as any)?.map((p: any) => ({ id: p.id, content: p.body })) || []);
      } catch (err) {
        console.error('[BoostControlPanel] fetchPosts', err);
        setPosts([]);
      }
    };

    if (boostKind !== 'subscribers') fetchPosts();
    else setPosts([]);
  }, [selectedChannel, boostKind, supabase]);

  const fetchChannels = async () => {
    setLoadingChannels(true);
    const { data, error } = await supabase
      .from('channels')
      .select('id, name');

    if (error) {
      console.error('[BoostControlPanel] fetchChannels', error);
      toast.error('Unable to load channels');
      setChannels([]);
    } else {
      setChannels(data || []);
    }
    setLoadingChannels(false);
  };

  const isMissingColumnError = (error: any, column: string) => {
    const message = `${error?.message ?? ''} ${error?.details ?? ''}`.toLowerCase();
    return message.includes(`could not find the '${column}' column`) || message.includes(`column \"${column}\" does not exist`) || message.includes(`column ${column} does not exist`);
  };

  const trySelectChannelSettings = async (chatId: string) => {
    const keys = ['chat_id', 'channel_id'] as const;
    for (const key of keys) {
      const { data, error } = await supabase
        .from('channel_settings')
        .select('boost_target, boost_kind, boost_mode, boost_start_time, boost_end_time')
        .eq(key, chatId)
        .single();
      if (!error) return { data, key, error: null };
      if (error.code === 'PGRST116') return { data: null, key, error: null };
      if (isMissingColumnError(error, key)) continue;
      return { data: null, key, error };
    }
    return { data: null, key: 'chat_id' as const, error: null };
  };

  const tryUpsertChannelSettings = async (chatId: string, payload: any) => {
    const keys = ['chat_id', 'channel_id'] as const;
    for (const key of keys) {
      const record = { ...payload, [key]: chatId };
      const { error } = await supabase.from('channel_settings').upsert(record, { onConflict: key as string });
      if (!error) return { error: null };
      if (isMissingColumnError(error, key)) continue;
      return { error };
    }
    return { error: { message: 'Channel settings insert failed due to unknown channel key', code: 'PGRST205' } };
  };

  const tryInsertPostBoost = async (insertObj: any) => {
    const payload = { ...insertObj, chat_id: selectedChannel };
    return await supabase.from('post_boosts').insert([payload]);
  };

  const loadChannelSettings = async (chatId: string) => {
    setLoadingSettings(true);
    const { data, error } = await trySelectChannelSettings(chatId);

    if (error) {
      console.error('[BoostControlPanel] loadChannelSettings', error);
      toast.error('Unable to load channel settings');
      setSettings(null);
    } else if (data) {
      setSettings(data as ChannelSetting);
      setTargetCount(String((data as any).boost_target || ''));
      setBoostMode((data as any).boost_mode || 'gradual');
      setBoostKind((data as any).boost_kind || 'subscribers');
      if ((data as any).boost_mode === 'gradual' && data.boost_start_time && data.boost_end_time) {
        const start = new Date((data as any).boost_start_time).getTime();
        const end = new Date((data as any).boost_end_time).getTime();
        setDurationHours([Math.max(1, Math.round((end - start) / 3600000))]);
      }
    } else {
      setSettings(null);
      setTargetCount('');
      setBoostMode('gradual');
      setBoostKind('subscribers');
      setDurationHours([24]);
    }
    setLoadingSettings(false);
  };

  const calculateProgress = () => {
    if (!settings) return 0;
    if ((settings as any).boost_mode === 'instant') return settings.boost_target > 0 ? 100 : 0;
    if (!settings.boost_start_time || !settings.boost_end_time) return 0;
    const now = Date.now();
    const start = new Date(settings.boost_start_time).getTime();
    const end = new Date(settings.boost_end_time).getTime();
    if (end <= start) return 0;
    return Math.min(100, Math.max(0, Math.round(((now - start) / (end - start)) * 100)));
  };

  const applyBoost = async () => {
    if (!me) {
      toast.error('You must be logged in to apply a boost');
      return;
    }
    if (!selectedChannel || !targetCount) {
      toast.error('Select a channel and enter target count');
      return;
    }

    setApplying(true);
    const now = scheduleDate || new Date();
    const endTime = new Date(now.getTime() + durationHours[0] * 3600000);

    let error = null;

    if (boostKind === 'subscribers') {
      // update channel-level subscriber boost only
      const res = await tryUpsertChannelSettings(selectedChannel, {
        boost_target: parseInt(targetCount, 10),
        boost_kind: boostKind,
        boost_mode: boostMode,
        boost_start_time: boostMode === 'gradual' ? now.toISOString() : null,
        boost_end_time: boostMode === 'gradual' ? endTime.toISOString() : null,
      });
      error = res.error;
    } else {
      // create a per-post boost; do not modify channel_settings so subscriber boost remains
      if (!selectedMessage) {
        toast.error('Select a post to boost');
        setApplying(false);
        return;
      }

      const insertObj: any = {
        message_id: selectedMessage,
        boost_kind: boostKind,
        boost_target: parseInt(targetCount, 10),
        boost_mode: boostMode,
        boost_start_time: boostMode === 'gradual' ? now.toISOString() : null,
        boost_end_time: boostMode === 'gradual' ? endTime.toISOString() : null,
        reaction: boostKind === 'likes' ? reaction || null : null,
      };

      const res = await tryInsertPostBoost(insertObj);
      error = res.error;
    }

    setApplying(false);
    if (error) {
      console.error('[BoostControlPanel] applyBoost', error);
      toast.error('Failed to apply boost');
      return;
    }

    toast.success(
      `Boost applied: +${targetCount} ${boostKind} ${boostMode === 'gradual' ? `over ${durationHours[0]}h` : 'instantly'}`
    );
    loadChannelSettings(selectedChannel);
  };

  const selectedChannelName = channels.find((ch) => ch.id === selectedChannel)?.name;
  const progress = calculateProgress();
  const boostActive = !!settings && (settings as any).boost_target > 0;

  return (
    <div className="space-y-4">
      {boostActive && (
        <Alert className="border-primary/30 bg-primary/5">
          <TrendingUp className="h-4 w-4 text-primary" />
          <AlertTitle className="text-sm">Boost Active</AlertTitle>
          <AlertDescription className="text-xs text-muted-foreground">
            <span>{selectedChannelName || 'Selected channel'} boost is active. {progress}% complete.</span>
            <Progress value={progress} className="h-1.5 mt-2" />
          </AlertDescription>
        </Alert>
      )}

      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="p-4 flex items-start gap-3">
          <TrendingUp className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-foreground">Live Channel Boost</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Admin boost settings now support subscribers, post counts, likes, and views with instant or gradual delivery.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-foreground flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            Configure Boost
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Channel</Label>
            <Select value={selectedChannel} onValueChange={setSelectedChannel}>
              <SelectTrigger className="bg-secondary border-border">
                <SelectValue placeholder={loadingChannels ? 'Loading channels...' : 'Select channel'} />
              </SelectTrigger>
              <SelectContent>
                {channels.map((ch) => (
                  <SelectItem key={ch.id} value={ch.id}>
                    {ch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Target className="w-3.5 h-3.5" />
              Target Boost Count
            </Label>
            <Input
              type="number"
              placeholder="e.g. 5000"
              value={targetCount}
              onChange={(e) => setTargetCount(e.target.value)}
              className="bg-secondary border-border"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Boost Type</Label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'subscribers', label: 'Subscribers' },
                { value: 'posts', label: 'Posts' },
                { value: 'likes', label: 'Likes' },
                { value: 'views', label: 'Views' },
              ].map((option) => (
                <button
                  key={option.value}
                  onClick={() => setBoostKind(option.value as any)}
                  className={`p-3 rounded-lg border text-left transition-all ${
                    boostKind === option.value
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border bg-secondary text-muted-foreground'
                  }`}
                >
                  <div className="text-xs font-medium">{option.label}</div>
                  <div className="text-[10px] opacity-70">
                    {option.value === 'subscribers' && 'Boost member total'}
                    {option.value === 'posts' && 'Boost post count'}
                    {option.value === 'likes' && 'Boost reaction count'}
                    {option.value === 'views' && 'Boost view estimates'}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Boost Mode</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setBoostMode('gradual')}
                className={`p-3 rounded-lg border text-left transition-all ${
                  boostMode === 'gradual'
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border bg-secondary text-muted-foreground'
                }`}
              >
                <Clock className="w-4 h-4 mb-1" />
                <div className="text-xs font-medium">Gradual</div>
                <div className="text-[10px] opacity-70">Natural growth curve</div>
              </button>
              <button
                onClick={() => setBoostMode('instant')}
                className={`p-3 rounded-lg border text-left transition-all ${
                  boostMode === 'instant'
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border bg-secondary text-muted-foreground'
                }`}
              >
                <Zap className="w-4 h-4 mb-1" />
                <div className="text-xs font-medium">Instant</div>
                <div className="text-[10px] opacity-70">Immediate jump</div>
              </button>
            </div>
          </div>

          {boostMode === 'gradual' && (
            <div className="space-y-2 animate-fade-in">
              <Label className="text-xs text-muted-foreground">Duration: {durationHours[0]} hours</Label>
              <Slider value={durationHours} onValueChange={setDurationHours} min={1} max={720} step={1} />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>1h</span>
                <span>~{Math.round(parseInt(targetCount || '0', 10) / Math.max(1, durationHours[0]))} subs/hour</span>
                <span>30 days</span>
              </div>
            </div>
          )}

          {boostKind !== 'subscribers' && (
            <div className="space-y-1.5 animate-fade-in">
              <Label className="text-xs text-muted-foreground">Select Post to Boost</Label>
              {posts.length === 0 ? (
                <p className="text-xs text-muted-foreground py-3 text-center">No posts available in this channel.</p>
              ) : (
                <div className="max-h-40 overflow-y-auto border border-border rounded-lg bg-secondary">
                  {posts.map((post) => (
                    <button
                      key={post.id}
                      onClick={() => setSelectedMessage(post.id)}
                      className={`w-full text-left p-2 border-b text-xs transition-all ${
                        selectedMessage === post.id
                          ? 'bg-primary/10 border-primary text-foreground'
                          : 'bg-secondary text-muted-foreground hover:bg-secondary/80'
                      }`}
                    >
                      <p className="truncate font-medium">{post.content ? post.content.substring(0, 50) : '(No content)'}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <Separator />

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Schedule Start (optional)</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start text-sm border-border bg-secondary">
                  {scheduleDate ? format(scheduleDate, 'PPP') : 'Start immediately'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 bg-card border-border" align="start">
                <Calendar
                  mode="single"
                  selected={scheduleDate}
                  onSelect={setScheduleDate}
                  initialFocus
                  className="pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </div>

          {boostKind !== 'subscribers' && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Select Post to Boost</Label>
              <Select value={selectedMessage} onValueChange={setSelectedMessage}>
                <SelectTrigger className="bg-secondary border-border">
                  <SelectValue placeholder={posts.length ? 'Select post' : 'No posts found'} />
                </SelectTrigger>
                <SelectContent>
                  {posts.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {(p as any).body ? (p as any).body.substring(0, 80) : p.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {boostKind === 'likes' && (
                <div>
                  <Label className="text-xs text-muted-foreground">Reaction (e.g. 👍)</Label>
                  <Input
                    placeholder="Reaction emoji (optional)"
                    value={reaction}
                    onChange={(e) => setReaction(e.target.value)}
                    className="bg-secondary border-border"
                  />
                </div>
              )}
            </div>
          )}

          <Button onClick={applyBoost} className="w-full" disabled={applying || !selectedChannel || !targetCount}>
            {applying ? 'Applying...' : `Apply ${boostMode === 'instant' ? 'Instant' : 'Gradual'} Boost`}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
