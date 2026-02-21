import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
    title: "SYJ Admin · ScaleYourJunk Operations Console",
    description: "Platform admin dashboard for ScaleYourJunk",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    );
}
