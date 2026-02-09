/**
 * Mint Limiter - SQLite-backed daily mint limits
 * Persists mint history to telemetry database
 */

const DAILY_CAP = Number(process.env.BUSDC_DAILY_MINT_CAP || 1000);

function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizeMintKey(address: string, chain: 'ethereum' | 'solana' | 'hyperliquid'): string {
  if (!address) return `${chain}:unknown`;
  const trimmed = address.trim();
  const isEvm = trimmed.startsWith('0x') && trimmed.length === 42;
  const normalizedAddress = isEvm ? trimmed.toLowerCase() : trimmed;
  return `${chain}:${normalizedAddress}`;
}

async function getMintedToday(address: string, chain: 'ethereum' | 'solana' | 'hyperliquid'): Promise<number> {
  try {
    const { getDatabase } = await import('../../telemetry/db');
    const db = getDatabase();
    const today = getTodayKey();
    const key = normalizeMintKey(address, chain);

    const result = db.prepare(
      'SELECT amount_minted FROM mint_records WHERE user_address = ? AND mint_date = ?'
    ).get(key, today) as { amount_minted: number } | undefined;

    return result?.amount_minted || 0;
  } catch (e) {
    console.warn('[mintLimiter] Failed to fetch mint history from DB, using fallback:', e);
    return 0;
  }
}

async function recordMint(address: string, amount: number, chain: 'ethereum' | 'solana' | 'hyperliquid'): Promise<void> {
  try {
    const { getDatabase } = await import('../../telemetry/db');
    const db = getDatabase();
    const today = getTodayKey();
    const key = normalizeMintKey(address, chain);

    db.prepare(`
      INSERT INTO mint_records (user_address, mint_date, amount_minted)
      VALUES (?, ?, ?)
      ON CONFLICT(user_address, mint_date) DO UPDATE SET
        amount_minted = amount_minted + excluded.amount_minted
    `).run(key, today, amount);
  } catch (e) {
    console.warn('[mintLimiter] Failed to record mint in DB:', e);
    // Fail open - don't block minting if DB is unavailable
  }
}

export async function checkAndRecordMint(
  address: string,
  amount: number,
  chain: 'ethereum' | 'solana' | 'hyperliquid' = 'ethereum'
) {
  const mintedToday = await getMintedToday(address, chain);
  const nextTotal = mintedToday + amount;

  if (nextTotal > DAILY_CAP) {
    return {
      ok: false,
      remaining: Math.max(DAILY_CAP - mintedToday, 0),
      cap: DAILY_CAP
    };
  }

  await recordMint(address, amount, chain);
  return {
    ok: true,
    remaining: Math.max(DAILY_CAP - nextTotal, 0),
    cap: DAILY_CAP
  };
}
