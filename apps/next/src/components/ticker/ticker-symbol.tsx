"use client";

import React from "react";
import { ExternalLink, TrendingDown, TrendingUp } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useHyperliquidTickers, type HlPerp } from "@/hooks/useHyperliquidTickers";
import { cn } from "@/lib/utils";

interface TickerSymbolProps {
  symbol: string;
  /** Prefix the symbol with $ */
  withDollar?: boolean;
  /** Render as a button-like clickable element */
  onClick?: () => void;
  className?: string;
  /** Visual size of the underline / accent */
  size?: "sm" | "md";
}

function formatUsd(value: number) {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1_000_000_000)
    return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(value) >= 1_000_000)
    return `$${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  if (Math.abs(value) >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toPrecision(4)}`;
}

function formatPct(value: number) {
  if (!Number.isFinite(value)) return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

/**
 * Renders a ticker symbol. If the symbol is currently tradable on Hyperliquid
 * (core or any builder dex like xyz), it gets a distinctive style and a hover
 * card showing mark price, 24h change, volume, and max leverage.
 */
export function TickerSymbol({
  symbol,
  withDollar = false,
  onClick,
  className = "",
  size = "md",
}: TickerSymbolProps) {
  const { info } = useHyperliquidTickers();
  const hl = info(symbol);
  const tradable = !!hl;

  const baseClasses =
    "inline-flex items-center gap-1 font-mono font-medium tracking-tight transition-colors";

  const tradableClasses = tradable
    ? cn(
        "rounded-sm px-1 ring-1 cursor-help",
        hl?.dex === "xyz"
          ? "bg-amber-500/15 text-amber-700 ring-amber-500/40 dark:text-amber-300"
          : "bg-emerald-500/15 text-emerald-700 ring-emerald-500/40 dark:text-emerald-300",
      )
    : "text-foreground";

  const sizeClasses = size === "sm" ? "text-xs" : "text-sm";

  const tickerNode = (
    <>
      {tradable && (
        <span
          aria-hidden
          className={cn(
            "inline-block h-1.5 w-1.5 rounded-full",
            hl?.dex === "xyz" ? "bg-amber-500" : "bg-emerald-500",
          )}
        />
      )}
      <span>
        {withDollar && "$"}
        {symbol}
      </span>
    </>
  );

  const triggerClasses = cn(
    baseClasses,
    sizeClasses,
    tradableClasses,
    onClick ? "hover:underline" : "",
    className,
  );

  const trigger = onClick ? (
    <button type="button" onClick={onClick} className={triggerClasses}>
      {tickerNode}
    </button>
  ) : (
    <span className={triggerClasses}>{tickerNode}</span>
  );

  if (!tradable) return trigger;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs p-0">
        <HlTickerCard perp={hl} />
      </TooltipContent>
    </Tooltip>
  );
}

function HlTickerCard({ perp }: { perp: HlPerp }) {
  const changeColor =
    perp.change_pct_24h > 0
      ? "text-emerald-500"
      : perp.change_pct_24h < 0
        ? "text-rose-500"
        : "text-muted-foreground";
  const dexLabel = perp.dex === "xyz" ? "XYZ builder" : "Core";
  const dexAccent =
    perp.dex === "xyz"
      ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
      : "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300";

  return (
    <div className="w-64 space-y-2 p-3 text-xs">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold">{perp.name}</span>
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider",
              dexAccent,
            )}
          >
            HL · {dexLabel}
          </span>
        </div>
        <a
          href={`https://app.hyperliquid.xyz/trade/${perp.symbol}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground"
          title="Open on Hyperliquid"
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      </header>
      <dl className="grid grid-cols-2 gap-x-2 gap-y-1.5 font-mono">
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Mark
          </dt>
          <dd className="font-medium">{formatUsd(perp.mark_px)}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
            24h Δ
          </dt>
          <dd className={cn("flex items-center gap-1 font-medium", changeColor)}>
            {perp.change_pct_24h > 0 ? (
              <TrendingUp className="h-3 w-3" />
            ) : perp.change_pct_24h < 0 ? (
              <TrendingDown className="h-3 w-3" />
            ) : null}
            {formatPct(perp.change_pct_24h)}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
            24h Volume
          </dt>
          <dd className="font-medium">
            {formatUsd(perp.day_notional_volume)}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Max leverage
          </dt>
          <dd className="font-medium">{perp.max_leverage}x</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Open interest
          </dt>
          <dd className="font-medium">
            {perp.open_interest.toLocaleString(undefined, {
              maximumFractionDigits: 0,
            })}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Funding
          </dt>
          <dd
            className={cn(
              "font-medium",
              perp.funding > 0
                ? "text-emerald-500"
                : perp.funding < 0
                  ? "text-rose-500"
                  : "",
            )}
          >
            {(perp.funding * 100).toFixed(4)}%
          </dd>
        </div>
      </dl>
      {perp.is_delisted && (
        <p className="text-[10px] text-amber-500">delisted</p>
      )}
    </div>
  );
}
