"use client";

import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CandlestickChart,
  Loader2,
  RefreshCw,
} from "lucide-react";

import { AppNavbar } from "@/components/navbar/presets/app";
import { SourceSwitcher } from "@/components/navbar/custom/source-switcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RootStoreContext } from "@/context/rootStoreContext";
import useAuthGuard from "@/hooks/useAuthGuard";
import { fetchWithAuth } from "@/lib/utils";

const API_BASE =
  process.env.NEXT_PUBLIC_NEST_BACKEND_URL || "http://localhost:3000";

interface HlPerp {
  dex: string;
  name: string;
  symbol: string;
  max_leverage: number;
  mark_px: number;
  oracle_px: number;
  prev_day_px: number;
  change_pct_24h: number;
  day_notional_volume: number;
  day_base_volume: number;
  open_interest: number;
  funding: number;
  is_delisted: boolean;
}

interface HlResponse {
  fetched_at: string;
  dex: string;
  perps: HlPerp[];
}

type SortKey =
  | "name"
  | "max_leverage"
  | "mark_px"
  | "change_pct_24h"
  | "day_notional_volume"
  | "open_interest"
  | "funding";

type DexKey = "core" | "xyz" | "all";

const DEX_TABS: { key: DexKey; label: string; sub: string }[] = [
  { key: "core", label: "Core", sub: "crypto perps" },
  { key: "xyz", label: "XYZ", sub: "stocks & commodities" },
  { key: "all", label: "All", sub: "merged" },
];

const REFRESH_INTERVAL_MS = 10_000;

function formatUsd(value: number, maxDigits = 2) {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1_000_000_000)
    return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(value) >= 1_000_000)
    return `$${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  if (Math.abs(value) >= 1) return `$${value.toFixed(maxDigits)}`;
  return `$${value.toPrecision(4)}`;
}

function formatPct(value: number) {
  if (!Number.isFinite(value)) return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatFunding(value: number) {
  if (!Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(4)}%`;
}

