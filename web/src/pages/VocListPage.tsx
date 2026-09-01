import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getCategoryStyle } from '../lib/categoryColors'

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

const PAGE_SIZE = 20

// ── KST 기준 오늘 날짜 문자열 반환 (YYYY-MM-DD) ──────────────
function todayKST(): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()).replace(/\. /g, '-').replace('.', '')
}

// ── KST 기준 N일 전 날짜 문자열 반환 ─────────────────────────
function daysAgoKST(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d).replace(/\. /g, '-').replace('.', '')
}

// ── KST 기준 이번 주 월요일 날짜 반환 ────────────────────────
function thisWeekMondayKST(): string {
  const d = new Date()
  // KST 기준 요일 계산 (일=0, 월=1, ..., 토=6)
  const kstOffset = 9 * 60 * 60 * 1000
  const kstNow = new Date(d.getTime() + kstOffset)
  const day = kstNow.getUTCDay()           // 0(일)~6(토)
  const diff = day === 0 ? -6 : 1 - day   // 월요일까지의 차이
  kstNow.setUTCDate(kstNow.getUTCDate() + diff)
  return kstNow.toISOString().slice(0, 10)
}

// ── KST 기준 이번 달 1일 ──────────────────────────────────────
function thisMonthFirstKST(): string {
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit',
  }).formatToParts(new Date())
  const y = parts.find(p => p.type === 'year')?.value ?? ''
  const m = parts.find(p => p.type === 'month')?.value ?? ''
  return `${y}-${m}-01`
}

// ── 카테고리 뱃지 ──────────────────────────────────────────────
// ID 해시 기반 HSL 색상 자동 적용 (카테고리 추가 시 코드 수정 불필요)
function CategoryBadge({ id, name }: { id: string | null; name: string | null }) {
  if (!id || !name) return <span className="text-gray-300">-</span>
  return (
    <span
      className="px-1.5 py-0.5 rounded-full text-xs font-medium"
      style={getCategoryStyle(id)}
    >
      {name}
    </span>
  )
}

