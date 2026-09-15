import { SkeletonCard, SkeletonTable, SkeletonToolbar, Skeleton } from '@/components/ui/Skeleton'

export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div>
        <Skeleton className="h-6 w-48 mb-2" />
        <Skeleton className="h-4 w-72" />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SkeletonCard />
        <SkeletonCard />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 gap-4">
        <Skeleton className="h-4 w-24 mb-2" />
        <Skeleton className="h-4 w-24 mb-2" />
      </div>

      {/* Toolbar */}
      <SkeletonToolbar />

      {/* Table */}
      <SkeletonTable rows={10} cols={7} />
    </div>
  )
}
