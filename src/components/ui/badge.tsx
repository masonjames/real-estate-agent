import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        success:
          "border-transparent bg-success text-success-foreground hover:bg-success/80",
        accent:
          "border-transparent bg-accent text-accent-foreground hover:bg-accent/80",
        outline: "text-foreground border-border",
        muted: "border-transparent bg-muted text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

// Match criteria badge with color coding based on criteria type
interface MatchBadgeProps {
  criteria: string;
  className?: string;
}

function getMatchBadgeVariant(criteria: string): "default" | "secondary" | "accent" | "success" | "muted" {
  const lowerCriteria = criteria.toLowerCase();

  if (lowerCriteria.includes("location") || lowerCriteria.includes("area") || lowerCriteria.includes("proximity")) {
    return "success";
  }
  if (lowerCriteria.includes("income") || lowerCriteria.includes("wealth") || lowerCriteria.includes("financial")) {
    return "accent";
  }
  if (lowerCriteria.includes("industry") || lowerCriteria.includes("profession") || lowerCriteria.includes("job")) {
    return "default";
  }
  if (lowerCriteria.includes("family") || lowerCriteria.includes("lifestyle") || lowerCriteria.includes("age")) {
    return "secondary";
  }
  return "muted";
}

function MatchBadge({ criteria, className }: MatchBadgeProps) {
  const variant = getMatchBadgeVariant(criteria);

  return (
    <Badge variant={variant} className={className}>
      {criteria}
    </Badge>
  );
}

export { Badge, badgeVariants, MatchBadge };
