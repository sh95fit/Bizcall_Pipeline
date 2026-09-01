import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

interface Phone {
  id: string
  name: string
  device_id: string | null
  token: string
  is_active: boolean
  is_used: boolean
  registered_at: string | null
  last_seen_at: string | null
}

export default function PhonesPage() {
  const [phones, setPhones] = useState<Phone[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [newName, setNewName] = useState('')
  const [newToken, setNewToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchPhones = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('phones')
      .select('*')
      .order('registered_at', { ascending: false })
    if (!error && data) setPhones(data)
    setLoading(false)
  }

  useEffect(() => { fetchPhones() }, [])

  const generateToken = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  }

  const handleAdd = async () => {
    if (!newName.trim()) { setError('기기명을 입력하세요'); return }
    if (!newToken.trim()) { setError('토큰을 입력하세요'); return }
    setSaving(true)
    setError(null)
    const { error } = await supabase.from('phones').insert({
      name: newName.trim(),
      token: newToken.trim(),
      is_active: true,
      is_used: false,
    })
    if (error) {
      setError(error.message.includes('unique') ? '이미 사용 중인 토큰입니다' : '등록 실패: ' + error.message)
    } else {
      setNewName('')
      setNewToken('')
      setShowAddModal(false)
      fetchPhones()
    }
    setSaving(false)
  }

  const handleToggleActive = async (phone: Phone) => {
    const { error } = await supabase
      .from('phones')
      .update({ is_active: !phone.is_active })
      .eq('id', phone.id)
    if (!error) fetchPhones()
  }

  const formatDate = (str: string | null) => {
    if (!str) return '-'
    return new Date(str).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
  }

  const statusBadge = (phone: Phone) => {
    if (!phone.is_active) return <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-500">비활성</span>
    if (!phone.is_used) return <span className="px-2 py-0.5 text-xs rounded-full bg-yellow-100 text-yellow-700">미등록</span>
    return <span className="px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-700">활성</span>
  }

  return (
    <div>
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-800">업무폰 관리</h2>
        <button
          onClick={() => { setShowAddModal(true); setError(null); setNewToken(generateToken()) }}
          className="px-4 py-2 bg-green-700 text-white text-sm rounded-lg hover:bg-green-800 transition-colors"
        >
          + 업무폰 등록
        </button>
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm">불러오는 중...</p>
      ) : (
        <>
          {/* ── 데스크탑: 테이블 ── */}
          <div className="hidden sm:block bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['기기명', '상태', '토큰', '기기 ID', '최근 접속', '등록일', '관리'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {phones.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">등록된 업무폰이 없습니다</td></tr>
                ) : phones.map(phone => (
                  <tr key={phone.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-800">{phone.name}</td>
                    <td className="px-4 py-3">{statusBadge(phone)}</td>
                    <td className="px-4 py-3 font-mono text-gray-500 text-xs">{phone.token}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{phone.device_id ?? '-'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(phone.last_seen_at)}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(phone.registered_at)}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggleActive(phone)}
                        className={`text-xs px-3 py-1 rounded-md border transition-colors ${
                          phone.is_active
                            ? 'border-red-200 text-red-500 hover:bg-red-50'
                            : 'border-green-200 text-green-600 hover:bg-green-50'
                        }`}
                      >
                        {phone.is_active ? '비활성화' : '활성화'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── 모바일: 카드 리스트 ── */}
          <div className="sm:hidden space-y-3">
            {phones.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-8">등록된 업무폰이 없습니다</p>
            ) : phones.map(phone => (
              <div key={phone.id} className="bg-white rounded-xl border border-gray-200 p-4">
                {/* 상단: 기기명 + 상태 */}
                <div className="flex items-center justify-between mb-3">
                  <span className="font-semibold text-gray-800">{phone.name}</span>
                  {statusBadge(phone)}
                </div>
                {/* 토큰 */}
                <div className="mb-2">
                  <p className="text-xs text-gray-400 mb-0.5">등록 토큰</p>
                  <p className="font-mono text-sm text-gray-600 bg-gray-50 rounded px-2 py-1">{phone.token}</p>
                </div>
                {/* 기기 ID */}
                {phone.device_id && (
                  <div className="mb-2">
                    <p className="text-xs text-gray-400 mb-0.5">기기 ID</p>
                    <p className="text-xs text-gray-500 truncate">{phone.device_id}</p>
                  </div>
                )}
                {/* 날짜 정보 */}
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">최근 접속</p>
                    <p className="text-xs text-gray-500">{formatDate(phone.last_seen_at)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">등록일</p>
                    <p className="text-xs text-gray-500">{formatDate(phone.registered_at)}</p>
                  </div>
                </div>
                {/* 관리 버튼 */}
                <button
                  onClick={() => handleToggleActive(phone)}
                  className={`w-full text-sm py-2 rounded-lg border transition-colors ${
                    phone.is_active
                      ? 'border-red-200 text-red-500 hover:bg-red-50'
                      : 'border-green-200 text-green-600 hover:bg-green-50'
                  }`}
                >
                  {phone.is_active ? '비활성화' : '활성화'}
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* 등록 모달 — mx-4로 모바일 여백 확보 */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-lg p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-bold text-gray-800 mb-4">업무폰 등록</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">기기명</label>
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="예: 영업팀 1번폰"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">등록 토큰</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newToken}
                    onChange={e => setNewToken(e.target.value.toUpperCase())}
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                  <button
                    onClick={() => setNewToken(generateToken())}
                    className="px-3 py-2 text-xs border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    재생성
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-1">앱 등록 시 이 토큰을 입력합니다</p>
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
            </div>
            <div className="flex gap-2 mt-6">
              <button
                onClick={() => { setShowAddModal(false); setError(null) }}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
              >
                취소
              </button>
              <button
                onClick={handleAdd}
                disabled={saving}
                className="flex-1 px-4 py-2 bg-green-700 text-white rounded-lg text-sm hover:bg-green-800 disabled:opacity-50"
              >
                {saving ? '등록 중...' : '등록'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
