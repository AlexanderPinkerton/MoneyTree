"use client";

import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, ExternalLink } from "lucide-react";

interface ConnectXModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (creds: { auth_token: string; ct0: string }) => Promise<void>;
}

export function ConnectXModal({
  open,
  onOpenChange,
  onSubmit,
}: ConnectXModalProps) {
  const [authToken, setAuthToken] = useState("");
  const [ct0, setCt0] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({ auth_token: authToken.trim(), ct0: ct0.trim() });
      setAuthToken("");
      setCt0("");
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not validate cookies",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect your X (Twitter) account</DialogTitle>
          <DialogDescription>
            We use your browser cookies to fetch tweets via the{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">bird</code>{" "}
            CLI. The Nest server must have{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">bird</code>{" "}
            installed or
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              BIRD_BIN
            </code>{" "}
            set. Cookies stay private to your account.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <ol className="list-decimal space-y-2 pl-5 text-muted-foreground">
            <li>
              Open{" "}
              <a
                href="https://x.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                x.com <ExternalLink size={12} />
              </a>{" "}
              and make sure you&apos;re logged in.
            </li>
            <li>
              Open browser DevTools → Application → Cookies →{" "}
              <code>https://x.com</code>.
            </li>
            <li>
              Copy the values for <code>auth_token</code> and <code>ct0</code>{" "}
              and paste below.
            </li>
          </ol>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              auth_token
            </label>
            <Input
              value={authToken}
              onChange={(e) => setAuthToken(e.target.value)}
              placeholder="e.g. 8c9f4a..."
              autoComplete="off"
              spellCheck={false}
              required
            />
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              ct0
            </label>
            <Input
              value={ct0}
              onChange={(e) => setCt0(e.target.value)}
              placeholder="e.g. 5f1b2..."
              autoComplete="off"
              spellCheck={false}
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !authToken || !ct0}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Verifying…
                </>
              ) : (
                "Connect"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
