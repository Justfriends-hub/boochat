import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { boostPost } from "@/api/adminApi";
import { useAuth } from "@/hooks/useAuth";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export function BoostDialog({
  postId, open, onOpenChange,
}: { postId: string | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const me = useAuth();
  const qc = useQueryClient();
  const [amount, setAmount] = useState(100);
  const [kind, setKind] = useState<"likes" | "views">("views");
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!me || !postId) return;
    if (!Number.isFinite(amount) || amount <= 0) {
      setErr("Amount must be greater than zero.");
      return;
    }
    try {
      await boostPost({ adminId: me.id, postId, kind, amount });
      toast.success(`Boosted +${amount} ${kind}`);
      qc.invalidateQueries();
      onOpenChange(false);
      setAmount(100);
      setErr(null);
    } catch (e: any) {
      setErr(e.message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Boost post</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Type</Label>
            <RadioGroup value={kind} onValueChange={(v) => setKind(v as any)} className="mt-2 flex gap-4">
              <label className="flex items-center gap-2"><RadioGroupItem value="views" /> Views</label>
              <label className="flex items-center gap-2"><RadioGroupItem value="likes" /> Likes</label>
            </RadioGroup>
          </div>
          <div>
            <Label>Amount</Label>
            <Input
              type="number" min={1} value={amount}
              onChange={(e) => { setAmount(parseInt(e.target.value) || 0); setErr(null); }}
            />
            {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit}>Boost</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
