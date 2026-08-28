import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const API_BASE = import.meta.env.VITE_API_BASE_URL

interface PromptTemplate {
  id: string
  key: string
  label: string
  content: string
  is_active: boolean
  updated_at: string
  updated_by: string | null
}

export default function PromptsPage() {
  const [prompts, setPrompts] = useState<PromptTemplate[]>([])
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successKey, setSuccessKey] = useState<string | null>(null)

  const fetchPrompts = async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('로그인이 필요합니다.')

      const res = await fetch(`${API_BASE}/prompts`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setPrompts(json.prompts ?? [])
    } catch (e: any) {
      setError(e.message ?? '불러오기 실패')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchPrompts() }, [])

  const handleEdit = (prompt: PromptTemplate) => {
    setEditingKey(prompt.key)
    setEditContent(prompt.content)
    setSuccessKey(null)
  }

  const handleCancel = () => {
    setEditingKey(null)
    setEditContent('')
  }

  const handleSave = async (key: string) => {
    if (!editContent.trim()) return
    setSaving(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('로그인이 필요합니다.')

      const res = await fetch(`${API_BASE}/prompts/${key}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: editContent }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setSuccessKey(key)
      setEditingKey(null)
      await fetchPrompts()
    } catch (e: any) {
      setError(e.message ?? '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  const formatDate = (iso: string) => {
    if (!iso) return '-'
    return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-800">프롬프트 관리</h2>
        <p className="text-sm text-gray-500 mt-1">AI 분석에 사용되는 프롬프트를 관리합니다. 변경 사항은 다음 분석부터 즉시 반영됩니다.</p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-600">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-16 text-gray-400">불러오는 중...</div>
      ) : (
        <div className="space-y-4">
          {prompts.map((prompt) => (
            <div key={prompt.key} className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <span className="text-xs font-mono bg-gray-100 text-gray-600 px-2 py-0.5 rounded mr-2">
                    {prompt.key}
                  </span>
                  <span className="text-sm font-semibold text-gray-800">{prompt.label}</span>
                  {successKey === prompt.key && (
                    <span className="ml-2 text-xs text-green-600 font-medium">✓ 저장됨</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    prompt.is_active
                      ? 'bg-green-50 text-green-700'
                      : 'bg-gray-100 text-gray-500'
                  }`}>
                    {prompt.is_active ? '활성' : '비활성'}
                  </span>
                  {editingKey !== prompt.key && (
                    <button
                      onClick={() => handleEdit(prompt)}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                    >
                      편집
                    </button>
                  )}
                </div>
              </div>

              {editingKey === prompt.key ? (
                <div>
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={10}
                    className="w-full text-sm border border-gray-300 rounded-md p-3 font-mono focus:outline-none focus:ring-2 focus:ring-green-400 resize-y"
                  />
                  <div className="flex gap-2 mt-2 justify-end">
                    <button
                      onClick={handleCancel}
                      className="text-sm px-4 py-1.5 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                      취소
                    </button>
                    <button
                      onClick={() => handleSave(prompt.key)}
                      disabled={saving}
                      className="text-sm px-4 py-1.5 rounded-md bg-green-700 text-white hover:bg-green-800 disabled:opacity-50 transition-colors"
                    >
                      {saving ? '저장 중...' : '저장'}
                    </button>
                  </div>
                </div>
              ) : (
                <pre className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-md p-3 font-mono leading-relaxed">
                  {prompt.content}
                </pre>
              )}

              <div className="mt-2 text-xs text-gray-400">
                마지막 수정: {formatDate(prompt.updated_at)}
                {prompt.updated_by && ` · ${prompt.updated_by}`}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
