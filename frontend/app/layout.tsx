import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { MangaTranslatorProvider } from "@/features/manga-translator/context/MangaTranslatorContext";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "JISA STUDIO - AI Manga Translation Engine",
  description: "Advanced AI Manga Translation System powered by Ollama and CUDA",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-app text-main font-sans">
        <MangaTranslatorProvider>
          {children}
        </MangaTranslatorProvider>
      </body>
    </html>
  );
}

