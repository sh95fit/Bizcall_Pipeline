import { useEffect, useState, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
  type BarRectangleItem,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { getCategoryStyle } from '../lib/categoryColors'

/* ─── 타입 ─── */
interface VocRow {
  call_started_at: string | null
  category_id: string | null
  categories: { name: string } | null
}

interface VocRecord {
  id: string
  phone_name: string | null
  caller_number: string | null
  call_direction: string | null
  call_started_at: string | null
  call_ended_at: string | null
  duration_sec: number | null
  processing_status: string
  sentiment: string | null
  summary: string | null
  transcript: string | null
  keywords: string[] | null
  action_required: boolean
  action_memo: string | null
  is_permanent: boolean
  s3_key: string | null
  category_id: string | null
  categories: { name: string } | null
}

interface Category {
  id: string
  name: string
}

interface Phone {
  id: string
  name: string
}

interface ChartDatum {
  date: string
  dateISO: string
  [category: string]: string | number
}

type BarClickData = BarRectangleItem & ChartDatum

/* ─── 상수 ─── */
const CHART_COLORS = [
  '#8b5cf6', '#3b82f6', '#f43f5e', '#f59e0b',
  '#14b8a6', '#ec4899', '#06b6d4', '#84cc16',
]
const SENTIMENT_LABEL: Record<string, string> = {
  positive: '긍정', neutral: '중립', negative: '부정',
}
const SENTIMENT_COLOR: Record<string, string> = {
  positive: 'text-green-600', neutral: 'text-gray-400', negative: 'text-red-500',
}

/* ─── KST 날짜 헬퍼 (VocListPage와 동일한 로직) ─────────────────
   브라우저 로컬 timezone과 무관하게 항상 KST 기준으로 계산
   ─────────────────────────────────────────────────────────────── */
function todayKST(): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()).replace(/\. /g, '-').replace('.', '')
}

function daysAgoKST(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d).replace(/\. /g, '-').replace('.', '')
}

function thisWeekMondayKST(): string {
  const kstOffset = 9 * 60 * 60 * 1000
  const kstNow = new Date(new Date().getTime() + kstOffset)
  const day = kstNow.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  kstNow.setUTCDate(kstNow.getUTCDate() + diff)
  return kstNow.toISOString().slice(0, 10)
}

function thisMonthFirstKST(): string {
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit',
  }).formatToParts(new Date())
  const y = parts.find(p => p.type === 'year')?.value ?? ''
  const m = parts.find(p => p.type === 'month')?.value ?? ''
  return `${y}-${m}-01`
}

// ── 타임스탬프(UTC)를 KST 날짜 문자열(YYYY-MM-DD)로 변환 ─────────
// DB의 call_started_at은 TIMESTAMPTZ(UTC)로 저장되므로
// 문자열을 그대로 slice(0,10) 하면 UTC 날짜가 나옴.
// KST(한국시간) 기준 날짜로 변환해야 새벽 0~9시 통화가
// 전날로 잘못 집계되는 문제가 없어짐.
function kstDate(ts: string): string {
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(ts))
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/* ─── 포맷 유틸 ─── */
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

