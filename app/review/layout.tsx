import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "反应式复核台 · 元素化学",
  description: "逐条核对宋天佑《无机化学》OCR 提取的反应方程式、条件与教材证据。",
};

export default function ReviewLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}

