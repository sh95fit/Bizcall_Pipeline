import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

interface Stats {
  totalVoc: number
  todayVoc: number
  pendingVoc: number
  completedVoc: number
  totalPhones: number
  activePhones: number
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats>({
    totalVoc: 0, todayVoc: 0, pendingVoc: 0,
    completedVoc: 0, totalPhones: 0, activePhones: 0,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchStats = async () => {
      const today = new Date()
      today.setHours(0, 0, 0, 0)

      const [
        { count: totalVoc },
        { count: todayVoc },
        { count: pendingVoc },
        { count: completedVoc },
        { count: totalPhones },
        { count: activePhones },
      ] = await Promise.all([
        supabase.from('voc_records').select('*', { count: 'exact', head: true }).eq('is_deleted', false),
        supabase.from('voc_records').select('*', { count: 'exact', head: true }).eq('is_deleted', false).gte('created_at', today.toISOString()),
        supabase.from('voc_records').select('*', { count: 'exact', head: true }).eq('is_deleted', false).eq('processing_status', 'pending'),
        supabase.from('voc_records').select('*', { count: 'exact', head: true }).eq('is_deleted', false).eq('processing_status', 'completed'),
        supabase.from('phones').select('*', { count: 'exact', head: true }),
        supabase.from('phones').select('*', { count: 'exact', head: true }).eq('is_active', true),
      ])

      setStats({
        totalVoc: totalVoc ?? 0,
        todayVoc: todayVoc ?? 0,
        pendingVoc: pendingVoc ?? 0,
        completedVoc: completedVoc ?? 0,
        totalPhones: totalPhones ?? 0,
        activePhones: activePhones ?? 0,
      })
      setLoading(false)
    }
    fetchStats()
  }, [])

  const cards = [
    { label: '전체 VOC', value: stats.totalVoc, unit: '건', color: 'text-gray-800' },
    { label: '오늘 VOC', value: stats.todayVoc, unit: '건', color: 'text-blue-600' },
    { label: '처리 대기', value: stats.pendingVoc, unit: '건', color: 'text-yellow-600' },
    { label: '처리 완료', value: stats.completedVoc, unit: '건', color: 'text-green-600' },
    { label: '전체 업무폰', value: stats.totalPhones, unit: '대', color: 'text-gray-800' },
    { label: '활성 업무폰', value: stats.activePhones, unit: '대', color: 'text-green-600' },
  ]

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-6">대시보드</h2>

      {loading ? (
        <p className="text-gray-400 text-sm">불러오는 중...</p>
      ) : (
        <div className="grid grid-cols-3 gap-4">
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
      )}
    </div>
  )
}
