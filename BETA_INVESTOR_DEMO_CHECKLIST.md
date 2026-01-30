# Beta Investor Demo Checklist

## Quick 5-Minute Manual QA Steps

### Prerequisites
- Access code: Use your beta access code
- Browser: Chrome/Firefox with DevTools open (Network tab)
- URL: https://app.blossom.onl

---

## 1. Chat Isolation Test (SECURITY - P0)

**Goal:** Verify users with the same access code don't see each other's chat history.

**Steps:**
1. Open Browser A (or Incognito window 1)
2. Navigate to https://app.blossom.onl
3. Enter access code and enter app
4. Send message: "Test message from User A - 12345"
5. Open Browser B (or Incognito window 2)
6. Navigate to https://app.blossom.onl
7. Enter **same** access code
8. **Verify:** User B should NOT see "Test message from User A - 12345"

**Expected Result:** Each user gets their own chat history.

**Pass:** [ ]  **Fail:** [ ]

---

## 2. Greeting Response Test (UX - P0)

**Goal:** Bot responds naturally to greetings.

**Steps:**
1. In chat, type: `hi`
2. Press Enter

**Expected Response:**
- Friendly greeting (contains "Hi" or "Hello" or "Blossom")
- Lists capabilities (swap, perps, DeFi, etc.)
- Does NOT say "I didn't understand. Try: 'long BTC 20x...'"

**Pass:** [ ]  **Fail:** [ ]

---

## 3. Balance Query Test (UX - P0)

**Goal:** Bot handles balance queries gracefully.

**Steps:**
1. Type: `whats my balance`
2. Press Enter

**Expected Response:**
- If wallet not connected: Guidance to connect wallet + faucet info
- If wallet connected: Shows balances or "no balances found" + guidance
- Does NOT say "I didn't understand"

**Pass:** [ ]  **Fail:** [ ]

---

## 4. Quick Action Test (UX/EXEC - P0)

**Goal:** Quick action buttons create valid drafts, not server errors.

**Steps:**
1. Type: `Show me top DeFi protocols`
2. Press Enter
3. Wait for protocol cards to appear
4. Click "Allocate 10%" button on any protocol

**Expected Result:**
- Message sent is natural language (e.g., "Deposit 10% of my REDACTED into Aave")
- NOT a coded string like "Allocate amountPct:10 to protocol:..."
- No "Server error occurred (ID: ERR-...)" message
- Creates a draft execution plan or shows guidance

**Pass:** [ ]  **Fail:** [ ]

---

## 5. BTC Perp Execution Plan Test (EXEC - P0)

**Goal:** BTC 20x leverage command produces plan, not generic error.

**Steps:**
1. Type: `Long BTC with 20x leverage using 2% risk. Show me the execution plan across venues.`
2. Press Enter

**Expected Response:**
- Does NOT show "EXECUTION_ERROR"
- Shows execution plan with:
  - Market: BTC-USD
  - Leverage: 20x (or clamped to max 20x)
  - Risk %
  - Margin amount
- OR provides helpful message about supported markets

**Pass:** [ ]  **Fail:** [ ]

---

## 6. No 500 Errors Test (RELIABILITY - P0)

**Goal:** Core flows don't return server errors.

**Test Commands:**
1. `Swap 10 REDACTED to WETH` - Should work without 500
2. `Long ETH 5x with 2% risk` - Should work without 500
3. `Deposit $100 REDACTED into Aave` - Should work without 500
4. `Bet $10 YES on Fed rate cut` - Should work without 500

**Expected:**
- No "Server error occurred (ID: ERR-...)" messages
- Network tab shows no 500 status codes

**Pass:** [ ]  **Fail:** [ ]

---

## Final Verdict

| Test | Result |
|------|--------|
| CHAT ISOLATION | ⬜ PASS / ⬜ FAIL |
| BASIC CONVO ("hi", "balance") | ⬜ PASS / ⬜ FAIL |
| QUICK ACTIONS | ⬜ PASS / ⬜ FAIL |
| PERP BTC 20x PROMPT | ⬜ PASS / ⬜ FAIL |
| ZERO 500s ON CORE FLOWS | ⬜ PASS / ⬜ FAIL |

**Overall:** ⬜ READY FOR DEMO / ⬜ NEEDS FIXES

---

## Fixes Applied in This Release

1. **Chat Isolation (P0 Security)**
   - User identity now based on wallet address or anonymous browser UUID
   - Chat storage scoped by identity, not global
   - Access code only gates entry, not used for identity

2. **Conversational Baseline (P0 UX)**
   - Added greeting handlers ("hi", "hello", "hey", etc.)
   - Added balance query handlers
   - Added help/capability handlers
   - Friendly responses instead of "I didn't understand"

3. **Quick Actions (P0 UX/EXEC)**
   - Changed from coded strings to natural language
   - "Allocate 10%" now sends "Deposit 10% of my REDACTED into {protocol}"
   - Backend properly handles percentage and dollar allocations

4. **BTC 20x Perp (P0 EXEC)**
   - Added "show execution plan" detection
   - Leverage clamped to 20x max with warning
   - Supported markets check with helpful alternatives
   - No generic EXECUTION_ERROR for valid requests

---

## Troubleshooting

**If tests fail:**

1. **Chat shows other user's messages:**
   - Clear localStorage: `localStorage.clear()`
   - Refresh the page
   - Check that identity is being created properly

2. **Still seeing "I didn't understand":**
   - Ensure VITE_USE_AGENT_BACKEND=true in production
   - Check backend is deployed with latest changes

3. **500 errors on quick actions:**
   - Check backend logs for error details
   - Verify backend has the updated allocation parser

4. **BTC shows EXECUTION_ERROR:**
   - Check if DemoPerpAdapter is configured
   - Verify market is in supported list (BTC, ETH, SOL)
