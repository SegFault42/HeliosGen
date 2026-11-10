import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-full font-ui font-semibold whitespace-nowrap transition-[transform,box-shadow,background-color,border-color,color] duration-[120ms] ease-[var(--ease)] outline-none select-none focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-accent text-on-accent hover:bg-accent-hover active:not-aria-[haspopup]:translate-y-[2px] active:bg-accent-press active:shadow-[0_1px_0_var(--accent-edge)]",
        outline:
          "bg-surface text-text-1 font-medium border border-border-2 hover:border-text-2 active:bg-bg-2",
        secondary:
          "bg-surface text-text-1 font-medium border border-border-2 hover:border-text-2 active:bg-bg-2",
        ghost:
          "bg-transparent text-text-2 font-medium hover:text-text-1 hover:bg-bg-2",
        destructive:
          "bg-transparent text-error font-medium border border-error hover:bg-error hover:text-on-accent",
        link: "bg-transparent text-accent underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 gap-2 px-[18px] text-[14px]",
        xs: "h-7 gap-1 px-3 text-[12px]",
        sm: "h-8 gap-1.5 px-[14px] text-[13px]",
        lg: "h-[52px] gap-2 px-5 text-[17px]",
        icon: "size-10",
        "icon-xs": "size-7",
        "icon-sm": "size-8",
        "icon-lg": "size-[52px]",
      },
    },
    compoundVariants: [
      {
        variant: "default",
        size: ["default", "icon"],
        className: "shadow-[0_3px_0_var(--accent-edge)]",
      },
      {
        variant: "default",
        size: ["sm", "xs", "icon-sm", "icon-xs"],
        className: "shadow-[0_2px_0_var(--accent-edge)]",
      },
      {
        variant: "default",
        size: ["lg", "icon-lg"],
        className: "shadow-[0_4px_0_var(--accent-edge)]",
      },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
