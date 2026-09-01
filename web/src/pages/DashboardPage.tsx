import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
  type BarRectangleItem,
} from 'recharts'
import { supabase } from '../lib/supabase'

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
  category_id: string | null                  // 추가
  categories: { name: string } | null         // 추가
}

interface ChartDatum {
  date: string
  dateISO: string
  [category: string]: string | number
}

type BarClickData = BarRectangleItem & ChartDatum

/* ─── 상수 ─── */
const COLORS = [
  '#4ade80', '#60a5fa', '#f97316', '#a78bfa',
  '#fb7185', '#facc15', '#34d399', '#38bdf8',
]
const SENTIMENT_LABEL: Record<string, string> = {
  positive: '긍정', neutral: '중립', negative: '부정',
}
const SENTIMENT_COLOR: Record<string, string> = {
  positive: 'text-green-600', neutral: 'text-gray-400', negative: 'text-red-500',
}

const getDefaultRange = () => {
  const now  = new Date()
  const from = new Date(now.getFullYear(), now.getMonth(), 1)
  return {
    from: from.toISOString().slice(0, 10),
    to:   now.toISOString().slice(0, 10),
  }
}

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

/* ─── 아코디언 상세 패널 ─── */
function DetailPanel({ record, onOpenFull }: { record: VocRecord; onOpenFull: () => void }) {
  return (
    <tr>
      <td colSpan={8} className="bg-gray-50 border-b border-green-100 px-0 py-0">
        <div className="px-4 py-4 grid grid-cols-2 gap-4 text-xs">

          {/* 왼쪽: 통화 정보 + 키워드 + 후속조치 */}
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
              {/* 카테고리 (상위) */}
              <div className="flex justify-between">
                <span className="text-gray-400">카테고리</span>
                <span className="text-indigo-600">
                  {record.categories?.name ?? '-'}
                </span>
              </div>
              {record.is_permanent && (
                <div className="flex justify-between">
                  <span className="text-gray-400">영구 저장</span>
                  <span className="text-blue-500">✔ 영구보관</span>
                </div>
              )}
            </div>

            {/* 키워드 */}
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

            {/* 후속 조치 */}
            {record.action_required && (
              <div className="bg-orange-50 rounded-lg border border-orange-100 p-3">
                <p className="text-xs font-semibold text-orange-600 mb-1">⚠ 후속 조치 필요</p>
                <p className="text-gray-700">{record.action_memo ?? '조치 내용 없음'}</p>
              </div>
            )}
          </div>

          {/* 오른쪽: 요약 + 스크립트 */}
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
      </td>
    </tr>
  )
}

