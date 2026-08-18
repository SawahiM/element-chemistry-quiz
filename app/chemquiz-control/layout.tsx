import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "数据管理 · ChemQuiz",
  description: "ChemQuiz 管理员账户与学习数据控制台。",
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
