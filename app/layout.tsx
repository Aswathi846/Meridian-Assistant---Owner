import type { Metadata } from "next";
import { ASSISTANT_NAME } from "@/config";
import "./globals.css";

export const metadata: Metadata = {
  title: ASSISTANT_NAME,
  description: "A customer service assistant for Meridian Bank.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
