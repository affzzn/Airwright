import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const fieldBase =
  "h-10 w-full rounded-lg border border-hairline-strong bg-canvas px-3 text-sm text-ink " +
  "transition-colors placeholder:text-ink-subtle hover:border-ink/30 " +
  "focus-visible:outline-none focus-visible:border-ink focus-visible:ring-2 focus-visible:ring-ink/15";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(fieldBase, className)} {...props} />
));
Input.displayName = "Input";

/** Native select with a custom chevron (kills the OS-default arrow). */
export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <div className="relative">
    <select
      ref={ref}
      className={cn(fieldBase, "cursor-pointer appearance-none pr-9", className)}
      {...props}
    />
    <ChevronDown
      className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
      strokeWidth={1.75}
      aria-hidden
    />
  </div>
));
Select.displayName = "Select";

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("mb-1.5 block text-sm font-medium text-ink", className)}
      {...props}
    />
  );
}
