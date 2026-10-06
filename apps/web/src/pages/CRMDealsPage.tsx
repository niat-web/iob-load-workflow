import { DealsSection } from "../components/crm/DealsSection";

export function CRMDealsPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h1 className="sr-only">Deals</h1>
      <DealsSection emptyDescription="Add a HubSpot Deal from the Dashboard to get started." />
    </div>
  );
}
