/**
 * Format a USD amount as a currency string
 * @param amount - The amount to format (can be undefined, null, or NaN)
 * @returns Formatted string like "$1,234" or "$0" for invalid inputs
 */
export function formatUsd(amount?: number | null): string {
  if (amount === undefined || amount === null || isNaN(amount)) {
    return '$0';
  }
  
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}


