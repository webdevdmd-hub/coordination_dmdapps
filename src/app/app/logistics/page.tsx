export default function Page() {
  return (
    <div className="space-y-8">
      <section className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted/80">
              Operations
            </p>
            <h1 className="font-display text-5xl text-text">Logistics</h1>
            <p className="mt-3 max-w-2xl text-lg text-muted">
              Coordinate deliveries and shipment tracking.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
