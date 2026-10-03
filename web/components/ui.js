export function PageHead({ title, desc, children }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {desc && <p className="muted">{desc}</p>}
      </div>
      {children && <div className="row">{children}</div>}
    </div>
  );
}

export function Card({ title, actions, children, flush, className = "" }) {
  return (
    <section className={`card ${flush ? "flush" : ""} ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, tone, sub }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className={`value ${tone || ""}`}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      {title && <b>{title}</b>}
      {children}
    </div>
  );
}

export function Badge({ tone, children }) {
  return <span className={`badge ${tone || ""}`}>{children}</span>;
}

export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function Chips({ options, value, onChange }) {
  return (
    <div className="chips">
      {options.map((o) => (
        <button key={o.value} type="button" className={`chip ${value === o.value ? "on" : ""}`} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
