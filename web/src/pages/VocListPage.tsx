import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

interface VocRecord {
  id: string
  phone_name: string | null
  caller_number: string | null
  call_direction: string | null
  call_started_at: string | null
  processing_status: string
  sentiment: string | null
  summary: string | null
  action_required: boolean
  action_memo: string | null
}

const STATUS_LABEL: Record<string, string> = {
  pending: '대기', processing: '처리중', completed: '완료', failed: '실패',
}
const STATUS_COLOR: Record<string, string> = {
  pending:    'bg-yellow-100 text-yellow-700',
  processing: 'bg-blue-100 text-blue-700',
  completed:  'bg-green-100 text-green-700',
  failed:     'bg-red-100 text-red-600',
}
const SENTIMENT_LABEL: Record<string, string> = {
  positive: '긍정', neutral: '중립', negative: '부정',
}
const SENTIMENT_COLOR: Record<string, string> = {
  positive: 'text-green-600', neutral: 'text-gray-400', negative: 'text-red-500',
}

export default function VocListPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const dateParam = searchParams.get('date')

  const [records, setRecords]           = useState<VocRecord[]>([])
  const [loading, setLoading]           = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [sentimentFilter, setSentimentFilter] = useState('all')
  const [searchText, setSearchText]     = useState('')
  const [page, setPage]                 = useState(0)
  const PAGE_SIZE = 20

  const fetchRecords = async () => {
    setLoading(true)
    let query = supabase
      .from('voc_records')
      .select('id,phone_name,caller_number,call_direction,call_started_at,processing_status,sentiment,summary,action_required,action_memo')
      .eq('is_deleted', false)
      .order('call_started_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (statusFilter !== 'all') query = query.eq('processing_status', statusFilter)
    if (sentimentFilter !== 'all') query = query.eq('sentiment', sentimentFilter)
    if (searchText.trim()) query = query.ilike('caller_number', `%${searchText.trim()}%`)
    if (dateParam) {
      query = query
        .gte('call_started_at', `${dateParam}T00:00:00`)
        .lte('call_started_at', `${dateParam}T23:59:59`)
    }

    const { data, error } = await query
    if (!error && data) setRecords(data)
    setLoading(false)
  }

  useEffect(() => { setPage(0) }, [statusFilter, sentimentFilter, searchText, dateParam])
  useEffect(() => { fetchRecords() }, [page, statusFilter, sentimentFilter, searchText, dateParam])

  /* MM/DD HH:mm */
  const formatDate = (str: string | null) => {
    if (!str) return '-'
    const d   = new Date(str)
    const mm  = String(d.getMonth() + 1).padStart(2, '0')
    const dd  = String(d.getDate()).padStart(2, '0')
    const hh  = String(d.getHours()).padStart(2, '0')
    const min = String(d.getMinutes()).padStart(2, '0')
    return `${mm}/${dd} ${hh}:${min}`
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-xl font-bold text-gray-800">VOC 목록</h2>
        {dateParam && (
          <span className="text-xs text-blue-600 bg-blue-50 px-2.5 py-0.5 rounded-full flex items-center gap-1">
            {dateParam}
            <button onClick={() => navigate('/voc')} className="text-blue-300 hover:text-blue-500 ml-0.5">✕</button>
          </span>
        )}
      </div>

      {/* 필터 */}
      <div className="flex gap-2 mb-4">
        <input
          type="text" placeholder="발신번호 검색..."
          value={searchText} onChange={e => setSearchText(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-green-500"
        />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
          <option value="all">전체 상태</option>
          <option value="pending">대기</option>
          <option value="processing">처리중</option>
          <option value="completed">완료</option>
          <option value="failed">실패</option>
        </select>
        <select value={sentimentFilter} onChange={e => setSentimentFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
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
          <table className="w-full text-xs table-fixed">
            <colgroup>
              {/*
                업무폰   : 8%   — 짧은 별칭
                발신번호 : 11%  — 01000000000 고정 11자리 + 여백
                방향     : 5%   — 수신/발신 2글자
                통화시작 : 9%   — MM/DD HH:mm 고정 포맷
                감성     : 5%   — 2글자
                상태     : 6%   — 최대 3글자 뱃지
                요약     : 36%  — 가장 넓게
                후속조치 : 20%  — memo 텍스트
              */}
              <col style={{ width: '8%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '5%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '5%' }} />
              <col style={{ width: '6%' }} />
              <col style={{ width: '36%' }} />
              <col style={{ width: '20%' }} />
            </colgroup>
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['업무폰', '발신번호', '방향', '통화시작', '감성', '상태', '요약', '후속 조치'].map(h => (
                  <th key={h} className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {records.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-400 text-sm">데이터가 없습니다</td>
                </tr>
              ) : records.map(r => (
                <tr key={r.id} onClick={() => navigate(`/voc/${r.id}`)}
                  className="hover:bg-gray-50 cursor-pointer">

                  {/* 업무폰 */}
                  <td className="px-3 py-2.5 text-gray-700 truncate overflow-hidden whitespace-nowrap">
                    {r.phone_name ?? '-'}
                  </td>

                  {/* 발신번호 — 01012345678 고정 11자리, 폰트는 mono */}
                  <td className="px-3 py-2.5 font-mono text-gray-600 whitespace-nowrap">
                    {r.caller_number ?? '-'}
                  </td>

                  {/* 방향 */}
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {r.call_direction === 'incoming'
                      ? <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-500">수신</span>
                      : r.call_direction === 'outgoing'
                      ? <span className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-500">발신</span>
                      : <span className="text-gray-300">-</span>}
                  </td>

                  {/* 통화시작 */}
                  <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">
                    {formatDate(r.call_started_at)}
                  </td>

                  {/* 감성 */}
                  <td className={`px-3 py-2.5 font-medium whitespace-nowrap ${r.sentiment ? SENTIMENT_COLOR[r.sentiment] : 'text-gray-300'}`}>
                    {r.sentiment ? (SENTIMENT_LABEL[r.sentiment] ?? r.sentiment) : '-'}
                  </td>

                  {/* 상태 */}
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className={`px-1.5 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLOR[r.processing_status] ?? 'bg-gray-100 text-gray-500'}`}>
                      {STATUS_LABEL[r.processing_status] ?? r.processing_status}
                    </span>
                  </td>

                  {/* 요약 */}
                  <td className="px-3 py-2.5 text-gray-400 truncate overflow-hidden whitespace-nowrap">
                    {r.summary ?? <span className="text-gray-200">-</span>}
                  </td>

                  {/* 후속 조치 */}
                  <td className="px-3 py-2.5 truncate overflow-hidden whitespace-nowrap">
                    {r.action_required
                      ? <span className="text-orange-500">⚠ {r.action_memo ?? '조치 필요'}</span>
                      : <span className="text-gray-200">-</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 페이지네이션 */}
      <div className="flex justify-center gap-2 mt-4">
        <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50">
          이전
        </button>
        <span className="px-3 py-1.5 text-sm text-gray-600">{page + 1} 페이지</span>
        <button onClick={() => setPage(p => p + 1)} disabled={records.length < PAGE_SIZE}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50">
          다음
        </button>
      </div>
    </div>
  )
}