/* ─── 메인 컴포넌트 ─── */
export default function DashboardPage() {
  const navigate = useNavigate()
  const def = getDefaultRange()

  const [dateFrom, setDateFrom]         = useState(def.from)
  const [dateTo, setDateTo]             = useState(def.to)
  const [totalVoc, setTotalVoc]         = useState(0)
  const [todayVoc, setTodayVoc]         = useState(0)
  const [activePhones, setActivePhones] = useState(0)
  const [vocRows, setVocRows]           = useState<VocRow[]>([])
  const [loading, setLoading]           = useState(true)

  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [drillRecords, setDrillRecords] = useState<VocRecord[]>([])
  const [drillLoading, setDrillLoading] = useState(false)
  const [expandedId, setExpandedId]     = useState<string | null>(null)

  /* ── 차트·집계 fetch ── */
  const fetchData = async () => {
    setLoading(true)
    const fromISO  = `${dateFrom} 00:00:00`
    const toISO    = `${dateTo} 23:59:59`
    const todayStr = new Date().toISOString().slice(0, 10)
    const todayISO = `${todayStr} 00:00:00`

    const [
      { count: tv },
      { count: tov },
      { count: ap },
      { data: rows, error: chartError },
    ] = await Promise.all([
      supabase.from('voc_records')
        .select('*', { count: 'exact', head: true })
        .eq('is_deleted', false)
        .gte('call_started_at', fromISO)
        .lte('call_started_at', toISO),
      supabase.from('voc_records')
        .select('*', { count: 'exact', head: true })
        .eq('is_deleted', false)
        .gte('call_started_at', todayISO),
      supabase.from('phones')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true),
      supabase.from('voc_records')
        .select('call_started_at, category_id, categories!voc_records_category_id_fkey(name)')
        .eq('is_deleted', false)
        .gte('call_started_at', fromISO)
        .lte('call_started_at', toISO),
    ])

    if (chartError) console.error('차트 fetch 오류:', chartError)
    setTotalVoc(tv ?? 0)
    setTodayVoc(tov ?? 0)
    setActivePhones(ap ?? 0)
    setVocRows((rows as unknown as VocRow[]) ?? [])
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [dateFrom, dateTo])

  /* ── 드릴다운 fetch: categories 조인 추가 ── */
  const fetchDrillDown = async (dateISO: string) => {
    setDrillLoading(true)
    setExpandedId(null)
    const { data, error } = await supabase
      .from('voc_records')
      .select(
        'id,phone_name,caller_number,call_direction,call_started_at,call_ended_at,' +
        'duration_sec,processing_status,sentiment,summary,transcript,keywords,' +
        'action_required,action_memo,is_permanent,s3_key,' +
        'category_id,categories!voc_records_category_id_fkey(name)'   // 추가
      )
      .eq('is_deleted', false)
      .gte('call_started_at', `${dateISO} 00:00:00`)
      .lte('call_started_at', `${dateISO} 23:59:59`)
      .order('call_started_at', { ascending: false })
    if (!error && data) setDrillRecords(data as unknown as VocRecord[])
    setDrillLoading(false)
  }

  /* ── 차트 막대 클릭 ── */
  const handleBarClick = (data: BarRectangleItem) => {
    const d = data as unknown as BarClickData
    if (!d?.dateISO) return
    if (selectedDate === d.dateISO) {
      setSelectedDate(null)
      setDrillRecords([])
      setExpandedId(null)
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
      const iso     = row.call_started_at.slice(0, 10)
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

  const cards = [
    { label: '기간 내 전체 VOC', value: totalVoc,     unit: '건', color: 'text-gray-800' },
    { label: '오늘 VOC',         value: todayVoc,     unit: '건', color: 'text-blue-600' },
    { label: '활성 업무폰',       value: activePhones, unit: '대', color: 'text-green-600' },
  ]

  return (
    <div>
      {/* ── 헤더 ── */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-800">대시보드</h2>
        <div className="flex items-center gap-2 text-sm">
          <input type="date" value={dateFrom}
            onChange={e => { setDateFrom(e.target.value); setSelectedDate(null); setExpandedId(null) }}
            className="border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <span className="text-gray-400">~</span>
          <input type="date" value={dateTo}
            onChange={e => { setDateTo(e.target.value); setSelectedDate(null); setExpandedId(null) }}
            className="border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm">불러오는 중...</p>
      ) : (
        <>
          {/* ── 요약 카드 ── */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            {cards.map(({ label, value, unit, color }) => (
              <div key={label} className="bg-white rounded-xl border border-gray-200 p-5">
                <p className="text-xs text-gray-500 mb-1">{label}</p>
                <p className={`text-3xl font-bold ${color}`}>
                  {value.toLocaleString()}
                  <span className="text-sm font-normal text-gray-400 ml-1">{unit}</span>
                </p>
              </div>
            ))}
          </div>

          {/* ── 차트 ── */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
            <p className="text-sm font-semibold text-gray-700 mb-1">
              일자별 · 카테고리별 VOC 현황
            </p>
            <p className="text-xs text-gray-400 mb-4">
              막대 클릭 → 목록 펼치기 &nbsp;|&nbsp; 목록 행 클릭 → 상세 내용 펼치기
            </p>
            {chartData.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-10">해당 기간에 VOC 데이터가 없습니다.</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  data={chartData}
                  margin={{ top: 4, right: 16, left: 0, bottom: 4 }}
                  style={{ cursor: 'pointer' }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(value, name) => [value, name]} contentStyle={{ fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {categoryKeys.map((cat, i) => (
                    <Bar key={cat} dataKey={cat} stackId="a" fill={COLORS[i % COLORS.length]} onClick={handleBarClick} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* ── 드릴다운 패널 ── */}
          {selectedDate && (
            <div className="bg-white rounded-xl border border-green-200 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 bg-green-50 border-b border-green-100">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-green-800">
                    📋 {selectedDate.slice(5, 7)}/{selectedDate.slice(8, 10)} VOC 목록
                  </span>
                  {!drillLoading && (
                    <span className="text-xs text-green-600 bg-green-100 px-2 py-0.5 rounded-full">
                      {drillRecords.length}건
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => navigate(`/voc?date=${selectedDate}`)}
                    className="text-xs text-green-700 underline hover:text-green-900"
                  >
                    전체 페이지로 보기 →
                  </button>
                  <button
                    onClick={() => { setSelectedDate(null); setDrillRecords([]); setExpandedId(null) }}
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
                <table className="w-full text-xs table-fixed">
                  <colgroup>
                    <col style={{ width: '2%' }} />   {/* 토글 */}
                    <col style={{ width: '8%' }} />   {/* 업무폰 */}
                    <col style={{ width: '11%' }} />  {/* 발신번호 */}
                    <col style={{ width: '5%' }} />   {/* 방향 */}
                    <col style={{ width: '9%' }} />   {/* 통화시작 */}
                    <col style={{ width: '5%' }} />   {/* 감성 */}
                    <col style={{ width: '8%' }} />   {/* 카테고리 */}
                    <col style={{ width: '52%' }} />  {/* 요약 */}
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
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
