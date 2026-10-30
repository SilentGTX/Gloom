import { clsx, type ClassValue } from 'clsx'

export const cn = (...values: ClassValue[]): string => clsx(values)
