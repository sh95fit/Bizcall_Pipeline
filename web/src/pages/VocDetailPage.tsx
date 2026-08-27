import { useEffect, useRef, useState } from 'react'
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
  s3_key: string
}

interface Category {
  id: string
  name: string
  parent_id: string | null
}

const SENTIMENT_LABEL: Record<string, string> = { positive: '긍정', neutral: '중립', negative: '부정' }
const SENTIMENT_COLOR: Record<string, string> = {
  positive: 'bg-green-100 text-green-700',
  neutral: 'bg-gray-100 text-gray-600',
  negative: 'bg-red-100 text-red-600',
}
const STATUS_LABEL: Record<string, string> = {
  pending: '대기', processing: '처리중', completed: '완료', failed: '실패',
}

const API_BASE = import.meta.env.VITE_API_BASE_URL as string

const getPresignedUrl = async (s3Key: string, token: string): Promise<string | null> => {
  try {
    const res = await fetch(
      `${API_BASE}/presign?key=${encodeURIComponent(s3Key)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!res.ok) return null
    const { url } = await res.json() as { url: string }
    return url
  } catch {
    return null
  }
}

export default function VocDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const audioRef = useRef<HTMLAudioElement>(null)

  const [record, setRecord] = useState<VocDetail | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)

  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [audioLoading, setAudioLoading] = useState(false)
  const [audioError, setAudioError] = useState<string | null>(null)

  const [showPermanentConfirm, setShowPermanentConfirm] = useState(false)
  const [savingPermanent, setSavingPermanent] = useState(false)

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteReason, setDeleteReason] = useState('')
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    const fetchData = async () => {
      const [{ data: voc }, { data: cats }] = await Promise.all([
        supabase.from('voc_records').select('*').eq('id', id!).single(),
        supabase.from('categories').select('id, name, parent_id').eq('is_active', true).order('sort_order'),
      ])
      if (voc) setRecord(voc as VocDetail)
      if (cats) setCategories(cats)
      setLoading(false)
    }
    fetchData()
  }, [id])

  const handlePlayRecording = async () => {
    if (!record) return
    if (audioUrl) {
      audioRef.current?.paused ? audioRef.current.play() : audioRef.current?.pause()
      return
    }
    setAudioLoading(true)
    setAudioError(null)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      setAudioError('로그인이 필요합니다.')
      setAudioLoading(false)
      return
    }
    const url = await getPresignedUrl(record.s3_key, session.access_token)
    if (!url) {
      setAudioError('녹음 파일을 불러올 수 없습니다.')
      setAudioLoading(false)
      return
    }
    setAudioUrl(url)
    setAudioLoading(false)
    setTimeout(() => { audioRef.current?.play() }, 100)
  }

  const handlePermanentSave = async () => {
    if (!record) return
    setSavingPermanent(true)
    const { error } = await supabase.from('voc_records').update({ is_permanent: true }).eq('id', record.id)
    if (!error) setRecord(prev => prev ? { ...prev, is_permanent: true } : prev)
    setSavingPermanent(false)
    setShowPermanentConfirm(false)
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

  const formatDate = (str: string | null) => {
    if (!str) return '-'
    return new Date(str).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
  }
  const formatDuration = (sec: number | null) => {
    if (!sec) return '-'
    return `${Math.floor(sec / 60)}분 ${sec % 60}초`
  }
  const getCategoryName = (catId: string | null) =>
    catId ? (categories.find(c => c.id === catId)?.name ?? '-') : '-'

  if (loading) return <p className="text-gray-400 text-sm p-6">불러오는 중...</p>
  if (!record) return <p className="text-gray-400 text-sm p-6">데이터를 찾을 수 없습니다.</p>

  const parentCategories = categories.filter(c => !c.parent_id)
  const subCategories = categories.filter(c => c.parent_id === record.category_id)

  return (
    <div className="w-full">
      {/* ── 헤더 ── */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/voc')} className="text-sm text-gray-400 hover:text-gray-600">
          ← 목록
        </button>
        <h2 className="text-xl font-bold text-gray-800">VOC 상세</h2>
        {record.sentiment && (
          <span className={`px-2 py-0.5 text-xs rounded-full ${SENTIMENT_COLOR[record.sentiment]}`}>
            {SENTIMENT_LABEL[record.sentiment]}
          </span>
        )}
        {record.is_permanent && (
          <span className="px-2 py-0.5 text-xs rounded-full bg-indigo-100 text-indigo-600">📌 영구 저장</span>
        )}
        <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-500 ml-auto">
          {STATUS_LABEL[record.processing_status] ?? record.processing_status}
        </span>
      </div>

      {/* ── 2컬럼 레이아웃 ── */}
      <div className="grid grid-cols-2 gap-4">

        {/* ── 좌측 컬럼 ── */}
        <div className="flex flex-col gap-4">

          {/* 통화 정보 */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">통화 정보</h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              {[
                { label: '업무폰', value: record.phone_name },
                { label: '발신번호', value: record.caller_number },
                { label: '방향', value: record.call_direction === 'incoming' ? '수신' : record.call_direction === 'outgoing' ? '발신' : '-' },
                { label: '통화 시간', value: formatDuration(record.duration_sec) },
                { label: '통화 시작', value: formatDate(record.call_started_at) },
                { label: '통화 종료', value: formatDate(record.call_ended_at) },
                { label: '카테고리', value: getCategoryName(record.category_id) },
                { label: '하위 카테고리', value: getCategoryName(record.sub_category_id) },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-xs text-gray-400 mb-0.5">{label}</p>
                  <p className="text-gray-700 text-sm">{value ?? '-'}</p>
                </div>
              ))}
            </div>
          </div>

          {/* 녹음 플레이어 */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">녹음 파일</h3>
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  onClick={handlePlayRecording}
                  disabled={audioLoading}
                  className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white text-sm rounded-lg hover:bg-green-600 disabled:opacity-50"
                >
                  {audioLoading ? '로딩 중...' : audioUrl ? '▶ / ⏸' : '▶ 녹음 듣기'}
                </button>
                {!record.is_permanent ? (
                  <button
                    onClick={() => setShowPermanentConfirm(true)}
                    className="px-4 py-2 border border-indigo-300 text-indigo-600 text-sm rounded-lg hover:bg-indigo-50"
                  >
                    📌 영구 저장
                  </button>
                ) : (
                  <span className="text-xs text-indigo-400">자동 삭제 제외됨</span>
                )}
              </div>
              {audioError && <p className="text-red-400 text-xs">{audioError}</p>}
              {audioUrl && (
                <audio ref={audioRef} src={audioUrl} controls className="w-full" />
              )}
            </div>
          </div>

          {/* 카테고리 수정 */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">카테고리 수정</h3>
            <div className="flex flex-col gap-2">
              <select
                value={record.category_id ?? ''}
                onChange={async e => {
                  const val = e.target.value || null
                  await supabase.from('voc_records').update({ category_id: val, sub_category_id: null }).eq('id', record.id)
                  setRecord(prev => prev ? { ...prev, category_id: val, sub_category_id: null } : prev)
                }}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 w-full"
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
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 w-full"
                >
                  <option value="">하위 카테고리 선택</option>
                  {subCategories.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* 후속 조치 */}
          {record.action_required && (
            <div className="bg-orange-50 rounded-xl border border-orange-200 p-5">
              <h3 className="text-sm font-semibold text-orange-700 mb-2">⚠️ 후속 조치 필요</h3>
              {record.action_memo && (
                <p className="text-sm text-orange-600 leading-relaxed">{record.action_memo}</p>
              )}
            </div>
          )}

          {/* 소프트 삭제 */}
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
                    >취소</button>
                    <button
                      onClick={handleSoftDelete}
                      disabled={deleting}
                      className="px-4 py-2 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50"
                    >{deleting ? '삭제 중...' : '삭제 확인'}</button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="px-4 py-2 text-sm border border-red-200 text-red-500 rounded-lg hover:bg-red-50"
                >삭제</button>
              )}
            </div>
          )}
        </div>

        {/* ── 우측 컬럼 ── */}
        <div className="flex flex-col gap-4">

          {/* AI 요약 */}
          {record.summary && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">AI 요약</h3>
              <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{record.summary}</p>
            </div>
          )}

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

          {/* 통화 스크립트 */}
          {record.transcript && (
            <div className="bg-white rounded-xl border border-gray-200 p-5 flex-1">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">통화 스크립트</h3>
              <p className="text-sm text-gray-500 leading-relaxed whitespace-pre-wrap">{record.transcript}</p>
            </div>
          )}

          {/* 요약/스크립트 모두 없을 때 플레이스홀더 */}
          {!record.summary && !record.transcript && (
            <div className="bg-gray-50 rounded-xl border border-dashed border-gray-200 p-8 flex items-center justify-center">
              <p className="text-gray-300 text-sm">AI 분석 결과가 없습니다</p>
            </div>
          )}
        </div>
      </div>

      {/* 영구 저장 확인 팝업 */}
      {showPermanentConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 shadow-xl max-w-sm w-full mx-4">
            <h3 className="text-base font-semibold text-gray-800 mb-2">녹음 영구 저장</h3>
            <p className="text-sm text-gray-500 mb-5 leading-relaxed">
              이 녹음 파일을 <span className="font-semibold text-indigo-600">영구 저장</span> 처리합니다.<br />
              영구 저장된 파일은 자동 삭제 정책에서 제외됩니다.<br />
              계속하시겠습니까?
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowPermanentConfirm(false)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
              >취소</button>
              <button
                onClick={handlePermanentSave}
                disabled={savingPermanent}
                className="px-4 py-2 text-sm bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 disabled:opacity-50"
              >{savingPermanent ? '처리 중...' : '영구 저장 확인'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
