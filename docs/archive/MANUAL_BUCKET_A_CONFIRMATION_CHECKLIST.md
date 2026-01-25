# Manual Bucket A Confirmation Checklist

**Purpose:** Step-by-step checklist for non-technical users to verify Bucket A (Demo Reliability) is working correctly.

---

## Prerequisites

- [ ] Node.js installed (v18+)
- [ ] MetaMask browser extension installed
- [ ] MetaMask connected to Sepolia testnet
- [ ] Terminal/command line access

---

## Step 1: Start Demo

**Command:**
```bash
./scripts/restart-demo.sh
```

**Expected Output:**
- Ports cleared
- Services starting
- "✅ Backend health check passed"
- URLs printed:
  - Frontend: http://localhost:5173
  - Backend: http://127.0.0.1:3001

**If it fails:**
- Check that ports 3001 and 5173 are not in use
- Verify Node.js is installed: `node --version`
- Check `agent/.env.local` exists (optional for basic demo)

**Status:** ☐ PASS / ☐ FAIL

---

## Step 2: Verify Backend Connected

**Command (in new terminal):**
```bash
curl -s http://127.0.0.1:3001/health
```

**Expected Output:**
```json
{"ok":true,"ts":1234567890,"service":"blossom-agent"}
```

**If it fails:**
- Backend may not have started
- Check terminal 1 for error messages
- Wait 5 seconds and try again

**Status:** ☐ PASS / ☐ FAIL

---

## Step 3: Open App

**Action:**
1. Open browser
2. Navigate to: http://localhost:5173/app

**Expected:**
- App loads without errors
- Chat interface visible
- Right panel visible

**If it fails:**
- Check frontend terminal for errors
- Verify port 5173 is accessible
- Try hard refresh (Cmd+Shift+R / Ctrl+Shift+R)

**Status:** ☐ PASS / ☐ FAIL

---

## Step 4: Wallet Connect

**Action:**
1. In Right Panel, click "Connect Wallet (Sepolia)"
2. MetaMask popup should appear
3. Click "Connect" in MetaMask

**Expected:**
- MetaMask prompt appears
- After approval, wallet address shows in Right Panel
- State changes from "DISCONNECTED" → "CONNECTING" → "CONNECTED_LOADING" → "CONNECTED_READY"
- **Must NOT stay in "Loading…" indefinitely**

**If it fails:**
- Check MetaMask is unlocked
- Verify MetaMask is on Sepolia network
- Check browser console for errors (F12)

**Status:** ☐ PASS / ☐ FAIL

---

## Step 5: Wrong Network Test

**Action:**
1. In MetaMask, switch to a different network (e.g., Ethereum Mainnet)
2. Observe Right Panel

**Expected:**
- Right Panel shows "Wrong Network" banner
- Banner says "Please switch to Sepolia testnet"
- "Switch Network" button visible

**Action (continue):**
3. Click "Switch Network" button OR manually switch MetaMask to Sepolia
4. Observe Right Panel

**Expected:**
- Banner disappears
- Wallet state returns to "CONNECTED_READY"
- Balances load (even if 0.0)

**Status:** ☐ PASS / ☐ FAIL

---

## Step 6: Disconnect + Reconnect

**Action:**
1. In Right Panel, click the logout icon (top right of wallet card)
2. Observe Right Panel

**Expected:**
- Wallet state changes to "DISCONNECTED"
- "Connect Wallet" button appears
- No balances shown

**Action (continue):**
3. Click "Connect Wallet (Sepolia)" again
4. Approve MetaMask prompt

**Expected:**
- MetaMask prompt appears again (not silently reusing)
- Wallet connects successfully
- Balances load

**Status:** ☐ PASS / ☐ FAIL

---

## Step 7: Balances Show

**Action:**
1. After wallet is connected, observe balance display in Right Panel

**Expected:**
- If balance > 0: Shows actual balance (e.g., "$300.00")
- If balance = 0: Shows "$0.00" (NOT "Loading…")
- Balance appears within 1-2 seconds of connection
- Token holdings section shows tokens (if any)

**If balance is 0:**
- This is normal for a new wallet
- Use Sepolia faucet to get testnet ETH if needed
- Balance should update after receiving ETH

**Status:** ☐ PASS / ☐ FAIL

---

## Step 8: Prices Load

**Action:**
1. Navigate to any page with price ticker (top of app)
2. Observe price display

**Expected:**
- Prices load and display (BTC, ETH, SOL, etc.)
- No CORS errors in browser console
- No 429 rate limit errors
- Prices update periodically

**If prices don't load:**
- Check browser console (F12) for errors
- Verify backend is running
- Prices may fall back to static values (acceptable)

**Status:** ☐ PASS / ☐ FAIL

---

## Step 9: Session Status (Non-Blocking)

**Action:**
1. Open browser console (F12)
2. Look for any errors related to `/api/session/status`

**Expected:**
- No 404 errors for `/api/session/status`
- If errors appear, they should be single-shot (not spam)
- Wallet readiness not blocked by session status

**If errors appear:**
- In direct mode, session status should return `{ ok: true, enabled: false }`
- Errors should not prevent wallet from showing as connected

**Status:** ☐ PASS / ☐ FAIL

---

## Step 10: Reset SIM

**Action:**
1. In chat, type: "reset"
2. Send message

**Expected:**
- AI responds with confirmation
- Portfolio resets to initial state
- No errors in console

**Status:** ☐ PASS / ☐ FAIL

---

## Step 11: Preflight OK

**Action:**
1. In chat, type any trading intent (e.g., "swap 0.01 ETH to USDC")
2. Wait for AI response
3. Check browser console (F12)

**Expected:**
- AI generates a plan
- No preflight errors
- Plan shows routing metadata (if available)

**Status:** ☐ PASS / ☐ FAIL

---

## Step 12: No Console Errors

**Action:**
1. Open browser console (F12)
2. Clear console
3. Perform normal demo actions:
   - Connect wallet
   - View balances
   - Navigate pages
   - Load prices
   - Send chat messages

**Expected:**
- **Zero red errors** in console
- Any warnings should be single-shot (not repeated)
- No CORS errors
- No 404 errors (except for intentional missing endpoints)
- No connection refused loops

**If errors appear:**
- Note the error message
- Check if it's a known issue
- Verify backend is running

**Status:** ☐ PASS / ☐ FAIL

---

## Final Verification

**All steps must pass for Bucket A to be considered READY.**

**Summary:**
- [ ] Step 1: Start Demo
- [ ] Step 2: Verify Backend Connected
- [ ] Step 3: Open App
- [ ] Step 4: Wallet Connect
- [ ] Step 5: Wrong Network Test
- [ ] Step 6: Disconnect + Reconnect
- [ ] Step 7: Balances Show
- [ ] Step 8: Prices Load
- [ ] Step 9: Session Status (Non-Blocking)
- [ ] Step 10: Reset SIM
- [ ] Step 11: Preflight OK
- [ ] Step 12: No Console Errors

**Overall Status:** ☐ READY / ☐ NOT READY

**Notes:**
_(Record any issues or observations here)_

---

**Last Updated:** 2025-01-03


