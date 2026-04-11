export function EmptyState({ message = "No data yet." }: { message?: string }) {
  return (
    <div className="py-12 text-center">
      <p className="text-gray-400 text-sm">{message}</p>
    </div>
  );
}

export function ErrorState({ message = "Failed to load data." }: { message?: string }) {
  return (
    <div className="py-12 text-center">
      <p className="text-red-400 text-sm">{message}</p>
    </div>
  );
}
