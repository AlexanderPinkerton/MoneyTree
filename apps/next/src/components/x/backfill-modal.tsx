"use client";

import React, { useMemo, useState } from "react";
import { AlertTriangle, History, Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const LIMIT_OPTIONS = [200, 500, 1000, 2000, 3200] as const;
type LimitChoice = (typeof LIMIT_OPTIONS)[number];

interface BackfillModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: { handle: string; label: string | null }[];
  onSubmit: (input: { handle: string | null; limit: number }) => Promise<void>;
}

function estimateSeconds(handles: number, limit: number) {
  // bird returns ~200 tweets per invocation, ~3-5s per call incl. delay.
  // Plus 3s between handles.
  const pagesPerHandle = Math.ceil(limit / 200);
  const perHandleSeconds = pagesPerHandle * 5 + 3;
  return Math.round(handles * perHandleSeconds);
}

function formatDuration(totalSeconds: number) {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function BackfillModal({
  open,
  onOpenChange,
  accounts,
  onSubmit,
}: BackfillModalProps) {
  const [limit, setLimit] = useState<LimitChoice>(1000);
  const [scope, setScope] = useState<string>("__all__");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const scopedCount = scope === "__all__" ? accounts.length : 1;
  const estimate = useMemo(
    () => formatDuration(estimateSeconds(scopedCount, limit)),
    [scopedCount, limit],
  );
  const estimatedTweets = scopedCount * limit;

  const reset = () => {
    setError(null);
    setSubmitting(false);
    setConfirmed(false);
    setLimit(1000);
    setScope("__all__");
  };

  const handleConfirmAndRun = async () => {
    if (!confirmed) {
      setConfirmed(true);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({
        handle: scope === "__all__" ? null : scope,
        limit,
      });
      reset();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start backfill");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4" />
            Backfill tweet history
          </DialogTitle>
          <DialogDescription>
            Loops <code className="rounded bg-muted px-1">bird user-tweets</code>{" "}
            with pagination to pull older tweets. This is a manual, long-running
            job — it never runs on a schedule.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 text-sm">
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Accounts to backfill
            </label>
            <Select value={scope} onValueChange={setScope} disabled={submitting}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">
                  All active accounts ({accounts.length})
                </SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.handle} value={a.handle}>
                    @{a.handle}
                    {a.label ? ` — ${a.label}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Tweets per account
            </label>
            <div className="grid grid-cols-5 gap-1">
              {LIMIT_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled={submitting}
                  onClick={() => setLimit(n)}
                  className={`rounded-md border px-2 py-1.5 text-sm font-medium transition-colors ${
                    limit === n
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                >
                  {n >= 1000 ? `${n / 1000}k` : n}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              X's profile timeline caps at ~3,200 tweets per handle. Existing tweets
              are upserted, so re-running is idempotent.
            </p>
          </div>

          <div className="rounded-md border border-border bg-muted/40 p-3 text-xs">
            <div className="grid grid-cols-2 gap-y-1">
              <span className="text-muted-foreground">Accounts</span>
              <span className="font-mono">{scopedCount}</span>
              <span className="text-muted-foreground">Up-to tweets</span>
              <span className="font-mono">{estimatedTweets.toLocaleString()}</span>
              <span className="text-muted-foreground">Estimated runtime</span>
              <span className="font-mono">{estimate}</span>
            </div>
          </div>

          {confirmed && !error && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                This will run for roughly <strong>{estimate}</strong> and may hit
                X's rate limits. Click <strong>Start backfill</strong> again to
                confirm.
              </span>
            </div>
          )}

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleConfirmAndRun}
            disabled={submitting}
            className={confirmed ? "bg-amber-600 hover:bg-amber-700 text-white" : ""}
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Starting…
              </>
            ) : confirmed ? (
              "Confirm — start backfill"
            ) : (
              "Start backfill"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
