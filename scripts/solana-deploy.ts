import fs from 'fs';
import path from 'path';
import {
  Connection,
  Keypair,
  BpfLoader,
  BPF_LOADER_PROGRAM_ID,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';

const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const programPath = process.env.SOLANA_PROGRAM_PATH || 'target/deploy/blossom_sol.so';
const payerKeypairPath =
  process.env.SOLANA_DEPLOYER_KEYPAIR ||
  path.join(process.env.HOME || '', '.config/solana/id.json');

function loadKeypair(filePath: string): Keypair {
  const raw = fs.readFileSync(filePath, 'utf8');
  const secretKey = Uint8Array.from(JSON.parse(raw));
  return Keypair.fromSecretKey(secretKey);
}

async function main() {
  const connection = new Connection(rpcUrl, 'confirmed');
  const payer = loadKeypair(payerKeypairPath);
  const programData = fs.readFileSync(programPath);
  const programKeypair = Keypair.generate();

  const balance = await connection.getBalance(payer.publicKey);
  if (balance < 0.5 * LAMPORTS_PER_SOL) {
    console.warn('[solana-deploy] Low SOL balance. Consider airdropping devnet SOL.');
  }

  console.log('[solana-deploy] Deploying program to:', rpcUrl);
  console.log('[solana-deploy] Program path:', programPath);

  await BpfLoader.load(
    connection,
    payer,
    programKeypair,
    programData,
    BPF_LOADER_PROGRAM_ID
  );

  console.log('[solana-deploy] Program ID:', programKeypair.publicKey.toBase58());
  console.log('[solana-deploy] Save this ID in Anchor.toml and config.');
}

main().catch((error) => {
  console.error('[solana-deploy] Failed:', error);
  process.exit(1);
});
