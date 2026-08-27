import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function AuthCallbackPage() {
  const navigate = useNavigate()

  useEffect(() => {
    // URL의 code를 세션으로 교환
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        subscription.unsubscribe()
        navigate('/', { replace: true })
      } else if (event === 'SIGNED_OUT') {
        subscription.unsubscribe()
        navigate('/login', { replace: true })
      }
    })

    // 현재 URL의 code 파라미터로 세션 교환 시도
    supabase.auth.exchangeCodeForSession(window.location.href).catch(() => {
      navigate('/login', { replace: true })
    })

    return () => subscription.unsubscribe()
  }, [navigate])

  return (
    <div className="flex items-center justify-center h-screen">
      <p className="text-gray-500">로그인 처리 중...</p>
    </div>
  )
}
