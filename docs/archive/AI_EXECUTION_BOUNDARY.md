# AI → Execution Boundary Documentation

**Purpose:** Document where AI reasoning stops and deterministic execution begins in Blossom.

## Architecture Overview

Blossom separates AI-driven strategy generation from deterministic on-chain execution:

```
┌─────────────────┐
│   AI Layer      │  ← Non-deterministic, creative reasoning
│  (LLM Client)   │     - Interprets user intent
└────────┬────────┘     - Generates trading strategies
         │               - Outputs structured actions
         ▼
┌─────────────────┐
│  Action Parser  │  ← Validation & sanitization
│  (Deterministic)│     - Validates JSON structure
└────────┬────────┘     - Ensures type safety
         │               - No AI reasoning here
         ▼
┌─────────────────┐
│ Execution Layer │  ← Fully deterministic
│  (Smart Contracts)│   - EIP-712 typed data
└─────────────────┘     - On-chain verification
                         - Atomic execution
```

## Where AI Reasoning Stops

### File: `agent/src/services/llmClient.ts`

**Function:** `callLlm(input: LlmChatInput): Promise<LlmChatOutput>`

**What it does:**
- Calls LLM (Anthropic, OpenAI, or Gemini)
- Returns raw JSON string from model
- **No execution logic here** - pure AI output

**Output Format:**
```json
{
  "assistantMessage": "I'll execute a swap...",
  "actions": [
    {
      "type": "defi",
      "action": "deposit",
      ...
    }
  ]
}
```

**Boundary:** This is the last place where AI reasoning occurs. After this, everything is deterministic.

---

### File: `agent/src/utils/actionParser.ts`

**Function:** `validateActions(actions: any[]): BlossomAction[]`

**What it does:**
- Parses and validates LLM JSON output
- Ensures type safety and structure
- **No AI reasoning** - pure validation

