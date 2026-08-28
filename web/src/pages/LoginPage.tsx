import { supabase } from '../lib/supabase'

export default function LoginPage() {
  const handleLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        // redirectTo: `${window.location.origin}/auth/callback`,
        redirectTo: `https://bizcall.lunchlab.me/auth/callback`,
        queryParams: { hd: 'lunchlab.me' },
      },
    })
  }

  return (
    <div className="flex items-center justify-center h-screen bg-gray-50">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-10 w-full max-w-sm text-center">
        <h1 className="text-2xl font-bold text-green-800 mb-2">BizCall Admin</h1>
        <p className="text-sm text-gray-500 mb-8">lunchlab.me 계정으로 로그인하세요</p>
        <button
          onClick={handleLogin}
          className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          <img src="https://www.google.com/favicon.ico" className="w-4 h-4" alt="Google" />
          Google로 로그인
        </button>
      </div>
    </div>
  )
}
