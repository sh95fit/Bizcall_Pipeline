import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import type { Session } from '@supabase/supabase-js'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import VocListPage from './pages/VocListPage'
import VocDetailPage from './pages/VocDetailPage'
import PhonesPage from './pages/PhonesPage'
import CategoriesPage from './pages/CategoriesPage'
import AuthCallbackPage from './pages/AuthCallbackPage'
import Layout from './components/Layout'

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center h-screen">
      <p className="text-gray-500">로딩 중...</p>
    </div>
  )

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={!session ? <LoginPage /> : <Navigate to="/" />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route element={session ? <Layout /> : <Navigate to="/login" />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/voc" element={<VocListPage />} />
          <Route path="/voc/:id" element={<VocDetailPage />} />
          <Route path="/phones" element={<PhonesPage />} />
          <Route path="/categories" element={<CategoriesPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
