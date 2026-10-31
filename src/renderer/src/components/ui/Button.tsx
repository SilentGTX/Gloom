import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/cn'

// Feedback starts on pointer-down (:active). Chrome sizes are pixels, not rem,
// so the window's controls stay put when the text size grows.
const button = cva(
  [
    'no-drag inline-flex shrink-0 items-center justify-center gap-1.5 outline-none select-none',
    'text-label-secondary transition-[transform,background-color,color] duration-[var(--duration-press)] ease-out',
    'enabled:hover:bg-fill-strong enabled:hover:text-label enabled:active:bg-fill-pressed',
    'disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[var(--accent-ring)]'
  ],
  {
    variants: {
      size: {
        icon: 'size-[28px]',
        small: 'size-[24px]',
        text: 'h-[28px] px-2.5 text-[13px]'
      },
      shape: {
        // Plain controls give a little on press.
        rounded: 'rounded-[var(--radius-control)] enabled:active:scale-[0.97] motion-reduce:enabled:active:scale-100',
        // Inside a glass capsule the glass swells under the finger, as Apple's does.
        round: 'rounded-full enabled:active:scale-[1.08] motion-reduce:enabled:active:scale-100'
      },
      pressed: {
        true: 'bg-fill-strong text-label',
        false: ''
      },
      tone: {
        plain: '',
        // The default action: Gloom's dusk indigo, whatever Windows' accent is (a gray one reads as
        // disabled), as the open session's row is. White on it is 5.4:1.
        primary:
          'bg-[var(--signal)] font-medium text-white enabled:hover:bg-[var(--signal)] enabled:hover:text-white enabled:hover:brightness-110 enabled:active:bg-[var(--signal)]',
        // Its other actions sit on a quiet fill.
        secondary: 'bg-fill-strong text-label enabled:hover:bg-fill-pressed'
      }
    },
    defaultVariants: { size: 'icon', shape: 'rounded', pressed: false, tone: 'plain' }
  }
)

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ className, size, shape, pressed, tone, type = 'button', ...props }, ref) {
  return <button ref={ref} type={type} className={cn(button({ size, shape, pressed, tone }), className)} {...props} />
})
