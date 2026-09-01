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
  category_id: string | null
  categories: { name: string } | null   // 상위 카테고리 조인
}

interface Category {
  id: string
  name: string
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

  const [records, setRecords]               = useState<VocRecord[]>([])
  const [categories, setCategories]         = useState<Category[]>([])
  const [loading, setLoading]               = useState(true)
  const [categoryFilter, setCategoryFilter] = useState('all')   // 상태 필터 → 카테고리 필터
  const [sentimentFilter, setSentimentFilter] = useState('all')
  const [searchText, setSearchText]         = useState('')
  const [page, setPage]                     = useState(0)
  const PAGE_SIZE = 20

  // 상위 카테고리 목록 로딩 (필터 드롭다운용)
  useEffect(() => {
    supabase
      .from('categories')
      .select('id, name')
      .is('parent_id', null)    // 상위 카테고리만
      .order('sort_order')
      .then(({ data }) => { if (data) setCategories(data) })
  }, [])

  const fetchRecords = async () => {
    setLoading(true)
    let query = supabase
      .from('voc_records')
      .select(
        'id,phone_name,caller_number,call_direction,call_started_at,' +
        'processing_status,sentiment,summary,action_required,action_memo,' +
        'category_id,categories!voc_records_category_id_fkey(name)'
      )
      .eq('is_deleted', false)
      .order('call_started_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (categoryFilter !== 'all') query = query.eq('category_id', categoryFilter)
    if (sentimentFilter !== 'all') query = query.eq('sentiment', sentimentFilter)
    if (searchText.trim()) query = query.ilike('caller_number', `%${searchText.trim()}%`)

    if (dateParam) {
      query = query
        .gte('call_started_at', `${dateParam}T00:00:00+09:00`)
        .lte('call_started_at', `${dateParam}T23:59:59+09:00`)
    }

    const { data, error } = await query
    if (!error && data) setRecords(data as unknown as VocRecord[])
    setLoading(false)
  }

  useEffect(() => { setPage(0) }, [categoryFilter, sentimentFilter, searchText, dateParam])
  useEffect(() => { fetchRecords() }, [page, categoryFilter, sentimentFilter, searchText, dateParam])

  const formatDate = (str: string | null) => {
    if (!str) return '-'
    const d = new Date(str)
    const parts = new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
      hour12: false,
    }).formatToParts(d)
    const get = (type: string) => parts.find(p => p.type === type)?.value ?? '00'
    return `${get('month')}/${get('day')} ${get('hour')}:${get('minute')}`
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
        {/* 카테고리 필터 (상위 카테고리) */}
        <select
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
        >
          <option value="all">전체 카테고리</option>
          {categories.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        {/* 감성 필터 */}
        <select
          value={sentimentFilter}
          onChange={e => setSentimentFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
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
          <table className="w-full text-xs table-fixed">
            <colgroup>
              <col style={{ width: '8%' }} />   {/* 업무폰 */}
              <col style={{ width: '11%' }} />  {/* 발신번호 */}
              <col style={{ width: '5%' }} />   {/* 방향 */}
              <col style={{ width: '9%' }} />   {/* 통화시작 */}
              <col style={{ width: '5%' }} />   {/* 감성 */}
              <col style={{ width: '8%' }} />   {/* 카테고리 */}
              <col style={{ width: '34%' }} />  {/* 요약 */}
              <col style={{ width: '20%' }} />  {/* 후속 조치 */}
            </colgroup>
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['업무폰', '발신번호', '방향', '통화시작', '감성', '카테고리', '요약', '후속 조치'].map(h => (
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
                  <td className="px-3 py-2.5 text-gray-700 truncate overflow-hidden whitespace-nowrap">
                    {r.phone_name ?? '-'}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-gray-600 whitespace-nowrap">
                    {r.caller_number ?? '-'}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {r.call_direction === 'incoming'
                      ? <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-500">수신</span>
                      : r.call_direction === 'outgoing'
                      ? <span className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-500">발신</span>
                      : <span className="text-gray-300">-</span>}
                  </td>
                  <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">
                    {formatDate(r.call_started_at)}
                  </td>
                  <td className={`px-3 py-2.5 font-medium whitespace-nowrap ${r.sentiment ? SENTIMENT_COLOR[r.sentiment] : 'text-gray-300'}`}>
                    {r.sentiment ? (SENTIMENT_LABEL[r.sentiment] ?? r.sentiment) : '-'}
                  </td>
                  {/* 카테고리 컬럼 (상위 카테고리) */}
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {r.categories?.name
                      ? <span className="px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600 text-xs">
                          {r.categories.name}
                        </span>
                      : <span className="text-gray-300">-</span>}
                  </td>
                  <td className="px-3 py-2.5 text-gray-400 truncate overflow-hidden whitespace-nowrap">
                    {r.summary ?? <span className="text-gray-200">-</span>}
                  </td>
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
