import { SkeletonTable, Skeleton } from '@/components/ui/Skeleton'

export default function MetricasLoading() {
  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div>
        <Skeleton className="h-3 w-24 mb-2" />
        <Skeleton className="h-6 w-48 mb-2" />
        <Skeleton className="h-4 w-80" />
      </div>

      {/* Section heading */}
      <Skeleton className="h-3 w-32" />

      {/* Table */}
      <SkeletonTable rows={12} cols={8} />

      {/* Clusters heading */}
      <Skeleton className="h-3 w-40" />

      {/* Cluster cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex justify-between mb-2">
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-5 w-8" />
            </div>
            <Skeleton className="h-1.5 w-full rounded-full" />
          </div>
        ))}
      </div>
    </div>
  )
}
