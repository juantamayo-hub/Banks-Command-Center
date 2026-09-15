import { SkeletonCard, SkeletonTable, Skeleton } from '@/components/ui/Skeleton'

export default function BankLoading() {
  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div>
        <Skeleton className="h-3 w-32 mb-2" />
        <Skeleton className="h-6 w-40" />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-20 rounded-full" />
        ))}
      </div>

      {/* Table */}
      <SkeletonTable rows={10} cols={6} />
    </div>
  )
}
