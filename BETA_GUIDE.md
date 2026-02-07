# Blossom Beta Testing Guide

**Version:** 1.0
**Environment:** Sepolia Testnet + Solana Devnet
**URL:** https://blossom.onl

---

## Quick Start

1. **Connect Wallet**
   - Click "Connect Wallet" in the top-right
   - Select MetaMask (EVM) or Phantom (Solana)
   - Switch to Sepolia testnet for EVM transactions

2. **Get Testnet Tokens**
   - Sepolia ETH: https://sepoliafaucet.com or https://www.alchemy.com/faucets/ethereum-sepolia
   - Demo USDC: Automatically minted when you first interact
   - Solana Devnet SOL: https://faucet.solana.com

3. **Start Trading**
   - Type natural language intents in the chat
   - Confirm execution when prompted
   - Watch your transactions execute on-chain

---

## Sample Intents by Category

### Swaps
```
swap 100 USDC for ETH
buy $50 worth of WETH
convert 0.1 ETH to USDC on uniswap
```

### Perpetuals
```
long BTC with $100
short ETH 5x with $200
open 10x long on SOL $50
```

### Lending (Aave)
```
deposit 100 USDC to lending
lend 0.5 ETH on aave
supply 200 USDC to earn yield
```

### Events / Predictions
```
bet $50 on BTC above 70000
wager $25 ETH hits 4000 by Friday
```

### Cross-Chain Bridges
```
bridge 100 USDC from ethereum to solana
send 0.1 ETH to solana
move 50 USDC from solana to ethereum
```

### Research (No Execution)
```
what is the price of ETH
show me BTC chart
analyze ETH market sentiment
check my ethereum portfolio
```

---

## Multi-Turn Conversations

Try these conversation flows:

**Flow 1: Research → Execute**
```
User: what's the price of ETH?
Agent: [shows price]
User: swap $100 to ETH
Agent: [prepares execution]
```

**Flow 2: Position Management**
```
User: long BTC with $100
Agent: [executes]
User: double that position
Agent: [references previous]
```

**Flow 3: Cross-Chain**
```
User: check my solana balance
Agent: [shows balance]
User: bridge 10 USDC to ethereum
Agent: [executes bridge]
```

---

## Execution Modes

### One-Click Execution (Recommended)
1. Connect wallet
2. Click "Enable One-Click" in wallet panel
3. Sign the session authorization
4. All trades execute instantly without popups

### Manual Signing
- Each trade prompts wallet signature
- Good for reviewing each transaction
- Enable in wallet settings

---

## What We're Testing

1. **Intent Parsing** - Does the AI understand your requests?
2. **Execution Flow** - Do trades complete successfully?
3. **Cross-Chain** - Do bridges work between Solana ↔ Ethereum?
4. **Multi-Turn** - Does context persist across messages?
5. **Error Handling** - Are failures communicated clearly?

---

## Feedback

Please report:
- Intents that fail to parse correctly
- Execution errors or stuck transactions
- UI/UX issues
- Any unexpected behavior

---

## Networks

| Chain | Network | Explorer |
|-------|---------|----------|
| Ethereum | Sepolia | https://sepolia.etherscan.io |
| Solana | Devnet | https://explorer.solana.com/?cluster=devnet |

---

## Support

If you encounter issues:
1. Check wallet is on correct network
2. Ensure sufficient testnet balance
3. Try refreshing the page
4. Report issue with screenshot
