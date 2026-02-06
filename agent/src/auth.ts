import type { Request } from 'express';
import { verifyMessage } from 'viem';
import { PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

type AuthResult = {
  ok: boolean;
  chain?: 'evm' | 'solana';
  address?: string;
  reason?: string;
};

const AUTH_MODE = process.env.AUTH_MODE || 'none';

function getHeader(req: Request, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value as string | undefined;
}

export async function verifyRequestAuth(req: Request): Promise<AuthResult> {
  if (AUTH_MODE === 'none') return { ok: true };

  const chain = (getHeader(req, 'x-auth-chain') || 'evm').toLowerCase();
  const address = getHeader(req, 'x-auth-address') || getHeader(req, 'x-wallet-address');
  const message = getHeader(req, 'x-auth-message');
  const signature = getHeader(req, 'x-auth-signature');

  if (!address || !message || !signature) {
    return { ok: false, reason: 'missing_auth_headers' };
  }

  if (chain === 'solana') {
    try {
      const publicKey = new PublicKey(address);
      const messageBytes = new TextEncoder().encode(message);
      const signatureBytes = bs58.decode(signature);
      const ok = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKey.toBytes());
      return ok ? { ok: true, chain: 'solana', address } : { ok: false, reason: 'invalid_signature' };
    } catch (error: any) {
      return { ok: false, reason: error?.message || 'invalid_signature' };
    }
  }

  try {
    const ok = await verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
    return ok ? { ok: true, chain: 'evm', address } : { ok: false, reason: 'invalid_signature' };
  } catch (error: any) {
    return { ok: false, reason: error?.message || 'invalid_signature' };
  }
}

export function getAuthMode(): string {
  return AUTH_MODE;
}
