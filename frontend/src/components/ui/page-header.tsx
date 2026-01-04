import * as React from "react";
import { cn } from "@/lib/utils";

export interface PageHeaderProps extends React.HTMLAttributes<HTMLElement> {
  children: React.ReactNode;
}

export const PageHeader = React.forwardRef<HTMLElement, PageHeaderProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <header
        ref={ref}
        className={cn(
          "sticky top-0 z-10 border-b border-border bg-gradient-to-b from-background via-background to-background backdrop-blur-sm pt-safe",
          className
        )}
        {...props}
      >
        {children}
      </header>
    );
  }
);

PageHeader.displayName = "PageHeader";
