# Blossom Deployment Guide

This guide covers deploying the Blossom frontend and backend agent service.

## Frontend Deployment (Vercel)

### Prerequisites
- Vercel account
- GitHub repository connected to Vercel

### Steps

1. **Import Project**
   - Go to [Vercel Dashboard](https://vercel.com/dashboard)
   - Click "Add New Project"
   - Import your GitHub repository (`R3DRVM/BlossomV2`)

2. **Build Configuration**
   - **Framework Preset**: Vite
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
   - **Install Command**: `npm install`

3. **Environment Variables**
   Add these in Vercel project settings:
   ```
   VITE_USE_AGENT_BACKEND=true
   VITE_BLOSSOM_AGENT_URL=https://your-agent-domain.com
   ```

4. **Deploy**
   - Click "Deploy"
   - Vercel will build and deploy your frontend
   - Your app will be available at `https://your-project.vercel.app`

## Backend Agent Deployment

The backend agent can be deployed to various platforms. Here are recommended options:

### Option 1: Railway

1. **Create Railway Project**
   - Go to [Railway](https://railway.app)
   - Create a new project
   - Connect your GitHub repository

2. **Configure Service**
   - Select the `agent/` directory as the root
   - Set start command: `npm run dev` (or `npm start` for production)
   - Railway will auto-detect Node.js

3. **Environment Variables**
   Add in Railway dashboard:
   ```
   PORT=3001
   BLOSSOM_MODEL_PROVIDER=openai
   BLOSSOM_OPENAI_API_KEY=sk-your-key-here
   BLOSSOM_OPENAI_MODEL=gpt-4o-mini
   ```

4. **Deploy**
   - Railway will automatically deploy on push to main
   - Get your public URL from Railway dashboard
   - Update `VITE_BLOSSOM_AGENT_URL` in Vercel with this URL

### Option 2: Fly.io

1. **Install Fly CLI**
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```

2. **Initialize Fly App**
   ```bash
   cd agent
   fly launch
   ```

3. **Configure `fly.toml`**
   ```toml
   [build]
     builder = "paketobuildpacks/builder:base"

   [env]
     PORT = "3001"

   [[services]]
     internal_port = 3001
     protocol = "tcp"
   ```

4. **Set Secrets**
   ```bash
   fly secrets set BLOSSOM_MODEL_PROVIDER=openai
   fly secrets set BLOSSOM_OPENAI_API_KEY=sk-your-key-here
   ```

5. **Deploy**
   ```bash
   fly deploy
   ```

### Option 3: Render

1. **Create Web Service**
   - Go to [Render Dashboard](https://dashboard.render.com)
   - Click "New +" → "Web Service"
   - Connect your GitHub repository

2. **Configure**
   - **Root Directory**: `agent`
   - **Build Command**: `npm install`
   - **Start Command**: `npm run dev` (or `npm start` for production)
   - **Environment**: Node

3. **Environment Variables**
   Add in Render dashboard:
   ```
   PORT=3001
   BLOSSOM_MODEL_PROVIDER=openai
   BLOSSOM_OPENAI_API_KEY=sk-your-key-here
   ```

4. **Deploy**
   - Render will auto-deploy on push
   - Get your public URL
   - Update `VITE_BLOSSOM_AGENT_URL` in Vercel

## CORS Configuration

The backend agent already includes CORS middleware in `agent/src/server/http.ts`. If you need to restrict to specific domains, update:

```typescript
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
}));
```

## Health Check

The backend exposes a health check endpoint:
```
GET /health
```

Returns:
```json
{
  "status": "ok",
  "service": "blossom-agent"
}
```

## Troubleshooting

### Frontend can't reach backend
- Verify `VITE_BLOSSOM_AGENT_URL` is set correctly
- Check backend is running and accessible
- Verify CORS is configured correctly

### Backend fails to start
- Check environment variables are set
- Verify Node.js version (requires Node 18+)
- Check logs for specific error messages

### LLM not responding
- Verify API keys are set correctly
- Check API key has sufficient credits
- Review backend logs for LLM errors

## Production Checklist

- [ ] Frontend deployed to Vercel
- [ ] Backend deployed to Railway/Fly.io/Render
- [ ] Environment variables configured
- [ ] CORS configured correctly
- [ ] Health check endpoint accessible
- [ ] Frontend can communicate with backend
- [ ] LLM API keys are valid
- [ ] Error handling works gracefully