const formatDuration = (sec: number | null) => {
  if (sec === null) return '-'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}′${String(s).padStart(2, '0')}″`
}

/* ─── 카테고리 뱃지 ─────────────────────────────────────────────
   ID 해시 기반 HSL 색상 자동 적용 (카테고리 추가 시 코드 수정 불필요)
   ─────────────────────────────────────────────────────────────── */
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

/* ─── 복수 선택 드롭다운 (체크박스 방식) ────────────────────────
   - 아무것도 선택하지 않으면 '전체' (필터 미적용)
   - 항목을 체크하면 해당 항목들만 표시
   ─────────────────────────────────────────────────────────────── */
function MultiSelect({ allLabel, options, selected, onChange }: {
  allLabel: string
  options: { id: string; name: string }[]
  selected: string[]
  onChange: (selected: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // 드롭다운 밖을 클릭하면 닫기
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter(v => v !== id) : [...selected, id])
  }

  const buttonLabel = selected.length === 0
    ? allLabel
    : selected.length === 1
      ? options.find(o => o.id === selected[0])?.name ?? '1개 선택'
      : `${allLabel.replace(/^전체 /, '')} ${selected.length}개 선택`
  const active = selected.length > 0

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`border rounded-lg px-2.5 py-1.5 text-sm flex items-center gap-1.5 whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-green-500 ${
          active
            ? 'border-green-500 text-green-700 bg-green-50'
            : 'border-gray-300 text-gray-600 hover:bg-gray-50'
        }`}
      >
        {buttonLabel}
        <span className="text-gray-400 text-[10px]">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-56 max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg py-1">
          {/* '전체' — 클릭하면 선택 모두 해제(필터 없음) */}
          <button
            type="button"
            onClick={() => { if (selected.length > 0) onChange([]) }}
            className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-gray-50 ${
              selected.length === 0 ? 'text-green-700 font-semibold' : 'text-gray-600'
            }`}
          >
            <span className="w-4 text-center">{selected.length === 0 ? '✔' : ''}</span>
            전체
          </button>
          <div className="border-t border-gray-100 my-1" />
          {options.length === 0 && (
            <p className="px-3 py-2 text-xs text-gray-400">옵션이 없습니다</p>
          )}
          {options.map(o => {
            const checked = selected.includes(o.id)
            return (
              <button
                type="button"
                key={o.id}
                onClick={() => toggle(o.id)}
                className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-gray-50 text-gray-700"
              >
                <span className={`w-4 h-4 shrink-0 rounded border flex items-center justify-center text-[10px] ${
                  checked ? 'bg-green-600 border-green-600 text-white' : 'border-gray-300 bg-white'
                }`}>
                  {checked ? '✔' : ''}
                </span>
                <span className="truncate">{o.name}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ─── 아코디언 상세 패널 ─── */
function DetailPanel({ record, onOpenFull }: { record: VocRecord; onOpenFull: () => void }) {
  return (
    <tr>
      <td colSpan={8} className="bg-gray-50 border-b border-green-100 px-0 py-0">

        {/* 데스크탑: 2단 그리드 */}
        <div className="hidden sm:grid px-4 py-4 grid-cols-2 gap-4 text-xs">
          <div className="space-y-3">
            <div className="bg-white rounded-lg border border-gray-200 p-3 space-y-1.5">
              <p className="text-xs font-semibold text-gray-500 mb-2">통화 정보</p>
              <div className="flex justify-between">
                <span className="text-gray-400">통화 시작</span>
                <span className="text-gray-700">{formatDate(record.call_started_at)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">통화 시간</span>
                <span className="text-gray-700">{formatDuration(record.duration_sec)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">감성</span>
                <span className={record.sentiment ? SENTIMENT_COLOR[record.sentiment] : 'text-gray-300'}>
                  {record.sentiment ? (SENTIMENT_LABEL[record.sentiment] ?? record.sentiment) : '-'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">카테고리</span>
                <CategoryBadge id={record.category_id} name={record.categories?.name ?? null} />
              </div>
              {record.is_permanent && (
                <div className="flex justify-between">
                  <span className="text-gray-400">영구 저장</span>
                  <span className="text-blue-500">✔ 영구보관</span>
                </div>
              )}
            </div>
            {record.keywords && record.keywords.length > 0 && (
              <div className="bg-white rounded-lg border border-gray-200 p-3">
                <p className="text-xs font-semibold text-gray-500 mb-2">키워드</p>
                <div className="flex flex-wrap gap-1">
                  {record.keywords.map(k => (
                    <span key={k} className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full text-xs">{k}</span>
                  ))}
                </div>
              </div>
            )}
            {record.action_required && (
              <div className="bg-orange-50 rounded-lg border border-orange-100 p-3">
                <p className="text-xs font-semibold text-orange-600 mb-1">⚠ 후속 조치 필요</p>
                <p className="text-gray-700">{record.action_memo ?? '조치 내용 없음'}</p>
              </div>
            )}
          </div>
          <div className="space-y-3">
            <div className="bg-white rounded-lg border border-gray-200 p-3">
              <p className="text-xs font-semibold text-gray-500 mb-2">요약</p>
              <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
                {record.summary ?? <span className="text-gray-300">요약 없음</span>}
              </p>
            </div>
            {record.transcript && (
              <div className="bg-white rounded-lg border border-gray-200 p-3">
                <p className="text-xs font-semibold text-gray-500 mb-2">통화 내용</p>
                <p className="text-gray-600 leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto">
                  {record.transcript}
                </p>
              </div>
            )}
            <div className="flex justify-end">
              <button
                onClick={onOpenFull}
                className="text-xs text-green-700 border border-green-300 rounded-lg px-3 py-1.5 hover:bg-green-50 transition-colors"
              >
                전체 상세 보기 →
              </button>
            </div>
          </div>
        </div>

        {/* 모바일: 1단 */}
        <div className="sm:hidden px-4 py-3 space-y-2 text-xs">
          <div className="bg-white rounded-lg border border-gray-200 p-3 space-y-1.5">
            <div className="flex justify-between">
              <span className="text-gray-400">통화 시작</span>
              <span>{formatDate(record.call_started_at)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">통화 시간</span>
              <span>{formatDuration(record.duration_sec)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400">카테고리</span>
              <CategoryBadge id={record.category_id} name={record.categories?.name ?? null} />
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">감성</span>
              <span className={record.sentiment ? SENTIMENT_COLOR[record.sentiment] : 'text-gray-300'}>
                {record.sentiment ? (SENTIMENT_LABEL[record.sentiment] ?? record.sentiment) : '-'}
              </span>
            </div>
          </div>
          {record.summary && (
            <div className="bg-white rounded-lg border border-gray-200 p-3">
              <p className="font-semibold text-gray-500 mb-1">요약</p>
              <p className="text-gray-700 leading-relaxed">{record.summary}</p>
            </div>
          )}
          {record.action_required && (
            <div className="bg-orange-50 rounded-lg border border-orange-100 p-3">
              <p className="font-semibold text-orange-600 mb-1">⚠ 후속 조치</p>
              <p className="text-gray-700">{record.action_memo ?? '조치 내용 없음'}</p>
            </div>
          )}
          <div className="flex justify-end pt-1">
            <button
              onClick={onOpenFull}
              className="text-xs text-green-700 border border-green-300 rounded-lg px-3 py-1.5 hover:bg-green-50"
            >
              전체 상세 보기 →
            </button>
          </div>
        </div>

      </td>
    </tr>
  )
}

/* ─── 메인 컴포넌트 ─── */
export default function DashboardPage() {
  const navigate = useNavigate()

  // 날짜 필터 — KST 기준 이번 달 1일 ~ 오늘로 초기화
  const [dateFrom, setDateFrom]           = useState(thisMonthFirstKST)
  const [dateTo, setDateTo]               = useState(todayKST)

  // 카테고리·업무폰 필터 — 빈 배열([]) = 전체, 복수 선택 가능
  const [categoryFilter, setCategoryFilter] = useState<string[]>([])
  const [phoneFilter, setPhoneFilter]       = useState<string[]>([])
  const [categories, setCategories]         = useState<Category[]>([])
  const [phones, setPhones]                 = useState<Phone[]>([])

  const [totalVoc, setTotalVoc]           = useState(0)
  const [todayVoc, setTodayVoc]           = useState(0)
  const [activePhones, setActivePhones]   = useState(0)
  const [vocRows, setVocRows]             = useState<VocRow[]>([])
  const [loading, setLoading]             = useState(true)

  const [selectedDate, setSelectedDate]   = useState<string | null>(null)
  const [drillRecords, setDrillRecords]   = useState<VocRecord[]>([])
  const [drillLoading, setDrillLoading]   = useState(false)
  const [expandedId, setExpandedId]       = useState<string | null>(null)

  // ── 상위 카테고리 목록 로딩 (필터 드롭다운용) ─────────────
  useEffect(() => {
    supabase
      .from('categories')
      .select('id, name')
      .is('parent_id', null)
      .order('sort_order')
      .then(({ data }) => { if (data) setCategories(data) })
  }, [])

  // ── 업무폰 목록 로딩 (필터 드롭다운용) ────────────────────
  useEffect(() => {
    supabase
      .from('phones')
      .select('id, name')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => { if (data) setPhones(data as unknown as Phone[]) })
  }, [])

  // ── 드릴다운 초기화 헬퍼 ──────────────────────────────────
  const resetDrill = () => {
    setSelectedDate(null)
    setDrillRecords([])
    setExpandedId(null)
  }

  // ── 빠른 날짜 선택 프리셋 ─────────────────────────────────
  const applyPreset = (preset: 'today' | 'yesterday' | 'week' | 'month') => {
    resetDrill()
    switch (preset) {
      case 'today':     setDateFrom(todayKST());           setDateTo(todayKST());     break
      case 'yesterday': setDateFrom(daysAgoKST(1));        setDateTo(daysAgoKST(1)); break
      case 'week':      setDateFrom(thisWeekMondayKST());  setDateTo(todayKST());     break
      case 'month':     setDateFrom(thisMonthFirstKST());  setDateTo(todayKST());     break
    }
  }

  // ── 현재 선택된 프리셋 감지 (버튼 하이라이트용) ──────────
  const activePreset = (() => {
    const today      = todayKST()
    const yesterday  = daysAgoKST(1)
    const weekStart  = thisWeekMondayKST()
    const monthStart = thisMonthFirstKST()
    if (dateFrom === today      && dateTo === today)      return 'today'
    if (dateFrom === yesterday  && dateTo === yesterday)  return 'yesterday'
    if (dateFrom === weekStart  && dateTo === today)      return 'week'
    if (dateFrom === monthStart && dateTo === today)      return 'month'
    return null
  })()

  /* ── 차트·집계 fetch ─────────────────────────────────────────
     ★ 핵심 수정: Supabase는 요청 1회당 최대 1,000행까지만 반환
     (max_rows = 1000 제한). 이번 달처럼 1,000건을 넘는 기간을
     조회하면 뒤쪽 날짜(오늘 등) 데이터가 잘려나가
     "막대바는 1건, 실제 목록은 82건" 현상이 발생함.
     → 1,000건씩 나눠서(page range) 전부 조회하도록 변경.
  ───────────────────────────────────────────────────────────── */
  const fetchAllChartRows = async (build: () => any): Promise<VocRow[]> => {
    const PAGE_SIZE = 1000
    const all: VocRow[] = []
    let offset = 0
    for (;;) {
      // await 필수 — 누락 시 조회를 기다리지 않고 즉시 빈 결과로 종료되어 차트가 비어 보임
      const { data, error } = await build().range(offset, offset + PAGE_SIZE - 1)
      if (error) { console.error('차트 fetch 오류:', error); break }
      if (!data || data.length === 0) break
      all.push(...(data as unknown as VocRow[]))
      if (data.length < PAGE_SIZE) break   // 마지막 페이지 도달
      offset += PAGE_SIZE
    }
    return all
  }

  const fetchData = async () => {
    setLoading(true)
    const fromISO  = `${dateFrom}T00:00:00+09:00`
    const toISO    = `${dateTo}T23:59:59+09:00`
    const todayStr = todayKST()
    const todayISO    = `${todayStr}T00:00:00+09:00`
    const todayEndISO = `${todayStr}T23:59:59+09:00`

    // 카테고리·업무폰 필터가 적용된 기본 쿼리 빌더 (count 조회용)
    const baseQuery = () => {
      let q = supabase.from('voc_records')
        .select('*', { count: 'exact', head: true })
        .eq('is_deleted', false)
        .gte('call_started_at', fromISO)
        .lte('call_started_at', toISO)
      if (categoryFilter.length > 0) q = q.in('category_id', categoryFilter)
      if (phoneFilter.length > 0)    q = q.in('phone_id', phoneFilter)
      return q
    }

    // 오늘 VOC (활성 업무폰 전체 현황 지표)
    const todayQuery = () => {
      let q = supabase.from('voc_records')
        .select('*', { count: 'exact', head: true })
        .eq('is_deleted', false)
        .gte('call_started_at', todayISO)
        .lte('call_started_at', todayEndISO)
      if (categoryFilter.length > 0) q = q.in('category_id', categoryFilter)
      if (phoneFilter.length > 0)    q = q.in('phone_id', phoneFilter)
      return q
    }

    const [
      { count: tv },
      { count: tov },
      { count: ap },
      rows,
    ] = await Promise.all([
      baseQuery(),
      todayQuery(),
      supabase.from('phones')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true),
      // 차트용 rows — 1,000행 제한 우회를 위해 페이지네이션으로 전체 조회
      fetchAllChartRows(() => {
        let q = supabase.from('voc_records')
          .select('call_started_at, category_id, categories!voc_records_category_id_fkey(name)')
          .eq('is_deleted', false)
          .order('call_started_at', { ascending: true })   // 페이지네이션 순서 안정화
          .gte('call_started_at', fromISO)
          .lte('call_started_at', toISO)
        if (categoryFilter.length > 0) q = q.in('category_id', categoryFilter)
        if (phoneFilter.length > 0)    q = q.in('phone_id', phoneFilter)
        return q
      }),
    ])

    setTotalVoc(tv ?? 0)
    setTodayVoc(tov ?? 0)
    setActivePhones(ap ?? 0)
    setVocRows(rows)
    setLoading(false)
  }

  // 날짜 또는 카테고리 필터 변경 시 드릴다운 초기화 후 재조회
  useEffect(() => {
    resetDrill()
    fetchData()
  }, [dateFrom, dateTo, categoryFilter])

  /* ── 드릴다운 fetch (카테고리 필터 적용) ── */
  const fetchDrillDown = async (dateISO: string) => {
    setDrillLoading(true)
    setExpandedId(null)
    let query = supabase
      .from('voc_records')
      .select(
        'id,phone_name,caller_number,call_direction,call_started_at,call_ended_at,' +
        'duration_sec,processing_status,sentiment,summary,transcript,keywords,' +
        'action_required,action_memo,is_permanent,s3_key,' +
        'category_id,categories!voc_records_category_id_fkey(name)'
      )
      .eq('is_deleted', false)
      .gte('call_started_at', `${dateISO}T00:00:00+09:00`)
      .lte('call_started_at', `${dateISO}T23:59:59+09:00`)
      .order('call_started_at', { ascending: false })
    if (categoryFilter.length > 0) query = query.in('category_id', categoryFilter)
    if (phoneFilter.length > 0)    query = query.in('phone_id', phoneFilter)
    const { data, error } = await query
    if (!error && data) setDrillRecords(data as unknown as VocRecord[])
    setDrillLoading(false)
  }

  /* ── 차트 막대 클릭 ── */
  const handleBarClick = (data: BarRectangleItem) => {
    const d = data as unknown as BarClickData
    if (!d?.dateISO) return
    if (selectedDate === d.dateISO) {
      resetDrill()
    } else {
      setSelectedDate(d.dateISO)
      fetchDrillDown(d.dateISO)
    }
  }

  const handleRowClick = (id: string) => {
    setExpandedId(prev => prev === id ? null : id)
  }

  /* ── 차트 데이터 가공 ── */
  const { chartData, categoryKeys } = useMemo(() => {
    const dateMap: Record<string, Record<string, number | string>> = {}
    const catSet = new Set<string>()

    vocRows.forEach(row => {
      if (!row.call_started_at) return
      // ★ 핵심 수정: DB에는 UTC 시간이 저장되므로 문자열을 그대로
      // slice(0,10) 하면 UTC 날짜 기준으로 묶임(새벽 0~9시 통화가
      // 전날로 집계되는 버그). KST 기준 날짜로 변환해서 집계.
      const iso     = kstDate(row.call_started_at)
      const label   = `${iso.slice(5, 7)}/${iso.slice(8, 10)}`
      const catName = row.categories?.name ?? '미분류'
      catSet.add(catName)
      if (!dateMap[iso]) dateMap[iso] = { __label: label }
      dateMap[iso][catName] = ((dateMap[iso][catName] as number) ?? 0) + 1
    })

    const sorted = Object.entries(dateMap).sort(([a], [b]) => a.localeCompare(b))
    const keys   = Array.from(catSet)
    const data: ChartDatum[] = sorted.map(([iso, vals]) => ({
      date:    vals.__label as string,
      dateISO: iso,
      ...Object.fromEntries(keys.map(k => [k, (vals[k] as number) ?? 0])),
    }))
    return { chartData: data, categoryKeys: keys }
  }, [vocRows])

  // 카테고리·업무폰 필터 라벨 (요약 카드·드릴다운 헤더 표시용)
  const catLabel = categoryFilter.length === 0
    ? null
    : categoryFilter.length === 1
      ? categories.find(c => c.id === categoryFilter[0])?.name ?? null
      : `카테고리 ${categoryFilter.length}종`
  const phoneLabel = phoneFilter.length === 0
    ? null
    : phoneFilter.length === 1
      ? phones.find(p => p.id === phoneFilter[0])?.name ?? null
      : `업무폰 ${phoneFilter.length}대`
  const activeFilterLabel = [catLabel, phoneLabel].filter(Boolean).join(' · ') || null

    const cards = [
      {
        label: activeFilterLabel ? `기간 내 VOC (${activeFilterLabel})` : '기간 내 전체 VOC',
        value: totalVoc,
        unit: '건',
        color: 'text-gray-800',
      },
      {
        label: catLabel ? `오늘 VOC (${catLabel})` : '오늘 VOC',
        value: todayVoc,
        unit: '건',
        color: 'text-blue-600',
      },
      {
        label: '활성 업무폰',
        value: activePhones,
        unit: '대',
        color: 'text-green-600',
      },
    ]

  const PRESETS = [
    { label: '오늘',    preset: 'today'     },
    { label: '어제',    preset: 'yesterday' },
    { label: '이번 주', preset: 'week'      },
    { label: '이번 달', preset: 'month'     },
  ] as const

  return (
    <div>
      {/* ── 헤더 ── */}
      <h2 className="text-xl font-bold text-gray-800 mb-4">대시보드</h2>

      {/* ════════════════════════════════════════════════════════
          필터 박스
          - 데스크탑(sm↑): 프리셋 버튼 + 날짜 입력 + 카테고리를 한 줄로
          - 모바일(sm↓):   프리셋 버튼 한 줄 → 날짜+카테고리 두 번째 줄
          ════════════════════════════════════════════════════════ */}
      <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 mb-6 flex flex-col sm:flex-row sm:items-center gap-3">

        {/* 프리셋 버튼 그룹 */}
        <div className="flex gap-1.5 shrink-0">
          {PRESETS.map(({ label, preset }) => (
            <button
              key={preset}
              onClick={() => applyPreset(preset)}
              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors whitespace-nowrap ${
                activePreset === preset
                  ? 'bg-green-600 text-white border-green-600'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 구분선 — 데스크탑만 표시 */}
        <div className="hidden sm:block h-5 w-px bg-gray-200 shrink-0" />

        {/* 날짜 직접 입력 + 카테고리 필터 */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={e => { setDateFrom(e.target.value); resetDrill() }}
            className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <span className="text-gray-400 text-sm shrink-0">~</span>
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={e => { setDateTo(e.target.value); resetDrill() }}
            className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />

          {/* 구분선 — 데스크탑만 표시 */}
          <div className="hidden sm:block h-5 w-px bg-gray-200 shrink-0" />

          {/* 카테고리 필터 (상위 카테고리, 복수 선택 가능) */}
          <MultiSelect
            allLabel="전체 카테고리"
            options={categories}
            selected={categoryFilter}
            onChange={setCategoryFilter}
          />
          {/* 업무폰 필터 (복수 선택 가능) */}
          <MultiSelect
            allLabel="전체 업무폰"
            options={phones}
            selected={phoneFilter}
            onChange={setPhoneFilter}
          />
        </div>
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm">불러오는 중...</p>
      ) : (
        <>
          {/* ── 요약 카드 ── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
            {cards.map(({ label, value, unit, color }) => (
              <div key={label} className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
                <p className="text-xs text-gray-500 mb-1">{label}</p>
                <p className={`text-3xl font-bold ${color}`}>
                  {value.toLocaleString()}
                  <span className="text-sm font-normal text-gray-400 ml-1">{unit}</span>
                </p>
              </div>
            ))}
          </div>

          {/* ── 차트 ── */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5 mb-4">
            <p className="text-sm font-semibold text-gray-700 mb-1">
              일자별 · 카테고리별 VOC 현황
            </p>
            <p className="text-xs text-gray-400 mb-4">
              막대 클릭 → 목록 펼치기 &nbsp;|&nbsp; 목록 행 클릭 → 상세 내용 펼치기
            </p>
            {chartData.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-10">해당 기간에 VOC 데이터가 없습니다.</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={chartData}
                  margin={{ top: 4, right: 8, left: 0, bottom: 4 }}
                  style={{ cursor: 'pointer' }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value, name) => [value, name]} contentStyle={{ fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {categoryKeys.map((cat, i) => (
                    <Bar
                      key={cat}
                      dataKey={cat}
                      stackId="a"
                      fill={CHART_COLORS[i % CHART_COLORS.length]}
                      onClick={handleBarClick}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* ── 드릴다운 패널 ── */}
          {selectedDate && (
            <div className="bg-white rounded-xl border border-green-200 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-4 sm:px-5 py-3 bg-green-50 border-b border-green-100">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-green-800">
                    📋 {selectedDate.slice(5, 7)}/{selectedDate.slice(8, 10)} VOC 목록
                  </span>
                  {!drillLoading && (
                    <span className="text-xs text-green-600 bg-green-100 px-2 py-0.5 rounded-full">
                      {drillRecords.length}건
                    </span>
                  )}
                  {/* 카테고리·업무폰 필터 활성 시 표시 */}
                  {activeFilterLabel && (
                    <span className="text-xs text-gray-400">
                      · {activeFilterLabel} 필터 적용 중
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => navigate(`/voc?date=${selectedDate}`)}
                    className="hidden sm:inline text-xs text-green-700 underline hover:text-green-900"
                  >
                    전체 페이지로 보기 →
                  </button>
                  <button
                    onClick={resetDrill}
                    className="text-gray-400 hover:text-gray-600 text-lg leading-none"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {drillLoading ? (
                <p className="text-gray-400 text-sm text-center py-8">불러오는 중...</p>
              ) : drillRecords.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-8">해당 날짜의 VOC가 없습니다.</p>
              ) : (
                <>
                  {/* 데스크탑: 테이블 */}
                  <div className="hidden sm:block">
                    <table className="w-full text-xs table-fixed">
                      <colgroup>
                        <col style={{ width: '2%' }} />
                        <col style={{ width: '8%' }} />
                        <col style={{ width: '11%' }} />
                        <col style={{ width: '5%' }} />
                        <col style={{ width: '9%' }} />
                        <col style={{ width: '5%' }} />
                        <col style={{ width: '8%' }} />
                        <col style={{ width: '52%' }} />
                      </colgroup>
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th />
                          {['업무폰', '발신번호', '방향', '통화시작', '감성', '카테고리', '요약'].map(h => (
                            <th key={h} className="text-left px-3 py-2 text-xs font-medium text-gray-500 whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {drillRecords.map(r => (
                          <>
                            <tr
                              key={r.id}
                              onClick={() => handleRowClick(r.id)}
                              className={`cursor-pointer transition-colors ${expandedId === r.id ? 'bg-green-50' : 'hover:bg-gray-50'}`}
                            >
                              <td className="px-2 py-2.5 text-center text-gray-300">
                                <span className={`inline-block transition-transform duration-200 ${expandedId === r.id ? 'rotate-90' : ''}`}>▶</span>
                              </td>
                              <td className="px-3 py-2.5 text-gray-700 truncate overflow-hidden whitespace-nowrap">{r.phone_name ?? '-'}</td>
                              <td className="px-3 py-2.5 font-mono text-gray-600 whitespace-nowrap">{r.caller_number ?? '-'}</td>
                              <td className="px-3 py-2.5 whitespace-nowrap">
                                {r.call_direction === 'incoming'
                                  ? <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-500">수신</span>
                                  : r.call_direction === 'outgoing'
                                  ? <span className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-500">발신</span>
                                  : <span className="text-gray-300">-</span>}
                              </td>
                              <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{formatDate(r.call_started_at)}</td>
                              <td className={`px-3 py-2.5 font-medium whitespace-nowrap ${r.sentiment ? SENTIMENT_COLOR[r.sentiment] : 'text-gray-300'}`}>
                                {r.sentiment ? (SENTIMENT_LABEL[r.sentiment] ?? r.sentiment) : '-'}
                              </td>
                              <td className="px-3 py-2.5 whitespace-nowrap">
                                <CategoryBadge id={r.category_id} name={r.categories?.name ?? null} />
                              </td>
                              <td className="px-3 py-2.5 text-gray-400 truncate overflow-hidden whitespace-nowrap">
                                {r.summary ?? <span className="text-gray-200">-</span>}
                              </td>
                            </tr>
                            {expandedId === r.id && (
                              <DetailPanel
                                key={`detail-${r.id}`}
                                record={r}
                                onOpenFull={() => navigate(`/voc/${r.id}`)}
                              />
                            )}
                          </>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* 모바일: 카드 리스트 */}
                  <div className="sm:hidden divide-y divide-gray-100">
                    {drillRecords.map(r => (
                      <>
                        <div key={r.id}
                          onClick={() => handleRowClick(r.id)}
                          className={`p-4 cursor-pointer ${expandedId === r.id ? 'bg-green-50' : 'active:bg-gray-50'}`}>
                          <div className="flex items-center gap-2 mb-1.5">
                            <CategoryBadge id={r.category_id} name={r.categories?.name ?? null} />
                            {r.sentiment && (
                              <span className={`text-xs font-medium ${SENTIMENT_COLOR[r.sentiment]}`}>
                                {SENTIMENT_LABEL[r.sentiment]}
                              </span>
                            )}
                            <span className="ml-auto text-xs text-gray-400">{formatDate(r.call_started_at)}</span>
                          </div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-mono text-sm font-semibold text-gray-800">{r.caller_number ?? '-'}</span>
                            {r.call_direction === 'incoming'
                              ? <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-500 text-xs">수신</span>
                              : r.call_direction === 'outgoing'
                              ? <span className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-500 text-xs">발신</span>
                              : null}
                            {r.phone_name && <span className="text-xs text-gray-400 truncate">{r.phone_name}</span>}
                          </div>
                          {r.summary && <p className="text-xs text-gray-500 line-clamp-2">{r.summary}</p>}
                        </div>
                        {expandedId === r.id && (
                          <DetailPanel
                            key={`detail-${r.id}`}
                            record={r}
                            onOpenFull={() => navigate(`/voc/${r.id}`)}
                          />
                        )}
                      </>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
