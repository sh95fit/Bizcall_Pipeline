import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const NAV_ITEMS = [
  { to: '/',           label: '대시보드',     icon: '📊' },
  { to: '/voc',        label: 'VOC 목록',     icon: '📋' },
  { to: '/phones',     label: '업무폰',       icon: '📱' },
  { to: '/categories', label: '카테고리',     icon: '🗂️' },
  { to: '/prompts',    label: '프롬프트',     icon: '🤖' },
]

export default function Layout() {
  const navigate = useNavigate()
  // 모바일 사이드바 드로어 열림 여부
  const [drawerOpen, setDrawerOpen] = useState(false)

  const handleLogout = async () => {
    await supabase.auth.signOut()
    navigate('/login')
  }

  return (
    <div className="flex h-screen bg-gray-50">

      {/* ════════════════════════════════════════
          데스크탑 사이드바 (sm 이상에서만 표시)
          ════════════════════════════════════════ */}
      <aside className="hidden sm:flex w-56 bg-white border-r border-gray-200 flex-col shrink-0">
        <div className="p-5 border-b border-gray-200">
          <h1 className="text-lg font-bold text-green-800">BizCall Admin</h1>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {NAV_ITEMS.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-green-50 text-green-800'
                    : 'text-gray-600 hover:bg-gray-100'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="p-4 border-t border-gray-200">
          <button
            onClick={handleLogout}
            className="w-full text-sm text-gray-500 hover:text-red-500 transition-colors text-left px-3 py-2"
          >
            로그아웃
          </button>
        </div>
      </aside>

      {/* ════════════════════════════════════════
          모바일 상단 헤더 (sm 미만에서만 표시)
          ════════════════════════════════════════ */}
      <div className="sm:hidden fixed top-0 left-0 right-0 z-30 bg-white border-b border-gray-200 flex items-center justify-between px-4 h-14">
        <h1 className="text-base font-bold text-green-800">BizCall Admin</h1>
        {/* 햄버거 버튼 → 드로어 열기 */}
        <button
          onClick={() => setDrawerOpen(true)}
          className="p-2 text-gray-500 hover:text-gray-800"
          aria-label="메뉴 열기"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>

      {/* ════════════════════════════════════════
          모바일 드로어 (오버레이 + 슬라이드 메뉴)
          ════════════════════════════════════════ */}
      {drawerOpen && (
        <>
          {/* 딤 배경 — 클릭 시 닫기 */}
          <div
            className="sm:hidden fixed inset-0 bg-black/40 z-40"
            onClick={() => setDrawerOpen(false)}
          />
          {/* 드로어 본체 */}
          <div className="sm:hidden fixed top-0 right-0 h-full w-64 bg-white z-50 flex flex-col shadow-xl">
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <h1 className="text-base font-bold text-green-800">BizCall Admin</h1>
              <button
                onClick={() => setDrawerOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
                aria-label="메뉴 닫기"
              >
                ✕
              </button>
            </div>
            <nav className="flex-1 p-4 space-y-1">
              {NAV_ITEMS.map(({ to, label, icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  onClick={() => setDrawerOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-green-50 text-green-800'
                        : 'text-gray-600 hover:bg-gray-100'
                    }`
                  }
                >
                  <span>{icon}</span>
                  {label}
                </NavLink>
              ))}
            </nav>
            <div className="p-4 border-t border-gray-200">
              <button
                onClick={handleLogout}
                className="w-full text-sm text-red-500 hover:text-red-700 transition-colors text-left px-3 py-2"
              >
                로그아웃
              </button>
            </div>
          </div>
        </>
      )}

      {/* ════════════════════════════════════════
          메인 콘텐츠
          - 모바일: 상단 헤더(h-14) 높이만큼 pt 확보
          - 데스크탑: 기존과 동일하게 p-8
          ════════════════════════════════════════ */}
      <main className="flex-1 overflow-auto pt-14 sm:pt-0 p-4 sm:p-8">
        <Outlet />
      </main>

    </div>
  )
}
