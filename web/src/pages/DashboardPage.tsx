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
  processing_status: string
  sentiment: string | null
  summary: string | null
  action_required: boolean
  action_memo: string | null
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
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/* ─── 컴포넌트 ─── */
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

  // 드롭다운 관련
  const [selectedDate, setSelectedDate]       = useState<string | null>(null)
  const [drillRecords, setDrillRecords]       = useState<VocRecord[]>([])
  const [drillLoading, setDrillLoading]       = useState(false)

  /* ── 차트·집계 데이터 fetch ── */
  const fetchData = async () => {
    setLoading(true)
    const fromISO  = `${dateFrom}T00:00:00+09:00`
    const toISO    = `${dateTo}T23:59:59+09:00`
    const todayISO = `${new Date().toISOString().slice(0, 10)}T00:00:00+09:00`

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

  /* ── 드릴다운: 특정 날짜 VOC 목록 fetch ── */
  const fetchDrillDown = async (dateISO: string) => {
    setDrillLoading(true)
    const { data, error } = await supabase
      .from('voc_records')
      .select('id,phone_name,caller_number,call_direction,call_started_at,processing_status,sentiment,summary,action_required,action_memo')
      .eq('is_deleted', false)
      .gte('call_started_at', `${dateISO}T00:00:00+09:00`)
      .lte('call_started_at', `${dateISO}T23:59:59+09:00`)
      .order('call_started_at', { ascending: false })
    if (!error && data) setDrillRecords(data)
    setDrillLoading(false)
  }

  /* ── 차트 막대 클릭 ── */
  const handleBarClick = (data: BarClickData) => {
    if (!data?.dateISO) return
    if (selectedDate === data.dateISO) {
      // 같은 날짜 재클릭 → 접기
      setSelectedDate(null)
      setDrillRecords([])
    } else {
      setSelectedDate(data.dateISO)
      fetchDrillDown(data.dateISO)
    }
  }

  /* ── 차트 데이터 가공 ── */
  const { chartData, categoryKeys } = useMemo(() => {
    const dateMap: Record<string, Record<string, number | string>> = {}
    const catSet  = new Set<string>()

    vocRows.forEach(row => {
      if (!row.call_started_at) return
      const iso   = row.call_started_at.slice(0, 10)
      const label = `${iso.slice(5, 7)}/${iso.slice(8, 10)}`
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
            onChange={e => { setDateFrom(e.target.value); setSelectedDate(null) }}
            className="border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <span className="text-gray-400">~</span>
          <input type="date" value={dateTo}
            onChange={e => { setDateTo(e.target.value); setSelectedDate(null) }}
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
              막대를 클릭하면 해당 일자 VOC 목록이 아래에 펼쳐집니다
            </p>

            {chartData.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-10">
                해당 기간에 VOC 데이터가 없습니다.
              </p>
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
                  <Tooltip
                    formatter={(value, name) => [value, name]}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {categoryKeys.map((cat, i) => (
                    <Bar
                      key={cat}
                      dataKey={cat}
                      stackId="a"
                      fill={selectedDate
                        ? (chartData.find(d => d.dateISO === selectedDate)
                          ? COLORS[i % COLORS.length]
                          : COLORS[i % COLORS.length] + '66')  // 선택 안된 날 흐리게
                        : COLORS[i % COLORS.length]}
                      onClick={handleBarClick}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* ── 드롭다운 VOC 목록 ── */}
          {selectedDate && (
            <div className="bg-white rounded-xl border border-green-200 shadow-sm overflow-hidden">
              {/* 드롭다운 헤더 */}
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
                    onClick={() => { setSelectedDate(null); setDrillRecords([]) }}
                    className="text-gray-400 hover:text-gray-600 text-lg leading-none"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* 테이블 */}
              {drillLoading ? (
                <p className="text-gray-400 text-sm text-center py-8">불러오는 중...</p>
              ) : drillRecords.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-8">해당 날짜의 VOC가 없습니다.</p>
              ) : (
                <table className="w-full text-xs table-fixed">
                  <colgroup>
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
                        <th key={h} className="text-left px-3 py-2 text-xs font-medium text-gray-500 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {drillRecords.map(r => (
                      <tr key={r.id}
                        onClick={() => navigate(`/voc/${r.id}`)}
                        className="hover:bg-gray-50 cursor-pointer">

                        <td className="px-3 py-2 text-gray-700 truncate overflow-hidden whitespace-nowrap">
                          {r.phone_name ?? '-'}
                        </td>
                        <td className="px-3 py-2 font-mono text-gray-600 whitespace-nowrap">
                          {r.caller_number ?? '-'}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {r.call_direction === 'incoming'
                            ? <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-500">수신</span>
                            : r.call_direction === 'outgoing'
                            ? <span className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-500">발신</span>
                            : <span className="text-gray-300">-</span>}
                        </td>
                        <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                          {formatDate(r.call_started_at)}
                        </td>
                        <td className={`px-3 py-2 font-medium whitespace-nowrap ${r.sentiment ? SENTIMENT_COLOR[r.sentiment] : 'text-gray-300'}`}>
                          {r.sentiment ? (SENTIMENT_LABEL[r.sentiment] ?? r.sentiment) : '-'}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className={`px-1.5 py-0.5 rounded-full ${STATUS_COLOR[r.processing_status] ?? 'bg-gray-100 text-gray-500'}`}>
                            {STATUS_LABEL[r.processing_status] ?? r.processing_status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-gray-400 truncate overflow-hidden whitespace-nowrap">
                          {r.summary ?? <span className="text-gray-200">-</span>}
                        </td>
                        <td className="px-3 py-2 truncate overflow-hidden whitespace-nowrap">
                          {r.action_required
                            ? <span className="text-orange-500">⚠ {r.action_memo ?? '조치 필요'}</span>
                            : <span className="text-gray-200">-</span>}
                        </td>
                      </tr>
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
