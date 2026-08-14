import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merges class names, with later Tailwind utilities winning over earlier ones.
 *
 * `clsx` alone would leave `px-2 px-4` in the output and let CSS source order
 * decide, which makes a component's `className` prop unreliable — the caller
 * could not override a default padding. `twMerge` resolves the conflict.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
