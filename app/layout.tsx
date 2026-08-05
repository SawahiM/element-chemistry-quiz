import type { Metadata } from "next";
import "katex/dist/katex.min.css";
import "./globals.css";
import AuthGate from "./auth-gate";

export const dynamic = "force-static";

export const metadata: Metadata = {
  metadataBase: new URL("http://localhost:3000"),
  title: "无机化学基础知识练习",
  description: "覆盖颜色性质、反应方程式、考试与试卷的无机化学基础知识练习。",
  openGraph: {
    title: "无机化学基础知识练习",
    description: "颜色性质、反应方程式与综合测试",
    type: "website",
    images: [{ url: "/og.png", width: 1536, height: 1024, alt: "无机化学基础知识练习" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "无机化学基础知识练习",
    description: "颜色性质、反应方程式与综合测试",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body><AuthGate>{children}</AuthGate></body>
    </html>
  );
}
