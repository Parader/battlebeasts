/** Full-bleed key art for login / home / name setup. */
export function AuthBackdrop() {
  return (
    <div className="bb-auth-backdrop" aria-hidden>
      <img className="bb-auth-backdrop__art" src="/brand/keyart.png" alt="" />
      <div className="bb-auth-backdrop__veil" />
      <div className="bb-auth-backdrop__grain" />
    </div>
  );
}
