# MVP Wallet Model Decision

## Options

### Option A: Embedded Testnet "Burner Wallet" (Local Storage)

**How it works:**
- Generate a new Ethereum private key on first visit
- Store encrypted key in browser localStorage
- Use `ethers.js` or `viem` to sign transactions directly
- Show "Fund via Faucet" CTA with Sepolia faucet links

**Pros:**
- ✅ Zero friction for demo/testing
- ✅ No MetaMask installation required
- ✅ Works immediately for testnet users
- ✅ Preserves demo mental model (instant start)

**Cons:**
- ❌ Not production-ready (localStorage is not secure)
- ❌ Users can't use existing wallets
- ❌ Requires faucet funding step
- ❌ Key management complexity (backup, recovery)

**Implementation Tasks:**
1. **Frontend:**
   - Create `src/lib/burnerWallet.ts`:
     - `generateBurnerWallet()` - Create new keypair
     - `getBurnerWallet()` - Load from localStorage
     - `signTransaction()` - Sign with burner key
   - Update `src/lib/walletAdapter.ts`:
     - Add `useBurnerWallet` flag (env var)
     - Fallback to burner if `window.ethereum` not available
   - Add "Fund Wallet" button in UI:
     - Show if balance < 0.01 ETH
     - Link to Sepolia faucets
   - Update `src/components/Chat.tsx`:
     - Use burner wallet for signing if enabled

2. **Backend:**
   - No changes needed (works with any wallet)

**UX Changes:**
- Minimal: Add "Fund Wallet" CTA when balance is low
- Keep existing flow: connect → chat → execute

---

### Option B: WalletConnect + Injected Wallets (MetaMask/Rabby)

**How it works:**
- Use WalletConnect SDK or direct `window.ethereum` injection
- Support MetaMask, Rabby, Coinbase Wallet, etc.
- Users connect existing wallets
- Sign transactions via wallet popups

**Pros:**
- ✅ Production-ready approach
- ✅ Users can use existing wallets
- ✅ Secure (keys never leave wallet)
- ✅ Industry standard

**Cons:**
- ❌ Requires wallet installation (friction)
- ❌ Users must fund their own wallets
- ❌ More complex error handling (rejections, network mismatches)

**Implementation Tasks:**
1. **Frontend:**
   - Already implemented! ✅
   - `src/lib/walletAdapter.ts` already uses `window.ethereum`
   - `connectWallet()` already works with MetaMask
   - No changes needed

2. **Backend:**
   - No changes needed

**UX Changes:**
- None (already works)

---

## Recommendation: **Option B (WalletConnect/Injected Wallets)**

**Rationale:**
1. **Already implemented** - No code changes needed
2. **Production-ready** - Standard approach for Web3 apps
3. **User control** - Users use their own wallets
4. **Security** - Keys never leave wallet
5. **Demo parity** - Works with existing flow

**For MVP:**
- Use Option B (injected wallets) as primary
- Add clear "Connect Wallet" CTA if not connected
- Show helpful error messages if wallet not installed
- Provide Sepolia faucet links in onboarding

**Future Enhancement (Post-MVP):**
- Option A (burner wallet) can be added as fallback for demo mode
- Toggle via `VITE_USE_BURNER_WALLET=true` env var
- Only enable in testnet/demo environments

---

## Minimal UX Changes (Option B)

### 1. Wallet Connection Prompt

**File:** `src/components/Chat.tsx` or new `src/components/WalletPrompt.tsx`

**Behavior:**
- If `executionMode === 'eth_testnet'` and no wallet connected:
  - Show banner: "Connect your wallet to execute trades on Sepolia"
  - Button: "Connect Wallet" → calls `connectWallet()`
  - Link: "Don't have a wallet? Install MetaMask"

**Location:** Top of chat or modal overlay

### 2. Network Mismatch Warning

**File:** `src/lib/walletAdapter.ts`

**Enhancement:**
- Check if wallet is on Sepolia (chainId 11155111)
- If not, show warning: "Please switch to Sepolia testnet"
- Provide "Switch Network" button (via `wallet_switchEthereumChain`)

### 3. Faucet Links (Helpful, Not Required)

**File:** `src/components/Chat.tsx` or onboarding

**Behavior:**
- If balance < 0.01 ETH, show: "Need Sepolia ETH? Get testnet tokens: [Faucet Link]"
- Links:
  - https://sepoliafaucet.com/
  - https://faucet.sepolia.dev/
  - https://www.alchemy.com/faucets/ethereum-sepolia

---

## Implementation Checklist (Option B)

### Frontend Tasks:

- [ ] **Wallet Connection UI** (if not exists):
  - [ ] Add "Connect Wallet" button in header/nav
  - [ ] Show connected address when wallet is connected
  - [ ] Handle connection errors gracefully

- [ ] **Network Check**:
  - [ ] Verify wallet is on Sepolia (chainId 11155111)
  - [ ] Show "Switch to Sepolia" prompt if on wrong network
  - [ ] Add network switching helper

- [ ] **Error Handling**:
  - [ ] "No wallet installed" → Show MetaMask install link
  - [ ] "User rejected" → Show friendly message
  - [ ] "Wrong network" → Show network switch prompt

- [ ] **Faucet Links** (optional):
  - [ ] Show faucet links if balance < 0.01 ETH
  - [ ] Add to onboarding or help section

### Backend Tasks:

- [ ] **No changes needed** ✅

---

## Alternative: Hybrid Approach

**For MVP:** Use Option B (injected wallets) as primary

**For Demo Mode:** Add Option A (burner wallet) as fallback:
- Toggle via `VITE_USE_BURNER_WALLET=true`
- Only in `executionMode === 'eth_testnet'`
- Generate burner wallet if no `window.ethereum` available
- Show "Demo Mode" badge in UI

**Benefits:**
- Production-ready (Option B) for real users
- Zero-friction demo (Option A) for testing
- Best of both worlds

**Implementation:**
- Add `src/lib/burnerWallet.ts` (as described in Option A)
- Update `walletAdapter.ts` to check `VITE_USE_BURNER_WALLET`
- Fallback to burner if no injected wallet available

---

## Final Recommendation

**For MVP:** Use **Option B (Injected Wallets)** - already implemented, production-ready, standard approach.

**For Post-MVP:** Consider adding **Option A (Burner Wallet)** as demo mode fallback for zero-friction testing.