export default function HyperliquidPage() {
  useAuthGuard();
  const rootStore = useContext(RootStoreContext);
  const token = rootStore.session?.access_token ?? "";

  const [data, setData] = useState<HlResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("day_notional_volume");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [dex, setDex] = useState<DexKey>("all");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetchWithAuth(
        token,
        `${API_BASE}/hyperliquid/perps?dex=${dex}`,
      );
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(body || `${response.status} ${response.statusText}`);
      }
      const payload = (await response.json()) as HlResponse;
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load perps");
    } finally {
      setLoading(false);
    }
  }, [token, dex]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => void load(), REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [load]);

  const handleSort = useCallback((key: SortKey) => {
    setSortKey((current) => {
      if (current === key) {
        setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
        return current;
      }
      setSortDir(key === "name" ? "asc" : "desc");
      return key;
    });
  }, []);

  const visiblePerps = useMemo(() => {
    const rows = data?.perps ?? [];
    const filtered = query.trim()
      ? rows.filter((p) =>
          p.name.toLowerCase().includes(query.trim().toLowerCase()),
        )
      : rows;
    const sorted = [...filtered].sort((a, b) => {
      const av = a[sortKey] as unknown;
      const bv = b[sortKey] as unknown;
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc"
          ? av.localeCompare(bv)
          : bv.localeCompare(av);
      }
      const an = Number(av);
      const bn = Number(bv);
      return sortDir === "asc" ? an - bn : bn - an;
    });
    return sorted;
  }, [data, query, sortKey, sortDir]);

  const totals = useMemo(() => {
    const rows = data?.perps ?? [];
    return {
      count: rows.length,
      total_volume: rows.reduce((sum, p) => sum + p.day_notional_volume, 0),
      total_oi: rows.reduce((sum, p) => sum + p.open_interest * p.mark_px, 0),
    };
  }, [data]);

  return (
    <div className="biz-workspace min-h-screen bg-background text-foreground">
      <AppNavbar className="border-b border-border bg-background/95 text-foreground" />
      <div className="pt-16">
        <SourceSwitcher />
      </div>
      <main className="mx-auto grid max-w-[1680px] gap-4 px-4 pb-8 pt-4">
        <section className="grid gap-3 border-b border-border pb-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-normal">
              <CandlestickChart className="h-6 w-6" />
              Hyperliquid Perpetuals
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Live universe + 24h volume + max leverage from{" "}
              <code className="rounded bg-muted px-1">api.hyperliquid.xyz</code>.
              Refreshes every 10s.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              {totals.count} perps · {formatUsd(totals.total_volume)} 24h vol
            </Badge>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void load()}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          </div>
        </section>

        <section className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="inline-flex overflow-hidden rounded-md border border-border">
              {DEX_TABS.map(({ key, label, sub }) => (
                <button
                  key={key}
                  onClick={() => setDex(key)}
                  title={sub}
                  className={`px-3 py-1.5 text-sm transition-colors ${
                    dex === key
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                >
                  {label}
                  <span className="ml-1 text-[10px] uppercase tracking-wider opacity-70">
                    {sub}
                  </span>
                </button>
              ))}
            </div>
            <Input
              placeholder="Filter tickers"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="max-w-xs"
            />
          </div>
          {data?.fetched_at && (
            <span className="text-xs text-muted-foreground">
              Updated {new Date(data.fetched_at).toLocaleTimeString()}
            </span>
          )}
        </section>

        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <section className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <Th sortKey="name" current={sortKey} dir={sortDir} onSort={handleSort} align="left">
                  Ticker
                </Th>
                {dex === "all" && (
                  <th className="px-3 py-2 text-left">Dex</th>
                )}
                <Th sortKey="max_leverage" current={sortKey} dir={sortDir} onSort={handleSort}>
                  Max lev
                </Th>
                <Th sortKey="mark_px" current={sortKey} dir={sortDir} onSort={handleSort}>
                  Mark
                </Th>
                <Th sortKey="change_pct_24h" current={sortKey} dir={sortDir} onSort={handleSort}>
                  24h Δ
                </Th>
                <Th sortKey="day_notional_volume" current={sortKey} dir={sortDir} onSort={handleSort}>
                  24h Volume
                </Th>
                <Th sortKey="open_interest" current={sortKey} dir={sortDir} onSort={handleSort}>
                  OI (base)
                </Th>
                <Th sortKey="funding" current={sortKey} dir={sortDir} onSort={handleSort}>
                  Funding
                </Th>
              </tr>
            </thead>
            <tbody>
              {!data && loading && (
                <tr>
                  <td colSpan={dex === "all" ? 8 : 7} className="px-3 py-8 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </td>
                </tr>
              )}
              {data && visiblePerps.length === 0 && (
                <tr>
                  <td colSpan={dex === "all" ? 8 : 7} className="px-3 py-8 text-center text-muted-foreground">
                    No tickers match.
                  </td>
                </tr>
              )}
              {visiblePerps.map((p) => (
                <tr
                  key={`${p.dex}:${p.symbol}`}
                  className="border-b border-border/60 hover:bg-accent/40"
                >
                  <td className="px-3 py-2 font-mono font-medium">
                    {p.name}
                    {p.is_delisted && (
                      <Badge variant="outline" className="ml-2 text-[10px]">
                        delisted
                      </Badge>
                    )}
                  </td>
                  {dex === "all" && (
                    <td className="px-3 py-2">
                      <Badge
                        variant="outline"
                        className={
                          p.dex === "core"
                            ? "border-primary/40 text-primary"
                            : "border-amber-500/40 text-amber-600 dark:text-amber-400"
                        }
                      >
                        {p.dex}
                      </Badge>
                    </td>
                  )}
                  <td className="px-3 py-2 text-right">{p.max_leverage}x</td>
                  <td className="px-3 py-2 text-right font-mono">
                    {formatUsd(p.mark_px, 4)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-mono ${
                      p.change_pct_24h > 0
                        ? "text-emerald-600"
                        : p.change_pct_24h < 0
                          ? "text-rose-600"
                          : ""
                    }`}
                  >
                    {formatPct(p.change_pct_24h)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {formatUsd(p.day_notional_volume)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                    {p.open_interest.toLocaleString(undefined, {
                      maximumFractionDigits: 0,
                    })}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-mono ${
                      p.funding > 0
                        ? "text-emerald-600"
                        : p.funding < 0
                          ? "text-rose-600"
                          : ""
                    }`}
                  >
                    {formatFunding(p.funding)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  );
}

interface ThProps {
  sortKey: SortKey;
  current: SortKey;
  dir: "asc" | "desc";
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
  children: React.ReactNode;
}

function Th({ sortKey, current, dir, onSort, align = "right", children }: ThProps) {
  const active = current === sortKey;
  return (
    <th
      className={`px-3 py-2 ${align === "right" ? "text-right" : "text-left"}`}
    >
      <button
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-foreground ${
          active ? "text-foreground" : ""
        }`}
      >
        {children}
        {active ? (
          dir === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </th>
  );
}
