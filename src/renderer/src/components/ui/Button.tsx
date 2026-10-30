import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/cn'

// Feedback starts on pointer-down (:active), and buttons give a little on press.
const button = cva(
  [
    'no-drag inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[var(--radius-control)] outline-none select-none',
    'text-label-secondary transition-[transform,background-color,color] duration-[var(--duration-press)] ease-out',
    'enabled:hover:bg-fill enabled:hover:text-label enabled:active:scale-[0.97] enabled:active:bg-fill-pressed',
    'disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[var(--accent-ring)]',
    'motion-reduce:enabled:active:scale-100'
  ],
  {
    variants: {
      size: {
        icon: 'size-7',
        text: 'h-7 px-2.5 text-footnote'
      },
      pressed: {
        true: 'bg-fill-strong text-label',
        false: ''
      }
    },
    defaultVariants: { size: 'icon', pressed: false }
  }
)

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ className, size, pressed, type = 'button', ...props }, ref) {
  return <button ref={ref} type={type} className={cn(button({ size, pressed }), className)} {...props} />
})
