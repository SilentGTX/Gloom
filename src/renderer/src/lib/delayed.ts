import { useEffect, useState } from 'react'

/** Shows `value` only once it has held for `ms`, so quick loads never flash a spinner. */
export function useDelayed(value: boolean, ms: number): boolean {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!value) {
      setShown(false)
      return
    }
    const timer = setTimeout(() => setShown(true), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return shown
}
