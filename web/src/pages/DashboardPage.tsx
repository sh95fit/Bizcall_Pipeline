import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
  type BarRectangleItem,
} from 'recharts'
import { supabase } from '../lib/supabase'

/* ───────── 타입 ───────── */
interface VocRow {
  call_started_at: string | null
  category_id: string | null
  categories: { name: string }[] | null
}

interface ChartDatum {
  date: string
  dateISO: string
  [category: string]: string | number
}

// recharts Bar onClick의 data 파라미터: BarRectangleItem에 커스텀 필드가 런타임에 존재
type BarClickData = BarRectangleItem & ChartDatum

/* ───────── 상수 ───────── */
const COLORS = [
  '#4ade80', '#60a5fa', '#f97316', '#a78bfa',
  '#fb7185', '#facc15', '#34d399', '#38bdf8',
]

const getDefaultRange = () => {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth(), 1)
  return {
    from: from.toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
  }
}

/* ───────── 컴포넌트 ───────── */
export default function DashboardPage() {
  const navigate = useNavigate()
  const def = getDefaultRange()

  const [dateFrom, setDateFrom] = useState(def.from)
  const [dateTo, setDateTo]     = useState(def.to)
  const [totalVoc, setTotalVoc]         = useState(0)
  const [todayVoc, setTodayVoc]         = useState(0)
  const [activePhones, setActivePhones] = useState(0)
  const [vocRows, setVocRows]           = useState<VocRow[]>([])
  const [loading, setLoading]           = useState(true)

  const fetchData = async () => {
    setLoading(true)

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const fromISO = new Date(dateFrom).toISOString()
    const toISO   = new Date(dateTo + 'T23:59:59').toISOString()

    const [
      { count: tv },
      { count: tov },
      { count: ap },
      { data: rows },
    ] = await Promise.all([
      supabase.from('voc_records')
        .select('*', { count: 'exact', head: true })
        .eq('is_deleted', false)
        .gte('call_started_at', fromISO)
        .lte('call_started_at', toISO),

      supabase.from('voc_records')
        .select('*', { count: 'exact', head: true })
        .eq('is_deleted', false)
        .gte('call_started_at', todayStart.toISOString()),

      supabase.from('phones')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true),

      supabase.from('voc_records')
        .select('call_started_at, category_id, categories(name)')
        .eq('is_deleted', false)
        .gte('call_started_at', fromISO)
        .lte('call_started_at', toISO),
    ])

    setTotalVoc(tv ?? 0)
    setTodayVoc(tov ?? 0)
    setActivePhones(ap ?? 0)
    setVocRows((rows as unknown as VocRow[]) ?? [])
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [dateFrom, dateTo])

  /* ── 차트 데이터 가공 ── */
  const { chartData, categoryKeys } = useMemo(() => {
    const dateMap: Record<string, Record<string, number | string>> = {}
    const catSet = new Set<string>()

    vocRows.forEach(row => {
      if (!row.call_started_at) return
      const d = new Date(row.call_started_at)
      const iso   = d.toISOString().slice(0, 10)
      const label = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
      const catName = row.categories?.[0]?.name ?? '미분류'
      catSet.add(catName)

      if (!dateMap[iso]) dateMap[iso] = { __label: label }
      dateMap[iso][catName] = ((dateMap[iso][catName] as number) ?? 0) + 1
    })

    const sorted = Object.entries(dateMap).sort(([a], [b]) => a.localeCompare(b))
    const keys   = Array.from(catSet)

    const data: ChartDatum[] = sorted.map(([iso, vals]) => ({
      date: vals.__label as string,
      dateISO: iso,
      ...Object.fromEntries(keys.map(k => [k, (vals[k] as number) ?? 0])),
    }))

    return { chartData: data, categoryKeys: keys }
  }, [vocRows])

  /* ── Bar 클릭 핸들러 ──
     런타임에는 ChartDatum 필드가 실제로 존재하므로 정상 동작
     타입은 BarRectangleItem & ChartDatum 로 선언해 에러 해소 */
  const handleBarClick = (data: BarClickData) => {
    if (data?.dateISO) navigate(`/voc?date=${data.dateISO}`)
  }

  const cards = [
    { label: '기간 내 전체 VOC', value: totalVoc,     unit: '건', color: 'text-gray-800' },
    { label: '오늘 VOC',         value: todayVoc,     unit: '건', color: 'text-blue-600' },
    { label: '활성 업무폰',       value: activePhones, unit: '대', color: 'text-green-600' },
  ]

  return (
    <div>
      {/* 헤더 + 기간 필터 */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-800">대시보드</h2>
        <div className="flex items-center gap-2 text-sm">
          <input
            type="date" value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <span className="text-gray-400">~</span>
          <input
            type="date" value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm">불러오는 중...</p>
      ) : (
        <>
          {/* 통계 카드 */}
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

          {/* 차트 */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-sm font-semibold text-gray-700 mb-4">
              일자별 · 카테고리별 VOC 현황
              <span className="ml-2 text-xs font-normal text-gray-400">
                (막대 클릭 시 해당 일자 VOC 목록으로 이동)
              </span>
            </p>

            {chartData.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-10">
                해당 기간에 VOC 데이터가 없습니다.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={340}>
                <BarChart
                  data={chartData}
                  margin={{ top: 4, right: 16, left: 0, bottom: 4 }}
                  style={{ cursor: 'pointer' }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {categoryKeys.map((cat, i) => (
                    <Bar
                      key={cat}
                      dataKey={cat}
                      stackId="a"
                      fill={COLORS[i % COLORS.length]}
                      onClick={handleBarClick}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </>
      )}
    </div>
  )
}
