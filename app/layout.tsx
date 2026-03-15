import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Polycast – AI Prediction Markets",
  description: "Polycast is an AI forecasting layer on top of Polymarket, tracking real-money bets from leading models."
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

