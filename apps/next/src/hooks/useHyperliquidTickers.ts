"use client";

import { useContext, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { RootStoreContext } from "@/context/rootStoreContext";
import { fetchWithAuth } from "@/lib/utils";

const API_BASE =
  process.env.NEXT_PUBLIC_NEST_BACKEND_URL || "http://localhost:3000";

export interface HlPerp {
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

export type HlDex = "core" | "xyz" | string;

function normalize(value: string) {
  return value.trim().replace(/^\$/, "").toUpperCase();
}

/**
 * Loads the union of all Hyperliquid perps (core + builder dexes) once per
 * session and returns helpers for checking whether a symbol is tradable.
 */
export function useHyperliquidTickers() {
  const rootStore = useContext(RootStoreContext);
  const token = rootStore.session?.access_token ?? "";

  const query = useQuery({
    queryKey: ["hyperliquid", "tickers", "all"],
    enabled: !!token,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    queryFn: async () => {
      const response = await fetchWithAuth(
        token,
        `${API_BASE}/hyperliquid/perps?dex=all`,
      );
      if (!response.ok) {
        throw new Error(`HL tickers ${response.status}`);
      }
      return (await response.json()) as HlResponse;
    },
  });

  const map = useMemo(() => {
    const m = new Map<string, HlPerp>();
    for (const p of query.data?.perps ?? []) {
      m.set(normalize(p.name), p);
    }
    return m;
  }, [query.data]);

  const isTradable = (raw: string) => map.has(normalize(raw));
  const info = (raw: string): HlPerp | undefined => map.get(normalize(raw));

  return {
    isLoading: query.isLoading,
    isError: query.isError,
    count: map.size,
    fetchedAt: query.data?.fetched_at ?? null,
    isTradable,
    info,
  };
}
