import { cn } from "@/lib/utils"

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "label pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-full border border-border-2 bg-bg-2 px-1.5 text-text-2 select-none in-data-[slot=tooltip-content]:border-on-accent in-data-[slot=tooltip-content]:bg-transparent in-data-[slot=tooltip-content]:text-on-accent [&_svg:not([class*='size-'])]:size-3",
        className
      )}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }
