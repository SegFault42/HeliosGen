import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      style={{ caretColor: "var(--accent)" }}
      className={cn(
        "h-10 w-full min-w-0 rounded-full border border-border-2 bg-bg-2 px-[14px] text-[14px] text-text-1 transition-colors duration-[120ms] ease-[var(--ease)] outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-text-1 placeholder:text-text-3 focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
