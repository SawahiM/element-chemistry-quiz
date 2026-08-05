import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "历史记录 · 元素化学",
  description: "查看考试记录、做题记录与错题整理。",
};

export default function HistoryLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
