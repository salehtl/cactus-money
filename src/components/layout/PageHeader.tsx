import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  action?: ReactNode;
}

export function PageHeader({ title, action }: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-4 sm:mb-6">
      <h1 className="text-lg sm:text-xl font-bold">{title}</h1>
      {action}
    </div>
  );
}