**Key Functions:**
- `validateActions()` - Validates action structure
- `buildBlossomPrompts()` - Builds prompts for LLM (but doesn't call it)

**Boundary:** This is where AI output becomes structured, validated data. No more creativity or interpretation.

---

## Where Deterministic Execution Begins

### File: `agent/src/executors/ethTestnetExecutor.ts`

**Function:** `prepareEthTestnetExecution(args): PrepareEthTestnetExecutionResult`

**What it does:**
- Takes validated actions from parser
- Builds deterministic execution plan
- Encodes on-chain transaction data
- **No AI reasoning** - pure encoding

**Key Operations:**
- Fetches nonce from chain (deterministic)
- Calculates deadline (deterministic: now + 10 min)
- Encodes action data (deterministic ABI encoding)
- Builds EIP-712 typed data (deterministic)

**Boundary:** This is where execution becomes fully deterministic and verifiable.

---

### File: `contracts/src/ExecutionRouter.sol`

**Function:** `executeBySender(Plan calldata plan)`

**What it does:**
- Verifies EIP-712 signature (deterministic)
- Checks nonce (deterministic)
- Validates deadline (deterministic)
- Executes actions atomically (deterministic)

**Boundary:** This is on-chain, fully deterministic, and verifiable by anyone.

---

## Why This Separation Matters

### 1. Safety

**AI Layer (Non-Deterministic):**
- Can make mistakes
- Can misinterpret user intent
- Can generate invalid actions
- **Solution:** Validation layer catches errors before execution

**Execution Layer (Deterministic):**
- Always behaves the same way
- Can be verified by anyone
- Cannot be manipulated once signed
- **Solution:** On-chain verification ensures correctness

### 2. Trust

**Users can verify:**
- What the AI suggested (via `assistantMessage`)
- What actions were generated (via `actions` array)
- What will be executed (via EIP-712 typed data)
- What was executed (via on-chain events)

**Transparency:**
- AI reasoning is visible (chat messages)
- Execution plan is visible (typed data)
- On-chain execution is public (blockchain)

### 3. Auditability

**AI Decisions:**
- Logged in chat history
- Can be reviewed by users
- Can be improved over time

**Execution Decisions:**
- Recorded on-chain
- Immutable
- Verifiable by anyone

---

## Code Flow Example

### 1. User Input → AI Reasoning

```typescript
// agent/src/server/http.ts
const { assistantMessage, actions } = await callLlm({
  systemPrompt: "...",
  userPrompt: userMessage
});
// ↑ AI reasoning happens here
```

### 2. AI Output → Validation

```typescript
// agent/src/utils/actionParser.ts
const validatedActions = validateActions(actions);
// ↑ Deterministic validation (no AI)
```

### 3. Validated Actions → Execution Plan

```typescript
// agent/src/executors/ethTestnetExecutor.ts
const plan = await prepareEthTestnetExecution({
  executionIntent: 'swap_usdc_weth',
  userAddress: '0x...',
  // ...
});
// ↑ Deterministic encoding (no AI)
```

### 4. Execution Plan → On-Chain

```solidity
// contracts/src/ExecutionRouter.sol
function executeBySender(Plan calldata plan) {
  // Verify signature (deterministic)
  // Check nonce (deterministic)
  // Execute actions (deterministic)
}
// ↑ Fully deterministic on-chain execution
```

---

## Key Files

### AI Layer (Non-Deterministic)
- `agent/src/services/llmClient.ts` - LLM provider abstraction
- `agent/src/services/llmClient.ts` - `callLlm()` function
- `agent/src/utils/actionParser.ts` - `buildBlossomPrompts()` (builds prompts, doesn't execute)

### Validation Layer (Deterministic)
- `agent/src/utils/actionParser.ts` - `validateActions()` function
- `agent/src/types/blossom.ts` - Type definitions

### Execution Layer (Deterministic)
- `agent/src/executors/ethTestnetExecutor.ts` - Plan preparation
- `agent/src/executors/relayer.ts` - Transaction broadcasting
- `contracts/src/ExecutionRouter.sol` - On-chain execution

---

## Configuration

### LLM Provider Selection

**Environment Variable:** `BLOSSOM_MODEL_PROVIDER`

**Supported Values:**
- `anthropic` - Uses Anthropic Claude (default if `BLOSSOM_ANTHROPIC_API_KEY` set)
- `openai` - Uses OpenAI GPT-4
- `gemini` - Uses Google Gemini (requires `BLOSSOM_GEMINI_API_KEY`)
- `stub` - No real AI (fallback)

**API Keys:**
- `BLOSSOM_ANTHROPIC_API_KEY` - Required for Anthropic
- `BLOSSOM_OPENAI_API_KEY` - Required for OpenAI
- `BLOSSOM_GEMINI_API_KEY` - Required for Gemini

**Model Selection:**
- `BLOSSOM_ANTHROPIC_MODEL` - Default: `claude-3-5-sonnet-20241022`
- `BLOSSOM_OPENAI_MODEL` - Default: `gpt-4o-mini`
- `BLOSSOM_GEMINI_MODEL` - Default: `gemini-1.5-pro`

---

## Safety Guarantees

1. **AI cannot directly execute:**
   - AI only generates suggestions
   - User must approve before execution
   - Execution requires EIP-712 signature

2. **Validation ensures correctness:**
   - All actions are validated before encoding
   - Invalid actions are rejected
   - Type safety is enforced

3. **On-chain verification:**
   - Signature verification (prevents tampering)
   - Nonce verification (prevents replay)
   - Deadline verification (prevents stale execution)
   - Adapter allowlist (prevents unauthorized adapters)

4. **Transparency:**
   - All AI suggestions are visible
   - All execution plans are visible
   - All on-chain execution is public

---

## Future Improvements

1. **AI Confidence Scores:**
   - LLM could output confidence scores for actions
   - UI could warn users about low-confidence actions

2. **Action Simulation:**
   - Before execution, simulate actions locally
   - Show expected outcomes to users
   - Help users understand what will happen

3. **Multi-Agent Validation:**
   - Use multiple LLMs to validate actions
   - Require consensus before execution
   - Reduce AI errors

4. **Formal Verification:**
   - Prove execution correctness mathematically
   - Verify adapter behavior matches specification
   - Ensure no unexpected side effects

---

## Summary

**AI Layer:** Creative, non-deterministic reasoning that generates trading strategies.

**Execution Layer:** Deterministic, verifiable on-chain execution that cannot be manipulated.

**Boundary:** The `validateActions()` function is the clear boundary. Everything before it is AI reasoning; everything after it is deterministic execution.

**Why it matters:** This separation ensures that AI mistakes don't directly cause on-chain losses, and that all execution is transparent and verifiable.

