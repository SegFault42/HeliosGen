import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-1 bg-bg-2", className)}
      {...props}
    />
  )
}

export { Skeleton }
