import React, { useState, useEffect } from 'react';
import { Check, X, Clock, MessageSquare, Eye, Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Toggle } from '@/components/ui/toggle';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { Skeleton } from '@/components/ui/skeleton';
import { ensureSupabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';

interface PendingComment {
  id: string;
  content: string;
  user_id: string;
  message_id: string;
  created_at: string;
  status: 'pending' | 'approved' | 'rejected';
  username?: string;
  display_name?: string;
}

const PER_PAGE = 5;

export function CommentApprovalQueue() {
  const supabase = ensureSupabase();
  const [comments, setComments] = useState<PendingComment[]>([]);
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [compactView, setCompactView] = useState(false);

  useEffect(() => {
    fetchComments();
  }, [filter]);

  const isMissingTableError = (error: any) => {
    const message = `${error?.message ?? ''} ${error?.details ?? ''}`.toLowerCase();
    return message.includes('could not find the table') || error?.code === 'PGRST205';
  };

  const fetchComments = async () => {
    setLoading(true);
    let query = supabase
      .from('comments')
      .select('id, content, user_id, message_id, created_at, status, user:user_id (username, display_name)')
      .order('created_at', { ascending: false })
      .limit(50);

    if (filter === 'pending') {
      query = query.eq('status', 'pending');
    }

    const { data, error } = await query;
    if (error) {
      if (isMissingTableError(error)) {
        console.warn('[CommentApprovalQueue] comments table missing, skipping queue load');
        setComments([]);
        setLoading(false);
        setPage(1);
        setSelected(new Set());
        return;
      }
      console.error('[CommentApprovalQueue] fetchComments', error);
      toast.error('Unable to load comments');
      setComments([]);
      setLoading(false);
      return;
    }

    const normalized = (data || []).map((comment: any) => ({
      id: comment.id,
      content: comment.content,
      user_id: comment.user_id,
      message_id: comment.message_id,
      created_at: comment.created_at,
      status: comment.status,
      username: comment.user?.username || 'user',
      display_name: comment.user?.display_name || 'Unknown',
    }));

    setComments(normalized);
    setLoading(false);
    setPage(1);
    setSelected(new Set());
  };

  const handleAction = async (commentId: string, action: 'approved' | 'rejected') => {
    const { error } = await supabase
      .from('comments')
      .update({ status: action })
      .eq('id', commentId);

    if (error) {
      if (isMissingTableError(error)) {
        toast.error('Comments queue is unavailable on this backend');
        return;
      }
      console.error('[CommentApprovalQueue] handleAction', error);
      toast.error('Failed to update comment');
      return;
    }

    setComments((prev) => prev.filter((comment) => comment.id !== commentId));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(commentId);
      return next;
    });
    toast.success(action === 'approved' ? 'Comment approved' : 'Comment rejected');
  };

  const handleBulkReject = async () => {
    const ids = Array.from(selected);
    await Promise.all(ids.map((id) => handleAction(id, 'rejected')));
    setSelected(new Set());
    toast.success(`${ids.length} comments rejected`);
  };

  const handleBulkApprove = async () => {
    const ids = Array.from(selected);
    await Promise.all(ids.map((id) => handleAction(id, 'approved')));
    setSelected(new Set());
    toast.success(`${ids.length} comments approved`);
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const paginatedComments = comments.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const toggleSelectAll = () => {
    if (selected.size === paginatedComments.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(paginatedComments.map((c) => c.id)));
    }
  };

  const pendingCount = comments.filter((c) => c.status === 'pending').length;
  const totalPages = Math.ceil(comments.length / PER_PAGE);

  return (
    <div className="space-y-4">
      <Card className="bg-destructive/5 border-destructive/20">
        <CardContent className="p-4 flex items-start gap-3">
          <Eye className="w-5 h-5 text-destructive mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-foreground">Hidden Approval Queue</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Users see their comments as posted, but they remain invisible to others until approved.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-2">
          <Button
            variant={filter === 'pending' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter('pending')}
            className={filter === 'pending' ? '' : 'border-border text-muted-foreground'}
          >
            <Clock className="w-3.5 h-3.5 mr-1.5" />
            Pending
            {pendingCount > 0 && (
              <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-[10px] bg-destructive text-destructive-foreground">
                {pendingCount}
              </Badge>
            )}
          </Button>
          <Button
            variant={filter === 'all' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter('all')}
            className={filter === 'all' ? '' : 'border-border text-muted-foreground'}
          >
            All
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Toggle pressed={compactView} onPressedChange={setCompactView} size="sm" className="text-xs gap-1">
            {compactView ? 'Compact' : 'Full'}
          </Toggle>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-2 p-2 bg-primary/5 rounded-lg border border-primary/20 animate-fade-in">
          <span className="text-xs text-foreground font-medium">{selected.size} selected</span>
          <div className="flex-1" />
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-online border-online/30" onClick={handleBulkApprove}>
            <Check className="w-3 h-3" /> Approve All
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-destructive border-destructive/30">
                <Trash2 className="w-3 h-3" /> Reject All
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="bg-card border-border">
              <AlertDialogHeader>
                <AlertDialogTitle>Reject {selected.size} comments?</AlertDialogTitle>
                <AlertDialogDescription>
                  These comments will be permanently rejected and will never be visible to users.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="border-border">Cancel</AlertDialogCancel>
                <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={handleBulkReject}>
                  Reject All
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}

      <div className="flex items-center gap-2 px-1">
        <Checkbox
          checked={paginatedComments.length > 0 && selected.size === paginatedComments.length}
          onCheckedChange={toggleSelectAll}
        />
        <span className="text-xs text-muted-foreground">Select all on this page</span>
      </div>

      <div className="space-y-2">
        {loading ? (
          [...Array(3)].map((_, i) => (
            <Card key={i} className="bg-card border-border">
              <CardContent className="p-3 flex items-start gap-3">
                <Skeleton className="w-8 h-8 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-48" />
                </div>
              </CardContent>
            </Card>
          ))
        ) : paginatedComments.length === 0 ? (
          <Card className="bg-card border-border">
            <CardContent className="p-8 text-center">
              <MessageSquare className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No comments match this filter.</p>
            </CardContent>
          </Card>
        ) : (
          paginatedComments.map((comment) => (
            <Card key={comment.id} className="bg-card border-border">
              <CardContent className="p-3">
                <div className="flex items-start gap-3">
                  <Checkbox
                    checked={selected.has(comment.id)}
                    onCheckedChange={() => toggleSelect(comment.id)}
                    className="mt-1"
                  />
                  <Avatar className="w-8 h-8 flex-shrink-0">
                    <AvatarFallback className="bg-primary/20 text-primary text-xs">
                      {(comment.display_name || 'U')[0].toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{comment.display_name}</span>
                      <span className="text-[10px] text-muted-foreground">@{comment.username}</span>
                      <Badge
                        variant="outline"
                        className={`text-[10px] ml-auto ${
                          comment.status === 'pending'
                            ? 'border-yellow-500/50 text-yellow-500'
                            : comment.status === 'approved'
                            ? 'border-online text-online'
                            : 'border-destructive text-destructive'
                        }`}
                      >
                        {comment.status}
                      </Badge>
                    </div>
                    <p className={`text-sm text-foreground/80 mt-1 ${compactView ? 'line-clamp-1' : ''}`}>{comment.content}</p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-[10px] text-muted-foreground">{new Date(comment.created_at).toLocaleString()}</span>
                      {comment.status === 'pending' && (
                        <div className="flex gap-1.5">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-online hover:text-online hover:bg-online/10"
                            onClick={() => handleAction(comment.id, 'approved')}
                          >
                            <Check className="w-3.5 h-3.5 mr-1" /> Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => handleAction(comment.id, 'rejected')}
                          >
                            <X className="w-3.5 h-3.5 mr-1" /> Reject
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {totalPages > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious onClick={() => setPage((p) => Math.max(1, p - 1))} className={page === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'} />
            </PaginationItem>
            {[...Array(totalPages)].map((_, i) => (
              <PaginationItem key={i}>
                <PaginationLink isActive={page === i + 1} onClick={() => setPage(i + 1)} className="cursor-pointer">
                  {i + 1}
                </PaginationLink>
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className={page === totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'} />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}
