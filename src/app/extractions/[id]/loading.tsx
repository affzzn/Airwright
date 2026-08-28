import { AppShell } from "@/components/app-shell";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";

/** Fallback for the review workspace — mirrors the toolbar + two panes so the
 *  real screen resolves in place without a layout jump. */
export default function Loading() {
  return (
    <AppShell variant="workspace">
      <div className="flex h-full flex-col">
        {/* Toolbar */}
        <div className="flex items-center justify-between gap-4 border-b border-hairline px-6 py-3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-4 w-4" />
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-5 w-20" />
          </div>
          <Skeleton className="hidden h-3.5 w-64 sm:block" />
        </div>

        {/* Two panes */}
        <div className="min-h-0 flex-1 lg:grid lg:grid-cols-2 lg:grid-rows-1">
          {/* Drawing */}
          <div className="flex h-[55vh] flex-col overflow-hidden border-b border-hairline p-4 lg:h-auto lg:border-b-0 lg:border-r">
            <Skeleton className="mb-3 h-4 w-20" />
            <Skeleton className="min-h-0 w-full flex-1" />
          </div>
          {/* Take-off */}
          <div className="flex min-h-0 flex-col p-4">
            <Card className="lg:flex lg:h-full lg:flex-col">
              <CardHeader className="flex items-center justify-between">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-8 w-32" />
              </CardHeader>
              <CardBody className="space-y-6">
                <SkeletonText lines={3} />
                <SkeletonText lines={5} />
                <SkeletonText lines={4} />
              </CardBody>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
