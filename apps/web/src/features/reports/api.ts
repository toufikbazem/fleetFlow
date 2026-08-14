/**
 * Reports data layer — FF-1003.
 */

import type {
  ExportFormat,
  ReportCatalogue,
  ReportFilter,
  ReportName,
  ReportResult,
} from '@fleetflow/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiDownload, apiRequest } from '@/lib/api-client';

/** Undefined values are dropped by `buildUrl`, so an unset filter sends nothing. */
function filterQuery(filter: ReportFilter): Record<string, string | undefined> {
  return {
    from: filter.from,
    to: filter.to,
    vehicleId: filter.vehicleId,
    driverId: filter.driverId,
  };
}

export function useReportCatalogue() {
  return useQuery({
    queryKey: ['reports', 'catalogue'],
    queryFn: () => apiRequest<ReportCatalogue>('/reports'),
    // Five titles that change only when the code does.
    staleTime: Infinity,
  });
}

export function useReport(name: ReportName, filter: ReportFilter, page: number, pageSize: number) {
  return useQuery({
    queryKey: ['reports', name, filter, page, pageSize],
    queryFn: () =>
      apiRequest<ReportResult>(`/reports/${name}`, {
        query: { ...filterQuery(filter), page, pageSize },
      }),
    placeholderData: (previous) => previous,
  });
}

/**
 * RPT-06.
 *
 * The export sends the filters, never the rows. Posting back what is on screen
 * would let a stale or edited table become the exported file; sending the
 * filters means the server recomputes from the same query the screen used, over
 * the whole result set rather than the visible page.
 */
export function useExportReport(name: ReportName, filter: ReportFilter) {
  return useMutation({
    mutationFn: (format: ExportFormat) =>
      apiDownload(`/reports/${name}/export`, { ...filterQuery(filter), format }),
  });
}
