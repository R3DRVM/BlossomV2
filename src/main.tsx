import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { BlossomProvider } from './context/BlossomContext'
import { ActivityFeedProvider } from './context/ActivityFeedContext'
import { ExecutionProvider } from './context/ExecutionContext'
import AppRouter from './routes/AppRouter.tsx'
import WebsiteLock from './components/WebsiteLock.tsx'
import { installConsoleNoiseFilter } from './lib/consoleNoiseFilter'
import { initGlobalErrorHandlers } from './utils/globalErrorHandlers'
import './index.css'

// Install console noise filter early (before any components render)
installConsoleNoiseFilter();

// Initialize global error handlers for unhandled errors/rejections
initGlobalErrorHandlers();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WebsiteLock>
      <BlossomProvider>
        <ActivityFeedProvider>
          <ExecutionProvider>
            <BrowserRouter>
              <AppRouter />
            </BrowserRouter>
          </ExecutionProvider>
        </ActivityFeedProvider>
      </BlossomProvider>
    </WebsiteLock>
  </React.StrictMode>,
)

