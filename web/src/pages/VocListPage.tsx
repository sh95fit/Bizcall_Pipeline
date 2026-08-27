import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

interface VocRecord {
  id: string
  phone_name: string | null
  caller_number: string | null
  call_direction: string | null
  call_started_at: string | null
  duration_sec: number | null
  processing_status: string
  sentiment: string | null
  summary: string | null
  is_deleted: boolean
  created_at: string
}

const STATUS_LABEL: Record<string, string> = {
  pending: '대기',
  processing: '처리중',
  completed: '완료',
  failed: '실패',
}

const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  processing: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-600',
}

const SENTIMENT_LABEL: Record<string, string> = {
  positive: '긍정',
  neutral: '중립',
  negative: '부정',
}

const SENTIMENT_COLOR: Record<string, string> = {
  positive: 'text-green-600',
  neutral: 'text-gray-500',
  negative: 'text-red-500',
}

export default function VocListPage() {
  const navigate = useNavigate()
  const [records, setRecords] = useState<VocRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [sentimentFilter, setSentimentFilter] = useState<string>('all')
  const [searchText, setSearchText] = useState('')
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 20

  const fetchRecords = async () => {
    setLoading(true)
    let query = supabase
      .from('voc_records')
      .select('id, phone_name, caller_number, call_direction, call_started_at, duration_sec, processing_status, sentiment, summary, is_deleted, created_at')
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (statusFilter !== 'all') query = query.eq('processing_status', statusFilter)
    if (sentimentFilter !== 'all') query = query.eq('sentiment', sentimentFilter)
    if (searchText.trim()) query = query.ilike('caller_number', `%${searchText.trim()}%`)

    const { data, error } = await query
    if (!error && data) setRecords(data)
    setLoading(false)
  }

  useEffect(() => {
    setPage(0)
  }, [statusFilter, sentimentFilter, searchText])

  useEffect(() => {
    fetchRecords()
  }, [page, statusFilter, sentimentFilter, searchText])

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

  return (
    <div>
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-800">VOC 목록</h2>
      </div>

      {/* 필터 */}
      <div className="flex gap-3 mb-4">
        <input
          type="text"
          placeholder="발신번호 검색..."
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-green-500"
        />
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
        >
          <option value="all">전체 상태</option>
          <option value="pending">대기</option>
          <option value="processing">처리중</option>
          <option value="completed">완료</option>
          <option value="failed">실패</option>
        </select>
        <select
          value={sentimentFilter}
          onChange={e => setSentimentFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
        >
          <option value="all">전체 감성</option>
          <option value="positive">긍정</option>
          <option value="neutral">중립</option>
          <option value="negative">부정</option>
        </select>
      </div>

      {/* 테이블 */}
      {loading ? (
        <p className="text-gray-400 text-sm">불러오는 중...</p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['업무폰', '발신번호', '방향', '통화시작', '통화시간', '감성', '상태', '요약'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {records.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">데이터가 없습니다</td></tr>
              ) : records.map(r => (
                <tr
                  key={r.id}
                  onClick={() => navigate(`/voc/${r.id}`)}
                  className="hover:bg-gray-50 cursor-pointer"
                >
                  <td className="px-4 py-3 text-gray-700">{r.phone_name ?? '-'}</td>
                  <td className="px-4 py-3 font-mono text-gray-600">{r.caller_number ?? '-'}</td>
                  <td className="px-4 py-3 text-gray-500">{r.call_direction === 'incoming' ? '수신' : r.call_direction === 'outgoing' ? '발신' : '-'}</td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(r.call_started_at)}</td>
                  <td className="px-4 py-3 text-gray-500">{formatDuration(r.duration_sec)}</td>
                  <td className={`px-4 py-3 font-medium ${r.sentiment ? SENTIMENT_COLOR[r.sentiment] : 'text-gray-400'}`}>
                    {r.sentiment ? (SENTIMENT_LABEL[r.sentiment] ?? r.sentiment) : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 text-xs rounded-full ${STATUS_COLOR[r.processing_status] ?? 'bg-gray-100 text-gray-500'}`}>
                      {STATUS_LABEL[r.processing_status] ?? r.processing_status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400 max-w-xs truncate">{r.summary ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 페이지네이션 */}
      <div className="flex justify-center gap-2 mt-4">
        <button
          onClick={() => setPage(p => Math.max(0, p - 1))}
          disabled={page === 0}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50"
        >
          이전
        </button>
        <span className="px-3 py-1.5 text-sm text-gray-600">{page + 1} 페이지</span>
        <button
          onClick={() => setPage(p => p + 1)}
          disabled={records.length < PAGE_SIZE}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50"
        >
          다음
        </button>
      </div>
    </div>
  )
}
