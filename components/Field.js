// Outlined text field with a floating label.
// Pass the input or select as the child; the label is drawn after it so CSS can float it.
// `side` is an optional element placed over the right edge (the password Show button).
export default function Field({ id, label, error, className, side, children }) {
  return (
    <>
      <div className={`field${className ? ` ${className}` : ''}`}>
        {children}
        <label htmlFor={id}>{label}</label>
        {side}
      </div>
      {error && <div className="ferr" id={`${id}-err`} role="alert">{error}</div>}
    </>
  );
}
