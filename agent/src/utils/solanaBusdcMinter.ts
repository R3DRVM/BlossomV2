import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token';
import bs58 from 'bs58';
import {
  SOLANA_RPC_URL,
  SOLANA_BUSDC_MINT,
  SOLANA_BUSDC_DECIMALS,
  SOLANA_MINT_AUTHORITY_PRIVATE_KEY,
} from '../config';

function loadAuthorityKeypair(): Keypair {
  if (!SOLANA_MINT_AUTHORITY_PRIVATE_KEY) {
    throw new Error('SOLANA_MINT_AUTHORITY_PRIVATE_KEY not configured');
  }

  const decoded = bs58.decode(SOLANA_MINT_AUTHORITY_PRIVATE_KEY);
  if (decoded.length === 32) {
    return Keypair.fromSeed(decoded);
  }
  if (decoded.length === 64) {
    return Keypair.fromSecretKey(decoded);
  }
  throw new Error(`Invalid Solana private key length: ${decoded.length}`);
}

export async function mintSolanaBusdc(recipientAddress: string, amount: number) {
  if (!SOLANA_BUSDC_MINT) {
    throw new Error('SOLANA_BUSDC_MINT not configured');
  }

  const rpcUrl = SOLANA_RPC_URL || 'https://api.devnet.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');
  const authority = loadAuthorityKeypair();

  const mint = new PublicKey(SOLANA_BUSDC_MINT);
  const recipient = new PublicKey(recipientAddress);

  const associatedAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    authority,
    mint,
    recipient
  );

  const amountUnits = BigInt(Math.floor(amount * 10 ** SOLANA_BUSDC_DECIMALS));
  const signature = await mintTo(
    connection,
    authority,
    mint,
    associatedAccount.address,
    authority,
    amountUnits
  );

  const explorerUrl = `https://explorer.solana.com/tx/${signature}?cluster=devnet`;

  return {
    signature,
    explorerUrl,
    amount,
    recipient: recipientAddress,
  };
}
