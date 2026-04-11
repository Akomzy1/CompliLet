interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between border-b border-gray-200 bg-white px-6 py-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">{title}</h1>
        {description && (
          <p className="mt-0.5 text-sm text-gray-500">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

// ─── Section card wrapper ──────────────────────────────────────────────────────
export function SectionCard({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-white rounded-lg border border-gray-200 shadow-sm ${className}`}>
      {title && (
        <div className="px-5 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">{title}</h2>
        </div>
      )}
      {children}
    </div>
  );
}

// ─── Search form (URL-params based) ───────────────────────────────────────────
export function SearchBar({
  placeholder = "Search…",
  name = "q",
  defaultValue = "",
}: {
  placeholder?: string;
  name?: string;
  defaultValue?: string;
}) {
  return (
    <form method="GET" className="flex gap-2">
      <input
        type="search"
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 w-64"
      />
      <button
        type="submit"
        className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
      >
        Search
      </button>
    </form>
  );
}

// ─── Filter select (auto-submit on change) ────────────────────────────────────
export function FilterSelect({
  name,
  label,
  options,
  defaultValue = "",
}: {
  name: string;
  label: string;
  options: { value: string; label: string }[];
  defaultValue?: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor={name} className="text-xs text-gray-500 whitespace-nowrap">
        {label}
      </label>
      <select
        id={name}
        name={name}
        defaultValue={defaultValue}
        className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-teal-500 focus:outline-none"
        onChange={(e) => {
          const form = e.target.closest("form");
          if (form) form.submit();
        }}
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
