import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";

interface HlMetaAsset {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  marginTableId?: number;
  onlyIsolated?: boolean;
  isDelisted?: boolean;
}

interface HlAssetCtx {
  funding: string;
  openInterest: string;
  prevDayPx: string;
  dayNtlVlm: string;
  premium?: string | null;
  oraclePx: string;
  markPx: string;
  midPx?: string | null;
  dayBaseVlm: string;
}

export interface HlPerp {
  dex: string; // "core" or builder dex name like "xyz"
  name: string; // display name (without dex prefix)
  symbol: string; // full id including prefix (e.g. "xyz:CL")
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

const HL_API = "https://api.hyperliquid.xyz/info";
const CACHE_TTL_MS = 5_000;
const CORE_DEX = "core";
const ALLOWED_BUILDER_DEXES = new Set<string>(["xyz"]);

@Injectable()
export class HyperliquidService {
  private readonly logger = new Logger(HyperliquidService.name);
  private cacheByDex = new Map<string, { fetchedAt: number; perps: HlPerp[] }>();
  private inflightByDex = new Map<string, Promise<HlPerp[]>>();

  async perps(opts: { dex?: string } = {}) {
    const requested = (opts.dex ?? CORE_DEX).toLowerCase();
    if (requested === "all") {
      const [core, ...builders] = await Promise.all([
        this.perpsForDex(CORE_DEX),
        ...[...ALLOWED_BUILDER_DEXES].map((d) => this.perpsForDex(d)),
      ]);
      const all = [...core, ...builders.flat()];
      return {
        fetched_at: new Date().toISOString(),
        dex: "all",
        perps: all,
      };
    }
    if (requested !== CORE_DEX && !ALLOWED_BUILDER_DEXES.has(requested)) {
      throw new ServiceUnavailableException(
        `Unknown dex: ${requested}. Allowed: core, ${[...ALLOWED_BUILDER_DEXES].join(", ")}, all`,
      );
    }
    const perps = await this.perpsForDex(requested);
    const cache = this.cacheByDex.get(requested);
    return {
      fetched_at: new Date(cache?.fetchedAt ?? Date.now()).toISOString(),
      dex: requested,
      perps,
    };
  }

  private async perpsForDex(dex: string): Promise<HlPerp[]> {
    const now = Date.now();
    const cached = this.cacheByDex.get(dex);
    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.perps;
    }
    let inflight = this.inflightByDex.get(dex);
    if (!inflight) {
      inflight = this.fetchDex(dex).finally(() => {
        this.inflightByDex.delete(dex);
      });
      this.inflightByDex.set(dex, inflight);
    }
    return inflight;
  }

  private async fetchDex(dex: string): Promise<HlPerp[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const body: Record<string, unknown> = { type: "metaAndAssetCtxs" };
    if (dex !== CORE_DEX) body.dex = dex;
    try {
      const response = await fetch(HL_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new ServiceUnavailableException(
          `Hyperliquid responded ${response.status} for dex=${dex}`,
        );
      }
      const payload = (await response.json()) as [
        { universe: HlMetaAsset[] },
        HlAssetCtx[],
      ];
      const meta = payload[0]?.universe ?? [];
      const ctxs = payload[1] ?? [];
      const perps: HlPerp[] = meta.map((asset, idx) => {
        const ctx = ctxs[idx];
        const markPx = Number(ctx?.markPx ?? 0);
        const prevDayPx = Number(ctx?.prevDayPx ?? 0);
        const changePct =
          prevDayPx > 0 ? ((markPx - prevDayPx) / prevDayPx) * 100 : 0;
        const symbol = asset.name;
        const display = symbol.includes(":") ? symbol.split(":")[1] : symbol;
        return {
          dex,
          name: display,
          symbol,
          max_leverage: asset.maxLeverage ?? 0,
          mark_px: markPx,
          oracle_px: Number(ctx?.oraclePx ?? 0),
          prev_day_px: prevDayPx,
          change_pct_24h: changePct,
          day_notional_volume: Number(ctx?.dayNtlVlm ?? 0),
          day_base_volume: Number(ctx?.dayBaseVlm ?? 0),
          open_interest: Number(ctx?.openInterest ?? 0),
          funding: Number(ctx?.funding ?? 0),
          is_delisted: Boolean(asset.isDelisted),
        };
      });
      this.cacheByDex.set(dex, { fetchedAt: Date.now(), perps });
      return perps;
    } catch (err) {
      this.logger.warn(
        `Hyperliquid fetch failed for dex=${dex}: ${err instanceof Error ? err.message : err}`,
      );
      const stale = this.cacheByDex.get(dex);
      if (stale) return stale.perps;
      throw new ServiceUnavailableException(
        err instanceof Error ? err.message : "Hyperliquid request failed",
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
