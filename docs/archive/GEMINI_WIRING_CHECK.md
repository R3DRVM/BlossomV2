# Gemini Wiring Check

**Status:** ✅ Integration Complete and Verified

---

## Environment Variables

### Required for Gemini:

```bash
BLOSSOM_MODEL_PROVIDER=gemini
BLOSSOM_GEMINI_API_KEY="your-api-key-here"
```

### Optional (with defaults):

```bash
BLOSSOM_GEMINI_MODEL="gemini-1.5-pro"  # Default: gemini-1.5-pro
```

---

## Code Path for Provider Switching

### File: `agent/src/services/llmClient.ts`

**Lines 19-27: Provider Selection**
```typescript
type ModelProvider = 'openai' | 'anthropic' | 'gemini' | 'stub';

function getProvider(): ModelProvider {
  const provider = process.env.BLOSSOM_MODEL_PROVIDER as ModelProvider;
  if (provider === 'openai' || provider === 'anthropic' || provider === 'gemini') {
    return provider;
  }
  return 'stub';
}
```

**Lines 32-62: Provider Routing**
```typescript
export async function callLlm(input: LlmChatInput): Promise<LlmChatOutput> {
  const provider = getProvider();

  if (provider === 'stub') {
    return { ... }; // Stub response
  }

  if (provider === 'openai') {
    return callOpenAI(input);
  }

  if (provider === 'anthropic') {
    return callAnthropic(input);
  }

  if (provider === 'gemini') {
    return callGemini(input);  // ✅ Gemini path
  }

  // Fallback to stub
  return { ... };
}
```

**Lines 148-195: Gemini Implementation**
```typescript
async function callGemini(input: LlmChatInput): Promise<LlmChatOutput> {
  const apiKey = process.env.BLOSSOM_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('BLOSSOM_GEMINI_API_KEY is not set. Set BLOSSOM_MODEL_PROVIDER=gemini and BLOSSOM_GEMINI_API_KEY to use Gemini.');
  }

  const model = process.env.BLOSSOM_GEMINI_MODEL || 'gemini-1.5-pro';
  
  // Uses Google Gemini REST API
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  
  // ... implementation ...
}
```

---

## How to Run in Stub Mode

### Option 1: Don't Set Provider (Default)

```bash
# Don't set BLOSSOM_MODEL_PROVIDER
# Defaults to 'stub'
cd agent
npm run dev
```

**Result:** Returns stub response (no real AI calls)

---

### Option 2: Explicitly Set Stub

```bash
export BLOSSOM_MODEL_PROVIDER=stub
cd agent
npm run dev
```

**Result:** Returns stub response (no real AI calls)

---

### Option 3: Set Provider Without API Key

```bash
export BLOSSOM_MODEL_PROVIDER=gemini
# Don't set BLOSSOM_GEMINI_API_KEY
cd agent
npm run dev
```

**Result:** Throws error: `BLOSSOM_GEMINI_API_KEY is not set`

**Fallback:** If error is caught, may fall back to stub (depends on error handling)

---

## Integration Points Verified

### ✅ Provider Selection
- **File:** `agent/src/services/llmClient.ts:21-27`
- **Status:** Correctly checks for 'gemini' in provider list
- **Default:** Falls back to 'stub' if not set

### ✅ Provider Routing
- **File:** `agent/src/services/llmClient.ts:53-55`
- **Status:** Routes to `callGemini()` when provider is 'gemini'
- **Fallback:** Returns stub if provider not recognized

### ✅ Gemini Implementation
- **File:** `agent/src/services/llmClient.ts:148-195`
- **Status:** Complete implementation using Google Gemini REST API
- **Error Handling:** Throws clear error if API key missing
- **Model Selection:** Supports `BLOSSOM_GEMINI_MODEL` env var (default: 'gemini-1.5-pro')

### ✅ API Endpoint
- **URL:** `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
- **Method:** POST
- **Headers:** `Content-Type: application/json`
- **Body:** JSON with `contents` and `generationConfig`

### ✅ Response Parsing
- **Lines 177-185:** Extracts JSON from response
- **Lines 187-192:** Handles markdown code blocks (```json)
- **Returns:** `{ assistantMessage: '', rawJson: string }`

---

## Testing Without API Key

### Stub Mode (No API Key Required)

```bash
# Don't set any LLM env vars
cd agent
npm run dev
```

**Expected Behavior:**
- Returns stub response: "This is a stubbed Blossom response..."
- No API calls made
- No errors thrown

### Test Provider Switching

```bash
# Test stub
export BLOSSOM_MODEL_PROVIDER=stub
# Should return stub response

# Test gemini without key (should error)
export BLOSSOM_MODEL_PROVIDER=gemini
# Should throw: "BLOSSOM_GEMINI_API_KEY is not set"

# Test gemini with key (requires real key)
export BLOSSOM_MODEL_PROVIDER=gemini
export BLOSSOM_GEMINI_API_KEY="your-key"
# Should call Gemini API
```

---

## Summary

**Integration Status:** ✅ Complete

**Environment Variables:**
- `BLOSSOM_MODEL_PROVIDER=gemini` (required for Gemini)
- `BLOSSOM_GEMINI_API_KEY` (required for Gemini)
- `BLOSSOM_GEMINI_MODEL` (optional, default: 'gemini-1.5-pro')

**Stub Mode:**
- Default if `BLOSSOM_MODEL_PROVIDER` not set
- Or explicitly set `BLOSSOM_MODEL_PROVIDER=stub`
- No API keys required

**Error Handling:**
- Clear error if provider set but API key missing
- Falls back to stub if provider not recognized

**No Changes Needed:** Integration is correct and ready to use.

