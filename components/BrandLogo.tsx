// Brand identity. Working name: ANVIL (FHC-tested in English: easy, hype, curious;
// names the mechanism: the bench where every piece gets hammered out, pay per strike).
// Mark = lime tile + ink anvil silhouette + one spark. Pure geometry so it stays
// crisp at 16px and follows the accent token (teal switch included).

export const BRAND_NAME = "ANVIL";

export function BrandGlyph({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      {/* anvil top face with horn */}
      <path d="M2 8h15v4H9l-1.5 1H6L5 12H2z" />
      {/* waist */}
      <rect x="9" y="12" width="7" height="4" />
      {/* base */}
      <path d="M6 16h13v3H6z" />
      {/* spark */}
      <path d="M20 1l.9 2.1L23 4l-2.1.9L20 7l-.9-2.1L17 4l2.1-.9z" />
    </svg>
  );
}

export function BrandMark({ size = 32 }: { size?: number }) {
  const radius = Math.round(size * 0.3125); // 10px at 32
  return (
    <div
      className="grid place-items-center shrink-0 bg-accent text-on-accent"
      style={{ width: size, height: size, borderRadius: radius }}
    >
      <BrandGlyph size={Math.round(size * 0.5)} />
    </div>
  );
}
