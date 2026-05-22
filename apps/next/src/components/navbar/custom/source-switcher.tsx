"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  MessageSquare,
  Twitter,
  Newspaper,
  FileText,
  Zap,
  CandlestickChart,
} from "lucide-react";

type SourceKey = "biz" | "x" | "hyperliquid" | "reddit" | "substack" | "nostr";

interface Source {
  key: SourceKey;
  label: string;
  href: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  enabled: boolean;
}

const SOURCES: Source[] = [
  { key: "biz", label: "4chan /biz", href: "/home", icon: MessageSquare, enabled: true },
  { key: "x", label: "X", href: "/home/x", icon: Twitter, enabled: true },
  { key: "hyperliquid", label: "Hyperliquid", href: "/home/hyperliquid", icon: CandlestickChart, enabled: true },
  { key: "reddit", label: "Reddit", href: "/home/reddit", icon: Newspaper, enabled: false },
  { key: "substack", label: "Substack", href: "/home/substack", icon: FileText, enabled: false },
  { key: "nostr", label: "Nostr", href: "/home/nostr", icon: Zap, enabled: false },
];

interface SourceSwitcherProps {
  className?: string;
}

export function SourceSwitcher({ className = "" }: SourceSwitcherProps) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/home") return pathname === "/home";
    return pathname.startsWith(href);
  };

  return (
    <nav
      aria-label="Data source"
      className={`flex items-center gap-1 overflow-x-auto border-b border-border bg-background/80 px-4 py-2 backdrop-blur ${className}`}
    >
      {SOURCES.map(({ key, label, href, icon: Icon, enabled }) => {
        const active = isActive(href);
        const base =
          "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap";
        if (!enabled) {
          return (
            <span
              key={key}
              title="Coming soon"
              className={`${base} text-muted-foreground/60 cursor-not-allowed`}
              aria-disabled="true"
            >
              <Icon size={14} />
              {label}
              <span className="ml-1 text-[10px] uppercase tracking-wider text-muted-foreground/60">
                soon
              </span>
            </span>
          );
        }
        return (
          <Link
            key={key}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`${base} ${
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <Icon size={14} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
