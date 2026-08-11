import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-primary/20 bg-primary/12 text-primary hover:bg-primary/18",
        secondary:
          "border-border/70 bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-destructive/20 bg-destructive/12 text-destructive hover:bg-destructive/18",
        outline: "border-border/70 bg-background/60 text-foreground",
        info: "border-info/20 bg-info/12 text-info hover:bg-info/18",
        success: "border-success/20 bg-success/12 text-success hover:bg-success/18",
        warning: "border-warning/25 bg-warning/16 text-warning hover:bg-warning/22",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
