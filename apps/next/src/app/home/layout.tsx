import type { Metadata } from "next";
import { createMetadata } from "@/lib/metadata";

export const metadata: Metadata = createMetadata({
  title: "MoneyTree",
  description:
    "Financial signal workspace for reading, searching, and analyzing market discussion.",
  keywords: ["financial analysis", "market sentiment", "news analysis"],
  canonical: "/home",
});

export default function HomeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