export default function VocListPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const dateParam = searchParams.get('date')   // 대시보드 드릴다운용

  const [records, setRecords]               = useState<VocRecord[]>([])
  const [categories, setCategories]         = useState<Category[]>([])
  const [loading, setLoading]               = useState(true)
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [sentimentFilter, setSentimentFilter] = useState('all')
  const [searchText, setSearchText]         = useState('')
  const [page, setPage]                     = useState(0)

  // ── 날짜 필터 상태 ────────────────────────────────────────────
  // dateFrom ~ dateTo 범위. 단일 날짜는 dateFrom === dateTo 로 처리
  const [dateFrom, setDateFrom] = useState<string>('')   // YYYY-MM-DD
  const [dateTo, setDateTo]     = useState<string>('')   // YYYY-MM-DD

  // ── 모바일 필터 토글 ──────────────────────────────────────────
  const [filterOpen, setFilterOpen] = useState(false)

  // ── 대시보드 드릴다운: ?date=YYYY-MM-DD → 단일 날짜 세팅 ─────
  useEffect(() => {
    if (dateParam) {
      setDateFrom(dateParam)
      setDateTo(dateParam)
      // URL 파라미터는 상태로 흡수 후 제거 (이중 관리 방지)
      setSearchParams({})
    }
  }, [dateParam])

  // 상위 카테고리 목록 로딩 (필터 드롭다운용)
  useEffect(() => {
    supabase
      .from('categories')
      .select('id, name')
      .is('parent_id', null)
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
    if (searchText.trim())         query = query.ilike('caller_number', `%${searchText.trim()}%`)

    // +09:00 offset 명시 → PostgreSQL이 KST 범위로 정확히 해석
    if (dateFrom) query = query.gte('call_started_at', `${dateFrom}T00:00:00+09:00`)
    if (dateTo)   query = query.lte('call_started_at', `${dateTo}T23:59:59+09:00`)

    const { data, error } = await query
    if (!error && data) setRecords(data as unknown as VocRecord[])
    setLoading(false)
  }

  // 필터 변경 시 페이지 초기화
  useEffect(() => {
    setPage(0)
  }, [categoryFilter, sentimentFilter, searchText, dateFrom, dateTo])

  useEffect(() => {
    fetchRecords()
  }, [page, categoryFilter, sentimentFilter, searchText, dateFrom, dateTo])

  // ── 빠른 날짜 선택 프리셋 ─────────────────────────────────────
  const applyPreset = (preset: 'today' | 'yesterday' | 'week' | 'month' | 'all') => {
    switch (preset) {
      case 'today':
        setDateFrom(todayKST()); setDateTo(todayKST()); break
      case 'yesterday':
        setDateFrom(daysAgoKST(1)); setDateTo(daysAgoKST(1)); break
      case 'week':
        setDateFrom(thisWeekMondayKST()); setDateTo(todayKST()); break
      case 'month':
        setDateFrom(thisMonthFirstKST()); setDateTo(todayKST()); break
      case 'all':
        setDateFrom(''); setDateTo(''); break
    }
  }

  // ── 날짜 필터 활성화 여부 (배지 표시용) ──────────────────────
  const dateActive = !!(dateFrom || dateTo)

  // ── 날짜 표시 레이블 (헤더 배지용) ───────────────────────────
  const dateBadgeLabel = () => {
    if (dateFrom && dateTo && dateFrom === dateTo) return dateFrom
    if (dateFrom && dateTo) return `${dateFrom} ~ ${dateTo}`
    if (dateFrom) return `${dateFrom} 이후`
    if (dateTo)   return `${dateTo} 이전`
    return ''
  }

  // Intl.DateTimeFormat 사용 → 브라우저 timezone과 무관하게 KST 기준 표시
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
      {/* ── 헤더 ── */}
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-xl font-bold text-gray-800">VOC 목록</h2>
        {/* 날짜 필터 활성 시 배지 표시 */}
        {dateActive && (
          <span className="text-xs text-blue-600 bg-blue-50 px-2.5 py-0.5 rounded-full flex items-center gap-1">
            {dateBadgeLabel()}
            <button
              onClick={() => applyPreset('all')}
              className="text-blue-300 hover:text-blue-500 ml-0.5"
              aria-label="날짜 필터 초기화"
            >✕</button>
          </span>
        )}
        {/* 모바일: 필터 토글 버튼 */}
        <button
          onClick={() => setFilterOpen(v => !v)}
          className="sm:hidden ml-auto flex items-center gap-1 text-xs text-gray-500 border border-gray-300 rounded-lg px-2.5 py-1.5 hover:bg-gray-50"
        >
          🔍 필터 {filterOpen ? '▲' : '▼'}
        </button>
      </div>

      {/* ── 필터 영역 ──
          - 데스크탑(sm 이상): 항상 표시
          - 모바일: filterOpen 상태에 따라 토글
      ── */}
      <div className={`${filterOpen ? 'flex' : 'hidden'} sm:flex flex-col gap-3 mb-4`}>

        {/* 1행: 발신번호 검색 + 카테고리 + 감성 */}
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            placeholder="발신번호 검색..."
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full sm:w-40 focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          {/* 카테고리 필터 (상위 카테고리) */}
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-2 text-sm w-full sm:w-auto focus:outline-none focus:ring-2 focus:ring-green-500"
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
            className="border border-gray-300 rounded-lg px-2 py-2 text-sm w-full sm:w-auto focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            <option value="all">전체 감성</option>
            <option value="positive">긍정</option>
            <option value="neutral">중립</option>
            <option value="negative">부정</option>
          </select>
        </div>

        {/* 2행: 날짜 필터 */}
        <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
          {/* 빠른 선택 프리셋 버튼 */}
          <div className="flex flex-wrap gap-1.5">
            {([
              { label: '오늘',      preset: 'today'     },
              { label: '어제',      preset: 'yesterday' },
              { label: '이번 주',   preset: 'week'      },
              { label: '이번 달',   preset: 'month'     },
              { label: '전체',      preset: 'all'       },
            ] as const).map(({ label, preset }) => (
              <button
                key={preset}
                onClick={() => applyPreset(preset)}
                className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                  preset === 'all' && !dateActive
                    ? 'bg-green-600 text-white border-green-600'          // 전체 선택 상태
                    : preset === 'today' && dateFrom === todayKST() && dateTo === todayKST()
                    ? 'bg-green-600 text-white border-green-600'
                    : preset === 'yesterday' && dateFrom === daysAgoKST(1) && dateTo === daysAgoKST(1)
                    ? 'bg-green-600 text-white border-green-600'
                    : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* 구분선 */}
          <div className="hidden sm:block h-4 w-px bg-gray-200" />

          {/* 직접 날짜 입력 */}
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={e => setDateFrom(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <span className="text-gray-400 text-sm shrink-0">~</span>
            <input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={e => setDateTo(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
        </div>
      </div>

      {/* ── 콘텐츠 ── */}
      {loading ? (
        <p className="text-gray-400 text-sm">불러오는 중...</p>
      ) : records.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-12">데이터가 없습니다</p>
      ) : (
        <>
          {/* 데스크탑: 테이블 */}
          <div className="hidden sm:block bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-xs table-fixed">
              <colgroup>
                <col style={{ width: '8%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '5%' }} />
                <col style={{ width: '9%' }} />
                <col style={{ width: '5%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '34%' }} />
                <col style={{ width: '20%' }} />
              </colgroup>
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['업무폰', '발신번호', '방향', '통화시작', '감성', '카테고리', '요약', '후속 조치'].map(h => (
                    <th key={h} className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {records.map(r => (
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
                    {/* 카테고리 컬럼 (상위 카테고리) — HSL 해시 색상 자동 적용 */}
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <CategoryBadge id={r.category_id} name={r.categories?.name ?? null} />
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

          {/* 모바일: 카드 리스트 */}
          <div className="sm:hidden space-y-2">
            {records.map(r => (
              <div key={r.id}
                onClick={() => navigate(`/voc/${r.id}`)}
                className="bg-white rounded-xl border border-gray-200 p-4 cursor-pointer active:bg-gray-50">
                <div className="flex items-center gap-2 mb-2">
                  <CategoryBadge id={r.category_id} name={r.categories?.name ?? null} />
                  {r.sentiment && (
                    <span className={`text-xs font-medium ${SENTIMENT_COLOR[r.sentiment]}`}>
                      {SENTIMENT_LABEL[r.sentiment]}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-gray-400">{formatDate(r.call_started_at)}</span>
                </div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="font-mono text-sm font-semibold text-gray-800">{r.caller_number ?? '-'}</span>
                  {r.call_direction === 'incoming'
                    ? <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-500 text-xs">수신</span>
                    : r.call_direction === 'outgoing'
                    ? <span className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-500 text-xs">발신</span>
                    : null}
                  {r.phone_name && (
                    <span className="text-xs text-gray-400 truncate">{r.phone_name}</span>
                  )}
                </div>
                {r.summary && (
                  <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">{r.summary}</p>
                )}
                {r.action_required && (
                  <div className="mt-2 text-xs text-orange-500">⚠ {r.action_memo ?? '조치 필요'}</div>
                )}
              </div>
            ))}
          </div>
        </>
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
