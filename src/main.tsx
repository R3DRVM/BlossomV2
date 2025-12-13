import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ActivityFeedProvider } from './context/ActivityFeedContext'
import { ExecutionProvider } from './context/ExecutionContext'
import AppRouter from './routes/AppRouter.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ActivityFeedProvider>
      <ExecutionProvider>
        <BrowserRouter>
          <AppRouter />
        </BrowserRouter>
      </ExecutionProvider>
    </ActivityFeedProvider>
  </React.StrictMode>,
)

