import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

interface VocDetail {
  id: string
  phone_name: string | null
  caller_number: string | null
  call_direction: string | null
  call_started_at: string | null
  call_ended_at: string | null
  duration_sec: number | null
  transcript: string | null
  summary: string | null
  sentiment: string | null
  keywords: string[] | null
  action_required: boolean
  action_memo: string | null
  processing_status: string
  is_deleted: boolean
  is_permanent: boolean
  created_at: string
  category_id: string | null
  sub_category_id: string | null
}

interface Category {
  id: string
  name: string
  parent_id: string | null
}

const SENTIMENT_LABEL: Record<string, string> = {
  positive: '긍정',
  neutral: '중립',
  negative: '부정',
}

const SENTIMENT_COLOR: Record<string, string> = {
  positive: 'bg-green-100 text-green-700',
  neutral: 'bg-gray-100 text-gray-600',
  negative: 'bg-red-100 text-red-600',
}

const STATUS_LABEL: Record<string, string> = {
  pending: '대기',
  processing: '처리중',
  completed: '완료',
  failed: '실패',
}

export default function VocDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [record, setRecord] = useState<VocDetail | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteReason, setDeleteReason] = useState('')

  useEffect(() => {
    const fetchData = async () => {
      const [{ data: voc }, { data: cats }] = await Promise.all([
        supabase.from('voc_records').select('*').eq('id', id!).single(),
        supabase.from('categories').select('id, name, parent_id').eq('is_active', true).order('sort_order'),
      ])
      if (voc) setRecord(voc)
      if (cats) setCategories(cats)
      setLoading(false)
    }
    fetchData()
  }, [id])

  const formatDate = (str: string | null) => {
    if (!str) return '-'
    return new Date(str).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
  }

  const formatDuration = (sec: number | null) => {
    if (!sec) return '-'
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return `${m}분 ${s}초`
  }

  const getCategoryName = (catId: string | null) => {
    if (!catId) return '-'
    return categories.find(c => c.id === catId)?.name ?? '-'
  }

  const handleSoftDelete = async () => {
    if (!record) return
    setDeleting(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase
      .from('voc_records')
      .update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by: user?.email ?? 'unknown',
        delete_reason: deleteReason.trim() || null,
      })
      .eq('id', record.id)
    if (!error) navigate('/voc')
    setDeleting(false)
  }

  if (loading) return <p className="text-gray-400 text-sm">불러오는 중...</p>
  if (!record) return <p className="text-gray-400 text-sm">데이터를 찾을 수 없습니다.</p>

  const parentCategories = categories.filter(c => !c.parent_id)
  const subCategories = categories.filter(c => c.parent_id === record.category_id)

  return (
    <div className="max-w-4xl">
      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/voc')}
          className="text-sm text-gray-400 hover:text-gray-600"
        >
          ← 목록
        </button>
        <h2 className="text-xl font-bold text-gray-800">VOC 상세</h2>
        {record.sentiment && (
          <span className={`px-2 py-0.5 text-xs rounded-full ${SENTIMENT_COLOR[record.sentiment]}`}>
            {SENTIMENT_LABEL[record.sentiment]}
          </span>
        )}
        <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-500 ml-auto">
          {STATUS_LABEL[record.processing_status] ?? record.processing_status}
        </span>
      </div>

      <div className="space-y-4">
        {/* 통화 정보 */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">통화 정보</h3>
          <div className="grid grid-cols-3 gap-4 text-sm">
            {[
              { label: '업무폰', value: record.phone_name },
              { label: '발신번호', value: record.caller_number },
              { label: '방향', value: record.call_direction === 'incoming' ? '수신' : record.call_direction === 'outgoing' ? '발신' : '-' },
              { label: '통화 시작', value: formatDate(record.call_started_at) },
              { label: '통화 종료', value: formatDate(record.call_ended_at) },
              { label: '통화 시간', value: formatDuration(record.duration_sec) },
              { label: '카테고리', value: getCategoryName(record.category_id) },
              { label: '하위 카테고리', value: getCategoryName(record.sub_category_id) },
              { label: '생성일', value: formatDate(record.created_at) },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-xs text-gray-400 mb-0.5">{label}</p>
                <p className="text-gray-700">{value ?? '-'}</p>
              </div>
            ))}
          </div>
        </div>

        {/* 키워드 */}
        {record.keywords && record.keywords.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">키워드</h3>
            <div className="flex flex-wrap gap-2">
              {record.keywords.map(kw => (
                <span key={kw} className="px-3 py-1 bg-gray-100 text-gray-600 text-xs rounded-full">{kw}</span>
              ))}
            </div>
          </div>
        )}

        {/* 요약 */}
        {record.summary && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">AI 요약</h3>
            <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{record.summary}</p>
          </div>
        )}

        {/* 액션 */}
        {record.action_required && (
          <div className="bg-orange-50 rounded-xl border border-orange-200 p-5">
            <h3 className="text-sm font-semibold text-orange-700 mb-2">⚠️ 후속 조치 필요</h3>
            {record.action_memo && (
              <p className="text-sm text-orange-600 leading-relaxed">{record.action_memo}</p>
            )}
          </div>
        )}

        {/* 스크립트 */}
        {record.transcript && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">통화 스크립트</h3>
            <p className="text-sm text-gray-500 leading-relaxed whitespace-pre-wrap">{record.transcript}</p>
          </div>
        )}

        {/* 카테고리 수동 지정 */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">카테고리 수정</h3>
          <div className="flex gap-3">
            <select
              value={record.category_id ?? ''}
              onChange={async e => {
                const val = e.target.value || null
                await supabase.from('voc_records').update({ category_id: val, sub_category_id: null }).eq('id', record.id)
                setRecord(prev => prev ? { ...prev, category_id: val, sub_category_id: null } : prev)
              }}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="">카테고리 선택</option>
              {parentCategories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {subCategories.length > 0 && (
              <select
                value={record.sub_category_id ?? ''}
                onChange={async e => {
                  const val = e.target.value || null
                  await supabase.from('voc_records').update({ sub_category_id: val }).eq('id', record.id)
                  setRecord(prev => prev ? { ...prev, sub_category_id: val } : prev)
                }}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="">하위 카테고리 선택</option>
                {subCategories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* 삭제 */}
        {!record.is_deleted && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">VOC 삭제</h3>
            {showDeleteConfirm ? (
              <div className="space-y-3">
                <input
                  type="text"
                  placeholder="삭제 사유 입력 (선택)"
                  value={deleteReason}
                  onChange={e => setDeleteReason(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    취소
                  </button>
                  <button
                    onClick={handleSoftDelete}
                    disabled={deleting}
                    className="px-4 py-2 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50"
                  >
                    {deleting ? '삭제 중...' : '삭제 확인'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="px-4 py-2 text-sm border border-red-200 text-red-500 rounded-lg hover:bg-red-50"
              >
                삭제
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
