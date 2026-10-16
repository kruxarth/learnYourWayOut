import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App'

// No React.StrictMode: it runs effects twice in dev (duplicate listeners, audio contexts).
createRoot(document.getElementById('root')!).render(<App />)
