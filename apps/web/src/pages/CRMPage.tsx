import { CRM_FILTER_KEYS, DealsSection } from "../components/crm/DealsSection";
import { DealIdSubmitCard } from "../components/DealIdSubmitCard";
import { useUrlFilters } from "../hooks/useUrlFilters";

export function CRMPage() {
  const { page, hasFilters, clearFilters } = useUrlFilters(CRM_FILTER_KEYS);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <h1 className="sr-only">CRM dashboard</h1>
      <DealIdSubmitCard
        onSubmitted={() => {
          if (hasFilters || page !== 1) clearFilters();
        }}
      />
      <DealsSection emptyDescription="Enter a HubSpot Deal ID above to get started." fixedPageSize={15} />
    </div>
  );
}
