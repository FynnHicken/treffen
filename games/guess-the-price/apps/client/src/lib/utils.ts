import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const priceFormat = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

/** 1199 → „1.199,00 €“ */
export function formatPrice(value: number | null | undefined) {
	return priceFormat.format(Number(value) || 0);
}
