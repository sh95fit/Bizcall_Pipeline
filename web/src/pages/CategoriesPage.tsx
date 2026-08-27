import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

interface Category {
  id: string
  name: string
  description: string | null
  parent_id: string | null
  sort_order: number
  is_active: boolean
  created_at: string
}

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editTarget, setEditTarget] = useState<Category | null>(null)
  const [form, setForm] = useState({ name: '', description: '', parent_id: '', sort_order: '0' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchCategories = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .order('sort_order', { ascending: true })
    if (!error && data) setCategories(data)
    setLoading(false)
  }

  useEffect(() => { fetchCategories() }, [])

  const openAdd = () => {
    setEditTarget(null)
    setForm({ name: '', description: '', parent_id: '', sort_order: '0' })
    setError(null)
    setShowModal(true)
  }

  const openEdit = (cat: Category) => {
    setEditTarget(cat)
    setForm({
      name: cat.name,
      description: cat.description ?? '',
      parent_id: cat.parent_id ?? '',
      sort_order: String(cat.sort_order),
    })
    setError(null)
    setShowModal(true)
  }

  const handleSave = async () => {
    if (!form.name.trim()) { setError('카테고리명을 입력하세요'); return }
    setSaving(true)
    setError(null)

    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      parent_id: form.parent_id || null,
      sort_order: parseInt(form.sort_order) || 0,
    }

    const { error } = editTarget
      ? await supabase.from('categories').update(payload).eq('id', editTarget.id)
      : await supabase.from('categories').insert({ ...payload, is_active: true })

    if (error) {
      setError(error.message.includes('unique') ? '이미 존재하는 카테고리명입니다' : '저장 실패: ' + error.message)
    } else {
      setShowModal(false)
      fetchCategories()
    }
    setSaving(false)
  }

  const handleToggleActive = async (cat: Category) => {
    await supabase.from('categories').update({ is_active: !cat.is_active }).eq('id', cat.id)
    fetchCategories()
  }

  const handleDelete = async (cat: Category) => {
    if (!confirm(`'${cat.name}' 카테고리를 삭제하시겠습니까?`)) return
    const { error } = await supabase.from('categories').delete().eq('id', cat.id)
    if (error) alert('삭제 실패: 하위 카테고리 또는 연결된 VOC가 있으면 삭제할 수 없습니다.')
    else fetchCategories()
  }

  const parentCategories = categories.filter(c => !c.parent_id)
  const getChildren = (parentId: string) => categories.filter(c => c.parent_id === parentId)
  const getParentName = (parentId: string | null) => {
    if (!parentId) return null
    return categories.find(c => c.id === parentId)?.name ?? null
  }

  return (
    <div>
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-800">카테고리 관리</h2>
        <button
          onClick={openAdd}
          className="px-4 py-2 bg-green-700 text-white text-sm rounded-lg hover:bg-green-800 transition-colors"
        >
          + 카테고리 추가
        </button>
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm">불러오는 중...</p>
      ) : (
        <div className="space-y-3">
          {parentCategories.length === 0 && (
            <p className="text-gray-400 text-sm text-center py-8">등록된 카테고리가 없습니다</p>
          )}
          {parentCategories.map(parent => (
            <div key={parent.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              {/* 상위 카테고리 */}
              <div className="flex items-center px-4 py-3 border-b border-gray-100">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-800 text-sm">{parent.name}</span>
                    {!parent.is_active && (
                      <span className="px-1.5 py-0.5 text-xs bg-gray-100 text-gray-400 rounded">비활성</span>
                    )}
                    <span className="text-xs text-gray-400">순서: {parent.sort_order}</span>
                  </div>
                  {parent.description && (
                    <p className="text-xs text-gray-400 mt-0.5">{parent.description}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => openEdit(parent)}
                    className="text-xs px-2.5 py-1 border border-gray-200 rounded hover:bg-gray-50 text-gray-600"
                  >
                    수정
                  </button>
                  <button
                    onClick={() => handleToggleActive(parent)}
                    className={`text-xs px-2.5 py-1 border rounded transition-colors ${
                      parent.is_active
                        ? 'border-gray-200 text-gray-500 hover:bg-gray-50'
                        : 'border-green-200 text-green-600 hover:bg-green-50'
                    }`}
                  >
                    {parent.is_active ? '비활성화' : '활성화'}
                  </button>
                  <button
                    onClick={() => handleDelete(parent)}
                    className="text-xs px-2.5 py-1 border border-red-200 text-red-400 rounded hover:bg-red-50"
                  >
                    삭제
                  </button>
                </div>
              </div>

              {/* 하위 카테고리 */}
              {getChildren(parent.id).map(child => (
                <div key={child.id} className="flex items-center px-4 py-2.5 bg-gray-50 border-b border-gray-100 last:border-0">
                  <div className="flex-1 pl-4">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400 text-xs">└</span>
                      <span className="text-sm text-gray-700">{child.name}</span>
                      {!child.is_active && (
                        <span className="px-1.5 py-0.5 text-xs bg-gray-100 text-gray-400 rounded">비활성</span>
                      )}
                      <span className="text-xs text-gray-400">순서: {child.sort_order}</span>
                    </div>
                    {child.description && (
                      <p className="text-xs text-gray-400 mt-0.5 pl-3">{child.description}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => openEdit(child)}
                      className="text-xs px-2.5 py-1 border border-gray-200 rounded hover:bg-gray-50 text-gray-600"
                    >
                      수정
                    </button>
                    <button
                      onClick={() => handleToggleActive(child)}
                      className={`text-xs px-2.5 py-1 border rounded transition-colors ${
                        child.is_active
                          ? 'border-gray-200 text-gray-500 hover:bg-gray-50'
                          : 'border-green-200 text-green-600 hover:bg-green-50'
                      }`}
                    >
                      {child.is_active ? '비활성화' : '활성화'}
                    </button>
                    <button
                      onClick={() => handleDelete(child)}
                      className="text-xs px-2.5 py-1 border border-red-200 text-red-400 rounded hover:bg-red-50"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* 모달 */}
      {showModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-bold text-gray-800 mb-4">
              {editTarget ? '카테고리 수정' : '카테고리 추가'}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">카테고리명 *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">설명</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="AI 분류 시 참고되는 설명"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">상위 카테고리</label>
                <select
                  value={form.parent_id}
                  onChange={e => setForm(f => ({ ...f, parent_id: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="">없음 (최상위)</option>
                  {parentCategories
                    .filter(c => c.id !== editTarget?.id)
                    .map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">정렬 순서</label>
                <input
                  type="number"
                  value={form.sort_order}
                  onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
            </div>
            <div className="flex gap-2 mt-6">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
              >
                취소
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 px-4 py-2 bg-green-700 text-white rounded-lg text-sm hover:bg-green-800 disabled:opacity-50"
              >
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
