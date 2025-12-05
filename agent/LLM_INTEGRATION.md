# LLM Integration Guide

## Overview

The Blossom agent now supports real LLM integration via OpenAI or Anthropic APIs. When configured, the `/api/chat` endpoint uses actual AI models to generate natural language responses and structured trading actions.

## Configuration

### Environment Variables

Create a `.env` file in the `agent/` directory (see `.env.example`):

```bash
# Choose provider: 'openai' | 'anthropic' | 'stub'
BLOSSOM_MODEL_PROVIDER=openai

# OpenAI (if using OpenAI)
BLOSSOM_OPENAI_API_KEY=sk-your-key-here
BLOSSOM_OPENAI_MODEL=gpt-4o-mini

# Anthropic (if using Anthropic)
BLOSSOM_ANTHROPIC_API_KEY=sk-ant-your-key-here
BLOSSOM_ANTHROPIC_MODEL=claude-3-5-sonnet-20241022
```

### Stub Mode

If no provider or API key is set, the agent runs in **stub mode**:
- Returns a canned message indicating no AI is configured
- Returns empty actions array
- Useful for testing without API costs

## How It Works

1. **User sends message** → `/api/chat` endpoint
2. **Build prompts** → Includes Blossom persona, current portfolio, venue context
3. **Call LLM** → OpenAI or Anthropic API with JSON mode
4. **Parse response** → Extract `assistantMessage` and `actions[]`
5. **Validate actions** → Ensure all actions match `BlossomAction` schema
6. **Apply to sims** → Execute validated actions in perps/defi/event sims
7. **Return response** → Natural language + actions + updated portfolio

## Response Format

The LLM must return JSON in this exact format:

```json
{
  "assistantMessage": "Natural language explanation...",
  "actions": [
    {
      "type": "perp",
      "action": "open",
      "market": "ETH-PERP",
      "side": "long",
      "riskPct": 3.0,
      "entry": 3500,
      "takeProfit": 3640,
      "stopLoss": 3395,
      "reasoning": ["ETH is trending up", "Risk within limits"]
    }
  ]
}
```

## Error Handling

- **LLM API errors**: Returns fallback message, no actions executed
- **Invalid JSON**: Returns fallback message, no actions executed
- **Invalid actions**: Invalid actions are filtered out, valid ones still execute
- **Sim errors**: Failed actions are logged and removed from response

## Testing

### With API Keys

```bash
# Set environment variables
export BLOSSOM_MODEL_PROVIDER=openai
export BLOSSOM_OPENAI_API_KEY=sk-...

# Start server
npm run dev:agent

# Test perp
curl -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{"userMessage": "Long ETH with 3% risk", "venue": "hyperliquid"}'

# Test DeFi
curl -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{"userMessage": "Park half my idle USDC into safest yield on Kamino", "venue": "hyperliquid"}'

# Test events
curl -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{"userMessage": "Take YES on Fed cuts in March with 2% account risk", "venue": "event_demo"}'
```

### Stub Mode (No API Keys)

Simply don't set `BLOSSOM_MODEL_PROVIDER` or API keys. The server will:
- Start successfully
- Return stub responses
- Not make any API calls

## Architecture

```
/api/chat
  ↓
buildBlossomPrompts() → { systemPrompt, userPrompt }
  ↓
callLlm() → { assistantMessage, rawJson }
  ↓
parseModelResponse() → { assistantMessage, actions }
  ↓
validateActions() → BlossomAction[]
  ↓
applyAction() → Update sims
  ↓
buildPortfolioSnapshot() → Return response
```

## Files

- `src/services/llmClient.ts` - LLM API client (OpenAI/Anthropic/Stub)
- `src/utils/actionParser.ts` - Prompt building, action validation
- `src/server/http.ts` - HTTP endpoint that orchestrates LLM calls
- `src/characters/blossom.ts` - Blossom persona definition

