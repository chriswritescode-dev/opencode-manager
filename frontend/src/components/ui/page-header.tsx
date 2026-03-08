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
          "sticky top-0 z-10 border-b border-border/60 bg-background/84 supports-[backdrop-filter]:bg-background/68 backdrop-blur-xl pt-safe",
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
