# Blossom Agent

Backend agent service for Blossom AI Trading Copilot.

## Development

```bash
# Install dependencies
npm install

# Set up environment variables (see .env.example)
cp .env.example .env
# Edit .env and add your API keys

# Run development server
npm run dev:agent

# Build
npm run build

# Start production server
npm start
```

## Environment Variables

The agent supports multiple LLM providers:

- **OpenAI**: Set `BLOSSOM_MODEL_PROVIDER=openai` and `BLOSSOM_OPENAI_API_KEY`
- **Anthropic**: Set `BLOSSOM_MODEL_PROVIDER=anthropic` and `BLOSSOM_ANTHROPIC_API_KEY`
- **Stub Mode**: If no provider/key is set, returns canned responses (for testing)

See `.env.example` for all configuration options.

## API Endpoints

- `POST /api/chat` - Chat with Blossom agent (uses LLM when configured)
- `POST /api/strategy/close` - Close a strategy
- `GET /health` - Health check

